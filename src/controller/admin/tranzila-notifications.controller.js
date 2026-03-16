const TranzilaNotification = require('../../models/TranzilaNotification');
const PaymentTransaction = require('../../models/PaymentTransaction');
const { Op } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');

// Tranzila error codes mapping
const TRANZILA_ERROR_CODES = {
  "shva": "Pending SHVA response.",
  "000": "Transaction approved.",
  "777": "פעולה הושלמה (קוד הצלחה לפעולות בהן לא נרשמת עסקה, כוללJ2 ו- J5)",
  "001": "Blocked confiscate card. Please check and enter the credit number again.",
  "002": "Stolen confiscate card. Please check and enter the credit number again.",
  "003": "Contact credit company to approve the transaction.",
  "004": "Refusal. Please contact the card owner to check the reason with his credit company.",
  "005": "Forged confiscate card.",
  "006": "Incorrect identity number or CVV.",
  "007": "Invalid cavv/ucaf.",
  "008": "Invalid avs.",
  "009": "Unsuccessful communication.",
  "010": "Partial confirmation",
  "011": "דחה עסקה : חוסר בנקודות/כוכבים/מיילים/הטבה אחרת",
  "012": "Unauthorized card for this terminal.",
  "013": "קוד יתרה שגוי",
  "014": "כרטיס לא משויך לרשת",
  "015": "Expired card. Please check the expiration date again.",
  "016": "Unauthorized currency.",
  "017": "Unauthorized credit type for this transaction.",
  "026": "Wrong ID number. Please check the ID number again.",
  "041": "ישנה חובת יציאה לשאילתא בגין תקרה בלבד לעסקה עם פרמטר J2",
  "042": "ישנה חובת יציאה לשאילתא לא רק בגין תקרה, לעסקה עם פרמטר J2",
  "051": "Missing vector 1 file.",
  "052": "Missing vector 4 file.",
  "053": "Missing vector 6 file.",
  "055": "Missing vector 11 file.",
  "056": "Missing vector 12 file.",
  "057": "Missing vector 15 file.",
  "058": "Missing vector 18 file.",
  "059": "Missing vector 31 file.",
  "060": "Missing vector 34 file.",
  "061": "Missing vector 41 file.",
  "062": "Missing vector 44 file.",
  "063": "Missing vector 64 file.",
  "064": "Missing vector 80 file.",
  "065": "Missing vector 81 file.",
  "066": "Missing vector 82 file.",
  "067": "Missing vector 83 file.",
  "068": "Missing vector 90 file.",
  "069": "Missing vector 91 file.",
  "070": "Missing vector 92 file.",
  "071": "Missing vector 93 file.",
  "073": "Missing PARAM_3_1 file.",
  "074": "Missing PARAM_3_2 file.",
  "075": "Missing PARAM_3_3 file.",
  "076": "Missing PARAM_3_4 file.",
  "077": "Missing PARAM_361 file.",
  "078": "Missing PARAM_363 file.",
  "079": "Missing PARAM_364 file.",
  "080": "Missing PARAM_61 file.",
  "081": "Missing PARAM_62 file.",
  "082": "Missing PARAM_63 file.",
  "083": "Missing CEIL_41 file.",
  "084": "Missing CEIL_42 file.",
  "085": "Missing CEIL_43 file.",
  "086": "Missing CEIL_44 file.",
  "087": "Missing DATA file.",
  "088": "Missing JENR file.",
  "089": "Missing Start file.",
  "997": "General failure.",
  "998": "Transactions file failure. Please contact Tranzila support."
};

/**
 * Get error message for Tranzila response code
 * @param {string} responseCode 
 * @returns {string}
 */
const getTranzilaErrorMessage = (responseCode) => {
  return TRANZILA_ERROR_CODES[responseCode] || `Unknown error code: ${responseCode}`;
};

