const PaymentTransaction = require('../../models/PaymentTransaction');
const User = require('../../models/users');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const UserSubscriptionDetails = require("../../models/UserSubscriptionDetails");
const TrialClassRegistration = require("../../models/trialClassRegistration");
const RecurringPayment = require('../../models/RecurringPayment');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const { Op } = require('sequelize');
const moment = require('moment');
const axios = require('axios');
const { sendNotificationEmail } = require('../../cronjobs/reminder');
const { sequelize } = require('../../connection/connection');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const { getRecurringPaymentDetails, updatePayplusCustomerEmail } = require('../../services/paymentRecoveryService');

/**
 * Helper function to determine stage based on payment data
 * This determines the CURRENT stage of the transaction
 */
const getPaymentStage = (transaction) => {
    // Priority order: completed > link-sent > approved > transferred > trial-booked
    if (transaction.status === 'success') {
        return 'completed';
    }
    if (transaction.token && transaction.token !== null) {
        return 'link-sent';
    }
    if (transaction.status === 'pending') {
        return 'approved';
    }
    if (transaction.generated_by && transaction.generated_by !== null) {
        return 'transferred';
    }
    return 'trial-booked';
};


/**
 * Get stage-specific where conditions for filtering
 */
const getStageWhereConditions = (stage) => {
    const conditions = {};
    
    switch (stage) {
        case 'trial-booked':
            // Trial booked only - no appointment setter, not approved, no token, not completed
            conditions.generated_by = null;
            conditions.status = { [Op.notIn]: ['success', 'pending'] };
            conditions.token = null;
            break;
            
        case 'transferred':
            // Has appointment setter but hasn't progressed to approved/link-sent/completed
            conditions.generated_by = { [Op.not]: null };
            conditions.status = { [Op.notIn]: ['success', 'pending'] };
            conditions.token = null;
            break;
            
        case 'approved':
            // Status is pending but no payment link sent yet
            conditions.status = 'pending';
            conditions.token = null;
            break;
            
        case 'link-sent':
            // Has payment token but not completed yet
            conditions.token = { [Op.not]: null };
            conditions.status = { [Op.not]: 'success' };
            break;
            
        case 'completed':
            // Payment completed successfully
            conditions.status = 'success';
            break;
            
        default:
            // No additional conditions for invalid stage
            break;
    }
    
    return conditions;
};

/**
 * Maintenance helper:
 * Fix PaymentTransaction lesson configuration based on active subscriptions
 * for subscriptions that:
 * - status = 'active'
 * - payment_status = 'online'
 * - is_cancel = 0
 * - renew_date between 2026-03-01 and 2026-03-18 (inclusive, UTC)
 *
 * Logic:
 * - For each matching subscription:
 *   - Load its PaymentTransaction via payment_id
 *   - Compare:
 *       PaymentTransaction.lesson_minutes     vs subscription.lesson_min
 *       PaymentTransaction.lessons_per_month  vs subscription.weekly_lesson
 *   - If different, mark as affected.
 *   - When applyChanges=true: update the PaymentTransaction fields to match subscription.
 *
 * Returns:
 *   { summary, message }
 */
async function handleMarch2026PaymentLessonFix(applyChanges) {
    const startDate = moment.utc('2026-03-01').startOf('day').toDate();
    const endDate = moment.utc('2026-03-18').endOf('day').toDate();

    const subscriptions = await UserSubscriptionDetails.findAll({
        where: {
            status: 'active',
            payment_status: 'online',
            is_cancel: 0,
            renew_date: {
                [Op.gte]: startDate,
                [Op.lte]: endDate
            }
        },
        order: [['user_id', 'ASC'], ['renew_date', 'ASC']]
    });

    const summary = {
        total_subscriptions_checked: subscriptions.length,
        total_with_payment: 0,
        total_affected: 0,
        total_updated: 0,
        applyChanges: !!applyChanges,
        items: []
    };

    if (!subscriptions.length) {
        return {
            summary,
            message: 'No matching subscriptions found in the specified window'
        };
    }

    const transaction = applyChanges
        ? await PaymentTransaction.sequelize.transaction()
        : null;

    try {
        for (const sub of subscriptions) {
            if (!sub.payment_id) {
                continue;
            }

            const payment = await PaymentTransaction.findByPk(sub.payment_id, {
                transaction
            });

            if (!payment) {
                continue;
            }

            summary.total_with_payment += 1;

            const subscriptionLessonsPerMonth = sub.weekly_lesson || null;
            const subscriptionLessonMinutes = sub.lesson_min || null;

            const currentLessonsPerMonth = payment.lessons_per_month || null;
            const currentLessonMinutes = payment.lesson_minutes || null;

            const lessonsPerMonthChanged =
                subscriptionLessonsPerMonth !== null &&
                subscriptionLessonsPerMonth !== currentLessonsPerMonth;

            const lessonMinutesChanged =
                subscriptionLessonMinutes !== null &&
                subscriptionLessonMinutes !== currentLessonMinutes;

            if (!lessonsPerMonthChanged && !lessonMinutesChanged) {
                continue;
            }

            summary.total_affected += 1;

            let updated = false;
            if (applyChanges && transaction) {
                const updateData = {};
                if (lessonsPerMonthChanged) {
                    updateData.lessons_per_month = subscriptionLessonsPerMonth;
                }
                if (lessonMinutesChanged) {
                    updateData.lesson_minutes = subscriptionLessonMinutes;
                }
                updateData.updated_at = new Date();

                await payment.update(updateData, { transaction });
                updated = true;
                summary.total_updated += 1;
            }

            summary.items.push({
                subscription_id: sub.id,
                user_id: sub.user_id,
                payment_id: sub.payment_id,
                payment_transaction_id: payment.id,
                renew_date: sub.renew_date,
                subscription_weekly_lesson: sub.weekly_lesson,
                subscription_lesson_min: sub.lesson_min,
                payment_lessons_per_month_before: currentLessonsPerMonth,
                payment_lesson_minutes_before: currentLessonMinutes,
                payment_lessons_per_month_after:
                    lessonsPerMonthChanged && applyChanges
                        ? subscriptionLessonsPerMonth
                        : currentLessonsPerMonth,
                payment_lesson_minutes_after:
                    lessonMinutesChanged && applyChanges
                        ? subscriptionLessonMinutes
                        : currentLessonMinutes,
                lessons_per_month_changed: lessonsPerMonthChanged,
                lesson_minutes_changed: lessonMinutesChanged,
                updated
            });
        }

        if (transaction) {
            await transaction.commit();
        }

        return {
            summary,
            message: applyChanges
                ? 'Payment transactions updated based on subscription lessons configuration'
                : 'Dry-run completed. No changes were applied (use POST /fix endpoint to apply).'
        };
    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        throw error;
    }
}

/**
 * Helper: safely parse PaymentTransaction.response_data into a JS object.
 */
function parsePaymentResponseData(raw) {
    if (!raw) return {};
    let parsed = raw;
    for (let i = 0; i < 2; i++) {
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch (e) {
                break;
            }
        } else {
            break;
        }
    }
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

/**
 * Helper: try to extract a human-readable item name from PayPlus response_data.
 * Handles both flat structures (direct fields) and nested structures.
 * Also attempts to decode more_info_5 if it contains base64-encoded JSON.
 */
function extractItemNameFromResponseData(responseData) {
    const rd = parsePaymentResponseData(responseData);
    if (!rd || typeof rd !== 'object') return null;

    const candidates = [];

    const pushIf = (val) => {
        if (val && typeof val === 'string' && val.trim().length > 0) {
            candidates.push(val.trim());
        }
    };

    // 1. Check flat structure (root level) - common in PayPlus direct responses
    pushIf(rd.item_name);
    pushIf(rd.itemName);
    pushIf(rd.item_description);
    pushIf(rd.description);

    // 2. Try to decode more_info_5 if it exists (base64-encoded JSON)
    if (rd.more_info_5 && typeof rd.more_info_5 === 'string') {
        try {
            // Try base64 decode first
            const decoded = Buffer.from(rd.more_info_5, 'base64').toString('utf-8');
            const parsed = JSON.parse(decoded);
            if (parsed && typeof parsed === 'object') {
                // Extract plan details that might help identify the item
                if (parsed.lpm) {
                    pushIf(`Lessons: ${parsed.lpm}/month`);
                }
                if (parsed.lm) {
                    pushIf(`Minutes: ${parsed.lm}`);
                }
                if (parsed.dt) {
                    pushIf(`Duration: ${parsed.dt}`);
                }
            }
        } catch (e) {
            // If base64 decode fails, try direct JSON parse
            try {
                const parsed = JSON.parse(rd.more_info_5);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.lpm) {
                        pushIf(`Lessons: ${parsed.lpm}/month`);
                    }
                }
            } catch (e2) {
                // Ignore parsing errors
            }
        }
    }

    // 3. Check nested structures (for webhook responses)
    if (rd.data) {
        pushIf(rd.data.item_name);
        pushIf(rd.data.itemName);
        pushIf(rd.data.item_description);
        // Check items array in data (common in PayPlus webhook responses)
        if (Array.isArray(rd.data.items) && rd.data.items.length > 0) {
            pushIf(rd.data.items[0]?.name);
            pushIf(rd.data.items[0]?.item_name);
            pushIf(rd.data.items[0]?.itemName);
            pushIf(rd.data.items[0]?.item_description);
        }
    }

    if (rd.transaction) {
        pushIf(rd.transaction.item_name);
        pushIf(rd.transaction.itemName);
        pushIf(rd.transaction.item_description);
    }

    if (rd.original_webhook) {
        const ow = rd.original_webhook;
        pushIf(ow.item_name);
        pushIf(ow.itemName);
        pushIf(ow.item_description);
        if (ow.data) {
            pushIf(ow.data.item_name);
            pushIf(ow.data.itemName);
        }
        if (ow.transaction) {
            pushIf(ow.transaction.item_name);
            pushIf(ow.transaction.itemName);
        }
        if (Array.isArray(ow.items) && ow.items.length > 0) {
            pushIf(ow.items[0]?.item_name);
            pushIf(ow.items[0]?.itemName);
            pushIf(ow.items[0]?.item_description);
        }
    }

    if (Array.isArray(rd.items) && rd.items.length > 0) {
        pushIf(rd.items[0]?.item_name);
        pushIf(rd.items[0]?.itemName);
        pushIf(rd.items[0]?.item_description);
    }

    // 4. Fallback: construct from available payment details
    if (candidates.length === 0) {
        const parts = [];
        if (rd.amount && rd.currency) {
            parts.push(`${rd.currency} ${rd.amount}`);
        }
        if (rd.more_info_1) {
            parts.push(`Plan ID: ${rd.more_info_1}`);
        }
        if (parts.length > 0) {
            candidates.push(parts.join(' - '));
        }
    }

    return candidates.length ? candidates[0] : null;
}

/**
 * Maintenance helper:
 * Fix subscription configuration based on previous subscription (same logic as handleMarch2026OnlineSubscriptionsPlanMismatch)
 * for subscriptions that:
 * - status = 'active'
 * - payment_status = 'online'
 * - is_cancel = 0
 * - renew_date between today and same day next month (UTC)
 * - payment_id IS NOT NULL
 *
 * Logic:
 * - For each matching subscription:
 *   - Find previous subscription for same user (most recent before current renew_date)
 *   - Compare current subscription.weekly_lesson / lesson_min with previous subscription
 *   - If plan changed (weekly_lesson or lesson_min differ):
 *     - Calculate deltaWeekly = previousWeekly - originalWeekly
 *     - If deltaWeekly > 0, add difference to left_lessons
 *     - Update subscription.weekly_lesson & lesson_min to match previous subscription
 *   - Extract item_name from payment for audit/debugging purposes
 *
 * Returns:
 *   { summary, message }
 */
