// controller/sales/payment-callback.controller.js
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PaymentTransaction = require('../../models/PaymentTransaction');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const RecurringPayment = require('../../models/RecurringPayment');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const Lesson = require('../../models/classes');
const PastDuePayment = require('../../models/PastDuePayment');
const DunningSchedule = require('../../models/DunningSchedule');
const SubscriptionChargeSkip = require('../../models/SubscriptionChargeSkip');
const { sendFailureNotification } = require('../../services/dunningNotificationService');
const { encryptRecoveryUrl } = require('../../utils/encryptRecoveryUrl');
const { paymentLogger } = require('../../utils/paymentLogger');
const { sequelize } = require('../../connection/connection');
const bcrypt = require('bcrypt');
const securePassword = require('../../utils/encryptPassword');
const { sendCombinedNotifications } = require('../../cronjobs/reminder');
const { Op, col, Sequelize } = require('sequelize');
const moment = require('moment');
const crypto = require('crypto');

// Helper to generate an 8-character alphanumeric short ID for PastDuePayment
const generateShortId = () => crypto.randomBytes(4).toString('hex');
const axios = require('axios');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');

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
            console.warn('⚠️ No page request UID provided for TrialPaymentLink update');
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
            
            console.log(`📝 Updated TrialPaymentLink ${trialPaymentLink.id} status: ${status}`);

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
            console.warn(`⚠️ TrialPaymentLink not found for pageRequestUid: ${pageRequestUid} or studentId: ${studentId}`);
            
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
        console.error('❌ Error updating TrialPaymentLink status:', error);
        
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
            console.warn('⚠️ Missing required parameters for status history logging');
            
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
        console.log(`📝 Logged status change for trial class ${trialClassId}: ${previousStatus} → ${newStatus}`);
        
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
        console.error('❌ Error logging trial class status change:', error);
        
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
 * Convert trial class registration to user account
 * @param {Object} trialClassRegistration - Trial class registration object
 * @param {String} transactionUid - Transaction ID for reference
 * @param {Object} transaction - Database transaction
 * @returns {Number} - Created/updated user ID
 */
const convertTrialClassToUser = async (trialClassRegistration, transactionUid, transaction) => {
  try {
    const trialClassId = trialClassRegistration.id;
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
    console.log(`🔄 Converting trial class ${trialClassId} to user account`);
    console.log(`📋 Trial student: ${trialClassRegistration.student_name} (${email})`);

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

    // Check if user already exists with this email
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const isFormattedEmail = normalizedEmail && normalizedEmail.includes('+');
    
    console.log(`🔍 Looking up user by email: ${normalizedEmail}, isFormattedEmail: ${isFormattedEmail}`);
    
    let existingUser = null;
    
    if (normalizedEmail) {
      // Use Sequelize.where with LOWER() for case-insensitive exact match
      existingUser = await User.findOne({
        where: Sequelize.where(
          Sequelize.fn('LOWER', Sequelize.col('email')),
          normalizedEmail
        ),
        transaction
      });
      
      if (existingUser && isFormattedEmail) {
        const foundEmail = existingUser.email ? existingUser.email.trim().toLowerCase() : '';
        if (foundEmail !== normalizedEmail) {
          existingUser = null; // Clear it - we'll create a new user instead
        } else {
          console.log(`✅ Found existing user with EXACT formatted email match: ${foundEmail}`);
        }
      } else if (existingUser) {
        console.log(`⚠️ Found existing user by email: ID=${existingUser.id}, Email=${existingUser.email}, Name=${existingUser.full_name}`);
      }
    }
    
    if (!existingUser) {
      console.log(`✅ No existing user found with email: ${normalizedEmail} - will create new user`);
    }

    // Also check if there's already a user linked to this trial class
    let existingLinkedUser = await User.findOne({
      where: { trial_user_id: trialClassId },
      transaction
    });

    let userId;
    const defaultPassword = '12345678';
    const hashedPassword = await securePassword(defaultPassword);

    if (existingLinkedUser && existingLinkedUser.id !== existingUser?.id) {
      // There's already a user linked to this trial class
      console.log(`⚠️ Found existing user ${existingLinkedUser.id} already linked to trial class ${trialClassId}`);
      userId = existingLinkedUser.id;

      // Update password if not set
      if (!existingLinkedUser.password) {
        await existingLinkedUser.update({ password: hashedPassword }, { transaction });
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
              already_linked: true
          }
      });

    } else if (existingUser) {
      // User exists with this email, link to trial class
      userId = existingUser.id;

      const updateData = {
        trial_user_id: trialClassId,
        full_name: existingUser.full_name || trialClassRegistration.student_name,
        mobile: existingUser.mobile || trialClassRegistration.mobile,
        country_code: existingUser.country_code || trialClassRegistration.country_code,
        language: existingUser.language || trialClassRegistration.language || 'EN',
        status: 'active',
        verified: true,
        updated_at: Math.floor(Date.now() / 1000)
      };

      // Set password if not already set
      if (!existingUser.password) {
        updateData.password = hashedPassword;
      }

      await existingUser.update(updateData, { transaction });
      console.log(`👤 Updated existing user ${userId} with trial class reference and password`);

      // Log existing user updated
      paymentLogger.logPaymentVerification({
          student_id: trialClassId,
          student_name: trialClassRegistration.student_name,
          subscription_id: null,
          verification_type: 'existing_user_updated',
          verification_result: true,
          subscription_details: {
              user_id: userId,
              user_email: existingUser.email,
              trial_class_linked: true,
              password_set: !existingUser.password,
              fields_updated: Object.keys(updateData)
          }
      });

    } else {
      // Create new user from trial class registration
      const newUserData = {
        full_name: trialClassRegistration.student_name,
        email: email,
        password: hashedPassword,
        mobile: trialClassRegistration.mobile,
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

      const newUser = await User.create(newUserData, { transaction });
      userId = newUser.id;

      console.log(`👤 Created new user ${userId} from trial class ${trialClassId} with default password`);
      console.log(`📧 New user: ${newUser.full_name} (${newUser.email})`);

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

    // Update trial class status to converted
    const trialUpdateData = {
      status: 'converted',
      trial_class_status: 'new_enroll',
      status_change_notes: `Converted to paid subscription via PayPlus payment. User ID: ${userId}. Transaction: ${transactionUid}. Timestamp: ${new Date().toISOString()}`,
      updated_at: new Date()
    };

    await trialClassRegistration.update(trialUpdateData, { transaction });
    console.log(`✅ Trial class ${trialClassId} marked as converted and linked to user ${userId}`);

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
    console.error(`❌ Error converting trial class ${trialClassRegistration.id} to user:`, error);
    
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
            error_stack: error.stack,
            transaction_uid: transactionUid
        }
    });
    
    throw error;
  }
};

/**
 * Create user from direct payment
 * @param {String} customerEmail - Customer email
 * @param {String} customerName - Customer name  
 * @param {Object} transaction - Database transaction
 * @returns {Number} - Created/updated user ID
 */
const createUserFromDirectPayment = async (customerEmail, customerName, transaction) => {
  try {
    // Convert email: replace hyphens with spaces in the student name part (after +)
    // Payment link uses hyphens (e.g., hatexazuza+troy-morrison@yopmail.com)
    // Database should use spaces (e.g., hatexazuza+troy morrison@yopmail.com)
    let email = customerEmail.trim().toLowerCase();
    
    console.log(`🔍 Direct payment original email: ${customerEmail}`);
    
    if (email && email.includes('+')) {
        const emailParts = email.split('@');
        if (emailParts.length === 2) {
            const [localPart, domain] = emailParts;
            const [baseEmail, studentNamePart] = localPart.split('+');
            
            if (studentNamePart) {
                // Replace hyphens with spaces in the student name part
                const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                email = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                console.log(`📧 Converting direct payment email from payment link format to database format: ${customerEmail} → ${email}`);
            }
        }
    }
    
    console.log(`✅ Final email for user lookup/creation: ${email}`);
    console.log(`🔄 Processing direct payment for email: ${email}`);

    // Log direct payment processing start
    paymentLogger.logPaymentVerification({
        student_id: 'direct_payment',
        student_name: customerName,
        subscription_id: null,
        verification_type: 'direct_payment_processing_start',
        verification_result: true,
        subscription_details: {
            customer_email: email,
            customer_name: customerName,
            payment_type: 'direct_payment'
        }
    });

    // Check if user already exists (case-insensitive, exact match)
    // IMPORTANT: For formatted emails (with +studentname), we must find the EXACT email match
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const isFormattedEmail = normalizedEmail && normalizedEmail.includes('+');
    
    console.log(`🔍 Looking up user by email: ${normalizedEmail}, isFormattedEmail: ${isFormattedEmail}`);
    
    let existingUser = null;
    
    if (normalizedEmail) {
      // Use Sequelize.where with LOWER() for case-insensitive exact match
      existingUser = await User.findOne({
        where: Sequelize.where(
          Sequelize.fn('LOWER', Sequelize.col('email')),
          normalizedEmail
        ),
        transaction
      });
      
      // CRITICAL VALIDATION: For formatted emails, verify the found user has the EXACT same formatted email
      if (existingUser && isFormattedEmail) {
        const foundEmail = existingUser.email ? existingUser.email.trim().toLowerCase() : '';
        if (foundEmail !== normalizedEmail) {
          console.log(`❌ CRITICAL: Found user with DIFFERENT email!`);
          console.log(`   Expected (formatted child email): ${normalizedEmail}`);
          console.log(`   Found (parent/base email): ${foundEmail}`);
          console.log(`   This is a formatted email, so we MUST create a NEW user for the child`);
          console.log(`   Ignoring found user (ID: ${existingUser.id}) and will create new user`);
          existingUser = null; // Clear it - we'll create a new user instead
        } else {
          console.log(`✅ Found existing user with EXACT formatted email match: ${foundEmail}`);
        }
      } else if (existingUser) {
        console.log(`⚠️ Found existing user by email: ID=${existingUser.id}, Email=${existingUser.email}, Name=${existingUser.full_name}`);
      }
    }
    
    if (!existingUser) {
      console.log(`✅ No existing user found with email: ${normalizedEmail} - will create new user`);
    }

    let userId;
    const defaultPassword = '12345678';
    const hashedPassword = await securePassword(defaultPassword);

    if (existingUser) {
      userId = existingUser.id;

      // Update existing user with payment information
      const updateData = {
        full_name: existingUser.full_name || customerName || 'PayPlus Customer',
        status: 'active',
        verified: true,
        updated_at: Math.floor(Date.now() / 1000)
      };

      // Set password if not already set
      if (!existingUser.password) {
        updateData.password = hashedPassword;
      }

      await existingUser.update(updateData, { transaction });

      console.log(`👤 Updated existing user ${userId} for direct payment with password`);

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
              password_set: !existingUser.password,
              status_activated: true,
              payment_type: 'direct_payment'
          }
      });

    } else {
      // Create new user for direct payment
      const newUserData = {
        full_name: customerName || 'PayPlus Customer',
        email: email,
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
        timezone:"Asia/Jerusalem",
        notification_channels: '["email","whatsapp","inapp"]',
        lesson_notifications: '["24","1"]',
        meeting_type: 'online',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      };

      const newUser = await User.create(newUserData, { transaction });
      userId = newUser.id;

      console.log(`👤 Created new user ${userId} from direct payment with default password`);
      console.log(`📧 New user: ${newUser.full_name} (${newUser.email})`);

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
              user_created: true,
              default_password_set: true,
              payment_type: 'direct_payment'
          }
      });
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
            processing_successful: true,
            user_action: existingUser ? 'updated' : 'created'
        }
    });

    return userId;
  } catch (error) {
    console.error(`❌ Error creating user from direct payment:`, error);
    
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
 * Generate a unique transaction ID when one is missing
 * @returns {String} - Unique transaction ID
 */
const generateTransactionId = () => {
  return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
          console.error('Error decoding original_data:', error);
        }
      }

      return params;
    }

    // If it's already in a structured format, return it as is
    return body;
  } catch (error) {
    console.error('Error parsing PayPlus response:', error);
    return body;
  }
};

/**
 * Extract webhook data from new PayPlus format - ENHANCED VERSION
 * @param {Object} webhookBody - PayPlus webhook body
 * @returns {Object} - Extracted data with standard field names
 */
