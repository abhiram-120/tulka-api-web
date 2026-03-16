// src/cronjobs/dunningProcessor.js
const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const PastDuePayment = require('../models/PastDuePayment');
const DunningSchedule = require('../models/DunningSchedule');
const SubscriptionChargeSkip = require('../models/SubscriptionChargeSkip');
const RecurringPayment = require('../models/RecurringPayment');
const { sendReminderNotification, sendCancellationNotification } = require('../services/dunningNotificationService');
const { cancelUserRecurringPayments } = require('../controller/admin/student.controller');

// Setup logging for dunning processor
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0];
    const logFile = path.join(logsDir, `dunning-processor-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry);

    if (type === 'error') {
        console.error(`[DUNNING] ${message}`);
    } else {
        console.log(`[DUNNING] ${message}`);
    }
}

/**
 * Process dunning reminders and grace period expiry
 */
const processDunningSchedules = async () => {
    logToFile('========== DUNNING PROCESSOR STARTING ==========');

    let transaction;
    let processedReminders = 0;
    let expiredSubscriptions = 0;
    let skippedUsers = 0;
    let errors = 0;

    try {
        transaction = await sequelize.transaction();

        // Get all active dunning schedules that need processing
        const now = new Date();
        const activeSchedules = await DunningSchedule.findAll({
            where: {
                is_enabled: true,
                is_paused: false,
                next_reminder_at: {
                    [Op.lte]: now
                }
            },
            include: [
                {
                    model: PastDuePayment,
                    as: 'PastDuePayment',
                    where: { status: 'past_due' },
                    include: [
                        {
                            model: User,
                            as: 'User',
                            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone']
                        },
                        {
                            model: UserSubscriptionDetails,
                            as: 'Subscription',
                            attributes: ['id', 'type', 'status', 'lesson_min', 'weekly_lesson']
                        }
                    ]
                }
            ],
            transaction
        });

        logToFile(`Found ${activeSchedules.length} active dunning schedules to process`);

        // Process each schedule
        for (const schedule of activeSchedules) {
            try {
                const pastDuePayment = schedule.PastDuePayment;
                const user = pastDuePayment.User;
                const subscription = pastDuePayment.Subscription;

                logToFile(`Processing dunning for User ID: ${user.id}, Past Due Payment ID: ${pastDuePayment.id}`);

                // Check if grace period has expired (Day 30)
                const gracePeriodExpired = moment().isAfter(moment(pastDuePayment.grace_period_expires_at));

                if (gracePeriodExpired) {
                    logToFile(`Grace period expired for user ${user.id} - canceling subscription`);

                    await handleGracePeriodExpiry({
                        user,
                        subscription,
                        past_due_payment: pastDuePayment,
                        dunning_schedule: schedule
                    }, transaction);

                    expiredSubscriptions++;

                } else {
                    // Check for active charge skip BEFORE sending reminder
                    const skipResult = await checkActiveChargeSkip(user.id, subscription?.id, transaction);
                    
                    if (skipResult.hasActiveSkip) {
                        logToFile(`User ${user.id} has active charge skip (${skipResult.skipInfo.reason_category || 'unspecified'}) - skipping reminder and scheduling next`);
                        
                        await scheduleNextReminder(schedule, user.timezone, transaction);
                        skippedUsers++;
                        continue;
                    }

                    // Send reminder if still within grace period and no active skip
                    const daysRemaining = moment(pastDuePayment.grace_period_expires_at).diff(moment(), 'days');
                    logToFile(`Sending reminder to user ${user.id} - ${daysRemaining} days remaining`);

                    await sendScheduledReminder({
                        user,
                        subscription,
                        past_due_payment: pastDuePayment,
                        dunning_schedule: schedule,
                        days_remaining: daysRemaining
                    }, transaction);

                    processedReminders++;
                }

            } catch (scheduleError) {
                logToFile(`Error processing schedule ${schedule.id}: ${scheduleError.message}`, 'error');
                errors++;
                continue;
            }
        }

        // Cleanup resolved schedules
        await cleanupResolvedSchedules(transaction);

        await transaction.commit();

        logToFile(`========== DUNNING PROCESSOR COMPLETED ==========`);
        logToFile(`Results: ${processedReminders} reminders sent, ${expiredSubscriptions} subscriptions canceled, ${skippedUsers} users skipped (charge skip), ${errors} errors`);

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                logToFile(`Error rolling back transaction: ${rollbackError.message}`, 'error');
            }
        }

        logToFile(`Critical error in dunning processor: ${error.message}`, 'error');
    }
};

/**
 * Send scheduled reminder to user
 */
const sendScheduledReminder = async (params, transaction) => {
    try {
        const { user, subscription, past_due_payment, dunning_schedule, days_remaining } = params;

        // Check if user is paused until a specific date
        if (dunning_schedule.paused_until && moment().isBefore(moment(dunning_schedule.paused_until))) {
            logToFile(`User ${user.id} reminders paused until ${dunning_schedule.paused_until}`);
            
            const nextReminderAt = moment(dunning_schedule.paused_until).add(1, 'day')
                .hour(parseInt(dunning_schedule.reminder_time.split(':')[0]))
                .minute(parseInt(dunning_schedule.reminder_time.split(':')[1]))
                .toDate();

            await dunning_schedule.update({
                next_reminder_at: nextReminderAt
            }, { transaction });

            return;
        }

        // Send reminder notification
        const notificationResult = await sendReminderNotification({
            user,
            past_due_payment,
            dunning_schedule,
            payment_link: past_due_payment.payment_link,
            days_remaining
        });

        // Update dunning schedule
        const updateData = {
            last_reminder_sent_at: new Date(),
            total_reminders_sent: dunning_schedule.total_reminders_sent + 1
        };

        await scheduleNextReminder(dunning_schedule, user.timezone, transaction, updateData);

        // Update past due payment
        await past_due_payment.update({
            last_reminder_sent_at: new Date(),
            total_reminders_sent: past_due_payment.total_reminders_sent + 1
        }, { transaction });

        logToFile(`Reminder sent to user ${user.id} - total reminders: ${dunning_schedule.total_reminders_sent + 1}`);

    } catch (error) {
        logToFile(`Error in sendScheduledReminder: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Send scheduled reminder to user
 */
const checkActiveChargeSkip = async (userId, subscriptionId, transaction) => {
    try {
        const currentDate = moment().format('YYYY-MM-DD');
        
        const activeSkip = await SubscriptionChargeSkip.findOne({
            where: {
                user_id: userId,
                is_active: true,
                skip_start_date: { [Op.lte]: currentDate },
                skip_end_date: { [Op.gte]: currentDate }
            },
            include: [
                {
                    model: User,
                    as: 'CreatedByUser',
                    attributes: ['id', 'full_name'],
                    required: false
                }
            ],
            transaction
        });

        if (activeSkip) {
            // Log skip details for audit
            logToFile(`Active charge skip found for user ${userId}: Type: ${activeSkip.reason_category || 'unspecified'}, Ends: ${activeSkip.skip_end_date}, Lesson Policy: ${activeSkip.lesson_policy || 'no_new_lessons'}`);
            
            return {
                hasActiveSkip: true,
                skipInfo: {
                    id: activeSkip.id,
                    reason_category: activeSkip.reason_category,
                    reason: activeSkip.reason,
                    lesson_policy: activeSkip.lesson_policy,
                    skip_end_date: activeSkip.skip_end_date,
                    created_by: activeSkip.CreatedByUser?.full_name || 'Unknown'
                }
            };
        }

        return { hasActiveSkip: false };

    } catch (error) {
        logToFile(`Error checking charge skip for user ${userId}: ${error.message}`, 'error');
        // Return false to continue with reminder processing in case of error
        return { hasActiveSkip: false };
    }
};

/**
 * Handle grace period expiry - cancel subscription and send final notice
 */
const handleGracePeriodExpiry = async (params, transaction) => {
    try {
        const { user, subscription, past_due_payment, dunning_schedule } = params;

        logToFile(`Handling grace period expiry for user ${user.id}`);

        // Cancel subscription
        await subscription.update({
            status: 'inactive',
            is_cancel: 1,
            cancellation_date: new Date(),
            cancellation_reason_category: 'payment_issues',
            cancellation_reason: 'Subscription canceled due to failed payment after 30-day grace period',
            cancelled_by_user_id: null, // System cancellation
            updated_at: new Date()
        }, { transaction });

        // Update user subscription info
        await User.update({
            subscription_id: null,
            subscription_type: null,
            trial_expired: true,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: user.id },
            transaction
        });

        // Cancel PayPlus recurring payments
        try {
            const recurringPaymentResult = await cancelUserRecurringPayments(
                user.id,
                'Grace period expired - automatic cancellation',
                null, // System cancellation
                transaction
            );
            logToFile(`✅ PayPlus recurring payment cancellation result for user ${user.id}: ${JSON.stringify(recurringPaymentResult)}`);
        } catch (recurringError) {
            logToFile(`❌ Error canceling PayPlus recurring payments for user ${user.id}: ${recurringError.message}`, 'error');
            // Don't fail the entire operation if PayPlus cancellation fails
            // The subscription will still be canceled locally
        }

        // Mark past due payment as canceled
        await past_due_payment.update({
            status: 'canceled',
            canceled_at: new Date(),
            cancellation_reason_category: 'payment_issues',
            cancellation_reason: 'Grace period expired - automatic cancellation',
            notes: `${past_due_payment.notes || ''}\n[${new Date().toISOString()}] Grace period expired - subscription canceled automatically`
        }, { transaction });

        // Disable dunning schedule
        await dunning_schedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, { transaction });

        // Send final cancellation notification
        await sendCancellationNotification({
            user,
            past_due_payment,
            subscription
        });

        logToFile(`Subscription canceled for user ${user.id} due to expired grace period`);

    } catch (error) {
        logToFile(`Error in handleGracePeriodExpiry: ${error.message}`, 'error');
        throw error;
    }
};

