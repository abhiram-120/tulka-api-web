// controller/sales/family-payment.controller.js
const FamilyPaymentLink = require('../../models/FamilyPaymentLink');
const { Family, FamilyPaymentTransaction, FamilyChild, FamilyActivityLog } = require('../../models/Family');
const { sequelize } = require('../../connection/connection');
const { paymentLogger } = require('../../utils/paymentLogger');
const crypto = require('crypto');
const moment = require('moment');
const axios = require('axios');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require("uuid");
const { familyPaymentLogger } = require('../../utils/familyPaymentLogger');
const { downloadFamilyInvoiceFromPayPlus } = require('../../services/familyPayplus.service');

// Import notification functions
const { sendNotificationEmail, whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { extractPayPlusCredentials } = require('../../utils/payplus-helpers');

// PayPlus API Configuration
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || ''
};

const PAYPLUS_CONFIG_COMPLETE = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || '',
    // Add these required fields to your environment variables
    terminalUid: process.env.PAYPLUS_TERMINAL_UID || '', // Get from PayPlus dashboard
    cashierUid: process.env.PAYPLUS_CASHIER_UID || '', // Get from PayPlus dashboard
    customerUid: process.env.PAYPLUS_DEFAULT_CUSTOMER_UID || null // Optional default
};

const PAYPLUS_BASE_URL = process.env.PAYPLUS_BASE_URL || "https://restapi.payplus.co.il/api/v1.0";
const PAYPLUS_API_KEY = process.env.PAYPLUS_API_KEY;
const PAYPLUS_SECRET_KEY = process.env.PAYPLUS_SECRET_KEY;
const PAYPLUS_PAYMENT_PAGE_UID = process.env.PAYPLUS_PAYMENT_PAGE_UID; // from your PayPlus dashboard

// Frontend + API URLs used for redirects/callback
const FRONTEND_URL = process.env.FRONTEND_URL; // e.g., https://app.example.com
const API_BASE_URL = process.env.API_BASE_URL; // e.g., https://api.example.com

const generateLinkToken = () => {
       return crypto.randomBytes(4).toString('hex').toUpperCase();
};

const generateShortId = () => {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
};

/**
 * Helper functions
 */
const getPayPlusRecurringType = (durationType) => {
    console.log('durationType :',durationType);
    switch (durationType.toLowerCase()) {
        case 'daily':
            return 0;
        case 'weekly':
            return 1;
        case 'monthly':
        case 'quarterly':
        case 'yearly':
            return 2; // Monthly (quarterly will use recurring_range = 3)
        default:
            return 2; // Default to monthly
    }
};

const getPayPlusRecurringRange = (durationType,durationMonths) => {
   
    if(durationType === null || durationType === '' || durationType === undefined){
        return durationMonths;
    }else{
        switch (durationType.toLowerCase()) {
            case 'daily':
            case 'weekly':
            case 'monthly':
                return 1;
            case 'quarterly':
                return 3; // Every 3 months
            case 'yearly':
                return 12;
            default:
                return 1;
        }
    }
    
};

function formatDateForPayPlus(date) {
    // Format: YYYY-MM-DD
    return date.toISOString().split('T')[0];
}

function calculateNextPaymentDate(subscription_type) {
    const now = new Date();
    switch (subscription_type) {
        case 'monthly':
            return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        case 'quarterly':
            return new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
        case 'yearly':
            return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        default:
            return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }
}

const buildRecurringFromChild = (child, recurStartDate) => {
  // Map UI/default/custom → PayPlus cadence
  // monthly/quarterly/yearly OR custom every N months
  const normalize = (months) => {
    if (!months || months < 1) return 1;
    return Math.max(1, Math.min(12, parseInt(months, 10)));
  };

  const months =
    child.planType === 'custom'
      ? normalize(child.customMonths || child.durationMonths)
      : normalize(child.durationMonths);

  return {
    recurring_type: 2,             // monthly base
    recurring_range: months,       // every N months
    number_of_charges: 0,          // open-ended (or set a finite number)
    start_date_on_payment_date: !recurStartDate && !child.firstChargeDate,
    start_date: child.firstChargeDate
      ? Math.min(parseInt(moment(child.firstChargeDate).format('DD')), 28)
      : (recurStartDate ? Math.min(parseInt(moment(recurStartDate).format('DD')), 28) : undefined)
  };
};

/**
 * Download invoice for a family payment transaction (from PayPlus)
 */
const downloadFamilyInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'original', format = 'pdf' } = req.query;


    // Find the family payment transaction
    const familyPayment = await FamilyPaymentTransaction.findByPk(id);

    if (!familyPayment) {
      return res.status(404).json({
        status: 'error',
        message: 'Family payment transaction not found'
      });
    }

    // Priority: payplus_transaction_id > transaction_token
    // Also try to extract from payplus_response_data if needed
    let transaction_uid = familyPayment.payplus_transaction_id || familyPayment.transaction_token;

    // If still not found, try to extract from payplus_response_data
    if ((!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') && familyPayment.payplus_response_data) {
      try {
        const responseData = typeof familyPayment.payplus_response_data === 'string' 
          ? JSON.parse(familyPayment.payplus_response_data) 
          : familyPayment.payplus_response_data;
        
        // Handle double-encoded JSON strings
        const parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
        
        if (parsedData.transaction_uid) {
          transaction_uid = parsedData.transaction_uid;
        }
      } catch (parseError) {
        console.error(`[downloadFamilyInvoice] Error parsing payplus_response_data:`, parseError);
      }
    }

    if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
      return res.status(400).json({
        status: 'error',
        message: 'Transaction UID not available for this family payment',
        details: {
          payment_id: id,
          payplus_transaction_id: familyPayment.payplus_transaction_id,
          transaction_token: familyPayment.transaction_token
        }
      });
    }

    // Delegate PayPlus API calls + streaming to the dedicated service
    await downloadFamilyInvoiceFromPayPlus({
      transaction_uid,
      type,
      format,
      paymentId: id,
      res,
      payplusResponseData: familyPayment.payplus_response_data
    });
  } catch (error) {
    console.error(`[downloadFamilyInvoice] Unexpected error downloading family invoice for payment ${req.params.id}:`, error);

    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: 'Error downloading family invoice',
        details: error.message
      });
    }
  }
};