const extractWebhookData = (webhookBody) => {
  try {
    // Handle new nested format
    const data = webhookBody.data || {};
    const transaction = webhookBody.transaction || {};
    const cardInfo = data.card_information || {};
    const customer = data.customer || {};

    // Extract page request UID if available
    const pageRequestUid = webhookBody.page_request_uid ||
      transaction.page_request_uid ||
      data.page_request_uid ||
      null;

    const extractedData = {
      // Transaction details
      transaction_uid: transaction.uid || transaction.transaction_uid || data.transaction_uid || generateTransactionId(),
      transaction_id: transaction.uid || transaction.transaction_id || data.transaction_id,
      page_request_uid: pageRequestUid,
      amount: parseFloat(transaction.amount || data.amount || 0),
      currency_code: transaction.currency || data.currency || 'ILS',
      status_code: transaction.status_code || data.status_code || '',
      transaction_type: webhookBody.transaction_type || transaction.type || data.type || '',
      transaction_date: transaction.date || data.date || new Date().toISOString(),

      // Customer details from data section or customer object
      customer_uid: data.customer_uid || customer.uid || '',
      customer_email: data.customer_email || customer.email || transaction.customer_email || '',
      customer_name: data.customer_name || customer.name || transaction.customer_name || '',
      customer_phone: data.customer_phone || customer.phone || '',

      // Payment details - Enhanced extraction
      payment_method: cardInfo.brand_id ? 'credit_card' : (data.payment_method || transaction.payment_method || 'unknown'),
      four_digits: cardInfo.four_digits || cardInfo.last_four_digits || data.four_digits || '',
      approval_number: transaction.approval_number || data.approval_number || '',
      voucher_number: transaction.voucher_number || data.voucher_number || '',

      // Card information - Enhanced
      card_brand: cardInfo.brand_name || cardInfo.brand || '',
      card_type: cardInfo.type || '',
      card_expiry: cardInfo.expiry_date || '',

      // Additional info fields
      more_info: transaction.more_info || data.more_info || '',
      more_info_1: transaction.more_info_1 || data.more_info_1 || '',
      more_info_2: transaction.more_info_2 || data.more_info_2 || '',
      more_info_3: transaction.more_info_3 || data.more_info_3 || '',
      more_info_4: transaction.more_info_4 || data.more_info_4 || '',
      more_info_5: transaction.more_info_5 || data.more_info_5 || '',

      // Recurring payment details - Enhanced
      recurring_info: {
        recurring_uid: transaction.recurring_charge_information?.recurring_uid ||
          data.recurring_charge_information?.recurring_uid ||
          transaction.recurring_uid ||
          data.recurring_uid ||
          webhookBody.recurring_payment_uid ||
          (webhookBody.original_webhook && webhookBody.original_webhook.recurring_payment_uid),
        charge_uid: transaction.recurring_charge_information?.charge_uid ||
          data.recurring_charge_information?.charge_uid ||
          transaction.charge_uid ||
          data.charge_uid,
        page_request_uid: pageRequestUid,
        recurring_id: (webhookBody.original_webhook && webhookBody.original_webhook.recurring_id),
        ...(transaction.recurring_charge_information || data.recurring_charge_information || {})
      },
      is_recurring: transaction.type === 'recurring' || data.type === 'recurring' || !!(transaction.recurring_charge_information?.recurring_uid) ||!!(data.recurring_charge_information?.recurring_uid) || false,

      // Terminal and cashier info
      terminal_uid: data.terminal_uid || '',
      cashier_uid: data.cashier_uid || '',
      cashier_name: data.cashier_name || '',

      // Items (for detailed transaction info)
      items: data.items || [],

      // Additional webhook metadata
      webhook_id: webhookBody.webhook_id || webhookBody.id || '',
      webhook_type: webhookBody.type || '',
      webhook_timestamp: webhookBody.timestamp || new Date().toISOString(),

      // Store original webhook for reference
      original_webhook: webhookBody,

      // Processing metadata
      processed_at: new Date().toISOString(),
      extracted_fields_count: Object.keys(data).length + Object.keys(transaction).length
    };

    // Log successful webhook data extraction
    paymentLogger.logWebhookEvent({
      event_type: 'webhook_data_extraction',
      transaction_uid: extractedData.transaction_uid,
      status: 'success',
      amount: extractedData.amount,
      currency: extractedData.currency_code,
      customer_email: extractedData.customer_email,
      customer_name: extractedData.customer_name,
      payment_method: extractedData.payment_method,
      processing_result: {
        extraction_successful: true,
        fields_extracted: extractedData.extracted_fields_count,
        has_recurring_info: !!extractedData.recurring_info.recurring_uid,
        page_request_uid: extractedData.page_request_uid
      },
      webhook_payload: {
        size_bytes: JSON.stringify(webhookBody).length,
        keys_count: Object.keys(webhookBody).length,
        has_data: !!webhookBody.data,
        has_transaction: !!webhookBody.transaction
      }
    });

    return extractedData;

  } catch (error) {
    console.error('Error extracting webhook data:', error);
    
    // Log extraction error
    paymentLogger.logWebhookEvent({
      event_type: 'webhook_data_extraction_error',
      transaction_uid: 'extraction_failed',
      status: 'failed',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'extraction_error',
        error_message: error.message,
        error_stack: error.stack
      },
      webhook_payload: webhookBody
    });

    // Return minimal data to prevent complete failure
    return {
      transaction_uid: generateTransactionId(),
      transaction_id: generateTransactionId(),
      page_request_uid: null,
      amount: 0,
      currency_code: 'ILS',
      status_code: '',
      transaction_type: '',
      transaction_date: new Date().toISOString(),
      customer_uid: '',
      customer_email: '',
      customer_name: '',
      customer_phone: '',
      payment_method: 'unknown',
      four_digits: '',
      approval_number: '',
      voucher_number: '',
      card_brand: '',
      card_type: '',
      card_expiry: '',
      more_info: '',
      more_info_1: '',
      more_info_2: '',
      more_info_3: '',
      more_info_4: '',
      more_info_5: '',
      recurring_info: {},
      is_recurring: false,
      terminal_uid: '',
      cashier_uid: '',
      cashier_name: '',
      items: [],
      webhook_id: '',
      webhook_type: '',
      webhook_timestamp: new Date().toISOString(),
      original_webhook: webhookBody,
      processed_at: new Date().toISOString(),
      extracted_fields_count: 0,
      extraction_error: error.message
    };
  }
};

