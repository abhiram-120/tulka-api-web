// controller/sales/payment-success.controller.js
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PaymentTransaction = require('../../models/PaymentTransaction');
const Referral = require('../../models/Referral');
const ReferralReward = require('../../models/ReferralReward');
const ReferralTier = require('../../models/ReferralTier');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const RecurringPayment = require('../../models/RecurringPayment');
const PastDuePayment = require('../../models/PastDuePayment');
const DunningSchedule = require('../../models/DunningSchedule');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const DirectPaymentCustomer = require('../../models/DirectPaymentCustomer');
const Lesson = require('../../models/classes');
const { paymentLogger } = require('../../utils/paymentLogger');
const { sequelize } = require('../../connection/connection');
const bcrypt = require('bcrypt');
const securePassword = require('../../utils/encryptPassword');
const { sendCombinedNotifications } = require('../../cronjobs/reminder');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const axios = require('axios');
const recoveryPaymentService = require('../../services/recoveryPaymentService');

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
    paymentLogger.logPaymentVerification({
      student_id: 'system',
      student_name: 'system',
      subscription_id: null,
      verification_type: 'subscription_type_determination_error',
      verification_result: false,
      error_details: {
        error_type: 'subscription_type_error',
        error_message: error.message,
        months: months,
        lesson_minutes: lessonMinutes
      }
    });
    return `Monthly_${lessonMinutes || 30}`;
  }
};

/**
 * Generate a unique transaction ID when one is missing
 * @returns {String} - Unique transaction ID
 */
const generateTransactionId = () => {
  return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Process successful payment callback from PayPlus (Legacy URL support)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processPayPlusSuccessfulPayment = async (req, res) => {
  let transaction;
  const legacyStartTime = Date.now();

  try {
    // Start database transaction
    transaction = await sequelize.transaction();

    // Parse the PayPlus response data
    const parsedData = parsePayPlusResponse(req.body);

    // Log legacy callback processing start
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_success',
      transaction_uid: 'parsing',
      status: 'processing',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      processing_result: {
        callback_type: 'legacy_success',
        processing_start_time: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      },
      webhook_payload: req.body
    });

    // Extract essential data - PayPlus specific field mappings with fallbacks
    const transactionId = parsedData.transaction_uid
      || parsedData.transaction_id
      || parsedData.index
      || generateTransactionId();

    // Validate transaction ID
    if (!transactionId || transactionId === 'undefined' || transactionId === '') {
      paymentLogger.logWebhookEvent({
        event_type: 'legacy_callback_validation_failed',
        transaction_uid: transactionId || 'invalid',
        status: 'failed',
        amount: parseFloat(parsedData.amount || parsedData.sum || 0),
        currency: parsedData.currency_code || parsedData.currency || 'USD',
        customer_email: parsedData.customer_email || parsedData.student_email || parsedData.email || '',
        customer_name: parsedData.customer_name || parsedData.student_name || parsedData.contact || '',
        payment_method: parsedData.payment_method || parsedData.cardtype || '',
        error_details: {
          error_type: 'invalid_transaction_id',
          error_message: 'Missing or invalid transaction ID parameters',
          provided_transaction_id: transactionId
        }
      });

      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing or invalid transaction ID parameters'
      });
    }

    // Check if this transaction has already been processed
    const existingCompletedTransaction = await PaymentTransaction.findOne({
      where: {
        [Op.or]: [
          { transaction_id: transactionId },
          { token: transactionId }
        ],
        status: 'success'
      },
      transaction
    });

    if (existingCompletedTransaction) {
      paymentLogger.logWebhookEvent({
        event_type: 'legacy_callback_duplicate',
        transaction_uid: transactionId,
        status: 'duplicate',
        amount: parseFloat(parsedData.amount || parsedData.sum || 0),
        currency: parsedData.currency_code || parsedData.currency || 'USD',
        customer_email: parsedData.customer_email || parsedData.student_email || parsedData.email || '',
        customer_name: parsedData.customer_name || parsedData.student_name || parsedData.contact || '',
        payment_method: parsedData.payment_method || parsedData.cardtype || '',
        processing_result: {
          duplicate_prevented: true,
          existing_transaction_id: existingCompletedTransaction.id
        }
      });

      if (transaction) await transaction.rollback();
      return res.status(200).json({
        status: 'success',
        data: {
          transaction_id: transactionId,
          status: 'success'
        },
        message: 'Payment already processed'
      });
    }

    // Normalize the parsed data to match webhook format for processing
    const normalizedData = {
      transaction_uid: transactionId,
      amount: parseFloat(parsedData.amount || parsedData.sum || 0),
      currency_code: parsedData.currency_code || parsedData.currency || 'USD',
      customer_name: parsedData.customer_name || parsedData.student_name || parsedData.contact || '',
      customer_email: parsedData.customer_email || parsedData.student_email || parsedData.email || '',
      payment_method: parsedData.payment_method || parsedData.cardtype || '',
      four_digits: parsedData.four_digits || parsedData.ccno || '',
      more_info_1: parsedData.more_info_1 || parsedData.student_id || '',
      more_info_2: parsedData.more_info_2 || parsedData.lesson_minutes || '',
      more_info_3: parsedData.more_info_3 || parsedData.lessons_per_month || '',
      more_info_4: parsedData.more_info_4 || parsedData.months || parsedData.custom_months || '',
      more_info_5: parsedData.more_info_5 || '',
      is_recurring: false, // Legacy callbacks are typically not recurring
      recurring_info: {}, // Empty object for legacy compatibility
      original_webhook: parsedData
    };

    // Process the payment using webhook logic with normalized data
    await processSuccessfulWebhookPayment(normalizedData, null, transaction);

    await transaction.commit();

    const processingTime = Date.now() - legacyStartTime;

    // Log successful legacy processing
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_success_complete',
      transaction_uid: transactionId,
      status: 'success',
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      customer_email: normalizedData.customer_email,
      customer_name: normalizedData.customer_name,
      payment_method: normalizedData.payment_method,
      processing_result: {
        processing_time_ms: processingTime,
        legacy_callback_processed: true,
        data_normalized: true
      }
    });

    return res.status(200).json({
      status: 'success',
      data: {
        transaction_id: transactionId,
        status: 'success'
      },
      message: 'PayPlus payment processed successfully'
    });

  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        paymentLogger.logWebhookEvent({
          event_type: 'transaction_rollback_error',
          transaction_uid: 'unknown',
          status: 'error',
          amount: null,
          currency: null,
          customer_email: null,
          customer_name: null,
          payment_method: null,
          error_details: {
            error_type: 'rollback_error',
            error_message: rollbackError.message,
            error_stack: rollbackError.stack
          }
        });
      }
    }

    const processingTime = Date.now() - legacyStartTime;

    // Log legacy processing error
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_error',
      transaction_uid: 'unknown',
      status: 'error',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'legacy_processing_error',
        error_message: error.message,
        error_stack: error.stack,
        processing_time_ms: processingTime
      },
      webhook_payload: req.body
    });

    return res.status(500).json({
      status: 'error',
      message: 'Error processing PayPlus payment',
      details: error.message
    });
  }
};

/**
 * Parse the PayPlus response data (Legacy format support)
 * @param {Object} body - Request body from PayPlus
 * @returns {Object} - Parsed data
 */
const parsePayPlusResponse = (body) => {
  try {
    // If body contains a single key with PayPlus's format (starting with &)
    if (Object.keys(body).length === 1 && Object.keys(body)[0].startsWith('&')) {
      const responseString = Object.keys(body)[0];
      const params = {};
      const pairs = responseString.substring(1).split('&'); // Remove the leading & and split

      pairs.forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value !== undefined) {
          params[key] = decodeURIComponent(value);
        }
      });

      // Extract data from original_data if it exists
      if (params.original_data) {
        try {
          const decodedData = atob(params.original_data);
          const originalParams = new URLSearchParams(decodedData);

          // Merge original_data parameters into our result
          originalParams.forEach((value, key) => {
            if (!params[key]) {
              params[key] = value;
            }
          });
        } catch (error) {
          paymentLogger.logWebhookEvent({
            event_type: 'original_data_decode_error',
            transaction_uid: 'unknown',
            status: 'warning',
            amount: null,
            currency: null,
            customer_email: null,
            customer_name: null,
            payment_method: null,
            error_details: {
              error_type: 'decode_error',
              error_message: error.message,
              original_data_length: params.original_data?.length || 0
            }
          });
        }
      }

      return params;
    }

    // If it's already in a structured format, return it as is
    return body;
  } catch (error) {
    paymentLogger.logWebhookEvent({
      event_type: 'payplus_response_parse_error',
      transaction_uid: 'unknown',
      status: 'error',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'parse_error',
        error_message: error.message,
        body_keys: Object.keys(body || {})
      }
    });
    return body;
  }
};

/**
 * Process successful payment from webhook - ENHANCED VERSION WITH EARLY TRANSACTION STORAGE
 * @param {Object} webhookData - Extracted PayPlus webhook data
 * @param {Number} webhookLogId - ID of the webhook log entry
 * @param {Object} transaction - Database transaction
 */