async function handleUpcomingMonthSubscriptionFixFromPayments(applyChanges) {
    // Get today's date (e.g., if today is 15th, startDate = 15th 00:00:00)
    const today = moment.utc();
    const startDate = today.startOf('day').toDate();
    // Get same day next month (e.g., if today is 15th, endDate = 15th next month 23:59:59)
    const endDate = today.clone().add(1, 'month').endOf('day').toDate();

    const subscriptions = await UserSubscriptionDetails.findAll({
        where: {
            status: 'active',
            payment_status: 'online',
            is_cancel: 0,
            renew_date: {
                [Op.gte]: startDate,
                [Op.lte]: endDate
            },
            payment_id: {
                [Op.ne]: null
            }
        },
        order: [['user_id', 'ASC'], ['renew_date', 'ASC']]
    });

    const summary = {
        total_subscriptions_checked: subscriptions.length,
        total_with_previous_subscription: 0,
        total_affected: 0,
        total_updated: 0,
        total_payment_transactions_updated: 0,
        applyChanges: !!applyChanges,
        items: []
    };

    if (!subscriptions.length) {
        return {
            summary,
            message: 'No matching upcoming subscriptions found in the specified window'
        };
    }

    const transaction = applyChanges
        ? await UserSubscriptionDetails.sequelize.transaction()
        : null;

    try {
        for (const sub of subscriptions) {
            // Get payment transaction for updates and item_name extraction first
            let payment = null;
            let itemName = null;
            let paymentMoreInfo2 = null; // lesson_minutes from more_info_2
            let paymentMoreInfo3 = null; // lessons_per_month from more_info_3
            
            if (sub.payment_id) {
                try {
                    payment = await PaymentTransaction.findByPk(sub.payment_id, {
                        transaction
                    });
                    if (payment) {
                        itemName = extractItemNameFromResponseData(payment.response_data);
                        
                        // Extract more_info_2 and more_info_3 from response_data
                        const responseData = parsePaymentResponseData(payment.response_data);
                        if (responseData && typeof responseData === 'object') {
                            // Check root level
                            if (responseData.more_info_2 && responseData.more_info_2 !== null && responseData.more_info_2 !== '') {
                                paymentMoreInfo2 = parseInt(responseData.more_info_2) || null;
                            }
                            if (responseData.more_info_3 && responseData.more_info_3 !== null && responseData.more_info_3 !== '') {
                                paymentMoreInfo3 = parseInt(responseData.more_info_3) || null;
                            }
                            
                            // Check nested structures if not found at root
                            if (paymentMoreInfo2 === null && responseData.data?.more_info_2) {
                                paymentMoreInfo2 = parseInt(responseData.data.more_info_2) || null;
                            }
                            if (paymentMoreInfo3 === null && responseData.data?.more_info_3) {
                                paymentMoreInfo3 = parseInt(responseData.data.more_info_3) || null;
                            }
                            
                            if (paymentMoreInfo2 === null && responseData.transaction?.more_info_2) {
                                paymentMoreInfo2 = parseInt(responseData.transaction.more_info_2) || null;
                            }
                            if (paymentMoreInfo3 === null && responseData.transaction?.more_info_3) {
                                paymentMoreInfo3 = parseInt(responseData.transaction.more_info_3) || null;
                            }
                            
                            if (paymentMoreInfo2 === null && responseData.original_webhook?.more_info_2) {
                                paymentMoreInfo2 = parseInt(responseData.original_webhook.more_info_2) || null;
                            }
                            if (paymentMoreInfo3 === null && responseData.original_webhook?.more_info_3) {
                                paymentMoreInfo3 = parseInt(responseData.original_webhook.more_info_3) || null;
                            }
                        }
                    }
                } catch (error) {
                    // Ignore errors when extracting item name or more_info
                }
            }

            // Determine target values: use more_info_2/more_info_3 if available, otherwise use previous subscription
            let targetWeeklyLesson = null;
            let targetLessonMin = null;
            let source = null; // Track the source of values
            let previousSub = null;

            if (paymentMoreInfo3 !== null && paymentMoreInfo2 !== null) {
                // Use values from payment more_info fields (priority)
                targetWeeklyLesson = paymentMoreInfo3;
                targetLessonMin = paymentMoreInfo2;
                source = 'payment_more_info';
            } else {
                // Fall back to previous subscription - fetch it now
                previousSub = await UserSubscriptionDetails.findOne({
                    where: {
                        user_id: sub.user_id,
                        id: { [Op.ne]: sub.id },
                        renew_date: { [Op.lt]: sub.renew_date }
                    },
                    order: [['renew_date', 'DESC']],
                    transaction
                });

                if (!previousSub) {
                    // No source available, skip this subscription
                    continue;
                }

                summary.total_with_previous_subscription += 1;
                
                // Use previous subscription values
                targetWeeklyLesson = previousSub.weekly_lesson;
                targetLessonMin = previousSub.lesson_min;
                source = 'previous_subscription';
            }

            // Check if plan changed
            const planChanged =
                targetWeeklyLesson !== sub.weekly_lesson ||
                targetLessonMin !== sub.lesson_min;

            if (!planChanged) {
                continue;
            }

            const originalWeekly = sub.weekly_lesson || 0;
            const targetWeekly = targetWeeklyLesson || 0;
            const deltaWeekly = targetWeekly - originalWeekly;

            const currentLeft = sub.left_lessons || 0;
            let newLeftLessons = currentLeft;
            let newWeeklyLesson = targetWeeklyLesson;
            let newLessonMin = targetLessonMin;
            let updated = false;
            let paymentUpdated = false;
            let reason = '';

            // Get current payment values for comparison
            const currentPaymentLessonsPerMonth = payment?.lessons_per_month || null;
            const currentPaymentLessonMinutes = payment?.lesson_minutes || null;

            // Always update subscription to match previous subscription when plan changed
            if (deltaWeekly > 0) {
                // If weekly_lesson increased, add the difference to left_lessons
                newLeftLessons = currentLeft + deltaWeekly;
            }

            if (applyChanges && transaction) {
                await sub.update(
                    {
                        // Align core plan fields with target values (from payment more_info or previous subscription)
                        weekly_lesson: newWeeklyLesson,
                        lesson_min: newLessonMin,
                        left_lessons: newLeftLessons,
                        updated_at: new Date()
                    },
                    { transaction }
                );
                updated = true;
                summary.total_updated += 1;

                // Update PaymentTransaction to match subscription
                if (payment) {
                    const paymentUpdateData = {};
                    if (currentPaymentLessonsPerMonth !== newWeeklyLesson) {
                        paymentUpdateData.lessons_per_month = newWeeklyLesson;
                    }
                    if (currentPaymentLessonMinutes !== newLessonMin) {
                        paymentUpdateData.lesson_minutes = newLessonMin;
                    }
                    
                    if (Object.keys(paymentUpdateData).length > 0) {
                        paymentUpdateData.updated_at = new Date();
                        await payment.update(paymentUpdateData, { transaction });
                        paymentUpdated = true;
                        summary.total_payment_transactions_updated += 1;
                    }
                }

                const sourceText = source === 'payment_more_info' 
                    ? 'payment more_info fields (more_info_2, more_info_3)' 
                    : 'previous subscription';
                
                reason = deltaWeekly > 0
                    ? `Aligned plan with ${sourceText}: weekly_lesson ${originalWeekly}→${newWeeklyLesson}, lesson_min ${sub.lesson_min}→${newLessonMin}, and increased left_lessons by ${deltaWeekly}`
                    : `Aligned plan with ${sourceText}: weekly_lesson ${originalWeekly}→${newWeeklyLesson}, lesson_min ${sub.lesson_min}→${newLessonMin}`;
            } else {
                const sourceText = source === 'payment_more_info' 
                    ? 'payment more_info fields (more_info_2, more_info_3)' 
                    : 'previous subscription';
                
                reason = deltaWeekly > 0
                    ? `Would align plan with ${sourceText}: weekly_lesson ${originalWeekly}→${newWeeklyLesson}, lesson_min ${sub.lesson_min}→${newLessonMin}, and increase left_lessons by ${deltaWeekly}`
                    : `Would align plan with ${sourceText}: weekly_lesson ${originalWeekly}→${newWeeklyLesson}, lesson_min ${sub.lesson_min}→${newLessonMin}`;
            }

            summary.total_affected += 1;

            // Check regular classes for this student
            const regularClasses = await RegularClass.findAll({
                where: { student_id: sub.user_id },
                transaction
            });

            const regularClassUpdates = [];
            for (const regularClass of regularClasses) {
                // Check if classes are booked - matching logic from setMonthlyClasses.js
                // In setMonthlyClasses.js (line 728-738), it checks:
                // - student_id, teacher_id
                // - status: { [Op.ne]: 'canceled' } (not canceled)
                // - is_regular_hide: 0 (visible classes only)
                const classWhere = {
                    student_id: sub.user_id,
                    teacher_id: regularClass.teacher_id,
                    status: { [Op.ne]: 'canceled' },
                    is_regular_hide: 0
                };

                // Add batch_id filter if it exists in RegularClass (optional, like in setMonthlyClasses.js)
                if (regularClass.batch_id) {
                    classWhere.batch_id = regularClass.batch_id;
                }

                const bookedClassesCount = await Class.count({
                    where: classWhere,
                    transaction
                });

                if (bookedClassesCount === 0) {
                    // No classes booked - reset student_lesson_reset_at to one month earlier
                    const currentResetAt = moment.utc(regularClass.student_lesson_reset_at);
                    const newResetAt = currentResetAt.clone().subtract(1, 'month');

                    if (applyChanges && transaction) {
                        await regularClass.update(
                            {
                                student_lesson_reset_at: newResetAt.toDate(),
                                updated_at: new Date()
                            },
                            { transaction }
                        );
                        regularClassUpdates.push({
                            regular_class_id: regularClass.id,
                            teacher_id: regularClass.teacher_id,
                            batch_id: regularClass.batch_id,
                            booked_classes_count: bookedClassesCount,
                            old_student_lesson_reset_at: currentResetAt.format(),
                            new_student_lesson_reset_at: newResetAt.format(),
                            updated: true
                        });
                    } else {
                        regularClassUpdates.push({
                            regular_class_id: regularClass.id,
                            teacher_id: regularClass.teacher_id,
                            batch_id: regularClass.batch_id,
                            booked_classes_count: bookedClassesCount,
                            old_student_lesson_reset_at: currentResetAt.format(),
                            new_student_lesson_reset_at: newResetAt.format(),
                            updated: false
                        });
                    }
                } else {
                    // Classes are booked, log this info
                    regularClassUpdates.push({
                        regular_class_id: regularClass.id,
                        teacher_id: regularClass.teacher_id,
                        batch_id: regularClass.batch_id,
                        booked_classes_count: bookedClassesCount,
                        skipped: true,
                        reason: 'Classes are already booked for this batch'
                    });
                }
            }

            summary.items.push({
                subscription_id: sub.id,
                user_id: sub.user_id,
                payment_id: sub.payment_id,
                payment_transaction_id: payment?.id || null,
                renew_date: sub.renew_date,
                item_name: itemName,
                source: source, // 'payment_more_info' or 'previous_subscription'
                payment_more_info_2: paymentMoreInfo2, // lesson_minutes from more_info_2
                payment_more_info_3: paymentMoreInfo3, // lessons_per_month from more_info_3
                current_weekly_lesson: sub.weekly_lesson,
                target_weekly_lesson: newWeeklyLesson,
                current_lesson_min: sub.lesson_min,
                target_lesson_min: newLessonMin,
                previous_subscription_weekly_lesson: previousSub?.weekly_lesson || null,
                previous_subscription_lesson_min: previousSub?.lesson_min || null,
                previous_left_lessons: currentLeft,
                delta_weekly_lessons: deltaWeekly,
                new_weekly_lesson: newWeeklyLesson,
                new_lesson_min: newLessonMin,
                new_left_lessons: newLeftLessons,
                updated,
                payment_updated: paymentUpdated,
                payment_lessons_per_month_before: currentPaymentLessonsPerMonth,
                payment_lesson_minutes_before: currentPaymentLessonMinutes,
                payment_lessons_per_month_after: paymentUpdated ? newWeeklyLesson : currentPaymentLessonsPerMonth,
                payment_lesson_minutes_after: paymentUpdated ? newLessonMin : currentPaymentLessonMinutes,
                reason,
                regular_classes_checked: regularClasses.length,
                regular_classes_updated: regularClassUpdates.length,
                regular_class_updates: regularClassUpdates
            });
        }

        if (transaction) {
            await transaction.commit();
        }

        return {
            summary,
            message: applyChanges
                ? 'Affected subscriptions processed and left_lessons updated where applicable'
                : 'Dry-run completed. No changes were applied (use POST /fix endpoint to apply).'
        };
    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        throw error;
    }
}

/**
 * GET (no auth): Preview upcoming month subscription/payment mismatches.
 */
const getUpcomingMonthSubscriptionFixFromPayments = async (req, res) => {
    try {
        const { summary, message } =
            await handleUpcomingMonthSubscriptionFixFromPayments(false);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error(
            'Error in getUpcomingMonthSubscriptionFixFromPayments:',
            error
        );
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to fetch upcoming month subscription/payment mismatch data',
            details: error.message
        });
    }
};

/**
 * POST (no auth): Apply upcoming month subscription/payment fix.
 */
const fixUpcomingMonthSubscriptionFromPayments = async (req, res) => {
    try {
        const { summary, message } =
            await handleUpcomingMonthSubscriptionFixFromPayments(true);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error(
            'Error in fixUpcomingMonthSubscriptionFromPayments:',
            error
        );
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to apply upcoming month subscription/payment fix',
            details: error.message
        });
    }
};

/**
 * GET (no auth): Preview March 2026 payment lesson config mismatches.
 */
const getMarch2026PaymentLessonFix = async (req, res) => {
    try {
        const { summary, message } =
            await handleMarch2026PaymentLessonFix(false);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error('Error in getMarch2026PaymentLessonFix:', error);
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to fetch March 2026 payment/subscription lesson mismatch data',
            details: error.message
        });
    }
};

/**
 * POST (no auth): Apply March 2026 payment lesson config fix.
 */
const fixMarch2026PaymentLessonConfig = async (req, res) => {
    try {
        const { summary, message } =
            await handleMarch2026PaymentLessonFix(true);

        return res.status(200).json({
            status: 'success',
            data: summary,
            message
        });
    } catch (error) {
        console.error('Error in fixMarch2026PaymentLessonConfig:', error);
        return res.status(500).json({
            status: 'error',
            message:
                'Failed to apply March 2026 payment/subscription lesson config fix',
            details: error.message
        });
    }
};

