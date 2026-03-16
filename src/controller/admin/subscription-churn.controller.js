// controller/admin/subscription-churn.controller.js
const { Op, Sequelize, QueryTypes } = require('sequelize');
const { dashboardSequelize } = require('../../connection/dashboard-read-connection');

// ============================================================================
// SUBSCRIPTION & CHURN DASHBOARD
// ============================================================================

/**
 * GET /month1-dropoffs
 * Component 1: Students who dropped after Month 1.
 * Students who subscribed but did NOT renew from month 1 to month 2.
 */
async function getMonth1Dropoffs(req, res) {
    try {
        const {
            page = 1,
            limit = 25,
            sort_by = 'subscription_start',
            sort_order = 'desc',
            search,
            date_from,
            date_to,
            cancellation_reason,
            package_type,
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const pageLimit = Math.max(1, Math.min(100, parseInt(limit)));
        const replacements = {};

        // Date filter
        let dateFilter = '';
        if (date_from && date_to) {
            dateFilter = 'AND first_sub.first_sub_start BETWEEN :date_from AND :date_to';
            replacements.date_from = date_from + ' 00:00:00';
            replacements.date_to = date_to + ' 23:59:59';
        }

        // Search filter
        let searchFilter = '';
        if (search) {
            searchFilter = 'AND (u.full_name LIKE :search OR u.email LIKE :search OR u.mobile LIKE :search)';
            replacements.search = `%${search}%`;
        }

        // Cancellation reason filter
        let reasonFilter = '';
        if (cancellation_reason && cancellation_reason !== 'all') {
            reasonFilter = 'AND first_sub.cancellation_reason LIKE :cancellation_reason';
            replacements.cancellation_reason = `%${cancellation_reason}%`;
        }

        // Package type filter
        let packageFilter = '';
        if (package_type && package_type !== 'all') {
            packageFilter = 'AND first_sub.sub_type = :package_type';
            replacements.package_type = package_type;
        }

        // Build the safe sort column
        const sortColumn = getChurnSortColumn(sort_by);
        const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

        // ---- Count query ----
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT
                    usd.user_id,
                    COUNT(*) AS total_sub_records,
                    SUM(CASE WHEN usd.status = 'active' THEN 1 ELSE 0 END) AS active_count
                FROM user_subscription_details usd
                INNER JOIN users u ON u.id = usd.user_id AND u.role_name = 'user'
                WHERE 1=1 ${searchFilter}
                GROUP BY usd.user_id
                HAVING total_sub_records <= 2
                   AND active_count = 0
            ) first_sub
            INNER JOIN users u ON u.id = first_sub.user_id
        `;

        // Use the simplified approach (query 2.1 ALT) for better performance
        const mainQuery = `
            SELECT
                first_sub.user_id AS student_id,
                u.full_name AS student_name,
                u.email,
                u.mobile AS phone,
                first_sub.first_sub_start AS subscription_start,
                first_sub.first_sub_renew AS cancellation_date,
                COALESCE(first_sub.cancellation_reason, 'Did not renew') AS cancellation_reason,
                COALESCE(cancelled_by_user.full_name, 'System / Auto') AS cancelled_by,
                COALESCE(tp.total_amount, 0) AS total_amount_paid,
                first_sub.sub_type AS package_purchased,
                COALESCE(first_sub.weekly_lesson, 0) AS lessons_included,
                COALESCE(lu.lessons_used, 0) AS lessons_used,
                GREATEST(COALESCE(first_sub.weekly_lesson, 0) - COALESCE(lu.lessons_used, 0), 0) AS lessons_unused,
                COALESCE(fl.future_count, 0) AS future_lessons_scheduled
            FROM (
                SELECT
                    usd.user_id,
                    MIN(usd.created_at) AS first_sub_start,
                    MIN(usd.renew_date) AS first_sub_renew,
                    MIN(usd.type) AS sub_type,
                    MIN(usd.weekly_lesson) AS weekly_lesson,
                    MIN(usd.lesson_min) AS lesson_min,
                    MIN(usd.cancellation_reason) AS cancellation_reason,
                    MIN(usd.cancelled_by_user_id) AS cancelled_by_user_id,
                    COUNT(*) AS total_sub_records,
                    SUM(CASE WHEN usd.status = 'active' THEN 1 ELSE 0 END) AS active_count
                FROM user_subscription_details usd
                WHERE usd.status IN ('active', 'inactive')
                GROUP BY usd.user_id
                HAVING total_sub_records <= 2
                   AND active_count = 0
            ) first_sub
            INNER JOIN users u ON u.id = first_sub.user_id AND u.role_name = 'user'
            LEFT JOIN users cancelled_by_user ON cancelled_by_user.id = first_sub.cancelled_by_user_id
            LEFT JOIN (
                SELECT student_id, SUM(amount) AS total_amount
                FROM payment_transactions WHERE status = 'success'
                GROUP BY student_id
            ) tp ON tp.student_id = first_sub.user_id
            LEFT JOIN (
                SELECT student_id, COUNT(*) AS lessons_used
                FROM classes
                WHERE status = 'ended' AND is_present = 1 AND (is_trial = 0 OR is_trial IS NULL)
                GROUP BY student_id
            ) lu ON lu.student_id = first_sub.user_id
            LEFT JOIN (
                SELECT student_id, COUNT(*) AS future_count
                FROM classes WHERE status = 'pending'
                GROUP BY student_id
            ) fl ON fl.student_id = first_sub.user_id
            WHERE 1=1
            ${dateFilter}
            ${searchFilter}
            ${reasonFilter}
            ${packageFilter}
            ORDER BY ${sortColumn} ${sortDir}
            LIMIT :limit OFFSET :offset
        `;

        // Execute count (simplified)
        const countFromMain = await dashboardSequelize.query(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT usd.user_id
                FROM user_subscription_details usd
                WHERE usd.status IN ('active', 'inactive')
                GROUP BY usd.user_id
                HAVING COUNT(*) <= 2 AND SUM(CASE WHEN usd.status = 'active' THEN 1 ELSE 0 END) = 0
            ) first_sub
            INNER JOIN users u ON u.id = first_sub.user_id AND u.role_name = 'user'
            WHERE 1=1 ${dateFilter} ${searchFilter} ${reasonFilter} ${packageFilter}
        `, {
            replacements,
            type: QueryTypes.SELECT,
        });

        const total = parseInt(countFromMain[0]?.total || 0);
        const totalPages = Math.ceil(total / pageLimit);

        const students = await dashboardSequelize.query(mainQuery, {
            replacements: { ...replacements, limit: pageLimit, offset: (pageNum - 1) * pageLimit },
            type: QueryTypes.SELECT,
        });

        // Summary statistics
        const summaryQuery = `
            SELECT
                COUNT(*) AS total_dropoffs,
                COALESCE(SUM(tp.total_amount), 0) AS total_revenue_lost,
                ROUND(AVG(COALESCE(lu.lessons_used, 0)), 1) AS avg_lessons_used
            FROM (
                SELECT usd.user_id
                FROM user_subscription_details usd
                WHERE usd.status IN ('active', 'inactive')
                GROUP BY usd.user_id
                HAVING COUNT(*) <= 2 AND SUM(CASE WHEN usd.status = 'active' THEN 1 ELSE 0 END) = 0
            ) first_sub
            INNER JOIN users u ON u.id = first_sub.user_id AND u.role_name = 'user'
            LEFT JOIN (
                SELECT student_id, SUM(amount) AS total_amount
                FROM payment_transactions WHERE status = 'success'
                GROUP BY student_id
            ) tp ON tp.student_id = first_sub.user_id
            LEFT JOIN (
                SELECT student_id, COUNT(*) AS lessons_used
                FROM classes WHERE status = 'ended' AND is_present = 1 AND (is_trial = 0 OR is_trial IS NULL)
                GROUP BY student_id
            ) lu ON lu.student_id = first_sub.user_id
            WHERE 1=1 ${dateFilter} ${searchFilter}
        `;

        const [summaryRow] = await dashboardSequelize.query(summaryQuery, {
            replacements,
            type: QueryTypes.SELECT,
        });

        // Top cancellation reasons
        const reasonsQuery = `
            SELECT
                COALESCE(first_sub.cancellation_reason, 'Did not renew') AS reason,
                COUNT(*) AS count
            FROM (
                SELECT usd.user_id, MIN(usd.cancellation_reason) AS cancellation_reason
                FROM user_subscription_details usd
                WHERE usd.status IN ('active', 'inactive')
                GROUP BY usd.user_id
                HAVING COUNT(*) <= 2 AND SUM(CASE WHEN usd.status = 'active' THEN 1 ELSE 0 END) = 0
            ) first_sub
            INNER JOIN users u ON u.id = first_sub.user_id AND u.role_name = 'user'
            WHERE 1=1 ${dateFilter} ${searchFilter}
            GROUP BY reason
            ORDER BY count DESC
            LIMIT 10
        `;

        const topReasons = await dashboardSequelize.query(reasonsQuery, {
            replacements,
            type: QueryTypes.SELECT,
        });

        return res.status(200).json({
            status: 'success',
            data: {
                students: students.map(s => ({
                    student_id: parseInt(s.student_id),
                    student_name: s.student_name,
                    email: s.email,
                    phone: s.phone,
                    subscription_start: s.subscription_start,
                    cancellation_date: s.cancellation_date,
                    cancellation_reason: s.cancellation_reason,
                    cancelled_by: s.cancelled_by,
                    total_amount_paid: parseFloat(s.total_amount_paid) || 0,
                    package_purchased: s.package_purchased || 'N/A',
                    lessons_included: parseInt(s.lessons_included) || 0,
                    lessons_used: parseInt(s.lessons_used) || 0,
                    lessons_unused: parseInt(s.lessons_unused) || 0,
                    future_lessons_scheduled: parseInt(s.future_lessons_scheduled) || 0,
                })),
                total,
                page: pageNum,
                totalPages,
                summary: {
                    total_dropoffs: parseInt(summaryRow?.total_dropoffs) || 0,
                    total_revenue_lost: parseFloat(summaryRow?.total_revenue_lost) || 0,
                    avg_lessons_used: parseFloat(summaryRow?.avg_lessons_used) || 0,
                    top_cancellation_reasons: topReasons.map(r => ({
                        reason: r.reason || 'Unknown',
                        count: parseInt(r.count) || 0,
                    })),
                },
            },
            message: 'Month-1 dropoff data retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getMonth1Dropoffs:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch month-1 dropoffs', error: error.message });
    }
}