/**
 * Process PayPlus webhook for real-time payment notifications
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processPayPlusWebhook = async (req, res) => {
  let transaction;
  const webhookStartTime = Date.now();

  try {
    console.log('📞 PayPlus Webhook received:', JSON.stringify(req.body, null, 2));

    // Log initial webhook receipt
    const webhookReceiptData = {
      event_type: 'webhook_received',
      transaction_uid: 'pending_extraction',
      status: 'processing',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      webhook_payload: {
        size_bytes: JSON.stringify(req.body).length,
        keys_count: Object.keys(req.body).length,
        has_data: !!req.body.data,
        has_transaction: !!req.body.transaction,
        user_agent: req.headers['user-agent'],
        ip_address: req.ip,
        received_at: new Date().toISOString()
      }
    };

    paymentLogger.logWebhookEvent(webhookReceiptData);

    // Start database transaction
    transaction = await sequelize.transaction();

    // Extract data using new format handler
    const webhookData = extractWebhookData(req.body);

    const {
      transaction_uid,
      transaction_id,
      amount,
      currency_code,
      status_code,
      transaction_type,
      customer_email,
      customer_name,
      payment_method,
      four_digits,
      approval_number,
      voucher_number,
      more_info,
      more_info_1,
      more_info_2,
      more_info_3,
      more_info_4,
      more_info_5,
      recurring_info,
      is_recurring,
      terminal_uid,
      cashier_uid,
      cashier_name
    } = webhookData;

    // Validate transaction UID
    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      console.error('❌ Invalid transaction UID:', transaction_uid);
      
      paymentLogger.logWebhookEvent({
        event_type: 'webhook_validation_failed',
        transaction_uid: transaction_uid || 'null',
        status: 'failed',
        amount: amount,
        currency: currency_code,
        customer_email: customer_email,
        customer_name: customer_name,
        payment_method: payment_method,
        error_details: {
          error_type: 'invalid_transaction_uid',
          error_message: 'Transaction UID is missing or invalid',
          provided_uid: transaction_uid,
          webhook_data_keys: Object.keys(webhookData)
        },
        webhook_payload: req.body
      });

      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Invalid transaction UID'
      });
    }

    // Determine event type based on status code
    let eventType = 'payment_failure';
    if (status_code === '000') {
      eventType = 'payment_success';
    }

    console.log(`📝 Processing webhook event: ${eventType} for transaction: ${transaction_uid}`);

    // Check if webhook already processed
    const existingWebhook = await PayPlusWebhookLog.findOne({
      where: {
        transaction_uid: transaction_uid,
        processed: true
      },
      transaction
    });

    if (existingWebhook) {
      console.log(`⚠️ Webhook for transaction ${transaction_uid} already processed`);
      
      paymentLogger.logWebhookEvent({
        event_type: 'webhook_duplicate',
        transaction_uid: transaction_uid,
        status: 'duplicate',
        amount: amount,
        currency: currency_code,
        customer_email: customer_email,
        customer_name: customer_name,
        payment_method: payment_method,
        error_details: {
          error_type: 'duplicate_webhook',
          error_message: 'Webhook already processed',
          existing_webhook_id: existingWebhook.id,
          original_processed_at: existingWebhook.updated_at
        },
        processing_result: {
          duplicate_prevented: true,
          original_webhook_log_id: existingWebhook.id
        }
      });

      if (transaction) await transaction.commit();
      return res.status(200).json({
        status: 'success',
        message: 'Webhook already processed'
      });
    }

    // Log the webhook first
    const webhookLogData = {
      transaction_uid: transaction_uid,
      page_request_uid: '',
      event_type: eventType,
      status_code: status_code || '',
      status_description: '',
      amount: amount ? parseFloat(amount) : null,
      currency_code: currency_code || 'ILS',
      customer_name: customer_name || '',
      customer_email: customer_email || '',
      customer_phone: '',
      payment_method: payment_method || '',
      four_digits: four_digits || '',
      approval_number: approval_number || '',
      invoice_number: voucher_number || '',
      more_info: more_info || '',
      more_info_1: more_info_1 || '',
      more_info_2: more_info_2 || '',
      more_info_3: more_info_3 || '',
      more_info_4: more_info_4 || '',
      more_info_5: more_info_5 || '',
      is_test: false,
      raw_webhook_data: JSON.stringify(req.body),
      processed: false
    };

    const webhookLog = await PayPlusWebhookLog.create(webhookLogData, { transaction });

    console.log(`📝 Webhook logged with ID: ${webhookLog.id}`);

    // Process the webhook based on event type
    if (eventType === 'payment_success') {
      try {
        const processingStartTime = Date.now();
        
        await processSuccessfulWebhookPayment(webhookData, webhookLog.id, transaction);

        const processingTime = Date.now() - processingStartTime;

        // Mark webhook as processed
        await webhookLog.update({
          processed: true
        }, { transaction });

        // Log successful processing
        paymentLogger.logWebhookEvent({
          event_type: 'payment_success',
          transaction_uid: transaction_uid,
          status: 'success',
          amount: amount,
          currency: currency_code,
          customer_email: customer_email,
          customer_name: customer_name,
          payment_method: payment_method,
          processing_result: {
            webhook_log_id: webhookLog.id,
            processing_time_ms: processingTime,
            total_time_ms: Date.now() - webhookStartTime,
            processed_successfully: true,
            student_id: more_info_1,
            subscription_created: true
          }
        });

        console.log('✅ PayPlus webhook processed successfully');
      } catch (processingError) {
        console.error('❌ Error processing successful payment webhook:', processingError);

        // Mark webhook with processing error but don't fail the webhook response
        await webhookLog.update({
          processing_error: processingError.message,
          processed: false
        }, { transaction });

        // Log processing failure
        paymentLogger.logWebhookEvent({
          event_type: 'payment_success',
          transaction_uid: transaction_uid,
          status: 'processing_failed',
          amount: amount,
          currency: currency_code,
          customer_email: customer_email,
          customer_name: customer_name,
          payment_method: payment_method,
          error_details: {
            error_type: 'processing_error',
            error_message: processingError.message,
            error_stack: processingError.stack,
            webhook_log_id: webhookLog.id
          },
          processing_result: {
            webhook_logged: true,
            payment_processing_failed: true,
            will_retry: true
          }
        });

        // Log the error but continue - we still want to acknowledge the webhook
        console.log('⚠️ Webhook logged but processing failed - PayPlus will retry');
      }
    } else {
      try {
        const processingStartTime = Date.now();
        
        await processFailedWebhookPayment(webhookData, webhookLog.id, transaction);

        const processingTime = Date.now() - processingStartTime;

        // Mark webhook as processed
        await webhookLog.update({
          processed: true
        }, { transaction });

        // Log failed payment processing
        paymentLogger.logWebhookEvent({
          event_type: 'payment_failure',
          transaction_uid: transaction_uid,
          status: 'failed',
          amount: amount,
          currency: currency_code,
          customer_email: customer_email,
          customer_name: customer_name,
          payment_method: payment_method,
          error_details: {
            payment_failure_code: status_code,
            payment_failure_reason: 'Payment failed at processor level'
          },
          processing_result: {
            webhook_log_id: webhookLog.id,
            processing_time_ms: processingTime,
            total_time_ms: Date.now() - webhookStartTime,
            processed_successfully: true,
            student_id: more_info_1,
            failure_recorded: true
          }
        });

        console.log('📝 PayPlus failed payment webhook processed');
      } catch (processingError) {
        console.error('❌ Error processing failed payment webhook:', processingError);

        // Mark webhook with processing error
        await webhookLog.update({
          processing_error: processingError.message,
          processed: false
        }, { transaction });

        // Log processing failure for failed payment
        paymentLogger.logWebhookEvent({
          event_type: 'payment_failure',
          transaction_uid: transaction_uid,
          status: 'processing_failed',
          amount: amount,
          currency: currency_code,
          customer_email: customer_email,
          customer_name: customer_name,
          payment_method: payment_method,
          error_details: {
            error_type: 'processing_error',
            error_message: processingError.message,
            error_stack: processingError.stack,
            webhook_log_id: webhookLog.id,
            original_payment_status: 'failed'
          }
        });
      }
    }

    // Commit the transaction
    await transaction.commit();
    console.log('✅ Database transaction committed successfully');

    const totalProcessingTime = Date.now() - webhookStartTime;

    // Log final webhook completion
    paymentLogger.logWebhookEvent({
      event_type: 'webhook_completed',
      transaction_uid: transaction_uid,
      status: 'completed',
      amount: amount,
      currency: currency_code,
      customer_email: customer_email,
      customer_name: customer_name,
      payment_method: payment_method,
      processing_result: {
        webhook_log_id: webhookLog.id,
        total_processing_time_ms: totalProcessingTime,
        transaction_committed: true,
        response_sent: true
      }
    });

    // Always respond with 200 to acknowledge receipt
    return res.status(200).json({
      status: 'success',
      message: 'Webhook received and processed',
      transaction_uid: transaction_uid
    });

  } catch (error) {
    // Rollback transaction on error
    if (transaction) {
      try {
        await transaction.rollback();
        console.log('🔄 Database transaction rolled back due to error');
      } catch (rollbackError) {
        console.error('❌ Error rolling back transaction:', rollbackError);
      }
    }

    const totalErrorTime = Date.now() - webhookStartTime;

    // Log critical error
    paymentLogger.logWebhookEvent({
      event_type: 'webhook_error',
      transaction_uid: req.body?.transaction?.uid || 'unknown',
      status: 'critical_error',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'critical_system_error',
        error_message: error.message,
        error_stack: error.stack,
        processing_time_ms: totalErrorTime,
        transaction_rolled_back: true
      },
      webhook_payload: req.body
    });

    console.error('❌ Critical error processing PayPlus webhook:', error);

    // Still respond with 200 to prevent PayPlus from retrying indefinitely
    return res.status(200).json({
      status: 'error',
      message: 'Webhook received but processing failed',
      error: error.message
    });
  }
};

/**
 * Process successful payment from webhook - ENHANCED VERSION
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

        console.log(`💰 Processing successful payment: ${transaction_uid}`);

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
        let existingUserId = null;
        let additionalData = {};
        let isNewUser = false;
        let paymentType = 'direct_payment';

        // Enhanced decoding with robust error handling
        console.log(`🔍 Decoding additional data from more_info_5: "${more_info_5}"`);
        if (more_info_5 && more_info_5 !== '' && more_info_5 !== 'undefined' && more_info_5 !== 'null') {
            try {
                // Step 1: URL decode (reverse of encodeURIComponent)
                const urlDecoded = decodeURIComponent(more_info_5);
                console.log('📝 Step 1 - After URL decode:', urlDecoded);

                if (urlDecoded && urlDecoded.length > 0) {
                    // Step 2: Base64 decode (reverse of Buffer.from().toString('base64'))
                    const base64Decoded = Buffer.from(urlDecoded, 'base64').toString('utf8');
                    console.log('📝 Step 2 - After base64 decode:', base64Decoded);

                    if (base64Decoded && base64Decoded.trim().length > 0) {
                        // Step 3: Clean and parse JSON
                        const cleanedJson = base64Decoded.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '');
                        console.log('📝 Step 3 - Cleaned JSON string:', cleanedJson);

                        // Validate JSON structure before parsing
                        if (cleanedJson.startsWith('{') && cleanedJson.endsWith('}')) {
                            additionalData = JSON.parse(cleanedJson);
                            console.log('✅ Successfully parsed additional data:', JSON.stringify(additionalData, null, 2));
                        } else {
                            console.error('❌ Invalid JSON structure');
                            throw new Error('Invalid JSON structure');
                        }
                    }
                }
            } catch (error) {
                console.error('❌ Error decoding additional data:', error.message);
                // Try alternative methods...
                try {
                    const directBase64Decode = Buffer.from(more_info_5, 'base64').toString('utf8').trim();
                    if (directBase64Decode.startsWith('{') && directBase64Decode.endsWith('}')) {
                        additionalData = JSON.parse(directBase64Decode);
                        console.log('✅ Alternative method successful:', JSON.stringify(additionalData, null, 2));
                    }
                } catch (altError) {
                    console.error('❌ All decoding methods failed:', altError.message);
                    additionalData = {};
                }
            }
        }

        // Extract user IDs and payment type from additional data
        trialClassId = additionalData.trail_user_id || additionalData.student_id;
        existingUserId = additionalData.existing_user_id;
        paymentType = additionalData.payment_type || 'direct_payment';

        // Determine which ID to use based on payment type
        if (existingUserId && !isNaN(existingUserId) && existingUserId > 0) {
            studentId = existingUserId;
            paymentType = 'existing_user';
            console.log(`Processing existing user payment for user ID: ${studentId}`);
        } else if (trialClassId && !isNaN(trialClassId) && trialClassId > 0) {
            studentId = trialClassId;
            paymentType = 'trial_class';
            console.log(`Processing trial class payment for trial ID: ${trialClassId}`);
        } else if (!studentId) {
            studentId = trialClassId;
        }

        // 🆕 NEW: Check for previous subscription if more_info fields are null/empty
        let previousSubscription = null;
        if (studentId && (
            !more_info_2 || more_info_2 === 'null' || more_info_2 === '' ||
            !more_info_3 || more_info_3 === 'null' || more_info_3 === '' ||
            !more_info_4 || more_info_4 === 'null' || more_info_4 === ''
        )) {
            console.log(`🔍 Missing more_info data, checking for previous subscription for student ${studentId}`);
            
            // Find the most recent subscription for this user
            previousSubscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: studentId,
                    [Op.or]: [
                        { status: 'active' },
                        { status: 'inactive' }
                    ]
                },
                order: [['created_at', 'DESC']],
                transaction
            });

            if (previousSubscription) {
                console.log(`📋 Found previous subscription:`, {
                    id: previousSubscription.id,
                    type: previousSubscription.type,
                    lesson_min: previousSubscription.lesson_min,
                    weekly_lesson: previousSubscription.weekly_lesson,
                    status: previousSubscription.status
                });

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
                console.log(`⚠️ No previous subscription found for student ${studentId}`);
                
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
            
            console.log(`🔄 Using previous subscription data: ${lessonMinutes}min lessons, ${lessonsPerMonth} lessons/month`);
        } else {
            // Use webhook/additional data
            lessonMinutes = Math.max(15, parseInt(additionalData.lesson_minutes || more_info_2 || 25));
            lessonsPerMonth = Math.max(1, parseInt(additionalData.lessons_per_month || more_info_3 || 4));
            customMonths = Math.max(1, parseInt(additionalData.months || additionalData.custom_months || more_info_4 || 1));
            planId = additionalData.plan_id ? parseInt(additionalData.plan_id) : 1;
            
            console.log(`📊 Using webhook data: ${lessonMinutes}min lessons, ${lessonsPerMonth} lessons/month`);
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

        console.log(`💰 Processing payment with extracted data:`, {
            studentId,
            trialClassId,
            existingUserId,
            paymentType,
            lessonMinutes,
            lessonsPerMonth,
            customMonths,
            isRecurringPayment,
            salespersonId,
            planId,
            durationType,
            amount: parseFloat(amount || 0),
            dataSource: previousSubscription ? 'previous_subscription' : 'webhook_data'
        });

        // Update TrialPaymentLink status to 'paid' ONLY for trial class payments
        let updatedTrialPaymentLink = null;
        if (paymentType === 'trial_class') {
            updatedTrialPaymentLink = await updateTrialPaymentLinkStatus(
                page_request_uid || transaction_uid,
                'paid',
                transaction_uid,
                studentId,
                transaction
            );
        }

        // Step 1: Handle trial class registration conversion or direct payment user creation
        let trialClassRegistration = null;
        let userDetails = null;
        let previousTrialStatus = null;

        if (paymentType === 'existing_user' && existingUserId) {
            // NEW: Handle existing user payments - NO trial class logic
            console.log(`Processing existing user payment for user ID: ${existingUserId}`);

            userDetails = await User.findByPk(existingUserId, {
                attributes: ['id', 'full_name', 'email', 'language', 'password'],
                transaction
            });

            if (!userDetails) {
                const errorMessage = `Existing user with ID ${existingUserId} not found`;
                
                paymentLogger.logPaymentVerification({
                    student_id: existingUserId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'existing_user_lookup',
                    verification_result: false,
                    error_details: {
                        message: errorMessage,
                        existing_user_id: existingUserId
                    }
                });
                
                throw new Error(errorMessage);
            }

            console.log(`Found existing user: ${userDetails.full_name} (${userDetails.email})`);

            paymentLogger.logPaymentVerification({
                student_id: existingUserId,
                student_name: userDetails.full_name,
                subscription_id: null,
                verification_type: 'existing_user_payment_processing',
                verification_result: true,
                subscription_details: {
                    user_id: existingUserId,
                    user_email: userDetails.email,
                    payment_type: 'existing_user',
                    skip_trial_logic: true
                }
            });

        } else if (paymentType === 'trial_class' && trialClassId && !isNaN(trialClassId) && trialClassId > 0) {
            // Handle trial class registration conversion (existing logic)
            console.log(`Processing trial class conversion for ID: ${trialClassId}`);

            trialClassRegistration = await TrialClassRegistration.findByPk(trialClassId, {
                transaction,
                attributes: [
                    'id', 'student_name', 'parent_name', 'email', 'mobile', 'country_code',
                    'age', 'language', 'status', 'trial_class_status', 'teacher_id', 'booked_by'
                ]
            });

            if (trialClassRegistration) {
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
                
                console.log(`📋 Found trial class: ${trialClassRegistration.student_name} (${trialClassRegistration.email})`);
                
                previousTrialStatus = trialClassRegistration.trial_class_status;

                // Validate trial class registration email
                // if (!trialClassRegistration.email || trialClassRegistration.email.trim() === '') {
                //     throw new Error(`Trial class registration ${trialClassId} has no email address`);
                // }

                if(trialClassRegistration.email){
                  // Check if this will create a new user

                  let lookupEmail = trialClassRegistration.email.trim().toLowerCase();
                  if (lookupEmail && lookupEmail.includes('+')) {
                      const emailParts = lookupEmail.split('@');
                      if (emailParts.length === 2) {
                          const [localPart, domain] = emailParts;
                          const [baseEmail, studentNamePart] = localPart.split('+');
                          if (studentNamePart) {
                              const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                              lookupEmail = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                          }
                      }
                  }
                  
                  const existingUser = await User.findOne({
                      where: Sequelize.where(
                          Sequelize.fn('LOWER', Sequelize.col('email')),
                          lookupEmail
                      ),
                      transaction
                  });
  
                  if (!existingUser) {
                      isNewUser = true;
                  }
                }

                // Convert trial class to user account
                studentId = await convertTrialClassToUser(trialClassRegistration, transaction_uid, transaction);

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

                console.log(`📋 Updated trial class ${trialClassId} status: ${previousTrialStatus} → ${newTrialStatus}`);
                console.log(`🎉 Successfully converted trial class ${trialClassId} to user ${studentId}`);
            } else {
                console.log(`⚠️ Trial class registration with ID ${trialClassId} not found`);
                
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

        // If we don't have a student ID yet and have customer email, create/find user from direct payment
        if (!studentId && customer_email && customer_email !== '') {
            // Validate email format before proceeding
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(customer_email)) {
                throw new Error(`Invalid email format: ${customer_email}`);
            }

            // Check if this will create a new user
            const existingUser = await User.findOne({
                where: { email: customer_email.trim().toLowerCase() },
                transaction
            });

            if (!existingUser) {
                isNewUser = true;
            }

            studentId = await createUserFromDirectPayment(customer_email, customer_name, transaction);
            
            paymentLogger.logPaymentVerification({
                student_id: studentId,
                student_name: customer_name || 'unknown',
                subscription_id: null,
                verification_type: 'direct_payment_user_creation',
                verification_result: true,
                subscription_details: {
                    created_from_direct_payment: true,
                    is_new_user: isNewUser,
                    customer_email: customer_email
                }
            });
        }

        // Final validation that we have a valid student ID
        if (!studentId || isNaN(studentId) || studentId <= 0) {
            const errorMessage = `Unable to determine or create valid student ID. Current value: ${studentId}`;
            
            paymentLogger.logPaymentVerification({
                student_id: studentId || 'invalid',
                student_name: customer_name || 'unknown',
                subscription_id: null,
                verification_type: 'student_id_validation',
                verification_result: false,
                error_details: {
                    message: errorMessage,
                    provided_student_id: studentId,
                    more_info_1: more_info_1,
                    trial_class_id: trialClassId,
                    existing_user_id: existingUserId,
                    customer_email: customer_email,
                    payment_type: paymentType
                }
            });
            
            throw new Error(errorMessage);
        }

        console.log(`💰 Proceeding with payment processing for valid student ID: ${studentId}`);

        // Get user details for email sending (if not already set for existing users)
        if (!userDetails) {
            userDetails = await User.findByPk(studentId, {
                attributes: ['id', 'full_name', 'email', 'language', 'password'],
                transaction
            });

            if (!userDetails) {
                const errorMessage = `User with ID ${studentId} not found after creation/update`;
                
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'user_details_validation',
                    verification_result: false,
                    error_details: {
                        message: errorMessage,
                        student_id: studentId
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
            console.log(`🔑 Set default password for user ${studentId}`);
        }

        // Step 2: Create or update payment transaction record
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
            console.log(`⚠️ Payment transaction ${transaction_uid} already processed successfully`);
            
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
            data_source: previousSubscription ? 'previous_subscription' : 'webhook_data',
            payment_type: paymentType
        };

        if (paymentTransaction) {
            // Update existing transaction
            await paymentTransaction.update(transactionData, { transaction });
            console.log(`📝 Updated existing payment transaction ${paymentTransaction.id}`);
        } else {
            // Create new transaction record
            paymentTransaction = await PaymentTransaction.create({
                token: transaction_uid,
                transaction_id: transaction_uid,
                ...transactionData
            }, { transaction });
            console.log(`📝 Created new payment transaction ${paymentTransaction.id}`);
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

        // Step 2.5: Auto-resolve past due payments for this user if payment is successful
        if (studentId && paymentTransaction && paymentTransaction.status === 'success') {
            try {
                // Find all past_due payments for this user
                const pastDuePayments = await PastDuePayment.findAll({
                    where: {
                        user_id: studentId,
                        status: 'past_due'
                    },
                    include: [
                        {
                            model: UserSubscriptionDetails,
                            as: 'Subscription',
                            attributes: ['id', 'type', 'status'],
                            required: false
                        }
                    ],
                    transaction
                });

                if (pastDuePayments && pastDuePayments.length > 0) {
                    console.log(`🔄 Found ${pastDuePayments.length} past due payment(s) for user ${studentId} - auto-resolving...`);

                    for (const pastDuePayment of pastDuePayments) {
                        try {
                            // Mark payment as resolved
                            await pastDuePayment.update({
                                status: 'resolved',
                                resolved_at: new Date(),
                                resolved_transaction_id: transaction_uid,
                                resolved_payment_method: 'payplus_auto_resolve',
                                notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Auto-resolved: Successful payment transaction ${transaction_uid} (${amount} ${currency_code}) received via webhook callback. Original failure: ${moment(pastDuePayment.failed_at).format('YYYY-MM-DD HH:mm:ss')}`
                            }, { transaction });

                            // Restore subscription to active if needed
                            if (pastDuePayment.Subscription && pastDuePayment.Subscription.status === 'past_due') {
                                await pastDuePayment.Subscription.update({
                                    status: 'active'
                                }, { transaction });
                            }

                            // Disable dunning schedule
                            await DunningSchedule.update({
                                is_enabled: false,
                                next_reminder_at: null
                            }, {
                                where: { past_due_payment_id: pastDuePayment.id },
                                transaction
                            });

                            // Log the auto-resolution
                            paymentLogger.logPaymentVerification({
                                student_id: studentId,
                                student_name: customer_name || userDetails?.full_name || 'unknown',
                                subscription_id: pastDuePayment.subscription_id,
                                verification_type: 'auto_resolve_past_due_on_payment_success',
                                verification_result: true,
                                subscription_details: {
                                    past_due_payment_id: pastDuePayment.id,
                                    resolved_transaction_id: transaction_uid,
                                    transaction_amount: amount,
                                    transaction_currency: currency_code,
                                    resolved_by: 'webhook_callback_auto_resolve',
                                    days_after_failure: moment().diff(moment(pastDuePayment.failed_at), 'days')
                                }
                            });

                            console.log(`✅ Auto-resolved past due payment ${pastDuePayment.id} for user ${studentId} based on successful transaction ${transaction_uid}`);
                        } catch (resolveError) {
                            console.error(`❌ Error auto-resolving past due payment ${pastDuePayment.id}:`, resolveError);
                            // Don't throw - continue processing other payments
                        }
                    }
                }
            } catch (autoResolveError) {
                console.error(`❌ Error in auto-resolve past due payments for user ${studentId}:`, autoResolveError);
                // Don't throw - continue with payment processing even if auto-resolve fails
            }
        }

        // Step 3: Create or update subscription WITH USER TABLE UPDATES
        if (studentId && studentId > 0) {
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
                        student_id: studentId
                    }
                });
                
                throw new Error(errorMessage);
            }

            console.log(`📋 Verified user exists: ${userExists.email} (ID: ${studentId})`);

            // Create or update subscription
            const subscriptionResult = await createOrUpdateSubscription(
                studentId,
                lessonsPerMonth,
                lessonMinutes,
                customMonths,
                parseFloat(amount || 0),
                isRecurringPayment,
                previousSubscription, // Pass previous subscription for reference
                paymentTransaction,
                transaction
            );

            console.log(`📋 Subscription processing result:`, subscriptionResult);

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
                    previous_subscription_used: subscriptionResult.previous_subscription_used,
                    payment_type: paymentType
                }
            });
        }

        // Step 4: Log to recurring payments
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

        // Step 5: Send welcome email with credentials
        if (needsPasswordEmail && userDetails && userDetails.email) {
            try {
                console.log(`📧 Sending welcome email to ${userDetails.email}`);

                const welcomeTemplate = 'student_welcome';

                const emailParams = {
                    user_name: userDetails.full_name || customer_name || 'New Student',
                    email: userDetails.email,
                    password: '12345678',
                    login_url: 'https://tulkka.com/login',
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
                    console.log(`✅ Welcome email sent successfully to ${userDetails.email}`);
                } else {
                    console.error(`❌ Failed to send welcome email to ${userDetails.email}`);
                }

            } catch (emailError) {
                console.error('❌ Error sending welcome email:', emailError);
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
                trial_status_updated: paymentType === 'trial_class' && !!trialClassRegistration,
                welcome_email_sent: needsPasswordEmail,
                payment_type: paymentType
            },
            payment_history: {
                transaction_uid: transaction_uid,
                amount: parseFloat(amount || 0),
                currency: currency_code,
                payment_method: payment_method,
                is_recurring: isRecurringPayment
            }
        });

        console.log(`✅ Successfully processed payment webhook for transaction ${transaction_uid}`);

        // Log summary of actions taken
        console.log(`📊 Payment processing summary:`, {
            transactionId: transaction_uid,
            studentId: studentId,
            trialClassId: trialClassId,
            existingUserId: existingUserId,
            paymentType: paymentType,
            isNewUser: isNewUser,
            emailSent: needsPasswordEmail,
            subscriptionCreated: true,
            userTableUpdated: true,
            trialStatusUpdated: paymentType === 'trial_class' && !!trialClassRegistration,
            trialPaymentLinkUpdated: !!updatedTrialPaymentLink,
            previousTrialStatus: previousTrialStatus,
            newTrialStatus: trialClassRegistration ? 'new_enroll' : null,
            amount: parseFloat(amount || 0),
            currency: currency_code,
            dataSource: previousSubscription ? 'previous_subscription' : 'webhook_data',
            lessonMinutes: lessonMinutes,
            lessonsPerMonth: lessonsPerMonth,
            previousSubscriptionFound: !!previousSubscription
        });

    } catch (error) {
        console.error('❌ Error in processSuccessfulWebhookPayment:', error);
        
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
 * Get user details by email from webhook data
 * @param {String} customerEmail - Customer email from webhook
 * @param {Object} transaction - Database transaction
 * @returns {Object} - User details with subscription info
 */
