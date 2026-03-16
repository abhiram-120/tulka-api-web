// src/cronjobs/regularClassReminders.js
const cron = require('node-cron');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Import models
const Class = require('../models/classes');
const ClassReminder = require('../models/classReminder');
const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');

// Set up associations for the Class model
Class.belongsTo(User, {
    foreignKey: 'student_id',
    as: 'StudentA',
    targetKey: 'id'
});

Class.belongsTo(User, {
    foreignKey: 'teacher_id',
    as: 'TeacherAs',
    targetKey: 'id'
});

// Import notification helper
const { whatsappReminderAddClass } = require('./reminder');
// Setup logging
const logsDir = path.join(__dirname, '../logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Enhanced Logger function
function logToFile(message, type = 'info', additionalData = null) {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `regular-class-reminders-${logDate}.log`);
    
    let logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    
    // Add additional data if provided
    if (additionalData) {
        logEntry += `\nData: ${JSON.stringify(additionalData, null, 2)}`;
    }
    
    logEntry += '\n';
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message, additionalData);
    } else if (type === 'warn') {
        console.warn(message, additionalData);
    } else {
        console.log(message, additionalData);
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
async function hasDeliveredReminder(classId, related, types) {
    try {
        if (!Array.isArray(types)) {
            types = [types];
        }
        
        logToFile(`Checking delivered reminders for class ${classId}, related: ${related}`, 'info', {
            classId,
            related,
            types
        });
        
        const reminders = await ClassReminder.findAll({
            where: {
                lesson_id: classId,
                related: related,
                type: {
                    [Op.in]: types
                },
                status: "delivered"
            }
        });
        
        const hasDelivered = reminders.length > 0;
        
        logToFile(`Reminder check result for class ${classId}: ${hasDelivered ? 'Already delivered' : 'Not delivered yet'}`, 'info', {
            classId,
            related,
            types,
            foundReminders: reminders.length,
            hasDelivered,
            existingReminders: reminders.map(r => ({
                id: r.id,
                type: r.type,
                status: r.status,
                notif_key: r.notif_key
            }))
        });
        
        return hasDelivered;
    } catch (error) {
        logToFile(`Error checking delivered reminders for class ${classId}`, 'error', {
            classId,
            related,
            types,
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

// Flag to prevent concurrent executions
let isJobRunning = {
    '24hour': false,
    '4hour': false,
    '1hour': false,
    '30min': false
};

/**
 * Process regular class reminders for 24 hours before class
 */
async function processRegularReminders24Hours() {
    const jobStartTime = Date.now();
    logToFile('Starting regular class 24-hour reminders process');
    
    if (isJobRunning['24hour']) {
        logToFile('Previous 24-hour job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning['24hour'] = true;
    
    try {
        const startTime = moment().add(23, 'hours').add(59, 'minutes').toDate();
        const endTime = moment().add(24, 'hours').add(1, 'minute').toDate();
        
        logToFile('Searching for classes in 24-hour time window', 'info', {
            searchWindow: {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: new Date().toISOString()
            }
        });

        // Find classes that are pending and starting in ~24 hours
        const classes = await Class.findAll({
            where: {
                status: 'pending',
                is_regular_hide: 0,
                student_id: {
                    [Op.not]: null
                },
                meeting_start: {
                    [Op.between]: [startTime, endTime]
                }
            },
            include: [
                {
                    model: User,
                    as: 'StudentA',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'email', 'mobile', 'country_code', 'language'],
                    required: true
                },
                {
                    model: User,
                    as: 'TeacherAs',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
                    required: true
                }
            ]
        });
        
        logToFile(`Found ${classes.length} regular classes for 24-hour reminders`, 'info', {
            classCount: classes.length,
            classIds: classes.map(c => c.id),
            searchCriteria: {
                status: 'pending',
                is_regular_hide: 0,
                timeWindow: `${startTime.toISOString()} to ${endTime.toISOString()}`
            }
        });

        if (classes.length === 0) {
            logToFile('No classes found for 24-hour reminders, exiting process', 'info');
            return;
        }

        for (const classItem of classes) {
            try {
                logToFile(`Processing 24-hour reminder for class ${classItem.id}`, 'info', {
                    classId: classItem.id,
                    meetingStart: classItem.meeting_start,
                    studentId: classItem.student_id,
                    teacherId: classItem.teacher_id,
                    studentName: classItem.StudentA?.full_name,
                    teacherName: classItem.TeacherAs?.full_name,
                    joinUrl: classItem.join_url ? 'Present' : 'Missing'
                });

                // Skip if no notification preferences set
                if (!classItem.StudentA.lesson_notifications || !classItem.TeacherAs.lesson_notifications) {
                    logToFile(`Class ID ${classItem.id} has incomplete notification preferences, skipping`, 'warn', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        teacherId: classItem.teacher_id,
                        studentNotifications: classItem.StudentA.lesson_notifications,
                        teacherNotifications: classItem.TeacherAs.lesson_notifications
                    });
                    continue;
                }
                
                // Parse notification preferences
                let studentNotificationPreferences = [];
                let teacherNotificationPreferences = [];
                
                try {
                    studentNotificationPreferences = JSON.parse(classItem.StudentA.lesson_notifications || '[]');
                    teacherNotificationPreferences = JSON.parse(classItem.TeacherAs.lesson_notifications || '[]');
                    
                    logToFile(`Parsed notification preferences for class ${classItem.id}`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        studentName: classItem.StudentA.full_name,
                        teacherId: classItem.teacher_id,
                        teacherName: classItem.TeacherAs.full_name,
                        studentPreferences: studentNotificationPreferences,
                        teacherPreferences: teacherNotificationPreferences
                    });
                } catch (parseError) {
                    logToFile(`Error parsing notification preferences for class ${classItem.id}`, 'error', {
                        classId: classItem.id,
                        studentNotificationsRaw: classItem.StudentA.lesson_notifications,
                        teacherNotificationsRaw: classItem.TeacherAs.lesson_notifications,
                        error: parseError.message
                    });
                    continue;
                }
                
                // Process student notification
                if (studentNotificationPreferences.includes("24")) {
                    logToFile(`Student ${classItem.StudentA.full_name} (ID: ${classItem.student_id}) has 24-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        studentName: classItem.StudentA.full_name
                    });
                    
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "student", ["24", "4", "1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 24-hour reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name,
                            studentTimezone: classItem.StudentA.timezone,
                            meetingStart: classItem.meeting_start
                        });

                        // Format time based on student's timezone
                        const studentTime = moment(classItem.meeting_start)
                            .tz(classItem.StudentA.timezone || 'UTC')
                            .format("HH:mm");
                        
                        // Prepare notification parameters
                        const notifyOptions = {
                            'student.name': classItem.StudentA.full_name,
                            'time.time': studentTime,
                            'link.link': classItem.join_url || '-',
                            'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                            'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 24-hour WhatsApp reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name,
                            templateName: "regular_class_reminders_24",
                            notifyOptions: stringNotifyOptions,
                            studentMobile: classItem.StudentA.mobile,
                            studentCountryCode: classItem.StudentA.country_code
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_24",
                            stringNotifyOptions,
                            classItem.student_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_24",
                            status: sent ? "delivered" : "failed",
                            type: "24",
                            related: "student"
                        });
                        
                        logToFile(`24-hour reminder result for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id,
                            templateName: "regular_class_reminders_24"
                        });
                    } else {
                        logToFile(`24-hour reminder already delivered for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name
                        });
                    }
                } else {
                    logToFile(`Student ${classItem.StudentA.full_name} (ID: ${classItem.student_id}) does not have 24-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        studentName: classItem.StudentA.full_name,
                        enabledNotifications: studentNotificationPreferences
                    });
                }

                // Process teacher notification
                if (teacherNotificationPreferences.includes("24")) {
                    logToFile(`Teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id}) has 24-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        teacherId: classItem.teacher_id,
                        teacherName: classItem.TeacherAs.full_name
                    });
                    
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "teacher", ["24", "4", "1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 24-hour reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name
                        });

                        const teacherTime = moment(classItem.meeting_start)
                            .tz(classItem.TeacherAs.timezone || 'UTC')
                            .format("HH:mm");

                        // Prepare notification parameters for teacher
                        const notifyOptions = {
                            'student.name': classItem.TeacherAs.full_name,
                            'time.time': teacherTime,
                            'link.link': classItem.join_url || '-',
                            'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                            'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 24-hour WhatsApp reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name,
                            templateName: "regular_class_reminders_24",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_24",
                            stringNotifyOptions,
                            classItem.teacher_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_24",
                            status: sent ? "delivered" : "failed",
                            type: "24",
                            related: "teacher"
                        });
                        
                        logToFile(`24-hour reminder result for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id,
                            templateName: "regular_class_reminders_24"
                        });
                    } else {
                        logToFile(`24-hour reminder already delivered for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name
                        });
                    }
                } else {
                    logToFile(`Teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id}) does not have 24-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        teacherId: classItem.teacher_id,
                        teacherName: classItem.TeacherAs.full_name,
                        enabledNotifications: teacherNotificationPreferences
                    });
                }
            } catch (error) {
                logToFile(`Error processing 24-hour reminder for class ID ${classItem.id}`, 'error', {
                    classId: classItem.id,
                    studentId: classItem.student_id,
                    teacherId: classItem.teacher_id,
                    studentName: classItem.StudentA?.full_name,
                    teacherName: classItem.TeacherAs?.full_name,
                    error: error.message,
                    stack: error.stack
                });
                continue;
            }
        }
        
        const duration = Date.now() - jobStartTime;
        logToFile(`Completed regular class 24-hour reminders process in ${duration}ms`, 'info', {
            processedClasses: classes.length,
            duration: `${duration}ms`
        });
        
    } catch (error) {
        logToFile(`Unhandled error in processRegularReminders24Hours`, 'error', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isJobRunning['24hour'] = false;
    }
}

