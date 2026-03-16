/**
 * Engagement Reminders Cron Job
 * 
 * Runs every 15 minutes and processes all active notification rules.
 * For each rule, finds matching students and sends notifications
 * via the EngagementNotificationService (which handles frequency limits,
 * quiet hours, and deduplication).
 * 
 * This is the HEART of the engagement system.
 */
const cron = require('node-cron');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Models
const NotificationRule = require('../models/NotificationRule');
const NotificationLog = require('../models/NotificationLog');
const StudentActivity = require('../models/StudentActivity');
const User = require('../models/users');
const Class = require('../models/classes');
const LessonFeedback = require('../models/lessonFeedback');
const Homework = require('../models/homework');

// Service
const EngagementNotificationService = require('../services/engagementNotificationService');
const engagementService = new EngagementNotificationService();

// Logging
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function logToFile(message, type = 'info', additionalData = null) {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0];
    const logFile = path.join(logsDir, `engagement-reminders-${logDate}.log`);

    let logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    if (additionalData) {
        logEntry += `\nData: ${JSON.stringify(additionalData, null, 2)}`;
    }
    logEntry += '\n';

    fs.appendFileSync(logFile, logEntry);

    if (type === 'error') {
        console.error(`[ENGAGEMENT-CRON] ${message}`);
    } else {
        console.log(`[ENGAGEMENT-CRON] ${message}`);
    }
}

// Prevent concurrent runs
let isRunning = false;

// ============================================================
// TRIGGER PROCESSORS
// Each function finds students that match a trigger type
// ============================================================

/**
 * Find students who had a lesson end X hours ago and haven't viewed feedback
 */
