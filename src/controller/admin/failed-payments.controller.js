// controller/admin/failed-payments.controller.js
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const moment = require('moment-timezone');
const axios = require('axios');
const crypto = require('crypto');

// Models
const PastDuePayment = require('../../models/PastDuePayment');
const DunningSchedule = require('../../models/DunningSchedule');
const SubscriptionChargeSkip = require('../../models/SubscriptionChargeSkip');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PaymentTransaction = require('../../models/PaymentTransaction');
const RecurringPayment = require('../../models/RecurringPayment');

// Services
const { sendReminderNotification } = require('../../services/dunningNotificationService');
const { generateRecoveryPaymentLink, addCardToken, listCustomerTokens, updateRecurringPayment, getRecurringPaymentDetails } = require('../../services/paymentRecoveryService');
const { paymentLogger } = require('../../utils/paymentLogger');
const { encryptRecoveryUrl, decryptRecoveryUrl } = require('../../utils/encryptRecoveryUrl');
const { whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { cancelUserRecurringPayments } = require('./student.controller');

// Helper to generate an 8-character alphanumeric short ID for PastDuePayment
const generateShortId = () => crypto.randomBytes(4).toString('hex');
// Helpers for PayPlus recurring settings (mirror sales/payment.controller.js)
const getPayPlusRecurringType = (durationType) => {
    switch ((durationType || '').toLowerCase()) {
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

const getPayPlusRecurringRange = (durationType, customMonths) => {
    const months = parseInt(customMonths, 10);
    if (!isNaN(months) && months > 0) {
        return months;
    }
    switch ((durationType || '').toLowerCase()) {
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
};

// Extract custom months from subscription type string if present (e.g., "Custom_6", "Plan_3months")
const getCustomMonthsFromSubscriptionType = (subscriptionType = '') => {
    const match = (subscriptionType || '').match(/(\d+)\s*(month|months|m)?/i);
    if (match && match[1]) {
        const months = parseInt(match[1], 10);
        return !isNaN(months) && months > 0 ? months : null;
    }
    return null;
};

/**
 * Helper to extract recurring UID + PayPlus credentials from latest successful transaction.
 */
async function getPayplusRecurringDetails(studentId) {
    // First, try to get the active recurring payment from RecurringPayment table
    const activeRecurring = await RecurringPayment.findOne({
        where: {
            student_id: studentId,
            is_active: true
        },
        order: [['id', 'DESC']] // Most recent active recurring payment
    });

    if (activeRecurring && activeRecurring.payplus_transaction_uid) {
        // Parse webhook_data if available
        let webhookData = {};
        if (activeRecurring.webhook_data) {
            try {
                webhookData = typeof activeRecurring.webhook_data === 'string' 
                    ? JSON.parse(activeRecurring.webhook_data) 
                    : activeRecurring.webhook_data;
            } catch (e) {
                // If parsing fails, use empty object
            }
        }

        // Extract details from RecurringPayment record
        // Handle nested webhook data structures
        const originalWebhook = webhookData.original_webhook || {};
        const dataSection = webhookData.data || originalWebhook.data || webhookData.original_webhook || webhookData.transaction || webhookData || {};
        const txnSection = webhookData.transaction || originalWebhook.transaction || {};
        const cardInfo = webhookData.card_information || dataSection.card_information || originalWebhook.card_information || {};

        // Extract customer_uid from multiple possible locations
        const customerUid = activeRecurring.customer_uid || 
                           dataSection.customer_uid || 
                           originalWebhook.data?.customer_uid ||
                           txnSection.customer_uid || 
                           dataSection?.customer?.customer_uid ||
                           webhookData.customer_uid ||
                           null;

        // Extract terminal_uid from multiple possible locations
        const terminalUid = activeRecurring.terminal_uid || 
                           dataSection.terminal_uid || 
                           originalWebhook.data?.terminal_uid ||
                           txnSection.terminal_uid ||
                           webhookData.terminal_uid ||
                           null;

        return {
            recurring_uid: activeRecurring.payplus_transaction_uid,
            terminal_uid: terminalUid,
            customer_uid: customerUid,
            cashier_uid: activeRecurring.cashier_uid || dataSection.cashier_uid || originalWebhook.data?.cashier_uid || txnSection.cashier_uid,
            card_token: activeRecurring.card_token || webhookData.token_uid || cardInfo.token || dataSection?.token_uid || null,
            amount: activeRecurring.amount || null,
            currency: activeRecurring.currency || 'ILS',
            custom_months: activeRecurring.custom_months || parseInt(webhookData?.more_info_4, 10) || parseInt(dataSection?.more_info_4, 10) || 1
        };
    }

    // Fallback to PaymentTransaction if no active RecurringPayment found
    const txn = await PaymentTransaction.findOne({
        where: { student_id: studentId, is_recurring: true },
        order: [['id', 'DESC']] // Most recent recurring txn
    });
    if (!txn || !txn.response_data) return null;

    // response_data may be stored as a JSON string (sometimes double-encoded) – parse robustly
    const parseResponseData = (raw) => {
        let parsed = raw;
        for (let i = 0; i < 2; i++) { // handle double-encoded
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                } catch (err) {
                    break;
                }
            } else {
                break;
            }
        }
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    };

    const rd = parseResponseData(txn.response_data);

    // Normalize common sections for safer access
    const originalWebhook = rd.original_webhook || {};
    const dataSection = rd.data || originalWebhook.data || rd.original_webhook || rd.transaction || {};
    const txnSection = rd.transaction || originalWebhook.transaction || {};
    const cardInfo = rd.card_information || dataSection.card_information || originalWebhook.card_information || {};

    // Recurring UID from multiple possible paths
    let recurring_uid =
        rd.recurring_payment_uid ||
        rd.recurring_uid ||
        txnSection?.recurring_charge_information?.recurring_uid ||
        dataSection?.recurring_charge_information?.recurring_uid ||
        dataSection?.recurring_uid ||
        txnSection?.recurring_uid ||
        originalWebhook.data?.recurring_uid ||
        null;

    // Terminal UID from multiple possible paths
    const terminal_uid =
        rd.terminal_uid ||
        dataSection.terminal_uid ||
        originalWebhook.data?.terminal_uid ||
        txnSection.terminal_uid ||
        originalWebhook.terminal_uid;

    // Customer UID from multiple possible paths
    const customer_uid =
        rd.customer_uid ||
        dataSection.customer_uid ||
        originalWebhook.data?.customer_uid ||
        txnSection.customer_uid ||
        originalWebhook.customer_uid ||
        dataSection?.customer?.customer_uid ||
        rd.customer?.customer_uid;

    // Cashier UID
    const cashier_uid =
        rd.cashier_uid ||
        dataSection.cashier_uid ||
        txnSection.cashier_uid;

    // Card token
    const card_token =
        rd.token_uid ||
        cardInfo.token ||
        dataSection?.token_uid ||
        null;

    const amount = txn.amount;
    const currency = txn.currency;
    const custom_months =
        txn.custom_months ||
        parseInt(rd?.more_info_4, 10) ||
        parseInt(dataSection?.more_info_4, 10) ||
        parseInt(txnSection?.more_info_4, 10) ||
        dataSection.custom_months ||
        1; // default to 1 if nothing found

    return {
        recurring_uid: recurring_uid || null,
        terminal_uid,
        customer_uid,
        cashier_uid,
        card_token,
        amount,
        currency,
        custom_months
    };
}


/**
 * Get failed payments overview with key metrics
 */
const getFailedPaymentsOverview = async (req, res) => {
    try {
        const now = new Date();

        const { date_from, date_to } = req.query;

        const rangeFilterCreated = {};
        const rangeFilterResolved = {};
        const rangeFilterCanceled = {};

        if (date_from) {
            const from = new Date(date_from);
            if (!isNaN(from.getTime())) {
                rangeFilterCreated[Op.gte] = from;
                rangeFilterResolved[Op.gte] = from;
                rangeFilterCanceled[Op.gte] = from;
            }
        }
        if (date_to) {
            const to = new Date(date_to);
            if (!isNaN(to.getTime())) {
                to.setHours(23, 59, 59, 999);
                rangeFilterCreated[Op.lte] = to;
                rangeFilterResolved[Op.lte] = to;
                rangeFilterCanceled[Op.lte] = to;
            }
        }

        const pastDueCount = await PastDuePayment.count({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.gt]: now },
                ...(Object.keys(rangeFilterCreated).length ? { failed_at: rangeFilterCreated } : {})
            }
        });

        const pastDuePayments = await PastDuePayment.findAll({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.gt]: now },
                ...(Object.keys(rangeFilterCreated).length ? { failed_at: rangeFilterCreated } : {})
            },
            attributes: ['amount', 'currency']
        });

        const amountAtRisk = pastDuePayments.reduce((total, payment) => {
            const paymentAmount = parseFloat(payment.amount) || 0;
            const amountInILS = payment.currency === 'ILS' ? paymentAmount : paymentAmount * 3.7;
            return parseFloat(total) + amountInILS;
        }, 0);

        let createdRange = rangeFilterCreated;
        let resolvedRange = rangeFilterResolved;
        if (!date_from && !date_to) {
            const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
            createdRange = { [Op.gte]: thirtyDaysAgo };
            resolvedRange = { [Op.gte]: thirtyDaysAgo };
        }

        const totalFailed = await PastDuePayment.count({ where: { created_at: createdRange } });
        const totalResolved = await PastDuePayment.count({ where: { status: 'resolved', resolved_at: resolvedRange } });
        const recoveryRate = totalFailed > 0 ? ((totalResolved / totalFailed) * 100).toFixed(1) : 0;

        const collectionsUnpaid = await PastDuePayment.count({
            where: { status: 'canceled', ...(Object.keys(rangeFilterCanceled).length ? { canceled_at: rangeFilterCanceled } : {}) }
        });

        const collectionsPaid = await PastDuePayment.count({
            where: { status: 'resolved', ...(Object.keys(resolvedRange).length ? { resolved_at: resolvedRange } : {}) }
        });

        const sevenDaysFromNow = moment().add(7, 'days').toDate();
        const expiringSoonCount = await PastDuePayment.count({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.between]: [now, sevenDaysFromNow] }
            }
        });

        const activeRemindersCount = await DunningSchedule.count({
            where: { is_enabled: true, is_paused: false },
            include: [{
                model: PastDuePayment,
                as: 'PastDuePayment',
                where: { status: 'past_due' }
            }]
        });

        const formattedAmountAtRisk = parseFloat(amountAtRisk).toFixed(2);

        return res.status(200).json({
            status: 'success',
            data: {
                pastDue: { count: pastDueCount },
                amountAtRisk: { amount: formattedAmountAtRisk, currency: 'ILS' },
                recoveryRate: { rate: `${recoveryRate}%`, numerator: totalResolved, denominator: totalFailed },
                collectionsPaid: { count: collectionsPaid },
                collectionsUnpaid: { count: collectionsUnpaid },
                expiringSoon: { count: expiringSoonCount },
                activeReminders: { count: activeRemindersCount }
            },
            message: 'Failed payments overview retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting failed payments overview:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get failed payments list with filtering and pagination
 */
const getFailedPaymentsList = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status = 'past_due',
            grace_period_status,
            reminder_status,
            search,
            currency,
            amount_min,
            amount_max,
            date_from,
            date_to
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const whereConditions = {};
        
        if (status) {
            whereConditions.status = status;
        }

        if (currency) {
            whereConditions.currency = currency;
        }

        if (amount_min && !isNaN(amount_min)) {
            whereConditions.amount = { [Op.gte]: parseFloat(amount_min) };
        }

        if (amount_max && !isNaN(amount_max)) {
            whereConditions.amount = { 
                ...(whereConditions.amount || {}),
                [Op.lte]: parseFloat(amount_max) 
            };
        }

        if (date_from || date_to) {
            whereConditions.failed_at = {};
            if (date_from) {
                const fromDate = new Date(date_from);
                if (!isNaN(fromDate.getTime())) {
                    whereConditions.failed_at[Op.gte] = fromDate;
                }
            }
            if (date_to) {
                const toDate = new Date(date_to);
                if (!isNaN(toDate.getTime())) {
                    toDate.setHours(23, 59, 59, 999);
                    whereConditions.failed_at[Op.lte] = toDate;
                }
            }
        }

        const now = new Date();
        if (grace_period_status === 'expiring_soon') {
            const sevenDaysFromNow = moment().add(7, 'days').toDate();
            whereConditions.grace_period_expires_at = {
                [Op.between]: [now, sevenDaysFromNow]
            };
        } else if (grace_period_status === 'expired') {
            whereConditions.grace_period_expires_at = { [Op.lte]: now };
        } else if (grace_period_status === 'normal') {
            const sevenDaysFromNow = moment().add(7, 'days').toDate();
            whereConditions.grace_period_expires_at = { [Op.gt]: sevenDaysFromNow };
        }

        const userInclude = {
            model: User,
            as: 'User',
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone'],
            required: false
        };

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            userInclude.required = true;
            userInclude.where = {
                [Op.or]: [
                    { full_name: { [Op.like]: term } },
                    { email: { [Op.like]: term } },
                    { mobile: { [Op.like]: term } }
                ]
            };
        }

        const includeConditions = [
            userInclude,
            {
                model: UserSubscriptionDetails,
                as: 'Subscription',
                attributes: ['id', 'type', 'status', 'lesson_min', 'weekly_lesson'],
                required: false
            }
        ];

        if (reminder_status) {
            const dunningWhere = {};
            if (reminder_status === 'enabled') {
                dunningWhere.is_enabled = true;
                dunningWhere.is_paused = false;
            } else if (reminder_status === 'paused') {
                dunningWhere.is_paused = true;
            } else if (reminder_status === 'disabled') {
                dunningWhere.is_enabled = false;
            }

            includeConditions.push({
                model: DunningSchedule,
                as: 'DunningSchedule',
                where: dunningWhere,
                required: reminder_status !== undefined,
                attributes: [
                    'id', 'is_enabled', 'is_paused', 'paused_until', 'next_reminder_at',
                    'total_reminders_sent', 'last_reminder_sent_at', 'reminder_frequency'
                ]
            });
        } else {
            includeConditions.push({
                model: DunningSchedule,
                as: 'DunningSchedule',
                required: false,
                attributes: [
                    'id', 'is_enabled', 'is_paused', 'paused_until', 'next_reminder_at',
                    'total_reminders_sent', 'last_reminder_sent_at', 'reminder_frequency'
                ]
            });
        }

        const { count, rows: failedPayments } = await PastDuePayment.findAndCountAll({
            where: whereConditions,
            include: includeConditions,
            attributes: {
                include: [
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.is_present = 1 
                                    AND classes.status IN ('completed', 'ended')
                                    AND classes.is_regular_hide = 0
                            )
                        `),
                        'lifetime_completed_classes'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.status IN ('completed', 'ended', 'pending', 'scheduled')
                                    AND classes.is_regular_hide = 0
                            )
                        `),
                        'lifetime_total_classes'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(DISTINCT DATE_FORMAT(created_at, '%Y-%m'   ))
                                FROM user_subscription_details
                                WHERE user_subscription_details.user_id = PastDuePayment.user_id
                                    AND user_subscription_details.status = 'inactive' 
                                    AND user_subscription_details.inactive_after_renew = 0 
                                    AND user_subscription_details.cancelled_by_user_id IS NULL
                            )
                        `),
                        'months_active'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.status IN ('completed', 'ended')
                                    AND classes.is_regular_hide = 0
                                    AND DATE_FORMAT(classes.meeting_start, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
                            )
                        `),
                        'current_month_done'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.status IN ('pending', 'scheduled')
                                    AND classes.is_regular_hide = 0
                                    AND classes.meeting_start > NOW()
                                    AND DATE_FORMAT(classes.meeting_start, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
                            )
                        `),
                        'current_month_upcoming'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.is_present = 0
                                    AND classes.is_regular_hide = 0
                                    AND DATE_FORMAT(classes.meeting_start, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
                            )
                        `),
                        'current_month_missed'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT COUNT(*)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.is_present = 1
                                    AND classes.status IN ('completed', 'ended')
                                    AND DATE_FORMAT(classes.meeting_start, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
                            )
                        `),
                        'current_month_attended'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT MAX(classes.meeting_start)
                                FROM classes
                                WHERE classes.student_id = PastDuePayment.user_id
                                    AND classes.status IN ('completed', 'ended')
                            )
                        `),
                        'last_class_date'
                    ],
                    [
                        sequelize.literal(`
                            (
                                SELECT weekly_lesson
                                FROM user_subscription_details
                                WHERE user_subscription_details.user_id = PastDuePayment.user_id
                                    AND user_subscription_details.status = 'active'
                                ORDER BY user_subscription_details.created_at DESC
                                LIMIT 1
                            )
                        `),
                        'subscription_weekly_lesson'
                    ]
                ]
            },
            limit: parseInt(limit),
            offset: offset,
            order: [['failed_at', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const enhancedPayments = failedPayments.map(payment => {
            const paymentData = payment.toJSON();
            const daysRemaining = moment(payment.grace_period_expires_at).diff(moment(), 'days');
            const gracePeriodStatus = daysRemaining <= 0 ? 'expired' : 
                                    daysRemaining <= 7 ? 'expiring_soon' : 'normal';

            const lifetimeCompleted = parseInt(paymentData.lifetime_completed_classes) || 0;
            const lifetimeTotal = parseInt(paymentData.lifetime_total_classes) || 0;
            const lifetimeUsagePercent = lifetimeTotal > 0 
                ? Math.round((lifetimeCompleted / lifetimeTotal) * 100) 
                : 0;

            const lastClassDate = paymentData.last_class_date;
            const lastAttendance = lastClassDate 
                ? moment(lastClassDate).fromNow() 
                : 'Never';

            const classesDone = parseInt(paymentData.current_month_done) || 0;
            const classesUpcoming = parseInt(paymentData.current_month_upcoming) || 0;
            const classesMissed = parseInt(paymentData.current_month_missed) || 0;
            const classesAttended = parseInt(paymentData.current_month_attended) || 0;
            
            // Get total from subscription weekly_lesson (plan's monthly lesson count)
            const currentMonthTotal = parseInt(paymentData.subscription_weekly_lesson) || 0;
            
            const hasCurrentActivity = (classesDone + classesUpcoming + classesMissed) > 0;

            return {
                ...payment.toJSON(),
                days_remaining: Math.max(0, daysRemaining),
                grace_period_status: gracePeriodStatus,
                
                lifetime_usage: {
                    used: lifetimeCompleted,
                    total: lifetimeTotal,
                    percentage: lifetimeUsagePercent,
                    display: `${lifetimeCompleted}/${lifetimeTotal}`
                },
                
                months_active: parseInt(paymentData.months_active) || 0,
                
                current_month_activity: hasCurrentActivity ? {
                    has_activity: true,
                    done: classesDone,
                    upcoming: classesUpcoming,
                    missed: classesMissed,
                    attended: classesAttended,
                    total: currentMonthTotal,
                    attended_display: `Attended: ${classesAttended}/${currentMonthTotal}`,
                    attended_percentage: currentMonthTotal > 0 
                        ? Math.round((classesAttended / currentMonthTotal) * 100) 
                        : 0
                } : {
                    has_activity: false,
                    display: 'No activity',
                    done: 0,
                    upcoming: 0,
                    missed: 0,
                    attended: 0,
                    total: 0,
                    attended_display: 'Attended: 0/0',
                    attended_percentage: 0
                },
                
                last_attendance: {
                    date: lastClassDate,
                    formatted: lastAttendance
                },
                
                error_details: {
                    status_code: paymentData.failure_status_code || null,
                    message_description: paymentData.failure_message_description || null,
                    has_error_details: !!(paymentData.failure_status_code || paymentData.failure_message_description)
                },
                
                dunning_status: paymentData.DunningSchedule ? {
                    enabled: paymentData.DunningSchedule.is_enabled,
                    paused: paymentData.DunningSchedule.is_paused,
                    paused_until: paymentData.DunningSchedule.paused_until,
                    next_reminder: paymentData.DunningSchedule.next_reminder_at,
                    total_sent: paymentData.DunningSchedule.total_reminders_sent,
                    last_sent: paymentData.DunningSchedule.last_reminder_sent_at
                } : null
            };
        });

        return res.status(200).json({
            status: 'success',
            data: enhancedPayments,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / parseInt(limit))
            },
            message: 'Failed payments list retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting failed payments list:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
        });
    }
};
/**
 * Get collections list (grace period expired)
 */
