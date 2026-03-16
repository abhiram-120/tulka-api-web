// src/services/recoveryPaymentService.js
const axios = require('axios');
const moment = require('moment');
const { Op } = require('sequelize');

// Import required models
const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const PaymentTransaction = require('../models/PaymentTransaction');
const RecurringPayment = require('../models/RecurringPayment');
const PastDuePayment = require('../models/PastDuePayment');
const DunningSchedule = require('../models/DunningSchedule');
const PayPlusWebhookLog = require('../models/PayPlusWebhookLog');
const { paymentLogger } = require('../utils/paymentLogger');

/**
 * Check if a payment is a recovery payment
 * @param {Object} webhookData - PayPlus webhook data
 * @param {Object} additionalData - Decoded additional data
 * @returns {Boolean} - True if recovery payment
 */
const isRecoveryPayment = (webhookData, additionalData) => {
    try {
        return additionalData.recovery_type === 'recovery' || 
               additionalData.past_due_payment_id || 
               webhookData.more_info === 'recovery';
    } catch (error) {
        console.error('Error checking recovery payment status:', error);
        return false;
    }
};

/**
 * Determine subscription type based on billing period and lesson duration
 * @param {Number} months - Number of months in subscription
 * @param {Number} lessonMinutes - Duration of each lesson in minutes
 * @returns {String} - Subscription type
 */
const determineSubscriptionType = (months, lessonMinutes) => {
    try {
        // Determine billing frequency based on months
        if (months >= 12) {
            return 'Yearly';
        } else if (months >= 3 && months < 12) {
            return 'Quarterly';
        } else {
            // Monthly subscription - include lesson duration
            return `Monthly_${lessonMinutes}`;
        }
    } catch (error) {
        return `Monthly_${lessonMinutes || 30}`;
    }
};

/**
 * Create or update user subscription - adapted for recovery payments
 * @param {Number} studentId - Student ID
 * @param {Number} lessonsPerMonth - Lessons per month
 * @param {Number} lessonMinutes - Lesson duration in minutes
 * @param {Number} months - Subscription duration in months
 * @param {Number} amount - Payment amount
 * @param {Boolean} isRecurring - Whether payment is recurring
 * @param {Object} previousSubscription - Previous subscription (not used in recovery)
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Subscription creation result
 */