/**
 * Get all payment transactions with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentTransactions = async (req, res) => {
    try {
        const { 
            search, 
            status,
            plan_id,
            lesson_duration,
            payment_type,
            appointment_setter,
            sales_agent,
            stage,
            date_from,
            date_to,
            page = 1, 
            limit = 10
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        const whereConditions = {};
        
        // Add enhanced search conditions if provided
        if (search) {
            const searchConditions = buildSearchConditions(search);
            Object.assign(whereConditions, searchConditions);
        }
        
        // Add status filter if provided (this is different from stage)
        if (status && status !== 'all') {
            whereConditions.status = status;
        }
        
        // Add plan filter if provided
        if (plan_id && plan_id !== 'all') {
            whereConditions.plan_id = plan_id;
        }
        
        // Add lesson duration filter if provided
        if (lesson_duration && lesson_duration !== 'all') {
            whereConditions.lesson_minutes = lesson_duration;
        }
        
        // Add payment type filter if provided
        if (payment_type && payment_type !== 'all') {
            whereConditions.payment_method = payment_type;
        }
        
        // Add stage filter if provided - this is the key fix
        if (stage && stage !== 'all') {
            const stageConditions = getStageWhereConditions(stage);
            Object.assign(whereConditions, stageConditions);
        }
        
        // Add date range filter if provided
        if (date_from && date_to) {
            whereConditions.created_at = {
                [Op.between]: [
                    moment(date_from).startOf('day').format('YYYY-MM-DD HH:mm:ss'),
                    moment(date_to).endOf('day').format('YYYY-MM-DD HH:mm:ss')
                ]
            };
        } else if (date_from) {
            whereConditions.created_at = {
                [Op.gte]: moment(date_from).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            };
        } else if (date_to) {
            whereConditions.created_at = {
                [Op.lte]: moment(date_to).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            };
        }
        
        // Define the Generator/appointment setter include condition
        const generatorInclude = {
            model: User,
            as: 'Generator',
            attributes: ['id', 'full_name', 'email', 'role_name'],
            required: false // Important: use LEFT JOIN so we don't exclude records without appointment setter
        };
        
        // Add appointment setter filter if provided (this is separate from stage filtering)
        if (appointment_setter && appointment_setter !== 'all') {
            generatorInclude.where = { id: appointment_setter };
            generatorInclude.required = true; // Change to INNER JOIN when filtering by specific setter
        }
        
        // Create include array for associations
        const includeArray = [
            {
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                required: false
            },
            {
                model: User,
                as: 'Generator', // Sales closer
                attributes: ['id', 'full_name', 'email', 'role_name'],
                required: false
            },

            generatorInclude,
            {
                model: SubscriptionPlan,
                as: 'Plan',
                attributes: ['id', 'name', 'price'],
                required: false,
                include: [
                    {
                        model: LessonLength,
                        as: 'LessonLength',
                        attributes: ['minutes'],
                        required: false
                    },
                    {
                        model: LessonsPerMonth,
                        as: 'LessonsPerMonth',
                        attributes: ['lessons'],
                        required: false
                    }
                ]
            },
            {
                model: SubscriptionDuration,
                as: 'Duration',
                attributes: ['id', 'name', 'months'],
                required: false
            }
        ];
        
        // Add sales agent filter - this needs special handling
        if (sales_agent && sales_agent !== 'all') {
            whereConditions.generated_by = sales_agent;
        }
        
        console.log('Final where conditions:', JSON.stringify(whereConditions, null, 2));
        
        // Find payment transactions with all included associations
        const transactions = await PaymentTransaction.findAndCountAll({
            where: whereConditions,
            include: includeArray,
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', 'DESC']]
        });
        
        console.log(`Found ${transactions.count} transactions`);
        
        // Calculate payment sequences for all transactions
        const sequenceMap = await batchCalculatePaymentSequences(transactions.rows);
        
        // Get trial class registrations for all student emails in batch
        const studentEmails = [...new Set(transactions.rows.map(t => t.student_email).filter(Boolean))];
        
        const trialRegistrations = await TrialClassRegistration.findAll({
            where: {
                email: { [Op.in]: studentEmails }
            },
            include: [
                {
                    model: User,
                    as: 'salesAgent', // Using existing association from associations.js
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'salesUserTransferred', // Using existing association from associations.js
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                }
            ]
        });
        
        // Create a map of email to trial registration (use the most recent one if multiple)
        const trialRegistrationMap = {};
        trialRegistrations.forEach(trial => {
            if (!trialRegistrationMap[trial.email] || 
                new Date(trial.created_at) > new Date(trialRegistrationMap[trial.email].created_at)) {
                trialRegistrationMap[trial.email] = trial;
            }
        });
        
        console.log(`Found trial registrations for ${Object.keys(trialRegistrationMap).length} emails`);
        
        // Format the response with enhanced plan display and payment sequence
        const formattedTransactions = transactions.rows.map(transaction => {
            const transactionStage = getPaymentStage(transaction);
            const paymentSequence = sequenceMap[transaction.id] || 1;
            const trialData = trialRegistrationMap[transaction.student_email];

            // // Determine setter and sales based on trial data
            // let setterInfo = null;
            // let salesInfo = null;

            // if (trialData) {
            //     // Setter is the one who booked (booked_by) - using 'salesAgent' alias
            //     if (trialData.salesAgent) {
            //         setterInfo = {
            //             id: trialData.salesAgent.id,
            //             name: trialData.salesAgent.full_name,
            //             email: trialData.salesAgent.email,
            //             role: trialData.salesAgent.role_name
            //         };
            //     }

            //     // Sales is the one it was transferred to (transferred_to) - using 'salesUserTransferred' alias
            //     if (trialData.transferred_to && trialData.salesUserTransferred) {
            //         salesInfo = {
            //             id: trialData.salesUserTransferred.id,
            //             name: trialData.salesUserTransferred.full_name,
            //             email: trialData.salesUserTransferred.email,
            //             role: trialData.salesUserTransferred.role_name
            //         };
            //     }
            // }

            // // Fallback to Generator if no trial data
            // if (!setterInfo && transaction.Generator) {
            //     setterInfo = {
            //         id: transaction.Generator.id,
            //         name: transaction.Generator.full_name,
            //         email: transaction.Generator.email,
            //         role: transaction.Generator.role_name
            //     };
            // }

            let trialBookedBy = null;
            let saleClosedBy = null;

            // 1️⃣ TRIAL BOOKED BY
            if (trialData?.salesAgent) {
                trialBookedBy = {
                    id: trialData.salesAgent.id,
                    name: trialData.salesAgent.full_name,
                    email: trialData.salesAgent.email,
                    role: trialData.salesAgent.role_name
                };
            } else {
                trialBookedBy = 'Self-registered';
            }

            // 2️⃣ SALE CLOSED BY (generated_by user)
            if (transaction.Generator) {
                saleClosedBy = {
                    id: transaction.Generator.id,
                    name: transaction.Generator.full_name,
                    email: transaction.Generator.email,
                    role: transaction.Generator.role_name
                };
            } else {
                saleClosedBy = 'Self-registered';
            }

            return {
                id: transaction.id,
                transaction_id: transaction.transaction_id,
                token: transaction.token,
                date: moment(transaction.created_at).format('YYYY-MM-DD HH:mm:ss'), // Include time
                student: {
                    id: transaction.Student ? transaction.Student.id : null,
                    name: transaction.student_name,
                    email: transaction.student_email,
                    mobile: transaction.Student ? transaction.Student.mobile : null,
                    country_code: transaction.Student ? transaction.Student.country_code : null
                },
                plan: {
                    id: transaction.Plan ? transaction.Plan.id : null,
                    name: transaction.Plan ? transaction.Plan.name : 'Custom Plan',
                    duration: transaction.Duration ? transaction.Duration.name : null,
                    minutes: transaction.lesson_minutes,
                    lessons_per_month: transaction.lessons_per_month,
                    // Enhanced display format
                    display_name: formatPlanDisplay(transaction.Plan, transaction.Plan?.LessonLength, transaction.Plan?.LessonsPerMonth, transaction.Duration)
                },
                amount: parseFloat(transaction.amount),
                currency: transaction.currency,
                is_recurring: transaction.is_recurring,
                payment_sequence: paymentSequence,
                // appointment_setter: setterInfo || 'Direct',
                // sales_agent: salesInfo, // This will be null if not transferred
                lead_ownership: {
                    trial_booked_by: trialBookedBy,
                    sale_closed_by: saleClosedBy
                },
                payment_method: transaction.payment_method,
                card_last_digits: transaction.card_last_digits,
                status: transaction.status,
                error_code: transaction.error_code,
                error_message: transaction.error_message,
                stage: transactionStage
            };
        });
        
        return res.status(200).json({
            status: 'success',
            data: formattedTransactions,
            pagination: {
                total: transactions.count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(transactions.count / parseInt(limit))
            },
            message: 'Payment transactions retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching payment transactions:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment transaction by ID with enhanced formatting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentTransactionById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const transaction = await PaymentTransaction.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    required: false
                },
                {
                    model: User,
                    as: 'Generator',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: SubscriptionPlan,
                    as: 'Plan',
                    attributes: ['id', 'name', 'price'],
                    required: false,
                    include: [
                        {
                            model: LessonLength,
                            as: 'LessonLength',
                            attributes: ['minutes'],
                            required: false
                        },
                        {
                            model: LessonsPerMonth,
                            as: 'LessonsPerMonth',
                            attributes: ['lessons'],
                            required: false
                        }
                    ]
                },
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months'],
                    required: false
                }
            ]
        });
        
        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found'
            });
        }
        
        // Calculate payment sequence for this transaction
        const paymentSequence = await calculatePaymentSequence(
            transaction, 
            transaction.student_email, 
            transaction.plan_id
        );
        
        // Get trial class registration to find setter and sales agent
        const trialData = await TrialClassRegistration.findOne({
            where: { email: transaction.student_email },
            include: [
                {
                    model: User,
                    as: 'salesAgent', // The person who booked (setter)
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'salesUserTransferred', // The person it was transferred to (sales)
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });
        
        // Determine setter and sales based on trial data
        let setterInfo = null;
        let salesInfo = null;
        
        if (trialData) {
            // Setter is the one who booked (booked_by)
            if (trialData.salesAgent) {
                setterInfo = {
                    id: trialData.salesAgent.id,
                    name: trialData.salesAgent.full_name,
                    email: trialData.salesAgent.email,
                    role: trialData.salesAgent.role_name
                };
            }
            
            // Sales is the one it was transferred to (transferred_to)
            if (trialData.transferred_to && trialData.salesUserTransferred) {
                salesInfo = {
                    id: trialData.salesUserTransferred.id,
                    name: trialData.salesUserTransferred.full_name,
                    email: trialData.salesUserTransferred.email,
                    role: trialData.salesUserTransferred.role_name
                };
            }
        }
        
        // Fallback to Generator if no trial data
        if (!setterInfo && transaction.Generator) {
            setterInfo = {
                id: transaction.Generator.id,
                name: transaction.Generator.full_name,
                email: transaction.Generator.email,
                role: transaction.Generator.role_name
            };
        }
        
        // Format the response
        const formattedTransaction = {
            id: transaction.id,
            transaction_id: transaction.transaction_id,
            token: transaction.token,
            date: moment(transaction.created_at).format('YYYY-MM-DD HH:mm:ss'),
            student: {
                id: transaction.Student ? transaction.Student.id : null,
                name: transaction.student_name,
                email: transaction.student_email,
                mobile: transaction.Student ? transaction.Student.mobile : null,
                country_code: transaction.Student ? transaction.Student.country_code : null
            },
            plan: {
                id: transaction.Plan ? transaction.Plan.id : null,
                name: transaction.Plan ? transaction.Plan.name : 'Custom Plan',
                duration: transaction.Duration ? transaction.Duration.name : null,
                minutes: transaction.lesson_minutes,
                lessons_per_month: transaction.lessons_per_month,
                display_name: formatPlanDisplay(
                    transaction.Plan,
                    transaction.Plan?.LessonLength,
                    transaction.Plan?.LessonsPerMonth,
                    transaction.Duration
                )
            },
            amount: parseFloat(transaction.amount),
            currency: transaction.currency,
            is_recurring: transaction.is_recurring,
            payment_sequence: paymentSequence,
            appointment_setter: setterInfo || 'Direct',
            sales_agent: salesInfo, // This will be null if not transferred
            payment_method: transaction.payment_method,
            card_last_digits: transaction.card_last_digits,
            status: transaction.status,
            refund_amount: transaction.refund_amount ? parseFloat(transaction.refund_amount) : null,
            refund_type: transaction.refund_type || null,
            refund_reason: transaction.refund_reason || null,
            refund_date: transaction.refund_date ? moment(transaction.refund_date).format() : null,
            error_code: transaction.error_code,
            error_message: transaction.error_message,
            response_data: transaction.response_data,
            stage: getPaymentStage(transaction),
            created_at: moment(transaction.created_at).format(),
            updated_at: moment(transaction.updated_at).format()
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedTransaction
        });
        
    } catch (error) {
        console.error('Error fetching payment transaction details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentStatistics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let fromDate;
        const toDate = moment().endOf('day');
        
        // Set the fromDate based on period
        if (period === 'week') {
            fromDate = moment().subtract(7, 'days').startOf('day');
        } else if (period === 'month') {
            fromDate = moment().subtract(1, 'month').startOf('day');
        } else if (period === 'quarter') {
            fromDate = moment().subtract(3, 'months').startOf('day');
        } else if (period === 'year') {
            fromDate = moment().subtract(1, 'year').startOf('day');
        } else {
            fromDate = moment().subtract(1, 'month').startOf('day'); // Default to month
        }
        
        // Get previous period for comparison
        const previousFromDate = moment(fromDate).subtract(moment.duration(toDate.diff(fromDate)));
        const previousToDate = moment(fromDate).subtract(1, 'day').endOf('day');
        
        // Current period total revenue
        const totalRevenue = await PaymentTransaction.sum('amount', {
            where: {
                status: 'success',
                created_at: {
                    [Op.between]: [
                        fromDate.format('YYYY-MM-DD HH:mm:ss'),
                        toDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        // Previous period total revenue for comparison
        const previousTotalRevenue = await PaymentTransaction.sum('amount', {
            where: {
                status: 'success',
                created_at: {
                    [Op.between]: [
                        previousFromDate.format('YYYY-MM-DD HH:mm:ss'),
                        previousToDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        // Calculate percentage change
        const revenueChange = previousTotalRevenue > 0 
            ? ((totalRevenue - previousTotalRevenue) / previousTotalRevenue) * 100 
            : 100;
        
        // Active subscriptions count
        const activeSubscriptions = await sequelize.query(`
            SELECT COUNT(DISTINCT user_id) as count
            FROM user_subscription_details
            WHERE status = 'active'
        `, { type: sequelize.QueryTypes.SELECT });
        
        // Previous period active subscriptions count
        const previousActiveSubscriptions = await sequelize.query(`
            SELECT COUNT(DISTINCT user_id) as count
            FROM user_subscription_details
            WHERE status = 'active'
            AND created_at < '${fromDate.format('YYYY-MM-DD HH:mm:ss')}'
        `, { type: sequelize.QueryTypes.SELECT });
        
        // Calculate percentage change
        const subscriptionsChange = previousActiveSubscriptions[0].count > 0 
            ? ((activeSubscriptions[0].count - previousActiveSubscriptions[0].count) / previousActiveSubscriptions[0].count) * 100 
            : 100;
        
        // New students count
        const newStudents = await User.count({
            where: {
                role_name: 'user',
                created_at: {
                    [Op.between]: [
                        fromDate.format('YYYY-MM-DD HH:mm:ss'),
                        toDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        // Previous period new students count
        const previousNewStudents = await User.count({
            where: {
                role_name: 'user',
                created_at: {
                    [Op.between]: [
                        previousFromDate.format('YYYY-MM-DD HH:mm:ss'),
                        previousToDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        // Calculate percentage change
        const studentsChange = previousNewStudents > 0 
            ? ((newStudents - previousNewStudents) / previousNewStudents) * 100 
            : 100;
        
        // Payment success rate
        const totalPayments = await PaymentTransaction.count({
            where: {
                created_at: {
                    [Op.between]: [
                        fromDate.format('YYYY-MM-DD HH:mm:ss'),
                        toDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        const successfulPayments = await PaymentTransaction.count({
            where: {
                status: 'success',
                created_at: {
                    [Op.between]: [
                        fromDate.format('YYYY-MM-DD HH:mm:ss'),
                        toDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        const paymentSuccessRate = totalPayments > 0 
            ? (successfulPayments / totalPayments) * 100 
            : 0;
        
        // Previous period payment success rate
        const previousTotalPayments = await PaymentTransaction.count({
            where: {
                created_at: {
                    [Op.between]: [
                        previousFromDate.format('YYYY-MM-DD HH:mm:ss'),
                        previousToDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        const previousSuccessfulPayments = await PaymentTransaction.count({
            where: {
                status: 'success',
                created_at: {
                    [Op.between]: [
                        previousFromDate.format('YYYY-MM-DD HH:mm:ss'),
                        previousToDate.format('YYYY-MM-DD HH:mm:ss')
                    ]
                }
            }
        });
        
        const previousPaymentSuccessRate = previousTotalPayments > 0 
            ? (previousSuccessfulPayments / previousTotalPayments) * 100 
            : 0;
        
        // Calculate percentage change
        const successRateChange = previousPaymentSuccessRate > 0 
            ? ((paymentSuccessRate - previousPaymentSuccessRate) / previousPaymentSuccessRate) * 100 
            : 0;
        
        // Sales funnel data - calculate each stage using the same logic as filtering
        const dateCondition = {
            created_at: {
                [Op.between]: [
                    fromDate.format('YYYY-MM-DD HH:mm:ss'),
                    toDate.format('YYYY-MM-DD HH:mm:ss')
                ]
            }
        };
        
        const trialBooked = await PaymentTransaction.count({
            where: {
                ...dateCondition,
                ...getStageWhereConditions('trial-booked')
            }
        });
        
        const transferred = await PaymentTransaction.count({
            where: {
                ...dateCondition,
                ...getStageWhereConditions('transferred')
            }
        });
        
        const approved = await PaymentTransaction.count({
            where: {
                ...dateCondition,
                ...getStageWhereConditions('approved')
            }
        });
        
        const linkSent = await PaymentTransaction.count({
            where: {
                ...dateCondition,
                ...getStageWhereConditions('link-sent')
            }
        });
        
        const completed = await PaymentTransaction.count({
            where: {
                ...dateCondition,
                ...getStageWhereConditions('completed')
            }
        });
        
        return res.status(200).json({
            status: 'success',
            data: {
                totalRevenue: {
                    value: totalRevenue || 0,
                    change: revenueChange.toFixed(2)
                },
                activeSubscriptions: {
                    value: activeSubscriptions[0].count,
                    change: subscriptionsChange.toFixed(2)
                },
                newStudents: {
                    value: newStudents,
                    change: studentsChange.toFixed(2)
                },
                paymentSuccessRate: {
                    value: paymentSuccessRate.toFixed(2),
                    change: successRateChange.toFixed(2)
                },
                salesFunnel: {
                    trialBooked,
                    transferred,
                    approved,
                    linkSent,
                    completed
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching payment statistics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update payment transaction status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updatePaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        if (!status || !['success', 'failed', 'pending', 'refunded'].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid payment status'
            });
        }
        
        const transaction = await PaymentTransaction.findByPk(id);
        
        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found'
            });
        }
        
        // Update transaction status
        await transaction.update({
            status,
            admin_notes: notes,
            updated_by: req.user?.id || 'admin',
            updated_at: new Date()
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Payment status updated successfully',
            data: {
                id: transaction.id,
                status: transaction.status
            }
        });
        
    } catch (error) {
        console.error('Error updating payment status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment filters options
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentFilters = async (req, res) => {
    try {
        // Get all available plans
        const plans = await SubscriptionPlan.findAll({
            where: { status: 'active' },
            attributes: ['id', 'name'],
            order: [['name', 'ASC']]
        });
        
        // Get all available lesson durations
        const lessonDurations = await LessonLength.findAll({
            where: { status: 'active' },
            attributes: ['id', 'minutes'],
            group: ['minutes'],
            order: [['minutes', 'ASC']]
        });
        
        // Get all sales agents
        const salesAgents = await User.findAll({
            where: {
                role_name: 'sales',
                status: 'active'
            },
            attributes: ['id', 'full_name'],
            order: [['full_name', 'ASC']]
        });
        
        // Get payment statuses
        const statuses = [
            { id: 'success', name: 'Completed' },
            { id: 'pending', name: 'Pending' },
            { id: 'failed', name: 'Failed' },
            { id: 'refunded', name: 'Refunded' }
        ];
        
        // Get payment types
        const paymentTypes = [
            { id: 'credit_card', name: 'Credit Card' },
            { id: 'paypal', name: 'PayPal' },
            { id: 'bank_transfer', name: 'Bank Transfer' },
            { id: 'cash', name: 'Cash' }
        ];
        
        return res.status(200).json({
            status: 'success',
            data: {
                plans: plans.map(plan => ({ id: plan.id, name: plan.name })),
                lessonDurations: lessonDurations.map(duration => ({ id: duration.id, minutes: duration.minutes })),
                salesAgents: salesAgents.map(agent => ({ id: agent.id, name: agent.full_name })),
                statuses,
                paymentTypes
            }
        });
        
    } catch (error) {
        console.error('Error fetching payment filters:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const exportPaymentTransactions = async (req, res) => {
    try {
        const { search, status, plan_id, lesson_duration, payment_type, appointment_setter, sales_agent, stage, date_from, date_to } = req.query;

        // Build where conditions (same as in getPaymentTransactions)
        const whereConditions = {};

        if (search) {
            const searchConditions = buildSearchConditions(search);
            Object.assign(whereConditions, searchConditions);
        }

        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        if (plan_id && plan_id !== 'all') {
            whereConditions.plan_id = plan_id;
        }

        if (lesson_duration && lesson_duration !== 'all') {
            whereConditions.lesson_minutes = lesson_duration;
        }

        if (payment_type && payment_type !== 'all') {
            whereConditions.payment_method = payment_type;
        }

        if (stage && stage !== 'all') {
            const stageConditions = getStageWhereConditions(stage);
            Object.assign(whereConditions, stageConditions);
        }

        if (date_from && date_to) {
            whereConditions.created_at = {
                [Op.between]: [moment(date_from).startOf('day').format('YYYY-MM-DD HH:mm:ss'), moment(date_to).endOf('day').format('YYYY-MM-DD HH:mm:ss')]
            };
        } else if (date_from) {
            whereConditions.created_at = {
                [Op.gte]: moment(date_from).startOf('day').format('YYYY-MM-DD HH:mm:ss')
            };
        } else if (date_to) {
            whereConditions.created_at = {
                [Op.lte]: moment(date_to).endOf('day').format('YYYY-MM-DD HH:mm:ss')
            };
        }

        // Define the Generator/appointment setter include condition
        const generatorInclude = {
            model: User,
            as: 'Generator',
            attributes: ['id', 'full_name', 'email', 'role_name'],
            required: false
        };

        if (appointment_setter && appointment_setter !== 'all') {
            generatorInclude.where = { id: appointment_setter };
            generatorInclude.required = true;
        }

        // Fetch all payment transactions (no pagination for export)
        const transactions = await PaymentTransaction.findAll({
            where: whereConditions,
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    required: false
                },
                generatorInclude,
                {
                    model: SubscriptionPlan,
                    as: 'Plan',
                    attributes: ['id', 'name', 'price'],
                    required: false,
                    include: [
                        {
                            model: LessonLength,
                            as: 'LessonLength',
                            attributes: ['minutes'],
                            required: false
                        },
                        {
                            model: LessonsPerMonth,
                            as: 'LessonsPerMonth',
                            attributes: ['lessons'],
                            required: false
                        }
                    ]
                },
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Calculate payment sequences for export
        const sequenceMap = await batchCalculatePaymentSequences(transactions);

        // ---------------------------
        // GET TRIAL REGISTRATIONS
        // ---------------------------

        // Collect all student emails
        const studentEmails = [...new Set(transactions.map((t) => t.student_email).filter(Boolean))];

        const trialRegistrations = await TrialClassRegistration.findAll({
            where: {
                email: { [Op.in]: studentEmails }
            },
            include: [
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'salesUserTransferred',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                }
            ]
        });

        // Map most recent trial per email
        const trialMap = {};
        trialRegistrations.forEach((trial) => {
            if (!trialMap[trial.email] || new Date(trial.created_at) > new Date(trialMap[trial.email].created_at)) {
                trialMap[trial.email] = trial;
            }
        });

        // Map transactions to CSV format with payment sequence
        const csvData = transactions.map((transaction) => {
            const transactionStage = getPaymentStage(transaction);
            const amount = parseFloat(transaction.amount);
            const currency = transaction.currency;
            const paymentSequence = sequenceMap[transaction.id] || 1;

            // Format payment sequence text
            const getSequenceText = (seq, isRecurring) => {
                if (!isRecurring) return 'One-time';
                if (seq === 1) return '1st payment';
                if (seq === 2) return '2nd payment';
                if (seq === 3) return '3rd payment';
                return `${seq}th payment`;
            };

            const trialData = trialMap[transaction.student_email];

            // ----------- TRIAL BOOKED BY -----------
            let trialBookedBy = 'Self-registered';
            if (trialData?.salesAgent) {
                trialBookedBy = trialData.salesAgent.full_name;
            }

            // ----------- SALE CLOSED BY -----------
            let saleClosedBy = 'Self-registered';
            if (transaction.Generator) {
                saleClosedBy = transaction.Generator.full_name;
            }

            return [
                // Basic transaction info
                transaction.transaction_id || '',
                moment(transaction.created_at).format('YYYY-MM-DD'),
                moment(transaction.created_at).format('HH:mm:ss'),

                // Student info
                transaction.student_name || '',
                transaction.student_email || '',
                transaction.Student?.mobile || '',

                // Plan info
                formatPlanDisplay(transaction.Plan, transaction.Plan?.LessonLength, transaction.Plan?.LessonsPerMonth, transaction.Duration),
                transaction.lesson_minutes || '',
                transaction.lessons_per_month || '',

                // Financial info - the key columns you requested
                amount.toFixed(2),
                currency.toUpperCase(),
                transaction.converted_amount_ils ? parseFloat(transaction.converted_amount_ils).toFixed(2) : '',
                transaction.conversion_rate ? parseFloat(transaction.conversion_rate).toFixed(4) : '',
                transaction.conversion_date ? moment(transaction.conversion_date).format('YYYY-MM-DD') : '',

                // Payment sequence info
                paymentSequence,
                transaction.is_recurring ? 'Yes' : 'No',
                getSequenceText(paymentSequence, transaction.is_recurring),

                // Additional info
                transaction.payment_method || '',
                transaction.card_last_digits || '',

                // Lead ownership
                // transaction.Generator ? transaction.Generator.full_name : 'Direct',
                // transaction.Generator ? transaction.Generator.email : '',
                // transaction.Generator ? transaction.Generator.role_name : '',

                trialBookedBy,
                saleClosedBy,

                // Status and stage
                transactionStage,
                transaction.status,

                // Error info
                transaction.error_code || '',
                transaction.error_message || ''
            ];
        });

        // CSV headers
        const csvHeaders = [
            'Transaction ID',
            'Date',
            'Time',
            'Student Name',
            'Student Email',
            'Student Phone',
            'Plan Details',
            'Lesson Minutes',
            'Lessons Per Month',
            'Amount',
            'Currency',
            'Converted Amount ILS',
            'Conversion Rate',
            'Conversion Date',
            'Payment Sequence Number',
            'Is Recurring',
            'Payment Sequence Description',
            'Payment Method',
            'Card Last Digits',
            // 'Appointment Setter Name',
            // 'Appointment Setter Email',
            // 'Appointment Setter Role',
            'Trial Booked By',
            'Sale Closed By',
            'Stage',
            'Status',
            'Error Code',
            'Error Message'
        ];

        // Combine headers and data
        const csvContent = [csvHeaders, ...csvData]
            .map((row) =>
                row
                    .map((cell) =>
                        // Escape commas and quotes in CSV
                        typeof cell === 'string' && (cell.includes(',') || cell.includes('"')) ? `"${cell.replace(/"/g, '""')}"` : cell
                    )
                    .join(',')
            )
            .join('\n');

        // Set response headers
        const filename = `payment-transactions-${moment().format('YYYY-MM-DD-HHmm')}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

        // Add BOM for proper UTF-8 encoding in Excel
        const BOM = '\uFEFF';
        return res.send(BOM + csvContent);
    } catch (error) {
        console.error('Error exporting payment transactions:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Download invoice for a payment transaction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'original', format = 'pdf' } = req.query;

    // Find the payment transaction
    const paymentTransaction = await PaymentTransaction.findByPk(id);
    
    if (!paymentTransaction) {
      return res.status(404).json({
        status: 'error',
        message: 'Payment transaction not found'
      });
    }

    const transaction_uid = paymentTransaction.transaction_id || paymentTransaction.token;

    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      return res.status(400).json({
        status: 'error',
        message: 'Transaction UID not available for this payment'
      });
    }

    // Validate type parameter
    if (!['original', 'copy'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Type must be either "original" or "copy"'
      });
    }

    console.log(`Downloading ${type} invoice for payment ${id}, transaction: ${transaction_uid}`);

    // Get invoice documents from PayPlus
    const payplusUrl = `${process.env.PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
    const requestData = {
      transaction_uid: transaction_uid,
      filter: {}
    };

    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.PAYPLUS_API_KEY,
      'secret-key': process.env.PAYPLUS_SECRET_KEY
    };

    // Get invoice documents
    const response = await axios.post(payplusUrl, requestData, { 
      headers,
      timeout: 30000
    });

    if (response.status !== 200 || !response.data || !response.data.invoices || response.data.invoices.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No invoice documents found for this payment',
        payment_id: id,
        transaction_uid: transaction_uid
      });
    }

    // Find the first successful invoice
    const invoice = response.data.invoices.find(inv => inv.status === 'success');
    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'No successful invoice found for this payment',
        payment_id: id,
        transaction_uid: transaction_uid
      });
    }

    // Get the appropriate download URL
    const downloadUrl = type === 'original' ? invoice.original_doc_url : invoice.copy_doc_url;
    
    if (!downloadUrl) {
      return res.status(404).json({
        status: 'error',
        message: `${type} document URL not available for this invoice`,
        payment_id: id,
        transaction_uid: transaction_uid,
        available_types: {
          original: !!invoice.original_doc_url,
          copy: !!invoice.copy_doc_url
        }
      });
    }

    console.log(`Found ${type} document URL for payment ${id}`);

    // Download the document from PayPlus
    const documentResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'api-key': process.env.PAYPLUS_API_KEY,
        'secret-key': process.env.PAYPLUS_SECRET_KEY
      }
    });

    if (documentResponse.status !== 200) {
      throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
    }

    // Set response headers for file download
    const contentType = documentResponse.headers['content-type'] || 'application/pdf';
    const filename = `invoice_${paymentTransaction.transaction_id}_${type}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`Streaming invoice document: ${filename}`);

    // Stream the document to the client
    documentResponse.data.pipe(res);

    // Handle stream errors
    documentResponse.data.on('error', (error) => {
      console.error(`Error streaming invoice document:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Error streaming invoice document',
          details: error.message
        });
      }
    });

  } catch (error) {
    console.error(`Error downloading invoice for payment ${req.params.id}:`, error);

    if (res.headersSent) {
      return;
    }

    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;

      if (statusCode === 404) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice document not found',
          payment_id: req.params.id
        });
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication failed with PayPlus API'
        });
      }

      return res.status(500).json({
        status: 'error',
        message: 'PayPlus API error during download',
        details: errorData || error.message,
        status_code: statusCode
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Error downloading invoice',
      details: error.message
    });
  }
};

/**
 * Process refund for a payment transaction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processRefund = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, amount, reason, sendEmailNotification = true } = req.body;
        
        // Validate input
        if (!type || !['full', 'partial'].includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: 'Refund type must be either "full" or "partial"'
            });
        }
        
        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({
                status: 'error',
                message: 'Reason must be provided and at least 10 characters long'
            });
        }
        
        if (type === 'partial' && (!amount || amount <= 0)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid refund amount is required for partial refunds'
            });
        }
        
        // Find the payment transaction
        const transaction = await PaymentTransaction.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    required: false
                },
                {
                    model: User,
                    as: 'Generator',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: SubscriptionPlan,
                    as: 'Plan',
                    attributes: ['id', 'name', 'price'],
                    required: false
                }
            ]
        });
        
        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found'
            });
        }
        
        // Check if transaction can be refunded
        if (transaction.status !== 'success') {
            return res.status(400).json({
                status: 'error',
                message: 'Only successful payments can be refunded'
            });
        }
        
        // Get transaction UID for PayPlus API
        const transaction_uid = transaction.transaction_id || transaction.token;
        if (!transaction_uid) {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for refund processing'
            });
        }
        
        // Calculate refund amount
        const refundAmount = type === 'full' ? parseFloat(transaction.amount) : parseFloat(amount);
        
        // Validate partial refund amount doesn't exceed original
        if (refundAmount > parseFloat(transaction.amount)) {
            return res.status(400).json({
                status: 'error',
                message: 'Refund amount cannot exceed original payment amount'
            });
        }
        
        // Prepare PayPlus API request
        const payplusUrl = `${process.env.PAYPLUS_BASE_URL}/Transactions/RefundByTransactionUid`;
        const refundData = {
            transaction_uid: transaction_uid,
            amount: refundAmount,
            currency_code: transaction.currency.toUpperCase(),
            reason: reason.trim(),
            send_customer_refund_email: true
        };
        
        const headers = {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY
        };
        
        console.log(`Processing ${type} refund for payment ${id}:`, {
            transaction_uid,
            amount: refundAmount,
            currency: transaction.currency,
            reason: reason.trim()
        });
        
        // Call PayPlus refund API
        const payplusResponse = await axios.post(payplusUrl, refundData, {
            headers,
            timeout: 30000
        });
        
        if (payplusResponse.status !== 200) {
            throw new Error(`PayPlus API returned status ${payplusResponse.status}`);
        }
        
        const refundResult = payplusResponse.data;
        
        // Handle nested response structure from PayPlus
        const results = refundResult.results || refundResult;
        const data = refundResult.data || {};
        console.log('PayPlus refund response:', refundResult);
        
        
        // Check if refund was successful - PayPlus uses different response format
        if (results.status !== 'success' || results.code !== 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Refund processing failed',
                details: results.description || 'Unknown error from payment processor',
                payplus_response: refundResult
            });
        }
        
        // Extract transaction information from nested data
        const transactionData = data.transaction || data.data || {};
        const refundTransactionUid = transactionData.transaction_uid || 
                                   data.transaction_uid || 
                                   `refund_${Date.now()}`; // fallback if not provided
        
        // Update transaction status and add comprehensive refund information
        const updatedResponseData = {
            ...transaction.response_data,
            refund: {
                // Refund transaction details
                refund_transaction_uid: refundTransactionUid,
                refund_type: type,
                refund_amount: refundAmount,
                refund_currency: transaction.currency,
                refund_reason: reason.trim(),
                refund_date: new Date(),
                refunded_by: req.user?.id || 'admin',
                refunded_by_name: req.user?.full_name || 'Admin User',
                email_notification_sent: sendEmailNotification,
                
                // Original payment details for reference
                original_payment: {
                    transaction_id: transaction.transaction_id,
                    original_amount: parseFloat(transaction.amount),
                    original_currency: transaction.currency,
                    payment_date: transaction.created_at,
                    payment_method: transaction.payment_method,
                    card_last_digits: transaction.card_last_digits,
                    plan_name: transaction.Plan ? transaction.Plan.name : 'Custom Plan',
                    lesson_minutes: transaction.lesson_minutes,
                    lessons_per_month: transaction.lessons_per_month,
                    is_recurring: transaction.is_recurring
                },
                
                // Student details at time of refund
                student_details: {
                    id: transaction.Student ? transaction.Student.id : null,
                    name: transaction.student_name,
                    email: transaction.student_email,
                    mobile: transaction.Student ? transaction.Student.mobile : null
                },
                
                // Appointment setter/sales agent details
                appointment_setter: transaction.Generator ? {
                    id: transaction.Generator.id,
                    name: transaction.Generator.full_name,
                    email: transaction.Generator.email,
                    role: transaction.Generator.role_name
                } : null,
                
                // PayPlus response for audit trail
                payplus_response: refundResult,
                
                // Additional metadata
                refund_processing_time: new Date(),
                admin_notes: `${type === 'full' ? 'Full' : 'Partial'} refund processed by ${req.user?.full_name || 'admin'}`,
                
                // Calculate remaining balance after partial refund
                remaining_balance: type === 'partial' ? parseFloat(transaction.amount) - refundAmount : 0
            }
        };
        
        // Update transaction record
        await transaction.update({
            status: 'refunded',
            refund_amount: refundAmount,
            refund_type: type,                   // 'full' | 'partial'
            refund_reason: reason.trim(),
            refund_date: new Date(),
            // response_data: updatedResponseData,
            updated_at: new Date()
        });
        
        // Log refund activity
        console.log(`Refund processed successfully:`, {
            payment_id: id,
            refund_transaction_uid: refundTransactionUid,
            type,
            amount: refundAmount,
            currency: transaction.currency,
            student: transaction.Student?.full_name,
            processed_by: req.user?.full_name || 'admin'
        });
        
        return res.status(200).json({
            status: 'success',
            message: `${type === 'full' ? 'Full' : 'Partial'} refund processed successfully`,
            data: {
                payment_id: id,
                refund_transaction_uid: refundTransactionUid,
                refund_type: type,
                refund_amount: refundAmount,
                refund_currency: transaction.currency,
                original_amount: parseFloat(transaction.amount),
                remaining_balance: type === 'partial' ? parseFloat(transaction.amount) - refundAmount : 0,
                refund_reason: reason.trim(),
                email_notification_sent: sendEmailNotification,
                
                // Student information
                student_name: transaction.Student?.full_name || transaction.student_name,
                student_email: transaction.Student?.email || transaction.student_email,
                
                // Payment details
                original_transaction_id: transaction.transaction_id,
                payment_method: transaction.payment_method,
                plan_name: transaction.Plan ? transaction.Plan.name : 'Custom Plan',
                
                // Processing details
                refund_date: new Date(),
                processed_by: req.user?.full_name || 'Admin User',
                payplus_reference: refundTransactionUid,
                payplus_response: results,
                
                // For frontend display
                refund_summary: {
                    type: type,
                    amount: `${transaction.currency === 'ILS' ? '₪' : '$'}${refundAmount.toFixed(2)} ${transaction.currency}`,
                    original: `${transaction.currency === 'ILS' ? '₪' : '$'}${parseFloat(transaction.amount).toFixed(2)} ${transaction.currency}`,
                    remaining: type === 'partial' ? `${transaction.currency === 'ILS' ? '₪' : '$'}${(parseFloat(transaction.amount) - refundAmount).toFixed(2)} ${transaction.currency}` : '0.00',
                    date: new Date().toLocaleDateString(),
                    reason: reason.trim()
                }
            }
        });
        
    } catch (error) {
        console.error('Error processing refund:', error);
        
        // Handle PayPlus API specific errors
        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;
            
            if (statusCode === 400) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid refund request',
                    details: errorData?.description || error.message,
                    payplus_error: errorData
                });
            }
            
            if (statusCode === 401 || statusCode === 403) {
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication failed with payment processor'
                });
            }
            
            return res.status(500).json({
                status: 'error',
                message: 'Payment processor error',
                details: errorData?.description || error.message,
                status_code: statusCode
            });
        }
        
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while processing refund',
            details: error.message
        });
    }
};

/**
 * Generate and download credit invoice for a refunded payment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadCreditInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query; // type can be 'original' or 'copy'

        // Find the payment transaction
        const paymentTransaction = await PaymentTransaction.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });
        
        if (!paymentTransaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found'
            });
        }

        // Check if payment was refunded
        if (paymentTransaction.status !== 'refunded') {
            return res.status(400).json({
                status: 'error',
                message: 'Credit invoice is only available for refunded payments'
            });
        }

        // Get the original payment transaction UID (not the refund UID)
        const transaction_uid = paymentTransaction.transaction_id || paymentTransaction.token;
        
        if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for this payment'
            });
        }

        console.log(`Downloading credit invoice for payment ${id}, transaction: ${transaction_uid}`);

        // Get invoice documents from PayPlus using the ORIGINAL transaction UID
        const payplusUrl = `${process.env.PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
        const requestData = {
            transaction_uid: transaction_uid, // Use original payment transaction UID
            filter: {}
        };

        const headers = {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY
        };

        // Get invoice documents
        const response = await axios.post(payplusUrl, requestData, { 
            headers,
            timeout: 30000
        });

        if (response.status !== 200 || !response.data || !response.data.invoices || response.data.invoices.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No invoice documents found for this payment',
                payment_id: id,
                transaction_uid: transaction_uid
            });
        }

        console.log(`Found ${response.data.invoices.length} invoice documents for transaction ${transaction_uid}`);

        // Filter for credit invoices and receipts
        const creditDocuments = response.data.invoices.filter(inv => 
            inv.status === 'success' && 
            (inv.type === 'Credit Invoice' || inv.type === 'Credit Receipt')
        );

        if (creditDocuments.length === 0) {
            // List available document types for debugging
            const availableTypes = response.data.invoices.map(inv => ({
                type: inv.type,
                status: inv.status,
                date: inv.date
            }));

            return res.status(404).json({
                status: 'error',
                message: 'No credit invoice or receipt found for this refunded payment',
                payment_id: id,
                transaction_uid: transaction_uid,
                available_documents: availableTypes,
                note: 'Credit documents are only generated after a refund is processed'
            });
        }

        // Prioritize Credit Invoice over Credit Receipt
        let creditDocument = creditDocuments.find(doc => doc.type === 'Credit Invoice');
        if (!creditDocument) {
            creditDocument = creditDocuments.find(doc => doc.type === 'Credit Receipt');
        }

        console.log(`Using ${creditDocument.type} document dated ${creditDocument.date}`);

        // Validate type parameter
        if (!['original', 'copy'].includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: 'Type must be either "original" or "copy"'
            });
        }

        // Get the appropriate download URL based on type
        const downloadUrl = type === 'original' 
            ? creditDocument.original_doc_url 
            : creditDocument.copy_doc_url;
        
        if (!downloadUrl) {
            return res.status(404).json({
                status: 'error',
                message: `${type} ${creditDocument.type.toLowerCase()} document URL not available`,
                payment_id: id,
                transaction_uid: transaction_uid,
                document_type: creditDocument.type,
                available_types: {
                    original: !!creditDocument.original_doc_url,
                    copy: !!creditDocument.copy_doc_url
                }
            });
        }

        console.log(`Found ${type} ${creditDocument.type} document URL for payment ${id}`);

        // Download the credit document from PayPlus
        const documentResponse = await axios.get(downloadUrl, {
            responseType: 'stream',
            timeout: 60000,
            headers: {
                'api-key': process.env.PAYPLUS_API_KEY,
                'secret-key': process.env.PAYPLUS_SECRET_KEY
            }
        });

        if (documentResponse.status !== 200) {
            throw new Error(`Failed to download ${creditDocument.type}: HTTP ${documentResponse.status}`);
        }

        // Set response headers for file download
        const contentType = documentResponse.headers['content-type'] || 'application/pdf';
        const documentTypeSlug = creditDocument.type.toLowerCase().replace(/\s+/g, '_'); // "credit_invoice" or "credit_receipt"
        const filename = `${documentTypeSlug}_${paymentTransaction.transaction_id}_${type}.${format}`;

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache');

        console.log(`Streaming ${creditDocument.type}: ${filename}`);

        // Stream the document to the client
        documentResponse.data.pipe(res);

        // Handle stream errors
        documentResponse.data.on('error', (error) => {
            console.error(`Error streaming ${creditDocument.type}:`, error);
            if (!res.headersSent) {
                res.status(500).json({
                    status: 'error',
                    message: `Error streaming ${creditDocument.type} document`,
                    details: error.message
                });
            }
        });

    } catch (error) {
        console.error(`Error downloading credit invoice for payment ${req.params.id}:`, error);

        if (res.headersSent) {
            return;
        }

        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;

            if (statusCode === 404) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Credit invoice document not found',
                    payment_id: req.params.id,
                    details: 'The credit document may not have been generated yet, or the transaction UID is invalid'
                });
            }

            if (statusCode === 401 || statusCode === 403) {
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication failed with PayPlus API'
                });
            }

            return res.status(500).json({
                status: 'error',
                message: 'PayPlus API error during credit document download',
                details: errorData || error.message,
                status_code: statusCode
            });
        }

        return res.status(500).json({
            status: 'error',
            message: 'Error downloading credit document',
            details: error.message
        });
    }
};

/**
 * Get payment history for a specific student with comprehensive refund data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentPaymentHistory = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        // Helper function to get user emails for student lookup
        const getUserEmails = async (studentId) => {
            try {
                const user = await User.findByPk(studentId, {
                    attributes: ['email']
                });
                return user ? [user.email] : [];
            } catch (error) {
                console.error('Error fetching user emails:', error);
                return [];
            }
        };

        const userEmails = await getUserEmails(studentId);
        
        // Find all payment transactions for this student
        const transactions = await PaymentTransaction.findAndCountAll({
            where: {
                [Op.or]: [
                    { user_id: studentId },
                    userEmails.length > 0 ? { student_email: { [Op.in]: userEmails } } : {}
                ].filter(condition => Object.keys(condition).length > 0)
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    required: false
                },
                {
                    model: User,
                    as: 'Generator',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: SubscriptionPlan,
                    as: 'Plan',
                    attributes: ['id', 'name', 'price'],
                    required: false,
                    include: [
                        {
                            model: LessonLength,
                            as: 'LessonLength',
                            attributes: ['minutes'],
                            required: false
                        },
                        {
                            model: LessonsPerMonth,
                            as: 'LessonsPerMonth',
                            attributes: ['lessons'],
                            required: false
                        }
                    ]
                },
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months'],
                    required: false
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', 'DESC']]
        });
        
        // Format transactions with comprehensive refund data
        const formattedTransactions = transactions.rows.map(transaction => {
            const baseTransaction = {
                id: transaction.id,
                transaction_id: transaction.transaction_id,
                token: transaction.token,
                date: moment(transaction.created_at).format('YYYY-MM-DD'),
                student: {
                    id: transaction.Student ? transaction.Student.id : null,
                    name: transaction.student_name,
                    email: transaction.student_email,
                    mobile: transaction.Student ? transaction.Student.mobile : null,
                    country_code: transaction.Student ? transaction.Student.country_code : null
                },
                plan: {
                    id: transaction.Plan ? transaction.Plan.id : null,
                    name: transaction.Plan ? transaction.Plan.name : 'Custom Plan',
                    duration: transaction.Duration ? transaction.Duration.name : null,
                    minutes: transaction.lesson_minutes,
                    lessons_per_month: transaction.lessons_per_month
                },
                amount: parseFloat(transaction.amount),
                currency: transaction.currency,
                is_recurring: transaction.is_recurring,
                appointment_setter: transaction.Generator ? {
                    id: transaction.Generator.id,
                    name: transaction.Generator.full_name,
                    email: transaction.Generator.email,
                    role: transaction.Generator.role_name
                } : 'Direct',
                payment_method: transaction.payment_method,
                card_last_digits: transaction.card_last_digits,
                status: transaction.status,
                error_code: transaction.error_code,
                error_message: transaction.error_message
            };

            // Add comprehensive response_data if it exists (includes refund information)
            if (transaction.response_data) {
                baseTransaction.response_data = transaction.response_data;
            }

            return baseTransaction;
        });
        
        // Calculate refund summary statistics
        const refundedTransactions = formattedTransactions.filter(t => t.status === 'refunded');
        const totalRefunded = refundedTransactions.reduce((sum, t) => {
            const refundAmount = t.response_data?.refund?.refund_amount || 0;
            return sum + refundAmount;
        }, 0);
        
        const summary = {
            total_payments: transactions.count,
            successful_payments: formattedTransactions.filter(t => t.status === 'success').length,
            refunded_payments: refundedTransactions.length,
            total_refunded_amount: totalRefunded,
            currency: formattedTransactions[0]?.currency || 'ILS'
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedTransactions,
            summary: summary,
            pagination: {
                total: transactions.count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(transactions.count / parseInt(limit))
            },
            message: 'Student payment history retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching student payment history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Enhanced search function to handle phone numbers and various search patterns
 * @param {string} searchTerm - The search term to process
 * @returns {Object} Search conditions for Sequelize
 */