const getCollectionsList = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            date_from,
            date_to,
            amount_range,
            status, // paid | unpaid | auto_cancelled | recovered | pending
            payment_source // whatsapp | email | manual
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const whereConditions = {};

        // Fix: Correctly handle amount_range filter
        if (amount_range) {
            if (amount_range === '0-100') {
                whereConditions.amount = { [Op.between]: [0, 100] };
            } else if (amount_range === '100-500') {
                whereConditions.amount = { [Op.between]: [100, 500] };
            } else if (amount_range === '500-1000') {
                whereConditions.amount = { [Op.between]: [500, 1000] };
            } else if (amount_range === '1000+') {
                whereConditions.amount = { [Op.gte]: 1000 };
            }
        }

        if (date_from || date_to) {
            const from = date_from ? new Date(date_from) : null;
            const to = date_to ? new Date(date_to) : null;
            whereConditions.grace_period_expires_at = {};
            if (from && !isNaN(from)) whereConditions.grace_period_expires_at[Op.gte] = from;
            if (to && !isNaN(to)) whereConditions.grace_period_expires_at[Op.lte] = new Date(to.setHours(23,59,59,999));
        }

        if (status === 'paid' || status === 'recovered') {
            whereConditions.status = 'resolved';
        } else if (status === 'auto_cancelled' || status === 'unpaid') {
            whereConditions.status = 'canceled';
        } else if (status === 'pending') {
            whereConditions.status = 'past_due';
        }

        // Build User include with search conditions if provided
        const userInclude = {
            model: User,
            as: 'User',
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
            required: false
        };

        // Add search conditions to User include if search is provided
        if (search && search.trim()) {
            userInclude.required = true;
            userInclude.where = {
                [Op.or]: [
                    { full_name: { [Op.like]: `%${search.trim()}%` } },
                    { email: { [Op.like]: `%${search.trim()}%` } },
                    { mobile: { [Op.like]: `%${search.trim()}%` } }
                ]
            };
        }

        const { count, rows: collections } = await PastDuePayment.findAndCountAll({
            where: whereConditions,
            include: [
                userInclude,
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status'],
                    required: false
                },
                {
                    model: DunningSchedule,
                    as: 'DunningSchedule',
                    required: false,
                    attributes: ['total_reminders_sent', 'last_reminder_sent_at']
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['failed_at', 'DESC']]
        });

        const enhancedCollections = collections
            .map(p => p.toJSON())
            .map(payment => {
                const daysSinceFailure = moment().diff(moment(payment.failed_at), 'days');
                const withinGrace = payment.resolved_at && moment(payment.resolved_at).isSameOrBefore(moment(payment.grace_period_expires_at));
                const paidAfter30 = payment.status === 'resolved' && !withinGrace;

                let derivedSource = null;
                if (payment.status === 'resolved') {
                    if (['free_gift','bit','bank_transfer','cash','other'].includes(payment.resolved_payment_method)) {
                        derivedSource = 'manual';
                    } else if (payment.whatsapp_messages_sent > 0) {
                        derivedSource = 'whatsapp';
                    } else {
                        derivedSource = 'email';
                    }
                }

                if (payment_source && payment.status === 'resolved') {
                    if (payment_source === 'manual' && derivedSource !== 'manual') return null;
                    if (payment_source === 'whatsapp' && derivedSource !== 'whatsapp') return null;
                    if (payment_source === 'email' && derivedSource !== 'email') return null;
                }

                let subscriptionAction = null;
                if (payment.status === 'canceled') {
                    subscriptionAction = { label: 'Cancelled by system', type: 'label', color: 'red' };
                } else if (payment.status === 'resolved') {
                    if (payment.Subscription && payment.Subscription.status === 'inactive' && payment.Subscription.is_cancel === 1) {
                        subscriptionAction = { label: 'Reactivate Subscription', type: 'action', action: 'reactivate' };
                    } else {
                        subscriptionAction = { label: 'Recovered Successfully', type: 'label', color: 'green' };
                    }
                }

                return {
                    id: payment.id,
                    student: {
                        id: payment.user_id,
                        name: payment.User?.full_name || '',
                        email: payment.User?.email || '',
                        phone: payment.User?.mobile || ''
                    },
                    amount_due: payment.amount,
                    currency: payment.currency,
                    days_since_failure: Math.max(0, daysSinceFailure),
                    payment_status: payment.status === 'resolved'
                        ? (paidAfter30 ? 'Paid after 30 days' : 'Paid (recovered within 30 days)')
                        : (payment.status === 'canceled' ? 'Unpaid – Auto Cancelled' : 'Still Pending'),
                    payment_source: derivedSource,
                    payment_date: payment.resolved_at || null,
                    grace_expires_at: payment.grace_period_expires_at,
                    subscription_action: subscriptionAction,
                    reminders: {
                        total_sent: payment.DunningSchedule?.total_reminders_sent || payment.total_reminders_sent || 0,
                        last_sent: payment.DunningSchedule?.last_reminder_sent_at || payment.last_reminder_sent_at || null
                    }
                };
            })
            .filter(Boolean);

        return res.status(200).json({
            status: 'success',
            data: enhancedCollections,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / parseInt(limit))
            },
            message: 'Collections list retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting collections list:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get collections insights
 */
const getCollectionsInsights = async (req, res) => {
    try {
        const { date_from, date_to } = req.query;
        const whereResolved = { status: 'resolved' };
        if (date_from || date_to) {
            whereResolved.resolved_at = {};
            if (date_from) whereResolved.resolved_at[Op.gte] = new Date(date_from);
            if (date_to) {
                const to = new Date(date_to);
                whereResolved.resolved_at[Op.lte] = new Date(to.setHours(23,59,59,999));
            }
        }

        const resolved = await PastDuePayment.findAll({
            where: whereResolved,
            attributes: ['failed_at', 'resolved_at', 'resolved_payment_method', 'whatsapp_messages_sent']
        });

        let totalDays = 0; let count = 0;
        const sourceCounts = { whatsapp: 0, email: 0, manual: 0 };
        for (const p of resolved) {
            if (p.failed_at && p.resolved_at) {
                totalDays += Math.max(0, moment(p.resolved_at).diff(moment(p.failed_at), 'days'));
                count += 1;
            }
            let src = 'email';
            if (['free_gift','bit','bank_transfer','cash','other'].includes(p.resolved_payment_method)) src = 'manual';
            else if ((p.whatsapp_messages_sent || 0) > 0) src = 'whatsapp';
            sourceCounts[src] += 1;
        }

        const avgDays = count > 0 ? parseFloat((totalDays / count).toFixed(1)) : 0;
        const total = sourceCounts.whatsapp + sourceCounts.email + sourceCounts.manual;
        const pct = (n) => total > 0 ? parseFloat(((n / total) * 100).toFixed(1)) : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                avg_time_to_recover_days: avgDays,
                top_payment_methods: {
                    whatsapp_pct: pct(sourceCounts.whatsapp),
                    email_pct: pct(sourceCounts.email),
                    manual_pct: pct(sourceCounts.manual)
                },
                counts: sourceCounts
            },
            message: 'Collections insights retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting collections insights:', error);
        return res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    }
};