const getUserDetailsByEmail = async (customerEmail, transaction = null) => {
    try {
        if (!customerEmail || customerEmail.trim() === '') {
            return {
                success: false,
                error: 'Customer email is required',
                user: null
            };
        }

        const email = customerEmail.trim().toLowerCase();
        console.log(`Searching for user with email: ${email}`);

        // Find user by email with related data
        const user = await User.findOne({
            where: { email: email },
            attributes: [
                'id', 'full_name', 'email', 'mobile', 'country_code',
                'status', 'verified', 'trial_user_id', 'subscription_id',
                'subscription_type', 'language', 'timezone', 'created_at'
            ],
            transaction
        });

        if (!user) {
            console.log(`No user found with email: ${email}`);
            return {
                success: false,
                error: 'User not found',
                user: null
            };
        }

        console.log(`Found user: ${user.full_name} (ID: ${user.id})`);

        // Get active subscription details
        const activeSubscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: user.id,
                status: 'active',
                is_cancel: 0
            },
            order: [['created_at', 'DESC']],
            transaction
        });

        // Get trial class registration if linked
        let trialClassRegistration = null;
        if (user.trial_user_id) {
            trialClassRegistration = await TrialClassRegistration.findByPk(user.trial_user_id, {
                attributes: [
                    'id', 'student_name', 'parent_name', 'age', 'status',
                    'trial_class_status', 'meeting_start', 'meeting_end'
                ],
                transaction
            });
        }

        // Get recent payment history
        const recentPayments = await PaymentTransaction.findAll({
            where: { student_id: user.id },
            order: [['created_at', 'DESC']],
            limit: 5,
            transaction
        });

        // Get active recurring payments
        const activeRecurringPayments = await RecurringPayment.findAll({
            where: {
                student_id: user.id,
                status: { [Op.in]: ['active', 'paid'] },
                is_active: true
            },
            order: [['created_at', 'DESC']],
            transaction
        });

        return {
            success: true,
            error: null,
            user: {
                ...user.toJSON(),
                subscription: activeSubscription ? activeSubscription.toJSON() : null,
                trialClass: trialClassRegistration ? trialClassRegistration.toJSON() : null,
                recentPayments: recentPayments || [],
                activeRecurringPayments: activeRecurringPayments || []
            }
        };

    } catch (error) {
        console.error('Error getting user details by email:', error);
        return {
            success: false,
            error: error.message,
            user: null
        };
    }
};

/**
 * Enhanced processFailedWebhookPayment with email-based user lookup
 * @param {Object} webhookData - Extracted PayPlus webhook data
 * @param {Number} webhookLogId - ID of the webhook log entry
 * @param {Object} transaction - Database transaction
 */
