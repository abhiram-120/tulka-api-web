// controller/sales/family-payment-failed.controller.js
const { Family, FamilyChild, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const RecurringPayment = require('../../models/RecurringPayment');
const { paymentLogger } = require('../../utils/paymentLogger');
const { sequelize } = require('../../connection/connection');
const { Sequelize } = require('sequelize');
const { sendCombinedNotifications } = require('../../cronjobs/reminder');
const { Op } = require('sequelize');
const moment = require('moment');
const axios = require('axios');

/**
 * Generate a unique transaction ID when one is missing
 * @returns {String} - Unique transaction ID
 */
const generateTransactionId = () => {
  return `fam_failed_txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Parse the PayPlus response data with enhanced error handling and debugging
 * @param {Object} body - Request body from PayPlus
 * @returns {Object} - Parsed data
 */
const parsePayPlusResponse = (body) => {
  try {
    console.log('=== parsePayPlusResponse DEBUG (FAILED) ===');
    console.log('Input body type:', typeof body);
    console.log('Input body:', JSON.stringify(body, null, 2));
    console.log('Body keys count:', Object.keys(body || {}).length);

    // Handle empty or null body
    if (!body || typeof body !== 'object') {
      console.log('Invalid body - returning empty object');
      return {};
    }

    // If body contains a single key with PayPlus's format (starting with &)
    if (Object.keys(body).length === 1 && Object.keys(body)[0].startsWith('&')) {
      console.log('Detected legacy PayPlus format - parsing...');
      
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
          console.log('Error decoding original_data:', error.message);
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

      console.log('Legacy format parsed result:', JSON.stringify(params, null, 2));
      return params;
    }

    // If it's already in a structured format, return it as is
    console.log('Detected structured format - returning as-is');
    console.log('Returning body with keys:', Object.keys(body));
    
    // Ensure all expected fields are present (case-insensitive check)
    const normalizedBody = {};
    Object.keys(body).forEach(key => {
      // Keep original key
      normalizedBody[key] = body[key];
      
      // Also create lowercase version for compatibility
      const lowerKey = key.toLowerCase();
      if (lowerKey !== key && !normalizedBody[lowerKey]) {
        normalizedBody[lowerKey] = body[key];
      }
    });

    console.log('Normalized body keys:', Object.keys(normalizedBody));
    return normalizedBody;

  } catch (error) {
    console.log('Error in parsePayPlusResponse:', error);
    
    paymentLogger.logWebhookEvent({
      event_type: 'family_payplus_failed_response_parse_error',
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
        body_keys: Object.keys(body || {}),
        body_type: typeof body
      }
    });
    
    console.log('Returning original body due to error');
    return body || {};
  }
};

/**
 * Robust link token extraction with multiple fallback strategies
 * @param {Object} parsedData - Parsed PayPlus response data  
 * @param {Object} originalBody - Original request body as fallback
 * @returns {String} - Extracted link token or empty string
 */
const extractLinkToken = (parsedData, originalBody = {}) => {
  console.log('=== ROBUST TOKEN EXTRACTION (FAILED PAYMENT) ===');
  
  // Strategy 1: Direct extraction from parsedData
  let token = parsedData?.more_info_1;
  if (token && typeof token === 'string' && token.trim().length > 0) {
    console.log('Token found via Strategy 1 (parsedData.more_info_1):', token);
    return token.trim();
  }

  // Strategy 2: Case-insensitive field search in parsedData
  const fieldVariations = [
    'more_info_1', 'More_Info_1', 'MORE_INFO_1', 'more-info-1', 'moreInfo1',
    'more_info1', 'linkToken', 'link_token', 'token'
  ];
  
  for (const field of fieldVariations) {
    token = parsedData?.[field];
    if (token && typeof token === 'string' && token.trim().length > 0) {
      console.log(`Token found via Strategy 2 (${field}):`, token);
      return token.trim();
    }
  }

  // Strategy 3: Deep search in nested objects (like params)
  if (typeof parsedData === 'object') {
    for (const [key, value] of Object.entries(parsedData)) {
      if (typeof value === 'object' && value !== null) {
        for (const field of fieldVariations) {
          token = value[field];
          if (token && typeof token === 'string' && token.trim().length > 0) {
            console.log(`Token found via Strategy 3 (${key}.${field}):`, token);
            return token.trim();
          }
        }
      }
    }
  }

  // Strategy 4: Try original body if parsedData failed
  if (originalBody && typeof originalBody === 'object') {
    for (const field of fieldVariations) {
      token = originalBody[field];
      if (token && typeof token === 'string' && token.trim().length > 0) {
        console.log(`Token found via Strategy 4 (originalBody.${field}):`, token);
        return token.trim();
      }
    }
  }

  console.log('No token found with any strategy');
  return '';
};

/**
 * Process failed family payment callback from PayPlus - COMPLETE VERSION
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processFamilyPaymentFailed = async (req, res) => {
  let transaction;
  const processingStartTime = Date.now();
  
  // Add request timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error('Family failed payment processing timeout - force responding');
    if (!res.headersSent) {
      res.status(408).json({
        status: 'error',
        message: 'Failed payment processing timeout',
        details: 'Processing took longer than expected'
      });
    }
  }, 30000); // 30 second timeout

  try {
    console.log('Starting family failed payment processing...');
    
    // Start database transaction
    transaction = await sequelize.transaction();
    console.log('Database transaction started');

    // Parse the PayPlus response data
    const parsedData = parsePayPlusResponse(req.body);
    console.log('Failed payment data parsed successfully:', parsedData);

    // Log family failed callback processing start
    paymentLogger.logWebhookEvent({
      event_type: 'family_callback_failed',
      transaction_uid: 'parsing',
      status: 'processing_failed',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      processing_result: {
        callback_type: 'family_failed',
        processing_start_time: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      },
      webhook_payload: req.body
    });

    console.log('Initial webhook event logged');

    // Extract essential data - PayPlus specific field mappings with fallbacks
    const transactionId = parsedData.transaction_uid ||
      parsedData.transaction_id ||
      parsedData.index ||
      generateTransactionId();

    console.log('Failed transaction ID extracted:', transactionId);

    // Validate transaction ID
    if (!transactionId || transactionId === 'undefined' || transactionId === '') {
      console.error('Invalid transaction ID');
      
      paymentLogger.logWebhookEvent({
        event_type: 'family_callback_failed_validation',
        transaction_uid: transactionId || 'invalid',
        status: 'validation_failed',
        amount: parseFloat(parsedData.amount || parsedData.sum || 0),
        currency: parsedData.currency_code || parsedData.currency || 'ILS',
        customer_email: parsedData.customer_email || parsedData.email || '',
        customer_name: parsedData.customer_name || parsedData.contact || '',
        payment_method: parsedData.payment_method || parsedData.cardtype || '',
        error_details: {
          error_type: 'invalid_transaction_id',
          error_message: 'Missing or invalid transaction ID parameters',
          provided_transaction_id: transactionId
        }
      });

      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing or invalid transaction ID parameters'
      });
    }

    // Extract link token with robust method
    const linkToken = extractLinkToken(parsedData, req.body);
    console.log('Link token extracted:', linkToken);

    if (!linkToken) {
      console.error('Missing link token for failed payment');
      
      paymentLogger.logWebhookEvent({
        event_type: 'family_callback_failed_validation',
        transaction_uid: transactionId,
        status: 'validation_failed',
        amount: parseFloat(parsedData.amount || parsedData.sum || 0),
        currency: parsedData.currency_code || parsedData.currency || 'ILS',
        customer_email: parsedData.customer_email || parsedData.email || '',
        customer_name: parsedData.customer_name || parsedData.contact || '',
        payment_method: parsedData.payment_method || parsedData.cardtype || '',
        error_details: {
          error_type: 'missing_link_token',
          error_message: 'Missing family payment link token for failed payment'
        }
      });

      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing family payment link token'
      });
    }

    console.log('Checking for existing failed transactions...');

    // Check if this failed transaction has already been processed
    const existingFailedTransaction = await FamilyPaymentTransaction.findOne({
      where: {
        [Op.or]: [
          { payplus_transaction_id: transactionId },
          { transaction_token: `fam_failed_${transactionId}` }
        ],
        status: 'failed'
      },
      transaction
    });

    console.log('Existing failed transaction check completed:', !!existingFailedTransaction);

    if (existingFailedTransaction) {
      console.log('Failed transaction already processed');
      
      paymentLogger.logWebhookEvent({
        event_type: 'family_callback_failed_duplicate',
        transaction_uid: transactionId,
        status: 'duplicate',
        amount: parseFloat(parsedData.amount || parsedData.sum || 0),
        currency: parsedData.currency_code || parsedData.currency || 'ILS',
        customer_email: parsedData.customer_email || parsedData.email || '',
        customer_name: parsedData.customer_name || parsedData.contact || '',
        payment_method: parsedData.payment_method || parsedData.cardtype || '',
        processing_result: {
          duplicate_prevented: true,
          existing_transaction_id: existingFailedTransaction.id
        }
      });

      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(200).json({
        status: 'success',
        data: {
          transaction_id: transactionId,
          status: 'failed'
        },
        message: 'Family failed payment already processed'
      });
    }

    console.log('Normalizing data for failed webhook processing...');

    // Normalize the parsed data to family payment format
    const normalizedData = {
      transaction_uid: transactionId,
      amount: parseFloat(parsedData.amount || parsedData.sum || 0),
      currency_code: parsedData.currency_code || parsedData.currency || 'ILS',
      customer_name: parsedData.customer_name || parsedData.contact || '',
      customer_email: parsedData.customer_email || parsedData.email || '',
      payment_method: parsedData.payment_method || parsedData.cardtype || '',
      four_digits: parsedData.four_digits || parsedData.ccno || '',
      status_code: parsedData.status_code || parsedData.error_code || parsedData.Response || 'unknown_error',
      more_info_1: linkToken,
      more_info_2: parsedData.more_info_2 || parsedData.children_count || '',
      more_info_3: parsedData.more_info_3 || parsedData.families_count || '',
      more_info_4: parsedData.more_info_4 || parsedData.short_id || '',
      more_info_5: parsedData.more_info_5 || '',
      is_recurring: parsedData.recurring || parsedData.charge_method === '3' || false,
      recurring_info: {},
      original_webhook: parsedData
    };

    console.log('Data normalized successfully');
    console.log('Normalized failed data summary:', {
      transaction_uid: normalizedData.transaction_uid,
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      link_token: normalizedData.more_info_1,
      customer: normalizedData.customer_name,
      error_code: normalizedData.status_code
    });

    console.log('Starting family failed payment webhook processing...');

    // Process the family failed payment with proper error handling
    try {
      await processFamilyPaymentFailedWebhook(normalizedData, null, transaction);
      console.log('Family failed payment webhook processing completed');
    } catch (webhookError) {
      console.error('Error in processFamilyPaymentFailedWebhook:', webhookError);
      
      // Log webhook processing error
      paymentLogger.logWebhookEvent({
        event_type: 'family_callback_failed_webhook_error',
        transaction_uid: transactionId,
        status: 'error',
        amount: normalizedData.amount,
        currency: normalizedData.currency_code,
        customer_email: normalizedData.customer_email,
        customer_name: normalizedData.customer_name,
        payment_method: normalizedData.payment_method,
        error_details: {
          error_type: 'failed_webhook_processing_error',
          error_message: webhookError.message,
          error_stack: webhookError.stack
        }
      });

      throw webhookError; // Re-throw to be caught by main error handler
    }

    console.log('Committing database transaction...');
    await transaction.commit();
    console.log('Database transaction committed successfully');

    const processingTime = Date.now() - processingStartTime;

    // Log successful family failed processing
    paymentLogger.logWebhookEvent({
      event_type: 'family_callback_failed_complete',
      transaction_uid: transactionId,
      status: 'failed',
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      customer_email: normalizedData.customer_email,
      customer_name: normalizedData.customer_name,
      payment_method: normalizedData.payment_method,
      error_details: {
        payment_failure_code: normalizedData.status_code,
        payment_failure_reason: 'Family payment failed at processor level'
      },
      processing_result: {
        processing_time_ms: processingTime,
        family_failed_callback_processed: true,
        failure_recorded: true,
        link_token: linkToken,
        payment_link_kept_active: true
      }
    });

    console.log(`Family failed payment processing completed successfully in ${processingTime}ms`);

    clearTimeout(timeout);

    return res.status(200).json({
      status: 'success',
      data: {
        transaction_id: transactionId,
        status: 'failed',
        link_token: linkToken,
        processing_time_ms: processingTime,
        retry_available: true
      },
      message: 'Family failed payment processed successfully'
    });

  } catch (error) {
    console.error('Critical error in processFamilyPaymentFailed:', error);

    if (transaction) {
      try {
        console.log('Rolling back database transaction...');
        await transaction.rollback();
        console.log('Database transaction rolled back successfully');
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError);
        
        paymentLogger.logWebhookEvent({
          event_type: 'family_failed_transaction_rollback_error',
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

    const processingTime = Date.now() - processingStartTime;

    // Log family failed processing error
    paymentLogger.logWebhookEvent({
      event_type: 'family_callback_failed_error',
      transaction_uid: 'unknown',
      status: 'error',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      error_details: {
        error_type: 'family_failed_processing_error',
        error_message: error.message,
        error_stack: error.stack,
        processing_time_ms: processingTime
      },
      webhook_payload: req.body
    });

    clearTimeout(timeout);

    // Ensure we send a response
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: 'Error processing family failed payment',
        details: error.message,
        processing_time_ms: processingTime
      });
    }
  }
};

/**
 * Process family payment failed webhook - handles family-specific failure logic
 * @param {Object} webhookData - Extracted PayPlus webhook data
 * @param {Number} webhookLogId - ID of the webhook log entry (can be null)
 * @param {Object} transaction - Database transaction
 */
const processFamilyPaymentFailedWebhook = async (webhookData, webhookLogId, transaction) => {
  try {
    const {
      transaction_uid,
      amount,
      currency_code,
      customer_name,
      customer_email,
      payment_method,
      four_digits,
      status_code,
      more_info_1: linkToken,
      more_info_2: childrenCount,
      more_info_3: familiesCount,
      more_info_4: shortId,
      more_info_5: encodedData,
      is_recurring,
      recurring_info
    } = webhookData;

    console.log(`Processing family failed payment: ${transaction_uid} for link: ${linkToken}`);

    // Log family payment verification start
    paymentLogger.logPaymentVerification({
      student_id: linkToken || 'unknown',
      student_name: customer_name || 'unknown',
      subscription_id: null,
      verification_type: 'family_failed_payment_processing',
      verification_result: false,
      error_details: {
        transaction_uid: transaction_uid,
        failure_reason: `Payment failed with status: ${status_code}`,
        amount: amount,
        currency: currency_code
      }
    });

    // Validate required fields
    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      throw new Error('Transaction UID is required for family failed payment processing');
    }

    if (!linkToken || linkToken === 'undefined' || linkToken === '') {
      throw new Error('Link token is required for family failed payment processing');
    }

    // Find the family payment link
    const familyPaymentLink = await FamilyPaymentLink.findOne({
      where: { link_token: linkToken },
      transaction
    });

    if (!familyPaymentLink) {
      paymentLogger.logPaymentVerification({
        student_id: linkToken,
        student_name: customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'family_failed_payment_link_lookup',
        verification_result: false,
        error_details: {
          message: 'Family payment link not found for failed payment',
          link_token: linkToken
        }
      });
      throw new Error(`Family payment link not found for token: ${linkToken}`);
    }

    console.log(`Found family payment link: ${familyPaymentLink.id}`);

    // SAFE JSON PARSING: Handle selected_children_details properly for failed payment
    let selectedChildren = [];
    
    try {
      const rawChildrenData = familyPaymentLink.selected_children_details;
      console.log('Raw children data type for failed payment:', typeof rawChildrenData);
      console.log('Raw children data:', rawChildrenData);
      
      if (rawChildrenData) {
        if (typeof rawChildrenData === 'string') {
          // Parse JSON string
          selectedChildren = JSON.parse(rawChildrenData);
          console.log('Parsed children data from JSON string');
        } else if (Array.isArray(rawChildrenData)) {
          // Already an array
          selectedChildren = rawChildrenData;
          console.log('Children data already an array');
        } else if (typeof rawChildrenData === 'object') {
          // Convert object to array if possible
          if (rawChildrenData.length !== undefined) {
            selectedChildren = Array.from(rawChildrenData);
            console.log('Converted object to array');
          } else {
            // Single object, wrap in array
            selectedChildren = [rawChildrenData];
            console.log('Wrapped single object in array');
          }
        } else {
          console.error('Unexpected children data type:', typeof rawChildrenData);
          selectedChildren = [];
        }
      }
      
      console.log('Final selectedChildren type:', typeof selectedChildren);
      console.log('Final selectedChildren is array:', Array.isArray(selectedChildren));
      console.log('Final selectedChildren length:', selectedChildren.length);
      
    } catch (parseError) {
      console.error('Error parsing selected_children_details for failed payment:', parseError);
      console.log('Raw data that failed to parse:', familyPaymentLink.selected_children_details);
      
      paymentLogger.logPaymentVerification({
        student_id: linkToken,
        student_name: customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'family_failed_children_data_parse_error',
        verification_result: false,
        error_details: {
          error_type: 'json_parse_error',
          error_message: parseError.message,
          raw_data: familyPaymentLink.selected_children_details
        }
      });
      
      // Try to recover by creating a minimal structure
      selectedChildren = [];
    }

    // Ensure selectedChildren is an array
    if (!Array.isArray(selectedChildren)) {
      console.error('selectedChildren is not an array after processing:', typeof selectedChildren);
      selectedChildren = [];
    }

    if (selectedChildren.length === 0) {
      console.warn('No children found in family payment link after parsing - proceeding with minimal data');
    }

    console.log(`Processing failed payment for ${selectedChildren.length} children`);

    // Parse additional encoded data if available
    let additionalFamilyData = {};
    if (encodedData && encodedData !== '' && encodedData !== 'undefined') {
      try {
        const urlDecoded = decodeURIComponent(encodedData);
        const base64Decoded = Buffer.from(urlDecoded, 'base64').toString('utf8');
        additionalFamilyData = JSON.parse(base64Decoded);
        console.log('Successfully parsed additional family data for failed payment:', Object.keys(additionalFamilyData));
      } catch (error) {
        console.warn('Failed to parse additional family data for failed payment:', error.message);
        additionalFamilyData = {};
      }
    }

    // Create family payment transaction record for failed payment
    const familyTransactionData = {
      payment_link_id: familyPaymentLink.id,
      transaction_token: `fam_failed_${transaction_uid}`,
      payplus_transaction_id: transaction_uid,
      family_id: selectedChildren[0]?.familyId || null,
      paid_children_ids: [], // Empty for failed payments
      paid_children_details: selectedChildren,
      amount: amount,
      currency: currency_code || 'ILS',
      payment_type: familyPaymentLink.payment_type,
      status: 'failed',
      payment_method: payment_method || 'unknown',
      card_last_digits: four_digits ? four_digits.slice(-4) : null,
      error_code: status_code,
      error_message: `Family payment failed with status: ${status_code}`,
      payplus_response_data: JSON.stringify(webhookData.original_webhook || webhookData),
      processed_at: new Date()
    };

    const familyPaymentTransaction = await FamilyPaymentTransaction.create(familyTransactionData, { transaction });
    console.log(`Created family failed payment transaction: ${familyPaymentTransaction.id}`);

    // Keep payment link active for retry (don't mark as used)
    // Only update if not already expired or cancelled
    if (familyPaymentLink.status === 'active') {
      console.log('Payment link kept active for retry');
      // Don't update status - keep it active so they can retry
    }

    // Process each family for status updates and activity logging
    const processedFamilies = new Set();
    for (const childDetail of selectedChildren) {
      if (!childDetail.childId) {
        console.warn(`Skipping child without ID for failed payment:`, childDetail);
        continue;
      }

      // Add family to processed set and log failed payment activity
      if (childDetail.familyId && !processedFamilies.has(childDetail.familyId)) {
        processedFamilies.add(childDetail.familyId);

        // Log family activity for failed payment
        await FamilyActivityLog.create({
          family_id: childDetail.familyId,
          user_id: familyPaymentLink.sales_user_id || 1,
          action_type: 'payment_completed', // Keep same type but with failure details
          action_description: `Family payment FAILED. Transaction: ${transaction_uid}. Error: ${status_code}. Payment link remains active for retry.`,
          new_values: {
            transaction_id: transaction_uid,
            amount: amount,
            currency: currency_code,
            payment_type: familyPaymentLink.payment_type,
            children_count: selectedChildren.filter(c => c.familyId === childDetail.familyId).length,
            payment_status: 'failed',
            error_code: status_code,
            retry_available: true
          },
          metadata: {
            payplus_transaction_id: transaction_uid,
            payment_link_id: familyPaymentLink.id,
            family_payment_transaction_id: familyPaymentTransaction.id,
            failure_details: {
              status_code: status_code,
              error_message: familyTransactionData.error_message,
              payment_method: payment_method,
              card_last_digits: four_digits ? four_digits.slice(-4) : null
            }
          }
        }, { transaction });

        console.log(`Logged failed payment activity for family ${childDetail.familyId}`);
      }
    }

    // Send failure notification emails to families (don't wait for completion)
    const emailPromises = [];
    for (const familyId of processedFamilies) {
      try {
        const family = await Family.findByPk(familyId, {
          include: [{
            model: FamilyChild,
            as: 'children',
            where: { id: { [Op.in]: selectedChildren.map(c => c.childId) } },
            required: false
          }],
          transaction
        });

        if (family && family.parent_email) {
          const familyChildren = selectedChildren.filter(c => c.familyId === familyId);
          
          emailPromises.push(
            sendFamilyPaymentFailureEmail(
              family.parent_email,
              family.parent_name,
              familyChildren,
              {
                transaction_id: transaction_uid,
                amount: familyChildren.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0),
                currency: currency_code,
                payment_type: familyPaymentLink.payment_type,
                error_code: status_code,
                retry_link_token: linkToken
              }
            )
          );
        }
      } catch (emailError) {
        console.error(`Error preparing failure email for family ${familyId}:`, emailError.message);
      }
    }

    // Send failure emails (don't wait for completion to avoid blocking)
    Promise.all(emailPromises).then(() => {
      console.log(`Sent failure notification emails to ${emailPromises.length} families`);
    }).catch(error => {
      console.error('Error sending failure notification emails:', error);
    });

    // Final verification logging
    paymentLogger.logPaymentVerification({
      student_id: linkToken,
      student_name: customer_name || 'Family Failed Payment',
      subscription_id: familyPaymentTransaction.id,
      verification_type: 'family_failed_payment_processing_complete',
      verification_result: true, // Processing completed successfully even though payment failed
      subscription_details: {
        family_payment_transaction_id: familyPaymentTransaction.id,
        families_processed: processedFamilies.size,
        children_processed: selectedChildren.length,
        total_amount: amount,
        currency: currency_code,
        is_recurring: is_recurring,
        payment_link_kept_active: true,
        failure_code: status_code
      },
      error_details: {
        payment_failure_code: status_code,
        payment_failure_message: familyTransactionData.error_message,
        payment_method: payment_method,
        card_last_digits: four_digits ? four_digits.slice(-4) : null
      }
    });

    console.log(`Successfully processed family failed payment: ${transaction_uid}`);

    // Log summary
    console.log(`Family failed payment processing summary:`, {
      transactionId: transaction_uid,
      linkToken: linkToken,
      familiesProcessed: processedFamilies.size,
      childrenProcessed: selectedChildren.length,
      totalAmount: amount,
      currency: currency_code,
      errorCode: status_code,
      isRecurring: is_recurring,
      failedPaymentTransactionId: familyPaymentTransaction.id,
      paymentLinkKeptActive: true,
      retryAvailable: true
    });

  } catch (error) {
    console.error('Error in processFamilyPaymentFailedWebhook:', error);
    
    // Log processing error
    paymentLogger.logPaymentVerification({
      student_id: webhookData.more_info_1 || 'unknown',
      student_name: webhookData.customer_name || 'unknown',
      subscription_id: null,
      verification_type: 'family_failed_payment_processing_error',
      verification_result: false,
      error_details: {
        error_type: 'family_failed_processing_exception',
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
 * Send family payment failure notification email
 * @param {String} parentEmail - Parent email address
 * @param {String} parentName - Parent name
 * @param {Array} children - Array of children details
 * @param {Object} failureDetails - Failure transaction details
 */
const sendFamilyPaymentFailureEmail = async (parentEmail, parentName, children, failureDetails) => {
  try {
    const emailParams = {
      parent_name: parentName,
      children_count: children.length,
      children_names: children.map(c => c.childName).join(', '),
      attempted_amount: failureDetails.amount,
      currency: failureDetails.currency,
      transaction_id: failureDetails.transaction_id,
      error_code: failureDetails.error_code,
      retry_url: `${process.env.FRONTEND_URL}/family-payment/${failureDetails.retry_link_token}`,
      failure_date: new Date().toLocaleDateString(),
      support_email: process.env.SUPPORT_EMAIL || 'support@tulkka.com'
    };

    const emailResult = await sendCombinedNotifications(
      'family_payment_failure', // You'll need this email template
      emailParams,
      {
        email: parentEmail,
        full_name: parentName,
        language: 'EN'
      },
      false
    );

    if (emailResult.emailSent) {
      console.log(`Family payment failure email sent to ${parentEmail}`);
    } else {
      console.error(`Failed to send family payment failure email to ${parentEmail}`);
    }

    return emailResult;
  } catch (error) {
    console.error('Error sending family payment failure email:', error);
    return { emailSent: false, error: error.message };
  }
};

/**
 * Handle family payment failed page callback - GET endpoint (if needed)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleFamilyPaymentFailedPage = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment token is required'
      });
    }

    // Verify the family payment link exists and get details
    const familyPaymentLink = await FamilyPaymentLink.findOne({
      where: { link_token: token },
      include: [{
        model: FamilyPaymentTransaction,
        as: 'transactions',
        where: { status: 'failed' },
        required: false,
        limit: 5,
        order: [['created_at', 'DESC']]
      }]
    });

    if (!familyPaymentLink) {
      return res.status(404).json({
        status: 'error',
        message: 'Family payment link not found'
      });
    }

    const hasFailedPayments = familyPaymentLink.transactions && familyPaymentLink.transactions.length > 0;
    
    return res.status(200).json({
      status: 'success',
      data: {
        payment_link: familyPaymentLink,
        has_failed_payments: hasFailedPayments,
        failed_transactions: hasFailedPayments ? familyPaymentLink.transactions : [],
        children_count: familyPaymentLink.selected_children_details?.length || 0,
        total_amount: familyPaymentLink.total_amount,
        currency: familyPaymentLink.currency,
        payment_type: familyPaymentLink.payment_type,
        retry_available: familyPaymentLink.status === 'active'
      },
      message: 'Family payment failure details retrieved successfully'
    });

  } catch (error) {
    console.error('Error handling family payment failed page:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = {
  processFamilyPaymentFailed,
  processFamilyPaymentFailedWebhook,
  sendFamilyPaymentFailureEmail,
  handleFamilyPaymentFailedPage
};