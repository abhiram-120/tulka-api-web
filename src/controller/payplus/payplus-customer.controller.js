const axios = require('axios');
const PaymentTransaction = require('../../models/PaymentTransaction');
const User = require('../../models/users');
const PayPlusWebhookLog = require('../../models/PayPlusWebhookLog');
const PastDuePayment = require('../../models/PastDuePayment');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const DunningSchedule = require('../../models/DunningSchedule');
const { sequelize } = require('../../connection/connection');
const moment = require('moment');
const { Op } = require('sequelize');

// PayPlus API Configuration (align with payment controller)
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0'
};

// Parse response_data even if double-encoded
const parseResponseData = (response) => {
    if (!response) return null;

    const tryParse = (val) => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'object') return val;
        if (typeof val !== 'string') return null;
        try {
            return JSON.parse(val);
        } catch (err) {
            return null;
        }
    };

    // First attempt
    let parsed = tryParse(response);
    // Handle double-encoded string JSON
    if (parsed && typeof parsed === 'string') {
        parsed = tryParse(parsed);
    }
    // If original was already an object
    if (!parsed && typeof response === 'object') {
        parsed = response;
    }
    return parsed || null;
};

const pickField = (obj, paths) => {
    if (!obj) return null;
    for (const path of paths) {
        const parts = path.split('.');
        let current = obj;
        let found = true;
        for (const p of parts) {
            if (current && Object.prototype.hasOwnProperty.call(current, p)) {
                current = current[p];
            } else {
                found = false;
                break;
            }
        }
        if (found && current !== undefined && current !== null) {
            return current;
        }
    }
    return null;
};

// Normalize email for loose equality comparison between system and PayPlus
// - lowercases
// - trims
// - in the local part, normalizes the +tag by removing spaces and hyphens
//   so: "yosidatikashvili+Lana DATIKASHVILI@gmail.com"
//   and  "yosidatikashvili+lana-datikashvili@gmail.com" are treated as equal.
const normalizeEmailForComparison = (email) => {
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.toLowerCase().trim();
    const atIdx = trimmed.indexOf('@');
    if (atIdx === -1) return trimmed;

    const local = trimmed.slice(0, atIdx);
    const domain = trimmed.slice(atIdx + 1);

    const plusIdx = local.indexOf('+');
    if (plusIdx === -1) {
        return `${local}@${domain}`;
    }

    const base = local.slice(0, plusIdx);
    const tag = local.slice(plusIdx + 1);

    // Remove spaces and hyphens in the tag portion
    const normalizedTag = tag.replace(/[\s-]+/g, '');

    return `${base}+${normalizedTag}@${domain}`;
};

const emailsLooselyEqual = (a, b) => {
    const na = normalizeEmailForComparison(a);
    const nb = normalizeEmailForComparison(b);
    if (!na || !nb) return false;
    return na === nb;
};