/**
 * GET /daily-renewals
 * Component 2: Daily Renewals vs Non-Renewals bar/line chart data.
 */
async function getDailyRenewals(req, res) {
    try {
        const {
            date_from,
            date_to,
            granularity = 'day',
        } = req.query;

        const replacements = {};

        let dateFilterClause;
        if (date_from && date_to) {
            dateFilterClause = 'rp.next_payment_date BETWEEN :date_from AND :date_to';
            replacements.date_from = date_from;
            replacements.date_to = date_to;
        } else {
            dateFilterClause = 'rp.next_payment_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()';
        }

        // Granularity grouping
        let dateGroup, dateSelect;
        switch (granularity) {
            case 'week':
                dateGroup = "DATE_FORMAT(rp.next_payment_date, '%x-W%v')";
                dateSelect = `${dateGroup} AS renewal_date`;
                break;
            case 'month':
                dateGroup = "DATE_FORMAT(rp.next_payment_date, '%Y-%m')";
                dateSelect = `${dateGroup} AS renewal_date`;
                break;
            default: // 'day'
                dateGroup = 'rp.next_payment_date';
                dateSelect = `${dateGroup} AS renewal_date`;
                break;
        }

        // Query 2.2: recurring_payments source
        const dailyData = await dashboardSequelize.query(`
            SELECT
                ${dateSelect},
                COUNT(*) AS expected_renewals,
                SUM(rp.amount) AS expected_value,
                SUM(CASE WHEN rp.status = 'paid' THEN 1 ELSE 0 END) AS actual_renewals,
                SUM(CASE WHEN rp.status = 'paid' THEN rp.amount ELSE 0 END) AS renewed_value,
                SUM(CASE WHEN rp.status IN ('failed', 'cancelled') THEN 1 ELSE 0 END) AS non_renewals,
                SUM(CASE WHEN rp.status IN ('failed', 'cancelled') THEN rp.amount ELSE 0 END) AS lost_value
            FROM recurring_payments rp
            WHERE ${dateFilterClause}
            GROUP BY ${dateGroup}
            ORDER BY ${dateGroup}
        `, {
            replacements,
            type: QueryTypes.SELECT,
        });

        // Compute summary
        let totalExpected = 0, totalRenewed = 0, totalNonRenewed = 0;
        let totalExpectedValue = 0, totalRenewedValue = 0, totalLostValue = 0;

        const parsedDaily = dailyData.map(d => {
            const expected = parseInt(d.expected_renewals) || 0;
            const actual = parseInt(d.actual_renewals) || 0;
            const nonRenewals = parseInt(d.non_renewals) || 0;
            const expectedVal = parseFloat(d.expected_value) || 0;
            const renewedVal = parseFloat(d.renewed_value) || 0;
            const lostVal = parseFloat(d.lost_value) || 0;

            totalExpected += expected;
            totalRenewed += actual;
            totalNonRenewed += nonRenewals;
            totalExpectedValue += expectedVal;
            totalRenewedValue += renewedVal;
            totalLostValue += lostVal;

            return {
                date: d.renewal_date,
                expected_renewals: expected,
                expected_value: Math.round(expectedVal * 100) / 100,
                actual_renewals: actual,
                renewed_value: Math.round(renewedVal * 100) / 100,
                non_renewals: nonRenewals,
                lost_value: Math.round(lostVal * 100) / 100,
            };
        });

        const renewalRate = totalExpected > 0
            ? Math.round((totalRenewed / totalExpected) * 1000) / 10
            : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                daily_data: parsedDaily,
                summary: {
                    total_expected: totalExpected,
                    total_renewed: totalRenewed,
                    total_non_renewed: totalNonRenewed,
                    total_expected_value: Math.round(totalExpectedValue * 100) / 100,
                    total_renewed_value: Math.round(totalRenewedValue * 100) / 100,
                    total_lost_value: Math.round(totalLostValue * 100) / 100,
                    renewal_rate: renewalRate,
                },
            },
            message: 'Daily renewal data retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getDailyRenewals:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch daily renewals', error: error.message });
    }
}


