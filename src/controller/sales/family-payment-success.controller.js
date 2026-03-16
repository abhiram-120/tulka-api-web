const { Family, FamilyChild, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog, FamilyCartItem } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const RecurringPayment = require('../../models/RecurringPayment');
const { paymentLogger } = require('../../utils/paymentLogger');
const { sequelize } = require('../../connection/connection');
const { Sequelize } = require('sequelize');
const securePassword = require('../../utils/encryptPassword');
const { sendCombinedNotifications } = require('../../cronjobs/reminder');
const { Op } = require('sequelize');
const moment = require('moment');
const axios = require('axios');

/**
 * Generate a unique transaction ID when one is missing
 * @returns {String} - Unique transaction ID
 */
const generateTransactionId = () => {
  return `fam_txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Parse the PayPlus response data with enhanced error handling and debugging
 * @param {Object} body - Request body from PayPlus
 * @returns {Object} - Parsed data
 */
const parsePayPlusResponse = (body) => {
  try {
    console.log('=== parsePayPlusResponse DEBUG ===');
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
      event_type: 'family_payplus_response_parse_error',
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
 * Extract webhook data from PayPlus format for family payments
 * @param {Object} webhookBody - PayPlus webhook body
 * @returns {Object} - Extracted data with standard field names
 */
const extractFamilyWebhookData = (webhookBody) => {
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

      // Payment details
      payment_method: cardInfo.brand_id ? 'credit_card' : (data.payment_method || transaction.payment_method || 'unknown'),
      four_digits: cardInfo.four_digits || cardInfo.last_four_digits || data.four_digits || '',
      approval_number: transaction.approval_number || data.approval_number || '',
      voucher_number: transaction.voucher_number || data.voucher_number || '',

      // Card information
      card_brand: cardInfo.brand_name || cardInfo.brand || '',
      card_type: cardInfo.type || '',
      card_expiry: cardInfo.expiry_date || '',

      // Additional info fields - FAMILY SPECIFIC
      more_info: transaction.more_info || data.more_info || '',
      more_info_1: transaction.more_info_1 || data.more_info_1 || '', // link_token
      more_info_2: transaction.more_info_2 || data.more_info_2 || '', // children_count
      more_info_3: transaction.more_info_3 || data.more_info_3 || '', // families_count
      more_info_4: transaction.more_info_4 || data.more_info_4 || '', // short_id
      more_info_5: transaction.more_info_5 || data.more_info_5 || '', // encoded_family_data

      // Recurring payment details
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
      is_recurring: transaction.type === 'recurring' || data.type === 'recurring' || false,

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
      event_type: 'family_webhook_data_extraction',
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
        page_request_uid: extractedData.page_request_uid,
        is_family_payment: true
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
    console.error('Error extracting family webhook data:', error);
    
    // Log extraction error
    paymentLogger.logWebhookEvent({
      event_type: 'family_webhook_data_extraction_error',
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
 * Robust link token extraction with multiple fallback strategies
 * @param {Object} parsedData - Parsed PayPlus response data  
 * @param {Object} originalBody - Original request body as fallback
 * @returns {String} - Extracted link token or empty string
 */
const extractLinkToken = (parsedData, originalBody = {}) => {
  console.log('=== ROBUST TOKEN EXTRACTION ===');
  
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
 * Process successful family payment callback from PayPlus - COMPLETE VERSION
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processFamilyPaymentSuccess = async (req, res) => {
  let transaction;
  const processingStartTime = Date.now();
  
  const timeout = setTimeout(() => {
    console.error('Family payment processing timeout - force responding');
    if (!res.headersSent) {
      res.status(408).json({
        status: 'error',
        message: 'Payment processing timeout',
        details: 'Processing took longer than expected'
      });
    }
  }, 30000);

  try {
    console.log('Starting family payment success processing...');
    
    transaction = await sequelize.transaction();
    console.log('Database transaction started');

    // Parse the PayPlus response data
    const parsedData = parsePayPlusResponse(req.body);
    console.log('Data parsed successfully:', parsedData);

    paymentLogger.logWebhookEvent({
      event_type: 'family_callback_success',
      transaction_uid: 'parsing',
      status: 'processing',
      amount: null,
      currency: null,
      customer_email: null,
      customer_name: null,
      payment_method: null,
      processing_result: {
        callback_type: 'family_success',
        processing_start_time: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      },
      webhook_payload: req.body
    });

    console.log('Initial webhook event logged');

    // FIX: Check if data is nested under 'params'
    const dataSource = parsedData.params || parsedData;
    console.log('Using data source:', dataSource.more_info_1 ? 'params' : 'direct');

    // Extract transaction ID
    const transactionId = dataSource.transaction_uid ||
      dataSource.transaction_id ||
      dataSource.index ||
      generateTransactionId();

    console.log('Transaction ID extracted:', transactionId);

    if (!transactionId || transactionId === 'undefined' || transactionId === '') {
      console.error('Invalid transaction ID');
      
      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing or invalid transaction ID parameters'
      });
    }

    // Extract link token
    const linkToken = extractLinkToken(dataSource, req.body);
    console.log('Link token extracted:', linkToken);

    if (!linkToken) {
      console.error('Missing link token');
      
      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing family payment link token'
      });
    }

    // FIX: Extract more_info fields from correct location
    console.log('Extracting more_info fields...');
    console.log('dataSource.more_info_2:', dataSource.more_info_2);
    console.log('dataSource.more_info_3:', dataSource.more_info_3);

    const moreInfo2 = dataSource.more_info_2 || '';
    const moreInfo3 = dataSource.more_info_3 || '';

    console.log('Extracted more_info_2:', moreInfo2);
    console.log('Extracted more_info_3:', moreInfo3);

    // Validate that we have child and family IDs
    if (!moreInfo2 || moreInfo2 === '' || moreInfo2 === 'undefined') {
      console.error('Missing more_info_2 (child IDs)');
      
      paymentLogger.logWebhookEvent({
        event_type: 'family_callback_validation_failed',
        transaction_uid: transactionId,
        status: 'failed',
        amount: parseFloat(dataSource.amount || dataSource.sum || 0),
        currency: dataSource.currency_code || dataSource.currency || 'ILS',
        customer_email: dataSource.customer_email || dataSource.email || '',
        customer_name: dataSource.customer_name || dataSource.contact || '',
        payment_method: dataSource.payment_method || dataSource.cardtype || '',
        error_details: {
          error_type: 'missing_more_info_2',
          error_message: 'No child IDs found in more_info_2',
          parsedData_keys: Object.keys(parsedData),
          dataSource_keys: Object.keys(dataSource),
          more_info_2_value: moreInfo2
        }
      });

      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'No child IDs found in more_info_2',
        details: 'Family payment requires child IDs in more_info_2'
      });
    }

    if (!moreInfo3 || moreInfo3 === '' || moreInfo3 === 'undefined') {
      console.error('Missing more_info_3 (family IDs)');
      
      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'No family IDs found in more_info_3',
        details: 'Family payment requires family IDs in more_info_3'
      });
    }

    console.log('Checking for existing transactions...');

    const existingTransaction = await FamilyPaymentTransaction.findOne({
      where: {
        [Op.or]: [
          { payplus_transaction_id: transactionId },
          { transaction_token: transactionId }
        ],
        status: 'success'
      },
      transaction
    });

    if (existingTransaction) {
      console.log('Transaction already processed');
      
      clearTimeout(timeout);
      if (transaction) await transaction.rollback();
      return res.status(200).json({
        status: 'success',
        data: {
          transaction_id: transactionId,
          status: 'success'
        },
        message: 'Family payment already processed'
      });
    }

    console.log('Normalizing data for webhook processing...');

    // Normalize the parsed data to family payment format
    const normalizedData = {
      transaction_uid: transactionId,
      amount: parseFloat(dataSource.amount || dataSource.sum || 0),
      currency_code: dataSource.currency_code || dataSource.currency || 'ILS',
      customer_name: dataSource.customer_name || dataSource.contact || '',
      customer_email: dataSource.customer_email || dataSource.email || '',
      payment_method: dataSource.payment_method || dataSource.method || dataSource.cardtype || '',
      four_digits: dataSource.four_digits || dataSource.ccno || '',
      more_info_1: linkToken,
      more_info_2: moreInfo2, // Child IDs as JSON string "[20,21]"
      more_info_3: moreInfo3, // Family IDs as JSON string "[5]"
      more_info_4: dataSource.more_info_4 || dataSource.short_id || '',
      more_info_5: dataSource.more_info_5 || '',
      is_recurring: dataSource.recurring || dataSource.charge_method === '3' || 
                   dataSource.more_info_4 === 'recurring' || 
                   !!dataSource.recurring_payment_uid || false,
      recurring_info: {
        recurring_uid: dataSource.recurring_payment_uid || dataSource.recurring_uid || null,
        recurring_id: dataSource.recurring_id || null,
        page_request_uid: dataSource.page_request_uid || null
      },
      original_webhook: dataSource
    };

    console.log('Data normalized successfully');
    console.log('Normalized data summary:', {
      transaction_uid: normalizedData.transaction_uid,
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      link_token: normalizedData.more_info_1,
      more_info_2: normalizedData.more_info_2,
      more_info_3: normalizedData.more_info_3,
      is_recurring: normalizedData.is_recurring,
      customer: normalizedData.customer_name
    });

    console.log('Starting family payment webhook processing...');

    try {
      await processFamilyPaymentWebhook(normalizedData, null, transaction);
      console.log('Family payment webhook processing completed');
    } catch (webhookError) {
      console.error('Error in processFamilyPaymentWebhook:', webhookError);
      throw webhookError;
    }

    console.log('Committing database transaction...');
    await transaction.commit();
    console.log('Database transaction committed successfully');

    const processingTime = Date.now() - processingStartTime;

    paymentLogger.logWebhookEvent({
      event_type: 'family_callback_success_complete',
      transaction_uid: transactionId,
      status: 'success',
      amount: normalizedData.amount,
      currency: normalizedData.currency_code,
      customer_email: normalizedData.customer_email,
      customer_name: normalizedData.customer_name,
      payment_method: normalizedData.payment_method,
      processing_result: {
        processing_time_ms: processingTime,
        family_callback_processed: true,
        data_normalized: true,
        link_token: linkToken,
        child_ids: moreInfo2,
        family_ids: moreInfo3
      }
    });

    console.log(`Family payment processing completed successfully in ${processingTime}ms`);

    clearTimeout(timeout);

    return res.status(200).json({
      status: 'success',
      data: {
        transaction_id: transactionId,
        status: 'success',
        link_token: linkToken,
        processing_time_ms: processingTime
      },
      message: 'Family payment processed successfully'
    });

  } catch (error) {
    console.error('Critical error in processFamilyPaymentSuccess:', error);

    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError);
      }
    }

    const processingTime = Date.now() - processingStartTime;

    clearTimeout(timeout);

    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: 'Error processing family payment',
        details: error.message,
        processing_time_ms: processingTime
      });
    }
  }
};

/**
 * Process family payment webhook - handles family-specific logic with proper JSON parsing and student registration
 * @param {Object} webhookData - Extracted PayPlus webhook data
 * @param {Number} webhookLogId - ID of the webhook log entry (can be null)
 * @param {Object} transaction - Database transaction
 */
const processFamilyPaymentWebhook = async (webhookData, webhookLogId, transaction) => {
  try {
    const {
      transaction_uid,
      amount,
      currency_code,
      customer_name,
      customer_email,
      payment_method,
      four_digits,
      more_info_1: linkToken,
      more_info_2: childrenIdsJson, // JSON array of child IDs
      more_info_3: familyIdsJson,   // JSON array of family IDs
      more_info_4: shortId,
      more_info_5: encodedData,
      is_recurring,
      recurring_info
    } = webhookData;

    console.log(`Processing family payment: ${transaction_uid} for link: ${linkToken}`);
    console.log('Child IDs JSON:', childrenIdsJson);
    console.log('Family IDs JSON:', familyIdsJson);

    // Log family payment verification start
    paymentLogger.logPaymentVerification({
      student_id: linkToken || 'unknown',
      student_name: customer_name || 'unknown',
      subscription_id: null,
      verification_type: 'family_payment_processing',
      verification_result: false,
      error_details: null
    });

    // Validate required fields
    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      throw new Error('Transaction UID is required for family payment processing');
    }

    if (!linkToken || linkToken === 'undefined' || linkToken === '') {
      throw new Error('Link token is required for family payment processing');
    }

    // NEW: Parse child IDs from more_info_2
    let childIds = [];
    try {
      if (childrenIdsJson && childrenIdsJson !== '' && childrenIdsJson !== 'undefined') {
        childIds = JSON.parse(childrenIdsJson);
        console.log('Parsed child IDs:', childIds);
        
        if (!Array.isArray(childIds)) {
          console.error('Child IDs is not an array:', typeof childIds);
          childIds = [];
        }
      }
    } catch (parseError) {
      console.error('Error parsing child IDs from more_info_2:', parseError);
      paymentLogger.logPaymentVerification({
        student_id: linkToken,
        student_name: customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'child_ids_parse_error',
        verification_result: false,
        error_details: {
          error_type: 'json_parse_error',
          error_message: parseError.message,
          raw_data: childrenIdsJson
        }
      });
      childIds = [];
    }

    if (childIds.length === 0) {
      throw new Error('No child IDs found in more_info_2');
    }

    // NEW: Parse family IDs from more_info_3
    let familyIds = [];
    try {
      if (familyIdsJson && familyIdsJson !== '' && familyIdsJson !== 'undefined') {
        familyIds = JSON.parse(familyIdsJson);
        console.log('Parsed family IDs:', familyIds);
        
        if (!Array.isArray(familyIds)) {
          console.error('Family IDs is not an array:', typeof familyIds);
          familyIds = [];
        }
      }
    } catch (parseError) {
      console.error('Error parsing family IDs from more_info_3:', parseError);
      paymentLogger.logPaymentVerification({
        student_id: linkToken,
        student_name: customer_name || 'unknown',
        subscription_id: null,
        verification_type: 'family_ids_parse_error',
        verification_result: false,
        error_details: {
          error_type: 'json_parse_error',
          error_message: parseError.message,
          raw_data: familyIdsJson
        }
      });
      familyIds = [];
    }

    if (familyIds.length === 0) {
      throw new Error('No family IDs found in more_info_3');
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
        verification_type: 'family_payment_link_lookup',
        verification_result: false,
        error_details: {
          message: 'Family payment link not found',
          link_token: linkToken
        }
      });
      throw new Error(`Family payment link not found for token: ${linkToken}`);
    }

    console.log(`Found family payment link: ${familyPaymentLink.id}`);

    // NEW: Fetch children from database using child IDs from more_info_2
    console.log(`Fetching ${childIds.length} children from database using IDs:`, childIds);
    
    const familyChildren = await FamilyChild.findAll({
      where: {
        id: {
          [Op.in]: childIds
        }
      },
      include: [{
        model: Family,
        as: 'family',
        attributes: ['id', 'parent_email', 'parent_name', 'parent_phone', 'parent_country_code']
      }],
      transaction
    });

    if (familyChildren.length === 0) {
      throw new Error(`No children found with IDs: ${childIds.join(', ')}`);
    }

    console.log(`Successfully fetched ${familyChildren.length} children from database`);

    // NEW: Fetch families from database using family IDs from more_info_3
    console.log(`Fetching ${familyIds.length} families from database using IDs:`, familyIds);
    
    const families = await Family.findAll({
      where: {
        id: {
          [Op.in]: familyIds
        }
      },
      transaction
    });

    if (families.length === 0) {
      throw new Error(`No families found with IDs: ${familyIds.join(', ')}`);
    }

    console.log(`Successfully fetched ${families.length} families from database`);

    // Get selected children details from payment link for additional info (amounts, plan details)
    let selectedChildrenDetails = [];
    try {
      const rawChildrenData = familyPaymentLink.selected_children_details;
      
      if (rawChildrenData) {
        if (typeof rawChildrenData === 'string') {
          selectedChildrenDetails = JSON.parse(rawChildrenData);
        } else if (Array.isArray(rawChildrenData)) {
          selectedChildrenDetails = rawChildrenData;
        } else if (typeof rawChildrenData === 'object') {
          if (rawChildrenData.length !== undefined) {
            selectedChildrenDetails = Array.from(rawChildrenData);
          } else {
            selectedChildrenDetails = [rawChildrenData];
          }
        }
      }
      
      console.log(`Parsed ${selectedChildrenDetails.length} children details from payment link`);
      
    } catch (parseError) {
      console.error('Error parsing selected_children_details:', parseError);
      selectedChildrenDetails = [];
    }

    // Create a map of child details by childId for easy lookup
    const childDetailsMap = {};
    selectedChildrenDetails.forEach(detail => {
      if (detail.childId) {
        childDetailsMap[detail.childId] = detail;
      }
    });

    // Merge database children with payment details
    const selectedChildren = familyChildren.map(child => {
      const paymentDetail = childDetailsMap[child.id] || {};
      
      return {
        childId: child.id,
        childName: child.child_name,
        familyId: child.family_id,
        parentName: child.family?.parent_name || '',
        parentEmail: child.family?.parent_email || '',
        parentPhone: child.family?.parent_phone || '',
        relationshipToParent: child.relationship_to_parent,
        planType: paymentDetail.planType || 'default',
        durationMonths: paymentDetail.durationMonths || child.durationmonths || 1,
        durationName: paymentDetail.durationName || 'Monthly',
        lessonMinutes: paymentDetail.lessonMinutes || 25,
        lessonsPerMonth: paymentDetail.lessonsPerMonth || 4,
        amount: paymentDetail.amount || child.monthly_amount || 0,
        planDescription: paymentDetail.planDescription || 'Learning Plan',
        ...paymentDetail
      };
    });

    console.log(`Merged ${selectedChildren.length} children with payment details`);

    // Parse additional encoded data if available
    let additionalFamilyData = {};
    if (encodedData && encodedData !== '' && encodedData !== 'undefined') {
      try {
        const urlDecoded = decodeURIComponent(encodedData);
        const base64Decoded = Buffer.from(urlDecoded, 'base64').toString('utf8');
        additionalFamilyData = JSON.parse(base64Decoded);
        console.log('Successfully parsed additional family data:', Object.keys(additionalFamilyData));
      } catch (error) {
        console.warn('Failed to parse additional family data:', error.message);
        additionalFamilyData = {};
      }
    }

    // Create family payment transaction record
    const familyTransactionData = {
      payment_link_id: familyPaymentLink.id,
      transaction_token: `fam_${transaction_uid}`,
      payplus_transaction_id: transaction_uid,
      family_id: familyIds[0],
      paid_children_ids: childIds,
      paid_children_details: selectedChildren,
      amount: amount,
      currency: currency_code || 'ILS',
      payment_type: familyPaymentLink.payment_type,
      status: 'success',
      payment_method: payment_method || 'unknown',
      card_last_digits: four_digits ? four_digits.slice(-4) : null,
      payplus_response_data: JSON.stringify(webhookData.original_webhook || webhookData),
      processed_at: new Date()
    };

    const familyPaymentTransaction = await FamilyPaymentTransaction.create(familyTransactionData, { transaction });
    console.log(`Created family payment transaction: ${familyPaymentTransaction.id}`);

    // ================================
    // STUDENT REGISTRATION LOGIC
    // ================================
    console.log('Starting student registration process...');
    
    const registeredStudentIds = [];

    // Step 1: Register or find the parent user
    try {
      console.log('Processing parent user registration...');
      
      // Get family details from the first child (all children belong to same family)
      const firstChild = familyChildren[0];
      const family = firstChild.family;
      
      if (!family) {
        console.error('No family information found for children');
        throw new Error('Family information missing');
      }

      const parentEmail = family.parent_email;
      const parentName = family.parent_name;
      
      if (!parentEmail) {
        console.error('Parent email is required but missing');
        throw new Error('Parent email is required');
      }

      console.log(`Checking for existing parent user with email: ${parentEmail}`);
      
      // Check if parent already exists
      let parentUser = await User.findOne({
        where: { email: parentEmail },
        transaction
      });

      if (parentUser) {
        console.log(`Parent user already exists with ID: ${parentUser.id}`);
        parentUserId = parentUser.id;
      } else {
        // Create new parent user
        console.log(`Creating new parent user account for: ${parentName}`);
        
        const defaultPassword = '12345678';
        const hashedPassword = await securePassword(defaultPassword);
        
        const parentUserData = {
          full_name: parentName || 'Parent',
          email: parentEmail,
          mobile: family.parent_phone || null,
          country_code: family.parent_country_code || null,
          role_name: 'user', // Keep as 'user' as per requirement
          role_id: 1,
          status: 'active',
          verified: true,
          language: 'EN',
          created_at: Math.floor(Date.now() / 1000),
          password: hashedPassword,
          is_parent: true,
          account_type: 'family_parent'
        };

        parentUser = await User.create(parentUserData, { transaction });
        parentUserId = parentUser.id;
        
        console.log(`Created new parent user account: ${parentUserId} with email ${parentEmail}`);

        paymentLogger.logPaymentVerification({
          student_id: parentUserId.toString(),
          student_name: parentName,
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'family_parent_user_registration',
          verification_result: true,
          subscription_details: {
            parent_email: parentEmail,
            family_id: family.id
          }
        });
      }
    } catch (parentRegistrationError) {
      console.error('Error registering parent user:', parentRegistrationError);
      
      paymentLogger.logPaymentVerification({
        student_id: 'parent_registration_failed',
        student_name: familyChildren[0]?.family?.parent_name || 'unknown',
        subscription_id: familyPaymentTransaction.id,
        verification_type: 'family_parent_user_registration_error',
        verification_result: false,
        error_details: {
          error_type: 'parent_user_registration_error',
          error_message: parentRegistrationError.message,
          family_id: familyChildren[0]?.family_id
        }
      });
    }
    
    // Step 2: Register each child as a student user
    for (const familyChild of familyChildren) {
      try {
        console.log(`Processing student registration for child: ${familyChild.id} - ${familyChild.child_name}`);
        
        const family = familyChild.family;
        
        if (!family || !family.parent_email) {
          console.warn(`No parent email found for child ${familyChild.id}, skipping student registration`);
          continue;
        }

        let studentEmail = '';
        let existingUser = null;

        // Check if child has their own email
        if (familyChild.child_email) {
          // Child has their own email, use it
          studentEmail = familyChild.child_email;
          
          existingUser = await User.findOne({
            where: { email: studentEmail },
            transaction
          });

          if (existingUser) {
            console.log(`User already exists with email ${studentEmail} for child ${familyChild.id}`);
            registeredStudentIds.push(existingUser.id);
            continue;
          }
        } else {
          // Child has no email, generate from parent email + child name
          // Format: parentemail+childname@domain.com
          // Example: ashishsahu18+Rajesh Sahu@gmail.com (with space preserved)
          
          const parentEmail = family.parent_email;
          const childName = familyChild.child_name;
          
          const emailParts = parentEmail.split('@');
          if (emailParts.length !== 2) {
            console.error(`Invalid parent email format: ${parentEmail} for child ${familyChild.id}`);
            continue;
          }

          // Create email with child name (preserving spaces and special characters)
          studentEmail = `${emailParts[0]}+${childName}@${emailParts[1]}`;
          
          console.log(`Generated email for child without email: ${studentEmail}`);
          
          // Check if this generated email already exists
          existingUser = await User.findOne({
            where: { email: studentEmail },
            transaction
          });

          if (existingUser) {
            console.log(`User already exists with generated email ${studentEmail} for child ${familyChild.id}`);
            registeredStudentIds.push(existingUser.id);
            continue;
          }
        }

        // Create new child user
        const defaultPassword = '12345678';
        const hashedPassword = await securePassword(defaultPassword);
        
        const userData = {
          full_name: familyChild.child_name,
          email: studentEmail,
          role_name: 'user', // Keep as 'user' as per requirement
          role_id: 1,
          status: 'active',
          verified: true,
          language: 'EN',
          country_code: family.parent_country_code || null,
          created_at: Math.floor(Date.now() / 1000),
          password: hashedPassword,
          guardian: parentUserId || familyChild.family_id, // Link to parent user if registered, otherwise family_id
          account_type: 'family_child'
        };

        const newUser = await User.create(userData, { transaction });
        registeredStudentIds.push(newUser.id);
        
        console.log(`Created new user account: ${newUser.id} with email ${studentEmail} for child ${familyChild.id}`);

        paymentLogger.logPaymentVerification({
          student_id: newUser.id.toString(),
          student_name: familyChild.child_name,
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'family_child_user_registration',
          verification_result: true,
          subscription_details: {
            child_id: familyChild.id,
            family_id: familyChild.family_id,
            generated_email: studentEmail,
            parent_email: family.parent_email,
            has_own_email: !!familyChild.child_email,
            guardian_user_id: parentUserId
          }
        });

      } catch (childRegistrationError) {
        console.error(`Error registering user for child ${familyChild.id}:`, childRegistrationError);
        
        paymentLogger.logPaymentVerification({
          student_id: familyChild.id.toString(),
          student_name: familyChild.child_name,
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'family_child_user_registration_error',
          verification_result: false,
          error_details: {
            error_type: 'user_registration_error',
            error_message: childRegistrationError.message,
            child_id: familyChild.id,
            family_id: familyChild.family_id
          }
        });
      }
    }

    if (registeredStudentIds.length > 0) {
      await familyPaymentTransaction.update({
        student_ids: registeredStudentIds
      }, { transaction });
      
      console.log(`Updated family payment transaction ${familyPaymentTransaction.id} with ${registeredStudentIds.length} student IDs:`, registeredStudentIds);
    } else {
      console.warn('No students were registered, student_ids array will remain empty');
    }

    // ================================
    // SUBSCRIPTION CREATION LOGIC FOR REGISTERED STUDENTS
    // ================================
    console.log('Starting subscription creation for registered students...');

    if (registeredStudentIds.length > 0) {
      const createdSubscriptionIds = [];

      for (let i = 0; i < registeredStudentIds.length; i++) {
        const studentId = registeredStudentIds[i];
        const childDetail = selectedChildren[i];
        const familyChild = familyChildren[i];

        try {
          console.log(`Creating subscription for student ${studentId} (child: ${familyChild.child_name})`);

          const lessonMinutes = parseInt(childDetail.lessonMinutes || 25);
          const lessonsPerMonth = parseInt(childDetail.lessonsPerMonth || 4);
          const subscriptionMonths = parseInt(childDetail.durationMonths || 1);
          const childAmount = parseFloat(childDetail.amount || 0);

          const subscriptionResult = await createFamilyChildSubscription(
            studentId,
            lessonMinutes,
            lessonsPerMonth,
            subscriptionMonths,
            childAmount,
            is_recurring,
            childDetail,
            familyChild,
            transaction
          );

          createdSubscriptionIds.push(subscriptionResult.subscription_id);

          paymentLogger.logPaymentVerification({
            student_id: studentId.toString(),
            student_name: familyChild.child_name,
            subscription_id: subscriptionResult.subscription_id,
            verification_type: 'family_child_subscription_created',
            verification_result: true,
            subscription_details: {
              child_id: familyChild.id,
              family_id: familyChild.family_id,
              subscription_type: subscriptionResult.subscription_type,
              lesson_minutes: lessonMinutes,
              lessons_per_month: lessonsPerMonth,
              subscription_months: subscriptionMonths,
              amount: childAmount,
              total_lessons: subscriptionResult.total_lessons
            }
          });

        } catch (subscriptionError) {
          console.error(`Error creating subscription for student ${studentId}:`, subscriptionError);

          paymentLogger.logPaymentVerification({
            student_id: studentId.toString(),
            student_name: familyChild?.child_name || 'unknown',
            subscription_id: null,
            verification_type: 'family_child_subscription_creation_error',
            verification_result: false,
            error_details: {
              error_type: 'subscription_creation_error',
              error_message: subscriptionError.message,
              child_id: familyChild?.id,
              family_id: familyChild?.family_id
            }
          });
        }
      }

      console.log(`Created ${createdSubscriptionIds.length} subscriptions for family payment`);

      if (createdSubscriptionIds.length > 0) {
        await familyPaymentTransaction.update({
          subscription_ids: createdSubscriptionIds
        }, { transaction });

        console.log(`Updated family payment transaction with subscription IDs:`, createdSubscriptionIds);
      }
    }

    // Update payment link status
    await familyPaymentLink.update({
      status: 'used',
      used_at: new Date()
    }, { transaction });

    // Process each child to update their subscription status
    const processedFamilies = new Set(familyIds);
    
    for (const familyChild of familyChildren) {
      const childDetail = selectedChildren.find(c => c.childId === familyChild.id) || {};
      
      let subscriptionType;
      const durationMonths = childDetail.durationMonths || familyChild.durationmonths || 1;
      
      if (durationMonths === 1) {
        subscriptionType = 'monthly';
      } else if (durationMonths === 3) {
        subscriptionType = 'quarterly';
      } else if (durationMonths === 12) {
        subscriptionType = 'yearly';
      } else {
        subscriptionType = 'monthly';
      }

      const updateResult = await FamilyChild.update({
        subscription_type: subscriptionType,
        durationmonths: durationMonths,
        monthly_amount: parseFloat(childDetail.amount || familyChild.monthly_amount || 0),
        custom_amount: parseFloat(childDetail.amount || familyChild.custom_amount || 0),
        status: 'active',
        subscription_start_date: new Date(),
        next_payment_date: is_recurring ? moment().add(1, 'month').toDate() : null,
        payplus_subscription_id: is_recurring ? transaction_uid : null
      }, {
        where: { id: familyChild.id },
        transaction
      });

      console.log(`Updated child ${familyChild.id} (${familyChild.child_name}): ${updateResult[0]} rows affected`);
    }

    // Update all processed families status to active
    for (const familyId of processedFamilies) {
      const familyUpdateResult = await Family.update({
        status: 'active'
      }, {
        where: { 
          id: familyId,
          status: { [Op.in]: ['pending', 'suspended'] }
        },
        transaction
      });

      console.log(`Updated family ${familyId}: ${familyUpdateResult[0]} rows affected`);

      await FamilyActivityLog.create({
        family_id: familyId,
        user_id: familyPaymentLink.sales_user_id || 1,
        action_type: 'payment_completed',
        action_description: `Family payment completed successfully. Transaction: ${transaction_uid}. Students registered: ${registeredStudentIds.length}`,
        new_values: {
          transaction_id: transaction_uid,
          amount: amount,
          currency: currency_code,
          payment_type: familyPaymentLink.payment_type,
          children_count: selectedChildren.filter(c => c.familyId === familyId).length,
          registered_students: registeredStudentIds.length
        },
        metadata: {
          payplus_transaction_id: transaction_uid,
          payment_link_id: familyPaymentLink.id,
          family_payment_transaction_id: familyPaymentTransaction.id,
          student_ids: registeredStudentIds,
          child_ids: childIds,
          family_ids: familyIds
        }
      }, { transaction });
    }

    // ================================
    // CLEAR FAMILY CART ITEMS
    // ================================
    console.log('Clearing family cart items for processed families...');

    if (processedFamilies.size > 0) {
      try {
        const cartItemsToDelete = await FamilyCartItem.findAll({
          where: {
            family_id: {
              [Op.in]: Array.from(processedFamilies)
            }
          },
          transaction
        });

        console.log(`Found ${cartItemsToDelete.length} cart items to clear for ${processedFamilies.size} families`);

        const cartItemDetails = cartItemsToDelete.map(item => ({
          cart_item_id: item.id,
          family_id: item.family_id,
          child_id: item.child_id,
          sales_user_id: item.sales_user_id
        }));

        const deletedCount = await FamilyCartItem.destroy({
          where: {
            family_id: {
              [Op.in]: Array.from(processedFamilies)
            }
          },
          transaction
        });

        console.log(`Successfully cleared ${deletedCount} cart items for processed families`);

        for (const familyId of processedFamilies) {
          const familyCartItems = cartItemDetails.filter(item => item.family_id === familyId);
          
          if (familyCartItems.length > 0) {
            await FamilyActivityLog.create({
              family_id: familyId,
              user_id: familyPaymentLink.sales_user_id || 1,
              action_type: 'cart_cleared',
              action_description: `Cart cleared after successful payment. Removed ${familyCartItems.length} items from cart.`,
              old_values: {
                cart_items: familyCartItems
              },
              new_values: {
                cart_items: []
              },
              metadata: {
                payment_transaction_id: familyPaymentTransaction.id,
                payplus_transaction_id: transaction_uid,
                cleared_items_count: familyCartItems.length,
                clearing_reason: 'successful_payment_completion'
              }
            }, { transaction });
          }
        }

        paymentLogger.logPaymentVerification({
          student_id: linkToken,
          student_name: customer_name || 'Family Payment',
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'family_cart_cleared',
          verification_result: true,
          subscription_details: {
            families_cart_cleared: processedFamilies.size,
            total_cart_items_removed: deletedCount
          }
        });

      } catch (cartClearError) {
        console.error('Error clearing family cart items:', cartClearError);
        console.warn('Cart clearing failed but payment processing continues');
      }
    }

    // ================================
    // CREATE RECURRING PAYMENT RECORD - FIXED
    // ================================
    if (is_recurring && recurring_info?.recurring_uid) {
      // FIX: Use first registered student ID instead of null
      const primaryStudentId = registeredStudentIds.length > 0 
        ? registeredStudentIds[0] 
        : null;

      if (!primaryStudentId) {
        console.warn('No student ID available for recurring payment record, skipping creation');
        
        paymentLogger.logPaymentVerification({
          student_id: linkToken,
          student_name: customer_name || 'Family Payment',
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'recurring_payment_skipped',
          verification_result: false,
          error_details: {
            message: 'No student ID available for recurring payment record',
            registered_students_count: registeredStudentIds.length
          }
        });
      } else {
        const recurringPaymentData = {
          student_id: primaryStudentId, // FIXED: Use first student ID instead of null
          managed_by_id: familyPaymentLink.sales_user_id,
          managed_by_role: 'sales',
          subscription_id: null,
          payplus_transaction_uid: recurring_info.recurring_uid,
          payplus_page_request_uid: recurring_info.page_request_uid,
          amount: parseFloat(amount),
          currency: currency_code || 'ILS',
          payment_date: moment().format('YYYY-MM-DD'),
          status: 'paid',
          transaction_id: transaction_uid,
          next_payment_date: moment().add(1, 'month').format('YYYY-MM-DD'),
          recurring_frequency: 'monthly',
          recurring_count: 1,
          max_recurring_count: null,
          booked_monthly_classes: 0,
          payment_method: payment_method || 'credit_card',
          card_last_digits: four_digits ? four_digits.slice(-4) : null,
          failure_reason: null,
          failure_count: 0,
          webhook_data: JSON.stringify({
            ...webhookData,
            family_payment: true,
            children_details: selectedChildren,
            student_ids: registeredStudentIds,
            child_ids: childIds,
            family_ids: familyIds,
            note: 'Primary student ID used as representative for family payment'
          }),
          remarks: `Family payment processed. Children: ${selectedChildren.length}. Families: ${processedFamilies.size}. Students registered: ${registeredStudentIds.length}. Amount: ${amount} ${currency_code}. Primary Student ID: ${primaryStudentId} (representative for family)`,
          is_active: true,
          cancelled_at: null,
          cancelled_by: null
        };

        const recurringPayment = await RecurringPayment.create(recurringPaymentData, { transaction });
        console.log(`Created recurring payment record: ${recurringPayment.id} with primary student ID: ${primaryStudentId}`);
        
        paymentLogger.logPaymentVerification({
          student_id: primaryStudentId.toString(),
          student_name: customer_name || 'Family Payment',
          subscription_id: familyPaymentTransaction.id,
          verification_type: 'recurring_payment_created',
          verification_result: true,
          subscription_details: {
            recurring_payment_id: recurringPayment.id,
            primary_student_id: primaryStudentId,
            all_student_ids: registeredStudentIds,
            recurring_uid: recurring_info.recurring_uid
          }
        });
      }
    }

    // Send confirmation emails
    const emailPromises = [];
    for (const family of families) {
      try {
        if (family.parent_email) {
          const familyChildren = selectedChildren.filter(c => c.familyId === family.id);
          
          emailPromises.push(
            sendFamilyPaymentConfirmationEmail(
              family.parent_email,
              family.parent_name,
              familyChildren,
              {
                transaction_id: transaction_uid,
                amount: familyChildren.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0),
                currency: currency_code,
                payment_type: familyPaymentLink.payment_type,
                students_registered: registeredStudentIds.length
              }
            )
          );
        }
      } catch (emailError) {
        console.error(`Error preparing email for family ${family.id}:`, emailError.message);
      }
    }

    Promise.all(emailPromises).then(() => {
      console.log(`Sent confirmation emails to ${emailPromises.length} families`);
    }).catch(error => {
      console.error('Error sending confirmation emails:', error);
    });

    // Final verification logging
    paymentLogger.logPaymentVerification({
      student_id: linkToken,
      student_name: customer_name || 'Family Payment',
      subscription_id: familyPaymentTransaction.id,
      verification_type: 'family_payment_processing_complete',
      verification_result: true,
      subscription_details: {
        family_payment_transaction_id: familyPaymentTransaction.id,
        families_processed: processedFamilies.size,
        children_processed: selectedChildren.length,
        students_registered: registeredStudentIds.length,
        total_amount: amount,
        currency: currency_code,
        is_recurring: is_recurring,
        payment_link_updated: true,
        cart_cleared: true,
        child_ids_from_webhook: childIds,
        family_ids_from_webhook: familyIds
      }
    });

    console.log(`Successfully processed family payment: ${transaction_uid}`);

  } catch (error) {
    console.error('Error in processFamilyPaymentWebhook:', error);
    
    paymentLogger.logPaymentVerification({
      student_id: webhookData.more_info_1 || 'unknown',
      student_name: webhookData.customer_name || 'unknown',
      subscription_id: null,
      verification_type: 'family_payment_processing_error',
      verification_result: false,
      error_details: {
        error_type: 'family_processing_exception',
        error_message: error.message,
        error_stack: error.stack,
        transaction_uid: webhookData.transaction_uid
      }
    });
    
    throw error;
  }
};

/**
 * Create subscription for a family child (adapted from individual payment logic)
 * @param {Number} studentId - Student ID
 * @param {Number} lessonMinutes - Lesson duration in minutes
 * @param {Number} lessonsPerMonth - Number of lessons per month
 * @param {Number} subscriptionMonths - Subscription duration in months
 * @param {Number} amount - Payment amount for this child
 * @param {Boolean} isRecurring - Whether payment is recurring
 * @param {Object} childDetail - Child detail from selectedChildren
 * @param {Object} familyChild - FamilyChild database record
 * @param {Object} transaction - Database transaction
 * @returns {Object} - Subscription creation result
 */
const createFamilyChildSubscription = async (studentId, lessonMinutes, lessonsPerMonth, subscriptionMonths, amount, isRecurring, childDetail, familyChild, transaction) => {
  try {
    // Validate input parameters
    if (!studentId || isNaN(studentId)) {
      throw new Error(`Invalid student ID: ${studentId}`);
    }

    if (!lessonMinutes || isNaN(lessonMinutes) || lessonMinutes <= 0) {
      lessonMinutes = 25; // Default lesson duration
    }

    if (!lessonsPerMonth || isNaN(lessonsPerMonth) || lessonsPerMonth <= 0) {
      lessonsPerMonth = 4; // Default lessons per month
    }

    if (!subscriptionMonths || isNaN(subscriptionMonths) || subscriptionMonths <= 0) {
      subscriptionMonths = 1; // Default to 1 month
    }

    // Verify the user exists
    const user = await User.findByPk(studentId, { transaction });
    if (!user) {
      throw new Error(`User with ID ${studentId} does not exist`);
    }

    // Determine subscription type based on months and lesson duration
    const subscriptionType = determineSubscriptionTypeForFamily(subscriptionMonths, lessonMinutes);

    // Deactivate any existing active subscriptions for this student
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
      for (const existingSubscription of existingActiveSubscriptions) {
        await existingSubscription.update({
          status: 'inactive',
          is_cancel: 1,
          updated_at: new Date()
        }, { transaction });

        console.log(`Deactivated existing subscription ${existingSubscription.id} for student ${studentId}`);
      }
    }

    // Calculate subscription parameters
    const renewDate = moment().add(subscriptionMonths, 'months').toDate();
    const totalLessons = lessonsPerMonth * subscriptionMonths;
    const costPerLesson = totalLessons > 0 ? amount / totalLessons : 0;

    // Create new subscription
    const subscriptionData = {
      user_id: studentId,
      type: subscriptionType,
      each_lesson: lessonMinutes.toString(),
      renew_date: renewDate,
      how_often: `${lessonsPerMonth} lessons per month`,
      weekly_lesson: lessonsPerMonth,
      status: 'active',
      lesson_min: lessonMinutes,
      left_lessons: totalLessons,
      lesson_reset_at: moment().add(1, 'month').toDate(),
      cost_per_lesson: parseFloat(costPerLesson.toFixed(2)),
      is_cancel: 0,
      plan_id: childDetail.planId || 1,
      payment_status: 'online',
      weekly_comp_class: 0,
      bonus_class: 0,
      bonus_completed_class: 0,
      bonus_expire_date: null,
      notes: `Family payment subscription. Child: ${familyChild.child_name} (ID: ${familyChild.id}). Family: ${familyChild.family_id}. Created: ${new Date().toISOString()}`,
      created_at: new Date(),
      updated_at: new Date(),
      balance: 0
    };

    const createdSubscription = await UserSubscriptionDetails.create(subscriptionData, { transaction });

    // Update user table with subscription information
    await User.update({
      subscription_type: subscriptionType,
      trial_expired: true,
      subscription_id: createdSubscription.id,
      updated_at: Math.floor(Date.now() / 1000)
    }, {
      where: { id: studentId },
      transaction
    });

    console.log(`Created subscription ${createdSubscription.id} for student ${studentId} (${familyChild.child_name})`);

    return {
      subscription_id: createdSubscription.id,
      subscription_type: subscriptionType,
      total_lessons: totalLessons,
      lesson_minutes: lessonMinutes,
      lessons_per_month: lessonsPerMonth,
      cost_per_lesson: costPerLesson,
      renew_date: renewDate,
      user_updated: true
    };

  } catch (error) {
    console.error(`Error creating subscription for student ${studentId}:`, error);
    throw error;
  }
};

/**
 * Determine subscription type based on billing period and lesson duration (for family payments)
 * @param {Number} months - Number of months in subscription
 * @param {Number} lessonMinutes - Duration of each lesson in minutes
 * @returns {String} - Subscription type
 */
const determineSubscriptionTypeForFamily = (months, lessonMinutes) => {
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
    return `Monthly_${lessonMinutes || 25}`;
  }
};

/**
 * Send family payment confirmation email
 * @param {String} parentEmail - Parent email address
 * @param {String} parentName - Parent name
 * @param {Array} children - Array of children details
 * @param {Object} paymentDetails - Payment transaction details
 */
const sendFamilyPaymentConfirmationEmail = async (parentEmail, parentName, children, paymentDetails) => {
  try {
    const emailParams = {
      parent_name: parentName,
      children_count: children.length,
      children_names: children.map(c => c.childName).join(', '),
      total_amount: paymentDetails.amount,
      currency: paymentDetails.currency,
      transaction_id: paymentDetails.transaction_id,
      payment_type: paymentDetails.payment_type,
      confirmation_date: new Date().toLocaleDateString(),
      support_email: process.env.SUPPORT_EMAIL || 'support@tulkka.com'
    };

    const emailResult = await sendCombinedNotifications(
      'family_payment_confirmation', // You'll need this email template
      emailParams,
      {
        email: parentEmail,
        full_name: parentName,
        language: 'EN'
      },
      false
    );

    if (emailResult.emailSent) {
      console.log(`Family payment confirmation email sent to ${parentEmail}`);
    } else {
      console.error(`Failed to send family payment confirmation email to ${parentEmail}`);
    }

    return emailResult;
  } catch (error) {
    console.error('Error sending family payment confirmation email:', error);
    return { emailSent: false, error: error.message };
  }
};

/**
 * Handle family payment success page callback - GET endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleFamilyPaymentSuccessPage = async (req, res) => {
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
        where: { status: 'success' },
        required: false,
        limit: 1,
        order: [['created_at', 'DESC']]
      }]
    });

    if (!familyPaymentLink) {
      return res.status(404).json({
        status: 'error',
        message: 'Family payment link not found'
      });
    }

    const hasSuccessfulPayment = familyPaymentLink.transactions && familyPaymentLink.transactions.length > 0;
    
    return res.status(200).json({
      status: 'success',
      data: {
        payment_link: familyPaymentLink,
        has_successful_payment: hasSuccessfulPayment,
        transaction: hasSuccessfulPayment ? familyPaymentLink.transactions[0] : null,
        children_count: familyPaymentLink.selected_children_details?.length || 0,
        total_amount: familyPaymentLink.total_amount,
        currency: familyPaymentLink.currency,
        payment_type: familyPaymentLink.payment_type
      },
      message: 'Family payment details retrieved successfully'
    });

  } catch (error) {
    console.error('Error handling family payment success page:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    });
  }
};

/**
 * Simplified debug version - bypasses complex webhook processing
 * Use this temporarily to test if the issue is in the webhook processing
 */
const processFamilyPaymentSuccessSimplified = async (req, res) => {
  let transaction;
  const startTime = Date.now();

  try {
    console.log('=== SIMPLIFIED FAMILY PAYMENT DEBUG ===');
    
    // Start transaction
    transaction = await sequelize.transaction();
    console.log('Transaction started');

    // Parse data
    const parsedData = parsePayPlusResponse(req.body);
    console.log('Data parsed:', parsedData);

    // Extract basics
    const transactionId = parsedData.transaction_uid || 
      parsedData.transaction_id || 
      generateTransactionId();
    
    const linkToken = extractLinkToken(parsedData, req.body);
    
    console.log('Extracted:', { transactionId, linkToken });

    if (!transactionId || !linkToken) {
      await transaction.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Missing required data',
        debug: { transactionId, linkToken }
      });
    }

    // Check for existing transaction
    const existing = await FamilyPaymentTransaction.findOne({
      where: {
        [Op.or]: [
          { payplus_transaction_id: transactionId },
          { transaction_token: transactionId }
        ],
        status: 'success'
      },
      transaction
    });

    console.log('Existing check done:', !!existing);

    if (existing) {
      await transaction.rollback();
      return res.status(200).json({
        status: 'success',
        message: 'Already processed',
        data: { transaction_id: transactionId }
      });
    }

    // SIMPLIFIED: Just find the family payment link and mark as used
    console.log('Looking for family payment link...');
    
    const familyPaymentLink = await FamilyPaymentLink.findOne({
      where: { link_token: linkToken },
      transaction
    });

    if (!familyPaymentLink) {
      await transaction.rollback();
      return res.status(404).json({
        status: 'error',
        message: 'Family payment link not found',
        debug: { linkToken }
      });
    }

    console.log('Found family payment link:', familyPaymentLink.id);

    // Create a simple transaction record
    const normalizedData = {
      amount: parseFloat(parsedData.amount || parsedData.sum || 0),
      currency_code: parsedData.currency_code || parsedData.currency || 'ILS',
      customer_name: parsedData.customer_name || parsedData.contact || '',
      customer_email: parsedData.customer_email || parsedData.email || '',
      payment_method: parsedData.payment_method || parsedData.cardtype || '',
      four_digits: parsedData.four_digits || parsedData.ccno || ''
    };

    console.log('Creating family payment transaction...');

    const familyTransactionData = {
      payment_link_id: familyPaymentLink.id,
      transaction_token: `fam_${transactionId}`,
      payplus_transaction_id: transactionId,
      family_id: familyPaymentLink.selected_children_details[0]?.familyId || null,
      paid_children_ids: familyPaymentLink.selected_children_details.map(c => c.childId).filter(id => id),
      paid_children_details: familyPaymentLink.selected_children_details,
      amount: normalizedData.amount,
      currency: normalizedData.currency_code || 'ILS',
      payment_type: familyPaymentLink.payment_type,
      status: 'success',
      payment_method: normalizedData.payment_method || 'unknown',
      card_last_digits: normalizedData.four_digits ? normalizedData.four_digits.slice(-4) : null,
      payplus_response_data: JSON.stringify(parsedData),
      processed_at: new Date()
    };
    
    const familyPaymentTransaction = await FamilyPaymentTransaction.create(familyTransactionData, { transaction });
    console.log('Created transaction record:', familyPaymentTransaction.id);

    // Update payment link status
    await familyPaymentLink.update({
      status: 'used',
      used_at: new Date()
    }, { transaction });

    console.log('Updated payment link status');

    // Commit transaction
    await transaction.commit();
    console.log('Transaction committed successfully');

    const processingTime = Date.now() - startTime;
    
    console.log(`SUCCESS: Simplified processing completed in ${processingTime}ms`);

    return res.status(200).json({
      status: 'success',
      data: {
        transaction_id: transactionId,
        family_payment_transaction_id: familyPaymentTransaction.id,
        link_token: linkToken,
        processing_time_ms: processingTime
      },
      message: 'Family payment processed successfully (simplified)',
      note: 'This is a simplified version - full subscription processing skipped'
    });

  } catch (error) {
    console.error('Error in simplified processing:', error);
    
    if (transaction) {
      try {
        await transaction.rollback();
        console.log('Transaction rolled back');
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    return res.status(500).json({
      status: 'error',
      message: 'Simplified processing failed',
      details: error.message,
      processing_time_ms: Date.now() - startTime
    });
  }
};

module.exports = {
  processFamilyPaymentSuccess,
  processFamilyPaymentWebhook,
  handleFamilyPaymentSuccessPage,
  processFamilyPaymentSuccessSimplified,
};