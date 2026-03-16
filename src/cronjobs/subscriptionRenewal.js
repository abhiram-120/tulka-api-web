// cron/subscriptionRenewal.js
const { sequelize } = require('../connection/connection');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import models
const RecurringPayment = require('../models/RecurringPayment');
const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const Class = require('../models/classes');
const { classDeletionLogger } = require('../utils/classDeletionLogger');

// Setup logging
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `subscription-renewal-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

// Flag to prevent concurrent executions
let isJobRunning = false;

/**
 * Determine subscription type based on billing period and lesson duration
 * @param {Number} months - Number of months in subscription
 * @param {Number} lessonMinutes - Duration of each lesson in minutes
 * @returns {String} - Subscription type
 */
const determineSubscriptionType = (months, lessonMinutes) => {
    if (months >= 12) {
        return 'Yearly';
    } else if (months >= 3 && months < 12) {
        return 'Quarterly';
    } else {
        return `Monthly_${lessonMinutes}`;
    }
};

// /**
//  * Calculate next renewal date based on subscription type
//  * @param {String} subscriptionType - Type of subscription
//  * @returns {Date} - Next renewal date
//  */
// const calculateNextRenewalDate = (subscriptionType) => {
//     const now = moment();
    
//     if (subscriptionType === 'Yearly') {
//         return now.add(1, 'year').toDate();
//     } else if (subscriptionType === 'Quarterly') {
//         return now.add(3, 'months').toDate();
//     } else {
//         return now.add(1, 'month').toDate();
//     }
// };

/**
 * Process subscription renewal for a user
 * @param {Object} recurringPayment - RecurringPayment record
 * @param {Object} user - User record
 * @param {Object} subscription - Current subscription record
 * @param {Object} transaction - Database transaction
 */
const processSubscriptionRenewal = async (recurringPayment, user, subscription, transaction) => {
    try {
        logToFile(`Processing subscription renewal for user ${user.id} (${user.email})`);

        // Determine subscription details from recurring payment
        const lessonMinutes = subscription.lesson_min || recurringPayment.lesson_minutes || 25;
        const lessonsPerMonth = subscription.weekly_lesson || recurringPayment.lessons_per_month || 4;
        const subscriptionMonths = recurringPayment.subscription_months || 1;
        const subscriptionType = subscription.type || determineSubscriptionType(subscriptionMonths, lessonMinutes);
        
        // Cancel existing subscription
        // await subscription.update({
        //     status: 'inactive',
        //     is_cancel: 1,
        //     updated_at: new Date()
        // }, { transaction });

        logToFile(`Cancelled existing subscription ${subscription.id} for user ${user.id}`);

        // Calculate remaining lessons from current period
        const currentDate = moment();
        const lessonResetDate = moment(subscription.lesson_reset_at);
        
        let leftLessons = subscription.weekly_lesson || lessonsPerMonth;
        let leftLessonsCarryover = 0;

        // Check if we should carry over unused lessons
        if (currentDate.isAfter(lessonResetDate)) {
            // Count classes booked for current period
            const bookedClassesCount = await Class.count({
                where: {
                    student_id: user.id,
                    meeting_start: {
                        [Op.between]: [lessonResetDate.toDate(), currentDate.toDate()]
                    },
                    status: {
                        [Op.ne]: 'canceled'
                    },
                    is_regular_hide: 0
                },
                transaction
            });

            // Calculate carryover lessons
            leftLessonsCarryover = Math.max(0, subscription.left_lessons - bookedClassesCount);
            logToFile(`Calculated carryover lessons: ${leftLessonsCarryover} for user ${user.id}`);
        }

        if (user.next_month_subscription || user.next_year_subscription) {
            leftLessons = subscription.left_lessons; // Carry over the left lessons for next month/year
            logToFile(`Using left lessons from next subscription for user ${user.id}: ${leftLessons}`);
        }
        
        // Handle different subscription types
        if (subscriptionType === 'Yearly' || subscriptionType === 'Quarterly') {
            // For Yearly/Quarterly subscriptions, just cancel and clean up
            logToFile(`Cancelling ${subscriptionType} subscription for user ${user.id} - no auto-renewal`);
            
            // Get classes before deletion for logging
            const hiddenClassesToDelete = await Class.findAll({
                where: {
                    student_id: user.id,
                    is_regular_hide: 1
                },
                attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                transaction
            });

            // Log bulk class deletion before cancellation
            if (hiddenClassesToDelete.length > 0) {
                const classesDeleted = hiddenClassesToDelete.map(hc => ({
                    class_id: hc.id,
                    class_type: 'regular',
                    student_id: hc.student_id,
                    teacher_id: hc.teacher_id,
                    meeting_start: hc.meeting_start,
                    status: hc.status
                }));

                classDeletionLogger.logBulkClassDeletion({
                    deletion_source: 'cronjob',
                    deleted_by: null,
                    deleted_by_role: 'system',
                    deletion_reason: `${subscriptionType} subscription expired - cleaning up hidden classes`,
                    total_deleted: hiddenClassesToDelete.length,
                    classes_deleted: classesDeleted,
                    subscription_updates: [{
                        subscription_id: subscription.id,
                        student_id: user.id,
                        subscription_type: subscriptionType
                    }],
                    lessons_refunded_total: 0
                });
            }

            // Cancel hidden regular classes
            const cancelledCountResult = await Class.update(
                {
                    status: 'canceled',
                    cancelled_by: null,
                    cancelled_at: new Date(),
                    cancellation_reason: `${subscriptionType} subscription expired - hidden classes cancelled`,
                    join_url: null,
                    updated_at: new Date()
                },
                {
                    where: {
                        student_id: user.id,
                        is_regular_hide: 1
                    },
                    transaction
                }
            );
            const cancelledCount = cancelledCountResult[0] || 0;

            // Update user subscription reference
            await user.update({
                subscription_id: null,
                subscription_type: null
            }, { transaction });

            // Mark recurring payment as completed
            await recurringPayment.update({
                is_active: false,
                status: 'cancelled',
                cancelled_at: new Date(),
                booked_monthly_classes: 1,  // Mark as processed
                remarks: `${subscriptionType} subscription expired - no auto-renewal`
            }, { transaction });

        } else {
            // For Monthly subscriptions, create a new subscription
            
            // Check if user should get automatic renewal
            const shouldAutoRenew = !subscription.inactive_after_renew;
            
            if (!shouldAutoRenew) {
                logToFile(`User ${user.id} marked for no auto-renewal - cancelling subscription`);
                
                // Get classes before deletion for logging
                const hiddenClassesToDelete = await Class.findAll({
                    where: {
                        student_id: user.id,
                        is_regular_hide: 1
                    },
                    attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                    transaction
                });

                // Log bulk class deletion before cancellation
                if (hiddenClassesToDelete.length > 0) {
                    const classesDeleted = hiddenClassesToDelete.map(hc => ({
                        class_id: hc.id,
                        class_type: 'regular',
                        student_id: hc.student_id,
                        teacher_id: hc.teacher_id,
                        meeting_start: hc.meeting_start,
                        status: hc.status
                    }));

                    classDeletionLogger.logBulkClassDeletion({
                        deletion_source: 'cronjob',
                        deleted_by: null,
                        deleted_by_role: 'system',
                        deletion_reason: 'User marked for no auto-renewal - cleaning up hidden classes',
                        total_deleted: hiddenClassesToDelete.length,
                        classes_deleted: classesDeleted,
                        subscription_updates: [{
                            subscription_id: subscription.id,
                            student_id: user.id,
                            subscription_type: subscriptionType
                        }],
                        lessons_refunded_total: 0
                    });
                }

                // Cancel hidden classes
                const cancelledCountResult = await Class.update(
                    {
                        status: 'canceled',
                        cancelled_by: null,
                        cancelled_at: new Date(),
                        cancellation_reason: 'User marked for no auto-renewal - hidden classes cancelled',
                        join_url: null,
                        updated_at: new Date()
                    },
                    {
                        where: {
                            student_id: user.id,
                            is_regular_hide: 1
                        },
                        transaction
                    }
                );
                const cancelledCount = cancelledCountResult[0] || 0;

                // Update user
                await user.update({
                    subscription_id: null,
                    subscription_type: null
                }, { transaction });

                // Mark recurring payment as completed
                await recurringPayment.update({
                    is_active: false,
                    status: 'cancelled',
                    cancelled_at: new Date(),
                    booked_monthly_classes: 1,  // Mark as processed
                    remarks: 'User opted out of auto-renewal'
                }, { transaction });

                return;
            }

            // Create new subscription with updated values
            // const newSubscriptionData = {
            //     user_id: user.id,
            //     type: subscription.type || subscriptionType,
            //     each_lesson: subscription.lesson_min||lessonMinutes.toString(),
            //     weekly_lesson: subscription.weekly_lesson||lessonsPerMonth,
            //     status: 'active',
            //     renew_date: calculateNextRenewalDate(subscription.type || subscriptionType),
            //     lesson_min: subscription.lesson_min,
            //     left_lessons: leftLessons + leftLessonsCarryover,
            //     lesson_reset_at: moment().add(1, 'month').toDate(),
            //     weekly_comp_class: 0,
            //     bonus_class: 0,
            //     bonus_completed_class: 0,
            //     cost_per_lesson: recurringPayment.amount / leftLessons,
            //     is_cancel: 0,
            //     plan_id: subscription.plan_id || 1,
            //     payment_status: 'online',
            //     balance: 0,
            //     how_often: `${subscription.weekly_lesson||lessonsPerMonth} lessons per month`,
            //     created_at: new Date(),
            //     updated_at: new Date()
            // };

            // // Check for duplicate active subscriptions
            // const existingActiveSubscription = await UserSubscriptionDetails.findOne({
            //     where: {
            //         user_id: user.id,
            //         status: 'active',
            //         is_cancel: 0
            //     },
            //     transaction
            // });

            // if (existingActiveSubscription) {
            //     logToFile(`User ${user.id} already has active subscription ${existingActiveSubscription.id} - skipping creation`);
            //     return;
            // }

            // // Create new subscription
            // const newSubscription = await UserSubscriptionDetails.create(newSubscriptionData, { transaction });

            // logToFile(`Created new subscription ${newSubscription.id} for user ${user.id} with ${newSubscription.left_lessons} lessons`);

            // Update user with new subscription reference
            // await user.update({
            //     // subscription_id: newSubscription.id,  // COMMENTED: No subscription creation
            //     // subscription_type: newSubscription.type,  // COMMENTED: No subscription creation
            //     trial_expired: true,
            //     next_month_subscription: false,
            //     next_year_subscription: false
            // }, { transaction });

            // Update recurring payment for next cycle and mark as processed
            await recurringPayment.update({
                next_payment_date: moment().add(1, 'month').toDate(),
                recurring_count: (recurringPayment.recurring_count || 0) + 1,
                booked_monthly_classes: 1,  // Mark as processed for subscription renewal
                remarks: 'Subscription renewal processed (no new subscription created)'
            }, { transaction });

            logToFile(`Processed subscription renewal for user ${user.id} (no new subscription created)`);
        }

    } catch (error) {
        logToFile(`Error processing subscription renewal for user ${user.id}: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Main function to process subscription renewals
 */