/**
 * GET /non-renewals
 * Component 3: Non-renewal drill-down table.
 * Can be accessed standalone or as drill-down from Component 2 (with ?drill_date param).
 */
async function getNonRenewals(req, res) {
    try {
        const {
            page = 1,
            limit = 25,
            sort_by = 'renewal_date',
            sort_order = 'desc',
            search,
            date_from,
            date_to,
            drill_date,
            non_renewal_reason,
            subscription_type,
            cancelled_by: cancelledByFilter,
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const pageLimit = Math.max(1, Math.min(100, parseInt(limit)));
        const replacements = {};

        // Date filtering: drill_date takes priority
        let dateFilter = '';
        if (drill_date) {
            dateFilter = 'AND DATE(usd.renew_date) = :drill_date';
            replacements.drill_date = drill_date;
        } else if (date_from && date_to) {
            dateFilter = 'AND DATE(usd.renew_date) BETWEEN :date_from AND :date_to';
            replacements.date_from = date_from;
            replacements.date_to = date_to;
        } else {
            // Default: last 30 days
            dateFilter = 'AND DATE(usd.renew_date) BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()';
        }

        // Search filter
        let searchFilter = '';
        if (search) {
            searchFilter = 'AND (u.full_name LIKE :search OR u.email LIKE :search OR u.mobile LIKE :search)';
            replacements.search = `%${search}%`;
        }

        // Non-renewal reason filter
        let reasonFilter = '';
        if (non_renewal_reason && non_renewal_reason !== 'all') {
            reasonFilter = `AND (
                CASE
                    WHEN usd.cancellation_reason LIKE '%failed payment%' THEN 'Payment Failed'
                    WHEN usd.cancelled_by_user_id IS NOT NULL AND usd.cancelled_by_user_id > 0 THEN 'Manually Cancelled'
                    WHEN usd.cancellation_reason = 'NA' THEN 'Manually Cancelled'
                    WHEN usd.cancellation_reason IS NULL AND usd.is_cancel = 1 THEN 'Expired'
                    ELSE 'Other'
                END
            ) = :non_renewal_reason`;
            replacements.non_renewal_reason = non_renewal_reason;
        }

        // Subscription type filter
        let typeFilter = '';
        if (subscription_type && subscription_type !== 'all') {
            typeFilter = 'AND usd.type = :subscription_type';
            replacements.subscription_type = subscription_type;
        }

        // Cancelled by filter
        let cancelFilter = '';
        if (cancelledByFilter && cancelledByFilter !== 'all') {
            cancelFilter = 'AND cancelled_by.full_name = :cancelled_by';
            replacements.cancelled_by = cancelledByFilter;
        }

        const sortColumn = getNonRenewalSortColumn(sort_by);
        const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

        // ---- Query 2.3 ----
        const baseWhere = `
            WHERE usd.status = 'inactive'
              AND usd.is_cancel = 1
              AND NOT EXISTS (
                  SELECT 1 FROM user_subscription_details usd2
                  WHERE usd2.user_id = usd.user_id
                    AND usd2.id > usd.id
                    AND usd2.status = 'active'
                  AND usd2.renew_date >= CURDATE()
              )
              ${dateFilter}
              ${searchFilter}
              ${reasonFilter}
              ${typeFilter}
              ${cancelFilter}
        `;

        // Count
        const [countResult] = await dashboardSequelize.query(`
            SELECT COUNT(*) AS total
            FROM user_subscription_details usd
            INNER JOIN users u ON u.id = usd.user_id
            LEFT JOIN users cancelled_by ON cancelled_by.id = usd.cancelled_by_user_id
            ${baseWhere}
        `, {
            replacements,
            type: QueryTypes.SELECT,
        });

        const total = parseInt(countResult?.total || 0);
        const totalPages = Math.ceil(total / pageLimit);

        // Main query
        const students = await dashboardSequelize.query(`
            SELECT
                u.id AS student_id,
                u.full_name AS student_name,
                u.email,
                u.mobile AS phone,
                DATE(usd.renew_date) AS renewal_date,
                COALESCE(
                    pt_last.amount,
                    usd.cost_per_lesson * usd.weekly_lesson,
                    0
                ) AS subscription_value,
                CASE
                    WHEN usd.cancellation_reason LIKE '%failed payment%' THEN 'Payment Failed'
                    WHEN usd.cancelled_by_user_id IS NOT NULL AND usd.cancelled_by_user_id > 0 THEN 'Manually Cancelled'
                    WHEN usd.cancellation_reason = 'NA' THEN 'Manually Cancelled'
                    WHEN usd.cancellation_reason IS NULL AND usd.is_cancel = 1 THEN 'Expired'
                    ELSE 'Other'
                END AS status,
                CASE
                    WHEN usd.cancellation_reason LIKE '%failed payment%' THEN 'Payment Failed'
                    WHEN usd.cancelled_by_user_id IS NOT NULL AND usd.cancelled_by_user_id > 0 THEN 'Manually Cancelled'
                    ELSE COALESCE(usd.cancellation_reason, 'Unknown')
                END AS non_renewal_reason,
                COALESCE(cancelled_by.full_name, 'System / Auto') AS cancelled_by
            FROM user_subscription_details usd
            INNER JOIN users u ON u.id = usd.user_id
            LEFT JOIN users cancelled_by ON cancelled_by.id = usd.cancelled_by_user_id
            LEFT JOIN (
                SELECT student_id, amount,
                       ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at DESC) AS rn
                FROM payment_transactions
                WHERE status = 'success'
            ) pt_last ON pt_last.student_id = usd.user_id AND pt_last.rn = 1
            ${baseWhere}
            ORDER BY ${sortColumn} ${sortDir}
            LIMIT :limit OFFSET :offset
        `, {
            replacements: { ...replacements, limit: pageLimit, offset: (pageNum - 1) * pageLimit },
            type: QueryTypes.SELECT,
        });

        return res.status(200).json({
            status: 'success',
            data: {
                students: students.map(s => ({
                    student_id: parseInt(s.student_id),
                    student_name: s.student_name,
                    email: s.email,
                    phone: s.phone,
                    renewal_date: s.renewal_date,
                    subscription_value: parseFloat(s.subscription_value) || 0,
                    status: s.status,
                    non_renewal_reason: s.non_renewal_reason,
                    cancelled_by: s.cancelled_by,
                })),
                total,
                page: pageNum,
                totalPages,
            },
            message: 'Non-renewal data retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getNonRenewals:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch non-renewals', error: error.message });
    }
}


/**
 * GET /forecast
 * Component 4: End-of-month renewal forecast.
 */
async function getRenewalForecast(req, res) {
    try {
        // Query 2.4: recurring_payments source
        const forecast = await dashboardSequelize.query(`
            SELECT
                rp.next_payment_date AS forecast_date,
                COUNT(*) AS expected_renewals,
                SUM(rp.amount) AS expected_value
            FROM recurring_payments rp
            WHERE rp.is_active = 1
              AND rp.status = 'paid'
              AND rp.next_payment_date BETWEEN CURDATE() AND LAST_DAY(CURDATE())
            GROUP BY rp.next_payment_date
            ORDER BY rp.next_payment_date
        `, { type: QueryTypes.SELECT });

        // Build cumulative running total
        let cumulative = 0;
        const parsedForecast = forecast.map(f => {
            const val = parseFloat(f.expected_value) || 0;
            cumulative += val;
            return {
                date: f.forecast_date,
                expected_renewals: parseInt(f.expected_renewals) || 0,
                expected_value: Math.round(val * 100) / 100,
                cumulative_value: Math.round(cumulative * 100) / 100,
            };
        });

        // Summary card (query 2.4b)
        const [summary] = await dashboardSequelize.query(`
            SELECT
                COUNT(*) AS total_expected_renewals,
                COALESCE(SUM(rp.amount), 0) AS total_projected_revenue,
                DATEDIFF(LAST_DAY(CURDATE()), CURDATE()) AS days_remaining
            FROM recurring_payments rp
            WHERE rp.is_active = 1
              AND rp.status = 'paid'
              AND rp.next_payment_date BETWEEN CURDATE() AND LAST_DAY(CURDATE())
        `, { type: QueryTypes.SELECT });

        return res.status(200).json({
            status: 'success',
            data: {
                forecast: parsedForecast,
                summary: {
                    remaining_days: parseInt(summary?.days_remaining) || 0,
                    total_expected_renewals: parseInt(summary?.total_expected_renewals) || 0,
                    total_expected_value: Math.round((parseFloat(summary?.total_projected_revenue) || 0) * 100) / 100,
                },
            },
            message: 'Renewal forecast retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getRenewalForecast:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch renewal forecast', error: error.message });
    }
}


/**
 * GET /filters
 * Returns available filter options for dropdowns.
 */
async function getChurnFilterOptions(req, res) {
    try {
        // Subscription types
        const subTypes = await dashboardSequelize.query(`
            SELECT DISTINCT type FROM user_subscription_details
            WHERE type IS NOT NULL
            ORDER BY type
        `, { type: QueryTypes.SELECT });

        // Cancellation reason categories
        const reasons = await dashboardSequelize.query(`
            SELECT id, name FROM cancellation_reason_categories
            WHERE status = 'active'
            ORDER BY name
        `, { type: QueryTypes.SELECT });

        // Distinct package types (alias for subscription types)
        const packages = subTypes;

        // Admin/sales users who can cancel (for "Cancelled By" filter)
        const systemUsers = await dashboardSequelize.query(`
            SELECT DISTINCT u.id, u.full_name
            FROM users u
            WHERE u.id IN (
                SELECT DISTINCT cancelled_by_user_id
                FROM user_subscription_details
                WHERE cancelled_by_user_id IS NOT NULL
            )
            ORDER BY u.full_name
        `, { type: QueryTypes.SELECT });

        return res.status(200).json({
            status: 'success',
            data: {
                subscription_types: subTypes.map(s => s.type),
                cancellation_reasons: reasons.map(r => r.name),
                packages: packages.map(p => p.type),
                system_users: systemUsers.map(u => u.full_name),
            },
            message: 'Filter options retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getChurnFilterOptions:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch filter options', error: error.message });
    }
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getChurnSortColumn(sort_by) {
    const allowed = {
        'student_name': 'u.full_name',
        'email': 'u.email',
        'subscription_start': 'first_sub.first_sub_start',
        'cancellation_date': 'first_sub.first_sub_renew',
        'cancellation_reason': 'cancellation_reason',
        'total_amount_paid': 'total_amount_paid',
        'lessons_used': 'lessons_used',
        'lessons_unused': 'lessons_unused',
    };
    return allowed[sort_by] || 'first_sub.first_sub_start';
}

function getNonRenewalSortColumn(sort_by) {
    const allowed = {
        'student_name': 'u.full_name',
        'email': 'u.email',
        'renewal_date': 'usd.renew_date',
        'subscription_value': 'subscription_value',
        'status': 'status',
        'non_renewal_reason': 'non_renewal_reason',
        'cancelled_by': 'cancelled_by',
    };
    return allowed[sort_by] || 'usd.renew_date';
}


module.exports = {
    getMonth1Dropoffs,
    getDailyRenewals,
    getNonRenewals,
    getRenewalForecast,
    getChurnFilterOptions,
};