/**
 * Process regular class reminders for 4 hours before class
 */
async function processRegularReminders4Hours() {
    const jobStartTime = Date.now();
    logToFile('Starting regular class 4-hour reminders process');
    
    if (isJobRunning['4hour']) {
        logToFile('Previous 4-hour job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning['4hour'] = true;
    
    try {
        const startTime = moment().add(3, 'hours').add(59, 'minutes').toDate();
        const endTime = moment().add(4, 'hours').add(1, 'minute').toDate();
        
        logToFile('Searching for classes in 4-hour time window', 'info', {
            searchWindow: {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: new Date().toISOString()
            }
        });

        // Find classes that are pending and starting in ~4 hours
        const classes = await Class.findAll({
            where: {
                status: 'pending',
                is_regular_hide: 0,
                student_id: {
                    [Op.not]: null
                },
                meeting_start: {
                    [Op.between]: [startTime, endTime]
                }
            },
            include: [
                {
                    model: User,
                    as: 'StudentA',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'mobile', 'country_code', 'language'],
                    required: true
                },
                {
                    model: User,
                    as: 'TeacherAs',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
                    required: true
                }
            ]
        });
        
        logToFile(`Found ${classes.length} regular classes for 4-hour reminders`, 'info', {
            classCount: classes.length,
            classIds: classes.map(c => c.id)
        });

        if (classes.length === 0) {
            logToFile('No classes found for 4-hour reminders, exiting process', 'info');
            return;
        }

        for (const classItem of classes) {
            try {
                logToFile(`Processing 4-hour reminder for class ${classItem.id}`, 'info', {
                    classId: classItem.id,
                    meetingStart: classItem.meeting_start,
                    studentId: classItem.student_id,
                    teacherId: classItem.teacher_id,
                    studentName: classItem.StudentA?.full_name,
                    teacherName: classItem.TeacherAs?.full_name
                });

                // Skip if no notification preferences set
                if (!classItem.StudentA.lesson_notifications || !classItem.TeacherAs.lesson_notifications) {
                    logToFile(`Class ID ${classItem.id} has incomplete notification preferences, skipping`, 'warn', {
                        classId: classItem.id,
                        studentNotifications: classItem.StudentA.lesson_notifications,
                        teacherNotifications: classItem.TeacherAs.lesson_notifications
                    });
                    continue;
                }
                
                // Parse notification preferences
                let studentNotificationPreferences = [];
                let teacherNotificationPreferences = [];
                
                try {
                    studentNotificationPreferences = JSON.parse(classItem.StudentA.lesson_notifications || '[]');
                    teacherNotificationPreferences = JSON.parse(classItem.TeacherAs.lesson_notifications || '[]');
                    
                    logToFile(`Parsed notification preferences for class ${classItem.id}`, 'info', {
                        classId: classItem.id,
                        studentPreferences: studentNotificationPreferences,
                        teacherPreferences: teacherNotificationPreferences
                    });
                } catch (parseError) {
                    logToFile(`Error parsing notification preferences for class ${classItem.id}`, 'error', {
                        classId: classItem.id,
                        error: parseError.message
                    });
                    continue;
                }
                
                // Process student notification
                if (studentNotificationPreferences.includes("4")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "student", ["4", "1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 4-hour reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name
                        });

                        // Format time based on student's timezone
                        const studentTime = moment(classItem.meeting_start)
                            .tz(classItem.StudentA.timezone || 'UTC')
                            .format("HH:mm");
                        
                        // Prepare notification parameters
                        const notifyOptions = {
                            'student.name': classItem.StudentA.full_name,
                            'time.time': studentTime,
                            'link.link': classItem.join_url || '-',
                            'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                            'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 4-hour WhatsApp reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            templateName: "regular_class_reminders_4",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_4",
                            stringNotifyOptions,
                            classItem.student_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_4",
                            status: sent ? "delivered" : "failed",
                            type: "4",
                            related: "student"
                        });
                        
                        logToFile(`4-hour reminder result for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Student ${classItem.StudentA.full_name} (ID: ${classItem.student_id}) does not have 4-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        enabledNotifications: studentNotificationPreferences
                    });
                }

                // Process teacher notification
                if (teacherNotificationPreferences.includes("4")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "teacher", ["4", "1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 4-hour reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name
                        });

                        // Get class duration from subscription
                        let lessonDuration = '60'; // Default duration
                        
                        // Get subscription details directly instead of using include
                        const subscription = await UserSubscriptionDetails.findOne({
                            where: {
                                user_id: classItem.student_id,
                                status: 'active'
                            },
                            order: [['created_at', 'DESC']]
                        });
                        
                        if (subscription && subscription.lesson_min) {
                            lessonDuration = subscription.lesson_min.toString();
                        }
                        
                        logToFile(`Retrieved lesson duration for class ${classItem.id}`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            lessonDuration,
                            subscriptionFound: !!subscription
                        });
                        
                        // Format time based on teacher's timezone
                        const teacherTime = moment(classItem.meeting_start)
                            .tz(classItem.TeacherAs.timezone || 'UTC')
                            .format("HH:mm");
                        
                        // Prepare notification parameters for teacher
                        const notifyOptions = {
                            'instructor.name': classItem.TeacherAs.full_name,
                            'student.name': classItem.StudentA.full_name,
                            'time.date': teacherTime,
                            'time.duration': lessonDuration
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 4-hour WhatsApp reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            templateName: "regular_class_reminders_for_teacher_4",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_for_teacher_4",
                            stringNotifyOptions,
                            classItem.teacher_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_for_teacher_4",
                            status: sent ? "delivered" : "failed",
                            type: "4",
                            related: "teacher"
                        });
                        
                        logToFile(`4-hour reminder result for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id}) does not have 4-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        teacherId: classItem.teacher_id,
                        enabledNotifications: teacherNotificationPreferences
                    });
                }
            } catch (error) {
                logToFile(`Error processing 4-hour reminder for class ID ${classItem.id}`, 'error', {
                    classId: classItem.id,
                    error: error.message,
                    stack: error.stack
                });
                continue;
            }
        }
        
        const duration = Date.now() - jobStartTime;
        logToFile(`Completed regular class 4-hour reminders process in ${duration}ms`, 'info', {
            processedClasses: classes.length,
            duration: `${duration}ms`
        });
        
    } catch (error) {
        logToFile(`Unhandled error in processRegularReminders4Hours`, 'error', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isJobRunning['4hour'] = false;
    }
}

