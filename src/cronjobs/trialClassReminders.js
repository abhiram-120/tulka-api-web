const cron = require('node-cron');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Import models
const TrialClassRegistration = require('../models/trialClassRegistration');
const ClassReminder = require('../models/classReminder');
const Lesson = require('../models/classes');
const User = require('../models/users');

// Import notification helper
const { whatsappReminderTrailClass } = require('./reminder');

// Define class status enum values based on actual database values
const CLASS_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    CONVERTED: 'converted'
};

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
    const logFile = path.join(logsDir, `trial-class-reminders-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry);

    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

// Helper function to check if a reminder has been delivered
async function hasDeliveredReminder(lessonId, related, type) {
    const reminders = await ClassReminder.findAll({
        where: {
            lesson_id: lessonId,
            related: related,
            type: type,
            status: "delivered"
        }
    });

    return reminders.length > 0;
}

// Flag to prevent concurrent executions
let isJobRunning = {
    '24hour': false,
    '4hour': false,
    '1hour': false,
    'status': false
};

/**
 * Process trial class reminders for 4 hours before class
 */
async function processTrialReminders4Hours() {
    logToFile('Starting trial class 4-hour reminders process');

    if (isJobRunning['4hour']) {
        logToFile('Previous 4-hour job is still running, skipping this execution', 'warn');
        return;
    }

    isJobRunning['4hour'] = true;

    try {
        // Find trial classes that are pending or confirmed and starting in ~4 hours
        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                status: {
                    [Op.in]: [CLASS_STATUS.PENDING, CLASS_STATUS.CONFIRMED]
                },
                meeting_start: {
                    [Op.between]: [
                        moment().add(3, 'hours').add(59, 'minutes').toDate(),
                        moment().add(4, 'hours').add(1, 'minute').toDate()
                    ]
                }
            }
        });

        logToFile(`Found ${trialClasses.length} trial classes for 4-hour reminders`);

        for (const trialClass of trialClasses) {
            try {
                // Skip if no notification preferences set
                if (!trialClass.notification_preferences) {
                    logToFile(`Trial class ID ${trialClass.id} has no notification preferences, skipping`, 'warn');
                    continue;
                }

                // Parse notification preferences
                const notificationPrefs = JSON.parse(trialClass.notification_preferences || '{}');
                
                // Check if WhatsApp notifications are enabled
                if (!notificationPrefs.whatsapp) {
                    logToFile(`WhatsApp notifications disabled for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get the associated lesson with correct alias
                const lesson = await Lesson.findOne({
                    where: {
                        demo_class_id: trialClass.id,
                        booked_by: {
                            [Op.ne]: 'Sales Person'
                        }
                    },
                    include: [
                        {
                            model: User,
                            as: 'Teacher', // Make sure this matches your model association alias
                            attributes: ['id', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                        }
                    ]
                });

                if (!lesson) {
                    logToFile(`No lesson found for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get WhatsApp notification times preference
                const whatsappTimes = notificationPrefs.whatsapp_times || [];

                // Check if 4-hour notification is enabled and not already sent
                if (
                    whatsappTimes.includes("4h") &&
                    !(await hasDeliveredReminder(lesson.id, "student", "4"))
                ) {
                    // Prepare notification parameters
                    const notifyOptions = {
                        'student.name': trialClass.student_name,
                        'time.date': moment(trialClass.meeting_start).tz('Asia/Jerusalem').format("HH:mm"),
                        'link.link': lesson.join_url || '-',
                        'meeting.id': lesson.Teacher?.add_zoom_link_meeting_id || '-',
                        'access.code': lesson.Teacher?.add_zoom_link_access_code || '-'
                    };

                    // Student details for the notification
                    const studentDetails = {
                        mobile: trialClass.mobile,
                        email: trialClass.email,
                        full_name: trialClass.student_name,
                        country_code: trialClass.country_code,
                        language: trialClass.language || 'EN'
                    };

                    // Send the notification
                    const sent = await whatsappReminderTrailClass(
                        "trial_class_reminders_4",
                        notifyOptions,
                        studentDetails
                    );

                    // Record the reminder in the database
                    await ClassReminder.create({
                        lesson_id: lesson.id,
                        notif_key: "trial_class_reminders_4",
                        status: sent ? "delivered" : "failed",
                        type: "4",
                        related: "student"
                    });

                    logToFile(`Sent 4-hour reminder for trial class ID ${trialClass.id}, status: ${sent ? 'delivered' : 'failed'}`);
                }
            } catch (error) {
                logToFile(`Error processing 4-hour reminder for trial class ID ${trialClass.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }

        logToFile('Completed trial class 4-hour reminders process');

    } catch (error) {
        logToFile(`Unhandled error in processTrialReminders4Hours: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning['4hour'] = false;
    }
}

/**
 * Process trial class reminders for 24 hours before class
 */
async function processTrialReminders24Hours() {
    logToFile('Starting trial class 24-hour reminders process');

    if (isJobRunning['24hour']) {
        logToFile('Previous 24-hour job is still running, skipping this execution', 'warn');
        return;
    }

    isJobRunning['24hour'] = true;

    try {
        // Find trial classes that are pending or confirmed and starting in ~24 hours
        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                status: {
                    [Op.in]: [CLASS_STATUS.PENDING, CLASS_STATUS.CONFIRMED]
                },
                meeting_start: {
                    [Op.between]: [
                        moment().add(23, 'hours').add(59, 'minutes').toDate(),
                        moment().add(24, 'hours').add(1, 'minute').toDate()
                    ]
                }
            }
        });

        logToFile(`Found ${trialClasses.length} trial classes for 24-hour reminders`);

        for (const trialClass of trialClasses) {
            try {
                // Skip if no notification preferences set
                if (!trialClass.notification_preferences) {
                    logToFile(`Trial class ID ${trialClass.id} has no notification preferences, skipping`, 'warn');
                    continue;
                }

                // Parse notification preferences
                const notificationPrefs = JSON.parse(trialClass.notification_preferences || '{}');
                
                // Check if WhatsApp notifications are enabled
                if (!notificationPrefs.whatsapp) {
                    logToFile(`WhatsApp notifications disabled for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get the associated lesson with correct alias
                const lesson = await Lesson.findOne({
                    where: {
                        demo_class_id: trialClass.id,
                        booked_by: {
                            [Op.ne]: 'Sales Person'
                        }
                    },
                    include: [
                        {
                            model: User,
                            as: 'Teacher', // Make sure this matches your model association alias
                            attributes: ['id', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                        }
                    ]
                });

                if (!lesson) {
                    logToFile(`No lesson found for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get WhatsApp notification times preference
                const whatsappTimes = notificationPrefs.whatsapp_times || [];

                // Check if 24-hour notification is enabled and not already sent
                if (
                    whatsappTimes.includes("24h") &&
                    !(await hasDeliveredReminder(lesson.id, "student", "24"))
                ) {
                    // Prepare notification parameters
                    const notifyOptions = {
                        'student.name': trialClass.student_name,
                        'time.date': moment(trialClass.meeting_start).tz('Asia/Jerusalem').format("HH:mm"),
                        'link.link': lesson.join_url || '-',
                        'meeting.id': lesson.Teacher?.add_zoom_link_meeting_id || '-',
                        'access.code': lesson.Teacher?.add_zoom_link_access_code || '-'
                    };

                    // Student details for the notification
                    const studentDetails = {
                        mobile: trialClass.mobile,
                        email: trialClass.email,
                        full_name: trialClass.student_name,
                        country_code: trialClass.country_code,
                        language: trialClass.language || 'EN'
                    };

                    // Send the notification
                    const sent = await whatsappReminderTrailClass(
                        "trial_class_reminders_24",
                        notifyOptions,
                        studentDetails
                    );

                    // Record the reminder in the database
                    await ClassReminder.create({
                        lesson_id: lesson.id,
                        notif_key: "trial_class_reminders_24",
                        status: sent ? "delivered" : "failed",
                        type: "24",
                        related: "student"
                    });

                    logToFile(`Sent 24-hour reminder for trial class ID ${trialClass.id}, status: ${sent ? 'delivered' : 'failed'}`);
                }
            } catch (error) {
                logToFile(`Error processing 24-hour reminder for trial class ID ${trialClass.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }

        logToFile('Completed trial class 24-hour reminders process');

    } catch (error) {
        logToFile(`Unhandled error in processTrialReminders24Hours: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning['24hour'] = false;
    }
}

/**
 * Process trial class reminders for 1 hour before class
 */
async function processTrialReminders1Hour() {
    logToFile('Starting trial class 1-hour reminders process');

    if (isJobRunning['1hour']) {
        logToFile('Previous 1-hour job is still running, skipping this execution', 'warn');
        return;
    }

    isJobRunning['1hour'] = true;

    try {
        // Find trial classes that are pending or confirmed and starting in ~1 hour
        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                status: {
                    [Op.in]: [CLASS_STATUS.PENDING, CLASS_STATUS.CONFIRMED]
                },
                meeting_start: {
                    [Op.between]: [
                        moment().add(59, 'minutes').toDate(),
                        moment().add(1, 'hour').add(1, 'minute').toDate()
                    ]
                }
            }
        });

        logToFile(`Found ${trialClasses.length} trial classes for 1-hour reminders`);

        for (const trialClass of trialClasses) {
            try {
                // Skip if no notification preferences set
                if (!trialClass.notification_preferences) {
                    logToFile(`Trial class ID ${trialClass.id} has no notification preferences, skipping`, 'warn');
                    continue;
                }

                // Parse notification preferences
                const notificationPrefs = JSON.parse(trialClass.notification_preferences || '{}');
                
                // Check if WhatsApp notifications are enabled
                if (!notificationPrefs.whatsapp) {
                    logToFile(`WhatsApp notifications disabled for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get the associated lesson with correct alias
                const lesson = await Lesson.findOne({
                    where: {
                        demo_class_id: trialClass.id,
                        booked_by: {
                            [Op.ne]: 'Sales Person'
                        }
                    },
                    include: [
                        {
                            model: User,
                            as: 'Teacher', // Make sure this matches your model association alias
                            attributes: ['id', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                        }
                    ]
                });

                if (!lesson) {
                    logToFile(`No lesson found for trial class ID ${trialClass.id}, skipping`, 'warn');
                    continue;
                }

                // Get WhatsApp notification times preference
                const whatsappTimes = notificationPrefs.whatsapp_times || [];

                // Check if 1-hour notification is enabled and not already sent
                if (
                    whatsappTimes.includes("1h") &&
                    !(await hasDeliveredReminder(lesson.id, "student", "1"))
                ) {
                    // Prepare notification parameters
                    const notifyOptions = {
                        'student.name': trialClass.student_name,
                        'link.link': lesson.join_url || '-',
                        'meeting.id': lesson.Teacher?.add_zoom_link_meeting_id || '-',
                        'access.code': lesson.Teacher?.add_zoom_link_access_code || '-'
                    };

                    // Student details for the notification
                    const studentDetails = {
                        mobile: trialClass.mobile,
                        email: trialClass.email,
                        full_name: trialClass.student_name,
                        country_code: trialClass.country_code,
                        language: trialClass.language || 'EN'
                    };

                    // Send the notification
                    const sent = await whatsappReminderTrailClass(
                        "trial_class_reminders_1",
                        notifyOptions,
                        studentDetails
                    );

                    // Record the reminder in the database
                    await ClassReminder.create({
                        lesson_id: lesson.id,
                        notif_key: "trial_class_reminders_1",
                        status: sent ? "delivered" : "failed",
                        type: "1",
                        related: "student"
                    });

                    logToFile(`Sent 1-hour reminder for trial class ID ${trialClass.id}, status: ${sent ? 'delivered' : 'failed'}`);
                }
            } catch (error) {
                logToFile(`Error processing 1-hour reminder for trial class ID ${trialClass.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }

        logToFile('Completed trial class 1-hour reminders process');

    } catch (error) {
        logToFile(`Unhandled error in processTrialReminders1Hour: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning['1hour'] = false;
    }
}

/**
 * Process trial class started notifications
 */
async function processTrialClassStatus() {
    logToFile('Starting trial class status update and notifications process');

    if (isJobRunning['status']) {
        logToFile('Previous status update job is still running, skipping this execution', 'warn');
        return;
    }

    isJobRunning['status'] = true;

    try {
        // Find trial classes that should be in progress now
        // Exclude classes that are already cancelled, completed, or converted
        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                meeting_start: {
                    [Op.lte]: moment().toDate()
                },
                status: {
                    [Op.in]: [CLASS_STATUS.PENDING, CLASS_STATUS.CONFIRMED]
                }
            }
        });

        logToFile(`Found ${trialClasses.length} trial classes to check for status updates`);

        for (const trialClass of trialClasses) {
            try {
                const meetingStart = moment(trialClass.meeting_start);
                const meetingEnd = moment(trialClass.meeting_end || trialClass.meeting_start).add(1, 'hour'); // Default to 1 hour if no end time
                const now = moment();

                let statusUpdated = false;

                // Update status based on time
                if (meetingEnd.isSameOrBefore(now)) {
                    // Class has ended - update to COMPLETED
                    await trialClass.update({
                        status: CLASS_STATUS.COMPLETED,
                        updated_at: new Date()
                    });
                    statusUpdated = true;
                    logToFile(`Updated trial class ID ${trialClass.id} status to '${CLASS_STATUS.COMPLETED}'`);
                }
                // Only send notifications for classes that have started but aren't completed
                else if (meetingStart.isSameOrBefore(now)) {
                    // Skip if no notification preferences set
                    if (!trialClass.notification_preferences) {
                        logToFile(`Trial class ID ${trialClass.id} has no notification preferences, skipping`, 'warn');
                        continue;
                    }

                    // Parse notification preferences
                    const notificationPrefs = JSON.parse(trialClass.notification_preferences || '{}');
                    
                    // Check if WhatsApp notifications are enabled
                    if (!notificationPrefs.whatsapp) {
                        logToFile(`WhatsApp notifications disabled for trial class ID ${trialClass.id}, skipping`, 'warn');
                        continue;
                    }

                    // Get the associated lesson with correct alias
                    const lesson = await Lesson.findOne({
                        where: {
                            demo_class_id: trialClass.id,
                            booked_by: {
                                [Op.ne]: 'Sales Person'
                            }
                        },
                        include: [
                            {
                                model: User,
                                as: 'Teacher', // Make sure this matches your model association alias
                                attributes: ['id', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                            }
                        ]
                    });

                    if (!lesson) {
                        logToFile(`No lesson found for trial class ID ${trialClass.id}, skipping notification`, 'warn');
                        continue;
                    }

                    // Send started notification if notification not already sent
                    if (!(await hasDeliveredReminder(lesson.id, "student", "0"))) {
                        // Prepare notification parameters
                        const notifyOptions = {
                            'student.name': trialClass.student_name,
                            'link.link': lesson.join_url || '-',
                            'meeting.id': lesson.Teacher?.add_zoom_link_meeting_id || '-',
                            'access.code': lesson.Teacher?.add_zoom_link_access_code || '-'
                        };

                        // Student details for the notification
                        const studentDetails = {
                            mobile: trialClass.mobile,
                            email: trialClass.email,
                            full_name: trialClass.student_name,
                            country_code: trialClass.country_code,
                            language: trialClass.language || 'EN'
                        };

                        // Send the notification
                        const sent = await whatsappReminderTrailClass(
                            "trial_class_lesson_started",
                            notifyOptions,
                            studentDetails
                        );

                        // Record the reminder in the database
                        await ClassReminder.create({
                            lesson_id: lesson.id,
                            notif_key: "trial_class_lesson_started",
                            status: sent ? "delivered" : "failed",
                            type: "0",
                            related: "student"
                        });

                        logToFile(`Sent class started notification for trial class ID ${trialClass.id}, status: ${sent ? 'delivered' : 'failed'}`);
                    }
                }
            } catch (error) {
                logToFile(`Error processing trial class ID ${trialClass.id} for status update: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }

        logToFile('Completed trial class status update and notifications process');

    } catch (error) {
        logToFile(`Unhandled error in processTrialClassStatus: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning['status'] = false;
    }
}

// Schedule cron jobs for different reminder timeframes with staggered execution
cron.schedule('* * * * *', processTrialReminders24Hours);
cron.schedule('* * * * *', processTrialReminders4Hours);
cron.schedule('* * * * *', processTrialReminders1Hour);
cron.schedule('* * * * *', processTrialClassStatus);

// Export functions for testing or manual execution
module.exports = {
    processTrialReminders24Hours,
    processTrialReminders4Hours,
    processTrialReminders1Hour,
    processTrialClassStatus
};