const createOrUpdateSubscription = async (studentId, lessonsPerMonth, lessonMinutes, months, amount, isRecurring, previousSubscription, transaction) => {
    try {
        // Validate input parameters
        if (!studentId || isNaN(studentId)) {
            throw new Error(`Invalid student ID: ${studentId}`);
        }

        if (!lessonsPerMonth || isNaN(lessonsPerMonth) || lessonsPerMonth <= 0) {
            throw new Error(`Invalid lessons per month: ${lessonsPerMonth}`);
        }

        if (!lessonMinutes || isNaN(lessonMinutes) || lessonMinutes <= 0) {
            throw new Error(`Invalid lesson minutes: ${lessonMinutes}`);
        }

        if (!months || isNaN(months) || months <= 0) {
            throw new Error(`Invalid months: ${months}`);
        }

        // Verify the user exists
        const user = await User.findByPk(studentId, { transaction });
        if (!user) {
            throw new Error(`User with ID ${studentId} does not exist`);
        }

        console.log(`Creating recovery subscription for user ${studentId}: ${lessonsPerMonth} lessons/month × ${lessonMinutes}min for ${months} months`);

        // Use the new payment parameters
        const finalLessonsPerMonth = parseInt(lessonsPerMonth);
        const finalLessonMinutes = parseInt(lessonMinutes);
        const finalSubscriptionType = determineSubscriptionType(months, finalLessonMinutes);

        // Find and deactivate existing active subscriptions
        const existingActiveSubscriptions = await UserSubscriptionDetails.findAll({
            where: { 
                user_id: studentId,
                status: 'active',
                is_cancel: 0
            },
            order: [['created_at', 'DESC']],
            transaction
        });

        if (existingActiveSubscriptions.length > 0) {
            console.log(`Found ${existingActiveSubscriptions.length} existing active subscriptions to deactivate`);
            
            // Deactivate existing subscriptions
            for (const existingSubscription of existingActiveSubscriptions) {
                await existingSubscription.update({
                    status: 'inactive',
                    is_cancel: 1,
                    updated_at: new Date(),
                }, { transaction });
                
                console.log(`Deactivated existing subscription ${existingSubscription.id}`);
            }
        }

        // Calculate renewal date and other parameters
        const renewDate = moment().add(months, 'months').toDate();
        const totalLessons = finalLessonsPerMonth * months;
        const costPerLesson = totalLessons > 0 ? amount / totalLessons : 0;

        // Create subscription data
        const subscriptionData = {
            type: finalSubscriptionType,
            each_lesson: finalLessonMinutes.toString(),
            renew_date: renewDate,
            how_often: `${finalLessonsPerMonth} lessons per month`,
            weekly_lesson: finalLessonsPerMonth,
            status: 'active',
            lesson_min: finalLessonMinutes,
            left_lessons: totalLessons,
            lesson_reset_at: moment().add(1, 'month').toDate(),
            cost_per_lesson: parseFloat(costPerLesson.toFixed(2)),
            is_cancel: 0,
            plan_id: 1,
            payment_status: 'online',
            weekly_comp_class: 0,
            bonus_class: 0,
            bonus_completed_class: 0,
            bonus_expire_date: null,
            notes: `Created on ${new Date().toISOString()} from recovery payment processing`,
            created_at: new Date(),
            updated_at: new Date()
        };

        // Create new subscription
        const createdSubscription = await UserSubscriptionDetails.create({
            user_id: studentId,
            ...subscriptionData,
            balance: 0
        }, { transaction });

        const subscriptionId = createdSubscription.id;

        // Update user table with new subscription information
        const userUpdateData = {
            subscription_type: finalSubscriptionType,
            trial_expired: true,
            subscription_id: subscriptionId,
            updated_at: Math.floor(Date.now() / 1000)
        };

        await User.update(userUpdateData, {
            where: { id: studentId },
            transaction
        });

        console.log(`Created new subscription ${subscriptionId} for recovery payment`);

        const result = {
            subscription_id: subscriptionId,
            subscription_type: finalSubscriptionType,
            is_new_subscription: true,
            lessons_added: totalLessons,
            lesson_minutes: finalLessonMinutes,
            lessons_per_month: finalLessonsPerMonth,
            user_updated: true,
            previous_subscription_used: false,
            existing_subscriptions_deactivated: existingActiveSubscriptions.length,
            deactivated_subscription_ids: existingActiveSubscriptions.map(sub => sub.id),
            configuration_preserved_from_existing: false
        };

        return result;
    } catch (error) {
        console.error('Error in createOrUpdateSubscription for recovery:', error);
        throw error;
    }
};

/**
 * Process recovery payment - handles the complete recovery flow
 * @param {Object} webhookData - PayPlus webhook data
 * @param {Object} additionalData - Decoded additional data
 * @param {Number} webhookLogId - Webhook log ID
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Processing result
 */