/**
 * Generate Family Payment Link - Creates a single PayPlus payment link for multiple children
 * Simplified approach: One payment page with all children as items
 */
const generateFamilyPaymentLink = async (req, res) => {
  let transaction;
  const startTime = Date.now();

  try {
    transaction = await sequelize.transaction();

    const {
      selectedChildrenWithSubscriptions,
      paymentType, // 'one_time' | 'recurring'
      description,
      customNote,
      currency = 'ILS',
      recurStartDate, // yyyy-MM-dd optional
      parentEmail: reqParentEmail, // Check if email is at top level
      parentPhone: reqParentPhone, // Check if phone is at top level
    } = req.body || {};
    console.log('req.body :',req.body);
    
    // ---------- Basic validation ----------
    if (!Array.isArray(selectedChildrenWithSubscriptions) || selectedChildrenWithSubscriptions.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        status: 'error', 
        message: 'At least one child with subscription configuration is required' 
      });
    }

    if (!description?.trim()) {
      await transaction.rollback();
      return res.status(400).json({ 
        status: 'error', 
        message: 'Payment description is required' 
      });
    }

    // Validate each child has required data
    for (const child of selectedChildrenWithSubscriptions) {
      if (!child.childName || !child.amount || Number(child.amount) <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          status: 'error',
          message: `Invalid child data: ${child.childName || 'Unknown child'} - name and positive amount required`,
        });
      }
    }

    // ---------- Calculate totals and get parent info ----------
    const totalAmount = parseFloat(selectedChildrenWithSubscriptions.reduce((sum, child) => sum + Number(child.amount || 0), 0).toFixed(2));
    const childrenCount = selectedChildrenWithSubscriptions.length;
    const familiesCount = new Set(selectedChildrenWithSubscriptions.map((child) => child.familyId)).size;

    // CHANGED: Extract children IDs and family IDs for more_info fields
    const childrenIds = selectedChildrenWithSubscriptions.map(child => child.childId);
    const familyIds = [...new Set(selectedChildrenWithSubscriptions.map(child => child.familyId))];

    // Get parent information - prioritize frontend data, fallback to Family table
    const firstChild = selectedChildrenWithSubscriptions[0];
    let parentName = firstChild.parentName || firstChild.parent_name || '';
    
    // Try to get email/phone from frontend first (from child objects or top level)
    let extractedParentEmail = reqParentEmail || 
      firstChild.parentEmail || 
      firstChild.parent_email ||
      selectedChildrenWithSubscriptions.find((child) => child.parentEmail)?.parentEmail ||
      selectedChildrenWithSubscriptions.find((child) => child.parent_email)?.parent_email ||
      '';
    
    let extractedParentPhone = reqParentPhone || 
      firstChild.parentPhone || 
      firstChild.parent_phone ||
      selectedChildrenWithSubscriptions.find((child) => child.parentPhone)?.parentPhone ||
      selectedChildrenWithSubscriptions.find((child) => child.parent_phone)?.parent_phone ||
      '';
    
    // If email/phone not provided from frontend, fetch from Family table
    if (!extractedParentEmail || !extractedParentPhone) {
      if (familyIds.length > 0) {
        try {
          const families = await Family.findAll({
            where: {
              id: { [Op.in]: familyIds }
            },
            attributes: ['id', 'parent_email', 'parent_phone', 'parent_name'],
            transaction
          });
          
          if (families.length > 0) {
            const familyForFirstChild = families.find(f => f.id === firstChild.familyId) || families[0];
            
            if (!extractedParentEmail && familyForFirstChild.parent_email) {
              extractedParentEmail = familyForFirstChild.parent_email;
            }
            
            if (!extractedParentPhone && familyForFirstChild.parent_phone) {
              extractedParentPhone = familyForFirstChild.parent_phone;
            }
            
            // Update parentName from Family table if not already set
            if (!parentName && familyForFirstChild.parent_name) {
              parentName = familyForFirstChild.parent_name;
            }
          }
        } catch (familyFetchError) {
          console.error('❌ [FAMILY PAYMENT] Error fetching family records:', familyFetchError);
        }
      }
    } else {
      console.log('✅ [FAMILY PAYMENT] Parent contact info from frontend:', {
        parentName,
        email: extractedParentEmail,
        phone: extractedParentPhone
      });
    }
    

    // ---------- Prepare PayPlus items (one item per child) ----------
    const paymentItems = selectedChildrenWithSubscriptions.map((child, index) => ({
      name: `${child.childName} (${child.relationshipToParent}) - ${child.planDescription || 'Learning Plan'} - ${child.lessonMinutes}min lessons, ${child.lessonsPerMonth} lessons/month - (FID ${child.familyId}) - (CID ${child.childId})`,
      quantity: 1,
      price: parseFloat(Number(child.amount).toFixed(2)), // Round to 2 decimal places
      vat_type: 0,
      catalog_number: String(child.childId || index + 1),
    }));

    // ---------- Prepare children details for storage ----------
    const childrenDetails = selectedChildrenWithSubscriptions.map((child) => ({
      childId: child.childId,
      childName: child.childName,
      familyId: child.familyId,
      parentName: child.parentName,
      relationshipToParent: child.relationshipToParent,
      planType: child.planType,
      durationMonths: child.durationMonths || child.customMonths,
      durationName: child.durationName,
      lessonMinutes: child.lessonMinutes,
      lessonsPerMonth: child.lessonsPerMonth,
      amount: parseFloat(Number(child.amount).toFixed(2)), // Round to 2 decimal places
      planDescription: child.planDescription,
    }));

    console.log('childrenDetails:', childrenDetails);

    // ---------- Generate unique link token ----------
    const linkToken = generateLinkToken();

    // ---------- Prepare metadata for PayPlus ----------
    const familyMetadata = {
      family_payment: true,
      link_token: linkToken,
      payment_type: paymentType,
      salesperson_id: req.user?.id || null,
      children_count: childrenCount,
      families_count: familiesCount,
      children: childrenDetails,
      recurStartDate,
    };

    const encodedMetadata = encodeURIComponent(
      Buffer.from(JSON.stringify(familyMetadata)).toString('base64')
    );

    // ---------- Build PayPlus request ----------
    const payPlusRequest = {
      payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
      amount: Number(totalAmount),
      currency_code: currency,
      sendEmailApproval: true,
      sendEmailFailure: true,
      send_failure_callback: true,
      successful_invoice: true,
      initial_invoice: true,
      send_customer_success_email: true,
      create_token: paymentType === 'recurring', // Only create token for recurring payments
      save_card_token: paymentType === 'recurring',
      refURL_success: `${process.env.FRONTEND_URL}/payment/family/success?token=${linkToken}`,
      refURL_failure: `${process.env.FRONTEND_URL}/payment/family/failed?token=${linkToken}`,
      refURL_callback: `${process.env.API_BASE_URL}/api/sales/family-payment-callback/payplus-webhook`,
      expiry_datetime: "10080", // 7 days
      customer: { 
        customer_name: parentName, 
        email: extractedParentEmail, 
        phone: extractedParentPhone 
      },
      items: paymentItems,
      more_info: 'family_payment',
      more_info_1: linkToken,
      more_info_2: JSON.stringify(childrenIds), // CHANGED: Array of children IDs as JSON
      more_info_3: JSON.stringify(familyIds),   // CHANGED: Array of family IDs as JSON
      more_info_4: paymentType,
      more_info_5: encodedMetadata,
    };

    // ---------- Handle recurring vs one-time payment ----------
    if (paymentType === 'recurring') {
      // For recurring payments, we'll use the dominant duration from children
      // or default to monthly if mixed
      const durations = selectedChildrenWithSubscriptions.map(child => child.durationMonths || 1);
      const dominantDuration = durations.sort((a, b) => durations.filter(v => v === a).length - durations.filter(v => v === b).length).pop();
      
      // Calculate jump payment value based on duration
      let jumpPaymentValue = 30;
      const custom_months = dominantDuration;
      
      if (custom_months && parseInt(custom_months) > 0) {
        // Custom plan → calculate jump days dynamically
        jumpPaymentValue = parseInt(custom_months) * 30;
      } else {
        // Fallback to predefined duration types - determine from dominant duration
        if (dominantDuration === 1) {
          jumpPaymentValue = 30; // monthly
        } else if (dominantDuration === 3) {
          jumpPaymentValue = 90; // quarterly
        } else if (dominantDuration === 12) {
          jumpPaymentValue = 365; // yearly
        } else {
          jumpPaymentValue = dominantDuration * 30; // custom months
        }
      }

      // Set recurring type and range
      const recurringType = getPayPlusRecurringType(childrenDetails[0].durationName);
      const recurringRange = getPayPlusRecurringRange(childrenDetails[0].durationName, childrenDetails[0].durationMonths);
      
      payPlusRequest.charge_method = 3; // Recurring
      payPlusRequest.payments = 1; // Immediate first payment
      payPlusRequest.recurring_settings = {
        instant_first_payment: true,
        recurring_type: 0,
        recurring_range: recurringRange,
        number_of_charges: 12,
        start_date_on_payment_date: !recurStartDate,
        start_date: recurStartDate ? Math.min(parseInt(moment(recurStartDate).format('DD')), 28) : undefined,
        jump_payments: jumpPaymentValue,
        successful_invoice: true,
        customer_failure_email: true,
        send_customer_success_email: true,
      };
    } else {
      // One-time payment
      payPlusRequest.charge_method = 1;
      payPlusRequest.payments = 1;
    }

    console.log('Family PayPlus Request:', JSON.stringify(payPlusRequest, null, 2));

    // ---------- Call PayPlus API ----------
    const response = await axios.post(
      `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
      payPlusRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': PAYPLUS_CONFIG.apiKey,
          'secret-key': PAYPLUS_CONFIG.secretKey,
        },
        timeout: 30000,
      }
    );

    if (response.data?.results?.status !== 'success') {
      await transaction.rollback();
      throw new Error(response.data?.results?.description || 'PayPlus API error');
    }

    // ---------- Extract PayPlus response data ----------
    const responseData = response.data?.data || {};
    const paymentUrl = responseData.payment_url || responseData.link_url || responseData.payment_page_link || null;
    const shortUrl = responseData.short_url || null;
    const pageRequestUid = responseData.page_request_uid || null;
    const hostedFieldsUuid = responseData.hosted_fields_uuid || null;
    const qrCode = responseData.qr_code_image || null;

    // ---------- Store FamilyPaymentLink record ----------
    const familyPaymentLink = await FamilyPaymentLink.create(
      {
        link_token: linkToken,
        sales_user_id: req.user?.id || null,
        selected_children_ids: selectedChildrenWithSubscriptions.map((child) => child.childId),
        selected_children_details: childrenDetails,
        total_amount: Number(totalAmount),
        currency,
        payment_type: paymentType,
        description,
        custom_note: customNote,
        payplus_payment_url: paymentUrl,
        payplus_short_url: shortUrl,
        payplus_page_request_uid: pageRequestUid,
        payplus_hosted_fields_uuid: hostedFieldsUuid,
        payplus_qr_code: qrCode,
        expires_at: moment().add(7, 'days').toDate(),
        status: 'active',
      },
      { transaction }
    );

    await transaction.commit();

    const processingTime = Date.now() - startTime;

    // ---------- Return success response ----------
    return res.status(200).json({
      status: 'success',
      data: {
        payment_link: paymentUrl,
        short_payment_link: shortUrl || `${process.env.FRONTEND_URL}/payment/family/${linkToken}`,
        short_id: linkToken,
        link_token: linkToken,
        family_payment_link_id: familyPaymentLink.id,
        page_request_uid: pageRequestUid,
        hosted_fields_uuid: hostedFieldsUuid,
        qr_code_image: qrCode,
        expires_at: moment().add(7, 'days').toISOString(),
        details: {
          totalAmount: Number(totalAmount),
          childrenCount,
          familiesCount,
          childrenIds, // ADDED: Return for reference
          familyIds,   // ADDED: Return for reference
          paymentType,
          currency,
          description,
          parentContact: { 
            name: parentName, 
            email: extractedParentEmail, 
            phone: extractedParentPhone 
          },
          childrenDetails,
        },
      },
      message: `Family payment link generated successfully for ${childrenCount} children from ${familiesCount} family/families in ${processingTime}ms`,
    });

  } catch (error) {
    if (transaction) {
      try { 
        await transaction.rollback(); 
      } catch (rollbackError) {
        console.error('Transaction rollback error:', rollbackError);
      }
    }

    const processingTime = Date.now() - startTime;
    console.error('Error generating family payment link:', error);

    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate family payment link',
      details: error?.response?.data?.results?.description || error.message,
      processingTime,
    });
  }
};
/**
 * Get family payment data by link token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getFamilyPaymentData = async (req, res) => {
    try {
        const { linkToken } = req.params;

        // ADD: Log access attempt
        familyPaymentLogger.logFamilyPaymentLinkAccess({
            link_token: linkToken,
            access_type: 'view',
            user_agent: req.headers['user-agent'],
            ip_address: req.ip
        });

        if (!linkToken) {
            // ADD: Log invalid access
            familyPaymentLogger.logFamilyPaymentLinkAccess({
                link_token: 'missing',
                access_type: 'invalid_access',
                user_agent: req.headers['user-agent'],
                ip_address: req.ip
            });

            return res.status(400).json({
                status: 'error',
                message: 'Link token is required'
            });
        }

        const familyPaymentLink = await FamilyPaymentLink.findOne({
            where: {
                link_token: linkToken,
                expires_at: {
                    [Op.gt]: new Date()
                },
                status: 'active'
            }
        });

        if (!familyPaymentLink) {
            // ADD: Log link not found
            familyPaymentLogger.logFamilyPaymentLinkAccess({
                link_token: linkToken,
                access_type: 'not_found',
                user_agent: req.headers['user-agent'],
                ip_address: req.ip
            });

            return res.status(404).json({
                status: 'error',
                message: 'Family payment link not found or expired'
            });
        }

        // ADD: Log successful access
        familyPaymentLogger.logFamilyPaymentLinkAccess({
            link_token: linkToken,
            access_type: 'successful_view',
            user_agent: req.headers['user-agent'],
            ip_address: req.ip,
            children_details: familyPaymentLink.selected_children_details,
            amount: familyPaymentLink.total_amount
        });

        return res.status(200).json({
            status: 'success',
            data: {
                id: familyPaymentLink.id,
                linkToken: familyPaymentLink.link_token,
                totalAmount: familyPaymentLink.total_amount,
                currency: familyPaymentLink.currency,
                paymentType: familyPaymentLink.payment_type,
                description: familyPaymentLink.description,
                customNote: familyPaymentLink.custom_note,
                paymentUrl: familyPaymentLink.payplus_payment_url,
                qrCode: familyPaymentLink.payplus_qr_code,
                childrenDetails: familyPaymentLink.selected_children_details,
                expiresAt: familyPaymentLink.expires_at,
                createdAt: familyPaymentLink.created_at
            },
            message: 'Family payment data retrieved successfully'
        });

    } catch (error) {
        // ADD: Log system error
        familyPaymentLogger.logFamilyPaymentLinkAccess({
            link_token: req.params?.linkToken || 'unknown',
            access_type: 'system_error',
            user_agent: req.headers['user-agent'],
            ip_address: req.ip,
            error_details: {
                error_type: 'system_error',
                error_message: error.message
            }
        });

        console.error('Error retrieving family payment data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send family payment link via email
 * @param {Object} req - Express request object  
 * @param {Object} res - Express response object
 */
const sendFamilyPaymentLinkEmail = async (req, res) => {
    try {
        const {
            short_payment_link,
            parent_email,
            parent_name,
            family_details
        } = req.body;

        if (!short_payment_link || !parent_email || !parent_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Short payment link, parent email, and parent name are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(parent_email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Prepare email template parameters for family payment
        const emailParams = {
            'parent.name': parent_name,
            'family.childrenCount': family_details.children?.length || 0,
            'family.totalAmount': family_details.totalAmount || 0,
            'family.currency': family_details.currency || 'ILS',
            'family.paymentType': family_details.paymentType || 'one-time',
            'family.description': family_details.description || 'Family Learning Package',
            'payment.link': short_payment_link,
            'expiry.days': '7',
        };

        // Send family payment email
        const recipientDetails = {
            email: parent_email,
            full_name: parent_name,
            language: 'EN'
        };

        const emailSent = await sendNotificationEmail(
            'family_payment_link_created', // You'll need this email template
            emailParams,
            recipientDetails,
            false // Not a trial user
        );

        if (emailSent) {
            return res.status(200).json({
                status: 'success',
                message: `Family payment link email sent successfully to ${parent_email}`,
                data: {
                    recipient_email: parent_email,
                    template_used: 'family_payment_link_created',
                    children_count: family_details.children?.length || 0
                }
            });
        } else {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send family payment link email'
            });
        }

    } catch (error) {
        console.error('Error in sendFamilyPaymentLinkEmail:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send family payment link via WhatsApp
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const sendFamilyPaymentLinkWhatsApp = async (req, res) => {
    try {
        const {
            short_payment_link,
            parent_mobile,
            parent_name,
            country_code,
            family_details
        } = req.body;

        if (!short_payment_link || !parent_mobile || !parent_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Short payment link, parent mobile, and parent name are required'
            });
        }

        // Validate mobile number format
        const cleanMobile = parent_mobile.replace(/[^\d]/g, '');
        if (cleanMobile.length < 7) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid mobile number format'
            });
        }

        // Prepare WhatsApp template parameters for family payment
        const whatsappParams = {
            'parent.name': parent_name,
            'family.childrenCount': family_details.children?.length || 0,
            'family.totalAmount': family_details.totalAmount || 0,
            'family.currency': family_details.currency || 'ILS',
            'payment.link': short_payment_link
        };

        // Prepare parent details for WhatsApp notification
        const parentDetails = {
            country_code: country_code || '+972', // Default to Israel
            mobile: cleanMobile,
            full_name: parent_name,
            language: 'EN'
        };

        const whatsappSent = await whatsappReminderTrailClass(
            'family_payment', // You'll need this WhatsApp template
            whatsappParams,
            parentDetails
        );

        if (whatsappSent) {
            return res.status(200).json({
                status: 'success',
                message: `Family payment link WhatsApp sent successfully to ${parent_mobile}`,
                data: {
                    recipient_mobile: parent_mobile,
                    template_used: 'family_payment',
                    children_count: family_details.children?.length || 0
                }
            });
        } else {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send family payment link WhatsApp message'
            });
        }

    } catch (error) {
        console.error('Error in sendFamilyPaymentLinkWhatsApp:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Modify family payment transaction status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const modifyFamilyTransaction = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const {
            transaction_id,
            action, // 'refund', 'cancel', 'modify'
            reason,
            notes,
            new_amount,
            affected_children_ids
        } = req.body;

        if (!transaction_id || !action) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Transaction ID and action are required'
            });
        }

        // Find the family payment transaction
        const familyTransaction = await FamilyPaymentTransaction.findOne({
            where: {
                id: transaction_id
            },
            include: [{
                model: FamilyPaymentLink,
                as: 'paymentLink'
            }],
            transaction
        });

        if (!familyTransaction) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        const previousStatus = familyTransaction.status;
        let newStatus;
        let updateData = {
            updated_at: new Date()
        };

        switch (action) {
            case 'refund':
                newStatus = 'refunded';
                // TODO: Call PayPlus API to process refund
                if (new_amount) {
                    updateData.refunded_amount = new_amount;
                }
                break;
            case 'cancel':
                newStatus = 'cancelled';
                // TODO: Call PayPlus API to cancel if applicable
                break;
            case 'modify':
                // For modifications like updating affected children
                if (affected_children_ids) {
                    updateData.paid_children_ids = affected_children_ids;
                }
                newStatus = familyTransaction.status; // Keep current status
                break;
            default:
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid action. Must be refund, cancel, or modify'
                });
        }

        updateData.status = newStatus;

        // Update transaction
        await familyTransaction.update(updateData, { transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                transaction_id: transaction_id,
                previous_status: previousStatus,
                new_status: newStatus,
                action: action,
                modified_at: new Date(),
                affected_children: affected_children_ids || familyTransaction.paid_children_ids
            },
            message: `Family payment transaction ${action}ed successfully`
        });

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error modifying family transaction:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to modify family payment transaction',
            details: error.message
        });
    }
};

/**
 * Get family payment status and transaction history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getFamilyPaymentStatus = async (req, res) => {
    try {
        const { familyPaymentLinkId } = req.params;

        if (!familyPaymentLinkId) {
            return res.status(400).json({
                status: 'error',
                message: 'Family payment link ID is required'
            });
        }

        // Get family payment link
        const familyPaymentLink = await FamilyPaymentLink.findOne({
            where: { id: familyPaymentLinkId },
            include: [{
                model: FamilyPaymentTransaction,
                as: 'transactions',
                order: [['created_at', 'DESC']]
            }]
        });

        if (!familyPaymentLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Family payment link not found'
            });
        }

        // Calculate summary statistics
        const transactions = familyPaymentLink.transactions || [];
        const successfulTransactions = transactions.filter(t => t.status === 'success');
        const totalPaid = successfulTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
        const totalRefunded = transactions
            .filter(t => t.status === 'refunded')
            .reduce((sum, t) => sum + parseFloat(t.refunded_amount || t.amount), 0);

        return res.status(200).json({
            status: 'success',
            data: {
                family_payment_link: familyPaymentLink,
                transactions: transactions,
                summary: {
                    total_transactions: transactions.length,
                    successful_payments: successfulTransactions.length,
                    total_amount_paid: totalPaid,
                    total_refunded: totalRefunded,
                    net_amount: totalPaid - totalRefunded,
                    currency: familyPaymentLink.currency,
                    payment_type: familyPaymentLink.payment_type,
                    link_status: familyPaymentLink.status
                }
            },
            message: 'Family payment status retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family payment status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a unique PayPlus customer for each child
 */
async function createChildCustomerInPayPlus(child, parentData) {
    try {
        const uniqueExternalNumber = `CHILD_${child.childId}_${child.familyId}_${Date.now()}`;
        
        const customerPayload = {
            customer_name: `${child.childName} (${parentData.parent_name})`,
            email: parentData.parent_email || '',
            phone: parentData.parent_phone || '',
            more_info: `Child of ${parentData.parent_name} - Family ID: ${child.familyId} - Relationship: ${child.relationshipToParent}`,
            customer_external_number: uniqueExternalNumber
        };

        console.log(`Creating PayPlus customer for child ${child.childName}:`, customerPayload);

        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/Customers/Add`,
            customerPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        if (response.data?.results?.status !== 'success') {
            throw new Error(response.data?.results?.description || 'Failed to create customer');
        }

        const customerUid = response.data.data.customer_uid;
        console.log(`✅ Customer created successfully for ${child.childName}: ${customerUid}`);

        return {
            success: true,
            customer_uid: customerUid,
            external_number: uniqueExternalNumber
        };

    } catch (error) {
        console.error(`❌ Error creating PayPlus customer for child ${child.childName}:`, error);
        
        // If customer already exists, try to retrieve or create a fallback
        if (error.response?.data?.results?.description?.includes('already exist')) {
            console.log('Customer already exists, creating fallback UID...');
            return {
                success: true,
                customer_uid: `FALLBACK_CHILD_${child.childId}_${child.familyId}_${Date.now()}`,
                external_number: `FALLBACK_CHILD_${child.childId}_${child.familyId}_${Date.now()}`,
                is_fallback: true
            };
        }
        
        throw error;
    }
}