const processFailedWebhookPayment = async (webhookData, webhookLogId, transaction) => {
    try {
        const {
            transaction_uid,
            page_request_uid,
            amount,
            currency_code,
            customer_email,
            customer_name,
            payment_method,
            four_digits,
            status_code,
            more_info_1,
            more_info_2,
            more_info_3,
            more_info_4,
            is_recurring,
            recurring_info
        } = webhookData;

        const statusDescription = `Payment failed with status code: ${status_code}`;
        let studentId = more_info_1 ? parseInt(more_info_1) : null;
        let userDetails = null;

        console.log(`Processing failed payment: ${transaction_uid}, Recurring: ${is_recurring}, Error: ${statusDescription}`);

        // NEW: If studentId is null but customer_email exists, try to find user by email
        if ((!studentId || isNaN(studentId)) && customer_email) {
            // Convert email from PayPlus format (hyphens) to database format (spaces) for formatted emails
            let normalizedEmail = customer_email.trim().toLowerCase();
            if (normalizedEmail && normalizedEmail.includes('+')) {
                const emailParts = normalizedEmail.split('@');
                if (emailParts.length === 2) {
                    const [localPart, domain] = emailParts;
                    const [baseEmail, studentNamePart] = localPart.split('+');
                    
                    if (baseEmail && studentNamePart) {
                        // Replace hyphens with spaces in the student name part (database format)
                        const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                        normalizedEmail = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                        console.log(`📧 Converting failed payment email from PayPlus format to database format: ${customer_email} → ${normalizedEmail}`);
                    }
                }
            }
            
            console.log(`Student ID not available (${more_info_1}), attempting to find user by email: ${normalizedEmail}`);
            
            const emailLookupResult = await getUserDetailsByEmail(normalizedEmail, transaction);
            
            if (emailLookupResult.success && emailLookupResult.user) {
                studentId = emailLookupResult.user.id;
                userDetails = emailLookupResult.user;
                
                console.log(`Found user by email: ${userDetails.full_name} (ID: ${studentId})`);
                
                // Log successful email lookup
                paymentLogger.logPaymentVerification({
                    student_id: studentId,
                    student_name: userDetails.full_name,
                    subscription_id: userDetails.subscription?.id || null,
                    verification_type: 'user_lookup_by_email_success',
                    verification_result: true,
                    subscription_details: {
                        customer_email: customer_email,
                        user_found: true,
                        has_active_subscription: !!userDetails.subscription,
                        has_trial_class: !!userDetails.trialClass
                    }
                });
            } else {
                console.log(`No user found with email: ${customer_email}`);
                
                // Log failed email lookup
                paymentLogger.logPaymentVerification({
                    student_id: 'unknown',
                    student_name: customer_name || 'unknown',
                    subscription_id: null,
                    verification_type: 'user_lookup_by_email_failed',
                    verification_result: false,
                    error_details: {
                        customer_email: customer_email,
                        lookup_error: emailLookupResult.error || 'User not found',
                        more_info_1_was_null: !more_info_1
                    }
                });
            }
        }

        // Log failed payment processing start
        paymentLogger.logPaymentVerification({
            student_id: studentId || 'unknown',
            student_name: userDetails?.full_name || customer_name || 'unknown',
            subscription_id: userDetails?.subscription?.id || null,
            verification_type: 'failed_payment_processing',
            verification_result: false,
            error_details: {
                transaction_uid: transaction_uid,
                failure_reason: statusDescription,
                status_code: status_code,
                amount: amount,
                currency: currency_code,
                user_found_by_email: !!userDetails
            }
        });

        // Update TrialPaymentLink status to 'failed'
        const updatedTrialPaymentLink = await updateTrialPaymentLinkStatus(
            page_request_uid || transaction_uid,
            'failed',
            transaction_uid,
            studentId,
            transaction
        );

        // Update trial class status if student ID exists
        if (studentId && !isNaN(studentId) && studentId > 0) {
            try {
                const trialClassRegistration = await TrialClassRegistration.findByPk(studentId, {
                    transaction,
                    attributes: ['id', 'trial_class_status', 'status_change_notes', 'student_name', 'email']
                });

                if (trialClassRegistration) {
                    const previousStatus = trialClassRegistration.trial_class_status;
                    const newStatus = 'waiting_for_payment';
                    
                    await trialClassRegistration.update({
                        trial_class_status: newStatus,
                        status_change_notes: `Payment failed. Transaction: ${transaction_uid}. Error: ${statusDescription}. Amount: ${amount} ${currency_code}. TrialPaymentLink ID: ${updatedTrialPaymentLink?.id || 'N/A'}. Timestamp: ${new Date().toISOString()}`
                    }, { transaction });

                    // Log the status change
                    await logTrialClassStatusChange(
                        studentId,
                        previousStatus,
                        newStatus,
                        1, // System user
                        'system',
                        `Payment failed. Transaction: ${transaction_uid}. Error: ${statusDescription}. Amount: ${amount} ${currency_code}`,
                        transaction
                    );

                    console.log(`Updated trial class ${studentId} status due to failed payment: ${previousStatus} -> ${newStatus}`);
                }
            } catch (trialUpdateError) {
                console.error('Error updating trial class status for failed payment:', trialUpdateError);
            }
        }

        // Handle recurring payment failures - DUNNING SYSTEM INTEGRATION
        if (is_recurring && studentId) {
          console.log(`[DUNNING] Detected failed recurring payment for user ${studentId}`);
          try {
            await handleRecurringPaymentFailure({
              user_id: studentId,
              transaction_uid: transaction_uid,
              amount: parseFloat(amount || 0),
              currency: currency_code || 'ILS',
              failed_at: new Date(),
              status_code: status_code,
              status_description: statusDescription,
              recurring_info: recurring_info,
              page_request_uid: page_request_uid,
              webhookData: webhookData // NEW: Pass the full webhook data for error extraction
            }, transaction);

            console.log(`[DUNNING] Dunning process initiated for user ${studentId}`);
          } catch (dunningError) {
            console.error(`[DUNNING] Error initiating dunning process for user ${studentId}:`, dunningError);
          }
        }

        // Check if we already have a transaction record for this
        let paymentTransaction = await PaymentTransaction.findOne({
            where: {
                [Op.or]: [
                    { transaction_id: transaction_uid },
                    { token: transaction_uid }
                ]
            },
            transaction
        });

        // Extract lesson details from more_info fields, user subscription, or use defaults
        let lessonMinutes = 0;
        let lessonsPerMonth = 0;
        let customMonths = 0;

        // Priority 1: From more_info fields
        if (more_info_2 && !isNaN(more_info_2)) {
            lessonMinutes = parseInt(more_info_2);
        }
        if (more_info_3 && !isNaN(more_info_3)) {
            lessonsPerMonth = parseInt(more_info_3);
        }
        if (more_info_4 && !isNaN(more_info_4)) {
            customMonths = parseInt(more_info_4);
        }

        // Priority 2: From user's active subscription if found by email
        if (userDetails?.subscription && (lessonMinutes === 0 || lessonsPerMonth === 0)) {
            lessonMinutes = lessonMinutes || userDetails.subscription.lesson_min || 0;
            lessonsPerMonth = lessonsPerMonth || userDetails.subscription.weekly_lesson || 0;
            customMonths = customMonths || 1; // Default for recurring
            
            console.log(`Using subscription data: ${lessonMinutes}min, ${lessonsPerMonth} lessons/month`);
        }

        const transactionData = {
            status: 'failed',
            student_id: studentId,
            student_email: customer_email || userDetails?.email || 'unknown@example.com',
            student_name: customer_name || userDetails?.full_name || 'Unknown Customer',
            amount: amount ? parseFloat(amount) : 0,
            currency: currency_code || 'ILS',
            payment_method: payment_method || 'unknown',
            card_last_digits: four_digits ? four_digits.slice(-4) : null,
            error_code: status_code,
            error_message: statusDescription,
            payment_processor: 'payplus',
            response_data: JSON.stringify(webhookData.original_webhook),
            trial_payment_link_id: updatedTrialPaymentLink?.id || null,
            is_recurring: is_recurring || false,
            lesson_minutes: lessonMinutes,
            lessons_per_month: lessonsPerMonth,
            custom_months: customMonths
        };

        if (paymentTransaction) {
            // Update existing transaction
            await paymentTransaction.update(transactionData, { transaction });
            console.log(`Updated existing failed transaction ${paymentTransaction.id}`);
        } else {
            // Create new failed transaction record
            paymentTransaction = await PaymentTransaction.create({
                token: transaction_uid,
                transaction_id: transaction_uid,
                ...transactionData
            }, { transaction });
            console.log(`Created new failed transaction ${paymentTransaction.id}`);
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

        // Log failed payment transaction creation
        paymentLogger.logPaymentVerification({
            student_id: studentId || 'unknown',
            student_name: userDetails?.full_name || customer_name || 'unknown',
            subscription_id: userDetails?.subscription?.id || null,
            verification_type: 'failed_payment_transaction_recorded',
            verification_result: true,
            subscription_details: {
                payment_transaction_id: paymentTransaction.id,
                transaction_uid: transaction_uid,
                failure_recorded: true,
                error_code: status_code,
                error_message: statusDescription,
                user_found_by_email: !!userDetails,
                dunning_initiated: is_recurring && studentId,
                trial_payment_link_updated: !!updatedTrialPaymentLink,
                trial_status_updated: !!studentId,
                lesson_details: {
                    lesson_minutes: lessonMinutes,
                    lessons_per_month: lessonsPerMonth,
                    custom_months: customMonths,
                    data_source: userDetails?.subscription ? 'user_subscription' : 'webhook_or_default'
                }
            }
        });

        console.log(`Failed payment recorded for transaction ${transaction_uid} with email-based user lookup`);
        
        // NEW: Auto-cancel recurring after 30 days since first failure
        try {
            if (studentId) {
                let recurringUid = null;

                // Try to extract recurring_uid from incoming webhook (various likely paths)
                try {
                    const parsed = webhookData.original_webhook
                        ? (typeof webhookData.original_webhook === 'string' ? JSON.parse(webhookData.original_webhook) : webhookData.original_webhook)
                        : (webhookData || {});

                    recurringUid = parsed?.recurring_uid
                        || parsed?.original_webhook?.recurring_uid
                        || parsed?.recurring_info?.recurring_uid
                        || recurring_info?.recurring_uid
                        || null;
                } catch (err) {
                    console.warn('[AUTO-CANCEL] Could not parse original_webhook to get recurring_uid:', err?.message);
                }

                // Build filters: if recurringUid exists, scope by it. Otherwise fall back to studentId.
                const baseWhereSuccess = {
                    is_recurring: true,
                    status: 'success'
                };
                const baseWhereFailed = {
                    is_recurring: true,
                    status: 'failed'
                };

                if (recurringUid) {
                    // We assume stored response_data contains recurring_uid too — queries will use JSON_EXTRACT via Sequelize literal
                    baseWhereSuccess.response_data = { [Op.like]: `%${recurringUid}%` }; // pragmatic string-match
                    baseWhereFailed.response_data = { [Op.like]: `%${recurringUid}%` };
                } else {
                    baseWhereSuccess.student_id = studentId;
                    baseWhereFailed.student_id = studentId;
                }

                // 1) find last success (if any)
                const lastSuccess = await PaymentTransaction.findOne({
                    where: baseWhereSuccess,
                    attributes: ['created_at'],
                    order: [['created_at', 'DESC']],
                    transaction
                });

                // 2) find earliest failed after that last success (anchor)
                const failWhere = { ...baseWhereFailed };
                if (lastSuccess?.created_at) {
                    failWhere.created_at = { [Op.gt]: lastSuccess.created_at };
                }

                const firstFail = await PaymentTransaction.findOne({
                    where: failWhere,
                    // attributes: ['created_at', 'response_data', 'transaction_id', 'id'],
                    order: [['created_at', 'ASC']],
                    transaction
                });

                if (firstFail) {
                    const firstFailedAt = new Date(firstFail.created_at); // assume UTC
                    const now = new Date();
                    const msPerDay = 24 * 3600 * 1000;
                    const daysDiff = Math.floor((now - firstFailedAt) / msPerDay); // calendar days difference

                    console.log(`[AUTO-CANCEL] User ${studentId} first failed at ${firstFailedAt.toISOString()} (${daysDiff} days ago)`);

                    if (daysDiff > 29) {
                        // Attempt cancellation (this will try remote cancel if recurring_uid/terminal present)
                        await cancelRecurringPaymentsForUser(
                            studentId,
                            `Auto-cancel: first failed at ${firstFailedAt.toISOString()} (${daysDiff} days since)`,
                            transaction
                        );
                        console.log(`[AUTO-CANCEL] Cancelled recurring for user ${studentId} after ${daysDiff} days since first failure`);
                    }
                }
            }
        } catch (autoCancelErr) {
            console.error(`[AUTO-CANCEL] Error while checking/cancelling recurring for user ${studentId}:`, autoCancelErr);
        }
        // Log summary of actions taken for failed payment
        console.log(`Failed payment processing summary:`, {
            transactionId: transaction_uid,
            studentId: studentId,
            customerEmail: customer_email,
            userFoundByEmail: !!userDetails,
            errorCode: status_code,
            errorMessage: statusDescription,
            isRecurring: is_recurring,
            dunningInitiated: is_recurring && studentId,
            trialPaymentLinkUpdated: !!updatedTrialPaymentLink,
            trialStatusUpdated: !!studentId,
            amount: parseFloat(amount || 0),
            currency: currency_code,
            lessonDetails: {
                lesson_minutes: lessonMinutes,
                lessons_per_month: lessonsPerMonth,
                custom_months: customMonths,
                dataSource: userDetails?.subscription ? 'user_subscription' : 'webhook_or_default'
            }
        });
        
    } catch (error) {
        console.error('Error in processFailedWebhookPayment:', error);
        
        // Log failed payment processing error
        paymentLogger.logPaymentVerification({
            student_id: webhookData.more_info_1 || 'unknown',
            student_name: webhookData.customer_name || 'unknown',
            subscription_id: null,
            verification_type: 'failed_payment_processing_error',
            verification_result: false,
            error_details: {
                error_type: 'failed_payment_processing_exception',
                error_message: error.message,
                error_stack: error.stack,
                transaction_uid: webhookData.transaction_uid
            }
        });
        
        throw error;
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
    console.error('Error determining subscription type:', error);
    return `Monthly_${lessonMinutes || 30}`;
  }
};

/**
 * Create or update user subscription
 */
const createOrUpdateSubscription = async (studentId, lessonsPerMonth, lessonMinutes, months, amount, isRecurring, previousSubscription, paymentTransaction, transaction) => {
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

    console.log(`📋 Creating/updating subscription for user ${studentId} (${user.email})`);

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
            has_previous_subscription: !!previousSubscription
        }
    });

    // Variables to store subscription configuration - INITIALIZE WITH DEFAULTS
    let finalSubscriptionType = null;
    let finalLessonsPerMonth = parseInt(lessonsPerMonth);
    let finalLessonMinutes = parseInt(lessonMinutes);
    let preservedFromExisting = false;

    const existingActiveSubscriptions = await UserSubscriptionDetails.findAll({
      where: { 
        user_id: studentId,
        status: { [Op.in]: ['active', 'inactive'] },
        // is_cancel: 0
      },
      order: [['created_at', 'DESC']],
      transaction
    });

    // If there's an existing active subscription, use its configuration
    if (existingActiveSubscriptions.length > 0) {
      const mostRecentSubscription = existingActiveSubscriptions[0];
      finalSubscriptionType = mostRecentSubscription.type || determineSubscriptionType(months, finalLessonMinutes);
      finalLessonsPerMonth = parseInt(mostRecentSubscription.weekly_lesson) || finalLessonsPerMonth;
      finalLessonMinutes = parseInt(mostRecentSubscription.lesson_min) || finalLessonMinutes;
      preservedFromExisting = true;

      // Log existing subscription found
      paymentLogger.logPaymentVerification({
          student_id: studentId,
          student_name: user.full_name || 'unknown',
          subscription_id: mostRecentSubscription.id,
          verification_type: 'existing_active_subscription_found',
          verification_result: true,
          subscription_details: {
              existing_subscription_id: mostRecentSubscription.id,
              existing_type: mostRecentSubscription.type,
              existing_lessons_per_month: mostRecentSubscription.weekly_lesson,
              existing_lesson_minutes: mostRecentSubscription.lesson_min,
              configuration_preserved: true
          }
      });

      for (const existingSubscription of existingActiveSubscriptions) {
        await existingSubscription.update({
          status: 'inactive',
          is_cancel: 1,
          updated_at: new Date(),
        }, { transaction });

        console.log(`📋 Deactivated existing subscription ${existingSubscription.id} for user ${studentId}`);
      }
    } else {
      // No existing subscription, use provided parameters
      finalSubscriptionType = determineSubscriptionType(months, finalLessonMinutes);
      
      // Log no existing subscription found
      paymentLogger.logPaymentVerification({
          student_id: studentId,
          student_name: user.full_name || 'unknown',
          subscription_id: null,
          verification_type: 'no_existing_subscription_found',
          verification_result: true,
          subscription_details: {
              using_webhook_parameters: true,
              calculated_subscription_type: finalSubscriptionType
          }
      });
    }

    if (!finalSubscriptionType) {
      finalSubscriptionType = determineSubscriptionType(months, finalLessonMinutes);
    }


    // Calculate renewal date
    const renewDate = moment().add(months, 'months').toDate();

    // Calculate total lessons including potential carry-over from previous online subscription
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

    // Calculate cost per lesson
    const costPerLesson = totalLessons > 0 ? amount / totalLessons : 0;

    // *** MODIFIED: Since we deactivated all existing subscriptions, we'll always create a new one ***
    const subscriptionData = {
      type: finalSubscriptionType, // Use preserved type or calculated type
      each_lesson: finalLessonMinutes.toString(), // Use preserved lesson duration
      renew_date: renewDate,
      how_often: `${finalLessonsPerMonth} lessons per month`, // Use preserved lessons per month
      weekly_lesson: finalLessonsPerMonth, // Use preserved monthly classes
      status: 'active',
      lesson_min: finalLessonMinutes, // Use preserved lesson minutes
      left_lessons: totalLessons, // Calculate based on preserved monthly lessons plus any carry-over, minus future booked classes
      lesson_reset_at: moment().add(1, 'month').toDate(),
      cost_per_lesson: parseFloat(costPerLesson.toFixed(2)),
      is_cancel: 0,
      plan_id: previousSubscription?.plan_id || (existingActiveSubscriptions.length > 0 ? existingActiveSubscriptions[0].plan_id : 1),
      payment_status: 'online',
      weekly_comp_class: previousSubscription?.weekly_comp_class || (existingActiveSubscriptions.length > 0 ? existingActiveSubscriptions[0].weekly_comp_class : 0),
      bonus_class: previousSubscription?.bonus_class || (existingActiveSubscriptions.length > 0 ? existingActiveSubscriptions[0].bonus_class : 0),
      bonus_completed_class: 0, // Reset for new period
      bonus_expire_date: previousSubscription?.bonus_expire_date || (existingActiveSubscriptions.length > 0 ? existingActiveSubscriptions[0].bonus_expire_date : null),
      notes: `Created on ${new Date().toISOString()} from payment processing${preservedFromExisting ? ' (configuration preserved from existing subscription)' : ''}`,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Create new subscription (always create new since we deactivated existing ones)
    const createdSubscription = await UserSubscriptionDetails.create({
      user_id: studentId,
      payment_id: paymentTransaction?.id || null, // Link to the payment transaction
      ...subscriptionData,
      balance: 0
    }, { transaction });

    const subscriptionId = createdSubscription.id;
    console.log(`📋 Created new subscription ${subscriptionId} for user ${studentId} with type: ${finalSubscriptionType}`);
    console.log(`🔗 Linked subscription ${subscriptionId} to payment transaction ${paymentTransaction?.id || 'none'}`);

    // Update user table with subscription information (matching PHP logic)
    const userUpdateData = {
      subscription_type: finalSubscriptionType, // Use preserved or calculated type
      trial_expired: true,
      subscription_id: subscriptionId,
      next_month_subscription: false, // Set to false after creating subscription (matching PHP logic)
      updated_at: Math.floor(Date.now() / 1000)
    };

    await User.update(userUpdateData, {
      where: { id: studentId },
      transaction
    });

    console.log(`👤 Updated user ${studentId} with subscription info:`, {
      subscription_type: finalSubscriptionType,
      subscription_id: subscriptionId,
      trial_expired: true,
      configuration_preserved: preservedFromExisting
    });

    // Log successful subscription creation
    paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: user.full_name || 'unknown',
        subscription_id: subscriptionId,
        verification_type: 'subscription_creation_complete',
        verification_result: true,
        subscription_details: {
            subscription_id: subscriptionId,
            subscription_type: finalSubscriptionType,
            lessons_added: totalLessons,
            lesson_minutes: finalLessonMinutes,
            lessons_per_month: finalLessonsPerMonth,
            cost_per_lesson: costPerLesson,
            renew_date: renewDate,
            configuration_preserved: preservedFromExisting,
            user_table_updated: true
        }
    });

    const result = {
      subscription_id: subscriptionId,
      subscription_type: finalSubscriptionType, // Return preserved or calculated type
      is_new_subscription: true, // Always true since we create new subscriptions
      lessons_added: totalLessons, // Based on preserved monthly lessons
      lesson_minutes: finalLessonMinutes, // Preserved lesson duration
      lessons_per_month: finalLessonsPerMonth, // Preserved monthly classes
      user_updated: true,
      previous_subscription_used: !!previousSubscription,
      existing_subscriptions_deactivated: existingActiveSubscriptions.length,
      deactivated_subscription_ids: existingActiveSubscriptions.map(sub => sub.id),
      configuration_preserved_from_existing: preservedFromExisting, // NEW: Indicates if config was preserved
      original_webhook_params: { // NEW: Store original webhook parameters for reference
        webhook_lessons_per_month: lessonsPerMonth,
        webhook_lesson_minutes: lessonMinutes,
        webhook_months: months
      }
    };

    return result;
  } catch (error) {
    console.error(`❌ Error in createOrUpdateSubscription for user ${studentId}:`, error);
    
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

    console.log('⚠️ No recurring payment UID found in webhook data');
    
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
    console.error('❌ Error extracting recurring payment UID:', error);
    
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

    console.log(`📝 Created recurring payment record ${recurringPayment.id} for student ${studentId}`);

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
    console.error(`❌ Error logging recurring payment for student ${studentId}:`, error);
    
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
 * Process failed payment callback from PayPlus (Legacy URL support)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processPayPlusFailedPayment = async (req, res) => {
  let transaction;
  const legacyFailedStartTime = Date.now();

  try {
    transaction = await sequelize.transaction();

    const parsedData = parsePayPlusResponse(req.body);
    console.log('❌ Processing PayPlus failed callback (legacy):', parsedData);

    // Log legacy failed callback processing start
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_failed',
      transaction_uid: 'parsing',
      status: 'processing_failed',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      processing_result: {
        callback_type: 'legacy_failed',
        processing_start_time: new Date().toISOString()
      },
      webhook_payload: req.body
    });

    const transactionId = parsedData.transaction_uid
      || parsedData.transaction_id
      || parsedData.index
      || generateTransactionId();

    // Normalize the parsed data to match webhook format for processing
    const normalizedData = {
      transaction_uid: transactionId,
      amount: parseFloat(parsedData.amount || parsedData.sum || 0),
      currency_code: parsedData.currency_code || parsedData.currency || 'USD',
      customer_name: parsedData.customer_name || parsedData.student_name || parsedData.contact || '',
      customer_email: parsedData.customer_email || parsedData.student_email || parsedData.email || '',
      payment_method: parsedData.payment_method || parsedData.cardtype || '',
      four_digits: parsedData.four_digits || parsedData.ccno || '',
      status_code: parsedData.status_code || parsedData.error_code || parsedData.Response || '',
      more_info_1: parsedData.more_info_1 || parsedData.student_id || '',
      recurring_info: {},
      original_webhook: parsedData
    };

    // Process the failed payment using webhook logic with normalized data
    await processFailedWebhookPayment(normalizedData, null, transaction);

    await transaction.commit();

    const processingTime = Date.now() - legacyFailedStartTime;

    // Log successful legacy failed processing
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_failed_complete',
      transaction_uid: transactionId,
      status: 'failed',
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      customer_email: normalizedData.customer_email,
      customer_name: normalizedData.customer_name,
      payment_method: normalizedData.payment_method,
      error_details: {
        payment_failure_code: normalizedData.status_code,
        payment_failure_reason: 'Payment failed at processor level (legacy callback)'
      },
      processing_result: {
        processing_time_ms: processingTime,
        legacy_failed_callback_processed: true,
        failure_recorded: true
      }
    });

    return res.status(200).json({
      status: 'success',
      data: { transaction_id: transactionId, status: 'failed' },
      message: 'Failed PayPlus payment recorded'
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError);
      }
    }

    const processingTime = Date.now() - legacyFailedStartTime;

    // Log legacy failed processing error
    paymentLogger.logWebhookEvent({
      event_type: 'legacy_callback_failed_error',
      transaction_uid: 'unknown',
      status: 'error',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'legacy_failed_processing_error',
        error_message: error.message,
        error_stack: error.stack,
        processing_time_ms: processingTime
      },
      webhook_payload: req.body
    });

    console.error('❌ Error recording failed PayPlus payment:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error recording failed PayPlus payment',
      details: error.message
    });
  }
};