/**
 * Get all Tranzila notifications with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTranzilaNotifications = async (req, res) => {
    try {
        const { 
            search, 
            status,
            response_code,
            date_from,
            date_to,
            page = 1, 
            limit = 10
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        const whereConditions = {};
        
        // Add search conditions if provided
        if (search) {
            whereConditions[Op.or] = [
                { 'data.email': { [Op.like]: `%${search}%` } },
                { 'data.contact': { [Op.like]: `%${search}%` } },
                { 'data.index': { [Op.like]: `%${search}%` } },
                { processing_notes: { [Op.like]: `%${search}%` } }
            ];
        }
        
        // Add status filter if provided
        if (status && status !== 'all') {
            whereConditions.status = status;
        }
        
        // Add response code filter if provided
        if (response_code && response_code !== 'all') {
            whereConditions['data.Response'] = response_code;
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
        
        // Find notifications
        const notifications = await TranzilaNotification.findAndCountAll({
            where: whereConditions,
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', 'DESC']]
        });
        
        // Format the response
        const formattedNotifications = notifications.rows.map(notification => {
            const responseCode = notification.data?.Response;
            return {
                id: notification.id,
                transaction_id: notification.data?.index || null,
                student_email: notification.data?.email || null,
                student_name: notification.data?.contact || null,
                amount: parseFloat(notification.data?.sum) || 0,
                currency: notification.data?.currency || 'ILS',
                response_code: responseCode,
                response_message: getTranzilaErrorMessage(responseCode),
                is_successful: responseCode === '000',
                status: notification.status,
                processed_at: notification.processed_at,
                processing_notes: notification.processing_notes,
                created_at: moment(notification.created_at).format('YYYY-MM-DD HH:mm:ss'),
                payment_method: notification.data?.payment_method || 'tranzila',
                card_last_digits: notification.data?.cardnum ? notification.data.cardnum.slice(-4) : null,
                is_recurring: notification.data?.recur === "1"
            };
        });
        
        return res.status(200).json({
            status: 'success',
            data: formattedNotifications,
            pagination: {
                total: notifications.count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(notifications.count / parseInt(limit))
            },
            message: 'Tranzila notifications retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching Tranzila notifications:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get Tranzila notification by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTranzilaNotificationById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const notification = await TranzilaNotification.findByPk(id);
        
        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Tranzila notification not found'
            });
        }
        
        // Try to find related payment transaction
        let relatedPayment = null;
        if (notification.data?.index) {
            relatedPayment = await PaymentTransaction.findOne({
                where: { transaction_id: notification.data.index },
                order: [['created_at', 'DESC']]
            });
        }
        
        const responseCode = notification.data?.Response;
        
        // Format the response
        const formattedNotification = {
            id: notification.id,
            transaction_id: notification.data?.index || null,
            student_email: notification.data?.email || null,
            student_name: notification.data?.contact || null,
            amount: parseFloat(notification.data?.sum) || 0,
            currency: notification.data?.currency || 'ILS',
            response_code: responseCode,
            response_message: getTranzilaErrorMessage(responseCode),
            is_successful: responseCode === '000',
            status: notification.status,
            processed_at: notification.processed_at,
            processing_notes: notification.processing_notes,
            created_at: moment(notification.created_at).format(),
            payment_method: notification.data?.payment_method || 'tranzila',
            card_last_digits: notification.data?.cardnum ? notification.data.cardnum.slice(-4) : null,
            is_recurring: notification.data?.recur === "1",
            raw_data: notification.data,
            related_payment: relatedPayment ? {
                id: relatedPayment.id,
                status: relatedPayment.status,
                amount: relatedPayment.amount,
                created_at: relatedPayment.created_at
            } : null
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedNotification
        });
        
    } catch (error) {
        console.error('Error fetching Tranzila notification details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get notification statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getNotificationStatistics = async (req, res) => {
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
            fromDate = moment().subtract(1, 'month').startOf('day');
        }
        
        // Get previous period for comparison
        const previousFromDate = moment(fromDate).subtract(moment.duration(toDate.diff(fromDate)));
        const previousToDate = moment(fromDate).subtract(1, 'day').endOf('day');
        
        const dateFilter = {
            created_at: {
                [Op.between]: [
                    fromDate.format('YYYY-MM-DD HH:mm:ss'),
                    toDate.format('YYYY-MM-DD HH:mm:ss')
                ]
            }
        };
        
        const previousDateFilter = {
            created_at: {
                [Op.between]: [
                    previousFromDate.format('YYYY-MM-DD HH:mm:ss'),
                    previousToDate.format('YYYY-MM-DD HH:mm:ss')
                ]
            }
        };
        
        // Total notifications
        const totalNotifications = await TranzilaNotification.count({ where: dateFilter });
        const previousTotalNotifications = await TranzilaNotification.count({ where: previousDateFilter });
        const notificationsChange = previousTotalNotifications > 0 
            ? ((totalNotifications - previousTotalNotifications) / previousTotalNotifications) * 100 
            : 100;
        
        // Successful notifications (response code 000)
        const successfulNotifications = await TranzilaNotification.count({
            where: {
                ...dateFilter,
                'data.Response': '000'
            }
        });
        
        const previousSuccessfulNotifications = await TranzilaNotification.count({
            where: {
                ...previousDateFilter,
                'data.Response': '000'
            }
        });
        
        // Calculate success rate
        const successRate = totalNotifications > 0 
            ? (successfulNotifications / totalNotifications) * 100 
            : 0;
        
        const previousSuccessRate = previousTotalNotifications > 0 
            ? (previousSuccessfulNotifications / previousTotalNotifications) * 100 
            : 0;
        
        const successRateChange = previousSuccessRate > 0 
            ? ((successRate - previousSuccessRate) / previousSuccessRate) * 100 
            : 0;
        
        // Failed notifications
        const failedNotifications = await TranzilaNotification.count({
            where: {
                ...dateFilter,
                'data.Response': { [Op.ne]: '000' }
            }
        });
        
        const previousFailedNotifications = await TranzilaNotification.count({
            where: {
                ...previousDateFilter,
                'data.Response': { [Op.ne]: '000' }
            }
        });
        
        const failedChange = previousFailedNotifications > 0 
            ? ((failedNotifications - previousFailedNotifications) / previousFailedNotifications) * 100 
            : 100;
        
        // Processing errors
        const processingErrors = await TranzilaNotification.count({
            where: {
                ...dateFilter,
                status: 'error'
            }
        });
        
        const previousProcessingErrors = await TranzilaNotification.count({
            where: {
                ...previousDateFilter,
                status: 'error'
            }
        });
        
        const errorsChange = previousProcessingErrors > 0 
            ? ((processingErrors - previousProcessingErrors) / previousProcessingErrors) * 100 
            : 100;
        
        // Most common error codes
        const errorCodes = await sequelize.query(`
            SELECT 
                JSON_EXTRACT(data, '$.Response') as response_code,
                COUNT(*) as count
            FROM tranzila_notifications 
            WHERE created_at BETWEEN ? AND ?
            AND JSON_EXTRACT(data, '$.Response') != '000'
            GROUP BY JSON_EXTRACT(data, '$.Response')
            ORDER BY count DESC
            LIMIT 5
        `, {
            replacements: [fromDate.format('YYYY-MM-DD HH:mm:ss'), toDate.format('YYYY-MM-DD HH:mm:ss')],
            type: sequelize.QueryTypes.SELECT
        });
        
        const formattedErrorCodes = errorCodes.map(error => ({
            code: error.response_code?.replace(/"/g, '') || 'Unknown',
            message: getTranzilaErrorMessage(error.response_code?.replace(/"/g, '')),
            count: error.count
        }));
        
        return res.status(200).json({
            status: 'success',
            data: {
                totalNotifications: {
                    value: totalNotifications,
                    change: notificationsChange.toFixed(2)
                },
                successRate: {
                    value: successRate.toFixed(2),
                    change: successRateChange.toFixed(2)
                },
                failedNotifications: {
                    value: failedNotifications,
                    change: failedChange.toFixed(2)
                },
                processingErrors: {
                    value: processingErrors,
                    change: errorsChange.toFixed(2)
                },
                commonErrorCodes: formattedErrorCodes
            }
        });
        
    } catch (error) {
        console.error('Error fetching notification statistics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get notification filters options
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getNotificationFilters = async (req, res) => {
    try {
        // Get notification statuses
        const statuses = [
            { id: 'received', name: 'Received' },
            { id: 'processed', name: 'Processed' },
            { id: 'failed', name: 'Failed' },
            { id: 'error', name: 'Error' }
        ];
        
        // Get most common response codes
        const responseCodes = await sequelize.query(`
            SELECT 
                JSON_EXTRACT(data, '$.Response') as response_code,
                COUNT(*) as count
            FROM tranzila_notifications 
            WHERE JSON_EXTRACT(data, '$.Response') IS NOT NULL
            GROUP BY JSON_EXTRACT(data, '$.Response')
            ORDER BY count DESC
            LIMIT 20
        `, {
            type: sequelize.QueryTypes.SELECT
        });
        
        const formattedResponseCodes = responseCodes.map(code => ({
            id: code.response_code?.replace(/"/g, '') || 'Unknown',
            name: `${code.response_code?.replace(/"/g, '')} - ${getTranzilaErrorMessage(code.response_code?.replace(/"/g, ''))}`
        }));
        
        return res.status(200).json({
            status: 'success',
            data: {
                statuses,
                responseCodes: formattedResponseCodes
            }
        });
        
    } catch (error) {
        console.error('Error fetching notification filters:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Retry processing a notification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const retryNotificationProcessing = async (req, res) => {
    try {
        const { id } = req.params;
        
        const notification = await TranzilaNotification.findByPk(id);
        
        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Tranzila notification not found'
            });
        }
        
        // Update notification to allow reprocessing
        await notification.update({
            status: 'received',
            processed_at: null,
            processing_notes: `Retry initiated by admin user ${req.user.id} at ${new Date().toISOString()}`
        });
        
        // Here you could trigger the reprocessing logic
        // For now, we'll just mark it as ready for retry
        
        return res.status(200).json({
            status: 'success',
            message: 'Notification marked for retry processing',
            data: {
                id: notification.id,
                status: 'received'
            }
        });
        
    } catch (error) {
        console.error('Error retrying notification processing:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update notification status manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateNotificationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        if (!status || !['received', 'processed', 'failed', 'error'].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid notification status'
            });
        }
        
        const notification = await TranzilaNotification.findByPk(id);
        
        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Tranzila notification not found'
            });
        }
        
        // Update notification status
        await notification.update({
            status,
            processing_notes: notes || `Status manually updated to ${status} by admin user ${req.user.id}`,
            processed_at: status === 'processed' ? new Date() : notification.processed_at
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Notification status updated successfully',
            data: {
                id: notification.id,
                status: notification.status
            }
        });
        
    } catch (error) {
        console.error('Error updating notification status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getTranzilaNotifications,
    getTranzilaNotificationById,
    getNotificationStatistics,
    getNotificationFilters,
    retryNotificationProcessing,
    updateNotificationStatus,
    getTranzilaErrorMessage
};