const processSuccessfulWebhookPayment = async (webhookData, webhookLogId, transaction) => {
    try {
        const {
            transaction_uid,
            page_request_uid,
            amount,
            currency_code,
            customer_name,
            customer_email,
            payment_method,
            four_digits,
            more_info_1,
            more_info_2,
            more_info_3,
            more_info_4,
            more_info_5,
            is_recurring,
            recurring_info
        } = webhookData;

        // Log payment verification start
        paymentLogger.logPaymentVerification({
            student_id: more_info_1 || 'unknown',
            student_name: customer_name || 'unknown',
            subscription_id: null,
            verification_type: 'webhook_payment_processing',
            verification_result: false, // Will update as we progress
            error_details: null
        });

        // Validate required fields
        if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
            throw new Error('Transaction UID is required for payment processing');
        }

        let studentId = more_info_1 ? parseInt(more_info_1) : null;
        let trialClassId = null;
        let additionalData = {};
        let isNewUser = false; // Track if this is a new user creation

        // Enhanced decoding with robust error handling
        if (more_info_5 && more_info_5 !== '' && more_info_5 !== 'undefined' && more_info_5 !== 'null') {
            try {
                console.log('more_info_5:', more_info_5);
                // Step 1: URL decode (reverse of encodeURIComponent)
                const urlDecoded = decodeURIComponent(more_info_5);

                if (urlDecoded && urlDecoded.length > 0) {
                    // Step 2: Base64 decode (reverse of Buffer.from().toString('base64'))
                    const base64Decoded = Buffer.from(urlDecoded, 'base64').toString('utf8');

                    if (base64Decoded && base64Decoded.trim().length > 0) {
                        // Step 3: Clean and parse JSON
                        const cleanedJson = base64Decoded.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '');

                        // Validate JSON structure before parsing
                        if (cleanedJson.startsWith('{') && cleanedJson.endsWith('}')) {
                            const decodedData = JSON.parse(cleanedJson);
                            
                            // NEW: Map short keys back to full names
                            additionalData = {
                                plan_id: decodedData.pid || decodedData.plan_id,
                                student_id: decodedData.sid || decodedData.student_id,
                                trail_user_id: decodedData.tid || decodedData.trail_user_id,
                                user_id: decodedData.uid || decodedData.user_id,
                                past_due_payment_id: decodedData.pdid || decodedData.past_due_payment_id,
                                recovery_type: decodedData.rt || decodedData.recovery_type,
                                lessons_per_month: decodedData.lpm || decodedData.lessons_per_month,
                                duration_type: decodedData.dt || decodedData.duration_type,
                                lesson_minutes: decodedData.lm || decodedData.lesson_minutes,
                                months: decodedData.m || decodedData.months,
                                is_recurring: decodedData.ir !== undefined ? decodedData.ir : decodedData.is_recurring,
                                salesperson_id: decodedData.spid || decodedData.salesperson_id,
                                payment_type: decodedData.pt || decodedData.payment_type,
                                customer_first_name: decodedData.fn || decodedData.customer_first_name,
                                customer_last_name: decodedData.ln || decodedData.customer_last_name,
                                customer_language: decodedData.lang || decodedData.customer_language,
                                amount: decodedData.am || decodedData.amount,
                                currency: decodedData.cur || decodedData.currency,
                                failed_date: decodedData.fd || decodedData.failed_date,
                                original_subscription_type: decodedData.ost || decodedData.original_subscription_type,
                                guardian_id: decodedData.gid || decodedData.guardian_id // guardian_id (parent user ID)
                            };
                            
                            paymentLogger.logPaymentVerification({
                                student_id: more_info_1 || 'unknown',
                                student_name: customer_name || 'unknown',
                                subscription_id: null,
                                verification_type: 'additional_data_decode_success',
                                verification_result: true,
                                subscription_details: {
                                    decoded_data_keys: Object.keys(additionalData),
                                    decode_method: 'url_base64_json_short_keys'
                                }
                            });
                        } else {
                            throw new Error('Invalid JSON structure');
                        }
                    }
                }
            } catch (error) {
                console.error('Error decoding additional data:', error);
                additionalData = {};
            }
        }

        // Check if this is a recovery payment using the service
        if (recoveryPaymentService.isRecoveryPayment(webhookData, additionalData)) {
            console.log(`Processing recovery payment for transaction: ${transaction_uid}`);
            
            const recoveryResult = await recoveryPaymentService.processRecoveryPayment(
                webhookData, 
                additionalData, 
                webhookLogId,
                transaction
            );
            
            if (recoveryResult.success) {
                console.log(`Recovery payment processed successfully for user ${recoveryResult.userId}`);
                
                // Log final recovery success
                paymentLogger.logPaymentVerification({
                    student_id: recoveryResult.userId,
                    student_name: customer_name || 'unknown',
                    subscription_id: recoveryResult.subscriptionId,
                    verification_type: 'recovery_payment_processing_complete',
                    verification_result: true,
                    subscription_details: {
                        transaction_uid: transaction_uid,
                        recovery_successful: true,
                        past_due_resolved: true,
                        old_recurring_cancelled: recoveryResult.cancelledRecurringCount,
                        new_recurring_created: true,
                        subscription_restored: recoveryResult.subscriptionRestored
                    }
                });
                
                return; // Exit early for recovery payments
            } else {
                throw new Error('Recovery payment processing failed');
            }
        }

        // Continue with existing regular payment processing logic
        console.log(`Processing regular payment for transaction: ${transaction_uid}`);

        // Extract data with proper fallbacks
        trialClassId = additionalData.trail_user_id
            || additionalData.student_id
            || (more_info_1 ? parseInt(more_info_1) : null);

        if (!studentId) {
            studentId = trialClassId;
        }

        // 🆕 NEW: Check for previous subscription if more_info fields are null/empty
        let previousSubscription = null;
        if (studentId && (
            !more_info_2 || more_info_2 === 'null' || more_info_2 === '' ||
            !more_info_3 || more_info_3 === 'null' || more_info_3 === '' ||
            !more_info_4 || more_info_4 === 'null' || more_info_4 === ''
        )) {
            // Find the most recent subscription for this user
            previousSubscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: studentId,
                    [Op.or]: [
                        { status: 'active' }
                    ]
                },
                order: [['created_at', 'DESC']],
                transaction
            });

            if (previousSubscription) {
                // Log subscription verification
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: customer_name || 'unknown',
                    subscription_id: previousSubscription.id,
                    verification_type: 'previous_subscription_found',
                    verification_result: true,
                    subscription_details: {
                        subscription_id: previousSubscription.id,
                        subscription_type: previousSubscription.type,
                        lesson_minutes: previousSubscription.lesson_min,
                        weekly_lessons: previousSubscription.weekly_lesson,
                        status: previousSubscription.status,
                        left_lessons: previousSubscription.left_lessons
                    }
                });
            } else {
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'previous_subscription_lookup',
                    verification_result: false,
                    error_details: {
                        message: 'No previous subscription found',
                        student_id: studentId,
                        lookup_criteria: 'active status'
                    }
                });
            }
        }

        // 🆕 ENHANCED: Extract parameters with previous subscription fallback
        let lessonMinutes, lessonsPerMonth, customMonths, planId;

        if (previousSubscription && (
            !more_info_2 || more_info_2 === 'null' || more_info_2 === '' ||
            !more_info_3 || more_info_3 === 'null' || more_info_3 === ''
        )) {
            // Use previous subscription data
            lessonMinutes = previousSubscription.lesson_min || 25;
            lessonsPerMonth = previousSubscription.weekly_lesson || 4;
            customMonths = 1; // Always 1 for recurring payments
            planId = previousSubscription.plan_id || 1;
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: customer_name || 'unknown',
                subscription_id: previousSubscription.id,
                verification_type: 'using_previous_subscription_data',
                verification_result: true,
                subscription_details: {
                    lesson_minutes: lessonMinutes,
                    lessons_per_month: lessonsPerMonth,
                    data_source: 'previous_subscription'
                }
            });
        } else {
            // Use webhook/additional data
            lessonMinutes = Math.max(15, parseInt(additionalData.lesson_minutes || more_info_2 || 25));
            lessonsPerMonth = Math.max(1, parseInt(additionalData.lessons_per_month || more_info_3 || 4));
            customMonths = Math.max(1, parseInt(additionalData.months || additionalData.custom_months || more_info_4 || 1));
            planId = additionalData.plan_id ? parseInt(additionalData.plan_id) : 1;
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: customer_name || 'unknown',
                subscription_id: null,
                verification_type: 'using_webhook_data',
                verification_result: true,
                subscription_details: {
                    lesson_minutes: lessonMinutes,
                    lessons_per_month: lessonsPerMonth,
                    data_source: 'webhook_data'
                }
            });
        }

        const normalizeBoolean = (value) => {
          if (value === true || value === 1) return true;
          if (value === false || value === 0) return false;
          if (typeof value === "string") {
            return value.toLowerCase() === "true";
          }
          return false;
        };
        
        const isRecurringPayment = normalizeBoolean(additionalData.is_recurring) || normalizeBoolean(is_recurring);
        
        const salespersonId = additionalData.salesperson_id ? parseInt(additionalData.salesperson_id) : null;
        const durationType = additionalData.duration_type || 'monthly';

        // Log payment processing parameters
        paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: customer_name || 'unknown',
            subscription_id: null,
            verification_type: 'payment_parameters_extracted',
            verification_result: true,
            subscription_details: {
                student_id: studentId,
                trial_class_id: trialClassId,
                lesson_minutes: lessonMinutes,
                lessons_per_month: lessonsPerMonth,
                custom_months: customMonths,
                is_recurring: isRecurringPayment,
                salesperson_id: salespersonId,
                plan_id: planId,
                duration_type: durationType,
                amount: parseFloat(amount || 0),
                data_source: previousSubscription ? 'previous_subscription' : 'webhook_data'
            }
        });

        // *** NEW: Update TrialPaymentLink status to 'paid' ***
        const updatedTrialPaymentLink = await updateTrialPaymentLinkStatus(
            page_request_uid || transaction_uid,
            'paid',
            transaction_uid,
            studentId,
            transaction
        );

        // Step 1: Handle trial class registration conversion or direct payment user creation
        let trialClassRegistration = null;
        let userDetails = null;
        let previousTrialStatus = null;

        if (trialClassId && !isNaN(trialClassId) && trialClassId > 0 && additionalData.payment_type !== 'existing_user') {
            trialClassRegistration = await TrialClassRegistration.findByPk(trialClassId, {
                transaction,
                attributes: [
                    'id', 'student_name', 'parent_name', 'email', 'mobile', 'country_code',
                    'age', 'language', 'status', 'trial_class_status', 'teacher_id', 'booked_by'
                ]
            });

            if (trialClassRegistration) {
                // CRITICAL FIX: If webhook email is formatted (has +) and differs from trial class email,
                // update the trial class email to match the webhook email
                // This handles cases where the trial class email wasn't updated during link generation
                const webhookEmail = customer_email ? customer_email.trim().toLowerCase() : null;
                const trialClassEmail = trialClassRegistration.email ? trialClassRegistration.email.trim().toLowerCase() : null;
                
                if (webhookEmail && webhookEmail.includes('+') && webhookEmail !== trialClassEmail) {
                    console.log(`⚠️ Email mismatch detected! Trial class email: ${trialClassEmail}, Webhook email: ${webhookEmail}`);
                    console.log(`📧 Updating trial class email to match webhook email (formatted child email)`);
                    
                    try {
                        await trialClassRegistration.update({
                            email: webhookEmail // Use webhook email (with hyphens) - will be converted to spaces later
                        }, { transaction });
                        
                        console.log(`✅ Updated trial class ${trialClassId} email from ${trialClassEmail} to ${webhookEmail}`);
                    } catch (emailUpdateError) {
                        console.error('Warning: Error updating trial class email from webhook:', emailUpdateError);
                        // Continue processing - the email conversion logic will handle it
                    }
                }
                
                paymentLogger.logPaymentVerification({
                    student_id: trialClassId,
                    student_name: trialClassRegistration.student_name,
                    subscription_id: null,
                    verification_type: 'trial_class_found',
                    verification_result: true,
                    subscription_details: {
                        trial_class_id: trialClassId,
                        student_name: trialClassRegistration.student_name,
                        student_email: trialClassRegistration.email,
                        webhook_email: webhookEmail,
                        email_updated: webhookEmail && webhookEmail.includes('+') && webhookEmail !== trialClassEmail,
                        current_status: trialClassRegistration.trial_class_status
                    }
                });
                
                // Store previous status for logging
                previousTrialStatus = trialClassRegistration.trial_class_status;

                if(trialClassRegistration.email){
                  // Check if this will create a new user
                  const existingUser = await User.findOne({
                      where: { email: trialClassRegistration.email.trim().toLowerCase() },
                      transaction
                  });
  
                  if (!existingUser) {
                      isNewUser = true;
                  }
                }

                // Convert trial class to user account (pass additionalData for guardian_id)
                console.log(`🔄 Converting trial class ${trialClassId} to user account...`);
                studentId = await convertTrialClassToUser(trialClassRegistration, transaction_uid, transaction, additionalData);
                console.log(`✅ Trial class ${trialClassId} converted to user account. New userId: ${studentId}`);

                // Validate that we got a valid userId
                if (!studentId || isNaN(studentId) || studentId <= 0) {
                    const errorMessage = `convertTrialClassToUser returned invalid userId: ${studentId} for trial class ${trialClassId}`;
                    paymentLogger.logPaymentVerification({
                        student_id: trialClassId,
                        student_name: trialClassRegistration.student_name,
                        subscription_id: null,
                        verification_type: 'trial_conversion_userid_validation_failed',
                        verification_result: false,
                        error_details: {
                            error_type: 'userid_validation_error',
                            error_message: errorMessage,
                            trial_class_id: trialClassId,
                            returned_user_id: studentId
                        }
                    });
                    throw new Error(errorMessage);
                }

                // *** NEW: Update trial class status to 'new_enroll' and log status change ***
                const newTrialStatus = 'new_enroll';
                
                await trialClassRegistration.update({
                    trial_class_status: newTrialStatus,
                    status_change_notes: `Payment completed successfully. Transaction: ${transaction_uid}. Amount: ${amount} ${currency_code}. User ID: ${studentId}. TrialPaymentLink ID: ${updatedTrialPaymentLink?.id || 'N/A'}. Timestamp: ${new Date().toISOString()}`
                }, { transaction });

                // Log the status change
                await logTrialClassStatusChange(
                    trialClassId,
                    previousTrialStatus,
                    newTrialStatus,
                    salespersonId || 1,
                    'system',
                    `Payment completed successfully. Transaction: ${transaction_uid}. Amount: ${amount} ${currency_code}. User created: ${studentId}`,
                    transaction
                );

                // Log trial class status change with payment logger
                paymentLogger.logTrialClassStatusChange({
                    trial_class_id: trialClassId,
                    student_id: studentId,
                    previous_status: previousTrialStatus,
                    new_status: newTrialStatus,
                    changed_by: 'system',
                    payment_context: {
                        transaction_uid: transaction_uid,
                        amount: amount,
                        currency: currency_code,
                        payment_successful: true
                    },
                    trial_payment_link_id: updatedTrialPaymentLink?.id
                });
            } else {
                paymentLogger.logPaymentVerification({
                    student_id: trialClassId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'trial_class_lookup',
                    verification_result: false,
                    error_details: {
                        message: 'Trial class registration not found',
                        trial_class_id: trialClassId
                    }
                });
            }
        }

        // If we don't have a student ID yet, try to create/find user from direct payment
        // Try with email first, then fallback to phone number or other data
        if (!studentId) {
            // First, try to find/create user by email if available
            if (customer_email && customer_email !== '') {
            // Validate email format before proceeding
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(customer_email)) {
                const errorMessage = `Invalid email format for direct payment: ${customer_email}`;
                paymentLogger.logPaymentVerification({
                    student_id: 'direct_payment',
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'direct_payment_email_validation_failed',
                    verification_result: false,
                    error_details: {
                        error_type: 'email_format_validation_error',
                        error_message: errorMessage,
                        customer_email: customer_email,
                        customer_name: customer_name
                    }
                });
                throw new Error(errorMessage);
            }

            // Get direct payment customer data from database
            let directPaymentCustomer = null;
            try {
                directPaymentCustomer = await DirectPaymentCustomer.findOne({
                    where: { email: customer_email },
                    order: [['created_at', 'DESC']],
                    transaction
                });
            } catch (directPaymentLookupError) {
                console.error('Error looking up DirectPaymentCustomer:', directPaymentLookupError);
                // Continue without directPaymentCustomer - we can still create user from webhook data
            }

            // Check if this will create a new user
            const existingUser = await User.findOne({
                where: { email: customer_email.trim().toLowerCase() },
                transaction
            });

            if (!existingUser) {
                isNewUser = true;
            }

            // Prepare enhanced customer data from DirectPaymentCustomer table
            // Include guardian_id from additionalData if available (parent user scenario)
            const customerData = directPaymentCustomer ? {
                customer_first_name: directPaymentCustomer.first_name,
                customer_last_name: directPaymentCustomer.last_name,
                customer_language: directPaymentCustomer.language,
                customer_notes: directPaymentCustomer.notes,
                phone: directPaymentCustomer.phone,
                country_code: directPaymentCustomer.country_code,
                guardian_id: additionalData?.guardian_id || additionalData?.gid || null // Include guardian_id from additionalData
            } : additionalData; // Fallback to decoded additionalData (which already includes guardian_id)
            console.log('customerData for user creation:', customerData);
            

            try {
                studentId = await createUserFromDirectPayment(
                    customer_email, 
                    customer_name, 
                    customerData, 
                    transaction
                );

                // Validate that studentId was returned
                if (!studentId || isNaN(studentId) || studentId <= 0) {
                    throw new Error(`createUserFromDirectPayment returned invalid studentId: ${studentId}`);
                }
            } catch (createUserError) {
                paymentLogger.logPaymentVerification({
                    student_id: 'direct_payment',
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'direct_payment_user_creation_failed',
                    verification_result: false,
                    error_details: {
                        error_type: 'user_creation_exception',
                        error_message: createUserError.message,
                        error_stack: createUserError.stack,
                        customer_email: customer_email,
                        customer_name: customer_name,
                        has_additional_data: !!customerData,
                        has_guardian_id: !!(customerData?.guardian_id || customerData?.gid)
                    }
                });
                throw createUserError;
            }

            // Update DirectPaymentCustomer status to paid
            if (directPaymentCustomer) {
                await directPaymentCustomer.update({
                    payment_status: 'paid',
                    payment_date: new Date(),
                    transaction_id: transaction_uid
                }, { transaction });

                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'direct_payment_customer_updated',
                    verification_result: true,
                    subscription_details: {
                        direct_payment_customer_id: directPaymentCustomer.id,
                        payment_status_updated: true,
                        user_created: true,
                        user_id: studentId
                    }
                });
            }
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: customer_name || 'unknown',
                subscription_id: null,
                verification_type: 'direct_payment_user_creation_enhanced',
                verification_result: true,
                subscription_details: {
                    created_from_direct_payment: true,
                    is_new_user: isNewUser,
                    customer_email: customer_email,
                    direct_payment_customer_used: !!directPaymentCustomer,
                    enhanced_data_available: !!customerData
                }
            });
            } else {
                // Fallback: Try to find/create user by phone number or other identifiers
                // Look for DirectPaymentCustomer by phone number or page_request_uid
                let directPaymentCustomer = null;
                const pageRequestUid = webhookData.page_request_uid || webhookData.page_request_uid;
                
                try {
                    // Try to find by page_request_uid first (most reliable)
                    if (pageRequestUid) {
                        directPaymentCustomer = await DirectPaymentCustomer.findOne({
                            where: { page_request_uid: pageRequestUid },
                            order: [['created_at', 'DESC']],
                            transaction
                        });
                    }
                    
                    // If not found, try to find by phone number if available (check multiple possible field names)
                    if (!directPaymentCustomer) {
                        const phoneNumber = webhookData.customer_phone 
                            || webhookData.phone 
                            || webhookData.customer?.phone
                            || (webhookData.original_webhook && webhookData.original_webhook.customer?.phone);
                        
                        if (phoneNumber) {
                            directPaymentCustomer = await DirectPaymentCustomer.findOne({
                                where: { phone: phoneNumber },
                                order: [['created_at', 'DESC']],
                                transaction
                            });
                        }
                    }
                } catch (directPaymentLookupError) {
                    console.error('Error looking up DirectPaymentCustomer (fallback):', directPaymentLookupError);
                }

                // If we found a DirectPaymentCustomer, use their email
                if (directPaymentCustomer && directPaymentCustomer.email) {
                    const fallbackEmail = directPaymentCustomer.email;
                    
                    // Validate email format
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (emailRegex.test(fallbackEmail)) {
                        try {
                            // Prepare customer data
                            const customerData = {
                                customer_first_name: directPaymentCustomer.first_name,
                                customer_last_name: directPaymentCustomer.last_name,
                                customer_language: directPaymentCustomer.language,
                                customer_notes: directPaymentCustomer.notes,
                                phone: directPaymentCustomer.phone,
                                country_code: directPaymentCustomer.country_code,
                                guardian_id: additionalData?.guardian_id || additionalData?.gid || null
                            };

                            studentId = await createUserFromDirectPayment(
                                fallbackEmail,
                                customer_name || `${directPaymentCustomer.first_name} ${directPaymentCustomer.last_name}`.trim(),
                                customerData,
                                transaction
                            );

                            // Validate that studentId was returned
                            if (!studentId || isNaN(studentId) || studentId <= 0) {
                                throw new Error(`createUserFromDirectPayment returned invalid studentId: ${studentId}`);
                            }

                            // Update DirectPaymentCustomer status
                            await directPaymentCustomer.update({
                                payment_status: 'paid',
                                payment_date: new Date(),
                                transaction_id: transaction_uid
                            }, { transaction });

                            paymentLogger.logPaymentVerification({
                                student_id: studentId,
                                student_name: customer_name || 'unknown',
                                subscription_id: null,
                                verification_type: 'direct_payment_user_creation_fallback_email',
                                verification_result: true,
                                subscription_details: {
                                    created_from_direct_payment: true,
                                    used_fallback_email: true,
                                    customer_email: fallbackEmail,
                                    direct_payment_customer_id: directPaymentCustomer.id
                                }
                            });
                        } catch (fallbackError) {
                            paymentLogger.logPaymentVerification({
                                student_id: 'direct_payment',
                                student_name: customer_name || 'unknown',
                                subscription_id: null,
                                verification_type: 'direct_payment_fallback_failed',
                                verification_result: false,
                                error_details: {
                                    error_type: 'fallback_user_creation_error',
                                    error_message: fallbackError.message,
                                    error_stack: fallbackError.stack,
                                    fallback_email: fallbackEmail
                                }
                            });
                            // Don't throw here - we'll try one more fallback
                        }
                    }
                }

                // Last resort: Create user with generated email if we have customer name
                if (!studentId && customer_name && customer_name.trim() !== '') {
                    try {
                        // Generate a temporary email based on customer name and transaction
                        const sanitizedName = customer_name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                        const generatedEmail = `payplus_${sanitizedName}_${transaction_uid.substring(0, 8)}@tulkka.temp`;
                        
                        const customerData = {
                            customer_first_name: customer_name.split(' ')[0] || customer_name,
                            customer_last_name: customer_name.split(' ').slice(1).join(' ') || '',
                            customer_language: additionalData?.customer_language || 'HE',
                            guardian_id: additionalData?.guardian_id || additionalData?.gid || null
                        };

                        studentId = await createUserFromDirectPayment(
                            generatedEmail,
                            customer_name,
                            customerData,
                            transaction
                        );

                        // Validate that studentId was returned
                        if (!studentId || isNaN(studentId) || studentId <= 0) {
                            throw new Error(`createUserFromDirectPayment returned invalid studentId: ${studentId}`);
                        }

                        paymentLogger.logPaymentVerification({
                            student_id: studentId,
                            student_name: customer_name,
                            subscription_id: null,
                            verification_type: 'direct_payment_user_creation_generated_email',
                            verification_result: true,
                            subscription_details: {
                                created_from_direct_payment: true,
                                used_generated_email: true,
                                generated_email: generatedEmail,
                                customer_name: customer_name
                            }
                        });
                    } catch (generatedEmailError) {
                        paymentLogger.logPaymentVerification({
                            student_id: 'direct_payment',
                            student_name: customer_name || 'unknown',
                            subscription_id: null,
                            verification_type: 'direct_payment_generated_email_failed',
                            verification_result: false,
                            error_details: {
                                error_type: 'generated_email_user_creation_error',
                                error_message: generatedEmailError.message,
                                error_stack: generatedEmailError.stack,
                                customer_name: customer_name
                            }
                        });
                        // This will be caught by the final validation below
                    }
                }
            }
        }

        // Final validation that we have a valid student ID
        if (!studentId || isNaN(studentId) || studentId <= 0) {
            const errorMessage = `Unable to determine or create valid student ID. Current value: ${studentId}`;
            
            // Enhanced error logging with all available data
            const errorDetails = {
                message: errorMessage,
                provided_student_id: studentId,
                more_info_1: more_info_1,
                trial_class_id: trialClassId,
                customer_email: customer_email || 'NOT_PROVIDED',
                customer_name: customer_name || 'NOT_PROVIDED',
                page_request_uid: webhookData.page_request_uid || 'NOT_PROVIDED',
                transaction_uid: transaction_uid || 'NOT_PROVIDED',
                has_additional_data: !!additionalData && Object.keys(additionalData).length > 0,
                additional_data_keys: additionalData ? Object.keys(additionalData) : [],
                payment_type: additionalData?.payment_type || 'unknown',
                has_guardian_id: !!(additionalData?.guardian_id || additionalData?.gid),
                webhook_data_keys: webhookData ? Object.keys(webhookData) : []
            };
            
            paymentLogger.logPaymentVerification({
                student_id: studentId || 'invalid',
                student_name: customer_name || 'unknown',
                subscription_id: null,
                verification_type: 'student_id_validation_failed',
                verification_result: false,
                error_details: errorDetails
            });
            
            // Try one last recovery attempt: create user with minimal data if we have a name
            if (customer_name && customer_name.trim() !== '' && !studentId) {
                try {
                    const defaultPassword = '12345678';
                    const hashedPassword = await securePassword(defaultPassword);
                    
                    // Generate email from transaction UID
                    const recoveryEmail = `recovery_${transaction_uid.substring(0, 12)}@tulkka.temp`;
                    
                    const recoveryUserData = {
                        full_name: customer_name,
                        email: recoveryEmail,
                        password: hashedPassword,
                        language: additionalData?.customer_language || 'HE',
                        country_code: '+972',
                        role_name: 'user',
                        role_id: 1,
                        status: 'active',
                        verified: true,
                        access_content: true,
                        newsletter: false,
                        public_message: false,
                        affiliate: true,
                        can_create_store: false,
                        ban: false,
                        offline: false,
                        trial_expired: false,
                        total_hours: 0,
                        timezone: "Asia/Jerusalem",
                        notification_channels: '["email","whatsapp","inapp"]',
                        lesson_notifications: '["24","1"]',
                        meeting_type: 'online',
                        created_at: Math.floor(Date.now() / 1000),
                        updated_at: Math.floor(Date.now() / 1000)
                    };

                    // Add guardian if available
                    const guardianId = additionalData?.guardian_id || additionalData?.gid;
                    if (guardianId && !isNaN(guardianId) && guardianId > 0) {
                        recoveryUserData.guardian = parseInt(guardianId);
                    }

                    const recoveryUser = await User.create(recoveryUserData, { transaction });
                    studentId = recoveryUser.id;
                    isNewUser = true;

                    paymentLogger.logPaymentVerification({
                        student_id: studentId,
                        student_name: customer_name,
                        subscription_id: null,
                        verification_type: 'recovery_user_created_final_attempt',
                        verification_result: true,
                        subscription_details: {
                            recovery_user_created: true,
                            new_user_id: studentId,
                            recovery_email: recoveryEmail,
                            has_guardian: !!recoveryUserData.guardian
                        }
                    });
                } catch (recoveryError) {
                    paymentLogger.logPaymentVerification({
                        student_id: 'recovery_failed',
                        student_name: customer_name || 'unknown',
                        subscription_id: null,
                        verification_type: 'recovery_user_creation_failed',
                        verification_result: false,
                        error_details: {
                            recovery_error: recoveryError.message,
                            recovery_stack: recoveryError.stack
                        }
                    });
                    
                    throw new Error(`${errorMessage}. Recovery attempt also failed: ${recoveryError.message}`);
                }
            } else {
                throw new Error(errorMessage);
            }
        }

        // Get user details for email sending
        userDetails = await User.findByPk(studentId, {
            attributes: ['id', 'full_name', 'email', 'language', 'password'],
            transaction
        });

        if (!userDetails) {
          // If user not found, try to create/find them again
          paymentLogger.logPaymentVerification({
              student_id: studentId,
              student_name: customer_name || 'unknown',
              subscription_id: null,
              verification_type: 'user_not_found_retry_creation',
              verification_result: false,
              error_details: {
                  message: `User with ID ${studentId} not found, attempting recovery`,
                  student_id: studentId,
                  customer_email: customer_email,
                  customer_name: customer_name
              }
          });

          // Try to find user by email if we have it
          if (customer_email && customer_email !== '') {
              userDetails = await User.findOne({
                  where: { email: customer_email.trim().toLowerCase() },
                  attributes: ['id', 'full_name', 'email', 'language', 'password'],
                  transaction
              });

              if (userDetails) {
                  // Update studentId to the found user ID
                  studentId = userDetails.id;
                  
                  paymentLogger.logPaymentVerification({
                      student_id: studentId,
                      student_name: customer_name || 'unknown',
                      subscription_id: null,
                      verification_type: 'user_found_by_email_recovery',
                      verification_result: true,
                      subscription_details: {
                          recovered_user_id: studentId,
                          user_email: userDetails.email
                      }
                  });
              } else {
                  // User still not found, create new user as last resort
                  try {
                      const defaultPassword = '12345678';
                      const hashedPassword = await securePassword(defaultPassword);

                      const newUserData = {
                          full_name: customer_name || 'PayPlus Customer',
                          email: customer_email.trim().toLowerCase(),
                          password: hashedPassword,
                          role_name: 'user',
                          role_id: 1,
                          status: 'active',
                          verified: true,
                          language: 'EN',
                          access_content: true,
                          newsletter: false,
                          public_message: false,
                          affiliate: true,
                          can_create_store: false,
                          ban: false,
                          offline: false,
                          trial_expired: false,
                          total_hours: 0,
                          timezone: "Asia/Jerusalem",
                          notification_channels: '["email","whatsapp","inapp"]',
                          lesson_notifications: '["24","1"]',
                          meeting_type: 'online',
                          created_at: Math.floor(Date.now() / 1000),
                          updated_at: Math.floor(Date.now() / 1000)
                      };

                      userDetails = await User.create(newUserData, { transaction });
                      studentId = userDetails.id;
                      isNewUser = true;

                      paymentLogger.logPaymentVerification({
                          student_id: studentId,
                          student_name: customer_name || 'unknown',
                          subscription_id: null,
                          verification_type: 'user_created_recovery',
                          verification_result: true,
                          subscription_details: {
                              recovery_user_created: true,
                              new_user_id: studentId,
                              user_email: userDetails.email
                          }
                      });

                  } catch (createError) {
                      paymentLogger.logPaymentVerification({
                          student_id: studentId || 'failed',
                          student_name: customer_name || 'unknown',
                          subscription_id: null,
                          verification_type: 'user_recovery_failed',
                          verification_result: false,
                          error_details: {
                              recovery_error: createError.message,
                              original_student_id: studentId,
                              customer_email: customer_email
                          }
                      });

                      throw new Error(`Failed to recover or create user. Original ID: ${studentId}, Email: ${customer_email}`);
                  }
              }
          } else {
              const errorMessage = `User with ID ${studentId} not found after creation/update and no email provided for recovery`;
              
              paymentLogger.logPaymentVerification({
                  student_id: studentId || 'invalid',
                  student_name: customer_name || 'unknown',
                  subscription_id: null,
                  verification_type: 'user_details_validation',
                  verification_result: false,
                  error_details: {
                      message: errorMessage,
                      student_id: studentId,
                      customer_email: customer_email || 'none'
                  }
              });
              
              throw new Error(errorMessage);
          }
        }

        // Set default password if user doesn't have one or if it's a new user
        let needsPasswordEmail = false;
        if (!userDetails.password || isNewUser) {
            const defaultPassword = '12345678';
            const hashedPassword = await securePassword(defaultPassword);

            await userDetails.update({
                password: hashedPassword
            }, { transaction });

            needsPasswordEmail = true;
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: userDetails.full_name || customer_name,
                subscription_id: null,
                verification_type: 'default_password_set',
                verification_result: true,
                subscription_details: {
                    user_id: studentId,
                    password_updated: true,
                    is_new_user: isNewUser
                }
            });
        }

        // *** MOVED EARLIER: Create or update payment transaction record ***
        let paymentTransaction = null;

        // Check for existing transaction
        paymentTransaction = await PaymentTransaction.findOne({
            where: {
                [Op.or]: [
                    { transaction_id: transaction_uid },
                    { token: transaction_uid }
                ]
            },
            transaction
        });

        if (paymentTransaction && paymentTransaction.status === 'success') {
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: userDetails.full_name || customer_name,
                subscription_id: null,
                verification_type: 'duplicate_transaction_check',
                verification_result: false,
                error_details: {
                    message: 'Transaction already processed successfully',
                    transaction_uid: transaction_uid,
                    existing_transaction_id: paymentTransaction.id
                }
            });
            
            return; // Already processed
        }

        // Use proper field names matching PaymentTransaction model
        const transactionData = {
            status: 'success',
            student_id: studentId,
            student_email: customer_email || userDetails.email || 'unknown@example.com',
            student_name: customer_name || userDetails.full_name || 'Unknown Customer',
            amount: amount ? parseFloat(amount) : 0,
            currency: currency_code || 'ILS',
            payment_method: payment_method || 'unknown',
            card_last_digits: four_digits ? four_digits.slice(-4) : null,
            lessons_per_month: lessonsPerMonth,
            lesson_minutes: lessonMinutes,
            custom_months: customMonths,
            is_recurring: isRecurringPayment,
            generated_by: salespersonId || null,
            payment_processor: 'payplus',
            response_data: JSON.stringify(webhookData.original_webhook),
            trial_payment_link_id: updatedTrialPaymentLink?.id || null,
            data_source: previousSubscription ? 'previous_subscription' : 'webhook_data'
        };

        if (paymentTransaction) {
            // Update existing transaction
            await paymentTransaction.update(transactionData, { transaction });
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: userDetails.full_name || customer_name,
                subscription_id: null,
                verification_type: 'payment_transaction_updated',
                verification_result: true,
                subscription_details: {
                    transaction_id: paymentTransaction.id,
                    transaction_uid: transaction_uid,
                    amount: transactionData.amount,
                    action: 'updated'
                }
            });
        } else {
            // Create new transaction record
            paymentTransaction = await PaymentTransaction.create({
                token: transaction_uid,
                transaction_id: transaction_uid,
                ...transactionData
            }, { transaction });
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: userDetails.full_name || customer_name,
                subscription_id: null,
                verification_type: 'payment_transaction_created',
                verification_result: true,
                subscription_details: {
                    transaction_id: paymentTransaction.id,
                    transaction_uid: transaction_uid,
                    amount: transactionData.amount,
                    action: 'created'
                }
            });
        }

        // Update webhook log with linked transaction
        if (webhookLogId && paymentTransaction) {
            await PayPlusWebhookLog.update(
                {
                    linked_payment_transaction_id: paymentTransaction.id
                },
                { where: { id: webhookLogId }, transaction }
            );
        }

        // Step 2: Create or update subscription WITH USER TABLE UPDATES
        // IMPORTANT: For trial class payments, we MUST always create a subscription
        if (studentId && studentId > 0) {
            console.log(`📋 Creating subscription for studentId: ${studentId}, trialClassId: ${trialClassId}, isTrialClass: ${!!trialClassRegistration}`);
            
            const userExists = await User.findByPk(studentId, {
                attributes: ['id', 'email', 'full_name'],
                transaction
            });

            if (!userExists) {
                const errorMessage = `User with ID ${studentId} does not exist in users table`;
                
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'user_existence_check',
                    verification_result: false,
                    error_details: {
                        message: errorMessage,
                        student_id: studentId,
                        trial_class_id: trialClassId
                    }
                });
                
                throw new Error(errorMessage);
            }

            // For trial class payments, ensure we always create a subscription
            // Log subscription creation attempt
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: customer_name || userExists.full_name || 'unknown',
                subscription_id: null,
                verification_type: 'subscription_creation_attempt',
                verification_result: true,
                subscription_details: {
                    student_id: studentId,
                    trial_class_id: trialClassId,
                    is_trial_class_payment: !!trialClassRegistration,
                    lesson_minutes: lessonMinutes,
                    lessons_per_month: lessonsPerMonth,
                    custom_months: customMonths,
                    amount: parseFloat(amount || 0),
                    is_recurring: isRecurringPayment
                }
            });

            // Create or update subscription
            const subscriptionResult = await createOrUpdateSubscription(
                studentId,
                lessonsPerMonth,
                lessonMinutes,
                customMonths,
                parseFloat(amount || 0),
                isRecurringPayment,
                previousSubscription, // Pass previous subscription for reference
                transaction
            );
            
            console.log(`✅ Subscription created/updated for studentId: ${studentId}, subscriptionId: ${subscriptionResult?.subscription_id}`);

            // Log subscription creation/update
            paymentLogger.logSubscriptionChange({
                user_id: studentId,
                subscription_id: subscriptionResult.subscription_id,
                change_type: subscriptionResult.is_new_subscription ? 'created' : 'updated',
                previous_status: previousSubscription?.status || 'none',
                new_status: 'active',
                triggered_by: 'webhook_payment',
                payment_transaction_id: paymentTransaction.id,
                additional_details: {
                    subscription_type: subscriptionResult.subscription_type,
                    lessons_added: subscriptionResult.lessons_added,
                    lesson_minutes: subscriptionResult.lesson_minutes,
                    lessons_per_month: subscriptionResult.lessons_per_month,
                    data_source: subscriptionResult.data_source || 'webhook_data',
                    previous_subscription_used: subscriptionResult.previous_subscription_used
                }
            });
            // --- LINK PAYMENT TRANSACTION TO THE CREATED/UPDATED SUBSCRIPTION ---
            // subscriptionResult.subscription_id should contain the subscription DB id
            if (subscriptionResult && subscriptionResult.subscription_id) {
              try {
                await UserSubscriptionDetails.update(
                  { payment_id: paymentTransaction.id },
                  { where: { id: subscriptionResult.subscription_id }, transaction }
                );

                paymentLogger.logPaymentVerification({
                  student_id: studentId,
                  student_name: userDetails?.full_name || customer_name || 'unknown',
                  subscription_id: subscriptionResult.subscription_id,
                  verification_type: 'link_payment_to_subscription',
                  verification_result: true,
                  subscription_details: {
                    payment_transaction_id: paymentTransaction.id,
                    action: 'payment_id_set_on_subscription'
                  }
                });
              } catch (linkErr) {
                paymentLogger.logPaymentVerification({
                  student_id: studentId,
                  student_name: userDetails?.full_name || customer_name || 'unknown',
                  subscription_id: subscriptionResult.subscription_id,
                  verification_type: 'link_payment_to_subscription_failed',
                  verification_result: false,
                  error_details: {
                    error_message: linkErr.message,
                    stack: linkErr.stack,
                    subscription_id: subscriptionResult.subscription_id,
                    payment_transaction_id: paymentTransaction.id
                  }
                });
                // Re-throw so outer transaction will rollback and error handling kicks in
                throw linkErr;
              }
            }
        }

        // Step 3: Log to recurring payments
        await logRecurringPayment(
            studentId,
            salespersonId,
            parseFloat(amount || 0),
            currency_code,
            transaction_uid,
            recurring_info,
            lessonMinutes,
            lessonsPerMonth,
            customMonths,
            isRecurringPayment,
            webhookData,
            transaction
        );

        // Step 4: Resolve any active past-due records and stop dunning once a new payment succeeds
        await resolvePastDuePayments(
            studentId,
            transaction_uid,
            parseFloat(amount || 0),
            currency_code || 'ILS',
            transaction
        );

        // Step 5: Send welcome email with credentials
        if (needsPasswordEmail && userDetails && userDetails.email) {
            try {
                const welcomeTemplate = 'student_welcome';

                const emailParams = {
                    user_name: userDetails.full_name || customer_name || 'New Student',
                    email: userDetails.email,
                    password: '12345678',
                    login_url: process.env.FRONTEND_URL || 'https://app.tulkka.com/login',
                    platform_name: 'Tulkka',
                    support_email: process.env.SUPPORT_EMAIL || 'support@tulkka.com'
                };

                const emailResult = await sendCombinedNotifications(
                    welcomeTemplate,
                    emailParams,
                    {
                        email: userDetails.email,
                        full_name: userDetails.full_name,
                        language: userDetails.language || 'EN'
                    },
                    false
                );

                if (emailResult.emailSent) {
                    paymentLogger.logPaymentVerification({
                        student_id: studentId,
                        student_name: userDetails.full_name || customer_name,
                        subscription_id: null,
                        verification_type: 'welcome_email_sent',
                        verification_result: true,
                        subscription_details: {
                            email_address: userDetails.email,
                            template_used: welcomeTemplate
                        }
                    });
                } else {
                    paymentLogger.logPaymentVerification({
                        student_id: studentId,
                        student_name: userDetails.full_name || customer_name,
                        subscription_id: null,
                        verification_type: 'welcome_email_failed',
                        verification_result: false,
                        error_details: {
                            email_address: userDetails.email,
                            template_used: welcomeTemplate
                        }
                    });
                }

            } catch (emailError) {
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: userDetails.full_name || customer_name,
                    subscription_id: null,
                    verification_type: 'welcome_email_error',
                    verification_result: false,
                    error_details: {
                        error_type: 'email_send_error',
                        error_message: emailError.message,
                        email_address: userDetails.email
                    }
                });
            }
        }

        // Final verification logging
        paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: userDetails.full_name || customer_name,
            subscription_id: paymentTransaction?.id,
            verification_type: 'payment_processing_complete',
            verification_result: true,
            subscription_details: {
                user_created_or_updated: true,
                subscription_created: true,
                payment_transaction_created: true,
                trial_status_updated: !!trialClassRegistration,
                welcome_email_sent: needsPasswordEmail
            },
            payment_history: {
                transaction_uid: transaction_uid,
                amount: parseFloat(amount || 0),
                currency: currency_code,
                payment_method: payment_method,
                is_recurring: isRecurringPayment,
                payment_transaction_id: paymentTransaction?.id
            }
        });

        // Log summary of actions taken
        paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: userDetails.full_name || customer_name,
            subscription_id: paymentTransaction?.id,
            verification_type: 'payment_processing_summary',
            verification_result: true,
            subscription_details: {
                transaction_id: transaction_uid,
                student_id: studentId,
                trial_class_id: trialClassId,
                is_new_user: isNewUser,
                email_sent: needsPasswordEmail,
                subscription_created: true,
                user_table_updated: true,
                trial_status_updated: !!trialClassRegistration,
                trial_payment_link_updated: !!updatedTrialPaymentLink,
                previous_trial_status: previousTrialStatus,
                new_trial_status: trialClassRegistration ? 'new_enroll' : null,
                amount: parseFloat(amount || 0),
                currency: currency_code,
                data_source: previousSubscription ? 'previous_subscription' : 'webhook_data',
                lesson_minutes: lessonMinutes,
                lessons_per_month: lessonsPerMonth,
                previous_subscription_found: !!previousSubscription,
                payment_transaction_id: paymentTransaction?.id
            }
        });

    } catch (error) {
        // Log processing error
        paymentLogger.logPaymentVerification({
            student_id: webhookData.more_info_1 || 'unknown',
            student_name: webhookData.customer_name || 'unknown',
            subscription_id: null,
            verification_type: 'payment_processing_error',
            verification_result: false,
            error_details: {
                error_type: 'processing_exception',
                error_message: error.message,
                error_stack: error.stack,
                transaction_uid: webhookData.transaction_uid,
                webhook_data_available: !!webhookData
            }
        });
        
        throw error;
    }
};