const processRecoveryPayment = async (webhookData, additionalData, webhookLogId, transaction) => {
    try {
        const {
            transaction_uid,
            amount,
            currency_code,
            customer_name,
            customer_email,
            payment_method,
            four_digits,
            recurring_info
        } = webhookData;

        console.log(`Processing recovery payment: ${transaction_uid}`);

        // Extract recovery-specific data
        const userId = additionalData.user_id || additionalData.uid;
        const pastDuePaymentId = additionalData.past_due_payment_id || additionalData.pdid;
        
        if (!userId || !pastDuePaymentId) {
            throw new Error('Missing required recovery payment data (user_id or past_due_payment_id)');
        }

        console.log(`Recovery data: User ${userId}, PastDue ${pastDuePaymentId}`);

        // Get the past due payment with related data
        const pastDuePayment = await PastDuePayment.findByPk(pastDuePaymentId, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'language', 'timezone']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status', 'lesson_min', 'weekly_lesson', 'plan_id', 'cost_per_lesson']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            throw new Error(`Past due payment ${pastDuePaymentId} not found`);
        }

        if (pastDuePayment.status !== 'past_due') {
            throw new Error(`Past due payment ${pastDuePaymentId} is not in past_due status`);
        }

        const user = pastDuePayment.User;
        const oldSubscription = pastDuePayment.Subscription;

        console.log(`Found past due payment for user: ${user.full_name} (${user.email})`);

        // Step 1: Cancel all existing active recurring payments for this user
        const cancelledRecurringCount = await cancelExistingRecurringPayments(userId, transaction);
        console.log(`Cancelled ${cancelledRecurringCount} existing recurring payments`);

        // Step 2: Mark past due payment as resolved
        await resolvePastDuePayment(pastDuePayment, transaction_uid, amount, currency_code, transaction);

        // Step 3: Disable related dunning schedule
        await disableDunningSchedule(pastDuePaymentId, transaction);

        // Step 4: Create new subscription based on old subscription parameters
        const subscriptionResult = await createNewSubscriptionFromOld(oldSubscription, userId, transaction);

        // Step 5: Create new payment transaction record
        const paymentTransaction = await createRecoveryPaymentTransaction({
            transaction_uid,
            userId,
            user,
            amount,
            currency_code,
            customer_name,
            customer_email,
            payment_method,
            four_digits,
            subscription: subscriptionResult.subscriptionDetails,
            webhookData
        }, transaction);

        // Step 6: Create new recurring payment entry
        const newRecurringPayment = await createNewRecurringPayment({
            userId,
            subscriptionId: subscriptionResult.newSubscriptionId,
            transactionUid: transaction_uid,
            amount: parseFloat(amount),
            currency: currency_code,
            webhookData,
            recurringInfo: recurring_info,
            subscription: subscriptionResult.subscriptionDetails
        }, transaction);

        // Step 7: Update webhook log if provided
        if (webhookLogId) {
            await updateWebhookLog(webhookLogId, paymentTransaction.id, transaction);
        }

        // Log successful recovery
        paymentLogger.logPaymentVerification({
            student_id: userId,
            student_name: user.full_name,
            subscription_id: subscriptionResult.newSubscriptionId,
            verification_type: 'recovery_payment_success_with_new_subscription',
            verification_result: true,
            subscription_details: {
                past_due_payment_id: pastDuePaymentId,
                past_due_resolved: true,
                cancelled_recurring_payments: cancelledRecurringCount,
                old_subscription_id: subscriptionResult.oldSubscriptionId,
                old_subscription_deactivated: true,
                new_subscription_id: subscriptionResult.newSubscriptionId,
                new_subscription_created: true,
                new_recurring_payment_id: newRecurringPayment.id,
                dunning_disabled: true,
                payment_transaction_id: paymentTransaction.id,
                recovery_transaction_uid: transaction_uid
            }
        });

        return {
            success: true,
            userId,
            subscriptionId: subscriptionResult.newSubscriptionId,
            pastDuePaymentId,
            subscriptionRestored: subscriptionResult.restored,
            cancelledRecurringCount,
            newRecurringPaymentId: newRecurringPayment.id,
            paymentTransactionId: paymentTransaction.id,
            oldSubscriptionId: subscriptionResult.oldSubscriptionId,
            newSubscriptionCreated: true
        };

    } catch (error) {
        console.error('Error in processRecoveryPayment:', error);
        
        paymentLogger.logPaymentVerification({
            student_id: additionalData?.uid || 'unknown',
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'recovery_payment_error_new_approach',
            verification_result: false,
            error_details: {
                error_type: 'recovery_payment_exception',
                error_message: error.message,
                error_stack: error.stack,
                transaction_uid: webhookData.transaction_uid
            }
        });
        
        throw error;
    }
};

/**
 * Create new subscription based on old subscription parameters
 * @param {Object} oldSubscription - Old subscription object
 * @param {Number} userId - User ID
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Creation result
 */