async function processSubscriptionRenewals() {
    logToFile('Starting subscription renewal processing');
    
    let transaction;
    
    try {
        // Get all active recurring payments that have been paid but not yet processed for subscription renewal
        const dueRecurringPayments = await RecurringPayment.findAll({
            where: {
                is_active: true,
                status: 'paid',
                booked_monthly_classes: 0  // Changed from next_payment_date condition
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'subscription_id']
                }
            ]
        });

        logToFile(`Found ${dueRecurringPayments.length} recurring payments ready for subscription processing`);

        // Process each recurring payment
        for (const recurringPayment of dueRecurringPayments) {
            if (!recurringPayment.Student) {
                logToFile(`Recurring payment ${recurringPayment.id} has no associated student - marking as processed`, 'warn');
                
                try {
                    // Mark as processed to avoid reprocessing
                    await RecurringPayment.update(
                        { 
                            booked_monthly_classes: 1,
                            remarks: 'Payment processed but no associated student found'
                        },
                        { where: { id: recurringPayment.id } }
                    );
                } catch (updateError) {
                    logToFile(`Error updating recurring payment ${recurringPayment.id}: ${updateError.message}`, 'error');
                }
                continue;
            }

            const user = recurringPayment.Student;
            
            try {
                transaction = await sequelize.transaction();

                // Get current subscription
                const currentSubscription = await UserSubscriptionDetails.findOne({
                    where: {
                        user_id: user.id,
                        status: 'active',
                        is_cancel: 0
                    },
                    transaction
                });

                if (!currentSubscription) {
                    logToFile(`No active subscription found for user ${user.id} - marking payment as processed`, 'warn');
                    
                    // Mark as processed to avoid reprocessing
                    await recurringPayment.update({
                        booked_monthly_classes: 1,
                        remarks: 'Payment processed but no active subscription found for renewal'
                    }, { transaction });
                    
                    await transaction.rollback();
                    continue;
                }

                // Check if subscription is actually due for renewal
                const renewDate = moment(currentSubscription.renew_date);
                const currentDate = moment();

                if (currentDate.isBefore(renewDate)) {
                    logToFile(`Subscription for user ${user.id} is not due for renewal yet (due: ${renewDate.format('YYYY-MM-DD')}) - marking payment as processed`);
                    
                    // Mark as processed even though not renewed yet, to avoid reprocessing
                    await recurringPayment.update({
                        booked_monthly_classes: 1,
                        remarks: `Payment processed but subscription not due for renewal until ${renewDate.format('YYYY-MM-DD')}`
                    }, { transaction });
                    
                    await transaction.rollback();
                    continue;
                }

                // Process the renewal
                await processSubscriptionRenewal(recurringPayment, user, currentSubscription, transaction);

                await transaction.commit();
                transaction = null;

                logToFile(`Successfully processed renewal for user ${user.id}`);

            } catch (error) {
                if (transaction) {
                    await transaction.rollback();
                    transaction = null;
                }
                logToFile(`Error processing renewal for user ${user.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error');
                continue;
            }
        }

        logToFile('Subscription renewal processing completed');

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        logToFile(`Error in processSubscriptionRenewals: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    }
}

// Schedule the cron job to run every minute with lock mechanism to prevent overlapping executions
cron.schedule('* * * * *', async () => {
    const startTime = new Date();
    logToFile(`Attempting to run subscription renewal cron job at ${startTime.toISOString()}`);
    
    if (isJobRunning) {
        logToFile('Previous subscription renewal job is still running, skipping this execution', 'warn');
        return;
    }
    
    isJobRunning = true;
    
    try {
        logToFile(`Running subscription renewal cron job at ${startTime.toISOString()}`);
        await processSubscriptionRenewals();
        const endTime = new Date();
        const executionTime = (endTime - startTime) / 1000; // in seconds
        logToFile(`Completed subscription renewal cron job at ${endTime.toISOString()}, execution time: ${executionTime.toFixed(2)}s`);
    } catch (error) {
        logToFile(`Unhandled error in subscription renewal cron job: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning = false;
    }
});

// Export for manual execution or testing
module.exports = {
    processSubscriptionRenewals
};