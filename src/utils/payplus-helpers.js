// utils/payplus-helpers.js
const { FamilyPaymentTransaction, FamilyPaymentLink } = require('../models/Family');
const { Op } = require('sequelize');

/**
 * Extract PayPlus credentials from webhook response data
 * @param {Object} payplus_response_data - The stored webhook response data
 * @returns {Object} Extracted credentials or null
 */
function extractPayPlusCredentials(payplus_response_data) {
    try {
        if (!payplus_response_data) {
            console.warn('No payplus_response_data provided');
            return null;
        }

        let webhookData = payplus_response_data;
        
        console.log('Raw payplus_response_data type:', typeof payplus_response_data);

        // Handle case where data is stored as JSON string (potentially double-encoded)
        if (typeof webhookData === 'string') {
            try {
                // First JSON.parse attempt
                webhookData = JSON.parse(webhookData);
                console.log('First parse - result type:', typeof webhookData);
                
                // Check if we got a string back (indicating double-encoding)
                if (typeof webhookData === 'string') {
                    console.log('Double-encoded JSON detected, parsing again...');
                    webhookData = JSON.parse(webhookData);
                    console.log('Second parse - result type:', typeof webhookData);
                }
                
                console.log('Successfully parsed JSON, final type:', typeof webhookData);
                console.log('Final object keys:', Object.keys(webhookData));
                
            } catch (parseError) {
                console.error('Failed to parse payplus_response_data JSON:', parseError);
                return null;
            }
        }

        // Validate that we have a proper object
        if (!webhookData || typeof webhookData !== 'object') {
            console.error('Final webhook data is not a valid object:', typeof webhookData);
            return null;
        }

        // Check if we still have numeric keys (parsing still failed)
        const keys = Object.keys(webhookData);
        const hasNumericKeys = keys.length > 100 && keys.every(key => !isNaN(key));
        if (hasNumericKeys) {
            console.error('Final webhook data still has numeric keys - parsing failed');
            return null;
        }

        console.log('Processing webhook data structure:', {
            hasParams: !!webhookData.params,
            rootKeys: Object.keys(webhookData),
            paramsKeys: webhookData.params ? Object.keys(webhookData.params) : 'no params'
        });

        // Extract PayPlus data from params object
        let actualData = null;
        
        if (webhookData.params && typeof webhookData.params === 'object') {
            actualData = webhookData.params;
            console.log('Using webhook format with params object');
        } else {
            // Fallback: maybe it's a direct PayPlus webhook (old format)
            actualData = webhookData;
            console.log('Using direct webhook format (fallback)');
        }

        console.log('PayPlus fields check:', {
            terminal_uid: actualData.terminal_uid || 'missing',
            cashier_uid: actualData.cashier_uid || 'missing',
            customer_uid: actualData.customer_uid || 'missing',
            token_uid: actualData.token_uid || 'missing'
        });

        // Extract required credentials
        const credentials = {
            terminal_uid: actualData.terminal_uid || null,
            cashier_uid: actualData.cashier_uid || null,
            customer_uid: actualData.customer_uid || null,
            token_uid: actualData.token_uid || null,
            transaction_uid: actualData.transaction_uid || null,
            page_request_uid: actualData.page_request_uid || null
        };

        // Validate required fields
        const missingFields = [];
        if (!credentials.terminal_uid) missingFields.push('terminal_uid');
        if (!credentials.cashier_uid) missingFields.push('cashier_uid');

        if (missingFields.length > 0) {
            console.error('Missing required PayPlus credentials:', missingFields);
            console.error('Available fields in actualData:', Object.keys(actualData).slice(0, 20));
            return null;
        }

        console.log('Successfully extracted PayPlus credentials:', {
            terminal_uid: credentials.terminal_uid,
            cashier_uid: credentials.cashier_uid,
            customer_uid: credentials.customer_uid ? 'present' : 'missing',
            token_uid: credentials.token_uid ? 'present' : 'missing'
        });

        return credentials;

    } catch (error) {
        console.error('Error extracting PayPlus credentials:', error);
        return null;
    }
}

async function getPayPlusCredentialsFromToken(link_token) {
    try {
        const transaction = await FamilyPaymentTransaction.findOne({
            include: [{
                model: FamilyPaymentLink,
                where: { link_token: link_token }
            }],
            where: {
                status: 'success',
                payplus_response_data: {
                    [Op.ne]: null
                }
            },
            order: [['processed_at', 'DESC']],
            limit: 1
        });

        if (!transaction || !transaction.payplus_response_data) {
            console.warn(`No transaction found for link_token: ${link_token}`);
            return null;
        }

        console.log(`Found transaction for link_token: ${link_token}, extracting credentials...`);
        return extractPayPlusCredentials(transaction.payplus_response_data);
    } catch (error) {
        console.error('Error getting PayPlus credentials from token:', error);
        return null;
    }
}

module.exports = {
    extractPayPlusCredentials,
    getPayPlusCredentialsFromToken
};