/**
 * Get payment transaction history with improved error handling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPaymentTransactions = async (req, res) => {
    try {
        const { student_id, status, generated_by, page = 1, limit = 20,start_date, end_date } = req.query;
        console.log('req.query',req.query);

        // Build query conditions
        const conditions = {};
        if (student_id && !isNaN(student_id)) {
            conditions.student_id = parseInt(student_id);
        }
        if (status && ['success', 'failed', 'pending'].includes(status)) {
            conditions.status = status;
        }
        if (generated_by && !isNaN(generated_by)) {
            conditions.generated_by = parseInt(generated_by);
        }

        /* ✅ DATE RANGE FILTER */
if (start_date && end_date) {
  conditions.created_at = {
    [Op.between]: [
      new Date(`${start_date} 00:00:00`),
      new Date(`${end_date} 23:59:59`)
    ]
  };
}

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get transactions with pagination
        const transactions = await PaymentTransaction.findAndCountAll({
            where: conditions,
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscriptions',
                    required: false,
                    where: {
                        payment_id: { [Op.col]: 'PaymentTransaction.id' }
                    }
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10)
        });

        const rows = transactions.rows.map((t) => {
            const subs = t.Subscriptions || [];

            const subscription_cancelled = subs.some((sub) => sub.is_cancel === 1 || sub.is_cancel === true || sub.status === 'inactive' || !!sub.cancellation_date);

            const data = t.toJSON();
            delete data.Subscriptions;

            return {
                ...data,
                subscription_cancelled
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                transactions: rows,
                total: transactions.count,
                page: parseInt(page, 10),
                pages: Math.ceil(transactions.count / parseInt(limit)),
                limit: parseInt(limit, 10)
            },
            message: 'Payment transactions retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting payment transactions:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error getting payment transactions',
            details: error.message
        });
    }
};