/**
 * Associate parent's card token with child's customer account
 */
async function associateCardTokenWithChildCustomer(childCustomerUid, parentCardToken) {
    try {
        const tokenPayload = {
            customer_uid: childCustomerUid,
            token_uid: parentCardToken
        };

        console.log(`Associating card token with child customer ${childCustomerUid}:`, tokenPayload);

        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/Tokens/Add`,
            tokenPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        if (response.data?.results?.status !== 'success') {
            console.warn(`Failed to associate token with child customer: ${response.data?.results?.description}`);
            // Continue anyway - the recurring payment might still work with the original token
            return false;
        }

        console.log('✅ Token association successful');
        return true;

    } catch (error) {
        console.error('Error associating card token with child customer:', error);
        // Don't throw - continue with the process
        return false;
    }
}

/**
 * Enhanced recurring payment creation with child-specific customers
 */
async function createRecurringForChildWithCustomer(cardToken, child, currency, recurStartDate, payPlusCredentials, childIndex = 0) {
    try {
        // Step 1: Create a unique customer for this child
        const parentData = {
            parent_name: child.parentName || 'Parent',
            parent_email: child.parentEmail || '',
            parent_phone: child.parentPhone || ''
        };

        const customerResult = await createChildCustomerInPayPlus(child, parentData);
        if (!customerResult.success) {
            throw new Error(`Failed to create customer for child ${child.childName}`);
        }

        const childCustomerUid = customerResult.customer_uid;

        // Step 2: Associate parent's card token with child's customer (optional)
        await associateCardTokenWithChildCustomer(childCustomerUid, cardToken);

        // Step 3: Add delay to prevent rapid API calls
        if (childIndex > 0) {
            console.log(`Adding ${childIndex * 2} second delay for child ${child.childName}...`);
            await new Promise(resolve => setTimeout(resolve, childIndex * 2000));
        }

        // Step 4: Calculate recurring parameters
        const customRecurringRange = child.durationMonths || 1;
        const normalizedRange = Math.max(1, Math.min(12, parseInt(customRecurringRange, 10)));

        // Step 5: Calculate unique start date
        const startDate = new Date();
        const childOffset = ((parseInt(child.childId) || 1) - 1) * 7 + (childIndex * 3);
        
        if (normalizedRange > 1) {
            startDate.setMonth(startDate.getMonth() + normalizedRange);
        } else {
            startDate.setMonth(startDate.getMonth() + 1);
        }
        
        startDate.setDate(startDate.getDate() + childOffset);
        startDate.setHours(startDate.getHours() + childIndex);

        // Step 6: Create highly unique identifiers
        const uniqueId = `${Date.now()}_${child.childId}_${Math.random().toString(36).substr(2, 9)}`;
        const planHash = Buffer.from(`${child.childName}_${child.amount}_${normalizedRange}_${childCustomerUid}`).toString('base64').substr(0, 12);

        // Step 7: Build PayPlus recurring payment request
        const payload = {
            terminal_uid: payPlusCredentials.terminal_uid,
            cashier_uid: payPlusCredentials.cashier_uid,
            customer_uid: childCustomerUid, // Use child's unique customer UID
            card_token: cardToken,
            
            currency_code: currency,
            
            recurring_type: 2, // Monthly base
            recurring_range: normalizedRange,
            number_of_charges: 0,
            instant_first_payment: false,
            start_date: formatDateForPayPlus(startDate),
            
            items: [{
                name: `${child.childName} - ${normalizedRange}M Plan - ${uniqueId}`,
                price: parseFloat(child.amount),
                quantity: 1,
                vat_type: 0,
                catalog_number: `CHILD_${child.childId}_${planHash}_${uniqueId}`
            }],
            
            successful_invoice: true,
            send_customer_success_email: true,
            customer_failure_email: true,
            
            extra_info: `child${child.childId}_${normalizedRange}mo_${formatDateForPayPlus(startDate)}_${child.amount}_${uniqueId}_${childCustomerUid.substr(-8)}`
        };

        console.log(`PayPlus recurring payment payload for child ${child.childName} (attempt ${childIndex + 1}):`, JSON.stringify(payload, null, 2));

        // Step 8: Make the PayPlus API call
        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/RecurringPayments/Add`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        const result = response.data;
        console.log(`PayPlus recurring payment response for ${child.childName}:`, result);

        if (result?.results?.status !== 'success') {
            throw new Error(result?.results?.description || 'PayPlus API call failed');
        }

        return {
            success: true,
            subscription_id: result?.data?.recurring_payment_uid || result?.data?.uid,
            customer_uid: childCustomerUid,
            customer_external_number: customerResult.external_number,
            response: result,
            error: null
        };

    } catch (error) {
        console.error(`PayPlus recurring payment failed for child ${child.childName}:`, error);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        return {
            success: false,
            customer_uid: null,
            error: error.response?.data?.results?.description || error.message || 'API call failed'
        };
    }
}