/**
 * Update TrialPaymentLink status and log trial class status change
 * @param {String} pageRequestUid - Page request UID or transaction UID
 * @param {String} status - Payment status ('paid', 'failed', 'expired')
 * @param {String} paymentReference - Payment reference from processor
 * @param {Number} studentId - Student ID (trial class registration)
 * @param {Object} transaction - Database transaction
 */
const updateTrialPaymentLinkStatus = async (pageRequestUid, status, paymentReference, studentId, transaction) => {
    try {
        if (!pageRequestUid) {
            paymentLogger.logPaymentVerification({
                student_id: studentId || 'unknown',
                student_name: 'unknown',
                subscription_id: null,
                verification_type: 'trial_payment_link_update_skipped',
                verification_result: false,
                error_details: {
                    message: 'No page request UID provided',
                    student_id: studentId,
                    status_to_update: status
                }
            });
            return null;
        }

        // Find TrialPaymentLink by link_token (which should be the page_request_uid)
        let trialPaymentLink = await TrialPaymentLink.findOne({
            where: { link_token: pageRequestUid },
            transaction
        });

        // If not found by link_token, try to find by trial_class_id (studentId)
        if (!trialPaymentLink && studentId) {
            trialPaymentLink = await TrialPaymentLink.findOne({
                where: { 
                    trial_class_id: studentId,
                    payment_status: 'pending'
                },
                order: [['created_at', 'DESC']], // Get the most recent pending link
                transaction
            });
        }

        if (trialPaymentLink) {
            const updateData = {
                payment_status: status,
                payment_reference: paymentReference
            };

            if (status === 'paid') {
                updateData.payment_date = new Date();
            }

            await trialPaymentLink.update(updateData, { transaction });
            
            // Log the trial payment link status update
            paymentLogger.logPaymentVerification({
                student_id: studentId || 'unknown',
                student_name: 'unknown',
                subscription_id: null,
                verification_type: 'trial_payment_link_update',
                verification_result: true,
                subscription_details: {
                    trial_payment_link_id: trialPaymentLink.id,
                    payment_status: status,
                    payment_reference: paymentReference,
                    page_request_uid: pageRequestUid
                }
            });

            return trialPaymentLink;
        } else {
            // Log the failure to find trial payment link
            paymentLogger.logPaymentVerification({
                student_id: studentId || 'unknown',
                student_name: 'unknown',
                subscription_id: null,
                verification_type: 'trial_payment_link_lookup',
                verification_result: false,
                error_details: {
                    message: 'TrialPaymentLink not found',
                    page_request_uid: pageRequestUid,
                    student_id: studentId,
                    status_to_update: status
                }
            });

            return null;
        }
    } catch (error) {
        // Log the error
        paymentLogger.logPaymentVerification({
            student_id: studentId || 'unknown',
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'trial_payment_link_update_error',
            verification_result: false,
            error_details: {
                error_type: 'update_error',
                error_message: error.message,
                error_stack: error.stack,
                page_request_uid: pageRequestUid,
                student_id: studentId,
                status_to_update: status
            }
        });

        // Don't throw error here - this shouldn't break main payment processing
        return null;
    }
};