const createNewSubscriptionFromOld = async (oldSubscription, userId, transaction) => {
    if (!oldSubscription) {
        throw new Error('No old subscription found to base recovery on');
    }

    try {
        // Step 1: Mark old subscription as inactive and cancelled
        await oldSubscription.update({
            status: 'inactive',
            is_cancel: 1,
            updated_at: new Date()
        }, { transaction });

        console.log(`Marked old subscription ${oldSubscription.id} as inactive and cancelled`);

        // Step 2: Extract parameters from old subscription
        const oldLessonMinutes = oldSubscription.lesson_min || 25;
        const oldLessonsPerMonth = oldSubscription.weekly_lesson || 4;
        const oldSubscriptionType = oldSubscription.type || 'Monthly_25';
        
        // Determine months based on subscription type
        let months = 1; // Default for monthly
        if (oldSubscriptionType.includes('Yearly')) {
            months = 12;
        } else if (oldSubscriptionType.includes('Quarterly')) {
            months = 3;
        }

        // Calculate amount based on old cost per lesson
        const oldCostPerLesson = oldSubscription.cost_per_lesson || 0;
        const totalLessons = oldLessonsPerMonth * months;
        const calculatedAmount = oldCostPerLesson * totalLessons;

        console.log(`Creating new subscription with parameters from old subscription:`, {
            userId,
            lessonsPerMonth: oldLessonsPerMonth,
            lessonMinutes: oldLessonMinutes,
            months,
            amount: calculatedAmount,
            oldSubscriptionType
        });

        // Step 3: Create new subscription using the createOrUpdateSubscription function
        const newSubscriptionResult = await createOrUpdateSubscription(
            userId,
            oldLessonsPerMonth,
            oldLessonMinutes, 
            months,
            calculatedAmount,
            true, // isRecurring - always true for recovery
            null, // previousSubscription - null since we're creating fresh
            transaction
        );

        console.log(`Created new subscription ${newSubscriptionResult.subscription_id} for recovery`);

        return {
            restored: true,
            newSubscriptionId: newSubscriptionResult.subscription_id,
            oldSubscriptionId: oldSubscription.id,
            subscriptionDetails: {
                lesson_minutes: oldLessonMinutes,
                lessons_per_month: oldLessonsPerMonth,
                months: months,
                amount: calculatedAmount,
                subscription_type: newSubscriptionResult.subscription_type,
                cost_per_lesson: oldCostPerLesson
            }
        };

    } catch (error) {
        console.error(`Error creating new subscription from old for user ${userId}:`, error);
        throw new Error(`Failed to create new subscription from old: ${error.message}`);
    }
};

/**
 * Cancel existing active recurring payments for a user
 * @param {Number} userId - User ID
 * @param {Object} transaction - Database transaction
 * @returns {Number} - Number of cancelled payments
 */
const cancelExistingRecurringPayments = async (userId, transaction) => {
    try {
        const activeRecurringPayments = await RecurringPayment.findAll({
            where: {
                student_id: userId,
                status: { [Op.in]: ['pending', 'paid', 'active'] },
                is_active: true
            },
            transaction
        });

        let cancelledCount = 0;

        for (const payment of activeRecurringPayments) {
            // Try to cancel at PayPlus if we have a valid UID
            let payPlusCancelled = true;
            const recurringUid = payment.payplus_transaction_uid;

            if (recurringUid && recurringUid !== 'N/A' && recurringUid !== '') {
                try {
                    payPlusCancelled = await cancelPayPlusRecurring(recurringUid, payment.webhook_data);
                } catch (cancelError) {
                    console.warn(`Warning: Could not cancel PayPlus recurring ${recurringUid}:`, cancelError.message);
                    payPlusCancelled = false;
                }
            }

            // Update local record regardless of PayPlus result
            await payment.update({
                status: 'cancelled',
                is_active: false,
                cancelled_at: new Date(),
                cancelled_by: null,
                remarks: `${payment.remarks || ''}\n[${new Date().toISOString()}] Cancelled due to recovery payment. PayPlus cancelled: ${payPlusCancelled}.`
            }, { transaction });

            cancelledCount++;
        }

        return cancelledCount;

    } catch (error) {
        console.error('Error cancelling existing recurring payments:', error);
        throw error;
    }
};

/**
 * Mark past due payment as resolved
 * @param {Object} pastDuePayment - Past due payment object
 * @param {String} transactionUid - Transaction UID
 * @param {Number} amount - Payment amount
 * @param {String} currency - Currency code
 * @param {Object} transaction - Database transaction
 */