// Shared builder to assemble placeholder data and original payer lookup
const buildPlaceholderData = async () => {
    // 1) Fetch placeholder transactions
    const placeholderTxns = await PaymentTransaction.findAll({
        where: {
            payment_processor: 'payplus',
            status: 'success',
            student_name: 'PayPlus Customer'
        },
        include: [
            {
                model: User,
                as: 'Student',
                attributes: ['full_name', 'email'],
                required: false
            }
        ],
        order: [['created_at', 'DESC']]
    });

    // Collect customer_uids from placeholders for lookup
    const placeholderUids = new Set();
    const placeholderParsed = placeholderTxns.map((txn) => {
        const raw = parseResponseData(txn.response_data);
        const customerUid = pickField(raw, [
            'customer_uid',
            'data.customer_uid',
            'customer.uid',
            'transaction.customer_uid'
        ]);
        const customerEmail = pickField(raw, [
            'customer_email',
            'data.customer_email',
            'customer.email',
            'transaction.customer_email'
        ]);
        const customerName = pickField(raw, [
            'customer_name',
            'data.customer_name',
            'customer.name',
            'transaction.customer_name'
        ]);

        if (customerUid) {
            placeholderUids.add(customerUid);
        }

        return {
            payment_txn_id: txn.id,
            student_id: txn.student_id,
            student_name: txn.student_name,
            student_email: txn.student_email,
            user_name: txn.Student?.full_name || null,
            current_email: txn.Student?.email || null,
            original_customer_name: customerName || null,
            customer_uid: customerUid || null,
            payplus_email: customerEmail || null,
            created_at: txn.created_at,
            __raw: raw // keep parsed data for potential future use
        };
    });

    // De-duplicate placeholder entries by customer_uid (keep latest since sorted DESC)
    const placeholderUnique = [];
    const seenUids = new Set();
    for (const p of placeholderParsed) {
        if (p.customer_uid) {
            if (seenUids.has(p.customer_uid)) continue;
            seenUids.add(p.customer_uid);
        }
        placeholderUnique.push(p);
    }

    // 2) Find the earliest transaction per customer_uid among all PayPlus successes
    const originalByUid = {};
    if (placeholderUids.size > 0) {
        const allPayPlusTxns = await PaymentTransaction.findAll({
            where: {
                payment_processor: 'payplus',
                status: 'success'
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['full_name', 'email'],
                    required: false
                }
            ],
            order: [['created_at', 'ASC']],
            attributes: [
                'id',
                'student_id',
                'student_name',
                'student_email',
                'response_data',
                'created_at'
            ]
        });

        for (const txn of allPayPlusTxns) {
            const raw = parseResponseData(txn.response_data);
            const uid = pickField(raw, [
                'customer_uid',
                'data.customer_uid',
                'customer.uid',
                'transaction.customer_uid'
            ]);

            if (!uid || !placeholderUids.has(uid)) continue;
            if (originalByUid[uid]) continue; // already have earliest

            originalByUid[uid] = {
                payment_txn_id: txn.id,
                student_id: txn.student_id,
                student_name: txn.student_name,
                student_email: txn.student_email,
                user_name: txn.Student?.full_name || null,
                current_email: txn.Student?.email || null,
                payplus_email: pickField(raw, [
                    'customer_email',
                    'data.customer_email',
                    'customer.email',
                    'transaction.customer_email'
                ]) || null,
                customer_uid: uid,
                created_at: txn.created_at
            };
        }
    }

    // 3) Combine placeholder with original payer info
    const data = placeholderUnique.map((p) => {
        const original = p.customer_uid ? originalByUid[p.customer_uid] : null;
        return {
            payment_txn_id: p.payment_txn_id,
            student_id: p.student_id,
            student_name: p.student_name,
            student_email: p.student_email,
            user_name: p.user_name,
            current_email: p.current_email,
            original_customer_name: p.original_customer_name,
            customer_uid: p.customer_uid,
            payplus_email: p.payplus_email,
            created_at: p.created_at,
            original_payer: original ? {
                payment_txn_id: original.payment_txn_id,
                student_id: original.student_id,
                student_name: original.student_name,
                student_email: original.student_email,
                user_name: original.user_name,
                current_email: original.current_email,
                payplus_email: original.payplus_email,
                customer_uid: original.customer_uid,
                created_at: original.created_at
            } : null
        };
    });

    return data;
};

/**
 * Public endpoint: list PayPlus transactions that were created with the
 * placeholder name "PayPlus Customer". This helps identify records where
 * the customer email/UID were not captured/synced.
 *
 * No auth on purpose (requested), so keep the response lean and read-only.
 */