async function findStudentsForPostLessonFeedback(rule) {
    try {
        const delayHours = rule.delay_hours || 2;
        const windowStart = moment().subtract(delayHours + 0.5, 'hours').toDate(); // +30min window
        const windowEnd = moment().subtract(delayHours - 0.5, 'hours').toDate();   // -30min window

        // Find classes that ended in the target window
        const recentClasses = await Class.findAll({
            where: {
                meeting_end: { [Op.between]: [windowStart, windowEnd] },
                status: 'completed'
            },
            attributes: ['id', 'student_id', 'teacher_id', 'meeting_end'],
            raw: true
        });

        if (recentClasses.length === 0) return [];

        const studentIds = [...new Set(recentClasses.map(c => c.student_id))];
        const classIds = recentClasses.map(c => c.id);

        // Find which of these classes have unviewed feedback
        // (feedback exists but student hasn't viewed it — we check via student_activity)
        const feedbackExists = await LessonFeedback.findAll({
            where: { lesson_id: { [Op.in]: classIds } },
            attributes: ['lesson_id', 'student_id'],
            raw: true
        });

        if (feedbackExists.length === 0) return [];

        const studentsWithFeedback = [...new Set(feedbackExists.map(f => f.student_id))];

        // Check student_activity to see who hasn't viewed feedback recently
        const activities = await StudentActivity.findAll({
            where: {
                student_id: { [Op.in]: studentsWithFeedback },
                [Op.or]: [
                    { last_feedback_viewed: null },
                    { last_feedback_viewed: { [Op.lt]: windowStart } }
                ]
            },
            attributes: ['student_id'],
            raw: true
        });

        const eligibleStudentIds = activities.map(a => a.student_id);

        // If there's no activity record, the student definitely hasn't viewed feedback
        const studentsWithNoActivity = studentsWithFeedback.filter(id => {
            return !activities.find(a => a.student_id === id) && eligibleStudentIds.indexOf(id) === -1;
        });

        const allEligible = [...new Set([...eligibleStudentIds, ...studentsWithNoActivity])];

        if (allEligible.length === 0) return [];

        return await User.findAll({
            where: { id: { [Op.in]: allEligible }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForPostLessonFeedback', 'error', { error: error.message });
        return [];
    }
}

/**
 * Find students who had a lesson end X hours ago and haven't practiced
 */
async function findStudentsForPostLessonPractice(rule) {
    try {
        const delayHours = rule.delay_hours || 4;
        const windowStart = moment().subtract(delayHours + 0.5, 'hours').toDate();
        const windowEnd = moment().subtract(delayHours - 0.5, 'hours').toDate();

        const recentClasses = await Class.findAll({
            where: {
                meeting_end: { [Op.between]: [windowStart, windowEnd] },
                status: 'completed'
            },
            attributes: ['id', 'student_id'],
            raw: true
        });

        if (recentClasses.length === 0) return [];

        const studentIds = [...new Set(recentClasses.map(c => c.student_id))];

        // Check who hasn't practiced since their lesson ended
        const activities = await StudentActivity.findAll({
            where: {
                student_id: { [Op.in]: studentIds },
                [Op.or]: [
                    { last_practice: null },
                    { last_practice: { [Op.lt]: windowStart } },
                    { last_game_played: null },
                    { last_game_played: { [Op.lt]: windowStart } }
                ]
            },
            attributes: ['student_id'],
            raw: true
        });

        const eligibleIds = activities.map(a => a.student_id);

        // Students with no activity record at all
        const studentsWithNoRecord = studentIds.filter(id =>
            !activities.find(a => a.student_id === id) && !eligibleIds.includes(id)
        );

        const allEligible = [...new Set([...eligibleIds, ...studentsWithNoRecord])];

        if (allEligible.length === 0) return [];

        return await User.findAll({
            where: { id: { [Op.in]: allEligible }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForPostLessonPractice', 'error', { error: error.message });
        return [];
    }
}

/**
 * Find students who haven't opened the app for X days
 */
async function findStudentsForInactivity(rule) {
    try {
        const delayDays = rule.delay_days || 3;
        const cutoffDate = moment().subtract(delayDays, 'days').toDate();

        // Find active students with subscriptions who haven't been active
        const inactiveActivities = await StudentActivity.findAll({
            where: {
                [Op.or]: [
                    { last_app_open: null },
                    { last_app_open: { [Op.lt]: cutoffDate } }
                ]
            },
            attributes: ['student_id'],
            raw: true
        });

        const inactiveIds = inactiveActivities.map(a => a.student_id);

        if (inactiveIds.length === 0) {
            // Also check for students who have NO activity record at all
            // These are students who never opened the app
            const allStudents = await User.findAll({
                where: { role_name: 'user' },
                attributes: ['id'],
                raw: true
            });
            
            const allStudentIds = allStudents.map(s => s.id);
            const hasActivity = await StudentActivity.findAll({
                where: { student_id: { [Op.in]: allStudentIds } },
                attributes: ['student_id'],
                raw: true
            });
            
            const hasActivityIds = hasActivity.map(a => a.student_id);
            const noActivityIds = allStudentIds.filter(id => !hasActivityIds.includes(id));
            
            if (noActivityIds.length === 0) return [];
            
            return await User.findAll({
                where: { id: { [Op.in]: noActivityIds.slice(0, 100) }, role_name: 'user' },
                attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
            });
        }

        return await User.findAll({
            where: { id: { [Op.in]: inactiveIds.slice(0, 100) }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForInactivity', 'error', { error: error.message });
        return [];
    }
}

/**
 * Find students who have unviewed teacher feedback (older than X hours)
 */
async function findStudentsForUnviewedFeedback(rule) {
    try {
        const delayHours = rule.delay_hours || 24;
        const cutoffDate = moment().subtract(delayHours, 'hours').toDate();
        const recentCutoff = moment().subtract(delayHours - 1, 'hours').toDate(); // 1hr window

        // Find feedback created in the window (delayHours ago ± window)
        const feedback = await LessonFeedback.findAll({
            attributes: ['student_id'],
            where: {
                id: {
                    [Op.gt]: 0 // just ensure it exists
                }
            },
            raw: true
        });

        if (feedback.length === 0) return [];

        const studentIds = [...new Set(feedback.map(f => f.student_id))];

        // Check which of these students haven't viewed feedback
        const activities = await StudentActivity.findAll({
            where: {
                student_id: { [Op.in]: studentIds },
                [Op.or]: [
                    { last_feedback_viewed: null },
                    { last_feedback_viewed: { [Op.lt]: cutoffDate } }
                ]
            },
            attributes: ['student_id'],
            raw: true
        });

        const eligibleIds = activities.map(a => a.student_id);
        if (eligibleIds.length === 0) return [];

        return await User.findAll({
            where: { id: { [Op.in]: eligibleIds.slice(0, 100) }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForUnviewedFeedback', 'error', { error: error.message });
        return [];
    }
}

/**
 * Find students who have new practice available (homework assigned X hours ago)
 */
async function findStudentsForNewPractice(rule) {
    try {
        const delayHours = rule.delay_hours || 1;
        const windowStart = moment().subtract(delayHours + 0.5, 'hours').toDate();
        const windowEnd = moment().subtract(delayHours - 0.5, 'hours').toDate();

        const recentHomework = await Homework.findAll({
            where: {
                created_at: { [Op.between]: [windowStart, windowEnd] },
                status: { [Op.ne]: 'completed' }
            },
            attributes: ['student_id'],
            raw: true
        });

        if (recentHomework.length === 0) return [];

        const studentIds = [...new Set(recentHomework.map(h => h.student_id))];

        return await User.findAll({
            where: { id: { [Op.in]: studentIds }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForNewPractice', 'error', { error: error.message });
        return [];
    }
}

/**
 * Find students who haven't practiced vocabulary from their last lesson
 */
async function findStudentsForUnpracticedVocab(rule) {
    try {
        const delayDays = rule.delay_days || 2;
        const cutoffDate = moment().subtract(delayDays, 'days').toDate();
        const recentCutoff = moment().subtract(delayDays - 1, 'days').toDate();

        // Find students who had lessons recently but haven't practiced vocab
        const recentClasses = await Class.findAll({
            where: {
                meeting_end: { [Op.between]: [cutoffDate, recentCutoff] },
                status: 'completed'
            },
            attributes: ['student_id'],
            raw: true
        });

        if (recentClasses.length === 0) return [];

        const studentIds = [...new Set(recentClasses.map(c => c.student_id))];

        // Check who hasn't practiced vocab
        const activities = await StudentActivity.findAll({
            where: {
                student_id: { [Op.in]: studentIds },
                [Op.or]: [
                    { last_vocab_practice: null },
                    { last_vocab_practice: { [Op.lt]: cutoffDate } }
                ]
            },
            attributes: ['student_id'],
            raw: true
        });

        const eligibleIds = activities.map(a => a.student_id);

        // Also include students with no activity record
        const hasActivityIds = activities.map(a => a.student_id);
        const allActivities = await StudentActivity.findAll({
            where: { student_id: { [Op.in]: studentIds } },
            attributes: ['student_id'],
            raw: true
        });
        const trackedIds = allActivities.map(a => a.student_id);
        const noRecordIds = studentIds.filter(id => !trackedIds.includes(id));

        const allEligible = [...new Set([...eligibleIds, ...noRecordIds])];
        if (allEligible.length === 0) return [];

        return await User.findAll({
            where: { id: { [Op.in]: allEligible.slice(0, 100) }, role_name: 'user' },
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone', 'fcm_token', 'notification_channels']
        });
    } catch (error) {
        logToFile('Error in findStudentsForUnpracticedVocab', 'error', { error: error.message });
        return [];
    }
}

// ============================================================
// TRIGGER TYPE → PROCESSOR MAP
// ============================================================

const triggerProcessors = {
    'post_lesson_feedback': findStudentsForPostLessonFeedback,
    'post_lesson_practice': findStudentsForPostLessonPractice,
    'inactivity': findStudentsForInactivity,
    'unpracticed_vocab': findStudentsForUnpracticedVocab,
    'unviewed_feedback': findStudentsForUnviewedFeedback,
    'new_practice_available': findStudentsForNewPractice,
};

// ============================================================
// MAIN PROCESSING FUNCTION
// ============================================================

async function processEngagementReminders() {
    if (isRunning) {
        logToFile('Previous engagement job still running, skipping', 'warn');
        return;
    }

    isRunning = true;
    const startTime = Date.now();

    logToFile('========== ENGAGEMENT REMINDER PROCESSING STARTED ==========');

    let totalProcessed = 0;
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    try {
        // 1. Load all active rules, ordered by priority
        const activeRules = await NotificationRule.findAll({
            where: { is_active: true },
            order: [['priority', 'ASC']]
        });

        logToFile(`Found ${activeRules.length} active notification rules`);

        if (activeRules.length === 0) {
            logToFile('No active rules found, nothing to process');
            isRunning = false;
            return;
        }

        // 2. Process each rule
        for (const rule of activeRules) {
            try {
                logToFile(`Processing rule: ${rule.rule_name} (${rule.trigger_type})`, 'info', {
                    ruleId: rule.id,
                    triggerType: rule.trigger_type,
                    delayHours: rule.delay_hours,
                    delayDays: rule.delay_days
                });

                // Get the processor function for this trigger type
                const processor = triggerProcessors[rule.trigger_type];
                if (!processor) {
                    logToFile(`No processor found for trigger type: ${rule.trigger_type}`, 'warn');
                    continue;
                }

                // Find matching students
                const students = await processor(rule);
                logToFile(`Rule "${rule.rule_name}": found ${students.length} matching students`);

                if (students.length === 0) continue;

                // Send notifications to each student
                for (const student of students) {
                    totalProcessed++;
                    try {
                        const result = await engagementService.sendEngagementNotification(student, rule);

                        if (result.sent) {
                            totalSent++;
                        } else {
                            totalSkipped++;
                        }
                    } catch (studentError) {
                        totalFailed++;
                        logToFile(`Error sending to student ${student.id}`, 'error', {
                            error: studentError.message,
                            ruleName: rule.rule_name
                        });
                    }
                }

            } catch (ruleError) {
                logToFile(`Error processing rule ${rule.rule_name}`, 'error', {
                    error: ruleError.message,
                    ruleId: rule.id
                });
            }
        }

    } catch (error) {
        logToFile('Critical error in engagement reminder processing', 'error', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isRunning = false;
        const duration = Date.now() - startTime;

        logToFile('========== ENGAGEMENT REMINDER PROCESSING COMPLETE ==========', 'info', {
            duration: `${duration}ms`,
            totalProcessed,
            totalSent,
            totalSkipped,
            totalFailed
        });
    }
}

// ============================================================
// SCHEDULE THE CRON JOB
// Run every 15 minutes
// ============================================================

cron.schedule('*/15 * * * *', async () => {
    logToFile('Engagement reminders cron triggered');
    await processEngagementReminders();
}, {
    scheduled: true,
    timezone: 'Asia/Jerusalem'
});

logToFile('Engagement reminders cron job registered (every 15 minutes)');

module.exports = {
    processEngagementReminders // Export for manual testing
};