/**
 * Get student details including subscription info with improved error handling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentDetails = async (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      status: 'error',
      message: 'Valid student ID is required'
    });
  }

  try {
    // Get student basic info
    const student = await User.findByPk(parseInt(id), {
      attributes: [
        'id', 'full_name', 'email', 'mobile', 'status',
        'created_at', 'address', 'timezone', 'trial_user_id'
      ]
    });

    if (!student) {
      return res.status(404).json({
        status: 'error',
        message: 'Student not found'
      });
    }

    // Get trial class registration if linked
    let trialClassRegistration = null;
    if (student.trial_user_id) {
      trialClassRegistration = await TrialClassRegistration.findByPk(student.trial_user_id, {
        attributes: [
          'id', 'student_name', 'parent_name', 'age', 'status',
          'trial_class_status', 'meeting_start', 'meeting_end',
          'teacher_id', 'booked_by'
        ]
      });
    }

    // Get student subscription details
    const subscription = await UserSubscriptionDetails.findOne({
      where: { user_id: parseInt(id) }
    });

    // Get student's payment transactions
    const payments = await PaymentTransaction.findAll({
      where: { student_id: parseInt(id) },
      order: [['created_at', 'DESC']],
      limit: 10
    });

    // Get student's recurring payments
    const recurringPayments = await RecurringPayment.findAll({
      where: { student_id: parseInt(id) },
      order: [['created_at', 'DESC']],
      limit: 10
    });

    return res.status(200).json({
      status: 'success',
      data: {
        ...student.toJSON(),
        trialClassRegistration: trialClassRegistration ? trialClassRegistration.toJSON() : null,
        subscription: subscription ? subscription.toJSON() : null,
        payments: payments,
        recurringPayments: recurringPayments
      },
      message: 'Student details retrieved successfully'
    });
  } catch (error) {
    console.error(`Error getting details for student ${id}:`, error);
    return res.status(500).json({
      status: 'error',
      message: 'Error getting student details',
      details: error.message
    });
  }
};

/**
 * Retry failed webhook processing with improved error handling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const retryFailedWebhook = async (req, res) => {
  const { webhookLogId } = req.params;

  if (!webhookLogId || isNaN(webhookLogId)) {
    return res.status(400).json({
      status: 'error',
      message: 'Valid webhook log ID is required'
    });
  }

  let transaction;

  try {
    transaction = await sequelize.transaction();

    // Find the webhook log
    const webhookLog = await PayPlusWebhookLog.findByPk(parseInt(webhookLogId), {
      transaction
    });

    if (!webhookLog) {
      if (transaction) await transaction.rollback();
      return res.status(404).json({
        status: 'error',
        message: 'Webhook log not found'
      });
    }

    if (webhookLog.processed) {
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Webhook already processed successfully'
      });
    }

    // Extract webhook data from raw_webhook_data
    const rawData = typeof webhookLog.raw_webhook_data === 'string'
      ? JSON.parse(webhookLog.raw_webhook_data)
      : webhookLog.raw_webhook_data;

    const webhookData = extractWebhookData(rawData);

    // Retry processing based on event type
    if (webhookLog.event_type === 'payment_success') {
      await processSuccessfulWebhookPayment(webhookData, webhookLog.id, transaction);
    } else {
      await processFailedWebhookPayment(webhookData, webhookLog.id, transaction);
    }

    // Mark as processed
    await webhookLog.update({
      processed: true,
      processing_error: null
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      status: 'success',
      message: 'Webhook processed successfully',
      data: {
        webhook_log_id: webhookLog.id,
        transaction_uid: webhookLog.transaction_uid
      }
    });

  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Error rolling back retry transaction:', rollbackError);
      }
    }

    console.error(`Error retrying webhook ${webhookLogId}:`, error);
    return res.status(500).json({
      status: 'error',
      message: 'Error retrying webhook processing',
      details: error.message
    });
  }
};

/**
 * Cancel all active recurring payments for a student manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const cancelUserRecurringPaymentsManually = async (req, res) => {

  const { user_id, reason, cancelled_by } = req.body;
  const studentId = user_id;

  if (!studentId || isNaN(studentId)) {
    return res.status(400).json({
      status: 'error',
      message: 'Valid studentId is required',
    });
  }

  if (!cancelled_by) {
    return res.status(400).json({
      status: 'error',
      message: 'Field "cancelled_by" must be a non-empty string.',
    });
  }

  let transaction;

  try {
    transaction = await sequelize.transaction();

    const id = typeof studentId === 'object' && studentId !== null ? studentId.id : studentId;
    console.log(`🔁 Checking active recurring payments for student ${id}`);

    const activeRecurringPayments = await RecurringPayment.findAll({
      where: {
        student_id: studentId,
        status: { [Op.in]: ['pending', 'paid'] }
      },
      transaction
    });

    console.log(`📋 Found ${activeRecurringPayments.length} recurring payments to cancel`);

    let successCount = 0;

    for (const payment of activeRecurringPayments) {
      let webhookData = null;
      
      // Parse webhook_data JSON
      if (payment?.webhook_data) {
        try {
          webhookData = typeof payment.webhook_data === 'string' 
            ? JSON.parse(JSON.parse(payment.webhook_data)) 
            : payment.webhook_data;
        } catch (parseError) {
          console.error(`Error parsing webhook_data for payment ${payment.id}:`, parseError);
          webhookData = null;
        }
      }
      const recurringUid = payment?.payplus_transaction_uid || webhookData?.recurring_payment_uid;

      if (!recurringUid || recurringUid === 'N/A') {
        console.warn(`⚠️ Skipping payment without recurring UID`);
        continue;
      }

      // Get terminal UID from multiple sources with priority order
      let terminalUid = null;

      // 1st priority: Check webhook_data from RecurringPayment
      if (webhookData) {
        console.log('webhookData:', webhookData);
        
        // Check direct terminal_uid
        terminalUid = webhookData.terminal_uid;
        
        // Check original_webhook.terminal_uid
        if (!terminalUid && webhookData.original_webhook) {
          terminalUid = webhookData.original_webhook.terminal_uid;
        }
        
        if (terminalUid) {
          console.log(`✅ Found terminal UID in recurring payment webhook data: ${terminalUid}`);
        }
      }

      // 2nd priority: Search in payment transactions if not found
      if (!terminalUid) {
        console.log(`🔍 Terminal UID not found in webhook data, searching in payment transactions for student ${id}`);
        
        const paymentTransaction = await PaymentTransaction.findOne({
          where: {
            student_id: id,
            status: 'success'
          },
          order: [['created_at', 'DESC']],
          transaction
        });

        if (paymentTransaction && paymentTransaction.response_data) {
          try {
            const responseData = typeof paymentTransaction.response_data === 'string' 
              ? JSON.parse(paymentTransaction.response_data) 
              : paymentTransaction.response_data;
            
            terminalUid = responseData?.terminal_uid;
            if (terminalUid) {
              console.log(`✅ Found terminal UID in payment transaction: ${terminalUid}`);
            }
          } catch (parseError) {
            console.error('❌ Error parsing payment transaction response_data:', parseError);
          }
        }
      }

      // 3rd priority: Use environment variable as fallback
      if (!terminalUid) {
        terminalUid = process.env.PAYPLUS_TERMINAL_UID;
        if (terminalUid) {
          console.log(`ℹ️ Using environment variable terminal UID: ${terminalUid}`);
        }
      }

      if (!terminalUid) {
        console.warn(`⚠️ Skipping payment due to missing terminal UID for ${recurringUid}`);
        continue;
      }

      const cancelUrl = `${process.env.PAYPLUS_BASE_URL}/RecurringPayments/DeleteRecurring/${recurringUid}`;
      const payload = {
        terminal_uid: terminalUid,
        _method: 'DELETE'
      };

      let cancelled = false;

      try {
        console.log(`🔄 Attempting to cancel recurring payment ${recurringUid} with terminal ${terminalUid}`);
        
        const res = await axios.post(cancelUrl, payload, {
          headers: {
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY,
            'Content-Type': 'application/json'
          }
        });

        if (res.status === 200 || res.status === 204) {
          cancelled = true;
          console.log(`✅ Successfully cancelled recurring payment ${recurringUid}`);
        } else {
          console.error(`❌ Failed to cancel recurring payment ${recurringUid}:`, res.data);
        }
      } catch (err) {
        const msg = err?.response?.data || err.message;
        if (
          msg?.includes('already cancelled') ||
          msg?.includes('not found') ||
          msg?.includes('inactive')
        ) {
          cancelled = true;
          console.log(`ℹ️ Recurring payment ${recurringUid} was already cancelled or not found`);
        } else {
          console.error(`❌ Error cancelling recurring ${recurringUid}:`, msg);
        }
      }

      if (cancelled) {
        await payment.update({
          status: 'cancelled',
          is_active: false,
          cancelled_at: new Date(),
          remarks: `[${new Date().toISOString()}] Cancelled manually by ${cancelled_by}: ${reason}`,
          ...(payment.rawAttributes.cancelled_by && { cancelled_by }) // only set if column exists
        }, { transaction });

        const activeSubscription = await UserSubscriptionDetails.findOne({
          where: {
            user_id: id,
            status: 'active'
          },
          transaction
        });

        if (activeSubscription) {
          await activeSubscription.update({
            status: 'inactive',
            updated_at: new Date()
          }, { transaction });

          await User.update({
            subscription_id: null,
            subscription_type: null
          }, {
            where: { id: id },
            transaction
          });

          console.log(`📉 Subscription ${activeSubscription.id} marked as inactive for user ${id}`);
        }

        successCount++;
      }
    }

    await transaction.commit();

    return res.status(200).json({
      status: 'success',
      message: `Cancelled ${successCount} of ${activeRecurringPayments.length} recurring payments.`,
      total: activeRecurringPayments.length,
      cancelled: successCount,
      cancelled_by
    });

  } catch (error) {
    if (transaction) await transaction.rollback();

    console.error('❌ Error in cancelUserRecurringPaymentsManually:', error);

    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while cancelling recurring payments.',
      details: error.message
    });
  }
};
/**
 * Download invoice document for a transaction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadInvoice = async (req, res) => {
  try {
    const { transaction_uid } = req.params;
    const { type = 'original', format = 'pdf' } = req.query;

    // Validate transaction UID
    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      return res.status(400).json({
        status: 'error',
        message: 'Valid transaction UID is required'
      });
    }

    // Validate type parameter
    if (!['original', 'copy'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Type must be either "original" or "copy"'
      });
    }

    console.log(`📥 Downloading ${type} invoice for transaction: ${transaction_uid}`);

    // First, get the invoice documents to find the download URL
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
        message: 'No invoice documents found for this transaction',
        transaction_uid: transaction_uid
      });
    }

    // Find the first successful invoice
    const invoice = response.data.invoices.find(inv => inv.status === 'success');
    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'No successful invoice found for this transaction',
        transaction_uid: transaction_uid
      });
    }

    // Get the appropriate download URL
    const downloadUrl = type === 'original' ? invoice.original_doc_url : invoice.copy_doc_url;
    
    if (!downloadUrl) {
      return res.status(404).json({
        status: 'error',
        message: `${type} document URL not available for this invoice`,
        transaction_uid: transaction_uid,
        available_types: {
          original: !!invoice.original_doc_url,
          copy: !!invoice.copy_doc_url
        }
      });
    }

    console.log(`🔗 Found ${type} document URL: ${downloadUrl}`);

    // Download the document from PayPlus
    const documentResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000, // 60 second timeout for file download
      headers: {
        'api-key': process.env.PAYPLUS_API_KEY,
        'secret-key': process.env.PAYPLUS_SECRET_KEY
      }
    });

    if (documentResponse.status !== 200) {
      throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
    }

    // Determine content type and filename
    const contentType = documentResponse.headers['content-type'] || 'application/pdf';
    const filename = `invoice_${transaction_uid}_${type}.${format}`;

    // Set response headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`📥 Streaming invoice document: ${filename}`);

    // Stream the document to the client
    documentResponse.data.pipe(res);

    // Handle stream errors
    documentResponse.data.on('error', (error) => {
      console.error(`❌ Error streaming invoice document:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Error streaming invoice document',
          details: error.message
        });
      }
    });

    // Log successful download
    documentResponse.data.on('end', () => {
      console.log(`✅ Successfully downloaded invoice for transaction ${transaction_uid}`);
    });

  } catch (error) {
    console.error(`❌ Error downloading invoice for transaction ${req.params.transaction_uid}:`, error);

    // Prevent sending response if headers already sent
    if (res.headersSent) {
      return;
    }

    // Handle specific errors
    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;

      if (statusCode === 404) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice document not found',
          transaction_uid: req.params.transaction_uid
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
 * Cancel all active recurring payments for a user (auto-cancel path)
 * @param {Number} studentId - User ID
 * @param {String} reason - Reason for cancellation
 * @param {Object} transaction - Database transaction
 */