/**
 * Convert trial class registration to user account
 * @param {Object} trialClassRegistration - Trial class registration object
 * @param {String} transactionUid - Transaction ID for reference
 * @param {Object} transaction - Database transaction
 * @returns {Number} - Created/updated user ID
 */
const convertTrialClassToUser = async (trialClassRegistration, transactionUid, transaction, additionalData = {}) => {
  try {
    const trialClassId = trialClassRegistration.id;
    // Convert email: replace hyphens with spaces in the student name part (after +)
    // Payment link uses hyphens (e.g., sirig+Rupesh-Patra@mailinator.com)
    // Database should use spaces (e.g., sirig+Rupesh Patra@mailinator.com)
    // IMPORTANT: The trial class email might have been updated in the payment controller with formatted email (hyphens)
    // We need to convert it to database format (spaces) for lookup and storage
    let email = trialClassRegistration.email ? trialClassRegistration.email.trim().toLowerCase() : null;
    
    console.log(`🔍 Trial class original email: ${trialClassRegistration.email}`);
    
    if (email && email.includes('+')) {
        const emailParts = email.split('@');
        if (emailParts.length === 2) {
            const [localPart, domain] = emailParts;
            const [baseEmail, studentNamePart] = localPart.split('+');
            
            if (studentNamePart) {
                // Replace hyphens with spaces in the student name part
                const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                email = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                console.log(`📧 Converting trial class email from payment link format to database format: ${trialClassRegistration.email} → ${email}`);
            }
        }
    }
    
    console.log(`✅ Final email for user lookup/creation: ${email}`);

    // Log trial class conversion start
    paymentLogger.logPaymentVerification({
        student_id: trialClassId,
        student_name: trialClassRegistration.student_name,
        subscription_id: null,
        verification_type: 'trial_to_user_conversion_start',
        verification_result: true,
        subscription_details: {
            trial_class_id: trialClassId,
            student_email: email,
            transaction_uid: transactionUid,
            conversion_initiated: true
        }
    });

    // IMPROVED USER IDENTIFICATION LOGIC WITH PRIORITY-BASED MATCHING
    let userId;
    const defaultPassword = '12345678';
    const hashedPassword = await securePassword(defaultPassword);

    // STEP 1: Check if user ID matches trial class ID (perfect match scenario)
    const userMatchingTrialId = await User.findOne({
      where: { id: trialClassId },
      transaction
    });

    // STEP 2: Check if user already exists with this email (case-insensitive, trimmed)
    // CRITICAL: For formatted emails (with +studentname), we must find the EXACT email match
    // We should NEVER match the parent's base email when we have a formatted child email
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const isFormattedEmail = normalizedEmail && normalizedEmail.includes('+');
    
    console.log(`🔍 Looking up user by email: ${normalizedEmail}, isFormattedEmail: ${isFormattedEmail}`);
    
    let existingUserByEmail = null;
    
    if (normalizedEmail) {
      // Use Sequelize.where with LOWER() for case-insensitive exact match
      existingUserByEmail = await User.findOne({
        where: Sequelize.where(
          Sequelize.fn('LOWER', Sequelize.col('email')),
          normalizedEmail
        ),
        transaction
      });
      
      // CRITICAL VALIDATION: For formatted emails, verify the found user has the EXACT same formatted email
      // If we have a formatted email like "hatexazuza+troy morrison@yopmail.com" and we found a user,
      // that user MUST have the exact same formatted email. If it has the base email "hatexazuza@yopmail.com",
      // we should NOT use it - we need to create a NEW user for the child.
      if (existingUserByEmail && isFormattedEmail) {
        const foundEmail = existingUserByEmail.email ? existingUserByEmail.email.trim().toLowerCase() : '';
        if (foundEmail !== normalizedEmail) {
          console.log(`❌ CRITICAL: Found user with DIFFERENT email!`);
          console.log(`   Expected (formatted child email): ${normalizedEmail}`);
          console.log(`   Found (parent/base email): ${foundEmail}`);
          console.log(`   This is a formatted email, so we MUST create a NEW user for the child`);
          console.log(`   Ignoring found user (ID: ${existingUserByEmail.id}) and will create new user`);
          existingUserByEmail = null; // Clear it - we'll create a new user instead
        } else {
          console.log(`✅ Found existing user with EXACT formatted email match: ${foundEmail}`);
        }
      } else if (existingUserByEmail) {
        console.log(`⚠️ Found existing user by email: ID=${existingUserByEmail.id}, Email=${existingUserByEmail.email}, Name=${existingUserByEmail.full_name}`);
      }
    }
    
    if (!existingUserByEmail) {
      console.log(`✅ No existing user found with email: ${normalizedEmail} - will create new user`);
    }

    // STEP 3: Check if there's already a user linked to this trial class
    const existingLinkedUser = await User.findOne({
      where: { trial_user_id: trialClassId },
      transaction
    });

    // STEP 4: Log all lookup results for debugging
    paymentLogger.logPaymentVerification({
      student_id: trialClassId,
      student_name: trialClassRegistration.student_name,
      subscription_id: null,
      verification_type: 'user_lookup_results',
      verification_result: true,
      subscription_details: {
        email_searched: email,
        trial_class_id: trialClassId,
        user_matching_trial_id: userMatchingTrialId?.id || null,
        user_matching_trial_email: userMatchingTrialId?.email || null,
        user_by_email: existingUserByEmail?.id || null,
        user_by_email_name: existingUserByEmail?.full_name || null,
        user_already_linked: existingLinkedUser?.id || null,
        user_already_linked_email: existingLinkedUser?.email || null
      }
    });

    // DECISION LOGIC WITH CLEAR PRIORITY
    if (userMatchingTrialId && userMatchingTrialId.email === email) {
      // ✅ PRIORITY 1: User ID matches trial ID AND email matches (PERFECT MATCH)
      userId = userMatchingTrialId.id;

      // Update password and ensure active status
      const updateData = {
        status: 'active',
        verified: true,
        updated_at: Math.floor(Date.now() / 1000)
      };

      if (!userMatchingTrialId.password) {
        updateData.password = hashedPassword;
      }

      // Ensure trial_user_id is set (in case it wasn't)
      if (!userMatchingTrialId.trial_user_id || userMatchingTrialId.trial_user_id !== trialClassId) {
        updateData.trial_user_id = trialClassId;
      }

      await userMatchingTrialId.update(updateData, { transaction });

      // Log perfect match found
      paymentLogger.logPaymentVerification({
        student_id: trialClassId,
        student_name: trialClassRegistration.student_name,
        subscription_id: null,
        verification_type: 'perfect_match_user_trial_id',
        verification_result: true,
        subscription_details: {
          user_id: userId,
          user_email: userMatchingTrialId.email,
          match_type: 'id_and_email_perfect',
          password_updated: !userMatchingTrialId.password,
          trial_user_id_set: updateData.trial_user_id ? true : false
        }
      });

    } else if (existingLinkedUser && existingLinkedUser.id !== existingUserByEmail?.id) {
      // ⚠️ PRIORITY 2: User already linked to this trial (might be data inconsistency)
      userId = existingLinkedUser.id;

      // Update password if not set
      if (!existingLinkedUser.password) {
        await existingLinkedUser.update({ 
          password: hashedPassword,
          status: 'active',
          verified: true,
          updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });
      }

      // Log existing linked user found
      paymentLogger.logPaymentVerification({
        student_id: trialClassId,
        student_name: trialClassRegistration.student_name,
        subscription_id: null,
        verification_type: 'existing_linked_user_found',
        verification_result: true,
        subscription_details: {
          user_id: userId,
          user_email: existingLinkedUser.email,
          password_updated: !existingLinkedUser.password,
          already_linked: true,
          warning: 'User already linked but email does not match search email',
          email_searched: email,
          linked_user_email: existingLinkedUser.email,
          potential_data_issue: existingLinkedUser.email !== email
        }
      });

    } else if (existingUserByEmail) {
      // ✅ PRIORITY 3: User exists with this email (link trial to them)
      // IMPORTANT: For formatted emails (parent/child scenario), we should only use existing user
      // if it's the EXACT match. If it's a formatted email and we found a user, verify it's correct.
      if (isFormattedEmail) {
        // Double-check: For formatted emails, the found user MUST have the exact same formatted email
        if (existingUserByEmail.email.toLowerCase() !== normalizedEmail) {
          console.log(`⚠️ WARNING: Found user with different email! Found: ${existingUserByEmail.email}, Expected: ${normalizedEmail}`);
          console.log(`⚠️ This is a formatted email, so we should create a NEW user instead of using existing one`);
          // Don't use existing user - fall through to create new user
          existingUserByEmail = null; // Clear it so we create a new user
        } else {
          console.log(`✅ Found existing user with exact formatted email match: ${existingUserByEmail.email}`);
        }
      }
      
      // Only use existing user if it's still valid (not cleared above)
      if (existingUserByEmail) {
        userId = existingUserByEmail.id;

        const updateData = {
          trial_user_id: trialClassId,
          full_name: existingUserByEmail.full_name || trialClassRegistration.student_name,
          mobile: existingUserByEmail.mobile || trialClassRegistration.mobile,
          country_code: existingUserByEmail.country_code || trialClassRegistration.country_code,
          language: existingUserByEmail.language || trialClassRegistration.language || 'EN',
          status: 'active',
          verified: true,
          updated_at: Math.floor(Date.now() / 1000)
        };

        // Set password if not already set
        if (!existingUserByEmail.password) {
          updateData.password = hashedPassword;
        }

        await existingUserByEmail.update(updateData, { transaction });

        // Log existing user updated
        paymentLogger.logPaymentVerification({
            student_id: trialClassId,
            student_name: trialClassRegistration.student_name,
            subscription_id: null,
            verification_type: 'existing_user_updated',
            verification_result: true,
            subscription_details: {
                user_id: userId,
                user_email: existingUserByEmail.email,
                trial_class_linked: true,
                password_set: !existingUserByEmail.password,
                fields_updated: Object.keys(updateData),
                is_formatted_email: isFormattedEmail
            }
        });
      }
    }
    
    // Create new user if we don't have a userId yet (either no existing user found, or existing user was invalid for formatted email)
    if (!userId) {
      console.log(`🆕 Creating NEW user for trial class ${trialClassId} with email: ${normalizedEmail}`);
      
      // Create new user from trial class registration
      // Get guardian_id from additionalData if available (passed from payment controller)
      const guardianId = additionalData?.guardian_id ? parseInt(additionalData.guardian_id) : null;

      // Base mobile from trial class (strip any +child suffix)
      let trialMobile = trialClassRegistration.mobile || null;
      let basePhone = null;

      if (trialMobile && typeof trialMobile === 'string') {
        if (trialMobile.includes('+')) {
          const phoneParts = trialMobile.split('+');
          if (phoneParts.length >= 2) {
            basePhone = phoneParts[0];
            console.log(`📱 Normalizing trial class phone for new user: ${trialClassRegistration.mobile} → ${basePhone}`);
          } else {
            basePhone = trialMobile;
          }
        } else {
          basePhone = trialMobile;
        }
      }

      // If we have a guardian (parent), prefer using their base mobile
      if (guardianId && !isNaN(guardianId) && guardianId > 0) {
        const guardianUser = await User.findByPk(guardianId, { transaction });
        if (guardianUser && guardianUser.mobile && typeof guardianUser.mobile === 'string') {
          let guardianBase = guardianUser.mobile;
          if (guardianBase.includes('+')) {
            guardianBase = guardianBase.split('+')[0];
          }
          if (guardianBase) {
            console.log(`👨‍👧 Using guardian ${guardianId} mobile as base for child: ${guardianUser.mobile} → ${guardianBase}`);
            basePhone = guardianBase;
          }
        }
      }

      // Build child-specific mobile like 96325896+devchild2 using basePhone and student alias
      let childMobile = null;
      if (basePhone) {
        const rawStudentName = trialClassRegistration.student_name || `child${trialClassId}`;
        let childAlias = rawStudentName.trim().replace(/[^a-zA-Z0-9]/g, '');
        if (!childAlias) {
          childAlias = `child${trialClassId}`;
        }

        childMobile = `${basePhone}+${childAlias}`;

        // Ensure we don't exceed users.mobile limit (VARCHAR(32))
        if (childMobile.length > 32) {
          const maxAliasLength = 32 - (basePhone.length + 1); // +1 for '+'
          let truncatedAlias = maxAliasLength > 0 ? childAlias.substring(0, maxAliasLength) : '';
          childMobile = truncatedAlias ? `${basePhone}+${truncatedAlias}` : basePhone.substring(0, 32);
          console.log(`📱 Truncating child mobile to 32 chars for users.mobile: ${rawStudentName} → ${childMobile}`);
        }

        console.log(`📱 Final child mobile for new user: ${childMobile}`);
      }

      // Fallback to normalized trialMobile if we couldn't build a childMobile
      if (!childMobile && basePhone) {
        childMobile = basePhone.length > 32 ? basePhone.substring(0, 32) : basePhone;
      }
      
      const newUserData = {
        full_name: trialClassRegistration.student_name,
        email: email,
        password: hashedPassword,
        mobile: childMobile || null, // Store parent-based child mobile like 96325896+devchild2
        country_code: trialClassRegistration.country_code,
        role_name: 'user',
        role_id: 1,
        status: 'active',
        verified: true,
        trial_user_id: trialClassId,
        language: trialClassRegistration.language || 'EN',
        access_content: true,
        newsletter: false,
        public_message: false,
        affiliate: true,
        can_create_store: false,
        ban: false,
        offline: false,
        trial_expired: false,
        total_hours: 0,
        timezone:"Asia/Jerusalem",
        notification_channels: '["email","whatsapp","inapp"]',
        lesson_notifications: '["24","1"]',
        meeting_type: 'online',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      };

      // Debug log to see exactly what we're trying to insert
      console.log('🔧 New user data for trial conversion (sanitized):', {
        full_name: newUserData.full_name,
        email: newUserData.email,
        mobile: newUserData.mobile,
        mobile_length: newUserData.mobile ? newUserData.mobile.length : null,
        country_code: newUserData.country_code,
        language: newUserData.language,
        trial_user_id: newUserData.trial_user_id,
        timezone: newUserData.timezone
      });

      // Set guardian field if guardian_id is provided (parent user scenario)
      if (guardianId && !isNaN(guardianId) && guardianId > 0) {
        newUserData.guardian = guardianId;
        console.log(`✅ Setting guardian ${guardianId} for new user from trial class ${trialClassId}`);
        
        // Log guardian assignment
        paymentLogger.logPaymentVerification({
          student_id: trialClassId,
          student_name: trialClassRegistration.student_name,
          subscription_id: null,
          verification_type: 'guardian_assigned',
          verification_result: true,
          subscription_details: {
            guardian_id: guardianId,
            trial_class_id: trialClassId,
            email: email
          }
        });
      }

      const newUser = await User.create(newUserData, { transaction });
      userId = newUser.id;

      // Log new user created
      paymentLogger.logPaymentVerification({
          student_id: trialClassId,
          student_name: trialClassRegistration.student_name,
          subscription_id: null,
          verification_type: 'new_user_created',
          verification_result: true,
          subscription_details: {
              user_id: userId,
              user_email: newUser.email,
              user_created: true,
              default_password_set: true,
              trial_class_linked: true
          }
      });
    }

    // STEP 5: Final validation check
    if (!userId) {
      throw new Error('Failed to determine user ID for payment processing');
    }

    // STEP 6: Verify the selected user is correct
    const selectedUser = await User.findByPk(userId, { transaction });
    if (!selectedUser) {
      throw new Error(`User ${userId} not found after selection`);
    }

    // STEP 7: Log final user selection for audit trail
    paymentLogger.logPaymentVerification({
      student_id: trialClassId,
      student_name: trialClassRegistration.student_name,
      subscription_id: null,
      verification_type: 'final_user_selected',
      verification_result: true,
      subscription_details: {
        selected_user_id: userId,
        selected_user_email: selectedUser.email,
        selected_user_name: selectedUser.full_name,
        trial_class_id: trialClassId,
        email_match: selectedUser.email === email,
        email_searched: email
      }
    });

    // Update trial class status to converted
    const trialUpdateData = {
      status: 'converted',
      trial_class_status: 'new_enroll',
      status_change_notes: `Converted to paid subscription via PayPlus payment. User ID: ${userId}. Transaction: ${transactionUid}. Timestamp: ${new Date().toISOString()}`,
      updated_at: new Date()
    };

    await trialClassRegistration.update(trialUpdateData, { transaction });

    // Log trial class conversion completion
    paymentLogger.logPaymentVerification({
        student_id: trialClassId,
        student_name: trialClassRegistration.student_name,
        subscription_id: null,
        verification_type: 'trial_to_user_conversion_complete',
        verification_result: true,
        subscription_details: {
            user_id: userId,
            trial_class_id: trialClassId,
            conversion_successful: true,
            transaction_uid: transactionUid,
            trial_status_updated: true
        }
    });

    return userId;
  } catch (error) {
    // Log conversion error
    paymentLogger.logPaymentVerification({
        student_id: trialClassRegistration.id,
        student_name: trialClassRegistration.student_name,
        subscription_id: null,
        verification_type: 'trial_to_user_conversion_error',
        verification_result: false,
        error_details: {
            error_type: 'conversion_error',
            error_message: error.message,
            // Include more Sequelize/MySQL context to pinpoint the root cause
            sequelize_errors: error.errors || null,
            db_error: error.original ? {
                message: error.original.message,
                sqlMessage: error.original.sqlMessage,
                sqlState: error.original.sqlState,
                errno: error.original.errno,
                code: error.original.code
            } : null,
            error_stack: error.stack,
            transaction_uid: transactionUid
        }
    });
    
    throw error;
  }
};