// Note: cancelActiveRecurringPayments function has been replaced with cancelUserRecurringPayments
// from student.controller.js which properly cancels PayPlus recurring payments

/**
 * Schedule next reminder based on frequency and timezone
 */
const scheduleNextReminder = async (dunningSchedule, userTimezone, transaction, updateData = {}) => {
    try {
        const timezone = userTimezone || 'Asia/Jerusalem';
        const reminderTime = dunningSchedule.reminder_time || '10:00:00';
        const [hours, minutes] = reminderTime.split(':').map(Number);

        let nextReminderAt;

        switch (dunningSchedule.reminder_frequency) {
            case 'every_2_days':
                nextReminderAt = moment().tz(timezone).add(2, 'days')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
            case 'weekly':
                nextReminderAt = moment().tz(timezone).add(7, 'days')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
            case 'daily':
            default:
                nextReminderAt = moment().tz(timezone).add(1, 'day')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
        }

        await dunningSchedule.update({
            ...updateData,
            next_reminder_at: nextReminderAt
        }, { transaction });

        logToFile(`Next reminder scheduled for ${nextReminderAt} (${timezone})`);

    } catch (error) {
        logToFile(`Error scheduling next reminder: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Cleanup dunning schedules for resolved payments
 */
const cleanupResolvedSchedules = async (transaction) => {
    try {
        // Find schedules with resolved/canceled past due payments
        const resolvedScheduleIds = await DunningSchedule.findAll({
            attributes: ['id'],
            include: [{
                model: PastDuePayment,
                as: 'PastDuePayment',
                where: { 
                    status: { [Op.in]: ['resolved', 'canceled'] }
                },
                attributes: []
            }],
            transaction
        });

        if (resolvedScheduleIds.length > 0) {
            const idsToUpdate = resolvedScheduleIds.map(s => s.id);
            
            await DunningSchedule.update(
                {
                    is_enabled: false,
                    next_reminder_at: null,
                    updated_at: new Date()
                },
                {
                    where: { id: { [Op.in]: idsToUpdate } },
                    transaction
                }
            );

            logToFile(`Cleaned up ${resolvedScheduleIds.length} resolved dunning schedules`);
        }

    } catch (error) {
        logToFile(`Error in cleanupResolvedSchedules: ${error.message}`, 'error');
        // Don't throw - this is cleanup and shouldn't break main processing
    }
};

// Schedule the cron job to run daily at 9:00 AM
cron.schedule('0 9 * * *', async () => {
    logToFile('Dunning processor cron job triggered (daily 9:00 AM)');
    await processDunningSchedules();
}, {
    scheduled: true,
    timezone: "Asia/Jerusalem"
});

// Backup job every 4 hours to catch missed reminders
cron.schedule('* * * * *', async () => {
    logToFile('Dunning processor backup check triggered (every 4 hours)');
    await processDunningSchedules();
}, {
    scheduled: true,
    timezone: "Asia/Jerusalem"
});

// logToFile('Dunning processor cron jobs initialized: Daily at 9:00 AM + Every 4 hours backup');

module.exports = {
    processDunningSchedules,
    checkActiveChargeSkip
};