const cancelRecurringPaymentsForUser = async (studentId, reason, transaction) => {
  // Find active recurring payments
  const activeRecurringPayments = await RecurringPayment.findAll({
    where: {
      student_id: studentId,
      status: { [Op.in]: ['pending', 'paid'] },
      is_active: true
    },
    transaction
  });

  if (!activeRecurringPayments.length) {
    return;
  }

  // Also fetch the active subscription to mark inactive
  const activeSubscription = await UserSubscriptionDetails.findOne({
    where: {
      user_id: studentId,
      status: 'active',
      is_cancel: 0
    },
    transaction
  });

  for (const payment of activeRecurringPayments) {
    let terminalUid = null;
    let recurringUid = payment.payplus_transaction_uid;

    // Try to parse terminal UID from stored webhook data
    if (payment.webhook_data) {
      try {
        const parsedWebhook = typeof payment.webhook_data === 'string'
          ? JSON.parse(payment.webhook_data)
          : payment.webhook_data;

        terminalUid = parsedWebhook?.terminal_uid
          || parsedWebhook?.original_webhook?.terminal_uid
          || parsedWebhook?.original_webhook?.transaction?.terminal_uid
          || null;
      } catch (err) {
        console.error('❌ Error parsing webhook_data for auto-cancel:', err);
      }
    }

    if (!terminalUid) {
      terminalUid = process.env.PAYPLUS_TERMINAL_UID || null;
    }

    // Attempt remote cancellation if we have identifiers
    if (recurringUid && terminalUid) {
      const cancelUrl = `${process.env.PAYPLUS_BASE_URL}/RecurringPayments/DeleteRecurring/${recurringUid}`;
      try {
        await axios.post(cancelUrl, {
          terminal_uid: terminalUid,
          _method: 'DELETE'
        }, {
          headers: {
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });
        console.log(`✅ Auto-cancelled recurring payment ${recurringUid} for user ${studentId}`);
      } catch (err) {
        console.error(`⚠️ Remote cancel failed for ${recurringUid}, marking locally:`, err?.response?.data || err.message);
      }
    }

    // Always mark locally as cancelled to stop future charges
    await payment.update({
      status: 'cancelled',
      is_active: false,
      cancelled_at: new Date(),
      remarks: `[${new Date().toISOString()}] Auto-cancelled after repeated failures: ${reason}`
    }, { transaction });

    paymentLogger.logPaymentVerification({
      student_id: studentId,
      student_name: 'unknown',
      subscription_id: null,
      verification_type: 'auto_cancel_recurring_after_failures',
      verification_result: true,
      subscription_details: {
        recurring_payment_id: payment.id,
        recurring_uid: recurringUid || 'unknown',
        reason,
        terminal_uid: terminalUid || 'unknown'
      }
    });
  }

  if (activeSubscription) {
    await activeSubscription.update({
      status: 'inactive',
      updated_at: new Date(),
      notes: `${activeSubscription.notes || ''}\n[${new Date().toISOString()}] Deactivated due to repeated failed recurring payments`
    }, { transaction });

    await User.update({
      subscription_id: null,
      subscription_type: null
    }, {
      where: { id: studentId },
      transaction
    });

    paymentLogger.logPaymentVerification({
      student_id: studentId,
      student_name: 'unknown',
      subscription_id: activeSubscription.id,
      verification_type: 'subscription_deactivated_after_failed_recurring',
      verification_result: true,
      subscription_details: {
        deactivated_subscription_id: activeSubscription.id,
        reason: 'Repeated failed recurring payments',
        status_set_to: 'inactive'
      }
    });
  }

  // Update PastDuePayment records for this user
  const pastDuePayments = await PastDuePayment.findAll({
    where: {
      user_id: studentId,
      status: 'past_due'
    },
    transaction
  });

  if (pastDuePayments.length > 0) {
    for (const pastDuePayment of pastDuePayments) {
      const updatedNotes = `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Recurring payment cancelled due to repeated failures: ${reason}`;
      
      await pastDuePayment.update({
        notes: updatedNotes,
        status: 'cancelled'
      }, { transaction });

      console.log(`[AUTO-CANCEL] Updated past due payment ${pastDuePayment.id} to cancelled status for user ${studentId}`);

      paymentLogger.logPaymentVerification({
        student_id: studentId,
        student_name: 'unknown',
        subscription_id: pastDuePayment.subscription_id || null,
        verification_type: 'past_due_payment_cancelled_after_recurring_cancel',
        verification_result: true,
        subscription_details: {
          past_due_payment_id: pastDuePayment.id,
          reason,
          cancelled_at: new Date().toISOString()
        }
      });
    }

    // Disable dunning schedules for cancelled past due payments
    const dunningSchedules = await DunningSchedule.findAll({
      where: {
        past_due_payment_id: { [Op.in]: pastDuePayments.map(p => p.id) },
        is_enabled: true
      },
      transaction
    });

    if (dunningSchedules.length > 0) {
      for (const dunningSchedule of dunningSchedules) {
        await dunningSchedule.update({
          is_enabled: false,
          is_paused: true
        }, { transaction });

        console.log(`[AUTO-CANCEL] Disabled dunning schedule ${dunningSchedule.id} for user ${studentId}`);
      }
    }
  }

  // Mark active subscription inactive and clear on user
  
};

/**
 * Handle recurring payment failure - create past due record and start dunning process
 * UPDATED VERSION with error details extraction
 */
const handleRecurringPaymentFailure = async (failureData, transaction) => {
    try {
        const {
            user_id,
            transaction_uid,
            amount,
            currency,
            failed_at,
            status_code,
            status_description,
            recurring_info,
            page_request_uid,
            webhookData // NEW: Pass the full webhook data for error extraction
        } = failureData;

        console.log(`[DUNNING] Starting dunning process for failed recurring payment - User: ${user_id}, Amount: ${amount}`);

        // NEW: Extract error details from webhook data
        let failureStatusCode = status_code || '';
        let failureMessageDescription = status_description || '';

        // Enhanced error extraction from webhook data structure
        if (webhookData?.original_webhook) {
            const originalWebhook = webhookData.original_webhook;
            
            // Try to extract from transaction object first
            if (originalWebhook.transaction) {
                failureStatusCode = originalWebhook.transaction.status_code || failureStatusCode;
                failureMessageDescription = originalWebhook.transaction.message_description || failureMessageDescription;
            }
            
            // Also check direct properties
            failureStatusCode = originalWebhook.status_code || failureStatusCode;
            failureMessageDescription = originalWebhook.message_description || failureMessageDescription;
        }

        // If still not found, try from webhookData directly
        if (webhookData && (!failureStatusCode || !failureMessageDescription)) {
            failureStatusCode = webhookData.status_code || failureStatusCode;
            failureMessageDescription = webhookData.message_description || failureMessageDescription;
        }

        console.log(`[DUNNING] Extracted error details - Code: ${failureStatusCode}, Description: ${failureMessageDescription}`);

        // Get user details
        const user = await User.findByPk(user_id, {
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone'],
            transaction
        });

        if (!user) {
            throw new Error(`User ${user_id} not found for recurring payment failure`);
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: user_id,
                status: 'active',
                is_cancel: 0
            },
            transaction
        });

        if (!subscription) {
            console.warn(`[DUNNING] No active subscription found for user ${user_id} - cannot create dunning schedule`);
            return;
        }

        // Check if user has active charge skip (admin override)
        const activeSkip = await SubscriptionChargeSkip.findOne({
            where: {
                user_id: user_id,
                is_active: true,
                skip_start_date: { [Op.lte]: new Date() },
                skip_end_date: { [Op.gte]: new Date() }
            },
            transaction
        });

        if (activeSkip) {
            console.log(`[DUNNING] User ${user_id} has active charge skip until ${activeSkip.skip_end_date} - skipping dunning`);
            return;
        }

        // Update subscription status to past_due
        // await subscription.update({
        //     status: 'past_due',
        //     updated_at: new Date()
        // }, { transaction });

        console.log(`[DUNNING] Updated subscription ${subscription.id} status to past_due`);

        // Check for existing past due payment for this user
        let pastDuePayment = await PastDuePayment.findOne({
            where: {
                user_id: user_id,
                status: 'past_due'
            },
            transaction
        });

        const gracePeriodDays = parseInt(process.env.DUNNING_GRACE_PERIOD_DAYS) || 30;
        const gracePeriodExpiry = moment(failed_at).add(gracePeriodDays, 'days').toDate();
        const isNewRecord = !pastDuePayment;

        if (pastDuePayment) {
            // Update existing past due payment with new attempt and error details
            const updatedNotes = `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Additional failure: ${failureMessageDescription || status_description} (Code: ${failureStatusCode || status_code}). Transaction: ${transaction_uid}`;
            
            await pastDuePayment.update({
                amount: amount,
                currency: currency,
                // DO NOT update failed_at - preserve original first failure date
                // DO NOT update grace_period_expires_at - preserve original expiry date
                attempt_number: pastDuePayment.attempt_number + 1,
                failure_status_code: failureStatusCode, // Update with latest error code
                failure_message_description: failureMessageDescription, // Update with latest error message
                notes: updatedNotes
            }, { transaction });

            console.log(`[DUNNING] Updated existing past due payment ${pastDuePayment.id} - attempt #${pastDuePayment.attempt_number + 1}`);
            
            // Reload from database to ensure we have the preserved grace_period_expires_at value
            await pastDuePayment.reload({ transaction });
            console.log(`[DUNNING] Preserved original grace period expiry: ${pastDuePayment.grace_period_expires_at}`);
        } else {
            // Create new past due payment record with error details
            const initialNotes = `Initial failure: ${failureMessageDescription || status_description} (Code: ${failureStatusCode || status_code}). Transaction: ${transaction_uid}`;
            
            pastDuePayment = await PastDuePayment.create({
                user_id: user_id,
                subscription_id: subscription.id,
                amount: amount,
                currency: currency,
                failed_at: failed_at,
                due_date: moment(failed_at).format('YYYY-MM-DD'),
                grace_period_days: gracePeriodDays,
                grace_period_expires_at: gracePeriodExpiry,
                status: 'past_due',
                attempt_number: 1,
                payplus_page_request_uid: page_request_uid,
                failure_status_code: failureStatusCode, 
                failure_message_description: failureMessageDescription, 
                notes: initialNotes
            }, { transaction });

            console.log(`[DUNNING] Created new past due payment record ${pastDuePayment.id} with error details`);
        }

        // NEW: Auto-cancel recurring after 30 failed attempts for the same user
        const currentAttemptNumber = pastDuePayment.attempt_number;
        if (currentAttemptNumber >= 30) {
            try {
                await cancelRecurringPaymentsForUser(
                    user_id,
                    `Auto-cancel after ${currentAttemptNumber} failed recurring attempts`,
                    transaction
                );
                console.log(`[DUNNING] Auto-cancelled recurring payments for user ${user_id} after ${currentAttemptNumber} failures`);
            } catch (autoCancelError) {
                console.error(`[DUNNING] Error auto-cancelling recurring payments for user ${user_id}:`, autoCancelError);
            }
        }

        // Generate a short ID and store it directly on PastDuePayment (no separate PaymentLinks table)
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        let shortId = pastDuePayment.short_id;
        if (!shortId) {
            shortId = generateShortId();
            await pastDuePayment.update({
                short_id: shortId
            }, { transaction });
        }

        // Build short frontend URL using the short ID (much shorter and clickable)
        const recoveryPageUrl = `${frontendUrl}/payment/recovery/${shortId}`;

        await pastDuePayment.update({
            payment_link: recoveryPageUrl,
            payplus_page_request_uid: null
        }, { transaction });

        console.log(`[DUNNING] Recovery page URL saved with short ID on PastDuePayment: ${recoveryPageUrl}`);

        // Create or update dunning schedule
        let dunningSchedule = await DunningSchedule.findOne({
            where: { past_due_payment_id: pastDuePayment.id },
            transaction
        });

        const userTimezone = user.timezone || 'Asia/Jerusalem';
        const reminderTime = process.env.DUNNING_REMINDER_TIME || '10:00';
        const [hours, minutes] = reminderTime.split(':').map(Number);
        const nextReminderAt = moment().tz(userTimezone).add(1, 'day').hour(hours).minute(minutes).second(0).toDate();

        if (dunningSchedule) {
            // Update existing schedule
            await dunningSchedule.update({
                is_enabled: true,
                is_paused: false,
                next_reminder_at: nextReminderAt,
                timezone: userTimezone
            }, { transaction });
        } else {
            // Create new dunning schedule
            dunningSchedule = await DunningSchedule.create({
                past_due_payment_id: pastDuePayment.id,
                user_id: user_id,
                is_enabled: true,
                is_paused: false,
                reminder_frequency: 'daily',
                reminder_time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`,
                timezone: userTimezone,
                next_reminder_at: nextReminderAt
            }, { transaction });

            console.log(`[DUNNING] Created dunning schedule ${dunningSchedule.id} - next reminder at ${nextReminderAt}`);
        }

        // Calculate actual days remaining based on preserved grace_period_expires_at
        const actualGracePeriodExpiry = pastDuePayment.grace_period_expires_at || gracePeriodExpiry;
        const daysRemaining = Math.max(0, Math.ceil(moment(actualGracePeriodExpiry).diff(moment(), 'days', true)));

        // Send immediate failure notification (Day 0)
        if (paymentRecoveryLink.success) {
            await sendFailureNotification({
                user: user,
                past_due_payment: pastDuePayment,
                // Use the short recovery URL instead of the very long PayPlus URL
                payment_link: pastDuePayment.payment_link,
                days_remaining: daysRemaining, // Calculate from preserved expiry date
                is_first_notification: isNewRecord, // Only true for first failure (new record)
                failure_reason: failureMessageDescription || status_description // NEW: Include failure reason in notification
            });

            console.log(`[DUNNING] Immediate failure notification sent to user ${user_id}`);
        }

        // Log the dunning process initiation with error details
        paymentLogger.logPaymentVerification({
            student_id: user_id,
            student_name: user.full_name,
            subscription_id: subscription.id,
            verification_type: 'dunning_process_initiated',
            verification_result: true,
            subscription_details: {
                past_due_payment_id: pastDuePayment.id,
                dunning_schedule_id: dunningSchedule.id,
                grace_period_days: gracePeriodDays,
                grace_period_expires_at: actualGracePeriodExpiry,
                recovery_link_generated: !!paymentRecoveryLink.success,
                next_reminder_at: nextReminderAt,
                // NEW: Include error details in logging
                failure_status_code: failureStatusCode,
                failure_message_description: failureMessageDescription
            }
        });

        console.log(`[DUNNING] Dunning process initiated successfully for user ${user_id} with error details: ${failureStatusCode} - ${failureMessageDescription}`);

    } catch (error) {
        console.error('[DUNNING] Error in handleRecurringPaymentFailure:', error);
        
        paymentLogger.logPaymentVerification({
            student_id: failureData.user_id,
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'dunning_process_error',
            verification_result: false,
            error_details: {
                error_type: 'dunning_initiation_error',
                error_message: error.message,
                error_stack: error.stack,
                failure_data: failureData
            }
        });
        
        throw error;
    }
};

const exportPaymentTransactionsCSV = async (req, res) => {
  try {
    const {
      status,
      generated_by,
      date_from,
      date_to,
      payment_ids
    } = req.query;

    const where = {};

    if (status) where.status = status;
    if (generated_by) where.generated_by = generated_by;

    if (payment_ids) {
      const ids = Array.isArray(payment_ids)
        ? payment_ids
        : payment_ids.split(",").map((i) => parseInt(i.trim()));
      where.id = { [Op.in]: ids };
    }

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(date_from);
      if (date_to) where.created_at[Op.lte] = new Date(date_to);
    }

    const transactions = await PaymentTransaction.findAll({
      where,
      include: [
        { model: User, as: "Student", attributes: ["full_name", "email"] },
        { model: SubscriptionPlan, as: "Plan", attributes: ["name"] },
        { model: SubscriptionDuration, as: "Duration", attributes: ["name"] }
      ],
      order: [["created_at", "DESC"]]
    });

    if (!transactions.length) {
      return res.status(200).send("No payment transactions found.");
    }

    // -----------------------------
    // CSV Headers
    // -----------------------------
    const headers = [
      "Transaction ID",
      "Student Name",
      "Student Email",
      "Amount",
      "Currency",
      "Status",
      "Plan",
      "Duration",
      "Lessons / Month",
      "Lesson Minutes",
      "Recurring",
      "Payment Method",
      "Created At"
    ];

    const csvRows = [headers];

    // -----------------------------
    // Build CSV Rows
    // -----------------------------
    transactions.forEach((tx) => {
      csvRows.push([
        tx.transaction_id || "N/A",
        tx.Student?.full_name || "N/A",
        tx.Student?.email || "N/A",
        tx.amount || "0",
        tx.currency || "N/A",
        tx.status || "N/A",
        tx.Plan?.name || "Custom",
        tx.Duration?.name || "N/A",
        tx.lessons_per_month || "",
        tx.lesson_minutes || "",
        tx.is_recurring ? "Yes" : "No",
        tx.payment_method || "",
        moment(tx.created_at).format("YYYY-MM-DD HH:mm:ss")
      ]);
    });

    const csvString = csvRows.map((r) => r.join(",")).join("\n");

    const filename = `payment-transactions-${moment().format("YYYYMMDD-HHmm")}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

    // UTF-8 BOM for Excel
    return res.send("\uFEFF" + csvString);

  } catch (error) {
    console.error("❌ Payment CSV Export Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export payment transactions CSV"
    });
  }
};

module.exports = {
  processPayPlusWebhook,
  processPayPlusFailedPayment,
  getPaymentTransactions,
  getStudentDetails,
  retryFailedWebhook,
  cancelUserRecurringPaymentsManually,
  downloadInvoice,
  handleRecurringPaymentFailure,
  exportPaymentTransactionsCSV
};