/**
 * Log trial class status change
 * @param {Number} trialClassId - Trial class ID
 * @param {String} previousStatus - Previous status
 * @param {String} newStatus - New status
 * @param {Number} changedById - ID of user making change
 * @param {String} changedByType - Type of user making change
 * @param {String} notes - Optional notes
 * @param {Object} transaction - Database transaction
 */
const logTrialClassStatusChange = async (trialClassId, previousStatus, newStatus, changedById, changedByType = 'system', notes = null, transaction) => {
    try {
        if (!trialClassId || !newStatus) {
            // Log the invalid parameters
            paymentLogger.logPaymentVerification({
                student_id: trialClassId || 'unknown',
                student_name: 'unknown',
                subscription_id: null,
                verification_type: 'trial_status_change_validation',
                verification_result: false,
                error_details: {
                    message: 'Missing required parameters for status history logging',
                    trial_class_id: trialClassId,
                    new_status: newStatus,
                    changed_by_id: changedById
                }
            });
            
            return;
        }

        const statusHistoryData = {
            trial_class_id: trialClassId,
            previous_status: previousStatus,
            new_status: newStatus,
            changed_by_id: changedById || 1, // Default to admin
            changed_by_type: changedByType,
            notes: notes
        };

        const statusHistory = await TrialClassStatusHistory.create(statusHistoryData, { transaction });
        
        // Log successful status change
        paymentLogger.logTrialClassStatusChange({
            trial_class_id: trialClassId,
            student_id: trialClassId,
            previous_status: previousStatus,
            new_status: newStatus,
            changed_by: changedByType,
            payment_context: {
                changed_by_id: changedById,
                notes: notes,
                status_history_id: statusHistory.id
            }
        });
        
        return statusHistory;
    } catch (error) {
        // Log the error
        paymentLogger.logPaymentVerification({
            student_id: trialClassId || 'unknown',
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'trial_status_change_error',
            verification_result: false,
            error_details: {
                error_type: 'status_logging_error',
                error_message: error.message,
                error_stack: error.stack,
                trial_class_id: trialClassId,
                previous_status: previousStatus,
                new_status: newStatus
            }
        });

        // Don't throw error here - status logging shouldn't break main flow
    }
};

/**
 * Create user from direct payment
 * @param {String} customerEmail - Customer email
 * @param {String} customerName - Customer name  
 * @param {Object} transaction - Database transaction
 * @returns {Number} - Created/updated user ID
 */