const buildSearchConditions = (searchTerm) => {
    if (!searchTerm) return {};
    
    const searchConditions = [];
    
    // Basic search conditions for text fields
    searchConditions.push(
        { transaction_id: { [Op.like]: `%${searchTerm}%` } },
        { student_email: { [Op.like]: `%${searchTerm}%` } },
        { student_name: { [Op.like]: `%${searchTerm}%` } }
    );
    
    // Enhanced phone number search
    // Remove any non-digit characters for phone number searching
    const cleanedSearch = searchTerm.replace(/\D/g, '');
    
    if (cleanedSearch.length >= 4) {
        // Search for exact phone number match (full number)
        searchConditions.push({
            '$Student.mobile$': { [Op.like]: `%${cleanedSearch}%` }
        });
        
        // Search for last 4 digits specifically
        if (cleanedSearch.length === 4) {
            searchConditions.push({
                '$Student.mobile$': { [Op.like]: `%${cleanedSearch}` }
            });
        }
        
        // Search for partial phone number matches (middle digits)
        if (cleanedSearch.length > 4) {
            searchConditions.push({
                '$Student.mobile$': { [Op.like]: `%${cleanedSearch}%` }
            });
        }
    }
    
    return { [Op.or]: searchConditions };
};

/**
 * Format plan display for enhanced readability
 * @param {Object} plan - Plan object with associated data
 * @param {Object} lessonLength - LessonLength association object
 * @param {Object} lessonsPerMonth - LessonsPerMonth association object  
 * @param {Object} duration - Duration association object
 * @returns {string} Formatted plan string
 */