/**
 * Create individual child customers with proper names - Fixed approach
 * This creates a new customer for each child BUT skips the token association step
 */
async function createChildCustomerWithProperName(child, parentData) {
    try {
        const uniqueExternalNumber = `CHILD_${child.childId}_${child.familyId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        const customerPayload = {
            customer_name: child.childName, // Use CHILD name, not parent name
            email: parentData.parent_email || '',
            phone: parentData.parent_phone || '',
            more_info: `Child: ${child.childName}, Parent: ${parentData.parent_name}, Family ID: ${child.familyId}, Relationship: ${child.relationshipToParent}`,
            customer_external_number: uniqueExternalNumber
        };

        console.log(`Creating PayPlus customer for child ${child.childName} with child's name:`, customerPayload);

        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/Customers/Add`,
            customerPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        if (response.data?.results?.status !== 'success') {
            throw new Error(response.data?.results?.description || 'Failed to create customer');
        }

        const customerUid = response.data.data.customer_uid;
        console.log(`✅ Child customer created successfully for ${child.childName}: ${customerUid}`);

        return {
            success: true,
            customer_uid: customerUid,
            external_number: uniqueExternalNumber
        };

    } catch (error) {
        console.error(`❌ Error creating PayPlus customer for child ${child.childName}:`, error);
        
        // If customer already exists, create a fallback
        if (error.response?.data?.results?.description?.includes('already exist')) {
            console.log('Customer already exists, creating fallback UID...');
            const fallbackUid = `FALLBACK_CHILD_${child.childId}_${child.familyId}_${Date.now()}`;
            return {
                success: true,
                customer_uid: fallbackUid,
                external_number: fallbackUid,
                is_fallback: true
            };
        }
        
        throw error;
    }
}

/**
 * Enhanced recurring payment creation with child customers and proper names
 * Key change: We create child customers but use the PARENT's token directly (no token association)
 */
async function createRecurringWithChildCustomerAndProperName(parentToken, child, currency, payPlusCredentials, childIndex = 0) {
    try {
        // Step 1: Create a unique customer for this child with CHILD'S name
        const parentData = {
            parent_name: child.parentName || 'Parent',
            parent_email: child.parentEmail || '',
            parent_phone: child.parentPhone || ''
        };

        const customerResult = await createChildCustomerWithProperName(child, parentData);
        if (!customerResult.success) {
            throw new Error(`Failed to create customer for child ${child.childName}`);
        }

        const childCustomerUid = customerResult.customer_uid;

        // Step 2: Add delay to prevent rapid API calls
        if (childIndex > 0) {
            const delaySeconds = (childIndex * 4) + 2; // 2, 6, 10, 14 seconds...
            console.log(`Adding ${delaySeconds} second delay for child ${child.childName}...`);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }

        // Step 3: Calculate recurring parameters
        const customRecurringRange = child.durationMonths || 1;
        const normalizedRange = Math.max(1, Math.min(12, parseInt(customRecurringRange, 10)));

        // Step 4: Calculate unique start date with maximum separation
        const startDate = new Date();
        const baseMonths = normalizedRange > 1 ? normalizedRange : 1;
        
        // Massive time offsets to prevent conflicts
        const childUniqueMonthOffset = ((parseInt(child.childId) || 1) * 3) + (childIndex * 5); // 3-5 months apart
        const childUniqueDayOffset = ((parseInt(child.childId) || 1) * 17) + (childIndex * 13) + 1; // Prime offsets
        const childUniqueHourOffset = ((parseInt(child.childId) || 1) * 11) + (childIndex * 7); // Hour differences
        
        startDate.setMonth(startDate.getMonth() + baseMonths + childUniqueMonthOffset);
        startDate.setDate(Math.min(28, startDate.getDate() + (childUniqueDayOffset % 25)));
        startDate.setHours((startDate.getHours() + childUniqueHourOffset) % 24);
        startDate.setMinutes((((parseInt(child.childId) || 1) * 19) + (childIndex * 23)) % 60);

        // Step 5: Create maximum unique identifiers
        const timestamp = Date.now();
        const microtime = process.hrtime()[1];
        const randomId = Math.random().toString(36).substr(2, 10);
        
        const nameHash = Buffer.from(child.childName + timestamp).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substr(0, 8);
        const customerHash = childCustomerUid.replace(/-/g, '').substr(-8);
        
        const ultraUniqueId = `${timestamp}_${microtime}_${child.childId}_${childIndex}_${randomId}`;
        const maxUniqueCatalog = `CHILD_${child.childId}_${nameHash}_${customerHash}_${randomId}`;

        // Step 6: Slightly modify amount to ensure complete uniqueness
        const uniqueAmount = parseFloat(child.amount) + (0.01 * (childIndex + 1)); // +1 agora per child

        // Step 7: Build PayPlus recurring payment request using child customer but parent token
        const payload = {
            terminal_uid: payPlusCredentials.terminal_uid,
            cashier_uid: payPlusCredentials.cashier_uid,
            customer_uid: childCustomerUid, // Use CHILD's customer UID (shows child name)
            card_token: parentToken, // Use PARENT's token directly (no association needed)
            
            currency_code: currency,
            
            recurring_type: 2, // Monthly base
            recurring_range: normalizedRange,
            number_of_charges: 0,
            instant_first_payment: false,
            start_date: formatDateForPayPlus(startDate),
            
            items: [{
                name: `${child.childName} ${normalizedRange}M Learning Plan ${ultraUniqueId}`,
                price: uniqueAmount,
                quantity: 1,
                vat_type: 0,
                catalog_number: maxUniqueCatalog
            }],
            
            successful_invoice: true,
            send_customer_success_email: true,
            customer_failure_email: true,
            
            // Ultra-unique extra info
            extra_info: `child${child.childId}_${child.childName.replace(/\s+/g, '')}_${normalizedRange}mo_${formatDateForPayPlus(startDate)}_amt${uniqueAmount}_${ultraUniqueId}_customer${customerHash}`
        };

        console.log(`PayPlus recurring payment with child customer for ${child.childName}:`, {
            child_id: child.childId,
            customer_uid: childCustomerUid,
            customer_name_will_show: child.childName,
            start_date: payload.start_date,
            amount: payload.items[0].price,
            catalog_number: payload.items[0].catalog_number.substr(0, 50) + '...'
        });

        // Step 8: Make the PayPlus API call
        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/RecurringPayments/Add`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        const result = response.data;
        console.log(`PayPlus recurring payment response for child ${child.childName}:`, result);

        if (result?.results?.status !== 'success') {
            throw new Error(result?.results?.description || 'PayPlus API call failed');
        }

        return {
            success: true,
            subscription_id: result?.data?.recurring_payment_uid || result?.data?.uid,
            customer_uid: childCustomerUid,
            customer_external_number: customerResult.external_number,
            unique_amount: uniqueAmount,
            original_amount: child.amount,
            response: result,
            error: null
        };

    } catch (error) {
        console.error(`PayPlus recurring payment with child customer failed for ${child.childName}:`, error);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        return {
            success: false,
            customer_uid: null,
            error: error.response?.data?.results?.description || error.message || 'API call failed'
        };
    }
}