const createUserFromDirectPayment = async (customerEmail, customerName, additionalData, transaction) => {
  try {
    // Validate email input
    if (!customerEmail || typeof customerEmail !== 'string' || customerEmail.trim() === '') {
      const errorMessage = `Invalid customer email provided: ${customerEmail}`;
      paymentLogger.logPaymentVerification({
        student_id: 'direct_payment',
        student_name: customerName || 'unknown',
        subscription_id: null,
        verification_type: 'direct_payment_invalid_email',
        verification_result: false,
        error_details: {
          error_type: 'validation_error',
          error_message: errorMessage,
          customer_email: customerEmail,
          customer_name: customerName
        }
      });
      throw new Error(errorMessage);
    }

    // Convert email: replace hyphens with spaces in the student name part (after +)
    // Payment link uses hyphens (e.g., sirig+Rupesh-Patra@mailinator.com)
    // Database should use spaces (e.g., sirig+Rupesh Patra@mailinator.com)
    let email = customerEmail.trim().toLowerCase();
    
    // Check if email contains + (parent user scenario with formatted email)
    if (email.includes('+')) {
        const emailParts = email.split('@');
        if (emailParts.length === 2) {
            const [localPart, domain] = emailParts;
            const [baseEmail, studentNamePart] = localPart.split('+');
            
            if (studentNamePart) {
                // Replace hyphens with spaces in the student name part
                const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                email = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                console.log(`📧 Converting email from payment link format to database format: ${customerEmail} → ${email}`);
            }
        }
    }

    // Log direct payment processing start
    paymentLogger.logPaymentVerification({
        student_id: 'direct_payment',
        student_name: customerName,
        subscription_id: null,
        verification_type: 'direct_payment_processing_start',
        verification_result: true,
        subscription_details: {
            customer_email: email,
            original_customer_email: customerEmail,
            customer_name: customerName,
            payment_type: 'direct_payment',
            has_additional_data: !!additionalData,
            email_converted: email !== customerEmail.trim().toLowerCase()
        }
    });

    // Check if user already exists
    let existingUser = await User.findOne({
      where: { email: email },
      transaction
    });

    let userId;
    const defaultPassword = '12345678';
    const hashedPassword = await securePassword(defaultPassword);

    // Extract additional data with defaults
    const firstName = additionalData?.customer_first_name || '';
    const lastName = additionalData?.customer_last_name || '';
    const customerLanguage = additionalData?.customer_language || 'EN';
    const customerNotes = additionalData?.customer_notes || '';
    
    // Convert phone: replace hyphens with spaces in the student name part (after +)
    // Payment link uses hyphens (e.g., 795255555+Rupesh-Patra)
    // Database should use spaces (e.g., 795255555+Rupesh Patra)
    let customerPhone = additionalData?.phone || null;
    if (customerPhone && typeof customerPhone === 'string' && customerPhone.includes('+')) {
        // Check if phone contains + (parent user scenario with formatted phone)
        const phoneParts = customerPhone.split('+');
        if (phoneParts.length === 2) {
            const [basePhone, studentNamePart] = phoneParts;
            
            if (studentNamePart) {
                // Replace hyphens with spaces in the student name part
                const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                customerPhone = `${basePhone}+${studentNameWithSpaces}`;
                console.log(`📱 Converting phone from payment link format to database format: ${additionalData?.phone} → ${customerPhone}`);
            }
        }
    }
    
    // Construct full name from first/last name if available, otherwise use provided name
    const fullName = (firstName && lastName) 
        ? `${firstName} ${lastName}`.trim()
        : customerName || 'Direct Payment Customer';

    if (existingUser) {
      userId = existingUser.id;

      // Update existing user with payment information
      const updateData = {
        full_name: existingUser.full_name || fullName,
        language: customerLanguage,
        status: 'active',
        verified: true,
        updated_at: Math.floor(Date.now() / 1000),
        // Add notes if provided
        notes: customerNotes ? (existingUser.notes ? `${existingUser.notes}\n[Direct Payment] ${customerNotes}` : customerNotes) : existingUser.notes
      };

      // Set password if not already set
      if (!existingUser.password) {
        updateData.password = hashedPassword;
      }

      await existingUser.update(updateData, { transaction });

      // Log existing user updated for direct payment
      paymentLogger.logPaymentVerification({
          student_id: userId,
          student_name: customerName,
          subscription_id: null,
          verification_type: 'existing_user_direct_payment_update',
          verification_result: true,
          subscription_details: {
              user_id: userId,
              user_email: email,
              full_name: fullName,
              language: customerLanguage,
              password_set: !existingUser.password,
              status_activated: true,
              payment_type: 'direct_payment',
              notes_updated: !!customerNotes
          }
      });

    } else {
      // Create new user for direct payment
      // Get guardian_id from additionalData if available (parent user scenario)
      const guardianId = additionalData?.guardian_id || additionalData?.gid ? parseInt(additionalData.guardian_id || additionalData.gid) : null;
      
      // For child users, format phone as parentMobile+childName
      let finalMobile = customerPhone;
      if (guardianId && !isNaN(guardianId) && guardianId > 0) {
        // This is a child user - get parent's mobile and format as parentMobile+childName
        const parentUser = await User.findOne({
          where: { id: guardianId },
          attributes: ['id', 'mobile'],
          transaction
        });
        
        if (parentUser && parentUser.mobile) {
          // Extract base phone from parent (remove any existing +childname suffix)
          let parentBasePhone = parentUser.mobile;
          if (parentBasePhone.includes('+')) {
            parentBasePhone = parentBasePhone.split('+')[0];
          }
          
          // Clean the child name: remove special chars, keep spaces
          const cleanChildName = fullName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
          const childNameWithSpaces = cleanChildName.replace(/\s+/g, ' ').trim();
          
          if (parentBasePhone && childNameWithSpaces) {
            finalMobile = `${parentBasePhone}+${childNameWithSpaces}`;
            // Ensure phone doesn't exceed 32 characters
            if (finalMobile.length > 32) {
              const maxNameLength = 32 - parentBasePhone.length - 1; // -1 for the '+' separator
              const truncatedName = childNameWithSpaces.substring(0, Math.max(0, maxNameLength));
              finalMobile = `${parentBasePhone}+${truncatedName}`;
            }
            
            // Check if this mobile already exists (unique constraint)
            const existingUserWithMobile = await User.findOne({
              where: { mobile: finalMobile },
              transaction
            });
            
            if (existingUserWithMobile) {
              // Mobile already exists, set to null to avoid unique constraint violation
              finalMobile = null;
            }
          }
        }
      } else if (finalMobile) {
        // For non-child users, check if mobile already exists (unique constraint)
        // Strip any +childname suffix for comparison
        const normalizedMobile = finalMobile.includes('+') ? finalMobile.split('+')[0] : finalMobile;
        const existingUserWithMobile = await User.findOne({
          where: Sequelize.where(
            Sequelize.fn('SUBSTRING_INDEX', Sequelize.col('mobile'), '+', 1),
            normalizedMobile
          ),
          transaction
        });
        
        if (existingUserWithMobile) {
          // Base mobile already exists, set to null to avoid unique constraint violation
          finalMobile = null;
        }
      }
      
      const newUserData = {
        full_name: fullName,
        email: email,
        password: hashedPassword,
        language: customerLanguage,
        country_code: additionalData?.country_code || '+972',
        mobile: finalMobile, // Use formatted phone for child users (parentMobile+childName)
        role_name: 'user',
        role_id: 1,
        status: 'active',
        verified: true,
        access_content: true,
        newsletter: false,
        public_message: false,
        affiliate: true,
        can_create_store: false,
        ban: false,
        offline: false,
        trial_expired: false,
        total_hours: 0,
        timezone: "Asia/Jerusalem",
        notification_channels: '["email","whatsapp","inapp"]',
        lesson_notifications: '["24","1"]',
        meeting_type: 'online',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        // Add notes if provided
        notes: customerNotes || null
      };

      // Set guardian field if guardian_id is provided (parent user scenario)
      if (guardianId && !isNaN(guardianId) && guardianId > 0) {
        newUserData.guardian = guardianId;
        console.log(`✅ Setting guardian ${guardianId} for new user from direct payment`);
        
        // Log guardian assignment
        paymentLogger.logPaymentVerification({
          student_id: 'direct_payment',
          student_name: customerName,
          subscription_id: null,
          verification_type: 'guardian_assigned_direct_payment',
          verification_result: true,
          subscription_details: {
            guardian_id: guardianId,
            customer_email: email
          }
        });
      }

      const newUser = await User.create(newUserData, { transaction });
      userId = newUser.id;

      // Log new user created for direct payment
      paymentLogger.logPaymentVerification({
          student_id: userId,
          student_name: customerName,
          subscription_id: null,
          verification_type: 'new_user_direct_payment_creation',
          verification_result: true,
          subscription_details: {
              user_id: userId,
              user_email: email,
              full_name: fullName,
              language: customerLanguage,
              user_created: true,
              default_password_set: true,
              payment_type: 'direct_payment',
              notes_added: !!customerNotes
          }
      });
    }

    // Validate that userId was set
    if (!userId || isNaN(userId) || userId <= 0) {
      const errorMessage = `Failed to create or find user. userId is invalid: ${userId}`;
      paymentLogger.logPaymentVerification({
        student_id: 'direct_payment',
        student_name: customerName || 'unknown',
        subscription_id: null,
        verification_type: 'direct_payment_user_id_validation_failed',
        verification_result: false,
        error_details: {
          error_type: 'user_id_validation_error',
          error_message: errorMessage,
          customer_email: email,
          customer_name: customerName,
          user_id_returned: userId
        }
      });
      throw new Error(errorMessage);
    }

    // Log direct payment processing completion
    paymentLogger.logPaymentVerification({
        student_id: userId,
        student_name: customerName,
        subscription_id: null,
        verification_type: 'direct_payment_processing_complete',
        verification_result: true,
        subscription_details: {
            user_id: userId,
            customer_email: email,
            full_name: fullName,
            language: customerLanguage,
            processing_successful: true,
            user_action: existingUser ? 'updated' : 'created',
            enhanced_data_processed: true
        }
    });

    return userId;
  } catch (error) {
    // Log direct payment processing error
    paymentLogger.logPaymentVerification({
        student_id: 'direct_payment',
        student_name: customerName,
        subscription_id: null,
        verification_type: 'direct_payment_processing_error',
        verification_result: false,
        error_details: {
            error_type: 'direct_payment_error',
            error_message: error.message,
            error_stack: error.stack,
            customer_email: customerEmail,
            customer_name: customerName
        }
    });
    
    throw error;
  }
};

/**
 * Create or update user subscription
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

    // Log subscription creation/update start
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: user.full_name || 'unknown',
        subscription_id: null,
        verification_type: 'subscription_creation_start',
        verification_result: true,
        subscription_details: {
            lessons_per_month: lessonsPerMonth,
            lesson_minutes: lessonMinutes,
            months: months,
            amount: amount,
            is_recurring: isRecurring,
            configuration_source: 'new_payment_parameters_only'
        }
    });

    // ALWAYS use the new payment parameters (ignore existing subscription data)
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
      // Log existing subscriptions found but will be replaced
      paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: user.full_name || 'unknown',
        subscription_id: null,
        verification_type: 'existing_subscriptions_found_will_replace',
        verification_result: true,
        subscription_details: {
          existing_subscriptions_count: existingActiveSubscriptions.length,
          new_subscription_type: finalSubscriptionType,
          new_lessons_per_month: finalLessonsPerMonth,
          new_lesson_minutes: finalLessonMinutes,
          configuration_source: 'new_payment_parameters_only'
        }
      });

      // Cancel recurring payments for existing online subscriptions
      const recurringCancellationResult = await cancelRecurringForExistingSubscriptions(
        existingActiveSubscriptions,
        studentId,
        user.full_name || 'unknown',
        transaction
      );

      // Deactivate existing subscriptions
      for (const existingSubscription of existingActiveSubscriptions) {
        await existingSubscription.update({
          status: 'inactive',
          is_cancel: 1,
          updated_at: new Date(),
        }, { transaction });

        paymentLogger.logPaymentVerification({
          student_id: studentId,
          student_name: user.full_name || 'unknown',
          subscription_id: existingSubscription.id,
          verification_type: 'existing_subscription_deactivated_new_params',
          verification_result: true,
          subscription_details: {
            deactivated_subscription_id: existingSubscription.id,
            reason: 'new_payment_with_fresh_parameters',
            recurring_cancellation_processed: true
          }
        });
      }
    } else {
      // Log no existing subscription found
      paymentLogger.logPaymentVerification({
          student_id: studentId,
          student_name: user.full_name || 'unknown',
          subscription_id: null,
          verification_type: 'no_existing_subscription_fresh_start',
          verification_result: true,
          subscription_details: {
              subscription_type: finalSubscriptionType,
              lessons_per_month: finalLessonsPerMonth,
              lesson_minutes: finalLessonMinutes,
              configuration_source: 'new_payment_parameters_only'
          }
      });
    }

    // Calculate renewal date and other parameters using NEW parameters only
    const renewDate = moment().add(months, 'months').toDate();
    let totalLessons = finalLessonsPerMonth * months;

    // ✅ CARRY-OVER LOGIC: Add left lessons from previous subscription (matching PHP logic)
    // Initialize carry-over variable (matching PHP logic)
    let leftLessonData = 0;
    const subscriptionForCarryOver = existingActiveSubscriptions.length > 0 
      ? existingActiveSubscriptions[0] 
      : previousSubscription;

    if (subscriptionForCarryOver) {
      // Check if user has next_month_subscription or next_year_subscription flags (matching PHP logic)
      if (user.next_month_subscription || user.next_year_subscription) {
        leftLessonData = subscriptionForCarryOver.left_lessons || 0;
        
        console.log(`📋 Will carry over ${leftLessonData} left lessons from previous subscription (user flags set)`);

        paymentLogger.logPaymentVerification({
          student_id: studentId,
          student_name: user.full_name || 'unknown',
          subscription_id: subscriptionForCarryOver.id,
          verification_type: 'left_lessons_carry_over_prepared',
          verification_result: true,
          subscription_details: {
            previous_subscription_id: subscriptionForCarryOver.id,
            previous_left_lessons: leftLessonData,
            carry_over_reason: user.next_month_subscription ? 'next_month_subscription_flag' : 
                              user.next_year_subscription ? 'next_year_subscription_flag' : 'none'
          }
        });
      }
    }

    // Check for booked classes and subtract from total lessons (matching PHP logic)
    // PHP checks booked classes between old lesson_reset_at and NEW lesson_reset_at (not just until now)
    try {
      // Get the subscription to check for lesson_reset_at (use existing active subscription or previous subscription)
      const subscriptionToCheck = existingActiveSubscriptions.length > 0 
        ? existingActiveSubscriptions[0] 
        : previousSubscription;

      // Calculate new lesson_reset_at (matching PHP: Carbon::now()->addMonth())
      const newLessonResetAt = moment().add(1, 'month').toDate();

      // If there's a subscription with lesson_reset_at, check booked classes between old and new reset dates (matching PHP logic)
      if (subscriptionToCheck && subscriptionToCheck.lesson_reset_at && moment(newLessonResetAt).isAfter(moment(subscriptionToCheck.lesson_reset_at))) {
        const lessonsBooked = await Lesson.count({
          where: {
            student_id: studentId,
            meeting_start: {
              [Op.between]: [
                moment(subscriptionToCheck.lesson_reset_at).toDate(),
                moment(newLessonResetAt).toDate(),
              ]
            },
            status: 'pending',
            is_regular_hide: 0, // Only visible regular lessons
          },
          transaction
        });

        if (lessonsBooked > 0) {
          totalLessons = Math.max(0, totalLessons - lessonsBooked);
          
          console.log(`📋 Subtracted ${lessonsBooked} booked classes (between old reset date and new reset date) from new subscription. Remaining: ${totalLessons}`);
          
          paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: user.full_name || 'unknown',
            subscription_id: subscriptionToCheck.id,
            verification_type: 'booked_lessons_subtracted_from_reset_period',
            verification_result: true,
            subscription_details: {
              booked_lessons: lessonsBooked,
              old_reset_date: subscriptionToCheck.lesson_reset_at,
              new_reset_date: newLessonResetAt,
              total_lessons_before_subtraction: totalLessons + lessonsBooked,
              total_lessons_after_subtraction: totalLessons
            }
          });
        }
      }
      
      // Final calculation: base lessons + carry-over (matching PHP: $validData['left_lessons'] = $left_lessons + $leftLessonData)
      totalLessons = totalLessons + leftLessonData;
      
      if (leftLessonData > 0) {
        console.log(`📋 Added ${leftLessonData} carried-over lessons. Final total: ${totalLessons}`);
      }
    } catch (bookedLessonsError) {
      console.error('Error checking booked lessons:', bookedLessonsError);
      paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: user.full_name || 'unknown',
        subscription_id: null,
        verification_type: 'booked_lessons_check_error',
        verification_result: false,
        error_details: {
          error_type: 'booked_lessons_check_error',
          error_message: bookedLessonsError.message,
          error_stack: bookedLessonsError.stack
        }
      });
    }

    const costPerLesson = totalLessons > 0 ? amount / totalLessons : 0;

    // Create subscription data using ONLY new payment parameters
    const subscriptionData = {
      type: finalSubscriptionType,
      each_lesson: finalLessonMinutes.toString(),
      renew_date: renewDate,
      how_often: `${finalLessonsPerMonth} lessons per month`,
      weekly_lesson: finalLessonsPerMonth,
      status: 'active',
      lesson_min: finalLessonMinutes,
      left_lessons: totalLessons, // Includes carry-over minus future booked classes
      lesson_reset_at: moment().add(1, 'month').toDate(),
      cost_per_lesson: parseFloat(costPerLesson.toFixed(2)),
      is_cancel: 0,
      plan_id: 1, // Default plan ID since we're not using existing data
      payment_status: 'online',
      weekly_comp_class: 0, // Reset to default
      bonus_class: 0, // Reset to default  
      bonus_completed_class: 0,
      bonus_expire_date: null, // Reset to default
      notes: `Created on ${new Date().toISOString()} from payment processing (using new payment parameters only)`,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Referral bonus: if this is the user's first subscription and they were invited,
    // credit +1 left lesson to the REFERRER's active subscription (not the referee's)
    try {
      if (existingActiveSubscriptions.length === 0) {
        const referralRecord = await Referral.findOne({
          where: { referee_id: studentId },
          transaction
        });
        if (referralRecord && referralRecord.referrer_id) {
          // Determine current tier for the referrer based on previously rewarded referrals
          const rewardedCount = await Referral.count({
            where: {
              referrer_id: referralRecord.referrer_id,
              status: 'rewarded'
            },
            transaction
          });
          const currentTier = await ReferralTier.findOne({
            where: {
              min_referrals: { [Op.lte]: rewardedCount },
              max_referrals: { [Op.gte]: rewardedCount },
              is_active: true
            },
            order: [['tier_level', 'ASC']],
            transaction
          });

          const referrerActiveSub = await UserSubscriptionDetails.findOne({
            where: { user_id: referralRecord.referrer_id, status: 'active' },
            order: [['created_at', 'DESC']],
            transaction
          });
          if (referrerActiveSub && currentTier) {
            const now = new Date();
            const referrerType = currentTier.referrer_reward_type;
            const referrerValue = parseInt(currentTier.referrer_reward_value || 0);
            if (referrerType === 'free_lessons' && referrerValue > 0) {
              await referrerActiveSub.update({
                left_lessons: (referrerActiveSub.left_lessons || 0) + referrerValue,
                updated_at: now
              }, { transaction });
            } else if (referrerType === 'free_months' && referrerValue > 0) {
              const baseRenew = referrerActiveSub.renew_date ? moment(referrerActiveSub.renew_date) : moment();
              await referrerActiveSub.update({
                renew_date: baseRenew.add(referrerValue, 'months').toDate(),
                // Add lessons equal to plan lessons per month × free months
                left_lessons: (referrerActiveSub.left_lessons || 0) + ((referrerActiveSub.weekly_lesson || 0) * referrerValue),
                updated_at: now
              }, { transaction });
            }
          }

          // Apply referee reward to the NEW subscription being created
          if (currentTier) {
            const refereeType = currentTier.referee_reward_type;
            const refereeValue = parseInt(currentTier.referee_reward_value || 0);
            if (refereeType === 'free_lessons' && refereeValue > 0) {
              subscriptionData.left_lessons = (subscriptionData.left_lessons || 0) + refereeValue;
              subscriptionData.notes = `${subscriptionData.notes}\nTier reward applied to referee: +${refereeValue} free lesson(s).`;
            } else if (refereeType === 'free_months' && refereeValue > 0) {
              subscriptionData.renew_date = moment(subscriptionData.renew_date).add(refereeValue, 'months').toDate();
              // Add lessons equal to plan lessons per month × free months
              subscriptionData.left_lessons = (subscriptionData.left_lessons || 0) + (finalLessonsPerMonth * refereeValue);
              subscriptionData.notes = `${subscriptionData.notes}\nTier reward applied to referee: +${refereeValue} free month(s) and +${finalLessonsPerMonth * refereeValue} lessons.`;
            }
          }
          // Mark referral as rewarded (and paid) on successful first subscription
          try {
            await referralRecord.update({
              status: 'rewarded'
            }, { transaction });
          } catch (statusErr) {
            console.error('Error updating referral status to rewarded:', statusErr);
          }
          // Create granted reward entries for referrer and referee (tier-based)
          try {
            const nowSec = Math.floor(Date.now() / 1000);
            if (currentTier) {
              await ReferralReward.create({
                referral_id: referralRecord.id,
                user_id: referralRecord.referrer_id,
                user_type: 'referrer',
                reward_type: currentTier.referrer_reward_type,
                reward_value: currentTier.referrer_reward_value,
                tier_level: currentTier.tier_level,
                status: 'granted',
                created_at: nowSec,
                granted_at: nowSec
              }, { transaction });
              await ReferralReward.create({
                referral_id: referralRecord.id,
                user_id: referralRecord.referee_id,
                user_type: 'referee',
                reward_type: currentTier.referee_reward_type,
                reward_value: currentTier.referee_reward_value,
                tier_level: currentTier.tier_level,
                status: 'granted',
                created_at: nowSec,
                granted_at: nowSec
              }, { transaction });
            }
          } catch (rewardErr) {
            console.error('Error creating referral reward for referrer:', rewardErr);
          }
        }
      }
    } catch (referralErr) {
      console.error('Error crediting referral bonus to referrer subscription:', referralErr);
    }

    // Always create new subscription
    const createdSubscription = await UserSubscriptionDetails.create({
      user_id: studentId,
      ...subscriptionData,
      balance: 0
    }, { transaction });

    const subscriptionId = createdSubscription.id;

    // Update user table with NEW subscription information (matching PHP logic)
    const userUpdateData = {
      subscription_type: finalSubscriptionType,
      trial_expired: true,
      subscription_id: subscriptionId,
      next_month_subscription: false, // Set to false after creating subscription (matching PHP logic)
      updated_at: Math.floor(Date.now() / 1000)
    };

    await User.update(userUpdateData, {
      
      where: { id: studentId },
      transaction
    });

    // Log successful subscription creation
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: user.full_name || 'unknown',
        subscription_id: subscriptionId,
        verification_type: 'subscription_creation_complete_new_params',
        verification_result: true,
        subscription_details: {
            subscription_id: subscriptionId,
            subscription_type: finalSubscriptionType,
            lessons_added: totalLessons,
            lesson_minutes: finalLessonMinutes,
            lessons_per_month: finalLessonsPerMonth,
            cost_per_lesson: costPerLesson,
            renew_date: renewDate,
            user_table_updated: true,
            configuration_source: 'new_payment_parameters_only',
            existing_subscriptions_ignored: existingActiveSubscriptions.length
        }
    });

    const result = {
      subscription_id: subscriptionId,
      subscription_type: finalSubscriptionType,
      is_new_subscription: true,
      lessons_added: totalLessons,
      lesson_minutes: finalLessonMinutes,
      lessons_per_month: finalLessonsPerMonth,
      user_updated: true,
      previous_subscription_used: false, // Always false now
      existing_subscriptions_deactivated: existingActiveSubscriptions.length,
      deactivated_subscription_ids: existingActiveSubscriptions.map(sub => sub.id),
      configuration_preserved_from_existing: false, // Always false now
      original_webhook_params: {
        webhook_lessons_per_month: lessonsPerMonth,
        webhook_lesson_minutes: lessonMinutes,
        webhook_months: months
      }
    };

    return result;
  } catch (error) {
    // Log subscription creation error
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: 'unknown',
        subscription_id: null,
        verification_type: 'subscription_creation_error',
        verification_result: false,
        error_details: {
            error_type: 'subscription_creation_exception',
            error_message: error.message,
            error_stack: error.stack,
            lessons_per_month: lessonsPerMonth,
            lesson_minutes: lessonMinutes,
            months: months,
            amount: amount
        }
    });
    
    throw error;
  }
};

/**
 * Cancel recurring payments for existing active subscriptions before deactivating them
 * @param {Array} existingSubscriptions - Array of existing active subscriptions to process
 * @param {Number} studentId - Student ID
 * @param {String} studentName - Student name for logging
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Summary of cancellation results
 */