const formatPlanDisplay = (plan, lessonLength, lessonsPerMonth, duration) => {
    // Handle case where no plan is provided
    if (!plan) return 'Custom Plan';
    
    const durationName = duration?.name || 'Monthly';
    const minutes = lessonLength?.minutes || plan.lesson_minutes || 'N/A';
    const lessons = lessonsPerMonth?.lessons || plan.lessons_per_month || 'N/A';
    
    return `${durationName} Plan - ${minutes} Min Lessons (${lessons} lessons/month)`;
};

/**
 * Alternative simplified version for frontend use
 * @param {Object} plan - Plan object from payment data
 * @returns {string} Formatted plan string
 */
const formatPlanDisplaySimple = (plan) => {
    if (!plan) return 'Custom Plan';
    
    const duration = plan.duration || 'Monthly';
    const minutes = plan.minutes || 'N/A';
    const lessonsPerMonth = plan.lessons_per_month || 'N/A';
    
    return `${duration} Plan - ${minutes} Min Lessons (${lessonsPerMonth} lessons/month)`;
};

/**
 * Calculate payment sequence number for recurring payments
 * @param {Object} transaction - The current transaction
 * @param {string} userEmail - Student email for lookup
 * @param {number} planId - Plan ID for recurring payment tracking
 * @returns {Promise<number>} Payment sequence number
 */
const calculatePaymentSequence = async (transaction, userEmail, planId) => {
    try {
        // Only calculate for recurring payments
        if (!transaction.is_recurring) {
            return 1; // Non-recurring payments are always "1st payment"
        }

        // Find all successful recurring payments for this user, ordered by date
        const allPayments = await PaymentTransaction.findAll({
            where: {
                student_email: userEmail,
                status: 'success',
                is_recurring: true
            },
            order: [['created_at', 'ASC']],
            attributes: ['id', 'created_at']
        });

        // Find the position of the current transaction
        const currentIndex = allPayments.findIndex(p => p.id === transaction.id);
        
        // Return the sequence number (index + 1)
        return currentIndex !== -1 ? currentIndex + 1 : 1;

    } catch (error) {
        console.error('Error calculating payment sequence:', error);
        return 1; // Default to 1 if calculation fails
    }
};

/**
 * Batch calculate payment sequences for multiple transactions
 * @param {Array} transactions - Array of transactions
 * @returns {Promise<Object>} Map of transaction ID to sequence number
 */
const batchCalculatePaymentSequences = async (transactions) => {
    const sequenceMap = {};
    
    try {
        // Group transactions by user email (not by plan, since we want to track all recurring payments per user)
        const userGroups = {};
        
        transactions.forEach(transaction => {
            const key = `${transaction.student_email}_${transaction.is_recurring}`;
            if (!userGroups[key]) {
                userGroups[key] = [];
            }
            userGroups[key].push(transaction);
        });

        // Process each group
        for (const [key, groupTransactions] of Object.entries(userGroups)) {
            const [email, isRecurring] = key.split('_');
            
            if (isRecurring === 'true') {
                // For recurring payments, get ALL successful payments for this user, ordered by date
                const allPayments = await PaymentTransaction.findAll({
                    where: {
                        student_email: email,
                        status: 'success',
                        is_recurring: true
                    },
                    order: [['created_at', 'ASC']],
                    attributes: ['id', 'created_at', 'transaction_id']
                });

                console.log(`Found ${allPayments.length} recurring payments for ${email}`);

                // Create a map of payment IDs to their sequence numbers
                const paymentSequenceMap = new Map();
                allPayments.forEach((payment, index) => {
                    paymentSequenceMap.set(payment.id, index + 1);
                });

                // Assign sequence numbers to the transactions in the current batch
                groupTransactions.forEach(transaction => {
                    sequenceMap[transaction.id] = paymentSequenceMap.get(transaction.id) || 1;
                });
            } else {
                // Non-recurring payments are always sequence 1
                groupTransactions.forEach(transaction => {
                    sequenceMap[transaction.id] = 1;
                });
            }
        }

    } catch (error) {
        console.error('Error in batch calculating payment sequences:', error);
        // Set all to 1 as fallback
        transactions.forEach(transaction => {
            sequenceMap[transaction.id] = 1;
        });
    }

    return sequenceMap;
};