/**
 * Complete solution: Enhanced createRecurringForFamilyFromToken with child name visibility
 * Uses parent customer (for token compatibility) but prominently displays child names
 */

/**
 * Create child-focused recurring payment with parent customer (hybrid approach)
 */
async function createChildFocusedRecurringPayment(parentToken, child, currency, payPlusCredentials, parentCustomerUid, childIndex = 0) {
    try {
        // Calculate recurring parameters
        const customRecurringRange = child.durationMonths || 1;
        const normalizedRange = Math.max(1, Math.min(12, parseInt(customRecurringRange, 10)));

        // Create maximum unique start dates with large time gaps
        const startDate = new Date();
        const baseMonths = normalizedRange > 1 ? normalizedRange : 1;
        
        // Massive time separation between children
        const childUniqueMonthOffset = ((parseInt(child.childId) || 1) * 4) + (childIndex * 6); // 4-6 months apart
        const childUniqueDayOffset = ((parseInt(child.childId) || 1) * 19) + (childIndex * 17) + 1; // Prime offsets
        const childUniqueHourOffset = ((parseInt(child.childId) || 1) * 13) + (childIndex * 11); // Hour differences
        
        startDate.setMonth(startDate.getMonth() + baseMonths + childUniqueMonthOffset);
        startDate.setDate(Math.min(28, startDate.getDate() + (childUniqueDayOffset % 25)));
        startDate.setHours((startDate.getHours() + childUniqueHourOffset) % 24);
        startDate.setMinutes((((parseInt(child.childId) || 1) * 23) + (childIndex * 29)) % 60);
        startDate.setSeconds((((parseInt(child.childId) || 1) * 31) + (childIndex * 37)) % 60);

        // Maximum uniqueness identifiers with multiple entropy sources
        const timestamp = Date.now();
        const microtime = process.hrtime()[1]; // Nanosecond precision
        const randomA = Math.random().toString(36).substr(2, 8);
        const randomB = Math.random().toString(36).substr(2, 8);
        const randomC = Math.random().toString(36).substr(2, 8);
        
        // Hash components for uniqueness
        const childNameHash = Buffer.from(child.childName + timestamp).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substr(0, 8);
        const amountHash = Buffer.from((child.amount * timestamp).toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substr(0, 6);
        const timeHash = Buffer.from(startDate.toISOString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substr(0, 8);
        
        const ultraUniqueId = `${timestamp}_${microtime}_${child.childId}_${childIndex}_${randomA}_${randomB}`;
        const maxUniqueCatalog = `CHILD_${child.childId}_${childNameHash}_${amountHash}_${timeHash}_${randomC}`;

        // Modify amount slightly for uniqueness (1 agora per child index)
        const uniqueAmount = parseFloat(child.amount) + (0.01 * (childIndex + 1));

        // Clean child name for use in identifiers
        const cleanChildName = child.childName.replace(/[^a-zA-Z0-9]/g, '');

        // Build PayPlus recurring payment with CHILD NAME PROMINENCE
        const payload = {
            terminal_uid: payPlusCredentials.terminal_uid,
            cashier_uid: payPlusCredentials.cashier_uid,
            customer_uid: parentCustomerUid, // Use parent customer for token compatibility
            card_token: parentToken,
            
            currency_code: currency,
            
            recurring_type: 2, // Monthly base
            recurring_range: normalizedRange,
            number_of_charges: 0,
            instant_first_payment: false,
            start_date: formatDateForPayPlus(startDate),
            
            items: [{
                // Put child name FIRST and make it prominent
                name: `${child.childName} - ${normalizedRange} Month Learning Plan - ID:${ultraUniqueId}`,
                price: uniqueAmount,
                quantity: 1,
                vat_type: 0,
                catalog_number: maxUniqueCatalog
            }],
            
            successful_invoice: true,
            send_customer_success_email: true,
            customer_failure_email: true,
            
            // Put child name FIRST in extra_info for maximum visibility
            extra_info: `STUDENT_${cleanChildName}_CHILD_${child.childId}_${normalizedRange}MONTHS_${formatDateForPayPlus(startDate)}_AMT${uniqueAmount}_${ultraUniqueId}_IDX${childIndex}_PARENT${parentCustomerUid.substr(-8)}_FAMILY${child.familyId || 'UNK'}`
        };

        console.log(`PayPlus child-focused recurring payment for ${child.childName}:`, {
            child_id: child.childId,
            child_name: child.childName,
            customer_uid_used: parentCustomerUid,
            child_name_in_item: payload.items[0].name,
            start_date: payload.start_date,
            amount: payload.items[0].price,
            catalog_number: payload.items[0].catalog_number.substr(0, 50) + '...',
            extra_info_prefix: payload.extra_info.substr(0, 80) + '...'
        });

        // Make the PayPlus API call
        const response = await axios.post(
            `${PAYPLUS_BASE_URL}/RecurringPayments/Add`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_API_KEY,
                    'secret-key': PAYPLUS_SECRET_KEY
                },
                timeout: 30000
            }
        );

        const result = response.data;
        console.log(`PayPlus child-focused recurring payment response for ${child.childName}:`, result);

        if (result?.results?.status !== 'success') {
            throw new Error(result?.results?.description || 'PayPlus API call failed');
        }

        return {
            success: true,
            subscription_id: result?.data?.recurring_payment_uid || result?.data?.uid,
            customer_uid: parentCustomerUid,
            unique_amount: uniqueAmount,
            original_amount: child.amount,
            child_name_displayed: child.childName,
            approach: 'child_focused_parent_customer',
            response: result,
            error: null
        };

    } catch (error) {
        console.error(`PayPlus child-focused recurring payment failed for child ${child.childName}:`, error);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        return {
            success: false,
            customer_uid: parentCustomerUid,
            child_name: child.childName,
            error: error.response?.data?.results?.description || error.message || 'API call failed'
        };
    }
}


module.exports = {
    generateFamilyPaymentLink,
    getFamilyPaymentData,
    sendFamilyPaymentLinkEmail,
    sendFamilyPaymentLinkWhatsApp,
    modifyFamilyTransaction,
    getFamilyPaymentStatus,
    downloadFamilyInvoice
};