const getPayPlusPlaceholderCustomers = async (req, res) => {
    try {
        const data = await buildPlaceholderData();
        return res.status(200).json({
            status: 'success',
            count: data.length,
            data
        });
    } catch (error) {
        console.error('Error fetching PayPlus placeholder customers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch PayPlus customer records',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Fix the placeholder customers by updating PayPlus with the canonical
 * customer name/email from the original payer record.
 */
const fixPayPlusPlaceholderCustomers = async (req, res) => {
    try {
        const data = await buildPlaceholderData();
        const results = [];

        for (const entry of data) {
            const uid = entry.customer_uid;
            const original = entry.original_payer;
            if (!uid || !original) {
                results.push({
                    customer_uid: uid || null,
                    status: 'skipped',
                    message: 'Missing customer_uid or original payer'
                });
                continue;
            }

            const canonicalEmail = original.current_email || original.student_email || entry.current_email || entry.student_email;
            const canonicalName = original.user_name || original.student_name || entry.original_customer_name || entry.student_name || 'Customer';

            const payload = {
                customer_name: canonicalName,
                email: canonicalEmail,
                communication_email: canonicalEmail
            };

            try {
                const url = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${uid}`;
                await axios.post(url, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': PAYPLUS_CONFIG.apiKey,
                        'secret-key': PAYPLUS_CONFIG.secretKey
                    },
                    timeout: 30000
                });

                results.push({
                    customer_uid: uid,
                    status: 'success',
                    email_used: canonicalEmail,
                    customer_name_used: canonicalName,
                    placeholder_student_id: entry.student_id,
                    original_student_id: original.student_id
                });
            } catch (apiErr) {
                results.push({
                    customer_uid: uid,
                    status: 'failed',
                    email_used: canonicalEmail,
                    customer_name_used: canonicalName,
                    placeholder_student_id: entry.student_id,
                    original_student_id: original.student_id,
                    message: apiErr.response?.data || apiErr.message
                });
            }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const failedCount = results.filter(r => r.status === 'failed').length;
        const skippedCount = results.filter(r => r.status === 'skipped').length;

        return res.status(200).json({
            status: 'success',
            summary: { success: successCount, failed: failedCount, skipped: skippedCount },
            results
        });
    } catch (error) {
        console.error('Error fixing PayPlus placeholder customers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fix PayPlus customer records',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get users who have recurring payments in PayPlus but are not in our system
 * This helps identify customers who need to be added to the database
 */
const getOrphanedRecurringPayments = async (req, res) => {
    try {
        console.log('🔍 Fetching orphaned recurring payments from PayPlus...');

        // Get terminal UID from environment
        const terminalUid = process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7';

        // 1. Fetch all recurring payments from PayPlus with increased timeout
        const payPlusTimeout = parseInt(process.env.PAYPLUS_TIMEOUT) || 120000; // Default 120 seconds
        console.log(`⏱️ Using PayPlus timeout: ${payPlusTimeout}ms`);
        
        let payPlusResponse;
        try {
            payPlusResponse = await axios.get(
                `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/View`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': PAYPLUS_CONFIG.apiKey,
                        'secret-key': PAYPLUS_CONFIG.secretKey
                    },
                    params: {
                        terminal_uid: terminalUid
                    },
                    timeout: payPlusTimeout,
                    maxRedirects: 5,
                    maxContentLength: 50 * 1024 * 1024 // 50MB
                }
            );
        } catch (payPlusError) {
            console.error('❌ PayPlus API Error:', {
                code: payPlusError.code,
                message: payPlusError.message,
                response: payPlusError.response?.data
            });
            
            if (payPlusError.code === 'ECONNABORTED' || payPlusError.message.includes('timeout')) {
                return res.status(504).json({
                    status: 'error',
                    message: 'PayPlus API request timed out. Please try again later or contact support.',
                    error: 'timeout',
                    details: {
                        timeout_used: payPlusTimeout,
                        suggestion: 'Increase PAYPLUS_TIMEOUT environment variable'
                    }
                });
            }
            
            if (payPlusError.response) {
                return res.status(payPlusError.response.status || 500).json({
                    status: 'error',
                    message: 'PayPlus API returned an error',
                    error: payPlusError.response.data || payPlusError.message
                });
            }
            
            throw payPlusError;
        }

        // Log the response structure for debugging (only first 500 chars to avoid huge logs)
        if (payPlusResponse?.data) {
            console.log('PayPlus API Response Structure:', JSON.stringify(payPlusResponse.data, null, 2).substring(0, 500));
        }

        // Handle different response structures from PayPlus
        let recurringPayments = [];
        
        if (payPlusResponse?.data) {
            // Try different possible response structures
            if (payPlusResponse.data.results && payPlusResponse.data.results.data) {
                recurringPayments = payPlusResponse.data.results.data;
            } else if (payPlusResponse.data.data) {
                recurringPayments = payPlusResponse.data.data;
            } else if (Array.isArray(payPlusResponse.data)) {
                recurringPayments = payPlusResponse.data;
            } else if (payPlusResponse.data.results && Array.isArray(payPlusResponse.data.results)) {
                recurringPayments = payPlusResponse.data.results;
            }
        }

        // Ensure recurringPayments is an array
        if (!Array.isArray(recurringPayments)) {
            console.error('Invalid PayPlus response format:', typeof recurringPayments);
            return res.status(200).json({
                status: 'success',
                message: 'No recurring payments found in PayPlus or invalid response format',
                count: 0,
                orphaned: [],
                debug: {
                    responseType: typeof payPlusResponse?.data,
                    hasResults: !!payPlusResponse?.data?.results,
                    hasData: !!payPlusResponse?.data?.data
                }
            });
        }

        console.log(`✅ Found ${recurringPayments.length} recurring payments in PayPlus`);

        // 2. Optimize: Use raw query to fetch only emails (much faster than ORM)
        const sequelize = User.sequelize;
        const { QueryTypes } = require('sequelize');
        const systemEmailsResult = await sequelize.query(
            `SELECT LOWER(TRIM(email)) as email FROM users WHERE email IS NOT NULL AND email != ''`,
            {
                type: QueryTypes.SELECT
            }
        );

        // Create a Set of system emails for fast lookup (case-insensitive)
        const systemEmails = new Set(
            systemEmailsResult.map(row => row.email)
        );

        console.log(`✅ Found ${systemEmails.size} users in our system`);

        // 3. Identify orphaned recurring payments
        const orphaned = [];
        
        for (const payment of recurringPayments) {
            const customerEmail = payment.customer_email?.toLowerCase().trim();
            const customerName = payment.customer_name;
            const customerUid = payment.customer_uid;
            const recurringUid = payment.recurring_uid;
            const amount = payment.amount;
            const currency = payment.currency_code || 'ILS';
            const status = payment.status;
            const nextPaymentDate = payment.next_payment_date;
            const createdDate = payment.created;

            // Check if email exists in our system
            if (customerEmail && !systemEmails.has(customerEmail)) {
                orphaned.push({
                    customer_uid: customerUid,
                    recurring_uid: recurringUid,
                    customer_name: customerName,
                    customer_email: customerEmail,
                    amount: amount,
                    currency: currency,
                    status: status,
                    next_payment_date: nextPaymentDate,
                    created_date: createdDate,
                    reason: 'Email not found in system'
                });
            } else if (!customerEmail) {
                orphaned.push({
                    customer_uid: customerUid,
                    recurring_uid: recurringUid,
                    customer_name: customerName,
                    customer_email: null,
                    amount: amount,
                    currency: currency,
                    status: status,
                    next_payment_date: nextPaymentDate,
                    created_date: createdDate,
                    reason: 'No email address in PayPlus'
                });
            }
        }

        console.log(`⚠️ Found ${orphaned.length} orphaned recurring payments`);

        // 4. Group by status for better insights
        const statusSummary = orphaned.reduce((acc, payment) => {
            const status = payment.status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        return res.status(200).json({
            status: 'success',
            summary: {
                total_recurring_payments: recurringPayments.length,
                system_users: systemEmails.size,
                orphaned_count: orphaned.length,
                status_breakdown: statusSummary
            },
            orphaned: orphaned
        });

    } catch (error) {
        console.error('❌ Error fetching orphaned recurring payments:', error);
        
        // Handle timeout errors specifically
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return res.status(504).json({
                status: 'error',
                message: 'Request timed out. The operation took too long to complete.',
                error: 'timeout',
                details: process.env.NODE_ENV === 'development' ? error.message : null
            });
        }
        
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch orphaned recurring payments',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: error.response?.data || null
        });
    }
};

/**
 * Update email for a specific customer in PayPlus
 */
const updateCustomerEmail = async (req, res) => {
    try {
        const { customer_uid, email, customer_name } = req.body;

        // Validate input
        if (!customer_uid || !email) {
            return res.status(400).json({
                status: 'error',
                message: 'customer_uid and email are required'
            });
        }

        console.log(`🔄 Updating customer ${customer_uid} email to ${email}`);

        const payload = {
            customer_name: customer_name || 'Customer',
            email: email,
            communication_email: email
        };

        const url = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${customer_uid}`;
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': PAYPLUS_CONFIG.apiKey,
                'secret-key': PAYPLUS_CONFIG.secretKey
            },
            timeout: 30000
        });

        console.log(`✅ Successfully updated customer ${customer_uid} email`);

        return res.status(200).json({
            status: 'success',
            message: 'Customer email updated successfully',
            customer_uid: customer_uid,
            email: email,
            payplus_response: response.data
        });

    } catch (error) {
        console.error('❌ Error updating customer email:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update customer email',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: error.response?.data || null
        });
    }
};

/**
 * Find users who exist in our system but have mismatched emails in PayPlus
 * This identifies users who changed their email in our system but PayPlus wasn't updated
 */
const getMismatchedEmailUsers = async (req, res) => {
    try {
        console.log('🔍 Checking for email mismatches between system and PayPlus...');

        // Get terminal UID from environment
        const terminalUid = process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7';

        // 1. Fetch all recurring payments from PayPlus
        const payPlusResponse = await axios.get(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/View`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                params: {
                    terminal_uid: terminalUid
                },
                timeout: 30000
            }
        );

        // Log the response structure for debugging
        console.log('PayPlus API Response Structure:', JSON.stringify(payPlusResponse.data, null, 2).substring(0, 500));

        // Handle different response structures from PayPlus
        let recurringPayments = [];
        
        if (payPlusResponse.data) {
            // Try different possible response structures
            if (payPlusResponse.data.results && payPlusResponse.data.results.data) {
                recurringPayments = payPlusResponse.data.results.data;
            } else if (payPlusResponse.data.data) {
                recurringPayments = payPlusResponse.data.data;
            } else if (Array.isArray(payPlusResponse.data)) {
                recurringPayments = payPlusResponse.data;
            } else if (payPlusResponse.data.results && Array.isArray(payPlusResponse.data.results)) {
                recurringPayments = payPlusResponse.data.results;
            }
        }

        // Ensure recurringPayments is an array
        if (!Array.isArray(recurringPayments)) {
            console.error('Invalid PayPlus response format:', typeof recurringPayments);
            return res.status(200).json({
                status: 'success',
                message: 'No recurring payments found in PayPlus or invalid response format',
                count: 0,
                mismatched: [],
                debug: {
                    responseType: typeof payPlusResponse.data,
                    hasResults: !!payPlusResponse.data?.results,
                    hasData: !!payPlusResponse.data?.data
                }
            });
        }

        console.log(`✅ Found ${recurringPayments.length} recurring payments in PayPlus`);

        // 2. Get all payment transactions with customer info to map customer_uid to student_id
        const paymentTransactions = await PaymentTransaction.findAll({
            where: {
                payment_processor: 'payplus',
                status: 'success',
                student_id: {
                    [require('sequelize').Op.ne]: null
                }
            },
            attributes: ['id', 'student_id', 'student_email', 'student_name', 'response_data'],
            include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'email', 'full_name', 'mobile'],
                required: true
            }]
        });

        console.log(`✅ Found ${paymentTransactions.length} payment transactions in system`);

        // 3. Build a mapping of customer_uid -> student info and current email
        const customerUidMap = new Map();
        
        for (const txn of paymentTransactions) {
            const responseData = parseResponseData(txn.response_data);
            const customerUid = pickField(responseData, [
                'customer_uid',
                'data.customer_uid',
                'customer.uid',
                'transaction.customer_uid'
            ]);

            if (customerUid && txn.Student) {
                // Store the most recent transaction for each customer_uid
                if (!customerUidMap.has(customerUid)) {
                    customerUidMap.set(customerUid, {
                        customer_uid: customerUid,
                        student_id: txn.student_id,
                        student_name: txn.Student.full_name,
                        current_system_email: txn.Student.email,
                        student_mobile: txn.Student.mobile,
                        original_transaction_email: txn.student_email
                    });
                }
            }
        }

        console.log(`✅ Mapped ${customerUidMap.size} customer UIDs to system users`);

        // 4. Compare emails and find mismatches
        const mismatched = [];
        
        for (const payment of recurringPayments) {
            const customerUid = payment.customer_uid;
            const rawPayplusEmail = payment.customer_email;
            const payplusEmail = rawPayplusEmail?.toLowerCase().trim();
            const payplusName = payment.customer_name;
            
            if (!customerUid || !payplusEmail) continue;

            const systemUser = customerUidMap.get(customerUid);
            
            if (systemUser) {
                const systemEmail = systemUser.current_system_email?.toLowerCase().trim();
                
                // Check if emails don't match (using loose comparison that normalizes +tags)
                if (systemEmail && !emailsLooselyEqual(systemEmail, payplusEmail)) {
                    mismatched.push({
                        customer_uid: customerUid,
                        recurring_uid: payment.recurring_uid,
                        student_id: systemUser.student_id,
                        student_name: systemUser.student_name,
                        system_email: systemUser.current_system_email,
                        payplus_email: rawPayplusEmail,
                        payplus_name: payplusName,
                        amount: payment.amount,
                        currency: payment.currency_code || 'ILS',
                        status: payment.status,
                        next_payment_date: payment.next_payment_date,
                        mobile: systemUser.student_mobile,
                        needs_update: true,
                        reason: 'Email mismatch - system email differs from PayPlus'
                    });
                }
            }
        }

        console.log(`⚠️ Found ${mismatched.length} users with mismatched emails`);

        // 5. Group by status for insights
        const statusSummary = mismatched.reduce((acc, user) => {
            const status = user.status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        return res.status(200).json({
            status: 'success',
            summary: {
                total_recurring_payments: recurringPayments.length,
                mapped_users: customerUidMap.size,
                mismatched_count: mismatched.length,
                status_breakdown: statusSummary
            },
            mismatched: mismatched
        });

    } catch (error) {
        console.error('❌ Error checking email mismatches:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to check email mismatches',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: error.response?.data || null
        });
    }
};

/**
 * Bulk update emails in PayPlus for users with mismatched emails
 * Updates PayPlus with the current email from our system
 */
const fixMismatchedEmails = async (req, res) => {
    try {
        const { customer_uids } = req.body; // Array of customer UIDs to update, or null/undefined to update all

        console.log('🔄 Starting bulk email update in PayPlus...');

        // Get terminal UID from environment
        const terminalUid = process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7';

        // 1. Fetch all recurring payments from PayPlus
        const payPlusResponse = await axios.get(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/View`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                params: {
                    terminal_uid: terminalUid
                },
                timeout: 30000
            }
        );

        // Handle different response structures from PayPlus
        let recurringPayments = [];
        
        if (payPlusResponse.data) {
            // Try different possible response structures
            if (payPlusResponse.data.results && payPlusResponse.data.results.data) {
                recurringPayments = payPlusResponse.data.results.data;
            } else if (payPlusResponse.data.data) {
                recurringPayments = payPlusResponse.data.data;
            } else if (Array.isArray(payPlusResponse.data)) {
                recurringPayments = payPlusResponse.data;
            } else if (payPlusResponse.data.results && Array.isArray(payPlusResponse.data.results)) {
                recurringPayments = payPlusResponse.data.results;
            }
        }

        // Ensure recurringPayments is an array
        if (!Array.isArray(recurringPayments)) {
            return res.status(200).json({
                status: 'success',
                message: 'No recurring payments found in PayPlus or invalid response format',
                results: []
            });
        }

        console.log(`✅ Found ${recurringPayments.length} recurring payments in PayPlus for bulk update`);

        // 2. Get all payment transactions with customer info
        const paymentTransactions = await PaymentTransaction.findAll({
            where: {
                payment_processor: 'payplus',
                status: 'success',
                student_id: {
                    [require('sequelize').Op.ne]: null
                }
            },
            attributes: ['id', 'student_id', 'student_email', 'student_name', 'response_data'],
            include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'email', 'full_name'],
                required: true
            }]
        });

        // 3. Build customer_uid mapping
        const customerUidMap = new Map();
        
        for (const txn of paymentTransactions) {
            const responseData = parseResponseData(txn.response_data);
            const customerUid = pickField(responseData, [
                'customer_uid',
                'data.customer_uid',
                'customer.uid',
                'transaction.customer_uid'
            ]);

            if (customerUid && txn.Student) {
                if (!customerUidMap.has(customerUid)) {
                    customerUidMap.set(customerUid, {
                        customer_uid: customerUid,
                        student_id: txn.student_id,
                        student_name: txn.Student.full_name,
                        current_system_email: txn.Student.email
                    });
                }
            }
        }

        // 4. Find and update mismatched emails
        const results = [];
        let updateCount = 0;

        for (const payment of recurringPayments) {
            const customerUid = payment.customer_uid;
            const payplusEmail = payment.customer_email?.toLowerCase().trim();
            
            if (!customerUid || !payplusEmail) continue;

            // If specific customer_uids provided, only process those
            if (customer_uids && Array.isArray(customer_uids) && !customer_uids.includes(customerUid)) {
                continue;
            }

            const systemUser = customerUidMap.get(customerUid);
            
            if (systemUser) {
                const systemEmail = systemUser.current_system_email?.toLowerCase().trim();
                
                // Check if emails don't match
                if (systemEmail && payplusEmail !== systemEmail) {
                    try {
                        updateCount++;
                        
                        // Update PayPlus
                        const payload = {
                            customer_name: systemUser.student_name || 'Customer',
                            email: systemUser.current_system_email,
                            communication_email: systemUser.current_system_email
                        };

                        const url = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${customerUid}`;
                        await axios.post(url, payload, {
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': PAYPLUS_CONFIG.apiKey,
                                'secret-key': PAYPLUS_CONFIG.secretKey
                            },
                            timeout: 30000
                        });

                        results.push({
                            customer_uid: customerUid,
                            student_id: systemUser.student_id,
                            student_name: systemUser.student_name,
                            old_email: payment.customer_email,
                            new_email: systemUser.current_system_email,
                            status: 'success'
                        });

                        console.log(`✅ Updated ${customerUid}: ${payment.customer_email} -> ${systemUser.current_system_email}`);

                    } catch (updateError) {
                        results.push({
                            customer_uid: customerUid,
                            student_id: systemUser.student_id,
                            student_name: systemUser.student_name,
                            old_email: payment.customer_email,
                            new_email: systemUser.current_system_email,
                            status: 'failed',
                            error: updateError.response?.data || updateError.message
                        });

                        console.error(`❌ Failed to update ${customerUid}:`, updateError.message);
                    }
                }
            }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const failedCount = results.filter(r => r.status === 'failed').length;

        console.log(`✅ Bulk update completed: ${successCount} success, ${failedCount} failed`);

        return res.status(200).json({
            status: 'success',
            summary: {
                total_processed: results.length,
                success: successCount,
                failed: failedCount
            },
            results: results
        });

    } catch (error) {
        console.error('❌ Error fixing mismatched emails:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fix mismatched emails',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: error.response?.data || null
        });
    }
};

/**
 * Helper: create or update a single PastDuePayment + DunningSchedule for reconciliation
 * This mirrors the core behavior of the webhook dunning logic but is scoped to manual fix.
 */
const createOrUpdatePastDueForReconciliation = async ({
    user,
    subscription,
    amount,
    currency,
    failedAt,
    statusCode,
    statusDescription,
    webhookLog,
    transactionRecord,
    transaction
}) => {
    const userId = user.id;

    // 1) Find existing active past-due record for this user (at most one)
    let pastDue = await PastDuePayment.findOne(
        {
            where: {
                user_id: userId,
                status: 'past_due'
            }
        },
        { transaction }
    );

    const gracePeriodDays = parseInt(process.env.DUNNING_GRACE_PERIOD_DAYS, 10) || 30;
    const graceExpiry = moment(failedAt).add(gracePeriodDays, 'days').toDate();

    const baseNote = `[${new Date().toISOString()}] Reconciled from PayPlus webhook log ${webhookLog.id} for transaction ${transactionRecord.transaction_id}`;

    let created = false;

    if (pastDue) {
        // Update existing past due record, keep original failed_at and grace_period_expires_at
        const updatedNotes =
            (pastDue.notes || '') +
            `\n${baseNote} | Additional failure: ${statusDescription} (Code: ${statusCode}).`;

        await pastDue.update(
            {
                amount,
                currency,
                attempt_number: (pastDue.attempt_number || 1) + 1,
                failure_status_code: statusCode,
                failure_message_description: statusDescription,
                notes: updatedNotes
            },
            { transaction }
        );
    } else {
        // Create a new past due record
        const notes = `Initial failure (reconciliation): ${statusDescription} (Code: ${statusCode}). ${baseNote}`;

        pastDue = await PastDuePayment.create(
            {
                user_id: userId,
                subscription_id: subscription?.id || null,
                amount,
                currency,
                failed_at: failedAt,
                due_date: moment(failedAt).format('YYYY-MM-DD'),
                grace_period_days: gracePeriodDays,
                grace_period_expires_at: graceExpiry,
                status: 'past_due',
                attempt_number: 1,
                failure_status_code: statusCode,
                failure_message_description: statusDescription,
                notes
            },
            { transaction }
        );
        created = true;
    }

    // 2) Ensure a DunningSchedule exists/enabled for this past-due record
    let dunning = await DunningSchedule.findOne(
        {
            where: { past_due_payment_id: pastDue.id }
        },
        { transaction }
    );

    const userTimezone = user.timezone || 'Asia/Jerusalem';
    const reminderTime = process.env.DUNNING_REMINDER_TIME || '10:00';
    const [hours, minutes] = reminderTime.split(':').map((n) => parseInt(n, 10) || 0);

    const nextReminderAt = moment()
        .tz ? moment().tz(userTimezone).add(1, 'day').hour(hours).minute(minutes).second(0).toDate()
        : moment().add(1, 'day').hour(hours).minute(minutes).second(0).toDate();

    if (dunning) {
        await dunning.update(
            {
                is_enabled: true,
                is_paused: false,
                next_reminder_at: nextReminderAt,
                timezone: userTimezone
            },
            { transaction }
        );
    } else {
        await DunningSchedule.create(
            {
                past_due_payment_id: pastDue.id,
                user_id: userId,
                is_enabled: true,
                is_paused: false,
                reminder_frequency: 'daily',
                reminder_time: `${hours.toString().padStart(2, '0')}:${minutes
                    .toString()
                    .padStart(2, '0')}:00`,
                timezone: userTimezone,
                next_reminder_at: nextReminderAt
            },
            { transaction }
        );
    }

    return { created, pastDueId: pastDue.id };
};

/**
 * GET /api/payplus/failed-webhooks
 * List PayPlus webhooks with status_code = '1' (failed) and their related transactions,
 * optionally filtered by customer_email.
 */
const getFailedWebhookFailures = async (req, res) => {
    try {
        const { customer_email } = req.query;

        const where = { status_code: '1' };
        if (customer_email) {
            where.customer_email = customer_email;
        }

        const logs = await PayPlusWebhookLog.findAll({
            where,
            order: [
                ['customer_email', 'ASC'],
                ['created_at', 'ASC']
            ]
        });

        if (!logs.length) {
            return res.status(200).json({
                status: 'success',
                summary: {
                    total_logs: 0
                },
                data: []
            });
        }

        // Map transaction_uids -> logs
        const byTxnUid = new Map();
        const txnUids = [];
        for (const log of logs) {
            if (log.transaction_uid) {
                txnUids.push(log.transaction_uid);
                if (!byTxnUid.has(log.transaction_uid)) {
                    byTxnUid.set(log.transaction_uid, []);
                }
                byTxnUid.get(log.transaction_uid).push(log);
            }
        }

        // Load matching PaymentTransactions in one query
        const txns = txnUids.length
            ? await PaymentTransaction.findAll({
                  where: {
                      transaction_id: { [require('sequelize').Op.in]: txnUids }
                  },
                  include: [
                      {
                          model: User,
                          as: 'Student',
                          attributes: ['id', 'full_name', 'email'],
                          required: false
                      }
                  ]
              })
            : [];

        const txnById = new Map();
        txns.forEach((t) => txnById.set(t.transaction_id, t));

        const result = logs.map((log) => {
            const txn = log.transaction_uid ? txnById.get(log.transaction_uid) : null;
            return {
                webhook: {
                    id: log.id,
                    transaction_uid: log.transaction_uid,
                    event_type: log.event_type,
                    status_code: log.status_code,
                    status_description: log.status_description,
                    amount: log.amount,
                    currency_code: log.currency_code,
                    customer_email: log.customer_email,
                    customer_name: log.customer_name,
                    created_at: log.created_at
                },
                transaction: txn
                    ? {
                          id: txn.id,
                          transaction_id: txn.transaction_id,
                          status: txn.status,
                          amount: txn.amount,
                          currency: txn.currency,
                          student_id: txn.student_id,
                          student_name: txn.Student?.full_name || txn.student_name,
                          student_email: txn.Student?.email || txn.student_email,
                          created_at: txn.created_at
                      }
                    : null
            };
        });

        return res.status(200).json({
            status: 'success',
            summary: {
                total_logs: logs.length,
                with_transaction: txns.length
            },
            data: result
        });
    } catch (error) {
        console.error('❌ Error fetching failed webhooks:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch failed PayPlus webhooks',
            details: error.message
        });
    }
};

/**
 * POST /api/payplus/failed-webhooks/:userId/fix
 * For a given user, find PayPlus webhooks with status_code = '1' and linked transactions,
 * mark those transactions as failed, and create corresponding PastDuePayment records.
 */
const fixFailedWebhookFailuresForUser = async (req, res) => {
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

        const user = await User.findByPk(studentId);
        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Load all PayPlus transactions for this user
        const userTxns = await PaymentTransaction.findAll({
            where: {
                student_id: studentId,
                payment_processor: 'payplus'
            }
        });

        if (!userTxns.length) {
            return res.status(200).json({
                status: 'success',
                message: 'No PayPlus transactions found for this user',
                data: {
                    updated_transactions: 0,
                    created_past_due: 0
                }
            });
        }

        const txnIdSet = new Set(userTxns.map((t) => t.transaction_id));

        // Load webhooks with status_code = '1' that match these transactions
        const failedLogs = await PayPlusWebhookLog.findAll({
            where: {
                status_code: '1',
                transaction_uid: {
                    [require('sequelize').Op.in]: Array.from(txnIdSet)
                }
            },
            order: [['created_at', 'ASC']]
        });

        if (!failedLogs.length) {
            return res.status(200).json({
                status: 'success',
                message: 'No failed webhooks (status_code = 1) found for this user',
                data: {
                    updated_transactions: 0,
                    created_past_due: 0
                }
            });
        }

        // Map transaction_id -> PaymentTransaction
        const userTxnById = new Map();
        userTxns.forEach((t) => userTxnById.set(t.transaction_id, t));

        transaction = await sequelize.transaction();

        let updatedTransactions = 0;
        let createdPastDue = 0;

        for (const log of failedLogs) {
            const txn = userTxnById.get(log.transaction_uid);
            if (!txn) continue;

            // 1) Update transaction status to failed if it is currently success
            if (txn.status !== 'failed') {
                await txn.update(
                    {
                        status: 'failed',
                        error_code: log.status_code || txn.error_code,
                        error_message: log.status_description || txn.error_message,
                        updated_at: new Date()
                    },
                    { transaction }
                );
                updatedTransactions += 1;
            }

            // 2) If this is a recurring transaction, create/update a single PastDuePayment
            //    and its DunningSchedule using local reconciliation logic.
            if (txn.is_recurring) {
                let raw = log.raw_webhook_data || {};
                if (typeof raw === 'string') {
                    try {
                        raw = JSON.parse(raw);
                    } catch (e) {
                        raw = {};
                    }
                }

                const failedAt = log.created_at || txn.created_at || new Date();
                const amount = parseFloat(txn.amount || log.amount || 0);
                const currency = txn.currency || log.currency_code || 'ILS';
                const statusCode = log.status_code || '1';
                const statusDescription =
                    log.status_description || `PayPlus status_code=${statusCode} failure`;

                const createdOrUpdated = await createOrUpdatePastDueForReconciliation({
                    user,
                    transaction,
                    subscription: null,
                    amount,
                    currency,
                    failedAt,
                    statusCode,
                    statusDescription,
                    webhookLog: log,
                    transactionRecord: txn
                });

                if (createdOrUpdated) {
                    createdPastDue += createdOrUpdated.created ? 1 : 0;
                }
            }

            // Mark webhook as processed
            await log.update(
                {
                    processed: true,
                    updated_at: new Date()
                },
                { transaction }
            );
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Failed webhooks reconciled for user',
            data: {
                updated_transactions: updatedTransactions,
                created_past_due: createdPastDue,
                failed_webhooks_processed: failedLogs.length
            }
        });
    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('❌ Error fixing failed webhooks for user:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to reconcile failed webhooks for user',
            details: error.message
        });
    }
};

module.exports = {
    getPayPlusPlaceholderCustomers,
    fixPayPlusPlaceholderCustomers,
    getOrphanedRecurringPayments,
    updateCustomerEmail,
    getMismatchedEmailUsers,
    fixMismatchedEmails,
    getFailedWebhookFailures,
    fixFailedWebhookFailuresForUser
};