/**
 * Enhanced refund processing function with comprehensive lesson and subscription management
 * Updated to include proper subscription deactivation and recurring payment cancellation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processEnhancedRefund = async (req, res) => {
    let transaction;
    
    try {
        transaction = await sequelize.transaction();
        
        const { id } = req.params;
        const { 
            type, 
            amount, 
            reason,
            customReason,
            sendEmailNotification = true,
            lessonsToDeduct,
            deductLessonsFromLastRenewal,
            subscriptionAction,
            acknowledgeUsedLessons
        } = req.body;
        
        // Validate input
        if (!type || !['full', 'partial'].includes(type)) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund type must be either "full" or "partial"'
            });
        }
        
        if (!reason) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund reason is required'
            });
        }
        
        if (type === 'partial' && (!amount || amount <= 0)) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Valid refund amount is required for partial refunds'
            });
        }
        
        // Find the payment transaction with student details
        const payment = await PaymentTransaction.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    required: false
                },
                {
                    model: User,
                    as: 'Generator',
                    attributes: ['id', 'full_name', 'email', 'role_name'],
                    required: false
                },
                {
                    model: SubscriptionPlan,
                    as: 'Plan',
                    attributes: ['id', 'name', 'price'],
                    required: false
                }
            ],
            transaction
        });
        
        if (!payment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found'
            });
        }
        
        // Check if transaction can be refunded
        if (payment.status !== 'success') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Only successful payments can be refunded'
            });
        }
        
        // Get student's subscription details (latest subscription, regardless of status)
        const studentId = payment.Student?.id || payment.user_id;
        if (!studentId) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student information not found for this payment'
            });
        }
        
        const latestSubscription = await UserSubscriptionDetails.findOne({
            where: { 
                user_id: studentId
            },
            order: [['created_at', 'DESC']],
            transaction
        });
        
        // Determine whether we should apply lesson management + subscription impact
        // 1️⃣ Active subscription (NOT cancel at renewal) -> full flow
        // 2️⃣ Inactive or "cancel at renewal" subscription OR no subscription -> refund only
        const hasManageableSubscription = !!latestSubscription 
            && latestSubscription.status === 'active'
            && latestSubscription.inactive_after_renew !== 1;
        
        let subscription = null;
        let lessonValidation = null;
        
        if (hasManageableSubscription) {
            subscription = latestSubscription;
            
            // Calculate lesson usage and validate refund
            lessonValidation = await validateLessonRefund(
                studentId, 
                lessonsToDeduct, 
                deductLessonsFromLastRenewal,
                acknowledgeUsedLessons,
                transaction
            );
            
            if (!lessonValidation.valid) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: lessonValidation.message,
                    data: lessonValidation.data
                });
            }
        }
        
        // Calculate refund amount
        const refundAmount = type === 'full' ? parseFloat(payment.amount) : parseFloat(amount);
        
        if (refundAmount > parseFloat(payment.amount)) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund amount cannot exceed original payment amount'
            });
        }
        
        // Process PayPlus refund
        const payplusRefund = await processPayPlusRefund(
            payment.transaction_id || payment.token,
            refundAmount,
            payment.currency,
            customReason || reason
        );
        
        if (!payplusRefund.success) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund processing failed with payment processor',
                details: payplusRefund.error
            });
        }
        
        // Send email notification if requested (MOVED UP BEFORE DATABASE UPDATE)
        let emailSent = false;
        if (sendEmailNotification) {
            emailSent = await sendRefundEmailNotification(
                payment,
                refundAmount,
                type,
                customReason || reason
            );
        }
        
        // Build payment update payload (common fields)
        const paymentUpdatePayload = {
            status: 'refunded',
            refund_amount: refundAmount,
            refund_type: type,
            refund_reason: customReason || reason,
            refund_date: new Date(),
            refund_processed_by: req.user?.id || null,
            refund_processed_by_name: req.user?.full_name || 'Admin User',
            email_notification_sent: emailSent,
            custom_refund_reason: customReason || null, // FIX: Use null instead of undefined
            acknowledged_used_lessons: hasManageableSubscription ? acknowledgeUsedLessons : false,
            updated_at: new Date()
        };

        // Only track lesson/subscription impact when subscription is truly active
        if (hasManageableSubscription) {
            paymentUpdatePayload.lessons_deducted = deductLessonsFromLastRenewal ? lessonsToDeduct : 0;
            paymentUpdatePayload.subscription_action = subscriptionAction;
        } else {
            paymentUpdatePayload.lessons_deducted = 0;
            paymentUpdatePayload.subscription_action = null;
        }

        await payment.update(paymentUpdatePayload, { transaction });
        
        // Process lesson deductions if requested and subscription is active
        if (hasManageableSubscription && deductLessonsFromLastRenewal && lessonsToDeduct > 0) {
            await deductLessonsFromSubscription(
                subscription,
                lessonsToDeduct,
                lessonValidation.data,
                transaction
            );
        }
        
        // Handle subscription actions with enhanced tracking ONLY when subscription is truly active
        let recurringPaymentResult = null;
        if (hasManageableSubscription) {
            await handleSubscriptionActionEnhanced(
                subscription,
                subscriptionAction,
                req.user?.id || 'admin',
                customReason || reason,
                type,
                refundAmount,
                payment.currency,
                transaction
            );
            
            // Handle recurring payment cancellation if subscription is being cancelled
            if (subscriptionAction === 'cancel_immediate' || subscriptionAction === 'cancel_renewal') {
                console.log(`Cancelling recurring payments due to ${type} refund`);
                
                recurringPaymentResult = await cancelUserRecurringPaymentsForRefund(
                    studentId,
                    `${type === 'full' ? 'Full' : 'Partial'} refund processed: ${customReason || reason} (${formatCurrency(refundAmount, payment.currency)})`,
                    req.user?.id || 'admin',
                    transaction
                );
                
                console.log(`Recurring payment cancellation result:`, recurringPaymentResult);
            }
        }
        
        await transaction.commit();
        
        // Prepare comprehensive response
        const refundSummary = {
            payment_id: id,
            refund_transaction_uid: payplusRefund.data?.transaction_uid || `refund_${Date.now()}`,
            refund_type: type,
            refund_amount: refundAmount,
            refund_currency: payment.currency,
            original_amount: parseFloat(payment.amount),
            student_name: payment.Student?.full_name || payment.student_name,
            student_email: payment.Student?.email || payment.student_email,
            refund_reason: customReason || reason,
            lessons_deducted: deductLessonsFromLastRenewal ? lessonsToDeduct : 0,
            subscription_action: subscriptionAction,
            email_notification_sent: emailSent,
            refund_date: new Date(),
            processed_by: req.user?.full_name || 'Admin User',
            payment_method: payment.payment_method
        };
        
        // Build response with recurring payment info
        const responseData = {
            status: 'success',
            message: `Enhanced ${type} refund processed successfully`,
            data: refundSummary
        };
        
        // Include recurring payment action result if any
        if (recurringPaymentResult) {
            responseData.recurring_payment_action = recurringPaymentResult;
            if (recurringPaymentResult.total > 0) {
                responseData.message += `. ${recurringPaymentResult.successful} recurring payment(s) cancelled.`;
            }
        }
        
        return res.status(200).json(responseData);
        
    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        
        console.error('Error in enhanced refund processing:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while processing refund',
            details: error.message
        });
    }
};

/**
 * Enhanced subscription action handler with proper cancellation tracking
 * Updated to match patterns from updateUserPlan function
 * @param {Object} subscription - Subscription object
 * @param {string} action - Action to take (continue, cancel_immediate, cancel_renewal)
 * @param {number} adminId - Admin ID performing the action
 * @param {string} reason - Reason for the action
 * @param {string} refundType - Type of refund (full/partial)
 * @param {number} refundAmount - Amount being refunded
 * @param {string} currency - Currency of the refund
 * @param {Object} transaction - Database transaction
 * @returns {Promise<boolean>} Success status
 */
const handleSubscriptionActionEnhanced = async (subscription, action, adminId, reason, refundType, refundAmount, currency, transaction) => {
    try {
        const currentDate = new Date();
        
        // Create comprehensive cancellation reason following updateUserPlan pattern
        const cancellationReason = `Admin ${refundType} refund: ${reason} (${formatCurrency(refundAmount, currency)})`;
        
        switch (action) {
            case 'cancel_immediate':
                // Update subscription with all cancellation details (following updateUserPlan pattern)
                await subscription.update({
                    status: 'inactive',
                    is_cancel: 1,
                    cancellation_date: currentDate,
                    cancelled_by_user_id: adminId,
                    cancellation_reason_category: 'refund', // New category for refunds
                    cancellation_reason: cancellationReason,
                    left_lessons: 0, // Remove all remaining lessons
                    updated_at: currentDate
                }, { transaction });
                
                // Clear user's subscription info (following updateUserPlan pattern)
                await User.update({
                    subscription_id: null,
                    subscription_type: null
                }, {
                    where: { id: subscription.user_id },
                    transaction
                });
                
                // Step 3: NEW FEATURE - Auto-cancel all pending classes
                const pendingClassesCancellation = await cancelPendingClassesForSubscription(
                    subscription.user_id,
                    adminId,
                    `Subscription cancelled immediately due to ${refundType} refund: ${reason}`,
                    transaction
                );
                
                console.log(`Subscription ${subscription.id} cancelled immediately due to ${refundType} refund`);
                console.log(`Pending classes cancellation result:`, pendingClassesCancellation);
                
                return {
                    success: true,
                    action: 'cancel_immediate',
                    subscription_cancelled: true,
                    pending_classes_cancelled: pendingClassesCancellation.total_cancelled,
                    cancellation_details: pendingClassesCancellation
                };
                
            case 'cancel_renewal':
                // Update subscription for end-of-period cancellation
                await subscription.update({
                    status: 'active', // Use the proper status from updateUserPlan
                    inactive_after_renew: 1,
                    cancellation_date: currentDate,
                    cancelled_by_user_id: adminId,
                    cancellation_reason_category: 'refund',
                    cancellation_reason: cancellationReason,
                    updated_at: currentDate
                }, { transaction });
                
                console.log(`Subscription ${subscription.id} set to cancel after renewal due to ${refundType} refund`);
                
                return {
                    success: true,
                    action: 'cancel_renewal',
                    subscription_cancelled: false,
                    pending_classes_cancelled: 0,
                    note: 'Subscription will cancel after renewal period ends'
                };
                
            case 'continue':
            default:
                // No subscription changes needed - add note to subscription for audit trail
                const auditNote = `${refundType} refund processed but subscription continues: ${reason}`;
                await subscription.update({
                    notes: (subscription.notes || '') + `\n[${currentDate.toISOString()}] ${auditNote}`,
                    updated_at: currentDate
                }, { transaction });
                
                console.log(`Subscription ${subscription.id} continues unchanged after ${refundType} refund`);
                
                return {
                    success: true,
                    action: 'continue',
                    subscription_cancelled: false,
                    pending_classes_cancelled: 0,
                    note: 'Subscription continues as normal'
                };
        }
        
    } catch (error) {
        console.error('Error handling enhanced subscription action:', error);
        throw error;
    }
};