const resolvePastDuePayment = async (pastDuePayment, transactionUid, amount, currency, transaction) => {
    await pastDuePayment.update({
        status: 'resolved',
        resolved_at: new Date(),
        resolved_transaction_id: transactionUid,
        notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Resolved via recovery payment. Transaction: ${transactionUid}. Amount: ${amount} ${currency}.`
    }, { transaction });

    console.log(`Marked past due payment ${pastDuePayment.id} as resolved`);
};

/**
 * Disable dunning schedule
 * @param {Number} pastDuePaymentId - Past due payment ID
 * @param {Object} transaction - Database transaction
 */
const disableDunningSchedule = async (pastDuePaymentId, transaction) => {
    await DunningSchedule.update({
        is_enabled: false,
        next_reminder_at: null,
        updated_at: new Date()
    }, {
        where: { past_due_payment_id: pastDuePaymentId },
        transaction
    });

    console.log(`Disabled dunning schedule for past due payment ${pastDuePaymentId}`);
};

/**
 * Create payment transaction for recovery
 * @param {Object} params - Payment transaction parameters
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Created payment transaction
 */
const createRecoveryPaymentTransaction = async (params, transaction) => {
    const {
        transaction_uid,
        userId,
        user,
        amount,
        currency_code,
        customer_name,
        customer_email,
        payment_method,
        four_digits,
        subscription,
        webhookData
    } = params;

    const paymentTransaction = await PaymentTransaction.create({
        token: transaction_uid,
        transaction_id: transaction_uid,
        status: 'success',
        student_id: userId,
        student_email: customer_email || user.email,
        student_name: customer_name || user.full_name,
        amount: amount ? parseFloat(amount) : 0,
        currency: currency_code || 'ILS',
        payment_method: payment_method || 'unknown',
        card_last_digits: four_digits ? four_digits.slice(-4) : null,
        lessons_per_month: subscription?.lessons_per_month || 4,
        lesson_minutes: subscription?.lesson_minutes || 25,
        custom_months: subscription?.months || 1,
        is_recurring: true,
        generated_by: null,
        payment_processor: 'payplus',
        response_data: JSON.stringify(webhookData.original_webhook || webhookData),
        payment_type: 'recovery',
        data_source: 'recovery_payment'
    }, { transaction });

    console.log(`Created payment transaction ${paymentTransaction.id} for recovery`);
    return paymentTransaction;
};

/**
 * Create new recurring payment for recovery
 * @param {Object} params - Recurring payment parameters
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Created recurring payment
 */
const createNewRecurringPayment = async (params, transaction) => {
    try {
        const {
            userId,
            subscriptionId,
            transactionUid,
            amount,
            currency,
            webhookData,
            recurringInfo,
            subscription
        } = params;

        // Extract recurring UID from webhook data
        const recurringUid = extractRecurringPaymentUid(webhookData) || 
                           recurringInfo?.recurring_uid || 
                           transactionUid;

        const pageRequestUid = recurringInfo?.page_request_uid || 
                             webhookData?.page_request_uid || 
                             null;

        // Determine recurring frequency based on subscription
        let recurringFrequency = 'monthly';
        let nextPaymentDate = moment().add(1, 'month').format('YYYY-MM-DD');

        if (subscription?.subscription_type) {
            if (subscription.subscription_type.includes('Yearly')) {
                recurringFrequency = 'yearly';
                nextPaymentDate = moment().add(1, 'year').format('YYYY-MM-DD');
            } else if (subscription.subscription_type.includes('Quarterly')) {
                recurringFrequency = 'quarterly';
                nextPaymentDate = moment().add(3, 'months').format('YYYY-MM-DD');
            }
        }

        const recurringPaymentData = {
            student_id: userId,
            managed_by_id: null,
            managed_by_role: 'admin',
            subscription_id: subscriptionId,
            payplus_transaction_uid: recurringUid,
            payplus_page_request_uid: pageRequestUid,
            amount: parseFloat(amount),
            currency: currency || 'ILS',
            payment_date: moment().format('YYYY-MM-DD'),
            status: 'paid',
            transaction_id: transactionUid,
            next_payment_date: nextPaymentDate,
            recurring_frequency: recurringFrequency,
            recurring_count: 1,
            max_recurring_count: null,
            booked_monthly_classes: 0,
            payment_method: webhookData?.payment_method || 'credit_card',
            card_last_digits: webhookData?.four_digits ? webhookData.four_digits.slice(-4) : null,
            failure_reason: null,
            failure_count: 0,
            webhook_data: JSON.stringify({
                ...webhookData,
                recovery_payment: true,
                created_from_recovery: true,
                processed_at: new Date().toISOString()
            }),
            remarks: `Recovery payment processed successfully. Original failed payment resolved. New recurring subscription started.`,
            is_active: true,
            cancelled_at: null,
            cancelled_by: null
        };

        const newRecurringPayment = await RecurringPayment.create(recurringPaymentData, { transaction });

        console.log(`Created new recurring payment ${newRecurringPayment.id} for recovery`);

        return newRecurringPayment;

    } catch (error) {
        console.error('Error creating new recurring payment:', error);
        throw error;
    }
};

/**
 * Update webhook log with payment transaction link
 * @param {Number} webhookLogId - Webhook log ID
 * @param {Number} paymentTransactionId - Payment transaction ID
 * @param {Object} transaction - Database transaction
 */
const updateWebhookLog = async (webhookLogId, paymentTransactionId, transaction) => {
    await PayPlusWebhookLog.update(
        {
            linked_payment_transaction_id: paymentTransactionId
        },
        { where: { id: webhookLogId }, transaction }
    );
};

/**
 * Extract recurring payment UID from webhook data
 * @param {Object} webhookData - Webhook data
 * @returns {String|null} - Recurring payment UID or null
 */
const extractRecurringPaymentUid = (webhookData) => {
    try {
        if (!webhookData) return null;

        // Direct from webhook data properties
        const directUid = webhookData.recurring_payment_uid ||
                         webhookData.payplus_transaction_uid ||
                         webhookData.recurring_uid ||
                         webhookData.recurring_charge_uid;

        if (directUid && directUid !== 'N/A' && directUid !== 'undefined') {
            return directUid;
        }

        // From recurring_info object
        if (webhookData.recurring_info) {
            const recurringInfoUid = webhookData.recurring_info.recurring_uid ||
                                   webhookData.recurring_info.recurring_charge_uid;
            if (recurringInfoUid && recurringInfoUid !== 'N/A') {
                return recurringInfoUid;
            }
        }

        // From original_webhook nested data
        if (webhookData.original_webhook) {
            const originalUid = webhookData.original_webhook.recurring_payment_uid ||
                              webhookData.original_webhook.recurring_uid;
            if (originalUid && originalUid !== 'N/A') {
                return originalUid;
            }

            // Check data and transaction objects
            if (webhookData.original_webhook.data?.recurring_uid) {
                return webhookData.original_webhook.data.recurring_uid;
            }

            if (webhookData.original_webhook.transaction?.recurring_uid) {
                return webhookData.original_webhook.transaction.recurring_uid;
            }
        }

        return null;

    } catch (error) {
        console.error('Error extracting recurring payment UID:', error);
        return null;
    }
};

/**
 * Cancel PayPlus recurring payment
 * @param {String} recurringUid - Recurring payment UID
 * @param {Object} webhookData - Webhook data (optional)
 * @returns {Boolean} - True if cancelled successfully
 */
const cancelPayPlusRecurring = async (recurringUid, webhookData = null) => {
    try {
        const PAYPLUS_CONFIG = {
            apiKey: process.env.PAYPLUS_API_KEY,
            secretKey: process.env.PAYPLUS_SECRET_KEY,
            baseUrl: process.env.PAYPLUS_BASE_URL,
            terminalUid: process.env.PAYPLUS_TERMINAL_UID
        };

        let terminalUid = PAYPLUS_CONFIG.terminalUid;
        
        if (webhookData) {
            try {
                const parsedWebhookData = typeof webhookData === 'string' ? JSON.parse(webhookData) : webhookData;
                if (parsedWebhookData.original_webhook?.terminal_uid) {
                    terminalUid = parsedWebhookData.original_webhook.terminal_uid;
                }
            } catch (parseError) {
                // Use default terminal UID
            }
        }

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${recurringUid}`,
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

        return response.status === 200 || response.status === 204;

    } catch (error) {
        if (error.response?.status === 404 || 
            error.response?.data?.includes('not found') ||
            error.response?.data?.includes('already cancelled')) {
            return true;
        }
        
        console.error(`PayPlus recurring payment cancellation failed for ${recurringUid}:`, error.message);
        return false;
    }
};

module.exports = {
    isRecoveryPayment,
    processRecoveryPayment,
    createNewSubscriptionFromOld,
    cancelExistingRecurringPayments,
    createNewRecurringPayment,
    extractRecurringPaymentUid,
    cancelPayPlusRecurring
};