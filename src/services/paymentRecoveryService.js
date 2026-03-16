// src/services/paymentRecoveryService.js
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

// PayPlus API Configuration
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || '',
    terminalUid: process.env.PAYPLUS_TERMINAL_UID || ''
};

/**
 * Generate a PayPlus payment link for recovering a failed payment
 * @param {Object} params - Recovery link parameters
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Generated payment link details
 */
const generateRecoveryPaymentLink = async (params, transaction) => {
    try {
        const {
            user,
            subscription,
            past_due_payment,
            failed_amount,
            currency
        } = params;

        console.log(`Generating recovery payment link for user ${user.id}, amount: ${failed_amount} ${currency}`);

        // Validate required data
        if (!user || !subscription || !past_due_payment) {
            throw new Error('Missing required data for recovery link generation');
        }

        // FIX: Extract original subscription parameters instead of using hardcoded values
        const originalSubscriptionType = subscription.type || 'Monthly_25';
        let actualMonths = 1; // Default for recurring
        let actualDurationType = 'monthly';

        // Parse the subscription type to determine original duration
        if (originalSubscriptionType.includes('Yearly')) {
            actualMonths = 12;
            actualDurationType = 'yearly';
        } else if (originalSubscriptionType.includes('Quarterly')) {
            actualMonths = 3;
            actualDurationType = 'quarterly';
        } else {
            actualMonths = 1;
            actualDurationType = 'monthly';
        }

        // Use actual subscription values
        const actualLessonMinutes = subscription.lesson_min || 25;
        const actualLessonsPerMonth = subscription.weekly_lesson || 4;

        console.log(`Recovery link using actual subscription data:`, {
            originalSubscriptionType,
            actualMonths,
            actualDurationType,
            actualLessonMinutes,
            actualLessonsPerMonth
        });

        // Prepare customer data for PayPlus
        const customerData = {
            customer_name: user.full_name || 'Customer',
            phone: user.mobile || ''
        };

        // Only add email if it exists
        if (user.email && user.email.trim() !== '') {
            customerData.email = user.email;
        }

        // Create description for the payment using actual subscription type
        const planDescription = `Subscription Renewal - ${originalSubscriptionType} (${actualLessonMinutes} min lessons)`;

        // FIX: Use proper recovery tracking data with correct field mapping
        const additionalData = {
            uid: user.id,                           // user_id
            sid: subscription.id,                   // subscription_id  
            pdid: past_due_payment.id,             // past_due_payment_id
            rt: 'recovery',                        // recovery_type
            lm: actualLessonMinutes,               // lesson_minutes (actual)
            lpm: actualLessonsPerMonth,            // lessons_per_month (actual)
            dt: actualDurationType,                // duration_type (actual)
            m: actualMonths,                       // months (actual)
            am: failed_amount,                     // amount
            cur: currency || 'ILS',               // currency
            fd: past_due_payment.failed_at,       // failed_date
            lang: user.language || 'HE',          // language
            ost: originalSubscriptionType          // original_subscription_type (for verification)
        };

        // Encode additional data
        const jsonData = JSON.stringify(additionalData);
        const base64 = Buffer.from(jsonData).toString('base64');
        const encodedData = encodeURIComponent(base64);

        console.log('Recovery link encoded data length:', encodedData.length);

        // FIX: Calculate proper recurring settings based on actual subscription
        let recurringType, recurringRange, jumpPaymentDays;

        if (actualDurationType === 'yearly') {
            recurringType = 2; // Monthly
            recurringRange = 12; // Every 12 months
            jumpPaymentDays = 365; // Jump by year
        } else if (actualDurationType === 'quarterly') {
            recurringType = 2; // Monthly
            recurringRange = 3; // Every 3 months
            jumpPaymentDays = 90; // Jump by quarter
        } else {
            recurringType = 2; // Monthly
            recurringRange = 1; // Every month
            jumpPaymentDays = 30; // Jump by month
        }

        // FIX: Prepare PayPlus request with correct field mapping
        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: failed_amount,
            currency_code: currency || 'ILS',
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            token_for_terminal_uid: PAYPLUS_CONFIG.terminalUid,
            refURL_success: `${process.env.FRONTEND_URL}/payment/payplus/success`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/payplus/failed`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`,
            expiry_datetime: 999, // 1 year validity
            customer: customerData,
            items: [{
                name: planDescription,
                quantity: 1,
                price: failed_amount,
                vat_type: 0 // No VAT
            }],
            // FIX: Proper field mapping for recovery payments
            more_info: 'recovery',
            more_info_1: user.id.toString(),                    // user_id
            more_info_2: actualLessonMinutes.toString(),        // lesson_minutes (actual)
            more_info_3: actualLessonsPerMonth.toString(),      // lessons_per_month (actual)
            more_info_4: actualMonths.toString(),               // months (actual) - NOT past_due_payment.id!
            more_info_5: encodedData,                           // encoded additional data
            charge_method: 3, // Recurring payment to maintain subscription
            payments: 1,
            recurring_settings: {
                instant_first_payment: true,
                recurring_type: recurringType,        // Calculated based on actual subscription
                recurring_range: recurringRange,      // Calculated based on actual subscription
                number_of_charges: 0, // Unlimited
                start_date_on_payment_date: true,
                jump_payments: jumpPaymentDays,       // Calculated based on actual subscription
                successful_invoice: true,
                customer_failure_email: true,
                send_customer_success_email: true
            }
        };

        console.log('Recovery PayPlus request:', {
            more_info_1: payPlusRequest.more_info_1,
            more_info_2: payPlusRequest.more_info_2,
            more_info_3: payPlusRequest.more_info_3,
            more_info_4: payPlusRequest.more_info_4,
            recurring_settings: payPlusRequest.recurring_settings,
            originalSubscriptionType,
            actualDurationType
        });

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results.status === 'success') {
            const paymentUrl = response.data.data.payment_page_link;
            const pageRequestUid = response.data.data.page_request_uid;

            console.log(`Recovery payment link generated successfully: ${pageRequestUid}`);

            return {
                success: true,
                payment_url: paymentUrl,
                page_request_uid: pageRequestUid,
                qr_code_image: response.data.data.qr_code_image,
                expires_at: moment().add(7, 'days').toISOString(),
                details: {
                    user_id: user.id,
                    subscription_id: subscription.id,
                    past_due_payment_id: past_due_payment.id,
                    amount: failed_amount,
                    currency: currency,
                    link_type: 'recovery',
                    original_subscription_type: originalSubscriptionType,
                    actual_months: actualMonths,
                    actual_duration_type: actualDurationType,
                    created_at: new Date().toISOString()
                }
            };
        } else {
            throw new Error(response.data.results.description || 'PayPlus API error during recovery link generation');
        }

    } catch (error) {
        console.error('Error generating recovery payment link:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

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
        resolved_payment_method: 'payplus_recovery',
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

/**
 * Validate and format card expiration date to MMYY format
 * @param {string} dateInput - Card expiration date in various formats
 * @returns {string} - Formatted date in MMYY format
 * @throws {Error} - If date format is invalid
 */
const formatCardExpirationDate = (dateInput) => {
    if (!dateInput) {
        throw new Error('Card expiration date is required');
    }

    // Remove all non-digit characters (slashes, dashes, spaces, etc.)
    let cleaned = dateInput.toString().replace(/\D/g, '');

    // Handle different input formats
    let month, year;

    if (cleaned.length === 4) {
        // MMYY format (e.g., "1225")
        month = cleaned.substring(0, 2);
        year = cleaned.substring(2, 4);
    } else if (cleaned.length === 6) {
        // MMYYYY format (e.g., "122025")
        month = cleaned.substring(0, 2);
        year = cleaned.substring(4, 6); // Take last 2 digits of year
    } else if (cleaned.length === 3) {
        // MYY format (e.g., "125") - add leading zero to month
        month = '0' + cleaned.substring(0, 1);
        year = cleaned.substring(1, 3);
    } else {
        throw new Error(`Invalid card expiration date format. Expected MMYY (4 digits), received: ${dateInput}`);
    }

    // Validate month is 01-12
    const monthNum = parseInt(month, 10);
    if (monthNum < 1 || monthNum > 12) {
        throw new Error(`Invalid month: ${month}. Month must be between 01 and 12`);
    }

    // Validate year is not in the past
    const currentYear = new Date().getFullYear() % 100; // Get last 2 digits of current year
    const yearNum = parseInt(year, 10);
    
    // Allow cards expiring in current year or future
    // Note: This doesn't check the specific month, just the year
    if (yearNum < currentYear) {
        throw new Error(`Card has expired. Year ${year} is in the past`);
    }

    // Return formatted MMYY
    return month + year;
};

/**
 * Add a new credit card token to PayPlus
 * @param {Object} params - Card token parameters
 * @returns {Object} - Token addition result
 */
const addCardToken = async (params) => {
    try {
        const {
            customer_uid,
            terminal_uid,
            credit_card_number,
            card_date_mmyy,
            cvv,
            card_holder_name,
            card_holder_id
        } = params;

        console.log(`Adding card token for customer ${customer_uid}`);

        // Validate required fields
        if (!customer_uid || !terminal_uid || !credit_card_number || !card_date_mmyy || !cvv || !card_holder_name) {
            throw new Error('Missing required fields for card token addition');
        }

        // Convert card_date_mmyy from "0526" to "05/26" format
        // PayPlus requires MM/YY format with slash
        let formattedDate = card_date_mmyy;
        if (card_date_mmyy && card_date_mmyy.length === 4 && !card_date_mmyy.includes('/')) {
            const month = card_date_mmyy.substring(0, 2);
            const year = card_date_mmyy.substring(2, 4);
            formattedDate = `${month}/${year}`;
            console.log(`Converted card date from "${card_date_mmyy}" to "${formattedDate}"`);
        }

        // Prepare PayPlus request
        const payPlusRequest = {
            customer_uid: customer_uid,
            terminal_uid: terminal_uid,
            credit_card_number: credit_card_number,
            card_date_mmyy: formattedDate,
            cvv: cvv,
            card_holder_name: card_holder_name
        };

        // Add card_holder_id if provided
        if (card_holder_id) {
            payPlusRequest.card_holder_id = card_holder_id;
        }

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/Token/Add`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results && response.data.results.status === 'success') {
            const cardToken = response.data.data?.card_uid || response.data.data?.token_uid || response.data.data?.token;
            
            console.log(`Card token added successfully: ${cardToken}`);

            return {
                success: true,
                card_token: cardToken,
                customer_uid: customer_uid,
                details: response.data.data || {}
            };
        } else {
            throw new Error(response.data.results?.description || 'PayPlus API error during card token addition');
        }

    } catch (error) {
        console.error('Error adding card token:', error);
        return {
            success: false,
            error: error.response?.data?.results?.description || error.message,
            details: error.response?.data || null
        };
    }
};


/**
 * List existing card tokens for a PayPlus customer
 * @param {String} customer_uid - PayPlus customer UID
 * @returns {Object} - List result with tokens
 */
const listCustomerTokens = async (customer_uid) => {
    try {
        if (!customer_uid) {
            throw new Error('customer_uid is required to list tokens');
        }

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/Token/List`,
            { 
                customer_uid,
                terminal_uid: PAYPLUS_CONFIG.terminalUid
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results && response.data.results.status === 'success') {
            const tokens = response.data.data || [];
            return {
                success: true,
                tokens
            };
        }

        throw new Error(response.data.results?.description || 'PayPlus API error during token list');

    } catch (error) {
        console.error('Error listing card tokens:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

/**
 * Update PayPlus customer email to ensure future webhooks use the correct address
 * @param {String} customer_uid - PayPlus customer UID
 * @param {String} email - New customer email
 * @returns {Object} - Update result
 */
const updatePayplusCustomerEmail = async (customer_uid, email) => {
    try {
        if (!customer_uid || !email) {
            throw new Error('customer_uid and email are required to update PayPlus customer');
        }

        console.log(`Updating PayPlus customer email`, { customer_uid, email });

        const authorizationHeader = JSON.stringify({
            api_key: PAYPLUS_CONFIG.apiKey,
            secret_key: PAYPLUS_CONFIG.secretKey
        });

        const requestBody = {
            customer_uid,
            email
        };

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${customer_uid}`,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authorizationHeader
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data?.results?.status === 'success') {
            console.log(`✅ PayPlus customer email updated successfully for ${customer_uid}`);
            return {
                success: true,
                data: response.data.data || {}
            };
        }

        const description = response.data?.results?.description || 'PayPlus API error during customer update';
        console.error('❌ PayPlus customer update failed:', description);

        return {
            success: false,
            error: description,
            details: response.data || null
        };

    } catch (error) {
        console.error('❌ Error updating PayPlus customer email:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

/**
 * Add immediate recurring charge to a recurring payment
 * @param {Object} params - Charge parameters
 * @returns {Object} - Charge result
 */
const addRecurringCharge = async (params) => {
    try {
        const {
            recurring_uid,
            terminal_uid,
            card_token,
            charge_date,
            amount,
            currency_code,
            valid,
            description,
            items
        } = params;

        console.log(`Adding immediate charge to recurring payment ${recurring_uid}`);

        // Validate required fields
        if (!recurring_uid || !amount || !terminal_uid || !card_token) {
            throw new Error('Missing required fields: recurring_uid, amount, terminal_uid, and card_token are required');
        }

        // Prepare PayPlus request
        // PayPlus doesn't support same-day payments, so default to next day
        const payPlusRequest = {
            terminal_uid: terminal_uid,
            card_token: card_token,
            charge_date: charge_date || moment().add(1, 'day').format('YYYY-MM-DD'),
            amount: parseFloat(amount),
            currency_code: currency_code || 'ILS',
            valid: valid !== undefined ? valid : true,
            description: description || 'Past due payment recovery',
            
            // ✅ ADD CALLBACK SETTINGS - THE KEY FIX FOR WEBHOOKS!
            send_failure_callback: true,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`
        };

        // Add items if provided
        if (items && Array.isArray(items) && items.length > 0) {
            payPlusRequest.items = items;
        }

        console.log('✅ Adding charge with callback URL:', payPlusRequest.refURL_callback);

        // Prepare Authorization header as JSON string
        const authorizationHeader = JSON.stringify({
            api_key: PAYPLUS_CONFIG.apiKey,
            secret_key: PAYPLUS_CONFIG.secretKey
        });

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/AddRecurringCharge/${recurring_uid}`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authorizationHeader
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results && response.data.results.status === 'success') {
            console.log(`✅ Recurring charge added successfully: ${recurring_uid}`);

            return {
                success: true,
                recurring_uid: recurring_uid,
                charge_uid: response.data.data?.recurring_charge_uid || null,
                transaction_uid: response.data.data?.transaction_uid || null,
                details: response.data.data || {}
            };
        } else {
            throw new Error(response.data.results?.description || 'PayPlus API error during recurring charge');
        }

    } catch (error) {
        console.error('❌ Error adding recurring charge:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

/**
 * Get current recurring payment details from PayPlus
 * @param {string} recurring_uid - Recurring payment UID
 * @returns {Object} - Current recurring payment details
 */
const getRecurringPaymentDetails = async (recurring_uid) => {
    try {
        console.log(`Fetching recurring payment details for ${recurring_uid}`);

        // Prepare Authorization header
        const authorizationHeader = JSON.stringify({
            api_key: PAYPLUS_CONFIG.apiKey,
            secret_key: PAYPLUS_CONFIG.secretKey
        });

        // Make API call to PayPlus
        const response = await axios.get(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/${recurring_uid}/ViewRecurring`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authorizationHeader
                },
                params: {
                    terminal_uid: PAYPLUS_CONFIG.terminalUid
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data) {
            console.log(`✅ Successfully fetched recurring payment details`);
            return {
                success: true,
                data: response.data
            };
        } else {
            throw new Error('No data returned from PayPlus');
        }

    } catch (error) {
        console.error('❌ Error fetching recurring payment details:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

/**
 * Update recurring payment with new card token (PRESERVING ALL SETTINGS)
 * @param {Object} params - Recurring payment update parameters
 * @returns {Object} - Update result
 */
const updateRecurringPayment = async (params) => {
    try {
        const {
            recurring_uid,
            customer_uid,
            card_token,
            terminal_uid,
            cashier_uid,
            currency_code,
            instant_first_payment,
            valid,
            recurring_type,
            recurring_range,
            number_of_charges,
            amount,
            items
        } = params;

        console.log(`Updating recurring payment ${recurring_uid} with new card token`);

        // Validate required fields
        if (!recurring_uid || !customer_uid || !card_token || !terminal_uid) {
            throw new Error('Missing required fields for recurring payment update');
        }

        // STEP 1: GET EXISTING SETTINGS FIRST!
        console.log('📥 Fetching existing recurring payment settings...');
        const existingDetails = await getRecurringPaymentDetails(recurring_uid);
        
        if (!existingDetails.success) {
            console.warn('⚠️ Could not fetch existing settings, proceeding with defaults');
        }

        const existingSettings = existingDetails.data || {};

        console.log('Existing recurring payment settings:', {
            customer_failure_email: existingSettings.customer_failure_email,
            send_customer_success_email: existingSettings.send_customer_success_email,
            successful_invoice: existingSettings.successful_invoice,
            send_failure_callback: existingSettings.send_failure_callback,
            recurring_type: existingSettings.recurring_type,
            recurring_range: existingSettings.recurring_range
        });

        // STEP 2: PREPARE REQUEST WITH ALL SETTINGS PRESERVED
        const payPlusRequest = {
            customer_uid: customer_uid,
            card_token: card_token,
            terminal_uid: terminal_uid,
            cashier_uid: cashier_uid,
            currency_code: currency_code || existingSettings.currency_code || 'ILS',
            instant_first_payment: instant_first_payment !== undefined 
                ? instant_first_payment 
                : (existingSettings.instant_first_payment !== undefined ? existingSettings.instant_first_payment : false),
            
            valid: valid !== undefined 
                ? valid 
                : (existingSettings.valid !== undefined ? existingSettings.valid : true),
            
            recurring_type: recurring_type !== undefined 
                ? recurring_type 
                : (existingSettings.recurring_type !== undefined ? existingSettings.recurring_type : 3),
            
            recurring_range: recurring_range !== undefined 
                ? recurring_range 
                : (existingSettings.recurring_range !== undefined ? existingSettings.recurring_range : 1),
            
            number_of_charges: number_of_charges !== undefined 
                ? number_of_charges 
                : (existingSettings.number_of_charges !== undefined ? existingSettings.number_of_charges : 0),

            // PRESERVE NOTIFICATION SETTINGS - THE KEY FIX!
            customer_failure_email: existingSettings.customer_failure_email !== undefined 
                ? existingSettings.customer_failure_email 
                : true,
            send_customer_success_email: existingSettings.send_customer_success_email !== undefined 
                ? existingSettings.send_customer_success_email 
                : true,
            successful_invoice: existingSettings.successful_invoice !== undefined 
                ? existingSettings.successful_invoice 
                : true,
            send_failure_callback: existingSettings.send_failure_callback !== undefined 
                ? existingSettings.send_failure_callback 
                : true,
            customer_failure_sms: existingSettings.customer_failure_sms !== undefined 
                ? existingSettings.customer_failure_sms 
                : false,
            send_customer_success_sms: existingSettings.send_customer_success_sms !== undefined 
                ? existingSettings.send_customer_success_sms 
                : false,
            send_renewal_email: existingSettings.send_renewal_email !== undefined 
                ? existingSettings.send_renewal_email 
                : false,

            // Amount - use provided, existing, or calculate from items
            amount: amount !== undefined 
                ? parseFloat(amount) 
                : (existingSettings.amount !== undefined 
                    ? parseFloat(existingSettings.amount) 
                    : (items && Array.isArray(items) && items.length > 0 
                        ? items.reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 1)), 0)
                        : null)),

            // Add callback URL for webhooks
            ref_url_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`
        };

        // Add optional fields only if they exist
        if (existingSettings.start_date) {
            payPlusRequest.start_date = existingSettings.start_date;
        }
        if (existingSettings.end_date) {
            payPlusRequest.end_date = existingSettings.end_date;
        }

        // PayPlus restriction: "Recurring payment can only start from tomorrow"
        // If start_date is today or in the past, force it to tomorrow to avoid API error.
        if (payPlusRequest.start_date) {
            try {
                const start = moment(payPlusRequest.start_date, 'YYYY-MM-DD');
                const today = moment().startOf('day');

                if (!start.isValid() || !start.isAfter(today)) {
                    const tomorrow = today.clone().add(1, 'day');
                    console.log('Adjusting recurring start_date to tomorrow to satisfy PayPlus constraints', {
                        original_start_date: payPlusRequest.start_date,
                        adjusted_start_date: tomorrow.format('YYYY-MM-DD')
                    });
                    payPlusRequest.start_date = tomorrow.format('YYYY-MM-DD');
                }
            } catch (e) {
                // If parsing fails, let PayPlus handle it; no-op here.
            }
        }

        // Add items
        if (items && Array.isArray(items) && items.length > 0) {
            payPlusRequest.items = items;
        } else if (existingSettings.items && Array.isArray(existingSettings.items)) {
            payPlusRequest.items = existingSettings.items;
        }

        // Remove null/undefined values to match curl request structure
        Object.keys(payPlusRequest).forEach(key => {
            if (payPlusRequest[key] === null || payPlusRequest[key] === undefined) {
                delete payPlusRequest[key];
            }
        });

        console.log('✅ Updating with preserved settings:', {
            card_token: payPlusRequest.card_token.substring(0, 20) + '...',
            customer_failure_email: payPlusRequest.customer_failure_email,
            send_customer_success_email: payPlusRequest.send_customer_success_email,
            successful_invoice: payPlusRequest.successful_invoice,
            send_failure_callback: payPlusRequest.send_failure_callback
        });

        // Prepare Authorization header as JSON string
        const authorizationHeader = JSON.stringify({
            api_key: PAYPLUS_CONFIG.apiKey,
            secret_key: PAYPLUS_CONFIG.secretKey
        });

        // STEP 3: UPDATE WITH ALL FIELDS
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/Update/${recurring_uid}`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authorizationHeader
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT) || 30000
            }
        );

        if (response.data.results && response.data.results.status === 'success') {
            console.log(`✅ Recurring payment updated successfully with ALL settings preserved`);

            return {
                success: true,
                recurring_uid: recurring_uid,
                details: response.data.data || {},
                settings_preserved: true
            };
        } else {
            throw new Error(response.data.results?.description || 'PayPlus API error during recurring payment update');
        }

    } catch (error) {
        console.error('❌ Error updating recurring payment:', error);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null
        };
    }
};

module.exports = {
    isRecoveryPayment,
    processRecoveryPayment,
    createNewSubscriptionFromOld,
    cancelExistingRecurringPayments,
    createNewRecurringPayment,
    extractRecurringPaymentUid,
    cancelPayPlusRecurring,
    determineSubscriptionType,
    createOrUpdateSubscription,
    resolvePastDuePayment,
    disableDunningSchedule,
    createRecoveryPaymentTransaction,
    updateWebhookLog,
    generateRecoveryPaymentLink,
    addCardToken,
    listCustomerTokens,
    updateRecurringPayment,
    addRecurringCharge,
    getRecurringPaymentDetails,
    updatePayplusCustomerEmail
};