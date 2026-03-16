// cron/setClassStatuses.js
const { sequelize } = require('../connection/connection');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Import models
const Class = require('../models/classes');
const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const ClassReminder = require('../models/classReminder');
const TrialClassRegistration = require('../models/trialClassRegistration');

// Import notification helper
const { whatsappReminderAddClass } = require('./reminder');

// Setup logging
const logsDir = path.join(__dirname, '../logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `class-statuses-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

// Helper function to ensure all values are strings
function ensureStringValues(obj) {
    const result = {};
    for (const key in obj) {
        if (obj[key] === null || obj[key] === undefined) {
            result[key] = ''; // Convert null/undefined to empty string
        } else {
            result[key] = String(obj[key]); // Convert all values to string
        }
    }
    return result;
}

// Helper function to check if a reminder has been delivered
async function hasDeliveredReminder(classId, related, type) {
    const reminders = await ClassReminder.findAll({
        where: {
            lesson_id: classId,
            related: related,
            type: type,
            status: "delivered"
        }
    });
    
    return reminders.length > 0;
}

// Flag to prevent concurrent executions
let isJobRunning = false;

/**
 * Process classes and update their statuses based on time
 */
async function setClassStatuses() {
    logToFile('Starting class status update process');
    
    if (isJobRunning) {
        logToFile('Previous job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning = true;
    
    try {
        // Get all classes for today that aren't canceled or ended
        const classes = await Class.findAll({
            where: {
                meeting_start: {
                    [Op.lte]: moment().format('YYYY-MM-DD HH:mm:ss')
                },
                status: {
                    [Op.notIn]: ['canceled', 'ended']
                }
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'trial_expired', 'timezone'],
                    required: false
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code', 'add_zoom_link'],
                    required: false
                }
            ]
        });
        
        logToFile(`Found ${classes.length} classes to process`);
        
        // Process each class
        for (const classItem of classes) {
            try {
                // Handle regular hide classes (set to canceled)
                if (classItem.is_regular_hide == 1) {
                    await classItem.update({ status: 'canceled' });
                    logToFile(`Marked class ID: ${classItem.id} as cancelled (was hidden)`);
                    continue;
                }
                
                const now = moment().utc();
                const meetingStart = moment.utc(classItem.meeting_start);
                const meetingEnd = moment.utc(classItem.meeting_end);
                
                // Check if class has started
                if (meetingStart.isSameOrBefore(now) && classItem.status !== 'started') {
                    await classItem.update({ status: 'started' });
                    logToFile(`Marked class ID: ${classItem.id} as started`);
                    
                    // Send notifications for started class
                    await processStartedClassNotifications(classItem);
                }
                
                // Check if class has ended
                if (meetingEnd.isSameOrBefore(now) && classItem.status !== 'ended') {
                    await processEndedClass(classItem);
                }
                
            } catch (error) {
                logToFile(`Error processing class ID: ${classItem.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }
        
        logToFile('Class status update process completed');
        
    } catch (error) {
        logToFile(`Unhandled error in setClassStatuses: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning = false;
    }
}

/**
 * Process notifications for started classes
 */
async function processStartedClassNotifications(classItem) {
    try {
        // Fetch student and teacher data if not already included
        let student = classItem.Student || null;
        let teacher = classItem.Teacher || null;
        let trialClassData = null;
        let studentName = 'Student'; // Default value
        
        if (!student && classItem.student_id) {
            student = await User.findByPk(classItem.student_id);
        }
        
        if (!teacher && classItem.teacher_id) {
            teacher = await User.findByPk(classItem.teacher_id);
        }
        
        // For trial classes, get the trial class registration data if demo_class_id exists
        if (classItem.demo_class_id) {
            trialClassData = await TrialClassRegistration.findByPk(classItem.demo_class_id);
            if (trialClassData && trialClassData.student_name) {
                // Use student_name from trial class registration if available
                studentName = trialClassData.student_name;
                logToFile(`Found trial class registration for ID: ${classItem.demo_class_id}, student name: ${studentName}`);
            }
        }
        
        // If we have a student name from Student model, use it
        if (student && student.full_name) {
            studentName = student.full_name;
        }
        
        // Get class duration from subscription or use default
        let classDuration = '25'; // Default duration in minutes
        
        if (classItem.student_id) {
            const subscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: classItem.student_id,
                    status: 'active'
                },
                order: [['created_at', 'DESC']]
            });
            
            if (subscription && subscription.lesson_min) {
                classDuration = subscription.lesson_min.toString();
            }
        }
        
        // Send notification to student if not already sent
        if ((classItem.student_id && student) || (classItem.is_trial && trialClassData)) {
            // Check if student already received notification
            const studentAlreadyNotified = await hasDeliveredReminder(classItem.id, "student", "0");
            
            if (!studentAlreadyNotified && student) {
                // Create notification options with named parameters
                const notifOptStudent = {
                    'student.name': student?.full_name || studentName,
                    'link.link': classItem.join_url || '-',
                    'meeting.id': teacher?.add_zoom_link_meeting_id || '-',
                    'access.code': teacher?.add_zoom_link_access_code || '-'
                };
                
                // Ensure all values are strings
                const stringNotifOptStudent = ensureStringValues(notifOptStudent);
                
                // Debug log
                logToFile(`Sending student notification with params: ${JSON.stringify(stringNotifOptStudent)}`);
                
                // Send notification using the existing whatsappReminderAddClass function
                const studentSent = await whatsappReminderAddClass("lesson_started", stringNotifOptStudent, classItem.student_id);
                
                // Record the notification attempt
                await ClassReminder.create({
                    lesson_id: classItem.id,
                    notif_key: "lesson_started",
                    status: studentSent ? "delivered" : "failed",
                    type: "0",
                    related: "student"
                });
                
                logToFile(`Sent class started notification to student ID: ${classItem.student_id}, status: ${studentSent ? 'delivered' : 'failed'}`);
            }
        }
        
        // Send notification to teacher if not already sent
        if (classItem.teacher_id && teacher) {
            // Check if teacher already received notification
            const teacherAlreadyNotified = await hasDeliveredReminder(classItem.id, "teacher", "0");
            
            if (!teacherAlreadyNotified) {
                // Create notification options with named parameters
                const notifOpt = {
                    'instructor.name': teacher.full_name || 'Teacher',
                    'student.name': studentName,
                    'time.duration': classDuration
                };
                
                // Ensure all values are strings
                const stringNotifOpt = ensureStringValues(notifOpt);
                
                // Debug log
                logToFile(`Sending teacher notification with params: ${JSON.stringify(stringNotifOpt)}`);
                
                // Send notification using the existing whatsappReminderAddClass function
                const teacherSent = await whatsappReminderAddClass(
                    "regular_class_started", 
                    stringNotifOpt, 
                    classItem.teacher_id
                );
                
                // Record the notification attempt
                await ClassReminder.create({
                    lesson_id: classItem.id,
                    notif_key: "regular_class_started",
                    status: teacherSent ? "delivered" : "failed",
                    type: "0",
                    related: "teacher"
                });
                
                logToFile(`Sent class started notification to teacher ID: ${classItem.teacher_id}, status: ${teacherSent ? 'delivered' : 'failed'}`);
            }
        }
    } catch (error) {
        logToFile(`Error sending notifications for class ID: ${classItem.id}: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    }
}

/**
 * Process ended classes
 */
async function processEndedClass(classItem) {
    const transaction = await sequelize.transaction();
    
    try {
        // Preload related user data for later use (notifications, external API calls)
        let studentUser = classItem.Student;
        let teacherUser = classItem.Teacher;

        // Update trial_expired status for trial classes
        if (classItem.is_trial && classItem.student_id) {
            const trialStudent = await User.findByPk(classItem.student_id, { transaction });
            if (trialStudent) {
                await trialStudent.update(
                    { trial_expired: 1 },
                    { transaction }
                );
                logToFile(`Updated trial_expired status for student ID: ${trialStudent.id}`);
            }
        }
        
        // Mark class as ended
        await classItem.update(
            { status: 'ended' },
            { transaction }
        );
        
        logToFile(`Marked class ID: ${classItem.id} as ended`);
        
        // Update student subscription if active
        if (classItem.student_id) {
            const subscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: classItem.student_id,
                    status: 'active'
                },
                order: [['created_at', 'DESC']],
                transaction
            });
            
            if (subscription) {
                // Update weekly_comp_class counter
                let updates = { weekly_comp_class: subscription.weekly_comp_class + 1 };
                
                // Update the subscription
                await subscription.update(updates, { transaction });
                
                logToFile(`Updated subscription for student ID: ${classItem.student_id}, weekly_comp_class: ${subscription.weekly_comp_class + 1}`);
            }
        }
        
        // Optional: Send class completion notifications
        try {
            if (!studentUser && classItem.student_id) {
                studentUser = await User.findByPk(classItem.student_id, { transaction });
            }
            
            if (!teacherUser && classItem.teacher_id) {
                teacherUser = await User.findByPk(classItem.teacher_id, { transaction });
            }
            
            if (studentUser && teacherUser) {
                // Optional: Send class ended notification
                const studentNotifOpt = {
                    'student.name': studentUser?.full_name || 'Student',
                    'instructor.name': teacherUser.full_name || 'Teacher',
                    'time.date': studentUser.timezone 
                        ? moment(classItem.meeting_start).tz(studentUser.timezone).format('DD/MM/YYYY HH:mm')
                        : moment(classItem.meeting_start).format('DD/MM/YYYY HH:mm')
                };
                
                // Uncomment if you want to send class_ended notifications
                // const stringStudentNotifOpt = ensureStringValues(studentNotifOpt);
                // const studentSent = await whatsappReminderAddClass("class_ended", stringStudentNotifOpt, student.id);
                
                // if (studentSent) {
                //     await ClassReminder.create({
                //         lesson_id: classItem.id,
                //         notif_key: "class_ended",
                //         status: "delivered",
                //         type: "1",
                //         related: "student"
                //     });
                // }
                
                // Trigger external lesson processing for classes with a student
                if (classItem.student_id) {
                    try {
                        // Times in DB are stored in UTC, so we format directly from UTC
                        const startMoment = moment.utc(classItem.meeting_start);
                        const endMoment = moment.utc(classItem.meeting_end);

                        const payload = {
                            teacherEmail: teacherUser?.email || '',
                            date: startMoment.format('YYYY-MM-DD'),
                            startTime: startMoment.format('HH:mm'),
                            endTime: endMoment.format('HH:mm'),
                            user_id: String(classItem.student_id),
                            teacher_id: String(classItem.teacher_id),
                            class_id: String(classItem.id),
                            lesson_number: 1,
                            meetingId: classItem.zoom_id
                                ? String(classItem.zoom_id)
                                : teacherUser?.add_zoom_link_meeting_id
                                ? String(teacherUser.add_zoom_link_meeting_id)
                                : '',
                            meetingTopic:
                                classItem.student_goal ||
                                `Lesson_${classItem.id}`
                        };

                        logToFile(
                            `Calling AI lesson processing API for class ID: ${classItem.id} with payload: ${JSON.stringify(
                                payload
                            )}`
                        );

                        const response = await axios.post(
                            'https://tulkka-ai.onrender.com/v1/trigger-lesson-processing',
                            payload,
                            {
                                timeout: 120000,
                                headers: {
                                    accept: 'application/json',
                                    'Content-Type': 'application/json'
                                }
                            }
                        );

                        logToFile(
                            `AI lesson processing API response for class ID: ${classItem.id}: status ${response.status}`
                        );
                    } catch (apiError) {
                        logToFile(
                            `Error calling AI lesson processing API for class ID: ${classItem.id}: ${apiError.message}`,
                            'error'
                        );
                    }
                }

                logToFile(`Class ID: ${classItem.id} completed successfully`);
            }
        } catch (notifError) {
            logToFile(`Warning: Couldn't process completion notification: ${notifError.message}`, 'warn');
            // Continue with transaction - don't let notification failure stop the process
        }
        
        await transaction.commit();
        
    } catch (error) {
        await transaction.rollback();
        logToFile(`Error processing ended class ID: ${classItem.id}: ${error.message}`, 'error');
        throw error;
    }
}

// Schedule the cron job to run every minute
cron.schedule('* * * * *', async () => {
    const startTime = new Date();
    logToFile(`Starting class status update job at ${startTime.toISOString()}`);
    
    try {
        await setClassStatuses();
        const endTime = new Date();
        const executionTime = (endTime - startTime) / 1000; // in seconds
        logToFile(`Completed class status update job at ${endTime.toISOString()}, execution time: ${executionTime.toFixed(2)}s`);
    } catch (error) {
        logToFile(`Fatal error in class status update job: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    }
});

// For manual execution or testing
module.exports = {
    setClassStatuses
};