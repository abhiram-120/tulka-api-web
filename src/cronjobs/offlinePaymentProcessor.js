const { sequelize } = require('../connection/connection');
const { Op } = require('sequelize');
const moment = require('moment');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import models
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const User = require('../models/users');
const RegularClass = require('../models/regularClass');
const Lesson = require('../models/classes');
const { classDeletionLogger } = require('../utils/classDeletionLogger');

// ✅ Define only the associations needed for this cron job with unique aliases
// User and UserSubscriptionDetails association (for this cron job only)
UserSubscriptionDetails.belongsTo(User, {
    foreignKey: 'user_id',
    targetKey: 'id',
    as: 'SubscriptionUserAs' // This alias is used in the cron job
});

User.hasMany(UserSubscriptionDetails, {
    foreignKey: 'user_id',
    sourceKey: 'id',
    as: 'CronUserSubscriptions' // Unique alias for this cron job
});

// Setup logging
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `offline-payments-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry);

    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

/**
 * Update user subscription fields based on subscription status
 * @param {Object} user - User object
 * @param {Object} subscription - Subscription object
 * @param {Object} transaction - Database transaction
 */
async function updateUserSubscriptionFields(user, subscription, transaction) {
    try {
        let subscriptionType = null;
        let subscriptionId = null;

        // If subscription is active, set the fields
        if (subscription && subscription.status === 'active') {
            subscriptionType = subscription.type;
            subscriptionId = subscription.id;
        }

        // Update user with subscription information
        await user.update({
            subscription_type: subscriptionType,
            subscription_id: subscriptionId,
            updated_at: Math.floor(Date.now() / 1000) // Unix timestamp as per User model
        }, { transaction });

        logToFile(`Updated user ${user.id} subscription fields - type: ${subscriptionType}, id: ${subscriptionId}`, 'info');
    } catch (error) {
        logToFile(`Error updating user subscription fields for user ${user.id}: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Process subscription renewals
 */