/**
 * Get specific failed payment details
 */
const getFailedPaymentDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const failedPayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status', 'lesson_min', 'weekly_lesson', 'left_lessons', 'created_at']
                },
                {
                    model: DunningSchedule,
                    as: 'DunningSchedule',
                    required: false
                }
            ]
        });

        if (!failedPayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        // Get charge skips
        const chargeSkips = await SubscriptionChargeSkip.findAll({
            where: {
                user_id: failedPayment.user_id,
                is_active: true
            },
            include: [
                {
                    model: User,
                    as: 'CreatedByUser',
                    attributes: ['id', 'full_name']
                }
            ]
        });

        // Get related payment transactions
        const paymentTransactions = await PaymentTransaction.findAll({
            where: {
                student_id: failedPayment.user_id
            },
            order: [['created_at', 'DESC']],
            limit: 5
        });

        const daysRemaining = moment(failedPayment.grace_period_expires_at).diff(moment(), 'days');

        return res.status(200).json({
            status: 'success',
            data: {
                ...failedPayment.toJSON(),
                days_remaining: Math.max(0, daysRemaining),
                error_details: {
                    status_code: failedPayment.failure_status_code || null,
                    message_description: failedPayment.failure_message_description || null,
                    has_error_details: !!(failedPayment.failure_status_code || failedPayment.failure_message_description)
                },
                charge_skips: chargeSkips,
                recent_transactions: paymentTransactions
            },
            message: 'Failed payment details retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting failed payment details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get dunning schedule for a failed payment
 */
const getDunningSchedule = async (req, res) => {
    try {
        const { id } = req.params;

        const dunningSchedule = await DunningSchedule.findOne({
            where: { past_due_payment_id: id },
            include: [
                {
                    model: User,
                    as: 'PausedByUser',
                    attributes: ['id', 'full_name'],
                    required: false
                }
            ]
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Dunning schedule not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Dunning schedule retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting dunning schedule:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Pause dunning reminders
 */
const pauseDunningReminders = async (req, res) => {
    try {
        const { id } = req.params;
        const { pause_until, reason } = req.body;

        if (!pause_until) {
            return res.status(400).json({
                status: 'error',
                message: 'Pause until date is required'
            });
        }

        const pauseDate = new Date(pause_until);
        if (pauseDate <= new Date()) {
            return res.status(400).json({
                status: 'error',
                message: 'Pause until date must be in the future'
            });
        }

        const dunningSchedule = await DunningSchedule.findOne({
            where: { past_due_payment_id: id }
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Dunning schedule not found'
            });
        }

        await dunningSchedule.update({
            is_paused: true,
            paused_until: pauseDate,
            paused_by_user_id: req.user.id,
            paused_reason: reason || 'Paused by admin',
            next_reminder_at: null
        });

        // Log the action
        paymentLogger.logPaymentVerification({
            student_id: dunningSchedule.user_id,
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'dunning_paused_by_admin',
            verification_result: true,
            subscription_details: {
                dunning_schedule_id: dunningSchedule.id,
                paused_until: pauseDate,
                paused_by: req.user.full_name,
                reason: reason
            }
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Dunning reminders paused successfully'
        });

    } catch (error) {
        console.error('Error pausing dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Resume dunning reminders
 */
const resumeDunningReminders = async (req, res) => {
    try {
        const { id } = req.params;

        const dunningSchedule = await DunningSchedule.findOne({
            where: { past_due_payment_id: id },
            include: [
                {
                    model: PastDuePayment,
                    as: 'PastDuePayment',
                    include: [
                        {
                            model: User,
                            as: 'User',
                            attributes: ['timezone']
                        }
                    ]
                }
            ]
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Dunning schedule not found'
            });
        }

        // Calculate next reminder time
        const userTimezone = dunningSchedule.PastDuePayment?.User?.timezone || 'Asia/Jerusalem';
        const reminderTime = dunningSchedule.reminder_time || '10:00:00';
        const [hours, minutes] = reminderTime.split(':').map(Number);

        const nextReminderAt = moment().tz(userTimezone).add(1, 'day')
            .hour(hours).minute(minutes).second(0).toDate();

        await dunningSchedule.update({
            is_paused: false,
            paused_until: null,
            paused_by_user_id: null,
            paused_reason: null,
            next_reminder_at: nextReminderAt
        });

        // Log the action
        paymentLogger.logPaymentVerification({
            student_id: dunningSchedule.user_id,
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'dunning_resumed_by_admin',
            verification_result: true,
            subscription_details: {
                dunning_schedule_id: dunningSchedule.id,
                resumed_by: req.user.full_name,
                next_reminder_at: nextReminderAt
            }
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Dunning reminders resumed successfully'
        });

    } catch (error) {
        console.error('Error resuming dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Disable dunning reminders
 */
const disableDunningReminders = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const dunningSchedule = await DunningSchedule.findOne({
            where: { past_due_payment_id: id }
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Dunning schedule not found'
            });
        }

        await dunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null,
            paused_reason: reason || 'Disabled by admin'
        });

        // Log the action
        paymentLogger.logPaymentVerification({
            student_id: dunningSchedule.user_id,
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'dunning_disabled_by_admin',
            verification_result: true,
            subscription_details: {
                dunning_schedule_id: dunningSchedule.id,
                disabled_by: req.user.full_name,
                reason: reason
            }
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Dunning reminders disabled successfully'
        });

    } catch (error) {
        console.error('Error disabling dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send reminder now (manual trigger)
 */
const sendReminderNow = async (req, res) => {
    try {
        const { id } = req.params;

        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User'
                },
                {
                    model: DunningSchedule,
                    as: 'DunningSchedule'
                }
            ]
        });

        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot send reminder for resolved/canceled payment'
            });
        }

        const user = pastDuePayment.User;
        const dunningSchedule = pastDuePayment.DunningSchedule;
        const daysRemaining = moment(pastDuePayment.grace_period_expires_at).diff(moment(), 'days');

        // Send reminder notification
        const result = await sendReminderNotification({
            user,
            past_due_payment: pastDuePayment,
            dunning_schedule,
            payment_link: pastDuePayment.payment_link,
            days_remaining: Math.max(0, daysRemaining)
        });

        if (dunningSchedule) {
            await dunningSchedule.update({
                last_reminder_sent_at: new Date(),
                total_reminders_sent: dunningSchedule.total_reminders_sent + 1
            });
        }

        await pastDuePayment.update({
            last_reminder_sent_at: new Date(),
            total_reminders_sent: pastDuePayment.total_reminders_sent + 1
        });

        // Log the manual reminder
        paymentLogger.logPaymentVerification({
            student_id: user.id,
            student_name: user.full_name,
            subscription_id: null,
            verification_type: 'manual_reminder_sent_by_admin',
            verification_result: result.success,
            subscription_details: {
                past_due_payment_id: pastDuePayment.id,
                sent_by: req.user.full_name,
                email_sent: result.email_sent,
                whatsapp_sent: result.whatsapp_sent,
                days_remaining: Math.max(0, daysRemaining)
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                reminder_sent: result.success,
                email_sent: result.email_sent,
                whatsapp_sent: result.whatsapp_sent,
                total_reminders_sent: pastDuePayment.total_reminders_sent + 1
            },
            message: result.success ? 'Reminder sent successfully' : 'Failed to send reminder'
        });

    } catch (error) {
        console.error('Error sending reminder now:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a charge-skip and (if recurring exists) update PayPlus recurring start_date
 */
const setChargeSkip = async (req, res) => {
  let transaction;
  try {
    const { id } = req.params; // past due payment id
    const {
      skip_type,
      skip_months,
      skip_start_date,
      skip_end_date,
      custom_start_date,  // Frontend sends this for custom type
      custom_end_date,    // Frontend sends this for custom type
      reason,
      reason_category,
      lesson_policy,
      custom_lesson_amount,
      notes,
      notify_student
    } = req.body;

    // Basic validation
    if (!id || isNaN(id)) {
      return res.status(400).json({ status: 'error', message: 'Valid payment ID is required' });
    }
    if (!skip_type || (skip_type !== 'months' && skip_type !== 'custom')) {
      return res.status(400).json({ status: 'error', message: 'skip_type must be "months" or "custom"' });
    }
    if (skip_type === 'months' && (!skip_months || isNaN(skip_months) || skip_months <= 0)) {
      return res.status(400).json({ status: 'error', message: 'skip_months is required and must be > 0 for months skip' });
    }

    transaction = await sequelize.transaction();

    // Load the failed payment
    const pastDuePayment = await PastDuePayment.findByPk(id, {
      include: [
        { model: UserSubscriptionDetails, as: 'Subscription' }
      ],
      transaction
    });
    if (!pastDuePayment) {
      await transaction.rollback();
      return res.status(404).json({ status: 'error', message: 'Failed payment not found' });
    }

    // compute startDate/endDate based on skip_type
    let startDate, endDate;
    if (skip_type === 'months') {
      // skip_months from request -> start = today (or next day?) We'll use today as skip_start and +skip_months to end
      startDate = moment().format('YYYY-MM-DD');
      // add skip_months months to current date and keep same day-of-month
      endDate = moment(startDate).add(parseInt(skip_months, 10), 'months').format('YYYY-MM-DD');
    } else {
      // custom - use custom_start_date/custom_end_date if provided, otherwise fall back to skip_start_date/skip_end_date
      const rawStartDate = custom_start_date || skip_start_date;
      const rawEndDate = custom_end_date || skip_end_date;
      
      if (!rawStartDate || !rawEndDate) {
        await transaction.rollback();
        return res.status(400).json({ status: 'error', message: 'custom_start_date and custom_end_date are required for custom skip' });
      }
      startDate = moment(rawStartDate).format('YYYY-MM-DD');
      endDate = moment(rawEndDate).format('YYYY-MM-DD');
      if (!moment(startDate).isValid() || !moment(endDate).isValid() || moment(endDate).isSameOrBefore(startDate)) {
        await transaction.rollback();
        return res.status(400).json({ status: 'error', message: 'Invalid custom dates: ensure end date is after start date' });
      }
    }

    // PayPlus new start date is first charge AFTER skip_end_date
    const payplusNewStartDate = moment(endDate).add(1, 'day').format('YYYY-MM-DD');

    // Get PayPlus recurring details from your helper (terminal_uid, customer_uid, card_token, recurring_uid, etc)
    const payplus = await getPayplusRecurringDetails(pastDuePayment.user_id);

    // Default values for amount/currency
    const amount = payplus?.amount || pastDuePayment.amount || 0;
    const currency = payplus?.currency || pastDuePayment.currency || 'ILS';

    // Determine subscription type and recurring parameters dynamically
    const subscription = pastDuePayment.Subscription;
    const subscriptionType = subscription?.type || 'monthly'; // Default to monthly
    
    // Extract custom months from subscription type (e.g., "Custom_6", "Plan_3months")
    const customMonthsFromType = getCustomMonthsFromSubscriptionType(subscriptionType);
    const finalCustomMonths = customMonthsFromType || payplus?.custom_months || 1;
    
    // Get PayPlus recurring type and range dynamically
    const recurringType = getPayPlusRecurringType(subscriptionType);
    const recurringRange = getPayPlusRecurringRange(subscriptionType, finalCustomMonths);
    
    // Log subscription details for debugging
    console.log('Subscription Details:', {
      subscriptionType,
      customMonthsFromType,
      finalCustomMonths,
      recurringType,
      recurringRange,
      payplusCustomMonths: payplus?.custom_months
    });
    
    // Determine description based on subscription type
    let description = 'Subscription';
    if (subscriptionType.toLowerCase().includes('monthly')) {
      description = 'Monthly subscription';
    } else if (subscriptionType.toLowerCase().includes('yearly')) {
      description = 'Yearly subscription';
    } else if (subscriptionType.toLowerCase().includes('quarterly')) {
      description = 'Quarterly subscription';
    } else if (customMonthsFromType) {
      description = `${customMonthsFromType} month subscription`;
    }

    // If PayPlus recurring UID exists, call the Update endpoint
    let payplusResult = null;
    if (payplus && payplus.recurring_uid) {
      try {
        const updateBody = {
          terminal_uid: payplus.terminal_uid,
          customer_uid: payplus.customer_uid,
          card_token: payplus.card_token,
          cashier_uid: payplus.cashier_uid,
          currency_code: currency,
          instant_first_payment: false,
          recurring_type: recurringType,
          recurring_range: recurringRange,
          number_of_charges: 0,
          start_date: payplusNewStartDate,
          items: [
            {
              description: description,
              price: Number(amount),
              quantity: 1
            }
          ],
          // IMPORTANT: PayPlus API rejected earlier requests until we added 'valid: true'
          // Postman success used "valid": true — include it.
          valid: true,
          extra_info: `Admin skip by ${req.user?.full_name || req.user?.id} from ${startDate} to ${endDate}`
        };
        console.log('PayPlus Update Request Body:', updateBody);

        const payplusBaseUrl = (process.env.PAYPLUS_BASE_URL || 'https://restapi.payplus.co.il/api/v1.0').replace(/\/+$/, '');
        const headers = {
          'Content-Type': 'application/json',
          'api-key': process.env.PAYPLUS_API_KEY,
          'secret-key': process.env.PAYPLUS_SECRET_KEY
        };

        const apiResp = await axios.post(`${payplusBaseUrl}/RecurringPayments/Update/${payplus.recurring_uid}`, updateBody, { headers, timeout: 15000 });

        // PayPlus wraps result under `results` and `data` (your Postman success showed results.status == 'success')
        payplusResult = apiResp.data || null;
      } catch (apiErr) {
        // log and continue — we still create the local skip record (but return PayPlus error details)
        console.error('PayPlus update error:', apiErr.response?.data || apiErr.message || apiErr);
        payplusResult = { error: apiErr.response?.data || apiErr.message || 'PayPlus Update failed' };
      }
    } else {
      console.warn(`No PayPlus recurring UID found for user ${pastDuePayment.user_id}. Skipping PayPlus call.`);
    }

    // Calculate lessonAmountDuringSkip if requested
    let lessonAmountDuringSkip = null;
    if (lesson_policy === 'continue_lessons') {
      lessonAmountDuringSkip = custom_lesson_amount || (pastDuePayment.Subscription?.weekly_lesson) || 0;
    }

    // Save the charge skip record — ensure created_by_user_id exists to avoid notNull violation
    const adminUserId = req.user?.id || 1;
    const chargeSkip = await SubscriptionChargeSkip.create({
      user_id: pastDuePayment.user_id,
      subscription_id: pastDuePayment.subscription_id,
      skip_type,
      skip_months: skip_type === 'months' ? skip_months : null,
      skip_start_date: startDate,
      skip_end_date: endDate,
      custom_start_date: skip_type === 'custom' ? startDate : null,
      custom_end_date: skip_type === 'custom' ? endDate : null,
      reason: reason || null,
      reason_category: reason_category || null,
      lesson_policy: lesson_policy || null,
      lesson_amount_during_skip: lessonAmountDuringSkip,
      admin_notes: notes || null,
      notify_student: !!notify_student,
      created_by_user_id: adminUserId,
      is_active: true
    }, { transaction });

    await transaction.commit();

    // Return success with PayPlus result (if any)
    return res.status(201).json({
      status: 'success',
      message: 'Charge skip created and PayPlus updated (if recurring available).',
      data: {
        chargeSkip,
        payplus_update_start_date: payplusNewStartDate,
        payplus_recurring_uid: payplus?.recurring_uid || null,
        payplus_result: payplusResult,
        subscription_details: {
          subscription_type: subscriptionType,
          recurring_type: recurringType,
          recurring_range: recurringRange,
          custom_months: finalCustomMonths,
          description: description
        }
      }
    });

  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Error in setChargeSkip:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: err.message
    });
  }
};

/**
 * Get charge skips for a user
 */
const getChargeSkips = async (req, res) => {
    try {
        const { id } = req.params;

        const pastDuePayment = await PastDuePayment.findByPk(id);
        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        const chargeSkips = await SubscriptionChargeSkip.findAll({
            where: { user_id: pastDuePayment.user_id },
            include: [
                {
                    model: User,
                    as: 'CreatedByUser',
                    attributes: ['id', 'full_name']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            data: chargeSkips,
            message: 'Charge skips retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting charge skips:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Remove charge skip
 */
const removeChargeSkip = async (req, res) => {
    try {
        const { skipId } = req.params;

        const chargeSkip = await SubscriptionChargeSkip.findByPk(skipId);
        if (!chargeSkip) {
            return res.status(404).json({
                status: 'error',
                message: 'Charge skip not found'
            });
        }

        await chargeSkip.update({ is_active: false });

        // Log the charge skip removal
        paymentLogger.logPaymentVerification({
            student_id: chargeSkip.user_id,
            student_name: 'unknown',
            subscription_id: chargeSkip.subscription_id,
            verification_type: 'charge_skip_removed_by_admin',
            verification_result: true,
            subscription_details: {
                charge_skip_id: chargeSkip.id,
                removed_by: req.user.full_name
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Charge skip removed successfully'
        });

    } catch (error) {
        console.error('Error removing charge skip:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const markAsPaidManually = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { 
            notes, 
            external_reference, 
            payment_reference,
            // New fields for enhanced functionality
            payment_method,
            transaction_reference,
            send_confirmation = false 
        } = req.body;

        // Build final notes with payment method details if provided
        let finalNotes = notes || '';
        
        if (payment_method) {
            const paymentMethodLabels = {
                'free_gift': 'Free (Gift)',
                'bit': 'Bit',
                'bank_transfer': 'Bank Transfer',
                'cash': 'Cash',
                'other': 'Other'
            };
            
            finalNotes = `Payment Method: ${paymentMethodLabels[payment_method]}`;
            
            if (transaction_reference) {
                finalNotes += `\nTransaction Reference: ${transaction_reference}`;
            }
            
            if (notes) {
                finalNotes += `\nAdditional Notes: ${notes}`;
            }
        }

        if (!finalNotes || finalNotes.trim().length < 10) {
            return res.status(400).json({
                status: 'error',
                message: 'Notes are required and must be at least 10 characters long'
            });
        }

        transaction = await sequelize.transaction();

        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment is not in past due status'
            });
        }

        // Build reference ID
        const referenceId = transaction_reference || external_reference || payment_reference || `manual_${Date.now()}`;

        // Mark payment as resolved
        await pastDuePayment.update({
            status: 'resolved',
            resolved_at: new Date(),
            resolved_transaction_id: referenceId,
            resolved_payment_method: payment_method, // New field
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Marked as paid manually by ${req.user.full_name}.\n${finalNotes}`
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
            where: { past_due_payment_id: id },
            transaction
        });

        await transaction.commit();

        // Log the manual resolution
        paymentLogger.logPaymentVerification({
            student_id: pastDuePayment.user_id,
            student_name: pastDuePayment.User?.full_name || 'unknown',
            subscription_id: pastDuePayment.subscription_id,
            verification_type: 'manual_payment_resolution_by_admin',
            verification_result: true,
            subscription_details: {
                past_due_payment_id: pastDuePayment.id,
                resolved_by: req.user.full_name,
                payment_method: payment_method,
                external_reference: referenceId,
                notes: finalNotes,
                subscription_restored: !!pastDuePayment.Subscription,
                send_confirmation: send_confirmation
            }
        });

        return res.status(200).json({
            status: 'success',
            data: pastDuePayment,
            message: 'Payment marked as paid successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error marking payment as paid:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Cancel subscription immediately
 */
const cancelImmediately = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { 
            reason, 
            // New fields for enhanced functionality
            cancellation_reason_category,
            cancellation_reason_other,
            admin_notes
        } = req.body;

        // Build final reason
        let finalReason = reason;
        
        if (cancellation_reason_category) {
            const reasonCategories = {
                'student_decided_to_stop': 'Student Decided to Stop',
                'teacher_not_suitable': 'Teacher Not Suitable',
                'financial_issue': 'Financial Issue',
                'technical_issue': 'Technical Issue',
                'moved_to_competitor': 'Moved to Competitor',
                'scheduling_problem': 'Scheduling Problem',
                'behavioral_policy_issue': 'Behavioral / Policy Issue',
                'other': cancellation_reason_other || 'Other reason'
            };
            
            finalReason = reasonCategories[cancellation_reason_category] || reason;
        }

        if (!finalReason || finalReason.trim().length < 10) {
            return res.status(400).json({
                status: 'error',
                message: 'Reason is required and must be at least 10 characters long'
            });
        }

        transaction = await sequelize.transaction();

        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        // Cancel subscription using existing fields
        if (pastDuePayment.Subscription) {
            await pastDuePayment.Subscription.update({
                status: 'inactive',
                is_cancel: 1,
                cancellation_date: new Date(),
                cancellation_reason_category: cancellation_reason_category || 'payment_issues',
                cancellation_reason: finalReason.trim(),
                cancelled_by_user_id: req.user.id, // Using existing field for admin cancellation
                notes: admin_notes ? `Admin Notes: ${admin_notes}` : null
            }, { transaction });
        }

        // Update user subscription info
        await User.update({
            subscription_id: null,
            subscription_type: null
        }, {
            where: { id: pastDuePayment.user_id },
            transaction
        });

        // Cancel PayPlus recurring payments
        try {
            const recurringPaymentResult = await cancelUserRecurringPayments(
                pastDuePayment.user_id,
                `Subscription canceled immediately from failed payment. Reason: ${finalReason.trim()}`,
                req.user?.id || null,
                transaction
            );
            console.log(`ayPlus recurring payment cancellation result for user ${pastDuePayment.user_id}:`, recurringPaymentResult);
        } catch (recurringError) {
            console.error(`❌ Error canceling PayPlus recurring payments for user ${pastDuePayment.user_id}:`, recurringError);
            // Don't fail the entire operation if PayPlus cancellation fails
            // The subscription will still be canceled locally
        }

        // Mark payment as canceled with new fields
        await pastDuePayment.update({
            status: 'canceled',
            canceled_at: new Date(),
            cancellation_reason_category: cancellation_reason_category, // New field
            cancellation_reason: finalReason.trim(), // New field
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Subscription canceled immediately by ${req.user.full_name}. Reason: ${finalReason.trim()}${admin_notes ? `\nAdmin Notes: ${admin_notes}` : ''}`
        }, { transaction });

        // Disable dunning schedule
        await DunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null
        }, {
            where: { past_due_payment_id: id },
            transaction
        });

        await transaction.commit();

        // Log the cancellation
        paymentLogger.logSubscriptionChange({
            user_id: pastDuePayment.user_id,
            subscription_id: pastDuePayment.subscription_id,
            change_type: 'canceled',
            previous_status: 'past_due',
            new_status: 'canceled',
            triggered_by: 'admin_immediate_cancellation',
            additional_details: {
                past_due_payment_id: pastDuePayment.id,
                canceled_by: req.user.full_name,
                cancellation_reason_category: cancellation_reason_category,
                reason: finalReason.trim(),
                admin_notes: admin_notes,
                immediate_cancellation: true
            }
        });

        return res.status(200).json({
            status: 'success',
            data: pastDuePayment,
            message: 'Subscription canceled immediately'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error canceling subscription immediately:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get recovery payment link
 */
const getRecoveryLink = async (req, res) => {
    try {
        const { id } = req.params;

        const pastDuePayment = await PastDuePayment.findByPk(id);
        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        if (!pastDuePayment.payment_link) {
            return res.status(404).json({
                status: 'error',
                message: 'No recovery link available for this payment'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                payment_link: pastDuePayment.payment_link,
                page_request_uid: pastDuePayment.payplus_page_request_uid
            },
            message: 'Recovery link retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting recovery link:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Export failed payments data
 */
const exportFailedPayments = async (req, res) => {
    try {
        const {
            status = 'past_due',
            date_from,
            date_to,
            payment_ids  // NEW: Support for exporting selected payments only
        } = req.query;

        const whereConditions = { status };

        // NEW: If payment_ids is provided, filter by those IDs
        if (payment_ids) {
            // payment_ids can be either a string "1,2,3" or an array [1,2,3]
            const idsArray = Array.isArray(payment_ids) 
                ? payment_ids 
                : payment_ids.split(',').map(id => parseInt(id.trim()));
            
            whereConditions.id = {
                [Op.in]: idsArray
            };
            
            console.log(`[EXPORT] Exporting selected payments: ${idsArray.join(', ')}`);
        }

        if (date_from || date_to) {
            whereConditions.failed_at = {};
            if (date_from) {
                whereConditions.failed_at[Op.gte] = new Date(date_from);
            }
            if (date_to) {
                whereConditions.failed_at[Op.lte] = new Date(date_to);
            }
        }

        const failedPayments = await PastDuePayment.findAll({
            where: whereConditions,
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['full_name', 'email', 'mobile', 'country_code']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['type', 'status']
                },
                {
                    model: DunningSchedule,
                    as: 'DunningSchedule',
                    attributes: ['total_reminders_sent', 'last_reminder_sent_at'],
                    required: false
                }
            ],
            order: [['failed_at', 'DESC']]
        });

        if (!failedPayments || failedPayments.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No payments found to export'
            });
        }

        console.log(`[EXPORT] Exporting ${failedPayments.length} payments`);

        // Convert to CSV format
        const csvData = failedPayments.map(payment => {
            const daysRemaining = moment(payment.grace_period_expires_at).diff(moment(), 'days');
            return {
                'Payment ID': payment.id,
                'Student Name': payment.User?.full_name || '',
                'Email': payment.User?.email || '',
                'Mobile': payment.User?.mobile ? `${payment.User.country_code || ''}${payment.User.mobile}` : '',
                'Amount': payment.amount,
                'Currency': payment.currency,
                'Failed Date': moment(payment.failed_at).format('YYYY-MM-DD HH:mm:ss'),
                'Grace Period Expires': moment(payment.grace_period_expires_at).format('YYYY-MM-DD HH:mm:ss'),
                'Days Remaining': Math.max(0, daysRemaining),
                'Status': payment.status,
                'Reminders Sent': payment.total_reminders_sent || 0,
                'WhatsApp Sent': payment.whatsapp_messages_sent || 0,  // NEW: Include WhatsApp count
                'Last Reminder': payment.last_reminder_sent_at ? moment(payment.last_reminder_sent_at).format('YYYY-MM-DD HH:mm:ss') : '',
                'Subscription Type': payment.Subscription?.type || '',
                'Subscription Status': payment.Subscription?.status || ''
            };
        });

        // Convert to CSV string
        const headers = Object.keys(csvData[0] || {});
        const csvString = [
            headers.join(','),
            ...csvData.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
        ].join('\n');

        const filename = payment_ids 
            ? `failed-payments-selected-${moment().format('YYYY-MM-DD')}.csv`
            : `failed-payments-${moment().format('YYYY-MM-DD')}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvString);

    } catch (error) {
        console.error('Error exporting failed payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get dunning statistics
 */
const getDunningStats = async (req, res) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

        // Total reminders sent in last 30 days
        const totalRemindersSent = await DunningSchedule.sum('total_reminders_sent', {
            where: {
                updated_at: { [Op.gte]: thirtyDaysAgo }
            }
        });

        // Active reminder schedules
        const activeReminders = await DunningSchedule.count({
            where: {
                is_enabled: true,
                is_paused: false
            }
        });

        // Paused reminders
        const pausedReminders = await DunningSchedule.count({
            where: {
                is_paused: true
            }
        });

        // Average reminders per recovery
        const recoveredPayments = await PastDuePayment.findAll({
            where: {
                status: 'resolved',
                resolved_at: { [Op.gte]: thirtyDaysAgo }
            },
            attributes: ['total_reminders_sent']
        });

        const avgRemindersPerRecovery = recoveredPayments.length > 0 
            ? (recoveredPayments.reduce((sum, p) => sum + p.total_reminders_sent, 0) / recoveredPayments.length).toFixed(1)
            : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                total_reminders_sent: totalRemindersSent || 0,
                active_reminders: activeReminders,
                paused_reminders: pausedReminders,
                avg_reminders_per_recovery: avgRemindersPerRecovery
            },
            message: 'Dunning statistics retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting dunning stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get recovery rates
 */
const getRecoveryRates = async (req, res) => {
    try {
        const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
        const sixtyDaysAgo = moment().subtract(60, 'days').toDate();

        // Current period (last 30 days)
        const currentPeriodFailed = await PastDuePayment.count({
            where: {
                created_at: { [Op.gte]: thirtyDaysAgo }
            }
        });

        const currentPeriodRecovered = await PastDuePayment.count({
            where: {
                status: 'resolved',
                resolved_at: { [Op.gte]: thirtyDaysAgo }
            }
        });

        // Previous period (30-60 days ago)
        const previousPeriodFailed = await PastDuePayment.count({
            where: {
                created_at: { 
                    [Op.between]: [sixtyDaysAgo, thirtyDaysAgo]
                }
            }
        });

        const previousPeriodRecovered = await PastDuePayment.count({
            where: {
                status: 'resolved',
                resolved_at: { 
                    [Op.between]: [sixtyDaysAgo, thirtyDaysAgo]
                }
            }
        });

        const currentRecoveryRate = currentPeriodFailed > 0 
            ? ((currentPeriodRecovered / currentPeriodFailed) * 100).toFixed(1)
            : 0;

        const previousRecoveryRate = previousPeriodFailed > 0 
            ? ((previousPeriodRecovered / previousPeriodFailed) * 100).toFixed(1)
            : 0;

        const recoveryRateChange = previousRecoveryRate > 0 
            ? (((currentRecoveryRate - previousRecoveryRate) / previousRecoveryRate) * 100).toFixed(1)
            : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                current_recovery_rate: `${currentRecoveryRate}%`,
                previous_recovery_rate: `${previousRecoveryRate}%`,
                recovery_rate_change: `${recoveryRateChange}%`,
                current_period: {
                    failed: currentPeriodFailed,
                    recovered: currentPeriodRecovered
                },
                previous_period: {
                    failed: previousPeriodFailed,
                    recovered: previousPeriodRecovered
                }
            },
            message: 'Recovery rates retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting recovery rates:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get global dunning settings (placeholder for future implementation)
 */
const getGlobalDunningSettings = async (req, res) => {
    try {
        // This would typically come from a settings table
        const defaultSettings = {
            grace_period_days: 30,
            reminder_frequency: 'daily',
            reminder_time: '10:00',
            default_timezone: 'Asia/Jerusalem',
            max_reminders: null,
            email_templates: {
                immediate: 'payment_failed_immediate',
                reminder: 'payment_failed_reminder',
                final: 'subscription_canceled_unpaid'
            },
            whatsapp_templates: {
                immediate: 'payment_failed_immediate',
                reminder: 'payment_failed_reminder',
                final: 'subscription_canceled_unpaid'
            }
        };

        return res.status(200).json({
            status: 'success',
            data: defaultSettings,
            message: 'Global dunning settings retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting global dunning settings:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update global dunning settings (placeholder for future implementation)
 */
const updateGlobalDunningSettings = async (req, res) => {
    try {
        const settings = req.body;

        // This would typically update a settings table
        // For now, just return success
        
        return res.status(200).json({
            status: 'success',
            data: settings,
            message: 'Global dunning settings updated successfully'
        });

    } catch (error) {
        console.error('Error updating global dunning settings:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const generateNewRecoveryLink = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;

        // Validate payment ID
        if (!id || isNaN(id)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid payment ID is required'
            });
        }

        transaction = await sequelize.transaction();

        // Get the failed payment with related data
        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language', 'timezone']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status', 'lesson_min', 'weekly_lesson', 'plan_id', 'created_at']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        // Check if payment is still in past_due status
        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot generate recovery link for resolved or canceled payment'
            });
        }

        // FIX: Validate that we have a valid subscription
        if (!pastDuePayment.Subscription) {
            console.warn(`No subscription found for past due payment ${id}, attempting to find most recent subscription`);
            
            // Try to find the most recent subscription for this user
            const recentSubscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: pastDuePayment.user_id,
                    [Op.or]: [
                        { status: 'active' },
                        { status: 'past_due' },
                        { status: 'inactive' }
                    ]
                },
                order: [['created_at', 'DESC']],
                transaction
            });

            if (!recentSubscription) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'No subscription found for this user. Cannot generate recovery link without subscription details.'
                });
            }

            // Use the found subscription
            pastDuePayment.Subscription = recentSubscription;
            
            console.log(`Found recent subscription ${recentSubscription.id} for user ${pastDuePayment.user_id}`);
        }

        // Generate card update page link using short_id instead of long encrypted token.
        // This is the new approach: user updates card, then recurring payment is updated automatically.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        let shortId = pastDuePayment.short_id;
        if (!shortId) {
            shortId = generateShortId();
            await pastDuePayment.update({
                short_id: shortId
            }, { transaction });
        }

        const cardUpdatePageUrl = `${frontendUrl}/payment/recovery/${shortId}`;

        // Update the past due payment with card update page link
        await pastDuePayment.update({
            payment_link: cardUpdatePageUrl,
            payplus_page_request_uid: null, // No longer using PayPlus payment pages
            updated_at: new Date()
        }, { transaction });

        // Log the recovery link generation with enhanced details
        paymentLogger.logPaymentVerification({
            student_id: pastDuePayment.user_id,
            student_name: pastDuePayment.User?.full_name || 'unknown',
            subscription_id: pastDuePayment.subscription_id,
            verification_type: 'card_update_link_generated_by_admin',
            verification_result: true,
            subscription_details: {
                past_due_payment_id: pastDuePayment.id,
                short_id: shortId,
                card_update_page_url: cardUpdatePageUrl,
                generated_by: req.user?.full_name || 'admin',
                admin_user_id: req.user?.id,
                previous_link_replaced: !!pastDuePayment.payment_link,
                subscription_used: {
                    subscription_id: pastDuePayment.Subscription.id,
                    subscription_type: pastDuePayment.Subscription.type,
                    lesson_minutes: pastDuePayment.Subscription.lesson_min,
                    lessons_per_month: pastDuePayment.Subscription.weekly_lesson,
                    plan_id: pastDuePayment.Subscription.plan_id
                },
                new_approach: 'card_update_page_instead_of_payplus_link'
            }
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                payment_url: cardUpdatePageUrl,
                page_request_uid: null,
                expires_at: null, // Card update page doesn't expire
                qr_code_image: null,
                generation_details: {
                    past_due_payment_id: pastDuePayment.id,
                    user_id: pastDuePayment.user_id,
                    subscription_id: pastDuePayment.Subscription.id,
                    original_subscription_type: pastDuePayment.Subscription.type,
                    amount: pastDuePayment.amount,
                    currency: pastDuePayment.currency,
                    generated_at: new Date().toISOString(),
                    generated_by: req.user?.full_name || 'admin',
                    link_type: 'card_update_page'
                }
            },
            message: 'Card update page link generated successfully. User will update card and recurring payment will be charged automatically.'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error generating new recovery link:', error);
        
        // Log the error
        paymentLogger.logPaymentVerification({
            student_id: 'unknown',
            student_name: 'unknown',
            subscription_id: null,
            verification_type: 'recovery_link_generation_error_enhanced',
            verification_result: false,
            error_details: {
                error_type: 'recovery_link_generation_exception',
                error_message: error.message,
                error_stack: error.stack,
                payment_id: req.params.id,
                admin_user_id: req.user?.id,
                admin_user_name: req.user?.full_name,
                request_timestamp: new Date().toISOString()
            }
        });

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while generating recovery link',
            details: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
            error_id: `recovery_${Date.now()}` // For tracking
        });
    }
};

/**
 * Send WhatsApp message with recovery link - Simplified version (name, link, amount only)
 */
const sendWhatsAppRecoveryLink = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { custom_message } = req.body; // Optional custom message

        transaction = await sequelize.transaction();

        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot send WhatsApp for resolved/canceled payment'
            });
        }

        const user = pastDuePayment.User;

        if (!user.mobile || user.mobile.trim() === '') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No mobile number available for this user'
            });
        }

        if (!pastDuePayment.payment_link) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No recovery link available. Please generate a recovery link first.'
            });
        }

        // Prepare simplified WhatsApp parameters (only name, link, amount)
        const notificationParams = {
            'student.name': user.full_name || 'Dear Student',
            'payment.link': pastDuePayment.payment_link,
            'amount': pastDuePayment.amount.toString(),
            // 'currency': pastDuePayment.currency || 'ILS'
        };

        // Send WhatsApp message using the new simplified template
        const whatsappSent = await whatsappReminderTrailClass(
            'payment_recovery', // New simplified template
            notificationParams,
            {
                country_code: user.country_code || '+972',
                mobile: user.mobile,
                full_name: user.full_name,
                language: user.language || 'HE'
            }
        );

        if (whatsappSent) {
            // Update the WhatsApp messages sent count
            await pastDuePayment.update({
                whatsapp_messages_sent: pastDuePayment.whatsapp_messages_sent + 1
            }, { transaction });

            // Log successful WhatsApp send
            paymentLogger.logPaymentVerification({
                student_id: user.id,
                student_name: user.full_name,
                subscription_id: pastDuePayment.subscription_id,
                verification_type: 'whatsapp_recovery_sent_by_admin_simple',
                verification_result: true,
                subscription_details: {
                    past_due_payment_id: pastDuePayment.id,
                    sent_by: req.user.full_name,
                    recipient_mobile: `${user.country_code}${user.mobile}`,
                    payment_link: pastDuePayment.payment_link,
                    whatsapp_count: pastDuePayment.whatsapp_messages_sent + 1,
                    estimated_cost: 0.45,
                    template_used: 'payment_recovery'
                }
            });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                whatsapp_sent: whatsappSent,
                whatsapp_count: pastDuePayment.whatsapp_messages_sent + (whatsappSent ? 1 : 0),
                recipient: {
                    name: user.full_name,
                    mobile: `${user.country_code}${user.mobile}`
                },
                message_details: {
                    template: 'payment_recovery',
                    amount: pastDuePayment.amount,
                    currency: pastDuePayment.currency,
                    estimated_cost: 0.45
                }
            },
            message: whatsappSent ? 'WhatsApp message sent successfully' : 'Failed to send WhatsApp message'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error sending WhatsApp recovery link:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get WhatsApp statistics for KPI display (Simplified version using past_due_payments table)
 */
const getWhatsAppStats = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        // Count WhatsApp messages sent this month from past_due_payments table
        const monthlyStats = await PastDuePayment.findAll({
            attributes: [
                [sequelize.fn('SUM', sequelize.col('whatsapp_messages_sent')), 'total_whatsapp_sent'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_payments']
            ],
            where: {
                created_at: {
                    [Op.gte]: startOfMonth,
                    [Op.lte]: endOfMonth
                },
                whatsapp_messages_sent: {
                    [Op.gt]: 0
                }
            },
            raw: true
        });

        const totalWhatsAppSent = parseInt(monthlyStats[0]?.total_whatsapp_sent || 0);
        const estimatedCost = totalWhatsAppSent * 0.45; // 0.45 ILS per message

        // Get daily breakdown for charts
        const dailyBreakdown = await PastDuePayment.findAll({
            attributes: [
                [sequelize.fn('DATE', sequelize.col('updated_at')), 'date'],
                [sequelize.fn('SUM', sequelize.col('whatsapp_messages_sent')), 'daily_count']
            ],
            where: {
                updated_at: {
                    [Op.gte]: startOfMonth,
                    [Op.lte]: endOfMonth
                },
                whatsapp_messages_sent: {
                    [Op.gt]: 0
                }
            },
            group: [sequelize.fn('DATE', sequelize.col('updated_at'))],
            order: [[sequelize.fn('DATE', sequelize.col('updated_at')), 'DESC']],
            raw: true
        });

        return res.status(200).json({
            status: 'success',
            data: {
                month_to_date: {
                    messages_sent: totalWhatsAppSent,
                    estimated_cost: parseFloat(estimatedCost.toFixed(2)),
                    currency: 'ILS',
                    average_cost_per_message: 0.45
                },
                daily_breakdown: dailyBreakdown.map(day => ({
                    date: day.date,
                    count: parseInt(day.daily_count || 0)
                })),
                summary: {
                    current_month: moment().format('MMMM YYYY'),
                    tracking_since: startOfMonth,
                    last_updated: new Date()
                }
            },
            message: 'WhatsApp statistics retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting WhatsApp stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message,
            fallback_data: {
                month_to_date: {
                    messages_sent: 0,
                    estimated_cost: 0,
                    currency: 'ILS'
                }
            }
        });
    }
};

const reactivateSubscription = async (req, res) => {
    let transaction;
    try {
        const { id } = req.params;
        transaction = await sequelize.transaction();

        const pastDuePayment = await PastDuePayment.findByPk(id, {
            include: [
                { model: User, as: 'User', attributes: ['id'] },
                { model: UserSubscriptionDetails, as: 'Subscription', attributes: ['id', 'status', 'is_cancel'] }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({ status: 'error', message: 'Failed payment not found' });
        }
        if (pastDuePayment.status !== 'resolved') {
            await transaction.rollback();
            return res.status(400).json({ status: 'error', message: 'Payment is not resolved; cannot reactivate subscription' });
        }
        if (!pastDuePayment.Subscription) {
            await transaction.rollback();
            return res.status(400).json({ status: 'error', message: 'No subscription found to reactivate' });
        }

        await pastDuePayment.Subscription.update({
            status: 'active',
            is_cancel: 0,
            cancellation_date: null,
            updated_at: new Date()
        }, { transaction });

        await User.update({
            subscription_id: pastDuePayment.Subscription.id,
            subscription_type: pastDuePayment.Subscription.type
        }, { where: { id: pastDuePayment.user_id }, transaction });

        await transaction.commit();

        paymentLogger.logSubscriptionChange({
            user_id: pastDuePayment.user_id,
            subscription_id: pastDuePayment.Subscription.id,
            change_type: 'reactivated',
            previous_status: 'inactive',
            new_status: 'active',
            triggered_by: 'admin_manual_reactivation',
            additional_details: { past_due_payment_id: pastDuePayment.id }
        });

        return res.status(200).json({ status: 'success', message: 'Subscription reactivated successfully' });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error reactivating subscription:', error);
        return res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    }
};

/**
 * Update credit card for failed payment recovery
 * This endpoint handles the complete flow: add card token and update recurring payment
 */
const updateCardForRecovery = async (req, res) => {
    let transaction;
    try {
        const { id } = req.params;
        
        // Support both new short IDs stored on PastDuePayment and legacy encrypted IDs
        let paymentId;
        try {
            // If ID looks like an 8-character alphanumeric, try resolving via PastDuePayment.short_id first
            if (/^[A-Za-z0-9]{8}$/.test(id)) {
                const pastDueByShortId = await PastDuePayment.findOne({
                    where: {
                        short_id: id
                    }
                });

                if (pastDueByShortId) {
                    paymentId = pastDueByShortId.id;
                }
            }

            // Fallback to legacy encrypted ID if we didn't resolve via short_id
            if (!paymentId) {
                paymentId = decryptRecoveryUrl(id);
            }
        } catch (decryptError) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid recovery link. The link may be corrupted or expired.'
            });
        }
        
        const {
            credit_card_number,
            card_date_mmyy,
            cvv,
            card_holder_name,
            card_holder_id
        } = req.body;

        // Validate required fields
        if (!credit_card_number || !card_date_mmyy || !cvv || !card_holder_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: credit_card_number, card_date_mmyy, cvv, card_holder_name'
            });
        }

        transaction = await sequelize.transaction();

        // Get the failed payment with related data
        const pastDuePayment = await PastDuePayment.findByPk(paymentId, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'lesson_min', 'weekly_lesson', 'plan_id']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment is not in past_due status'
            });
        }

        // Get PayPlus recurring details from payment transaction
        const payplusDetails = await getPayplusRecurringDetails(pastDuePayment.user_id);

        if (!payplusDetails || !payplusDetails.recurring_uid) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No recurring payment found for this user. Cannot update card without existing recurring payment.'
            });
        }

        // Validate that the recurring payment exists at PayPlus before attempting to update
        // This prevents "can-not-find-recurring-payment" errors
        const recurringValidation = await getRecurringPaymentDetails(payplusDetails.recurring_uid);
        
        if (!recurringValidation.success) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Recurring payment not found at PayPlus. The recurring payment may have been cancelled or deleted.',
                details: recurringValidation.error || 'can-not-find-recurring-payment'
            });
        }

        // Extract customer_uid from PayPlus API response if not found in stored data
        let customerUid = payplusDetails.customer_uid;
        
        console.log('PayPlus details from stored data:', {
            has_customer_uid: !!payplusDetails.customer_uid,
            customer_uid: payplusDetails.customer_uid,
            terminal_uid: payplusDetails.terminal_uid,
            recurring_uid: payplusDetails.recurring_uid
        });

        if (!customerUid && recurringValidation.data) {
            // Try to extract from PayPlus API response
            const payplusResponse = recurringValidation.data;
            const payplusData = payplusResponse.data || payplusResponse.results?.data || payplusResponse;
            
            console.log('Attempting to extract customer_uid from PayPlus API response:', {
                has_data: !!payplusResponse.data,
                has_results_data: !!payplusResponse.results?.data,
                response_keys: Object.keys(payplusResponse)
            });

            customerUid = payplusData?.customer_uid || 
                         payplusData?.customer?.customer_uid ||
                         payplusData?.data?.customer_uid ||
                         payplusResponse?.customer_uid ||
                         payplusResponse?.data?.customer?.customer_uid;
            
            console.log('Extracted customer_uid from PayPlus API:', customerUid);
        }

        // Validate we have all required PayPlus credentials
        if (!customerUid || !payplusDetails.terminal_uid) {
            await transaction.rollback();
            console.error('Missing PayPlus credentials:', {
                customer_uid: customerUid,
                terminal_uid: payplusDetails.terminal_uid,
                recurring_uid: payplusDetails.recurring_uid
            });
            return res.status(400).json({
                status: 'error',
                message: 'Missing required PayPlus credentials. Cannot update card without customer_uid and terminal_uid.',
                details: {
                    has_customer_uid: !!customerUid,
                    has_terminal_uid: !!payplusDetails.terminal_uid
                }
            });
        }

        // Step 1: Add new card token to PayPlus
        const cardTokenResult = await addCardToken({
            customer_uid: customerUid,
            terminal_uid: payplusDetails.terminal_uid,
            credit_card_number: credit_card_number,
            card_date_mmyy: card_date_mmyy,
            cvv: cvv,
            card_holder_name: card_holder_name,
            card_holder_id: card_holder_id
        });

        // Handle "card-already-exist" by reusing existing token (from DB, PayPlus response, or token list)
        let cardTokenToUse = cardTokenResult.card_token;
        if (!cardTokenResult.success) {
            const isCardExistsError = (cardTokenResult.error || '').toLowerCase().includes('card-already-exist');
            const fallbackToken =
                payplusDetails.card_token ||
                cardTokenResult.details?.data?.token_uid ||
                cardTokenResult.details?.data?.token;

            if (isCardExistsError) {
                cardTokenToUse = fallbackToken;
                // If still missing, pull from PayPlus token list
                if (!cardTokenToUse && customerUid) {
                    const listResult = await listCustomerTokens(customerUid);
                    if (listResult.success && Array.isArray(listResult.tokens) && listResult.tokens.length > 0) {
                        cardTokenToUse = listResult.tokens[0].token_uid || listResult.tokens[0].token;
                    }
                }
                if (!cardTokenToUse) {
                    await transaction.rollback();
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to add card token',
                        details: cardTokenResult.error
                    });
                }
            } else {
                await transaction.rollback();
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to add card token',
                    details: cardTokenResult.error
                });
            }
        }

        // If success but token missing, try to pull from response
        if (!cardTokenToUse) {
            cardTokenToUse =
                cardTokenResult.card_token ||
                cardTokenResult.details?.data?.token_uid ||
                cardTokenResult.details?.data?.token ||
                payplusDetails.card_token;
        }

        // Step 2: Prepare items for recurring payment update
        const subscription = pastDuePayment.Subscription;
        let subscriptionName = 'Monthly Plan';
        if (subscription) {
            subscriptionName = `${subscription.type || 'Monthly'} - ${subscription.lesson_min || 25}min lessons - ${subscription.weekly_lesson || 4} lessons/month`;
        }

        // Determine recurring settings based on subscription type (align with sales/payment.controller.js)
        const durationType = (() => {
            const t = (subscription?.type || '').toLowerCase();
            if (t.includes('year')) return 'yearly';
            if (t.includes('quarter')) return 'quarterly';
            if (t.includes('month')) return 'monthly';
            return 'monthly';
        })();
        // Prefer custom months from latest payment transaction; fallback to parsed type; default 1
        const customMonths =
            payplusDetails.custom_months ||
            subscription?.custom_months ||
            getCustomMonthsFromSubscriptionType(subscription?.type || '') ||
            1;
        const recurringType = getPayPlusRecurringType(durationType);
        const recurringRange = getPayPlusRecurringRange(durationType, customMonths);

        // If product lookup fails at PayPlus, sending product_uid causes "can-not-find-product".
        // Only include product_uid when we are confident; otherwise omit.
        const items = [{
            name: subscriptionName,
            price: pastDuePayment.amount,
            quantity: 1,
            vat_type: 0
        }];

        // Step 3: Update recurring payment with new card token
        const updateResult = await updateRecurringPayment({
            recurring_uid: payplusDetails.recurring_uid,
            customer_uid: customerUid,
            card_token: cardTokenToUse,
            terminal_uid: payplusDetails.terminal_uid,
            cashier_uid: payplusDetails.cashier_uid,
            currency_code: pastDuePayment.currency || 'ILS',
            instant_first_payment: false,
            valid: true,
            recurring_type: recurringType,
            recurring_range: recurringRange,
            number_of_charges: 0,
            items: items
        });

        if (!updateResult.success) {
            await transaction.rollback();
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update recurring payment',
                details: updateResult.error
            });
        }

        // Step 4: Save card token in our system - update the active recurring payment record
        const activeRecurringPayment = await RecurringPayment.findOne({
            where: {
                student_id: pastDuePayment.user_id,
                payplus_transaction_uid: payplusDetails.recurring_uid,
                is_active: true
            },
            transaction
        });

        if (activeRecurringPayment) {
            // Update webhook_data to include the new card token
            const webhookData = activeRecurringPayment.webhook_data || {};
            webhookData.card_token = cardTokenToUse;
            webhookData.card_updated_at = new Date().toISOString();
            webhookData.card_last_digits = credit_card_number.slice(-4);
            
            await activeRecurringPayment.update({
                webhook_data: webhookData,
                card_last_digits: credit_card_number.slice(-4),
                remarks: `${activeRecurringPayment.remarks || ''}\n[${new Date().toISOString()}] Card updated via recovery page. New card token: ${cardTokenToUse}`
            }, { transaction });
        }

        // Step 5: Add immediate charge - REMOVED (no manual charge; card/recurring update only)
        // const chargeDescription = `Past due payment - ${subscriptionName}`;
        // const chargeResult = await addRecurringCharge({
        //     recurring_uid: payplusDetails.recurring_uid,
        //     terminal_uid: payplusDetails.terminal_uid,
        //     card_token: cardTokenToUse,
        //     charge_date: moment().add(1, 'day').format('YYYY-MM-DD'),
        //     amount: pastDuePayment.amount,
        //     currency_code: pastDuePayment.currency || 'ILS',
        //     valid: true,
        //     description: chargeDescription,
        //     items: items
        // });

        // Step 6: Mark past due payment as resolved (no manual charge)
        await pastDuePayment.update({
            status: 'resolved',
            resolved_at: new Date(),
            resolved_transaction_id: payplusDetails.recurring_uid,
            resolved_payment_method: 'payplus_card_update_no_manual_charge',
            updated_at: new Date(),
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Card updated via recovery page. Marked resolved without immediate charge (collection will continue via recurring flow).`
        }, { transaction });

        // Disable dunning schedule because the past due is now resolved
        await DunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, {
            where: { past_due_payment_id: pastDuePayment.id },
            transaction
        });

        paymentLogger.logPaymentVerification({
            student_id: pastDuePayment.user_id,
            student_name: pastDuePayment.User?.full_name || 'unknown',
            subscription_id: pastDuePayment.subscription_id,
            verification_type: 'card_updated_for_recovery_no_charge',
            verification_result: true,
            subscription_details: {
                past_due_payment_id: pastDuePayment.id,
                new_card_token: cardTokenToUse,
                recurring_uid: payplusDetails.recurring_uid,
                card_last_digits: credit_card_number.slice(-4),
                updated_by: req.user?.full_name || 'system',
                manual_charge_disabled: true
            }
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                card_token: cardTokenToUse,
                recurring_uid: payplusDetails.recurring_uid,
                past_due_status: 'resolved',
                message: 'Card and recurring payment updated successfully. Past due payment has been marked as resolved (no manual charge).'
            },
            message: 'Card updated and recurring payment updated successfully. Past due resolved without immediate charge.'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating card for recovery:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment recovery page data (for frontend card update page)
 */
const getRecoveryPageData = async (req, res) => {
    try {
        const { id } = req.params;

        // Support both new short IDs stored on PastDuePayment and legacy encrypted IDs
        let paymentId;
        try {
            // If ID looks like an 8-character alphanumeric, try resolving via PastDuePayment.short_id first
            if (/^[A-Za-z0-9]{8}$/.test(id)) {
                const pastDueByShortId = await PastDuePayment.findOne({
                    where: {
                        short_id: id
                    }
                });

                if (pastDueByShortId) {
                    paymentId = pastDueByShortId.id;
                }
            }

            // Fallback to legacy encrypted ID if we didn't resolve via short_id
            if (!paymentId) {
                paymentId = decryptRecoveryUrl(id);
            }
        } catch (decryptError) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid recovery link. The link may be corrupted or expired.'
            });
        }

        const pastDuePayment = await PastDuePayment.findByPk(paymentId, {
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'lesson_min', 'weekly_lesson', 'status']
                }
            ]
        });

        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Failed payment not found'
            });
        }

        // Get PayPlus recurring details
        const payplusDetails = await getPayplusRecurringDetails(pastDuePayment.user_id);
        console.log('payplusDetails', payplusDetails);

        return res.status(200).json({
            status: 'success',
            data: {
                payment: {
                    id: pastDuePayment.id,
                    amount: pastDuePayment.amount,
                    currency: pastDuePayment.currency,
                    status: pastDuePayment.status,
                    failed_at: pastDuePayment.failed_at,
                    grace_period_expires_at: pastDuePayment.grace_period_expires_at
                },
                user: {
                    id: pastDuePayment.User?.id,
                    full_name: pastDuePayment.User?.full_name,
                    email: pastDuePayment.User?.email
                },
                subscription: pastDuePayment.Subscription ? {
                    id: pastDuePayment.Subscription.id,
                    type: pastDuePayment.Subscription.type,
                    lesson_min: pastDuePayment.Subscription.lesson_min,
                    weekly_lesson: pastDuePayment.Subscription.weekly_lesson
                } : null,
                has_recurring_payment: !!payplusDetails?.recurring_uid,
                customer_uid: payplusDetails?.customer_uid
            },
            message: 'Recovery page data retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting recovery page data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update payment_link from PayPlus link to recovery URL format for ALL past due payments
 * This is a public route (no auth) to allow PayPlus webhooks to update the link
 * Updates all past due payments that are currently active (not resolved/cancelled)
 */
const updatePaymentLinkFromPayPlus = async (req, res) => {
    try {
        // Find all active past due payments (not resolved, not cancelled)
        // Status can be: 'past_due', 'pending', 'unpaid' (active) or 'resolved', 'auto_cancelled' (inactive)
        const pastDuePayments = await PastDuePayment.findAll({
            where: {
                status: {
                    [Op.in]: ['past_due'] // Active past due payments
                }
            },
            order: [['id', 'ASC']]
        });

        if (!pastDuePayments || pastDuePayments.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No active past due payments found to update',
                data: {
                    total_found: 0,
                    updated: 0,
                    failed: 0,
                    updates: []
                }
            });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
        const updates = [];
        let successCount = 0;
        let failCount = 0;

        // Update each past due payment
        for (const pastDuePayment of pastDuePayments) {
            try {
                const oldPaymentLink = pastDuePayment.payment_link;

                // Ensure we have a short_id stored on the past due payment
                let shortId = pastDuePayment.short_id;
                if (!shortId) {
                    shortId = generateShortId();
                    await pastDuePayment.update({
                        short_id: shortId
                    });
                }

                // Build short recovery URL using short_id instead of long encrypted token
                const recoveryPageUrl = `${frontendUrl}/payment/recovery/${shortId}`;

                // Update the payment_link field
                await pastDuePayment.update({
                    payment_link: recoveryPageUrl,
                    updated_at: new Date()
                });

                updates.push({
                    past_due_payment_id: pastDuePayment.id,
                    user_id: pastDuePayment.user_id,
                    old_payment_link: oldPaymentLink,
                    new_payment_link: recoveryPageUrl,
                    short_id: shortId,
                    status: 'success'
                });

                successCount++;
                console.log(`[PAYPLUS] Updated payment_link for past_due_payment_id ${pastDuePayment.id}: ${recoveryPageUrl}`);

            } catch (error) {
                failCount++;
                updates.push({
                    past_due_payment_id: pastDuePayment.id,
                    user_id: pastDuePayment.user_id,
                    status: 'failed',
                    error: error.message
                });
                console.error(`[PAYPLUS] Failed to update payment_link for past_due_payment_id ${pastDuePayment.id}:`, error);
            }
        }

        return res.status(200).json({
            status: 'success',
            message: `Updated ${successCount} out of ${pastDuePayments.length} past due payments`,
            data: {
                total_found: pastDuePayments.length,
                updated: successCount,
                failed: failCount,
                updates: updates
            }
        });

    } catch (error) {
        console.error('Error updating payment links from PayPlus:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const bulkSendWhatsAppReminders = async (req, res) => {
    let mainTransaction;

    try {
        const { payment_ids, custom_message } = req.body;

        // Validate input
        if (!payment_ids || !Array.isArray(payment_ids) || payment_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'payment_ids array is required and must not be empty'
            });
        }

        // Limit bulk operations to prevent abuse and timeout
        if (payment_ids.length > 100) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot send more than 100 WhatsApp reminders at once. Please send in batches.'
            });
        }

        console.log(`[BULK_WHATSAPP] Starting bulk WhatsApp send for ${payment_ids.length} payments by admin: ${req.user?.full_name || 'Unknown'}`);

        // Start main transaction
        mainTransaction = await sequelize.transaction();

        // Fetch all past due payments with the provided IDs
        const pastDuePayments = await PastDuePayment.findAll({
            where: {
                id: {
                    [Op.in]: payment_ids
                }
            },
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'language']
                }
            ],
            transaction: mainTransaction
        });

        if (!pastDuePayments || pastDuePayments.length === 0) {
            await mainTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No payments found with the provided IDs'
            });
        }

        console.log(`[BULK_WHATSAPP] Found ${pastDuePayments.length} payments to process`);

        const results = [];
        let successCount = 0;
        let failCount = 0;
        let totalEstimatedCost = 0;

        // Process each payment sequentially to avoid overwhelming the WhatsApp service
        for (const payment of pastDuePayments) {
            try {
                // Validate payment status
                if (payment.status !== 'past_due') {
                    console.warn(`[BULK_WHATSAPP] Payment ${payment.id}: Status is ${payment.status}, skipping`);
                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        user_name: payment.User?.full_name || 'Unknown',
                        success: false,
                        error: `Payment status is ${payment.status}. Can only send to past_due payments.`
                    });
                    failCount++;
                    continue;
                }

                // Validate user exists
                if (!payment.User) {
                    console.warn(`[BULK_WHATSAPP] Payment ${payment.id}: User not found`);
                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        success: false,
                        error: 'User not found'
                    });
                    failCount++;
                    continue;
                }

                const user = payment.User;

                // Validate user has mobile number
                if (!user.mobile || user.mobile.trim() === '') {
                    console.warn(`[BULK_WHATSAPP] Payment ${payment.id}: User ${user.full_name} has no mobile number`);
                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        user_name: user.full_name,
                        success: false,
                        error: 'User has no mobile number'
                    });
                    failCount++;
                    continue;
                }

                // Validate payment link exists
                if (!payment.payment_link || payment.payment_link.trim() === '') {
                    console.warn(`[BULK_WHATSAPP] Payment ${payment.id}: No payment link available`);
                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        user_name: user.full_name,
                        success: false,
                        error: 'No payment recovery link available. Please generate a recovery link first.'
                    });
                    failCount++;
                    continue;
                }

                // Prepare WhatsApp parameters using the same structure as single send
                const notificationParams = {
                    'student.name': user.full_name || 'Dear Student',
                    'payment.link': payment.payment_link,
                    'amount': payment.amount.toString(),
                    // 'currency': payment.currency || 'ILS'
                };

                // Prepare user info for WhatsApp service
                const userInfo = {
                    country_code: user.country_code || '+972',
                    mobile: user.mobile,
                    full_name: user.full_name,
                    language: user.language || 'HE'
                };

                console.log(`[BULK_WHATSAPP] Payment ${payment.id}: Attempting to send to ${user.full_name} (${userInfo.country_code}${user.mobile})`);

                // Send WhatsApp message using the same template as single send
                const whatsappSent = await whatsappReminderTrailClass(
                    'payment_recovery', // Use the same simplified template
                    notificationParams,
                    userInfo
                );

                console.log(`[BULK_WHATSAPP] Payment ${payment.id}: WhatsApp send result:`, whatsappSent);

                if (whatsappSent) {
                    // Update the WhatsApp messages sent count
                    await payment.update({
                        whatsapp_messages_sent: payment.whatsapp_messages_sent + 1,
                        last_reminder_sent_at: new Date()
                    }, { transaction: mainTransaction });

                    // Log successful WhatsApp send
                    paymentLogger.logPaymentVerification({
                        student_id: user.id,
                        student_name: user.full_name,
                        subscription_id: payment.subscription_id,
                        verification_type: 'whatsapp_recovery_sent_by_admin_bulk',
                        verification_result: true,
                        subscription_details: {
                            past_due_payment_id: payment.id,
                            sent_by: req.user?.full_name || 'Admin',
                            recipient_mobile: `${user.country_code}${user.mobile}`,
                            payment_link: payment.payment_link,
                            whatsapp_count: payment.whatsapp_messages_sent + 1,
                            estimated_cost: 0.45,
                            template_used: 'payment_recovery',
                            bulk_operation: true
                        }
                    });

                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        user_name: user.full_name,
                        phone: `${user.country_code}${user.mobile}`,
                        amount: payment.amount,
                        currency: payment.currency,
                        success: true,
                        message: 'WhatsApp reminder sent successfully',
                        whatsapp_count: payment.whatsapp_messages_sent + 1,
                        estimated_cost: 0.45
                    });
                    
                    successCount++;
                    totalEstimatedCost += 0.45;
                    
                    console.log(`[BULK_WHATSAPP] Payment ${payment.id}: Successfully sent to ${user.full_name}`);
                } else {
                    results.push({
                        payment_id: payment.id,
                        user_id: payment.user_id,
                        user_name: user.full_name,
                        phone: `${user.country_code}${user.mobile}`,
                        success: false,
                        error: 'WhatsApp send failed - service returned false'
                    });
                    failCount++;
                    console.error(`[BULK_WHATSAPP] Payment ${payment.id}: WhatsApp service returned false`);
                }

                // Small delay between sends to avoid rate limiting (50ms)
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (paymentError) {
                console.error(`[BULK_WHATSAPP] Error processing payment ${payment.id}:`, paymentError);
                results.push({
                    payment_id: payment.id,
                    user_id: payment.user_id,
                    user_name: payment.User?.full_name || 'Unknown',
                    success: false,
                    error: paymentError.message || 'Internal error processing payment'
                });
                failCount++;
            }
        }

        // Commit the transaction after all sends are complete
        await mainTransaction.commit();

        // Log summary
        console.log(`[BULK_WHATSAPP] Completed by ${req.user?.full_name || 'Admin'}: ${successCount} succeeded, ${failCount} failed out of ${pastDuePayments.length} payments. Total cost: ₪${totalEstimatedCost.toFixed(2)}`);

        // Determine response status based on results
        const responseStatus = failCount === 0 ? 200 : (successCount === 0 ? 500 : 207); // 207 = Multi-Status

        return res.status(responseStatus).json({
            status: failCount === 0 ? 'success' : (successCount === 0 ? 'error' : 'partial_success'),
            message: `WhatsApp reminders sent: ${successCount} succeeded, ${failCount} failed`,
            data: {
                total_requested: payment_ids.length,
                total_processed: pastDuePayments.length,
                succeeded: successCount,
                failed: failCount,
                estimated_total_cost: parseFloat(totalEstimatedCost.toFixed(2)),
                cost_per_message: 0.45,
                template_used: 'payment_recovery',
                sent_by: req.user?.full_name || 'Admin',
                details: results
            }
        });

    } catch (error) {
        if (mainTransaction) await mainTransaction.rollback();
        
        console.error('[BULK_WHATSAPP] Error in bulk send WhatsApp reminders:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get duplicate past due payments for the same student (read-only)
 * Returns list of duplicates without deleting them
 */
const getDuplicatePastDuePayments = async (req, res) => {
    try {
        // Find all past_due payments grouped by user_id
        const allPastDuePayments = await PastDuePayment.findAll({
            where: { status: 'past_due' },
            order: [['user_id', 'ASC'], ['failed_at', 'DESC'], ['created_at', 'DESC']]
        });

        // Group by user_id to find duplicates
        const paymentsByUser = {};
        allPastDuePayments.forEach(payment => {
            const userId = payment.user_id;
            if (!paymentsByUser[userId]) {
                paymentsByUser[userId] = [];
            }
            paymentsByUser[userId].push(payment);
        });

        // Find users with duplicates (more than 1 past_due payment)
        const duplicateUsers = Object.keys(paymentsByUser).filter(
            userId => paymentsByUser[userId].length > 1
        );

        if (duplicateUsers.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No duplicate past due payments found',
                data: {
                    total_users_checked: Object.keys(paymentsByUser).length,
                    users_with_duplicates: 0,
                    duplicates_found: 0,
                    duplicates: []
                }
            });
        }

        const duplicateResults = [];
        let totalDuplicatesFound = 0;

        // Process each user with duplicates
        for (const userId of duplicateUsers) {
            const userPayments = paymentsByUser[userId];
            totalDuplicatesFound += userPayments.length - 1; // All except the one we keep

            // Sort by failed_at (most recent first), then by created_at
            userPayments.sort((a, b) => {
                const dateA = new Date(a.failed_at || a.created_at);
                const dateB = new Date(b.failed_at || b.created_at);
                return dateB - dateA; // Descending (newest first)
            });

            // Keep the first one (most recent), mark the rest as duplicates
            const paymentToKeep = userPayments[0];
            const paymentsToDelete = userPayments.slice(1);

            duplicateResults.push({
                user_id: parseInt(userId),
                total_payments: userPayments.length,
                payment_to_keep: {
                    id: paymentToKeep.id,
                    failed_at: paymentToKeep.failed_at,
                    created_at: paymentToKeep.created_at,
                    amount: paymentToKeep.amount,
                    currency: paymentToKeep.currency,
                    subscription_id: paymentToKeep.subscription_id
                },
                duplicate_payments: paymentsToDelete.map(p => ({
                    id: p.id,
                    failed_at: p.failed_at,
                    created_at: p.created_at,
                    amount: p.amount,
                    currency: p.currency,
                    subscription_id: p.subscription_id
                }))
            });
        }

        return res.status(200).json({
            status: 'success',
            message: `Found ${totalDuplicatesFound} duplicate past due payments`,
            data: {
                total_users_checked: Object.keys(paymentsByUser).length,
                users_with_duplicates: duplicateUsers.length,
                duplicates_found: totalDuplicatesFound,
                duplicates: duplicateResults
            }
        });

    } catch (error) {
        console.error('Error getting duplicate past due payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete duplicate past due payments for the same student
 * Keeps the most recent one (based on failed_at, then created_at) and deletes older duplicates
 * No parameters needed - deletes all duplicates found
 */
const deleteDuplicatePastDuePayments = async (req, res) => {
    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Find all past_due payments grouped by user_id
        const allPastDuePayments = await PastDuePayment.findAll({
            where: { status: 'past_due' },
            order: [['user_id', 'ASC'], ['failed_at', 'DESC'], ['created_at', 'DESC']],
            transaction
        });

        // Group by user_id to find duplicates
        const paymentsByUser = {};
        allPastDuePayments.forEach(payment => {
            const userId = payment.user_id;
            if (!paymentsByUser[userId]) {
                paymentsByUser[userId] = [];
            }
            paymentsByUser[userId].push(payment);
        });

        // Find users with duplicates (more than 1 past_due payment)
        const duplicateUsers = Object.keys(paymentsByUser).filter(
            userId => paymentsByUser[userId].length > 1
        );

        if (duplicateUsers.length === 0) {
            await transaction.rollback();
            return res.status(200).json({
                status: 'success',
                message: 'No duplicate past due payments found to delete',
                data: {
                    total_users_checked: Object.keys(paymentsByUser).length,
                    users_with_duplicates: 0,
                    duplicates_deleted: 0
                }
            });
        }

        const deletionResults = [];
        let totalDuplicatesDeleted = 0;

        // Process each user with duplicates
        for (const userId of duplicateUsers) {
            const userPayments = paymentsByUser[userId];

            // Sort by failed_at (most recent first), then by created_at
            userPayments.sort((a, b) => {
                const dateA = new Date(a.failed_at || a.created_at);
                const dateB = new Date(b.failed_at || b.created_at);
                return dateB - dateA; // Descending (newest first)
            });

            // Keep the first one (most recent), delete the rest
            const paymentToKeep = userPayments[0];
            const paymentsToDelete = userPayments.slice(1);

            const deletedIds = [];
            for (const paymentToDelete of paymentsToDelete) {
                try {
                    // First, delete or update related DunningSchedule records
                    const dunningSchedules = await DunningSchedule.findAll({
                        where: { past_due_payment_id: paymentToDelete.id },
                        transaction
                    });

                    // If there's a dunning schedule for the payment we're deleting,
                    // and the payment we're keeping doesn't have one, transfer it
                    if (dunningSchedules.length > 0) {
                        const keepHasDunning = await DunningSchedule.findOne({
                            where: { past_due_payment_id: paymentToKeep.id },
                            transaction
                        });

                        if (!keepHasDunning && dunningSchedules.length > 0) {
                            // Transfer the first dunning schedule to the payment we're keeping
                            await dunningSchedules[0].update({
                                past_due_payment_id: paymentToKeep.id
                            }, { transaction });

                            // Delete the rest
                            if (dunningSchedules.length > 1) {
                                await DunningSchedule.destroy({
                                    where: {
                                        id: {
                                            [Op.in]: dunningSchedules.slice(1).map(d => d.id)
                                        }
                                    },
                                    transaction
                                });
                            }
                        } else {
                            // Delete all dunning schedules for the payment we're deleting
                            await DunningSchedule.destroy({
                                where: {
                                    past_due_payment_id: paymentToDelete.id
                                },
                                transaction
                            });
                        }
                    }

                    // Delete the past due payment
                    await paymentToDelete.destroy({ transaction });
                    deletedIds.push(paymentToDelete.id);
                    totalDuplicatesDeleted++;

                    console.log(`[DELETE_DUPLICATES] Deleted duplicate past due payment ${paymentToDelete.id} for user ${userId}`);
                } catch (deleteError) {
                    console.error(`[DELETE_DUPLICATES] Error deleting payment ${paymentToDelete.id}:`, deleteError);
                    deletionResults.push({
                        user_id: parseInt(userId),
                        action: 'error',
                        error: deleteError.message,
                        deleted: false
                    });
                }
            }

            if (deletedIds.length > 0) {
                deletionResults.push({
                    user_id: parseInt(userId),
                    total_payments: userPayments.length,
                    payment_kept: {
                        id: paymentToKeep.id,
                        failed_at: paymentToKeep.failed_at
                    },
                    deleted_ids: deletedIds,
                    deleted_count: deletedIds.length
                });

                // Log the deletion
                paymentLogger.logPaymentVerification({
                    student_id: parseInt(userId),
                    student_name: 'unknown',
                    subscription_id: paymentToKeep.subscription_id,
                    verification_type: 'duplicate_past_due_payment_deleted',
                    verification_result: true,
                    subscription_details: {
                        kept_payment_id: paymentToKeep.id,
                        deleted_payment_ids: deletedIds,
                        total_duplicates: userPayments.length,
                        deleted_by: req.user?.full_name || 'admin',
                        reason: 'Duplicate past due payment cleanup'
                    }
                });
            }
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: `Successfully deleted ${totalDuplicatesDeleted} duplicate past due payments`,
            data: {
                total_users_checked: Object.keys(paymentsByUser).length,
                users_with_duplicates: duplicateUsers.length,
                duplicates_deleted: totalDuplicatesDeleted,
                deletion_results: deletionResults
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error deleting duplicate past due payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get past due payments that should be resolved (have successful payment transactions after failed_at)
 * This finds payments that are marked as past_due but actually have successful payments
 */
const getPastDuePaymentsToResolve = async (req, res) => {
    try {
        // Find all past_due payments
        const pastDuePayments = await PastDuePayment.findAll({
            where: { status: 'past_due' },
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email', 'mobile']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status'],
                    required: false
                }
            ],
            order: [['failed_at', 'DESC']]
        });

        if (!pastDuePayments || pastDuePayments.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No past due payments found',
                data: {
                    total_past_due: 0,
                    should_be_resolved: 0,
                    payments_to_resolve: []
                }
            });
        }

        const paymentsToResolve = [];

        // Check each past due payment for successful transactions after failed_at
        for (const pastDuePayment of pastDuePayments) {
            // Find successful payment transactions for this user after the failed_at date
            const successfulTransactions = await PaymentTransaction.findAll({
                where: {
                    student_id: pastDuePayment.user_id,
                    status: 'success',
                    created_at: {
                        [Op.gte]: pastDuePayment.failed_at
                    }
                },
                order: [['created_at', 'DESC']],
                limit: 5
            });

            // If there are successful transactions after the failure, this payment should be resolved
            if (successfulTransactions.length > 0) {
                // Find the most recent successful transaction
                const mostRecentSuccess = successfulTransactions[0];
                
                // Check if amount matches (approximately - within 5% tolerance)
                const paymentAmount = parseFloat(pastDuePayment.amount) || 0;
                const transactionAmount = parseFloat(mostRecentSuccess.amount) || 0;
                const amountMatch = Math.abs(paymentAmount - transactionAmount) <= (paymentAmount * 0.05);

                paymentsToResolve.push({
                    past_due_payment: {
                        id: pastDuePayment.id,
                        user_id: pastDuePayment.user_id,
                        amount: pastDuePayment.amount,
                        currency: pastDuePayment.currency,
                        failed_at: pastDuePayment.failed_at,
                        grace_period_expires_at: pastDuePayment.grace_period_expires_at,
                        subscription_id: pastDuePayment.subscription_id
                    },
                    user: {
                        id: pastDuePayment.User?.id,
                        full_name: pastDuePayment.User?.full_name,
                        email: pastDuePayment.User?.email
                    },
                    subscription: pastDuePayment.Subscription ? {
                        id: pastDuePayment.Subscription.id,
                        type: pastDuePayment.Subscription.type,
                        status: pastDuePayment.Subscription.status
                    } : null,
                    successful_transactions: successfulTransactions.map(txn => ({
                        id: txn.id,
                        transaction_id: txn.transaction_id,
                        amount: txn.amount,
                        currency: txn.currency,
                        created_at: txn.created_at,
                        payment_method: txn.payment_method,
                        card_last_digits: txn.card_last_digits
                    })),
                    most_recent_success: {
                        transaction_id: mostRecentSuccess.transaction_id,
                        amount: mostRecentSuccess.amount,
                        currency: mostRecentSuccess.currency,
                        created_at: mostRecentSuccess.created_at,
                        days_after_failure: moment(mostRecentSuccess.created_at).diff(moment(pastDuePayment.failed_at), 'days')
                    },
                    amount_match: amountMatch,
                    should_resolve: true
                });
            }
        }

        return res.status(200).json({
            status: 'success',
            message: `Found ${paymentsToResolve.length} past due payments that should be resolved`,
            data: {
                total_past_due: pastDuePayments.length,
                should_be_resolved: paymentsToResolve.length,
                payments_to_resolve: paymentsToResolve
            }
        });

    } catch (error) {
        console.error('Error getting past due payments to resolve:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Resolve past due payments that have successful payment transactions
 * Automatically marks them as resolved based on successful PaymentTransaction records
 */
const resolvePastDuePaymentsWithSuccessfulPayments = async (req, res) => {
    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Find all past_due payments
        const pastDuePayments = await PastDuePayment.findAll({
            where: { status: 'past_due' },
            include: [
                {
                    model: User,
                    as: 'User',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'Subscription',
                    attributes: ['id', 'type', 'status'],
                    required: false
                }
            ],
            transaction
        });

        if (!pastDuePayments || pastDuePayments.length === 0) {
            await transaction.rollback();
            return res.status(200).json({
                status: 'success',
                message: 'No past due payments found to resolve',
                data: {
                    total_checked: 0,
                    resolved: 0,
                    resolution_results: []
                }
            });
        }

        const resolutionResults = [];
        let totalResolved = 0;

        // Process each past due payment
        for (const pastDuePayment of pastDuePayments) {
            // Find successful payment transactions for this user after the failed_at date
            const successfulTransactions = await PaymentTransaction.findAll({
                where: {
                    student_id: pastDuePayment.user_id,
                    status: 'success',
                    created_at: {
                        [Op.gte]: pastDuePayment.failed_at
                    }
                },
                order: [['created_at', 'DESC']],
                limit: 1,
                transaction
            });

            // If there are successful transactions after the failure, resolve this payment
            if (successfulTransactions.length > 0) {
                const mostRecentSuccess = successfulTransactions[0];

                try {
                    // Mark payment as resolved
                    await pastDuePayment.update({
                        status: 'resolved',
                        resolved_at: new Date(),
                        resolved_transaction_id: mostRecentSuccess.transaction_id,
                        resolved_payment_method: 'payplus_auto_resolve',
                        notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Auto-resolved: Found successful payment transaction ${mostRecentSuccess.transaction_id} (${mostRecentSuccess.amount} ${mostRecentSuccess.currency}) on ${moment(mostRecentSuccess.created_at).format('YYYY-MM-DD HH:mm:ss')} after failure on ${moment(pastDuePayment.failed_at).format('YYYY-MM-DD HH:mm:ss')}`
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
                        student_id: pastDuePayment.user_id,
                        student_name: pastDuePayment.User?.full_name || 'unknown',
                        subscription_id: pastDuePayment.subscription_id,
                        verification_type: 'auto_resolve_past_due_with_successful_payment',
                        verification_result: true,
                        subscription_details: {
                            past_due_payment_id: pastDuePayment.id,
                            resolved_transaction_id: mostRecentSuccess.transaction_id,
                            transaction_amount: mostRecentSuccess.amount,
                            transaction_currency: mostRecentSuccess.currency,
                            transaction_date: mostRecentSuccess.created_at,
                            days_after_failure: moment(mostRecentSuccess.created_at).diff(moment(pastDuePayment.failed_at), 'days'),
                            resolved_by: 'system_auto_resolve'
                        }
                    });

                    resolutionResults.push({
                        past_due_payment_id: pastDuePayment.id,
                        user_id: pastDuePayment.user_id,
                        user_name: pastDuePayment.User?.full_name,
                        status: 'resolved',
                        resolved_transaction_id: mostRecentSuccess.transaction_id,
                        transaction_amount: mostRecentSuccess.amount,
                        transaction_date: mostRecentSuccess.created_at
                    });

                    totalResolved++;
                    console.log(`[AUTO_RESOLVE] Resolved past due payment ${pastDuePayment.id} for user ${pastDuePayment.user_id} based on successful transaction ${mostRecentSuccess.transaction_id}`);

                } catch (updateError) {
                    console.error(`[AUTO_RESOLVE] Error resolving payment ${pastDuePayment.id}:`, updateError);
                    resolutionResults.push({
                        past_due_payment_id: pastDuePayment.id,
                        user_id: pastDuePayment.user_id,
                        status: 'error',
                        error: updateError.message
                    });
                }
            }
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: `Successfully resolved ${totalResolved} past due payments`,
            data: {
                total_checked: pastDuePayments.length,
                resolved: totalResolved,
                failed: resolutionResults.filter(r => r.status === 'error').length,
                resolution_results: resolutionResults
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error resolving past due payments with successful payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getFailedPaymentsOverview,
    getFailedPaymentsList,
    getCollectionsList,
    getCollectionsInsights,
    getFailedPaymentDetails,
    getDunningSchedule,
    pauseDunningReminders,
    resumeDunningReminders,
    disableDunningReminders,
    sendReminderNow,
    setChargeSkip,
    getChargeSkips,
    removeChargeSkip,
    markAsPaidManually,
    cancelImmediately,
    getRecoveryLink,
    exportFailedPayments,
    getDunningStats,
    getRecoveryRates,
    getGlobalDunningSettings,
    generateNewRecoveryLink,
    updateGlobalDunningSettings,
    getWhatsAppStats,
    sendWhatsAppRecoveryLink,
    reactivateSubscription,
    updateCardForRecovery,
    getRecoveryPageData,
    updatePaymentLinkFromPayPlus,
    bulkSendWhatsAppReminders,
    getDuplicatePastDuePayments,
    deleteDuplicatePastDuePayments,
    getPastDuePaymentsToResolve,
    resolvePastDuePaymentsWithSuccessfulPayments
};