/**
 * Process regular class reminders for 1 hour before class
 */
async function processRegularReminders1Hour() {
    const jobStartTime = Date.now();
    logToFile('Starting regular class 1-hour reminders process');
    
    if (isJobRunning['1hour']) {
        logToFile('Previous 1-hour job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning['1hour'] = true;
    
    try {
        const startTime = moment().add(59, 'minutes').toDate();
        const endTime = moment().add(1, 'hour').add(1, 'minute').toDate();
        
        logToFile('Searching for classes in 1-hour time window', 'info', {
            searchWindow: {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: new Date().toISOString()
            }
        });

        // Find classes that are pending and starting in ~1 hour
        const classes = await Class.findAll({
            where: {
                status: 'pending',
                is_regular_hide: 0,
                student_id: {
                    [Op.not]: null
                },
                meeting_start: {
                    [Op.between]: [startTime, endTime]
                }
            },
            include: [
                {
                    model: User,
                    as: 'StudentA',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'language', 'mobile', 'country_code'],
                    required: true
                },
                {
                    model: User,
                    as: 'TeacherAs',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
                    required: true
                }
            ]
        });
        
        logToFile(`Found ${classes.length} regular classes for 1-hour reminders`, 'info', {
            classCount: classes.length,
            classIds: classes.map(c => c.id)
        });

        if (classes.length === 0) {
            logToFile('No classes found for 1-hour reminders, exiting process', 'info');
            return;
        }

        for (const classItem of classes) {
            try {
                logToFile(`Processing 1-hour reminder for class ${classItem.id}`, 'info', {
                    classId: classItem.id,
                    meetingStart: classItem.meeting_start,
                    studentId: classItem.student_id,
                    teacherId: classItem.teacher_id,
                    studentName: classItem.StudentA?.full_name,
                    teacherName: classItem.TeacherAs?.full_name,
                    studentLanguage: classItem.StudentA?.language
                });

                // Skip if no notification preferences set
                if (!classItem.StudentA.lesson_notifications || !classItem.TeacherAs.lesson_notifications) {
                    logToFile(`Class ID ${classItem.id} has incomplete notification preferences, skipping`, 'warn', {
                        classId: classItem.id,
                        studentNotifications: classItem.StudentA.lesson_notifications,
                        teacherNotifications: classItem.TeacherAs.lesson_notifications
                    });
                    continue;
                }
                
                // Parse notification preferences
                let studentNotificationPreferences = [];
                let teacherNotificationPreferences = [];
                
                try {
                    studentNotificationPreferences = JSON.parse(classItem.StudentA.lesson_notifications || '[]');
                    teacherNotificationPreferences = JSON.parse(classItem.TeacherAs.lesson_notifications || '[]');
                    
                    logToFile(`Parsed notification preferences for class ${classItem.id}`, 'info', {
                        classId: classItem.id,
                        studentPreferences: studentNotificationPreferences,
                        teacherPreferences: teacherNotificationPreferences
                    });
                } catch (parseError) {
                    logToFile(`Error parsing notification preferences for class ${classItem.id}`, 'error', {
                        classId: classItem.id,
                        error: parseError.message
                    });
                    continue;
                }
                
                // Process student notification
                if (studentNotificationPreferences.includes("1")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "student", ["1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 1-hour reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name,
                            studentLanguage: classItem.StudentA.language
                        });

                        // Prepare notification parameters
                        let notifyOptions;
                        
                        // If student language is Hebrew, format without time
                        if (classItem.StudentA.language === 'HE') {
                            logToFile(`Using Hebrew format (no time) for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                                classId: classItem.id,
                                studentId: classItem.student_id,
                                language: classItem.StudentA.language
                            });

                            notifyOptions = {
                                'student.name': classItem.StudentA.full_name,
                                'link.link': classItem.join_url || '-',
                                'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                                'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                            };
                        } else {
                            // Format time based on student's timezone
                            const studentTime = moment(classItem.meeting_start)
                                .tz(classItem.StudentA.timezone || 'UTC')
                                .format("HH:mm");
                            
                            logToFile(`Using standard format with time for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                                classId: classItem.id,
                                studentId: classItem.student_id,
                                language: classItem.StudentA.language,
                                formattedTime: studentTime,
                                timezone: classItem.StudentA.timezone
                            });
                            
                            notifyOptions = {
                                'student.name': classItem.StudentA.full_name,
                                'time.time': studentTime,
                                'link.link': classItem.join_url || '-',
                                'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                                'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                            };
                        }
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 1-hour WhatsApp reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            templateName: "regular_class_reminders_1",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_1",
                            stringNotifyOptions,
                            classItem.student_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_1",
                            status: sent ? "delivered" : "failed",
                            type: "1",
                            related: "student"
                        });
                        
                        logToFile(`1-hour reminder result for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Student ${classItem.StudentA.full_name} (ID: ${classItem.student_id}) does not have 1-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        enabledNotifications: studentNotificationPreferences
                    });
                }

                // Process teacher notification
                if (teacherNotificationPreferences.includes("1")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "teacher", ["1", "30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 1-hour reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name
                        });

                        // Get subscription details to get lesson duration
                        const subscription = await UserSubscriptionDetails.findOne({
                            where: {
                                user_id: classItem.student_id,
                                status: 'active'
                            },
                            order: [['created_at', 'DESC']]
                        });
                        
                        const lessonDuration = subscription?.lesson_min || '60';
                        
                        logToFile(`Retrieved lesson duration for teacher reminder in class ${classItem.id}`, 'info', {
                            classId: classItem.id,
                            lessonDuration,
                            subscriptionFound: !!subscription
                        });
                        
                        // Prepare notification parameters for teacher
                        const notifyOptions = {
                            'instructor.name': classItem.TeacherAs.full_name,
                            'student.name': classItem.StudentA.full_name,
                            'time.duration': lessonDuration.toString()
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 1-hour WhatsApp reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            templateName: "regular_class_reminders_teacher_1",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_teacher_1",
                            stringNotifyOptions,
                            classItem.teacher_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_teacher_1",
                            status: sent ? "delivered" : "failed",
                            type: "1",
                            related: "teacher"
                        });
                        
                        logToFile(`1-hour reminder result for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id}) does not have 1-hour notifications enabled`, 'info', {
                        classId: classItem.id,
                        teacherId: classItem.teacher_id,
                        enabledNotifications: teacherNotificationPreferences
                    });
                }
            } catch (error) {
                logToFile(`Error processing 1-hour reminder for class ID ${classItem.id}`, 'error', {
                    classId: classItem.id,
                    error: error.message,
                    stack: error.stack
                });
                continue;
            }
        }
        
        const duration = Date.now() - jobStartTime;
        logToFile(`Completed regular class 1-hour reminders process in ${duration}ms`, 'info', {
            processedClasses: classes.length,
            duration: `${duration}ms`
        });
        
    } catch (error) {
        logToFile(`Unhandled error in processRegularReminders1Hour`, 'error', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isJobRunning['1hour'] = false;
    }
}

/**
 * Process regular class reminders for 30 minutes before class
 */
async function processRegularReminders30Min() {
    const jobStartTime = Date.now();
    logToFile('Starting regular class 30-minute reminders process');
    
    if (isJobRunning['30min']) {
        logToFile('Previous 30-minute job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning['30min'] = true;
    
    try {
        const startTime = moment().add(29, 'minutes').toDate();
        const endTime = moment().add(31, 'minutes').toDate();
        
        logToFile('Searching for classes in 30-minute time window', 'info', {
            searchWindow: {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: new Date().toISOString()
            }
        });

        // Find classes that are pending and starting in ~30 minutes
        const classes = await Class.findAll({
            where: {
                status: 'pending',
                is_regular_hide: 0,
                student_id: {
                    [Op.not]: null
                },
                meeting_start: {
                    [Op.between]: [startTime, endTime]
                }
            },
            include: [
                {
                    model: User,
                    as: 'StudentA',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'mobile', 'country_code'],
                    required: true
                },
                {
                    model: User,
                    as: 'TeacherAs',
                    attributes: ['id', 'full_name', 'timezone', 'lesson_notifications', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code'],
                    required: true
                }
            ]
        });
        
        logToFile(`Found ${classes.length} regular classes for 30-minute reminders`, 'info', {
            classCount: classes.length,
            classIds: classes.map(c => c.id)
        });

        if (classes.length === 0) {
            logToFile('No classes found for 30-minute reminders, exiting process', 'info');
            return;
        }

        for (const classItem of classes) {
            try {
                logToFile(`Processing 30-minute reminder for class ${classItem.id}`, 'info', {
                    classId: classItem.id,
                    meetingStart: classItem.meeting_start,
                    studentId: classItem.student_id,
                    teacherId: classItem.teacher_id,
                    studentName: classItem.StudentA?.full_name,
                    teacherName: classItem.TeacherAs?.full_name,
                    adminUrl: classItem.admin_url ? 'Present' : 'Missing'
                });

                // Skip if no notification preferences set
                if (!classItem.StudentA.lesson_notifications || !classItem.TeacherAs.lesson_notifications) {
                    logToFile(`Class ID ${classItem.id} has incomplete notification preferences, skipping`, 'warn', {
                        classId: classItem.id,
                        studentNotifications: classItem.StudentA.lesson_notifications,
                        teacherNotifications: classItem.TeacherAs.lesson_notifications
                    });
                    continue;
                }
                
                // Parse notification preferences
                let studentNotificationPreferences = [];
                let teacherNotificationPreferences = [];
                
                try {
                    studentNotificationPreferences = JSON.parse(classItem.StudentA.lesson_notifications || '[]');
                    teacherNotificationPreferences = JSON.parse(classItem.TeacherAs.lesson_notifications || '[]');
                    
                    logToFile(`Parsed notification preferences for class ${classItem.id}`, 'info', {
                        classId: classItem.id,
                        studentPreferences: studentNotificationPreferences,
                        teacherPreferences: teacherNotificationPreferences
                    });
                } catch (parseError) {
                    logToFile(`Error parsing notification preferences for class ${classItem.id}`, 'error', {
                        classId: classItem.id,
                        error: parseError.message
                    });
                    continue;
                }
                
                // Process student notification
                if (studentNotificationPreferences.includes("30")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "student", ["30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 30-minute reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            studentName: classItem.StudentA.full_name
                        });

                        // Format time based on student's timezone
                        const studentTime = moment(classItem.meeting_start)
                            .tz(classItem.StudentA.timezone || 'UTC')
                            .format("HH:mm");
                        
                        // Prepare notification parameters
                        const notifyOptions = {
                            'student.name': classItem.StudentA.full_name,
                            'link.link': classItem.join_url || '-',
                            'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                            'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-'
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 30-minute WhatsApp reminder for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, 'info', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            templateName: "regular_class_reminders_30",
                            notifyOptions: stringNotifyOptions
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_30",
                            stringNotifyOptions,
                            classItem.student_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_30",
                            status: sent ? "delivered" : "failed",
                            type: "30",
                            related: "student"
                        });
                        
                        logToFile(`30-minute reminder result for student ${classItem.StudentA.full_name} (ID: ${classItem.student_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            studentId: classItem.student_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Student ${classItem.StudentA.full_name} (ID: ${classItem.student_id}) does not have 30-minute notifications enabled`, 'info', {
                        classId: classItem.id,
                        studentId: classItem.student_id,
                        enabledNotifications: studentNotificationPreferences
                    });
                }

                // Process teacher notification
                if (teacherNotificationPreferences.includes("30")) {
                    const hasDelivered = await hasDeliveredReminder(classItem.id, "teacher", ["30"]);
                    
                    if (!hasDelivered) {
                        logToFile(`Preparing 30-minute reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            teacherName: classItem.TeacherAs.full_name
                        });

                        // Format time based on teacher's timezone
                        const teacherTime = moment(classItem.meeting_start)
                            .tz(classItem.TeacherAs.timezone || 'UTC')
                            .format("HH:mm");
                        
                        // Prepare notification parameters for teacher
                        // Notice that in the PHP code these are intentionally switched
                        const notifyOptions = {
                            'student.name': classItem.TeacherAs.full_name,
                            'link.link': classItem.join_url || '-',
                            'meeting.id': classItem.TeacherAs.add_zoom_link_meeting_id || '-',
                            'access.code': classItem.TeacherAs.add_zoom_link_access_code || '-',
                        };
                        
                        // Ensure all values are strings
                        const stringNotifyOptions = ensureStringValues(notifyOptions);
                        
                        logToFile(`Sending 30-minute WhatsApp reminder for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, 'info', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            templateName: "regular_class_reminders_30",
                            notifyOptions: stringNotifyOptions,
                            note: "Names are intentionally switched as per original PHP code"
                        });
                        
                        // Send the notification
                        const sent = await whatsappReminderAddClass(
                            "regular_class_reminders_30",
                            stringNotifyOptions,
                            classItem.teacher_id
                        );
                        
                        // Record the reminder in the database
                        const reminderRecord = await ClassReminder.create({
                            lesson_id: classItem.id,
                            notif_key: "regular_class_reminders_30",
                            status: sent ? "delivered" : "failed",
                            type: "30",
                            related: "teacher"
                        });
                        
                        logToFile(`30-minute reminder result for teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id})`, sent ? 'info' : 'error', {
                            classId: classItem.id,
                            teacherId: classItem.teacher_id,
                            reminderSent: sent,
                            reminderRecordId: reminderRecord.id
                        });
                    }
                } else {
                    logToFile(`Teacher ${classItem.TeacherAs.full_name} (ID: ${classItem.teacher_id}) does not have 30-minute notifications enabled`, 'info', {
                        classId: classItem.id,
                        teacherId: classItem.teacher_id,
                        enabledNotifications: teacherNotificationPreferences
                    });
                }
            } catch (error) {
                logToFile(`Error processing 30-minute reminder for class ID ${classItem.id}`, 'error', {
                    classId: classItem.id,
                    error: error.message,
                    stack: error.stack
                });
                continue;
            }
        }
        
        const duration = Date.now() - jobStartTime;
        logToFile(`Completed regular class 30-minute reminders process in ${duration}ms`, 'info', {
            processedClasses: classes.length,
            duration: `${duration}ms`
        });
        
    } catch (error) {
        logToFile(`Unhandled error in processRegularReminders30Min`, 'error', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isJobRunning['30min'] = false;
    }
}

// Schedule all cron jobs to run every minute
cron.schedule('* * * * *', processRegularReminders24Hours); // Run every minute
cron.schedule('* * * * *', processRegularReminders4Hours);  // Run every minute
cron.schedule('* * * * *', processRegularReminders1Hour);   // Run every minute
cron.schedule('* * * * *', processRegularReminders30Min);   // Run every minute

// Export functions for testing or manual execution
module.exports = {
    processRegularReminders24Hours,
    processRegularReminders4Hours,
    processRegularReminders1Hour,
    processRegularReminders30Min
};