const cancelRecurringForExistingSubscriptions = async (existingSubscriptions, studentId, studentName, transaction) => {
    try {
        console.log(`Processing ${existingSubscriptions.length} existing subscriptions for recurring payment cancellation`);
        
        let totalCancelled = 0;
        let totalSkipped = 0;
        let totalErrors = 0;
        const results = [];

        for (const existingSubscription of existingSubscriptions) {
            try {
                // Check if this subscription has online payment status
                if (existingSubscription.payment_status === 'online') {
                    console.log(`Cancelling recurring payments for existing online subscription ${existingSubscription.id}`);
                    
                    // Find all active recurring payments for this user (not just this subscription)
                    const activeRecurringPayments = await RecurringPayment.findAll({
                        where: {
                            student_id: studentId,
                            status: { [Op.in]: ['pending', 'paid'] },
                            is_active: true
                        },
                        transaction
                    });

                    let successCount = 0;
                    let failureCount = 0;

                    // Cancel each active recurring payment
                    for (const recurringPayment of activeRecurringPayments) {
                        try {
                            let payPlusCancelled = true;
                            let actualRecurringUid = null;
                            let terminalUid = null;

                            // Extract recurring payment UID and terminal UID from webhook data
                            if (recurringPayment.webhook_data) {
                                try {
                                    const webhookData = typeof recurringPayment.webhook_data === 'string' 
                                        ? JSON.parse(recurringPayment.webhook_data) 
                                        : recurringPayment.webhook_data;

                                    // Extract actual recurring payment UID
                                    actualRecurringUid = extractRecurringPaymentUid(webhookData) || 
                                                       recurringPayment.payplus_transaction_uid;

                                    // Extract terminal UID
                                    terminalUid = extractTerminalUidFromPageRequest(
                                        recurringPayment.payplus_page_request_uid, 
                                        webhookData
                                    );
                                } catch (parseError) {
                                    console.log(`Warning: Could not parse webhook data for payment ${recurringPayment.id}: ${parseError.message}`);
                                    actualRecurringUid = recurringPayment.payplus_transaction_uid;
                                }
                            } else {
                                actualRecurringUid = recurringPayment.payplus_transaction_uid;
                            }

                            // Try to cancel at PayPlus if we have a valid UID
                            if (actualRecurringUid && actualRecurringUid !== 'N/A' && actualRecurringUid !== '') {
                                payPlusCancelled = await cancelPayPlusRecurringPayment(
                                    actualRecurringUid,
                                    recurringPayment.payplus_page_request_uid,
                                    recurringPayment.webhook_data
                                );
                            } else {
                                console.log(`Warning: No valid recurring payment UID found for payment ${recurringPayment.id}, skipping PayPlus cancellation`);
                                payPlusCancelled = true; // Consider successful if there's nothing to cancel
                            }

                            // Update the recurring payment record (mark as cancelled locally regardless of PayPlus result)
                            const updateRemarks = `${recurringPayment.remarks || ''}\n[${new Date().toISOString()}] Cancelled due to new payment received for subscription ${existingSubscription.id}. PayPlus cancelled: ${payPlusCancelled}. Used recurring UID: ${actualRecurringUid || 'N/A'}. Terminal UID: ${terminalUid || 'N/A'}`;

                            await recurringPayment.update({
                                status: 'cancelled',
                                is_active: false,
                                cancelled_at: new Date(),
                                cancelled_by: null, // System cancellation
                                remarks: updateRemarks
                            }, { transaction });

                            if (payPlusCancelled) {
                                successCount++;
                            } else {
                                failureCount++;
                            }

                        } catch (recurringError) {
                            failureCount++;
                            console.error(`Error cancelling recurring payment ${recurringPayment.id}:`, recurringError);
                        }
                    }

                    totalCancelled += successCount;
                    
                    results.push({
                        subscription_id: existingSubscription.id,
                        payment_status: 'online',
                        recurring_payments_found: activeRecurringPayments.length,
                        successful_cancellations: successCount,
                        failed_cancellations: failureCount,
                        action: 'cancelled'
                    });

                    // Log successful recurring payment cancellation
                    paymentLogger.logPaymentVerification({
                        student_id: studentId,
                        student_name: studentName,
                        subscription_id: existingSubscription.id,
                        verification_type: 'recurring_payments_cancelled_for_existing_subscription',
                        verification_result: true,
                        subscription_details: {
                            subscription_id: existingSubscription.id,
                            payment_status: existingSubscription.payment_status,
                            recurring_payments_cancelled: successCount,
                            recurring_payments_failed: failureCount,
                            recurring_payments_total: activeRecurringPayments.length,
                            cancellation_reason: 'new_payment_received'
                        }
                    });

                } else {
                    // Offline payment - no recurring payments to cancel
                    totalSkipped++;
                    
                    results.push({
                        subscription_id: existingSubscription.id,
                        payment_status: existingSubscription.payment_status,
                        recurring_payments_found: 0,
                        action: 'skipped_offline'
                    });

                    paymentLogger.logPaymentVerification({
                        student_id: studentId,
                        student_name: studentName,
                        subscription_id: existingSubscription.id,
                        verification_type: 'recurring_payments_skip_offline_subscription',
                        verification_result: true,
                        subscription_details: {
                            subscription_id: existingSubscription.id,
                            payment_status: existingSubscription.payment_status,
                            reason: 'offline_payment_no_recurring_to_cancel'
                        }
                    });
                }

            } catch (subscriptionError) {
                totalErrors++;
                
                results.push({
                    subscription_id: existingSubscription.id,
                    payment_status: existingSubscription.payment_status || 'unknown',
                    action: 'error',
                    error: subscriptionError.message
                });

                // Log error but don't fail the entire payment process
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: studentName,
                    subscription_id: existingSubscription.id,
                    verification_type: 'recurring_payments_cancellation_error',
                    verification_result: false,
                    error_details: {
                        error_type: 'subscription_processing_error',
                        error_message: subscriptionError.message,
                        subscription_id: existingSubscription.id
                    }
                });
            }
        }

        const summary = {
            total_subscriptions_processed: existingSubscriptions.length,
            recurring_payments_cancelled: totalCancelled,
            subscriptions_skipped: totalSkipped,
            errors_encountered: totalErrors,
            results: results
        };

        // Log overall summary
        paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: studentName,
            subscription_id: null,
            verification_type: 'recurring_payment_cancellation_summary',
            verification_result: totalErrors === 0,
            subscription_details: summary
        });

        console.log(`Recurring payment cancellation summary for user ${studentId}:`, summary);
        
        return summary;

    } catch (error) {
        console.error(`Error in cancelRecurringForExistingSubscriptions:`, error);
        
        paymentLogger.logPaymentVerification({
            student_id: studentId,
            student_name: studentName,
            subscription_id: null,
            verification_type: 'recurring_payment_cancellation_process_error',
            verification_result: false,
            error_details: {
                error_type: 'cancellation_process_error',
                error_message: error.message,
                error_stack: error.stack
            }
        });
        
        throw error;
    }
};

/**
 * Import PayPlus cancellation function from user-plan.controller.js
 * This creates a local version of the cancellation logic to avoid circular dependencies
 */