async function processOfflinePayments() {
    logToFile('Starting offline payment processing');

    let transaction;

    try {
        // Get all active subscriptions due for renewal
        const subscriptions = await UserSubscriptionDetails.findAll({
            where: {
                renew_date: {
                    [Op.lte]: moment().toDate(),
                },
                status: {
                    [Op.or]: ['active', 'inactive_after_renew'],
                },
                is_cancel: 0,
                payment_status: 'offline', // Marked as offline payment
            },
            include: [{
                model: User,
                as: 'SubscriptionUserAs', // Using the alias defined above
                attributes: ['id', 'full_name', 'email', 'next_month_subscription', 'next_year_subscription', 'subscription_type', 'subscription_id'],
            }],
        });

        logToFile(`Found ${subscriptions.length} subscriptions to process`);

        for (const subscription of subscriptions) {
            const user = subscription.SubscriptionUserAs;
            try {
                transaction = await sequelize.transaction();

                // Process based on subscription type (Yearly, Quarterly, Monthly)
                if (subscription.type === 'Yearly' || subscription.type === 'Quarterly') {
                    // If the subscription is yearly or quarterly, mark as canceled
                    await subscription.update({
                        is_cancel: 1,
                        status: 'inactive',
                        updated_at: moment().toDate(),
                    }, { transaction });

                    // Update user subscription fields to null since subscription is now inactive
                    await updateUserSubscriptionFields(user, { status: 'inactive' }, transaction);

                    // Get classes before deletion for logging
                    const regularClassesToDelete = await RegularClass.findAll({
                        where: { student_id: user.id },
                        attributes: ['id', 'student_id', 'teacher_id', 'day', 'start_time'],
                        transaction
                    });

                    const hiddenLessonsToDelete = await Lesson.findAll({
                        where: { student_id: user.id, is_regular_hide: 1 },
                        attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                        transaction
                    });

                    // Log bulk class deletion before cancellation
                    const totalDeleted = hiddenLessonsToDelete.length + regularClassesToDelete.length;
                    if (totalDeleted > 0) {
                        const classesDeleted = [
                            ...regularClassesToDelete.map(rc => ({
                                class_id: rc.id,
                                class_type: 'regular_class_pattern',
                                student_id: rc.student_id,
                                teacher_id: rc.teacher_id
                            })),
                            ...hiddenLessonsToDelete.map(hc => ({
                                class_id: hc.id,
                                class_type: 'regular',
                                student_id: hc.student_id,
                                teacher_id: hc.teacher_id,
                                meeting_start: hc.meeting_start,
                                status: hc.status
                            }))
                        ];

                        classDeletionLogger.logBulkClassDeletion({
                            deletion_source: 'cronjob',
                            deleted_by: null,
                            deleted_by_role: 'system',
                            deletion_reason: `Yearly/Quarterly subscription cancelled for user ${user.id}`,
                            total_deleted: totalDeleted,
                            classes_deleted: classesDeleted,
                            subscription_updates: [{
                                subscription_id: subscription.id,
                                student_id: user.id,
                                subscription_type: subscription.type
                            }],
                            lessons_refunded_total: 0
                        });
                    }

                    // Cancel lessons (classes) associated with the user
                    const cancelledLessonsCountResult = await Lesson.update(
                        {
                            status: 'canceled',
                            cancelled_by: null,
                            cancelled_at: new Date(),
                            cancellation_reason: `Yearly/Quarterly subscription cancelled for user ${user.id}`,
                            join_url: null,
                            updated_at: new Date()
                        },
                        {
                            where: { student_id: user.id, is_regular_hide: 1 },
                            transaction
                        }
                    );
                    const cancelledLessonsCount = cancelledLessonsCountResult[0] || 0;
                    
                    // Delete regular class patterns (these are patterns, not classes)
                    const deletedRegularClassesCount = await RegularClass.destroy({
                        where: { student_id: user.id },
                        transaction
                    });

                    logToFile(`Cancelled yearly/quarterly subscription for user ${user.id} (${user.email})`, 'info');
                } else {
                    // Monthly subscription logic
                    // Start with weekly_lesson (matching PHP logic)
                    let leftLessonsForThisMonth = subscription.weekly_lesson;
                    
                    // Initialize carry-over variable (matching PHP logic)
                    let leftLessonData = 0;
                    if (user.next_month_subscription || user.next_year_subscription) {
                        leftLessonData = subscription.left_lessons || 0;
                    }

                    // Handle the deduction of booked classes (matching PHP logic)
                    // Check booked classes between old lesson_reset_at and NEW lesson_reset_at (not just until now)
                    const newLessonResetAt = moment().add(1, 'month').toDate();
                    if (subscription.lesson_reset_at && moment(newLessonResetAt).isAfter(moment(subscription.lesson_reset_at))) {
                        const lessonsBooked = await Lesson.count({
                            where: {
                                student_id: user.id,
                                meeting_start: {
                                    [Op.between]: [
                                        moment(subscription.lesson_reset_at).toDate(),
                                        moment(newLessonResetAt).toDate(),
                                    ]
                                },
                                status: 'pending',
                                is_regular_hide: 0,
                            },
                            transaction
                        });
                        leftLessonsForThisMonth = leftLessonsForThisMonth - lessonsBooked;
                    }
                    
                    // Final calculation: base lessons + carry-over (matching PHP logic)
                    leftLessonsForThisMonth = leftLessonsForThisMonth + leftLessonData;

                    // If user wants to cancel after renewal, cancel subscription
                    if (subscription.inactive_after_renew || subscription.status === 'inactive_after_renew') {
                        await subscription.update({
                            is_cancel: 1,
                            status: 'inactive',
                            updated_at: moment().toDate(),
                        }, { transaction });

                        // Update user subscription fields to null since subscription is now inactive
                        await updateUserSubscriptionFields(user, { status: 'inactive' }, transaction);

                        // Get classes before deletion for logging
                        const regularClassesToDelete = await RegularClass.findAll({
                            where: { student_id: user.id },
                            attributes: ['id', 'student_id', 'teacher_id', 'day', 'start_time'],
                            transaction
                        });

                        const hiddenLessonsToDelete = await Lesson.findAll({
                            where: { student_id: user.id, is_regular_hide: 1 },
                            attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                            transaction
                        });

                        // Log bulk class deletion before cancellation
                        const totalDeleted = hiddenLessonsToDelete.length + regularClassesToDelete.length;
                        if (totalDeleted > 0) {
                            const classesDeleted = [
                                ...regularClassesToDelete.map(rc => ({
                                    class_id: rc.id,
                                    class_type: 'regular_class_pattern',
                                    student_id: rc.student_id,
                                    teacher_id: rc.teacher_id
                                })),
                                ...hiddenLessonsToDelete.map(hc => ({
                                    class_id: hc.id,
                                    class_type: 'regular',
                                    student_id: hc.student_id,
                                    teacher_id: hc.teacher_id,
                                    meeting_start: hc.meeting_start,
                                    status: hc.status
                                }))
                            ];

                            classDeletionLogger.logBulkClassDeletion({
                                deletion_source: 'cronjob',
                                deleted_by: null,
                                deleted_by_role: 'system',
                                deletion_reason: `Subscription cancelled for user ${user.id} due to inactive_after_renew`,
                                total_deleted: totalDeleted,
                                classes_deleted: classesDeleted,
                                subscription_updates: [{
                                    subscription_id: subscription.id,
                                    student_id: user.id,
                                    subscription_type: subscription.type
                                }],
                                lessons_refunded_total: 0
                            });
                        }

                        // Cancel lessons (classes) associated with the user
                        const cancelledLessonsCountResult = await Lesson.update(
                            {
                                status: 'canceled',
                                cancelled_by: null,
                                cancelled_at: new Date(),
                                cancellation_reason: `Subscription cancelled for user ${user.id} due to inactive_after_renew`,
                                join_url: null,
                                updated_at: new Date()
                            },
                            {
                                where: { student_id: user.id, is_regular_hide: 1 },
                                transaction
                            }
                        );
                        const cancelledLessonsCount = cancelledLessonsCountResult[0] || 0;

                        // Delete regular class patterns (these are patterns, not classes)
                        const deletedRegularClassesCount = await RegularClass.destroy({
                            where: { student_id: user.id },
                            transaction
                        });

                        logToFile(`Cancelled subscription for user ${user.id} (${user.email}) due to inactive_after_renew`, 'info');
                    } else {
                        // Renew the subscription
                        const newRenewDate = moment().add(1, 'month').toDate();
                        const newSubscriptionData = {
                            user_id: user.id,
                            type: subscription.type,
                            left_lessons: leftLessonsForThisMonth,
                            status: 'active',
                            renew_date: newRenewDate,
                            lesson_reset_at: moment().add(1, 'month').toDate(),
                            weekly_comp_class: 0,
                            weekly_lesson: subscription.weekly_lesson,
                            how_often: subscription.how_often,
                            lesson_min: subscription.lesson_min,
                            cost_per_lesson: subscription.cost_per_lesson,
                            payment_status: 'offline', // Keep it offline until admin confirms
                            is_cancel: 0,
                            created_at: moment().toDate(),
                            updated_at: moment().toDate(),
                        };
                        await subscription.update({
                            is_cancel: 1,
                            status: 'inactive',
                            updated_at: moment().toDate(),
                        }, { transaction });
                        // Create a new subscription for the next period
                        const newSubscription = await UserSubscriptionDetails.create(newSubscriptionData, { transaction });

                        // Update user subscription fields with new active subscription
                        await updateUserSubscriptionFields(user, newSubscription, transaction);
                        
                        // Update user's next_month_subscription flag to false (matching PHP logic)
                        await user.update({
                            next_month_subscription: false,
                            updated_at: Math.floor(Date.now() / 1000)
                        }, { transaction });

                        logToFile(`Created new subscription for user ${user.id} with ID ${newSubscription.id}`, 'info');
                    }
                }

                // Commit transaction
                await transaction.commit();
                transaction = null;

            } catch (error) {
                if (transaction) await transaction.rollback();
                logToFile(`Error processing offline payment for user ${user.id}: ${error.message}`, 'error');
            }
        }
    } catch (error) {
        logToFile(`Error in offline payment processing: ${error.message}`, 'error');
    }
}

// Schedule the cron job to run every minute
cron.schedule('* * * * *', () => {
    processOfflinePayments();
});