const cancelPendingClassesForSubscription = async (userId, cancelledBy, reason, transaction) => {
    try {
        console.log(`Cancelling pending classes for user ${userId} due to immediate subscription cancellation`);
        
        // Adjust the status values based on your Class model's status enum
        const pendingClasses = await Class.findAll({
            where: {
                student_id: userId, // Adjust field name if different in your model
                status: 'pending'
            },
            transaction
        });
        
        console.log(`Found ${pendingClasses.length} pending classes to cancel for user ${userId}`);
        
        if (pendingClasses.length === 0) {
            return {
                total_found: 0,
                total_cancelled: 0,
                cancelled_classes: [],
                message: 'No pending classes found to cancel'
            };
        }
        
        // Cancel each pending class
        const cancellationResults = [];
        let successCount = 0;
        let failureCount = 0;
        
        for (const classRecord of pendingClasses) {
            try {
                // Create comprehensive cancellation note
                const cancellationNote = `[${new Date().toISOString()}] AUTO-CANCELLED: ${reason}. Cancelled by admin ID: ${cancelledBy}`;
                
                // Update class status to cancelled
                await classRecord.update({
                    status: 'canceled',
                    cancelled_at: new Date(),
                    cancelled_by: cancelledBy,
                    cancellation_reason: reason,
                    admin_notes: (classRecord.admin_notes || '') + `\n${cancellationNote}`,
                    updated_at: new Date()
                }, { transaction });
                
                successCount++;
                cancellationResults.push({
                    class_id: classRecord.id,
                    scheduled_time: classRecord.scheduled_time,
                    original_status: classRecord.status,
                    teacher_id: classRecord.teacher_id,
                    status: 'cancelled_successfully',
                    message: 'Class cancelled due to immediate subscription termination'
                });
                
                console.log(`Successfully cancelled class ${classRecord.id} scheduled for ${classRecord.scheduled_time}`);
                
            } catch (error) {
                failureCount++;
                console.error(`Error cancelling class ${classRecord.id}:`, error);
                
                cancellationResults.push({
                    class_id: classRecord.id,
                    scheduled_time: classRecord.scheduled_time,
                    original_status: classRecord.status,
                    status: 'cancellation_failed',
                    error: error.message
                });
            }
        }
        
        
        return {
            total_found: pendingClasses.length,
            total_cancelled: successCount,
            total_failed: failureCount,
            cancelled_classes: cancellationResults,
            message: `Successfully cancelled ${successCount} out of ${pendingClasses.length} pending classes`,
            cancellation_reason: reason,
            cancelled_by: cancelledBy,
            cancellation_timestamp: new Date()
        };
        
    } catch (error) {
        console.error(`Error in cancelPendingClassesForSubscription for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Cancel user recurring payments specifically for refund processing
 * Based on cancelUserRecurringPayments from user-plan controller
 * @param {Number} userId - User ID
 * @param {String} reason - Cancellation reason
 * @param {Number} cancelledBy - ID of user who cancelled
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Cancellation results
 */
const cancelUserRecurringPaymentsForRefund = async (userId, reason, cancelledBy, transaction) => {
    try {
        console.log(`Cancelling recurring payments for user ${userId} due to refund`);

        // We need to import or access the RecurringPayment model
        // If it's not imported, we'll need to add it to the imports at the top
        // Find all active recurring payments for this user
        const activeRecurringPayments = await RecurringPayment.findAll({
            where: {
                student_id: userId,
                status: { [Op.in]: ['pending', 'paid'] }
            },
            transaction
        });

        console.log(`Found ${activeRecurringPayments.length} active recurring payments for user ${userId}`);

        let successCount = 0;
        let failureCount = 0;
        const results = [];

        for (const recurringPayment of activeRecurringPayments) {
            try {
                let payPlusCancelled = true;
                let actualRecurringUid = null;
                let terminalUid = null;

                // Get the actual recurring payment UID for cancellation
                actualRecurringUid = getRecurringPaymentUidForCancellation(recurringPayment);
                terminalUid = getTerminalUidFromRecord(recurringPayment);

                console.log(`Processing recurring payment ${recurringPayment.id} for refund:`, {
                    originalPayplusUid: recurringPayment.payplus_transaction_uid,
                    extractedRecurringUid: actualRecurringUid,
                    extractedTerminalUid: terminalUid
                });

                // Try to cancel at PayPlus if we have the UID
                if (actualRecurringUid && actualRecurringUid !== 'N/A' && actualRecurringUid !== '') {
                    let webhookDataForApi = null;
                    try {
                        if (recurringPayment.webhook_data) {
                            webhookDataForApi = parseWebhookDataFromDB(recurringPayment.webhook_data);
                        }
                    } catch (parseError) {
                        console.log(`Could not parse webhook data for payment ${recurringPayment.id}: ${parseError.message}`);
                    }

                    payPlusCancelled = await cancelPayPlusRecurringPayment(
                        actualRecurringUid,
                        recurringPayment.payplus_page_request_uid,
                        webhookDataForApi
                    );
                } else {
                    console.log(`No valid recurring payment UID found for payment ${recurringPayment.id}, skipping PayPlus cancellation`);
                    payPlusCancelled = true;
                }

                // Update the recurring payment record with refund-specific details
                const updateRemarks = `${recurringPayment.remarks || ''}\n[${new Date().toISOString()}] REFUND CANCELLATION: ${reason}. PayPlus cancelled: ${payPlusCancelled}. Used recurring UID: ${actualRecurringUid || 'N/A'}. Terminal UID: ${terminalUid || 'N/A'}`;

                await recurringPayment.update({
                    status: 'cancelled',
                    is_active: false,
                    cancelled_at: new Date(),
                    cancelled_by: cancelledBy,
                    remarks: updateRemarks
                }, { transaction });

                if (payPlusCancelled) {
                    successCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        status: 'success',
                        message: 'Cancelled successfully due to refund'
                    });
                } else {
                    failureCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        status: 'partial_success',
                        message: 'Marked as cancelled locally but PayPlus cancellation failed'
                    });
                }

                console.log(`Processed recurring payment ${recurringPayment.id} for refund - PayPlus result: ${payPlusCancelled}`);
            } catch (error) {
                failureCount++;
                console.error(`Error processing recurring payment ${recurringPayment.id} for refund:`, error);

                results.push({
                    id: recurringPayment.id,
                    payplus_uid: recurringPayment.payplus_transaction_uid,
                    status: 'error',
                    message: error.message
                });
            }
        }

        console.log(`Refund recurring payment cancellation summary for user ${userId}: ${successCount} successful, ${failureCount} failed`);

        return {
            total: activeRecurringPayments.length,
            successful: successCount,
            failed: failureCount,
            results,
            cancellation_reason: 'refund_processing'
        };
    } catch (error) {
        console.error(`Error in cancelUserRecurringPaymentsForRefund for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Helper functions that need to be available (these should be imported or defined)
 * These are simplified versions - the full implementations should come from user-plan controller
 */

/**
 * Get recurring payment UID for cancellation
 * Simplified version - should import from user-plan controller
 */
const getRecurringPaymentUidForCancellation = (recurringPaymentRecord) => {
    try {
        if (recurringPaymentRecord.webhook_data) {
            const parsedData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);
            if (parsedData.recurring_payment_uid) {
                return parsedData.recurring_payment_uid;
            }
        }
        
        if (recurringPaymentRecord.payplus_transaction_uid &&
            recurringPaymentRecord.payplus_transaction_uid !== 'N/A' &&
            recurringPaymentRecord.payplus_transaction_uid !== '') {
            return recurringPaymentRecord.payplus_transaction_uid;
        }
        
        return null;
    } catch (error) {
        console.error('Error getting recurring payment UID for cancellation:', error);
        return null;
    }
};

/**
 * Get terminal UID from record
 * Simplified version - should import from user-plan controller
 */
const getTerminalUidFromRecord = (recurringPaymentRecord) => {
    try {
        if (recurringPaymentRecord.webhook_data) {
            const parsedData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);
            if (parsedData.terminal_uid) {
                return parsedData.terminal_uid;
            }
        }
        return null;
    } catch (error) {
        console.error('Error getting terminal UID from record:', error);
        return null;
    }
};

/**
 * Parse webhook data from database
 * Simplified version - should import from user-plan controller
 */
const parseWebhookDataFromDB = (webhookDataFromDB) => {
    try {
        let parsedData = webhookDataFromDB;
        if (typeof webhookDataFromDB === 'string') {
            parsedData = JSON.parse(webhookDataFromDB);
        }
        
        return {
            recurring_payment_uid: parsedData.original_webhook?.recurring_payment_uid || 
                                   parsedData.recurring_payment_uid || null,
            terminal_uid: parsedData.original_webhook?.terminal_uid || 
                         parsedData.terminal_uid || null
        };
    } catch (error) {
        console.error('Error parsing webhook data from DB:', error);
        return {
            recurring_payment_uid: null,
            terminal_uid: null
        };
    }
};

/**
 * Cancel PayPlus recurring payment
 * Simplified version - should import from user-plan controller
 */
const cancelPayPlusRecurringPayment = async (recurringPaymentUid, pageRequestUid = null, webhookData = null) => {
    try {
        if (!recurringPaymentUid || recurringPaymentUid === 'undefined' || recurringPaymentUid === '' || recurringPaymentUid === 'N/A') {
            console.log('No valid recurring payment UID found, skipping PayPlus cancellation');
            return true;
        }

        // PayPlus API configuration
        const PAYPLUS_CONFIG = {
            apiKey: process.env.PAYPLUS_API_KEY || '',
            secretKey: process.env.PAYPLUS_SECRET_KEY || '',
            baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
            terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
        };

        const terminalUid = webhookData?.terminal_uid || PAYPLUS_CONFIG.terminalUid;

        console.log(`Making PayPlus API call to cancel recurring payment: ${recurringPaymentUid}`);

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${recurringPaymentUid}`,
            {
                terminal_uid: terminalUid,
                _method: 'DELETE'
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                timeout: 30000
            }
        );

        if (response.status === 200 || response.status === 204) {
            console.log(`Successfully cancelled PayPlus recurring payment: ${recurringPaymentUid}`);
            return true;
        } else {
            console.error(`PayPlus API returned status ${response.status} for recurring payment cancellation`);
            return false;
        }
    } catch (error) {
        console.error(`Error cancelling PayPlus recurring payment ${recurringPaymentUid}:`, error);

        // If the error is that the recurring payment doesn't exist, consider it successful
        if (error.response?.status === 404 ||
            error.response?.data?.includes('not found') ||
            error.response?.data?.includes('already cancelled')) {
            console.log('Recurring payment not found or already cancelled at PayPlus, considering cancellation successful');
            return true;
        }

        return false;
    }
};

/**
 * Validate lesson refund based on student usage
 */
const validateLessonRefund = async (studentId, lessonsToDeduct, deductLessons, acknowledgeUsed, transaction) => {
    try {
        // Get current subscription details
        const subscription = await UserSubscriptionDetails.findOne({
            where: { 
                user_id: studentId,
                status: 'active'
            },
            transaction
        });
        
        if (!subscription) {
            return {
                valid: false,
                message: 'No active subscription found for validation'
            };
        }
        
        // Calculate total lessons used (excluding bonus lessons)
        const usedLessons = await Class.count({
            where: {
                student_id: studentId,
                status: 'ended',
                bonus_class: false, // Only count regular lessons
                created_at: {
                    [Op.gte]: subscription.lesson_reset_at || subscription.created_at
                }
            },
            transaction
        });
        
        const remainingLessons = subscription.left_lessons || 0;
        const totalLessons = usedLessons + remainingLessons;
        
        // Check if deducting lessons would create debt
        const wouldCreateDebt = deductLessons && (lessonsToDeduct > remainingLessons);
        
        // If would create debt and not acknowledged, reject
        if (wouldCreateDebt && !acknowledgeUsed) {
            return {
                valid: false,
                message: 'Student has already used some of these lessons. Please acknowledge this before proceeding.',
                data: {
                    total_lessons: totalLessons,
                    used_lessons: usedLessons,
                    remaining_lessons: remainingLessons,
                    lessons_to_deduct: lessonsToDeduct,
                    would_create_debt: true,
                    debt_amount: lessonsToDeduct - remainingLessons
                }
            };
        }
        
        return {
            valid: true,
            data: {
                total_lessons: totalLessons,
                used_lessons: usedLessons,
                remaining_lessons: remainingLessons,
                lessons_to_deduct: lessonsToDeduct,
                would_create_debt: wouldCreateDebt,
                subscription: subscription
            }
        };
        
    } catch (error) {
        return {
            valid: false,
            message: 'Error validating lesson refund: ' + error.message
        };
    }
};

/**
 * Deduct lessons from subscription
 */
// const deductLessonsFromSubscription = async (subscription, lessonsToDeduct, validationData, transaction) => {
//     try {
//         const newLeftLessons = Math.max(0, (subscription.left_lessons || 0) - lessonsToDeduct);
        
//         await subscription.update({
//             left_lessons: newLeftLessons,
//             updated_at: new Date()
//         }, { transaction });
        
//         console.log(`Deducted ${lessonsToDeduct} lessons from subscription ${subscription.id}. New balance: ${newLeftLessons}`);
        
//         return true;
//     } catch (error) {
//         console.error('Error deducting lessons:', error);
//         throw error;
//     }
// };


const deductLessonsFromSubscription=async(subscription, lessonsToDeduct, usageData, transaction)=> {
    // ALWAYS deduct from left_lessons (main pool of lessons)
    const currentLeft = parseInt(subscription.left_lessons || 0);
    const deduct = parseInt(lessonsToDeduct || 0);

    // Safety check
    const updatedLeft = Math.max(currentLeft - deduct, 0);

    await subscription.update(
        {
            left_lessons: updatedLeft,
            updated_at: new Date()
        },
        { transaction }
    );

    return {
        before: currentLeft,
        deducted: deduct,
        after: updatedLeft
    };
}

/**
 * Process PayPlus refund (using existing function)
 */
const processPayPlusRefund = async (transactionUid, amount, currency, reason) => {
    try {
        const payplusUrl = `${process.env.PAYPLUS_BASE_URL}/Transactions/RefundByTransactionUid`;
        const refundData = {
            transaction_uid: transactionUid,
            amount: amount,
            currency_code: currency.toUpperCase(),
            reason: reason,
            send_customer_refund_email: true
        };
        
        const headers = {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY
        };
        
        const response = await axios.post(payplusUrl, refundData, {
            headers,
            timeout: 30000
        });
        
        if (response.status === 200 && response.data?.results?.status === 'success') {
            return {
                success: true,
                data: response.data
            };
        } else {
            return {
                success: false,
                error: response.data?.results?.description || 'PayPlus refund failed'
            };
        }
        
    } catch (error) {
        return {
            success: false,
            error: error.response?.data?.description || error.message
        };
    }
};

/**
 * Send enhanced refund email notification
 */
const sendRefundEmailNotification = async (payment, refundAmount, refundType, reason) => {
    try {
        
        // Enhanced email template parameters
        const emailParams = {
            'student.name': payment.Student?.full_name || payment.student_name,
            'amount': formatCurrency(refundAmount, payment.currency),
            'currency': payment.currency.toUpperCase(),
            'refund.type': refundType === 'full' ? 'Full Refund' : 'Partial Refund',
            'refund.reason': reason,
            'original.amount': formatCurrency(payment.amount, payment.currency),
            'transaction.id': payment.transaction_id,
            'refund.date': new Date().toLocaleDateString(),
            'support.email': process.env.SUPPORT_EMAIL || 'support@tulkka.com'
        };
        
        const recipientDetails = {
            email: payment.Student?.email || payment.student_email,
            full_name: payment.Student?.full_name || payment.student_name,
            language: payment.Student?.language || 'EN'
        };
        
        const emailSent = await sendNotificationEmail(
            'payment_refund_notification', // You'll need to add this template
            emailParams,
            recipientDetails,
            false
        );
        
        return emailSent;
        
    } catch (error) {
        console.error('Error sending refund email notification:', error);
        return false;
    }
};

/**
 * Format currency helper function
 */
const formatCurrency = (amount, currency, decimals = 2) => {
    const symbols = {
        "ILS": "₪",
        "USD": "$", 
        "EUR": "€",
        "GBP": "£"
    };
    const symbol = symbols[currency.toUpperCase()] || currency;
    const formattedAmount = amount;
    return `${symbol}${formattedAmount}`;
};

/**
 * Get student lesson balance and usage data for frontend
 * Fixed version with correct calculations
 */
const getStudentLessonData = async (req, res) => {
    try {
        const { studentId } = req.params;
        
        console.log(`Fetching lesson data for student ID: ${studentId}`);
        
        // First, let's verify the student exists
        const student = await User.findByPk(studentId, {
            attributes: ['id', 'full_name', 'email']
        });
        
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        // Get student's active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { 
                user_id: studentId,
                status: 'active'
            }
        });
        
        if (!subscription) {
            console.log(`No active subscription found for student ${studentId}`);
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for student',
                student_info: {
                    id: student.id,
                    name: student.full_name,
                    email: student.email
                }
            });
        }
        
        console.log(`Found subscription:`, {
            id: subscription.id,
            weekly_lesson: subscription.weekly_lesson,
            left_lessons: subscription.left_lessons,
            lesson_reset_at: subscription.lesson_reset_at,
            created_at: subscription.created_at,
            status: subscription.status
        });
        
        // Calculate the subscription period start date
        // Use lesson_reset_at if available, otherwise use subscription created_at
        const subscriptionStartDate = subscription.lesson_reset_at || subscription.created_at;
        
        // Calculate lessons used since last reset (regular lessons only)
        const usedRegularLessons = await Class.count({
            where: {
                student_id: studentId, // Make sure this matches your Class model field
                status: 'ended',
                bonus_class: false, // Exclude bonus lessons
                created_at: {
                    [Op.gte]: subscriptionStartDate
                }
            }
        });
        
        // Calculate bonus lessons used since last reset
        const usedBonusLessons = await Class.count({
            where: {
                student_id: studentId,
                status: 'ended', 
                bonus_class: true, // Only bonus lessons
                created_at: {
                    [Op.gte]: subscriptionStartDate
                }
            }
        });
        
        // Get all completed lessons for debugging
        const allCompletedLessons = await Class.count({
            where: {
                student_id: studentId,
                status: 'ended',
                created_at: {
                    [Op.gte]: subscriptionStartDate
                }
            }
        });
        
        // Get current lesson balances from subscription
        const leftLessons = subscription.left_lessons || 0;
        const bonusLessonsAvailable = subscription.bonus_class || 0;
        const weeklyLessons = subscription.weekly_lesson || 0;
        
        // Calculate total lessons allocated for current period
        // For monthly subscriptions: weeklyLessons * 4
        // For other periods, adjust accordingly
        const weeksInPeriod = 4; // Assuming monthly cycle
        const totalLessonsAllocated = weeklyLessons * weeksInPeriod;
        
        // Alternative calculation: use actual lessons allocated at subscription start
        // This might be more accurate if you track the initial lesson allocation
        const actualTotalLessons = usedRegularLessons + leftLessons;
        
        // Use the larger of the two calculations to ensure accuracy
        const totalLessonsForPeriod = Math.max(totalLessonsAllocated, actualTotalLessons);
        
        console.log(`Lesson calculations:`, {
            studentId,
            studentName: student.full_name,
            usedRegularLessons,
            usedBonusLessons,
            allCompletedLessons,
            leftLessons,
            bonusLessonsAvailable,
            weeklyLessons,
            totalLessonsAllocated,
            actualTotalLessons,
            totalLessonsForPeriod,
            subscriptionStartDate: subscriptionStartDate
        });
        
        // Prepare the response data matching the frontend interface
        const hasManageableSubscription =
            subscription.status === 'active' &&
            subscription.inactive_after_renew !== 1;

        const lessonData = {
            total_lessons: weeklyLessons,
            used_lessons: usedRegularLessons,
            remaining_lessons: leftLessons, // Use the actual remaining from subscription
            bonus_lessons: bonusLessonsAvailable,
            weekly_lessons: weeklyLessons,
            last_renewal_lessons: leftLessons, // Lessons from last renewal/reset
            subscription_status: subscription.status,
            inactive_after_renew: subscription.inactive_after_renew,
            has_manageable_subscription: hasManageableSubscription,
            lesson_reset_date: subscription.lesson_reset_at,
            subscription_created: subscription.created_at,
            
            // Additional debug info (can be removed in production)
            debug_info: {
                subscription_id: subscription.id,
                used_bonus_lessons: usedBonusLessons,
                all_completed_lessons: allCompletedLessons,
                period_start: subscriptionStartDate,
                calculation_method: 'max(weekly_lessons * 4, used + remaining)',
                student_info: {
                    id: student.id,
                    name: student.full_name,
                    email: student.email
                }
            }
        };
        
        console.log(`Final lesson data response:`, lessonData);
        
        return res.status(200).json({
            status: 'success',
            data: lessonData,
            message: 'Student lesson data retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching student lesson data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching lesson data',
            details: error.message
        });
    }
};


/**
 * Preview PayPlus ↔ PaymentTransaction reconciliation for a user (no mutations)
 */
const previewPayplusReconciliation = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid userId is required'
            });
        }

        const studentId = parseInt(userId, 10);

        // 1) Find latest recurring payment transaction for this user
        const lastTxn = await PaymentTransaction.findOne({
            where: {
                student_id: studentId,
                payment_processor: 'payplus',
                is_recurring: true
            },
            order: [['created_at', 'DESC']]
        });

        if (!lastTxn) {
            return res.status(404).json({
                status: 'error',
                message: 'No recurring PayPlus transactions found for this user'
            });
        }

        // 2) Extract recurring_uid from stored response_data
        const parseResponseData = (raw) => {
            let parsed = raw;
            for (let i = 0; i < 2; i++) {
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch (err) {
                        break;
                    }
                } else {
                    break;
                }
            }
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        };

        const rd = parseResponseData(lastTxn.response_data);
        const dataSection = rd.data || rd.original_webhook || rd.transaction || {};
        const txnSection = rd.transaction || {};

        let recurringUid =
            rd.recurring_payment_uid ||
            rd.recurring_uid ||
            txnSection?.recurring_charge_information?.recurring_uid ||
            dataSection?.recurring_charge_information?.recurring_uid ||
            dataSection?.recurring_uid ||
            txnSection?.recurring_uid ||
            null;

        if (!recurringUid && rd.recurring_info) {
            recurringUid =
                rd.recurring_info.recurring_uid ||
                rd.recurring_info.recurring_charge_uid ||
                null;
        }

        if (!recurringUid) {
            return res.status(400).json({
                status: 'error',
                message: 'Could not determine recurring_uid from latest transaction response_data'
            });
        }

        // 3) Optionally fetch recurring details from PayPlus for transparency
        const recurringDetails = await getRecurringPaymentDetails(recurringUid);

        // 4) Load webhook logs and filter in-memory for this recurring_uid
        const allWebhookLogs = await PayPlusWebhookLog.findAll({
            order: [['created_at', 'ASC']]
        });

        const relatedWebhooks = allWebhookLogs.filter(log => {
            // raw_webhook_data may be stored as JSON or as a raw string in DB
            let raw = log.raw_webhook_data || {};
            if (typeof raw === 'string') {
                try {
                    raw = JSON.parse(raw);
                } catch (e) {
                    // keep as string if parsing fails
                }
            }
            const t = raw.transaction || {};
            const d = raw.data || {};
            const rw = raw.original_webhook || {};
            const rt = rw.transaction || {};
            const rd2 = rw.data || {};

            const ru =
                raw.recurring_payment_uid ||
                raw.recurring_uid ||
                t?.recurring_charge_information?.recurring_uid ||
                d?.recurring_charge_information?.recurring_uid ||
                d?.recurring_uid ||
                t?.recurring_uid ||
                rw.recurring_payment_uid ||
                rw.recurring_uid ||
                rt?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_uid ||
                rt?.recurring_uid ||
                null;

            // Fallback: if we couldn't structurally find ru but the raw string contains it, still treat as match
            if (!ru && typeof log.raw_webhook_data === 'string' && log.raw_webhook_data.includes(recurringUid)) {
                return true;
            }

            return ru === recurringUid;
        });

        // 5) For each related webhook, derive transaction_uid and check if PaymentTransaction exists
        const previewEntries = [];

        for (const log of relatedWebhooks) {
            const raw = log.raw_webhook_data || {};
            const t = raw.transaction || {};
            const d = raw.data || {};
            const rw = raw.original_webhook || {};
            const rt = rw.transaction || {};
            const rd2 = rw.data || {};

            const transactionUid =
                raw.transaction_uid ||
                t.uid ||
                d.transaction_uid ||
                rw.transaction_uid ||
                rt.uid ||
                rd2.transaction_uid ||
                log.transaction_uid ||
                null;

            if (!transactionUid) {
                previewEntries.push({
                    webhook_log_id: log.id,
                    has_transaction_uid: false,
                    transaction_uid: null,
                    exists_in_payment_transactions: false,
                    status: 'unmatched_no_uid'
                });
                continue;
            }

            const existingTx = await PaymentTransaction.findOne({
                where: {
                    transaction_id: transactionUid,
                    payment_processor: 'payplus'
                }
            });

            previewEntries.push({
                webhook_log_id: log.id,
                transaction_uid: transactionUid,
                exists_in_payment_transactions: !!existingTx,
                payment_transaction_id: existingTx ? existingTx.id : null,
                event_type: log.event_type,
                status_code: log.status_code,
                amount: log.amount,
                currency: log.currency_code
            });
        }

        // 6) Determine latest recurring_uid from latest related webhook (if changed)
        let latestRecurringUid = recurringUid;
        if (relatedWebhooks.length > 0) {
            const lastLog = relatedWebhooks[relatedWebhooks.length - 1];
            const raw = lastLog.raw_webhook_data || {};
            const t = raw.transaction || {};
            const d = raw.data || {};
            const rw = raw.original_webhook || {};
            const rt = rw.transaction || {};
            const rd2 = rw.data || {};

            const ru =
                raw.recurring_payment_uid ||
                raw.recurring_uid ||
                t?.recurring_charge_information?.recurring_uid ||
                d?.recurring_charge_information?.recurring_uid ||
                d?.recurring_uid ||
                t?.recurring_uid ||
                rw.recurring_payment_uid ||
                rw.recurring_uid ||
                rt?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_uid ||
                rt?.recurring_uid ||
                null;

            if (ru) {
                latestRecurringUid = ru;
            }
        }

        // 7) Get active subscription snapshot
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: studentId,
                status: 'active'
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                user_id: studentId,
                latest_payment_transaction: {
                    id: lastTxn.id,
                    transaction_id: lastTxn.transaction_id,
                    amount: lastTxn.amount,
                    currency: lastTxn.currency,
                    created_at: lastTxn.created_at
                },
                recurring_uid_initial: recurringUid,
                recurring_uid_latest: latestRecurringUid,
                recurring_details_available: recurringDetails.success,
                webhooks_total_checked: allWebhookLogs.length,
                webhooks_related_count: relatedWebhooks.length,
                reconciliation: previewEntries,
                subscription: subscription
                    ? {
                        id: subscription.id,
                        type: subscription.type,
                        status: subscription.status,
                        renew_date: subscription.renew_date,
                        lesson_min: subscription.lesson_min,
                        weekly_lesson: subscription.weekly_lesson
                    }
                    : null
            },
            message: 'Preview reconciliation data fetched successfully'
        });
    } catch (error) {
        console.error('Error in previewPayplusReconciliation:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while previewing reconciliation',
            details: error.message
        });
    }
};

/**
 * Apply PayPlus ↔ PaymentTransaction reconciliation for a user
 * - Inserts missing transactions based on webhook logs
 * - Updates active subscription renew_date
 * - Updates customer email in PayPlus
 */
const applyPayplusReconciliation = async (req, res) => {
    let transaction;
    try {
        const { userId } = req.params;

        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid userId is required'
            });
        }

        const studentId = parseInt(userId, 10);

        // 1) Find latest recurring PayPlus transaction for this user
        const lastTxn = await PaymentTransaction.findOne({
            where: {
                student_id: studentId,
                payment_processor: 'payplus',
                is_recurring: true
            },
            order: [['created_at', 'DESC']]
        });

        if (!lastTxn) {
            return res.status(404).json({
                status: 'error',
                message: 'No recurring PayPlus transactions found for this user'
            });
        }

        // 2) Extract recurring_uid from stored response_data (same logic as preview)
        const parseResponseData = (raw) => {
            let parsed = raw;
            for (let i = 0; i < 2; i++) {
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch (err) {
                        break;
                    }
                } else {
                    break;
                }
            }
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        };

        const rd = parseResponseData(lastTxn.response_data);
        const dataSection = rd.data || rd.original_webhook || rd.transaction || {};
        const txnSection = rd.transaction || {};

        let recurringUid =
            rd.recurring_payment_uid ||
            rd.recurring_uid ||
            txnSection?.recurring_charge_information?.recurring_uid ||
            dataSection?.recurring_charge_information?.recurring_uid ||
            dataSection?.recurring_uid ||
            txnSection?.recurring_uid ||
            null;

        if (!recurringUid && rd.recurring_info) {
            recurringUid =
                rd.recurring_info.recurring_uid ||
                rd.recurring_info.recurring_charge_uid ||
                null;
        }

        if (!recurringUid) {
            return res.status(400).json({
                status: 'error',
                message: 'Could not determine recurring_uid from latest transaction response_data'
            });
        }

        // 3) Load webhook logs and filter for this recurring_uid
        const allWebhookLogs = await PayPlusWebhookLog.findAll({
            order: [['created_at', 'ASC']]
        });

        const relatedWebhooks = allWebhookLogs.filter(log => {
            // raw_webhook_data may be stored as JSON or as a raw string in DB
            let raw = log.raw_webhook_data || {};
            if (typeof raw === 'string') {
                try {
                    raw = JSON.parse(raw);
                } catch (e) {
                    // keep as string if parsing fails
                }
            }
            const t = raw.transaction || {};
            const d = raw.data || {};
            const rw = raw.original_webhook || {};
            const rt = rw.transaction || {};
            const rd2 = rw.data || {};

            const ru =
                raw.recurring_payment_uid ||
                raw.recurring_uid ||
                t?.recurring_charge_information?.recurring_uid ||
                d?.recurring_charge_information?.recurring_uid ||
                d?.recurring_uid ||
                t?.recurring_uid ||
                rw.recurring_payment_uid ||
                rw.recurring_uid ||
                rt?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_charge_information?.recurring_uid ||
                rd2?.recurring_uid ||
                rt?.recurring_uid ||
                null;

            // Fallback: if we couldn't structurally find ru but the raw string contains it, still treat as match
            if (!ru && typeof log.raw_webhook_data === 'string' && log.raw_webhook_data.includes(recurringUid)) {
                return true;
            }

            return ru === recurringUid;
        });

        // 4) Collect transaction_uids from related webhooks
        const webhookEntries = relatedWebhooks.map(log => {
            const raw = log.raw_webhook_data || {};
            const t = raw.transaction || {};
            const d = raw.data || {};
            const rw = raw.original_webhook || {};
            const rt = rw.transaction || {};
            const rd2 = rw.data || {};

            const transactionUid =
                raw.transaction_uid ||
                t.uid ||
                d.transaction_uid ||
                rw.transaction_uid ||
                rt.uid ||
                rd2.transaction_uid ||
                log.transaction_uid ||
                null;

            return {
                log,
                transactionUid
            };
        });

        const allUids = webhookEntries
            .filter(e => !!e.transactionUid)
            .map(e => e.transactionUid);

        const uniqueUids = [...new Set(allUids)];

        // 5) Load existing PaymentTransaction records for these UIDs
        const existingTxs = uniqueUids.length
            ? await PaymentTransaction.findAll({
                  where: {
                      transaction_id: { [Op.in]: uniqueUids },
                      payment_processor: 'payplus'
                  }
              })
            : [];

        const existingUidSet = new Set(existingTxs.map(tx => tx.transaction_id));
        const existingUidToTxId = new Map();
        existingTxs.forEach(tx => {
            existingUidToTxId.set(tx.transaction_id, tx.id);
        });

        // 6) Determine which webhooks are missing in PaymentTransaction
        const missingWebhookEntries = webhookEntries.filter(
            e => e.transactionUid && !existingUidSet.has(e.transactionUid)
        );

        // Start DB transaction for inserts and subscription update
        transaction = await sequelize.transaction();

        const user = await User.findByPk(studentId, { transaction });
        if (!user) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User not found for given userId'
            });
        }

        const createdTransactions = [];

        // 7a) Mark already-matched webhooks as processed and link to existing transactions
        for (const entry of webhookEntries) {
            const { log, transactionUid } = entry;
            if (transactionUid && existingUidToTxId.has(transactionUid)) {
                await log.update(
                    {
                        processed: true,
                        linked_payment_transaction_id: existingUidToTxId.get(transactionUid),
                        updated_at: new Date()
                    },
                    { transaction }
                );
            }
        }

        // 7b) Insert missing PaymentTransaction records and mark their webhooks as processed
        for (const entry of missingWebhookEntries) {
            const { log, transactionUid } = entry;
            const raw = log.raw_webhook_data || {};
            const t = raw.transaction || {};
            const d = raw.data || {};

            const amount =
                (typeof t.amount !== 'undefined' ? t.amount : null) ??
                (typeof d.amount_pay !== 'undefined' ? d.amount_pay : null) ??
                log.amount ??
                0;

            const currency =
                t.currency ||
                d.currency ||
                log.currency_code ||
                'ILS';

            const statusCode = t.status_code || log.status_code;
            const isApproved = statusCode === '000' || statusCode === 0 || statusCode === 'Approved';
            const status = isApproved ? 'success' : 'failed';

            const studentName = user.full_name || d.customer_name || t.customer_name || 'Unknown';
            const studentEmail = user.email || d.customer_email || '';

            const newTx = await PaymentTransaction.create(
                {
                    token: transactionUid,
                    transaction_id: transactionUid,
                    status,
                    student_id: studentId,
                    user_id: studentId,
                    student_email: studentEmail,
                    student_name: studentName,
                    // Copy plan / lesson structure from latest recurring transaction so DB NOT NULL constraints are satisfied
                    plan_id: lastTxn.plan_id || null,
                    lessons_per_month: lastTxn.lessons_per_month || null,
                    duration_type: lastTxn.duration_type || null,
                    lesson_minutes: lastTxn.lesson_minutes || null,
                    custom_months: lastTxn.custom_months || null,
                    amount: parseFloat(amount) || 0,
                    currency,
                    is_recurring: true,
                    payment_method: 'credit_card',
                    payment_processor: 'payplus',
                    response_data: JSON.stringify(raw),
                    error_code: isApproved ? null : statusCode,
                    error_message: isApproved ? null : (t.message_description || null),
                    created_at: log.created_at || new Date(),
                    updated_at: new Date()
                },
                { transaction }
            );

            createdTransactions.push({
                id: newTx.id,
                transaction_id: newTx.transaction_id,
                amount: newTx.amount,
                currency: newTx.currency,
                status: newTx.status
            });

            // Mark this webhook log as processed and link to the newly created transaction
            await log.update(
                {
                    processed: true,
                    linked_payment_transaction_id: newTx.id,
                    updated_at: new Date()
                },
                { transaction }
            );
        }

        // 8) Verify active subscription and update renew_date using simple duration logic
        let subscriptionUpdate = null;
        const activeSubscription = await UserSubscriptionDetails.findOne(
            {
                where: {
                    user_id: studentId,
                    status: 'active'
                },
                order: [['created_at', 'DESC']]
            },
            { transaction }
        );

        if (activeSubscription) {
            const typeStr = (activeSubscription.type || '').toLowerCase();
            let months = 1;
            if (typeStr.includes('year')) {
                months = 12;
            } else if (typeStr.includes('quarter')) {
                months = 3;
            }

            const oldRenewDate = activeSubscription.renew_date;
            const newRenewDate = moment().add(months, 'months').toDate();

            // Update left_lessons by adding weekly_lesson
            const currentLeftLessons = parseInt(activeSubscription.left_lessons || 0);
            const weeklyLesson = parseInt(activeSubscription.weekly_lesson || 0);
            const newLeftLessons = currentLeftLessons + weeklyLesson;

            // Store old lesson_reset_at before update
            const oldLessonResetAt = activeSubscription.lesson_reset_at;

            // await activeSubscription.update(
            //     {
            //         renew_date: newRenewDate,
            //         lesson_reset_at: newRenewDate, // Set same as renew_date
            //         left_lessons: newLeftLessons,
            //         updated_at: new Date()
            //     },
            //     { transaction }
            // );

            subscriptionUpdate = {
                subscription_id: activeSubscription.id,
                old_renew_date: oldRenewDate,
                new_renew_date: newRenewDate,
                old_lesson_reset_at: oldLessonResetAt,
                new_lesson_reset_at: newRenewDate,
                old_left_lessons: currentLeftLessons,
                new_left_lessons: newLeftLessons,
                weekly_lesson_added: weeklyLesson
            };
        }

        await transaction.commit();

        // 9) Update customer email in PayPlus (outside DB transaction)
        let payplusEmailUpdate = null;
        try {
            const recurringDetails = await getRecurringPaymentDetails(recurringUid);
            if (recurringDetails.success) {
                const rData = recurringDetails.data;
                const pd = rData.data || rData.results?.data || rData;
                const customerUid =
                    pd.customer_uid ||
                    pd.customer?.customer_uid ||
                    rData.customer_uid ||
                    null;

                if (customerUid && user.email) {
                    const emailResult = await updatePayplusCustomerEmail(customerUid, user.email);
                    payplusEmailUpdate = {
                        success: emailResult.success,
                        customer_uid: customerUid,
                        error: emailResult.error || null
                    };
                } else {
                    payplusEmailUpdate = {
                        success: false,
                        message: 'Missing customer_uid or user email; skipping PayPlus email update',
                        customer_uid: customerUid || null
                    };
                }
            } else {
                payplusEmailUpdate = {
                    success: false,
                    message: 'Failed to fetch recurring details from PayPlus',
                    error: recurringDetails.error || null
                };
            }
        } catch (e) {
            console.error('Error updating PayPlus customer email during reconciliation:', e);
            payplusEmailUpdate = {
                success: false,
                message: 'Exception while updating PayPlus customer email',
                error: e.message
            };
        }

        return res.status(200).json({
            status: 'success',
            data: {
                user_id: studentId,
                recurring_uid: recurringUid,
                created_transactions_count: createdTransactions.length,
                created_transactions: createdTransactions,
                subscription_update: subscriptionUpdate,
                payplus_email_update: payplusEmailUpdate
            },
            message: 'Reconciliation applied successfully'
        });
    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('Error in applyPayplusReconciliation:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while applying reconciliation',
            details: error.message
        });
    }
};


module.exports = {
    getPaymentTransactions,
    getPaymentTransactionById,
    getPaymentStatistics,
    updatePaymentStatus,
    getPaymentFilters,
    exportPaymentTransactions,
    downloadInvoice,
    processRefund,
    downloadCreditInvoice,
    getStudentPaymentHistory,
    processEnhancedRefund,
    getStudentLessonData,
    previewPayplusReconciliation,
    applyPayplusReconciliation,
    getMarch2026PaymentLessonFix,
    fixMarch2026PaymentLessonConfig,
    getUpcomingMonthSubscriptionFixFromPayments,
    fixUpcomingMonthSubscriptionFromPayments
};