const cancelPayPlusRecurringPayment = async (recurringPaymentUid, pageRequestUid = null, webhookData = null) => {
    try {
        console.log(`Attempting to cancel PayPlus recurring payment with UID: ${recurringPaymentUid}`);

        // PayPlus API Configuration (same as in user-plan.controller.js)
        const PAYPLUS_CONFIG = {
            apiKey: process.env.PAYPLUS_API_KEY || '',
            secretKey: process.env.PAYPLUS_SECRET_KEY || '',
            baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
            terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
        };

        // First, try to extract the actual recurring payment UID from webhook data
        let actualRecurringUid = recurringPaymentUid;

        if (webhookData) {
            const extractedRecurringUid = extractRecurringPaymentUid(webhookData);
            if (extractedRecurringUid && extractedRecurringUid !== recurringPaymentUid) {
                console.log(`Using extracted recurring payment UID: ${extractedRecurringUid} instead of ${recurringPaymentUid}`);
                actualRecurringUid = extractedRecurringUid;
            }
        }

        if (!actualRecurringUid || actualRecurringUid === 'undefined' || actualRecurringUid === '' || actualRecurringUid === 'N/A') {
            console.log('No valid recurring payment UID found, skipping PayPlus cancellation');
            return true; // Consider it successful if there's nothing to cancel
        }

        // Extract terminal UID from webhook data
        let terminalUid = extractTerminalUidFromPageRequest(pageRequestUid, webhookData);

        // Fall back to config terminal UID if extraction fails
        if (!terminalUid) {
            terminalUid = PAYPLUS_CONFIG.terminalUid;
            console.log(`Using fallback terminal UID from config: ${terminalUid}`);
        } else {
            console.log(`Using extracted terminal UID: ${terminalUid}`);
        }

        console.log(`Making PayPlus API call to cancel recurring payment: ${actualRecurringUid}`);

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${actualRecurringUid}`,
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

        console.log(`PayPlus API response status: ${response.status}`);

        if (response.status === 200 || response.status === 204) {
            console.log(`Successfully cancelled PayPlus recurring payment: ${actualRecurringUid}`);
            return true;
        } else {
            console.error(`PayPlus API returned status ${response.status} for recurring payment cancellation`);
            return false;
        }
    } catch (error) {
        console.error(`Error cancelling PayPlus recurring payment ${recurringPaymentUid}:`, error.message);

        // If the error is that the recurring payment doesn't exist, consider it successful
        if (error.response?.status === 404 ||
            error.response?.data?.includes('not found') ||
            error.response?.data?.includes('Not Found') ||
            error.message?.includes('not found')) {
            console.log('Recurring payment not found at PayPlus, considering cancellation successful');
            return true;
        }

        // If it's already cancelled, also consider it successful
        if (error.response?.data?.includes('already cancelled') ||
            error.response?.data?.includes('already canceled') ||
            error.response?.data?.includes('inactive')) {
            console.log('Recurring payment already cancelled at PayPlus, considering cancellation successful');
            return true;
        }

        return false;
    }
};
/**
 * Extract terminal UID from PayPlus webhook data with enhanced parsing
 * @param {String} pageRequestUid - PayPlus page request UID
 * @param {Object} webhookData - Webhook data from RecurringPayment.webhook_data
 * @returns {String|null} - Extracted terminal UID or null
 */
const extractTerminalUidFromPageRequest = (pageRequestUid, webhookData = null) => {
    try {
        console.log(`🔍 Extracting terminal UID from webhook data:`, {
            hasWebhookData: !!webhookData,
            pageRequestUid
        });

        if (!webhookData) {
            console.log(`⚠️ No webhook data provided, using fallback terminal UID`);
            return null;
        }

        // Parse webhook data if it's a string
        let parsedWebhookData = webhookData;
        if (typeof webhookData === 'string') {
            try {
                parsedWebhookData = JSON.parse(webhookData);
            } catch (parseError) {
                console.error(`❌ Error parsing webhook data string:`, parseError);
                return null;
            }
        }

        // Try to extract terminal UID from various locations in the webhook data
        let terminalUid = null;

        // Method 1: Direct terminal_uid field
        if (parsedWebhookData.terminal_uid) {
            terminalUid = parsedWebhookData.terminal_uid;
            console.log(`🟢 Found terminal UID in root webhook data: ${terminalUid}`);
            return terminalUid;
        }

        // Method 2: From original_webhook object (most common location)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.terminal_uid) {
            terminalUid = parsedWebhookData.original_webhook.terminal_uid;
            console.log(`🟢 Found terminal UID in original_webhook: ${terminalUid}`);
            return terminalUid;
        }

        // Method 3: From nested data structure if present
        if (parsedWebhookData.data && parsedWebhookData.data.terminal_uid) {
            terminalUid = parsedWebhookData.data.terminal_uid;
            console.log(`🟢 Found terminal UID in data object: ${terminalUid}`);
            return terminalUid;
        }

        // Method 4: From transaction object if present
        if (parsedWebhookData.transaction && parsedWebhookData.transaction.terminal_uid) {
            terminalUid = parsedWebhookData.transaction.terminal_uid;
            console.log(`🟢 Found terminal UID in transaction object: ${terminalUid}`);
            return terminalUid;
        }

        console.log(`⚠️ Terminal UID not found in webhook data structure`);
        return null;

    } catch (error) {
        console.error(`❌ Error extracting terminal UID:`, error);
        return null;
    }
};


/**
 * Log recurring payment entry with subscription details - IMPROVED VERSION
 * @param {Number} studentId - Student ID
 * @param {Number|null} managedById - Sales person ID
 * @param {Number} amount - Payment amount
 * @param {String} currency - Currency code
 * @param {String} transactionId - Transaction ID
 * @param {Object} recurringInfo - Recurring payment info from PayPlus
 * @param {Number} lessonMinutes - Lesson duration
 * @param {Number} lessonsPerMonth - Lessons per month
 * @param {Number} subscriptionMonths - Subscription duration
 * @param {Boolean} isRecurring - Whether payment is recurring
 * @param {Object} webhookData - Complete webhook data for proper field mapping
 * @param {Object} transaction - Database transaction
 */
const logRecurringPayment = async (studentId, managedById, amount, currency, transactionId, recurringInfo, lessonMinutes, lessonsPerMonth, subscriptionMonths, isRecurring, webhookData, transaction) => {
  try {
    // Validate input parameters
    if (!studentId || isNaN(studentId) || studentId <= 0) {
      throw new Error(`Invalid student ID for recurring payment: ${studentId}`);
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      throw new Error(`Invalid amount for recurring payment: ${amount}`);
    }

    if (!transactionId || transactionId === 'undefined' || transactionId === '') {
      throw new Error(`Invalid transaction ID for recurring payment: ${transactionId}`);
    }

    // Log recurring payment logging start
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: webhookData?.customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'recurring_payment_logging_start',
        verification_result: true,
        subscription_details: {
            transaction_id: transactionId,
            amount: amount,
            currency: currency,
            is_recurring: isRecurring,
            lesson_details: {
                lesson_minutes: lessonMinutes,
                lessons_per_month: lessonsPerMonth,
                subscription_months: subscriptionMonths
            }
        }
    });

    // Handle undefined or null recurringInfo safely
    const safeRecurringInfo = recurringInfo || {};

    // Extract recurring UID from multiple possible sources
    let recurringUid = safeRecurringInfo.recurring_uid || safeRecurringInfo.recurring_charge_uid || null;

    // Try to extract from webhook data if not found in recurringInfo
    if (!recurringUid && webhookData) {
      recurringUid = extractRecurringPaymentUid(webhookData);
    }

    const chargeUid = safeRecurringInfo.charge_uid || null;
    const pageRequestUid = safeRecurringInfo.page_request_uid || webhookData?.page_request_uid || null;

    // Determine recurring frequency based on subscription length
    let recurringFrequency = 'monthly'; // default
    if (subscriptionMonths >= 12) {
      recurringFrequency = 'yearly';
    } else if (subscriptionMonths >= 3) {
      recurringFrequency = 'quarterly';
    }

    // Calculate next payment date based on subscription type
    let nextPaymentDate = null;
    if (isRecurring) {
      switch (recurringFrequency) {
        case 'yearly':
          nextPaymentDate = moment().add(1, 'year').format('YYYY-MM-DD');
          break;
        case 'quarterly':
          nextPaymentDate = moment().add(3, 'months').format('YYYY-MM-DD');
          break;
        default:
          nextPaymentDate = moment().add(1, 'month').format('YYYY-MM-DD');
      }
    }

    // Extract additional data from webhookData for better field mapping
    const paymentMethod = webhookData?.payment_method || 'credit_card';
    const cardLastDigits = webhookData?.four_digits ? webhookData.four_digits.slice(-4) : null;
    const customerEmail = webhookData?.customer_email || '';
    const customerName = webhookData?.customer_name || '';
    const approvalNumber = webhookData?.approval_number || '';
    const voucherNumber = webhookData?.voucher_number || '';

    // Enhanced remarks with more detailed information
    const remarksData = {
      transactionId,
      recurringUid: recurringUid || 'N/A',
      customerEmail,
      customerName,
      approvalNumber,
      voucherNumber,
      lessonDetails: `${lessonsPerMonth} lessons/month × ${lessonMinutes} minutes`,
      subscriptionDuration: `${subscriptionMonths} months`,
      paymentMethod,
      processedAt: new Date().toISOString(),
      webhookReceived: !!webhookData
    };

    const detailedRemarks = `Payment processed via PayPlus webhook. ` +
      `Customer: ${customerName} (${customerEmail}). ` +
      `Recurring UID: ${recurringUid || 'N/A'}. ` +
      `Approval: ${approvalNumber || 'N/A'}. ` +
      `Voucher: ${voucherNumber || 'N/A'}. ` +
      `Lessons: ${lessonsPerMonth}/month × ${lessonMinutes}min for ${subscriptionMonths} months. ` +
      `Payment Method: ${paymentMethod}. ` +
      `Card: ${cardLastDigits ? `****${cardLastDigits}` : 'N/A'}. ` +
      `Processed: ${new Date().toISOString()}`;

    // FIXED: Use exact field names from RecurringPayment model with proper data mapping
    const recurringPaymentData = {
      student_id: studentId,
      managed_by_id: managedById || null,
      managed_by_role: managedById ? 'sales' : 'admin', // Default to admin if no manager
      subscription_id: null, // Will be updated if needed
      payplus_transaction_uid: recurringUid,
      payplus_page_request_uid: pageRequestUid,
      amount: parseFloat(amount),
      currency: currency || 'ILS',
      payment_date: moment().format('YYYY-MM-DD'),
      status: 'paid',
      transaction_id: transactionId,
      next_payment_date: nextPaymentDate,
      recurring_frequency: recurringFrequency,
      recurring_count: 1, // First payment
      max_recurring_count: isRecurring ? null : 1, // null = unlimited for recurring, 1 for one-time
      booked_monthly_classes: 0, // Default to not booked
      payment_method: paymentMethod,
      card_last_digits: cardLastDigits,
      failure_reason: null, // No failure for successful payment
      failure_count: 0,
      webhook_data: webhookData ? JSON.stringify({
        ...webhookData,
        processed_at: new Date().toISOString(),
        lesson_details: remarksData
      }) : JSON.stringify(remarksData),
      remarks: detailedRemarks,
      is_active: isRecurring, // Only active if it's a recurring payment
      cancelled_at: null,
      cancelled_by: null
    };

    const recurringPayment = await RecurringPayment.create(recurringPaymentData, { transaction });

    // Log successful recurring payment creation
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: webhookData?.customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'recurring_payment_logged',
        verification_result: true,
        subscription_details: {
            recurring_payment_id: recurringPayment.id,
            transaction_id: transactionId,
            recurring_uid: recurringUid,
            amount: amount,
            currency: currency,
            recurring_frequency: recurringFrequency,
            next_payment_date: nextPaymentDate,
            is_active: isRecurring
        }
    });

    return recurringPayment;
  } catch (error) {
    // Log recurring payment logging error
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: webhookData?.customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'recurring_payment_logging_error',
        verification_result: false,
        error_details: {
            error_type: 'recurring_payment_logging_exception',
            error_message: error.message,
            error_stack: error.stack,
            transaction_id: transactionId,
            amount: amount,
            currency: currency
        }
    });
    
    throw error;
  }
};

/**
 * Extract recurring payment UID from webhook data with multiple fallback strategies
 * @param {Object} webhookData - Complete webhook data object
 * @returns {String|null} - Recurring payment UID or null if not found
 */
const extractRecurringPaymentUid = (webhookData) => {
  try {
    if (!webhookData) {
      return null;
    }

    // Log extraction attempt
    paymentLogger.logPaymentVerification({
        student_id: 'system',
        student_name: 'system',
        subscription_id: null,
        verification_type: 'recurring_uid_extraction_attempt',
        verification_result: false, // Will update if found
        subscription_details: {
            webhook_data_available: true,
            extraction_strategies_attempted: []
        }
    });

    const strategies = [];

    // Strategy 1: Direct from webhook data properties
    const directUid = webhookData.recurring_payment_uid ||
      webhookData.payplus_transaction_uid ||
      webhookData.recurring_uid ||
      webhookData.recurring_charge_uid;

    strategies.push('direct_properties');

    if (directUid && directUid !== 'N/A' && directUid !== 'undefined' && directUid !== '') {
      paymentLogger.logPaymentVerification({
          student_id: 'system',
          student_name: 'system',
          subscription_id: null,
          verification_type: 'recurring_uid_extraction_success',
          verification_result: true,
          subscription_details: {
              extraction_strategy: 'direct_properties',
              recurring_uid: directUid,
              strategies_attempted: strategies
          }
      });
      return directUid;
    }

    // Strategy 2: From recurring_info object
    if (webhookData.recurring_info) {
      const recurringInfoUid = webhookData.recurring_info.recurring_uid ||
        webhookData.recurring_info.recurring_charge_uid ||
        webhookData.recurring_info.payplus_transaction_uid;

      strategies.push('recurring_info_object');

      if (recurringInfoUid && recurringInfoUid !== 'N/A' && recurringInfoUid !== 'undefined' && recurringInfoUid !== '') {
        paymentLogger.logPaymentVerification({
            student_id: 'system',
            student_name: 'system',
            subscription_id: null,
            verification_type: 'recurring_uid_extraction_success',
            verification_result: true,
            subscription_details: {
                extraction_strategy: 'recurring_info_object',
                recurring_uid: recurringInfoUid,
                strategies_attempted: strategies
            }
        });
        return recurringInfoUid;
      }
    }

    // Strategy 3: From original_webhook nested data
    if (webhookData.original_webhook) {
      const originalWebhook = webhookData.original_webhook;

      strategies.push('original_webhook_direct');

      const originalUid = originalWebhook.recurring_payment_uid ||
        originalWebhook.recurring_uid ||
        originalWebhook.recurring_charge_uid;

      if (originalUid && originalUid !== 'N/A' && originalUid !== 'undefined' && originalUid !== '') {
        paymentLogger.logPaymentVerification({
            student_id: 'system',
            student_name: 'system',
            subscription_id: null,
            verification_type: 'recurring_uid_extraction_success',
            verification_result: true,
            subscription_details: {
                extraction_strategy: 'original_webhook_direct',
                recurring_uid: originalUid,
                strategies_attempted: strategies
            }
        });
        return originalUid;
      }

      if (originalWebhook.data) {
        strategies.push('original_webhook_data');

        const dataUid = originalWebhook.data.recurring_uid ||
          originalWebhook.data.recurring_payment_uid ||
          originalWebhook.data.recurring_charge_uid;

        if (dataUid && dataUid !== 'N/A' && dataUid !== 'undefined' && dataUid !== '') {
          paymentLogger.logPaymentVerification({
              student_id: 'system',
              student_name: 'system',
              subscription_id: null,
              verification_type: 'recurring_uid_extraction_success',
              verification_result: true,
              subscription_details: {
                  extraction_strategy: 'original_webhook_data',
                  recurring_uid: dataUid,
                  strategies_attempted: strategies
              }
          });
          return dataUid;
        }

        if (originalWebhook.data.recurring_charge_information) {
          strategies.push('original_webhook_data_recurring_info');

          const recurringChargeUid = originalWebhook.data.recurring_charge_information.recurring_uid ||
            originalWebhook.data.recurring_charge_information.charge_uid;

          if (recurringChargeUid && recurringChargeUid !== 'N/A' && recurringChargeUid !== 'undefined' && recurringChargeUid !== '') {
            paymentLogger.logPaymentVerification({
                student_id: 'system',
                student_name: 'system',
                subscription_id: null,
                verification_type: 'recurring_uid_extraction_success',
                verification_result: true,
                subscription_details: {
                    extraction_strategy: 'original_webhook_data_recurring_info',
                    recurring_uid: recurringChargeUid,
                    strategies_attempted: strategies
                }
            });
            return recurringChargeUid;
          }
        }
      }

      if (originalWebhook.transaction) {
        strategies.push('original_webhook_transaction');

        const transactionUid = originalWebhook.transaction.recurring_uid ||
          originalWebhook.transaction.recurring_payment_uid ||
          originalWebhook.transaction.recurring_charge_uid;

        if (transactionUid && transactionUid !== 'N/A' && transactionUid !== 'undefined' && transactionUid !== '') {
          paymentLogger.logPaymentVerification({
              student_id: 'system',
              student_name: 'system',
              subscription_id: null,
              verification_type: 'recurring_uid_extraction_success',
              verification_result: true,
              subscription_details: {
                  extraction_strategy: 'original_webhook_transaction',
                  recurring_uid: transactionUid,
                  strategies_attempted: strategies
              }
          });
          return transactionUid;
        }

        if (originalWebhook.transaction.recurring_charge_information) {
          strategies.push('original_webhook_transaction_recurring_info');

          const transactionRecurringUid = originalWebhook.transaction.recurring_charge_information.recurring_uid ||
            originalWebhook.transaction.recurring_charge_information.charge_uid;

          if (transactionRecurringUid && transactionRecurringUid !== 'N/A' && transactionRecurringUid !== 'undefined' && transactionRecurringUid !== '') {
            paymentLogger.logPaymentVerification({
                student_id: 'system',
                student_name: 'system',
                subscription_id: null,
                verification_type: 'recurring_uid_extraction_success',
                verification_result: true,
                subscription_details: {
                    extraction_strategy: 'original_webhook_transaction_recurring_info',
                    recurring_uid: transactionRecurringUid,
                    strategies_attempted: strategies
                }
            });
            return transactionRecurringUid;
          }
        }
      }
    }

    paymentLogger.logPaymentVerification({
        student_id: 'system',
        student_name: 'system',
        subscription_id: null,
        verification_type: 'recurring_uid_extraction_failed',
        verification_result: false,
        error_details: {
            message: 'No recurring payment UID found in webhook data',
            strategies_attempted: strategies,
            webhook_data_keys: Object.keys(webhookData)
        }
    });

    return null;

  } catch (error) {
    // Log extraction error
    paymentLogger.logPaymentVerification({
        student_id: 'system',
        student_name: 'system',
        subscription_id: null,
        verification_type: 'recurring_uid_extraction_error',
        verification_result: false,
        error_details: {
            error_type: 'extraction_exception',
            error_message: error.message,
            error_stack: error.stack
        }
    });
    
    return null;
  }
};

/**
 * Resolve active past-due payments and disable their dunning schedules after a successful payment.
 * This is triggered when a new subscription/payment is completed so old debt stops chasing the user.
 * @param {Number} studentId
 * @param {String} transactionUid
 * @param {Number} amount
 * @param {String} currency
 * @param {Object} transaction - DB transaction
 */
const resolvePastDuePayments = async (studentId, transactionUid, amount, currency, transaction) => {
  if (!studentId) return;

  try {
    const activePastDue = await PastDuePayment.findAll({
      where: {
        user_id: studentId,
        status: 'past_due'
      },
      transaction
    });

    if (!activePastDue.length) {
      return;
    }

    const now = new Date();

    // Resolve each past-due record
    for (const pastDue of activePastDue) {
      await pastDue.update({
        status: 'resolved',
        resolved_at: now,
        resolved_transaction_id: transactionUid,
        notes: `${pastDue.notes || ''}\n[${now.toISOString()}] Resolved via successful payment. Transaction: ${transactionUid}. Amount: ${amount} ${currency}.`
      }, { transaction });

      // Disable related dunning schedules
      await DunningSchedule.update({
        is_enabled: false,
        is_paused: true,
        next_reminder_at: null,
        updated_at: now
      }, {
        where: { past_due_payment_id: pastDue.id },
        transaction
      });
    }

    paymentLogger.logPaymentVerification({
      student_id: studentId,
      student_name: 'system',
      subscription_id: null,
      verification_type: 'past_due_resolved_after_payment',
      verification_result: true,
      subscription_details: {
        resolved_count: activePastDue.length,
        transaction_uid: transactionUid,
        amount,
        currency
      }
    });
  } catch (error) {
    // Do not block main payment flow; just log the issue
    paymentLogger.logPaymentVerification({
      student_id: studentId,
      student_name: 'system',
      subscription_id: null,
      verification_type: 'past_due_resolve_error',
      verification_result: false,
      error_details: {
        error_type: 'past_due_resolution_error',
        error_message: error.message,
        error_stack: error.stack
      }
    });
  }
};

module.exports = {
  processPayPlusSuccessfulPayment
};