// controller/admin/teacher-performance.controller.js
const { Op, Sequelize, QueryTypes } = require('sequelize');
const { dashboardSequelize } = require('../../connection/dashboard-read-connection');

// ============================================================================
// TEACHER PERFORMANCE DASHBOARD
// ============================================================================

/**
 * GET /overview
 * Returns all teachers with their 8 performance metrics, paginated.
 * Combines queries 1.1–1.8 into a single aggregated response.
 */
async function getTeacherPerformanceOverview(req, res) {
    try {
        const {
            page = 1,
            limit = 25,
            sort_by = 'retention_score',
            sort_order = 'desc',
            search,
            teacher_id,
            student_status = 'all',
            time_period,
            date_from,
            date_to,
            view_mode = 'current',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const pageLimit = Math.max(1, Math.min(100, parseInt(limit)));

        // --- Resolve date range ---
        let dateFilter = '';
        let dateReplacements = {};
        const resolvedDates = resolveDateRange(time_period, date_from, date_to);
        if (resolvedDates) {
            dateFilter = 'AND c.meeting_start >= :date_from AND c.meeting_start <= :date_to';
            dateReplacements = { date_from: resolvedDates.from, date_to: resolvedDates.to };
        }

        // --- Teacher filter ---
        let teacherFilter = '';
        if (teacher_id && teacher_id !== 'all') {
            teacherFilter = 'AND t.id = :teacher_id';
            dateReplacements.teacher_id = parseInt(teacher_id);
        }

        // --- Search filter ---
        let searchFilter = '';
        if (search) {
            searchFilter = 'AND (t.full_name LIKE :search OR t.email LIKE :search)';
            dateReplacements.search = `%${search}%`;
        }

        // ---- QUERY 1.8: Full combined performance query (Retention/Comparison) ----
        const mainQuery = `
            SELECT
                t.id AS teacher_id,
                t.full_name AS teacher_name,
                t.email,
                COALESCE(active_now.active_students, 0) AS active_students,
                COALESCE(fixed_sched.fixed_schedule_students, 0) AS fixed_schedule_students,
                COALESCE(att.total_scheduled_lessons, 0) AS total_lessons_scheduled,
                COALESCE(att.lessons_attended, 0) AS total_lessons_attended,
                COALESCE(att.attendance_rate_pct, 0) AS attendance_rate,
                COALESCE(att.no_show_count, 0) AS no_shows,
                COALESCE(att.no_show_rate_pct, 0) AS no_show_rate,
                COALESCE(lifetime.avg_lifetime_days, 0) AS avg_student_lifetime_days,
                ROUND(COALESCE(lifetime.avg_lifetime_days, 0) / 30.0, 1) AS avg_student_lifetime_months,
                COALESCE(median_lt.median_lifetime_days, 0) AS median_student_lifetime_days,
                ROUND(COALESCE(median_lt.median_lifetime_days, 0) / 30.0, 1) AS median_student_lifetime_months,
                COALESCE(total_ever.total_students_ever, 0) AS total_all_time_students,
                COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0) AS students_left,
                ROUND(
                    (COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0)) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS students_left_percentage,
                ROUND(
                    COALESCE(active_now.active_students, 0) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS retention_score
            FROM users t

            /* Active students (query 1.1) */
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS active_students
                FROM (
                    SELECT rc.teacher_id, rc.student_id
                    FROM regular_class rc
                    INNER JOIN user_subscription_details usd
                        ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    UNION
                    SELECT c.teacher_id, c.student_id
                    FROM classes c
                    INNER JOIN user_subscription_details usd
                        ON usd.user_id = c.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    WHERE c.status IN ('pending', 'started')
                      AND (c.is_trial = 0 OR c.is_trial IS NULL)
                ) sq
                GROUP BY teacher_id
            ) active_now ON active_now.teacher_id = t.id

            /* Fixed schedule students (query 1.2) */
            LEFT JOIN (
                SELECT rc.teacher_id, COUNT(DISTINCT rc.student_id) AS fixed_schedule_students
                FROM regular_class rc
                INNER JOIN user_subscription_details usd
                    ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                GROUP BY rc.teacher_id
            ) fixed_sched ON fixed_sched.teacher_id = t.id

            /* Attendance & No-show (queries 1.3 + 1.4) */
            LEFT JOIN (
                SELECT
                    c.teacher_id,
                    COUNT(*) AS total_scheduled_lessons,
                    SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) AS lessons_attended,
                    SUM(CASE WHEN c.is_present = 0 THEN 1 ELSE 0 END) AS no_show_count,
                    ROUND(SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS attendance_rate_pct,
                    ROUND(SUM(CASE WHEN c.is_present = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS no_show_rate_pct
                FROM classes c
                WHERE c.status = 'ended'
                  AND (c.is_trial = 0 OR c.is_trial IS NULL)
                  ${dateFilter}
                GROUP BY c.teacher_id
            ) att ON att.teacher_id = t.id

            /* Average lifetime (query 1.5) */
            LEFT JOIN (
                SELECT teacher_id,
                    ROUND(AVG(DATEDIFF(last_class, first_class)), 1) AS avg_lifetime_days
                FROM (
                    SELECT teacher_id, student_id,
                           MIN(meeting_start) AS first_class, MAX(meeting_start) AS last_class
                    FROM classes
                    WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id, student_id
                ) sl
                GROUP BY teacher_id
            ) lifetime ON lifetime.teacher_id = t.id

            /* Median lifetime (query 1.6 ALT - MySQL 8+ window functions) */
            LEFT JOIN (
                SELECT teacher_id,
                    ROUND(AVG(lifetime_days), 1) AS median_lifetime_days
                FROM (
                    SELECT
                        teacher_id,
                        DATEDIFF(MAX(meeting_start), MIN(meeting_start)) AS lifetime_days,
                        ROW_NUMBER() OVER (PARTITION BY teacher_id ORDER BY DATEDIFF(MAX(meeting_start), MIN(meeting_start))) AS rn,
                        COUNT(*) OVER (PARTITION BY teacher_id) AS total_students
                    FROM classes
                    WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id, student_id
                ) ranked
                WHERE rn IN (FLOOR((total_students + 1) / 2), CEIL((total_students + 1) / 2))
                GROUP BY teacher_id
            ) median_lt ON median_lt.teacher_id = t.id

            /* Total students ever (for students_left / retention_score) */
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS total_students_ever
                FROM classes
                WHERE status IN ('ended', 'pending', 'started')
                  AND (is_trial = 0 OR is_trial IS NULL)
                GROUP BY teacher_id
            ) total_ever ON total_ever.teacher_id = t.id

            WHERE t.role_name = 'teacher'
              AND t.status = 'active'
              ${teacherFilter}
              ${searchFilter}
            ORDER BY ${getSafeSortColumn(sort_by)} ${sort_order === 'asc' ? 'ASC' : 'DESC'}
        `;

        // Get total count
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM users t
            WHERE t.role_name = 'teacher' AND t.status = 'active'
            ${teacherFilter} ${searchFilter}
        `;

        const [countResult] = await dashboardSequelize.query(countQuery, {
            replacements: dateReplacements,
            type: QueryTypes.SELECT,
        });

        const total = parseInt(countResult?.total || 0);
        const totalPages = Math.ceil(total / pageLimit);

        // Add pagination
        const fullQuery = `${mainQuery} LIMIT :limit OFFSET :offset`;
        const teachers = await dashboardSequelize.query(fullQuery, {
            replacements: {
                ...dateReplacements,
                limit: pageLimit,
                offset: (pageNum - 1) * pageLimit,
            },
            type: QueryTypes.SELECT,
        });

        // Compute summary aggregates
        const summaryQuery = `
            SELECT
                COUNT(*) AS total_teachers,
                COALESCE(SUM(aq.active_students), 0) AS total_active_students,
                ROUND(AVG(aq.attendance_rate), 1) AS avg_attendance_rate,
                ROUND(AVG(aq.retention_score), 1) AS avg_retention_score
            FROM (
                SELECT
                    t.id,
                    COALESCE(active_now.active_students, 0) AS active_students,
                    COALESCE(att.attendance_rate_pct, 0) AS attendance_rate,
                    ROUND(
                        COALESCE(active_now.active_students, 0) * 100.0
                        / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                    ) AS retention_score
                FROM users t
                LEFT JOIN (
                    SELECT teacher_id, COUNT(DISTINCT student_id) AS active_students
                    FROM (
                        SELECT rc.teacher_id, rc.student_id
                        FROM regular_class rc
                        INNER JOIN user_subscription_details usd ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                        UNION
                        SELECT c.teacher_id, c.student_id
                        FROM classes c
                        INNER JOIN user_subscription_details usd ON usd.user_id = c.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                        WHERE c.status IN ('pending', 'started') AND (c.is_trial = 0 OR c.is_trial IS NULL)
                    ) sq GROUP BY teacher_id
                ) active_now ON active_now.teacher_id = t.id
                LEFT JOIN (
                    SELECT teacher_id,
                        ROUND(SUM(CASE WHEN is_present = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS attendance_rate_pct
                    FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id
                ) att ON att.teacher_id = t.id
                LEFT JOIN (
                    SELECT teacher_id, COUNT(DISTINCT student_id) AS total_students_ever
                    FROM classes WHERE status IN ('ended', 'pending', 'started') AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id
                ) total_ever ON total_ever.teacher_id = t.id
                WHERE t.role_name = 'teacher' AND t.status = 'active'
                ${teacherFilter} ${searchFilter}
            ) aq
        `;

        const [summary] = await dashboardSequelize.query(summaryQuery, {
            replacements: dateReplacements,
            type: QueryTypes.SELECT,
        });

        return res.status(200).json({
            status: 'success',
            data: {
                teachers: teachers.map(t => ({
                    ...t,
                    active_students: parseInt(t.active_students) || 0,
                    fixed_schedule_students: parseInt(t.fixed_schedule_students) || 0,
                    total_lessons_scheduled: parseInt(t.total_lessons_scheduled) || 0,
                    total_lessons_attended: parseInt(t.total_lessons_attended) || 0,
                    attendance_rate: parseFloat(t.attendance_rate) || 0,
                    no_shows: parseInt(t.no_shows) || 0,
                    no_show_rate: parseFloat(t.no_show_rate) || 0,
                    avg_student_lifetime_days: parseFloat(t.avg_student_lifetime_days) || 0,
                    avg_student_lifetime_months: parseFloat(t.avg_student_lifetime_months) || 0,
                    median_student_lifetime_days: parseFloat(t.median_student_lifetime_days) || 0,
                    median_student_lifetime_months: parseFloat(t.median_student_lifetime_months) || 0,
                    total_all_time_students: parseInt(t.total_all_time_students) || 0,
                    students_left: parseInt(t.students_left) || 0,
                    students_left_percentage: parseFloat(t.students_left_percentage) || 0,
                    retention_score: parseFloat(t.retention_score) || 0,
                })),
                total,
                page: pageNum,
                totalPages,
                summary: {
                    total_teachers: parseInt(summary?.total_teachers) || 0,
                    total_active_students: parseInt(summary?.total_active_students) || 0,
                    avg_attendance_rate: parseFloat(summary?.avg_attendance_rate) || 0,
                    avg_retention_score: parseFloat(summary?.avg_retention_score) || 0,
                },
            },
            message: 'Teacher performance data retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getTeacherPerformanceOverview:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher performance data',
            error: error.message,
        });
    }
}


/**
 * GET /teacher/:id
 * Returns detailed performance data for a single teacher, including student history and monthly trend.
 */
async function getTeacherDetail(req, res) {
    try {
        const { id } = req.params;
        const {
            time_period,
            date_from,
            date_to,
        } = req.query;

        const teacherId = parseInt(id);
        if (!teacherId) {
            return res.status(400).json({ status: 'error', message: 'Valid teacher ID is required' });
        }

        // --- Date range ---
        let dateFilter = '';
        const dateReplacements = { teacher_id: teacherId };
        const resolvedDates = resolveDateRange(time_period, date_from, date_to);
        if (resolvedDates) {
            dateFilter = 'AND c.meeting_start >= :date_from AND c.meeting_start <= :date_to';
            dateReplacements.date_from = resolvedDates.from;
            dateReplacements.date_to = resolvedDates.to;
        }

        // ---- Core teacher metrics (reuse the same sub-queries) ----
        const [teacher] = await dashboardSequelize.query(`
            SELECT
                t.id AS teacher_id,
                t.full_name AS teacher_name,
                t.email,
                COALESCE(active_now.active_students, 0) AS active_students,
                COALESCE(fixed_sched.fixed_schedule_students, 0) AS fixed_schedule_students,
                COALESCE(att.total_scheduled_lessons, 0) AS total_lessons_scheduled,
                COALESCE(att.lessons_attended, 0) AS total_lessons_attended,
                COALESCE(att.attendance_rate_pct, 0) AS attendance_rate,
                COALESCE(att.no_show_count, 0) AS no_shows,
                COALESCE(att.no_show_rate_pct, 0) AS no_show_rate,
                COALESCE(lifetime.avg_lifetime_days, 0) AS avg_student_lifetime_days,
                ROUND(COALESCE(lifetime.avg_lifetime_days, 0) / 30.0, 1) AS avg_student_lifetime_months,
                COALESCE(median_lt.median_lifetime_days, 0) AS median_student_lifetime_days,
                ROUND(COALESCE(median_lt.median_lifetime_days, 0) / 30.0, 1) AS median_student_lifetime_months,
                COALESCE(total_ever.total_students_ever, 0) AS total_all_time_students,
                COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0) AS students_left,
                ROUND(
                    (COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0)) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS students_left_percentage,
                ROUND(
                    COALESCE(active_now.active_students, 0) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS retention_score
            FROM users t
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS active_students FROM (
                    SELECT rc.teacher_id, rc.student_id FROM regular_class rc
                    INNER JOIN user_subscription_details usd ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    UNION
                    SELECT c.teacher_id, c.student_id FROM classes c
                    INNER JOIN user_subscription_details usd ON usd.user_id = c.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    WHERE c.status IN ('pending', 'started') AND (c.is_trial = 0 OR c.is_trial IS NULL)
                ) sq WHERE teacher_id = :teacher_id GROUP BY teacher_id
            ) active_now ON active_now.teacher_id = t.id
            LEFT JOIN (
                SELECT rc.teacher_id, COUNT(DISTINCT rc.student_id) AS fixed_schedule_students
                FROM regular_class rc
                INNER JOIN user_subscription_details usd ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                WHERE rc.teacher_id = :teacher_id
                GROUP BY rc.teacher_id
            ) fixed_sched ON fixed_sched.teacher_id = t.id
            LEFT JOIN (
                SELECT c.teacher_id,
                    COUNT(*) AS total_scheduled_lessons,
                    SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) AS lessons_attended,
                    SUM(CASE WHEN c.is_present = 0 THEN 1 ELSE 0 END) AS no_show_count,
                    ROUND(SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS attendance_rate_pct,
                    ROUND(SUM(CASE WHEN c.is_present = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS no_show_rate_pct
                FROM classes c
                WHERE c.status = 'ended' AND (c.is_trial = 0 OR c.is_trial IS NULL)
                  AND c.teacher_id = :teacher_id ${dateFilter}
                GROUP BY c.teacher_id
            ) att ON att.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, ROUND(AVG(DATEDIFF(last_class, first_class)), 1) AS avg_lifetime_days
                FROM (
                    SELECT teacher_id, student_id, MIN(meeting_start) AS first_class, MAX(meeting_start) AS last_class
                    FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL) AND teacher_id = :teacher_id
                    GROUP BY teacher_id, student_id
                ) sl GROUP BY teacher_id
            ) lifetime ON lifetime.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, ROUND(AVG(lifetime_days), 1) AS median_lifetime_days
                FROM (
                    SELECT teacher_id, DATEDIFF(MAX(meeting_start), MIN(meeting_start)) AS lifetime_days,
                        ROW_NUMBER() OVER (PARTITION BY teacher_id ORDER BY DATEDIFF(MAX(meeting_start), MIN(meeting_start))) AS rn,
                        COUNT(*) OVER (PARTITION BY teacher_id) AS total_students
                    FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL) AND teacher_id = :teacher_id
                    GROUP BY teacher_id, student_id
                ) ranked WHERE rn IN (FLOOR((total_students + 1) / 2), CEIL((total_students + 1) / 2))
                GROUP BY teacher_id
            ) median_lt ON median_lt.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS total_students_ever
                FROM classes WHERE status IN ('ended', 'pending', 'started') AND (is_trial = 0 OR is_trial IS NULL) AND teacher_id = :teacher_id
                GROUP BY teacher_id
            ) total_ever ON total_ever.teacher_id = t.id
            WHERE t.id = :teacher_id AND t.role_name = 'teacher'
        `, {
            replacements: dateReplacements,
            type: QueryTypes.SELECT,
        });

        if (!teacher) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found' });
        }

        // ---- Student history for this teacher ----
        const studentHistory = await dashboardSequelize.query(`
            SELECT
                c.student_id,
                u.full_name AS student_name,
                CASE WHEN usd_active.id IS NOT NULL THEN 'active' ELSE 'inactive' END AS status,
                MIN(c.meeting_start) AS start_date,
                MAX(c.meeting_start) AS end_date,
                DATEDIFF(MAX(c.meeting_start), MIN(c.meeting_start)) AS lifetime_days,
                SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) AS lessons_attended,
                COUNT(*) AS lessons_scheduled
            FROM classes c
            INNER JOIN users u ON u.id = c.student_id
            LEFT JOIN user_subscription_details usd_active
                ON usd_active.user_id = c.student_id AND usd_active.status = 'active' AND usd_active.renew_date >= CURDATE()
            WHERE c.teacher_id = :teacher_id
              AND c.status = 'ended'
              AND (c.is_trial = 0 OR c.is_trial IS NULL)
            GROUP BY c.student_id, u.full_name, usd_active.id
            ORDER BY status ASC, end_date DESC
        `, {
            replacements: { teacher_id: teacherId },
            type: QueryTypes.SELECT,
        });

        // ---- Monthly trend (last 12 months) ----
        const monthlyTrend = await dashboardSequelize.query(`
            SELECT
                DATE_FORMAT(c.meeting_start, '%Y-%m') AS month,
                COUNT(DISTINCT c.student_id) AS active_students,
                COUNT(*) AS lessons_scheduled,
                SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) AS lessons_attended,
                ROUND(SUM(CASE WHEN c.is_present = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS attendance_rate,
                0 AS students_gained,
                0 AS students_lost
            FROM classes c
            WHERE c.teacher_id = :teacher_id
              AND c.status = 'ended'
              AND (c.is_trial = 0 OR c.is_trial IS NULL)
              AND c.meeting_start >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(c.meeting_start, '%Y-%m')
            ORDER BY month ASC
        `, {
            replacements: { teacher_id: teacherId },
            type: QueryTypes.SELECT,
        });

        // Parse all numeric fields
        const parsedTeacher = {
            ...teacher,
            active_students: parseInt(teacher.active_students) || 0,
            fixed_schedule_students: parseInt(teacher.fixed_schedule_students) || 0,
            total_lessons_scheduled: parseInt(teacher.total_lessons_scheduled) || 0,
            total_lessons_attended: parseInt(teacher.total_lessons_attended) || 0,
            attendance_rate: parseFloat(teacher.attendance_rate) || 0,
            no_shows: parseInt(teacher.no_shows) || 0,
            no_show_rate: parseFloat(teacher.no_show_rate) || 0,
            avg_student_lifetime_days: parseFloat(teacher.avg_student_lifetime_days) || 0,
            avg_student_lifetime_months: parseFloat(teacher.avg_student_lifetime_months) || 0,
            median_student_lifetime_days: parseFloat(teacher.median_student_lifetime_days) || 0,
            median_student_lifetime_months: parseFloat(teacher.median_student_lifetime_months) || 0,
            total_all_time_students: parseInt(teacher.total_all_time_students) || 0,
            students_left: parseInt(teacher.students_left) || 0,
            students_left_percentage: parseFloat(teacher.students_left_percentage) || 0,
            retention_score: parseFloat(teacher.retention_score) || 0,
        };

        return res.status(200).json({
            status: 'success',
            data: {
                ...parsedTeacher,
                student_history: studentHistory.map(s => ({
                    ...s,
                    student_id: parseInt(s.student_id),
                    lifetime_days: parseInt(s.lifetime_days) || 0,
                    lessons_attended: parseInt(s.lessons_attended) || 0,
                    lessons_scheduled: parseInt(s.lessons_scheduled) || 0,
                })),
                monthly_trend: monthlyTrend.map(m => ({
                    ...m,
                    active_students: parseInt(m.active_students) || 0,
                    lessons_scheduled: parseInt(m.lessons_scheduled) || 0,
                    lessons_attended: parseInt(m.lessons_attended) || 0,
                    attendance_rate: parseFloat(m.attendance_rate) || 0,
                    students_gained: parseInt(m.students_gained) || 0,
                    students_lost: parseInt(m.students_lost) || 0,
                })),
            },
            message: 'Teacher detail retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getTeacherDetail:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch teacher detail', error: error.message });
    }
}


/**
 * GET /comparison
 * Returns teacher comparison/ranking data for the Comparison tab.
 * Returns teachers ranked by retention, attendance, and active students.
 */
async function getTeacherComparison(req, res) {
    try {
        const {
            time_period,
            date_from,
            date_to,
            search,
        } = req.query;

        let dateFilter = '';
        const dateReplacements = {};
        const resolvedDates = resolveDateRange(time_period, date_from, date_to);
        if (resolvedDates) {
            dateFilter = 'AND c.meeting_start >= :date_from AND c.meeting_start <= :date_to';
            dateReplacements.date_from = resolvedDates.from;
            dateReplacements.date_to = resolvedDates.to;
        }

        let searchFilter = '';
        if (search) {
            searchFilter = 'AND (t.full_name LIKE :search OR t.email LIKE :search)';
            dateReplacements.search = `%${search}%`;
        }

        // Query 1.8: Full retention/comparison view
        const teachers = await dashboardSequelize.query(`
            SELECT
                t.id AS teacher_id,
                t.full_name AS teacher_name,
                t.email,
                COALESCE(total_ever.total_students_ever, 0) AS total_all_time_students,
                COALESCE(active_now.active_students, 0) AS active_students,
                COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0) AS students_left,
                ROUND(
                    COALESCE(active_now.active_students, 0) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS retention_score,
                ROUND(
                    (COALESCE(total_ever.total_students_ever, 0) - COALESCE(active_now.active_students, 0)) * 100.0
                    / NULLIF(COALESCE(total_ever.total_students_ever, 0), 0), 1
                ) AS students_left_percentage,
                COALESCE(att.attendance_rate, 0) AS attendance_rate,
                COALESCE(att.no_show_rate, 0) AS no_show_rate,
                COALESCE(att.total_scheduled_lessons, 0) AS total_lessons_scheduled,
                COALESCE(att.lessons_attended, 0) AS total_lessons_attended,
                COALESCE(att.no_show_count, 0) AS no_shows,
                COALESCE(fixed_sched.fixed_schedule_students, 0) AS fixed_schedule_students,
                COALESCE(lifetime.avg_lifetime_days, 0) AS avg_student_lifetime_days,
                ROUND(COALESCE(lifetime.avg_lifetime_days, 0) / 30.0, 1) AS avg_student_lifetime_months,
                COALESCE(median_lt.median_lifetime_days, 0) AS median_student_lifetime_days,
                ROUND(COALESCE(median_lt.median_lifetime_days, 0) / 30.0, 1) AS median_student_lifetime_months
            FROM users t
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS total_students_ever
                FROM classes WHERE status IN ('ended', 'pending', 'started') AND (is_trial = 0 OR is_trial IS NULL)
                GROUP BY teacher_id
            ) total_ever ON total_ever.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, COUNT(DISTINCT student_id) AS active_students FROM (
                    SELECT rc.teacher_id, rc.student_id FROM regular_class rc
                    INNER JOIN user_subscription_details usd ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    UNION
                    SELECT c.teacher_id, c.student_id FROM classes c
                    INNER JOIN user_subscription_details usd ON usd.user_id = c.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                    WHERE c.status IN ('pending', 'started') AND (c.is_trial = 0 OR c.is_trial IS NULL)
                ) sq GROUP BY teacher_id
            ) active_now ON active_now.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id,
                    COUNT(*) AS total_scheduled_lessons,
                    SUM(CASE WHEN is_present = 1 THEN 1 ELSE 0 END) AS lessons_attended,
                    SUM(CASE WHEN is_present = 0 THEN 1 ELSE 0 END) AS no_show_count,
                    ROUND(SUM(CASE WHEN is_present = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS attendance_rate,
                    ROUND(SUM(CASE WHEN is_present = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS no_show_rate
                FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                ${dateFilter}
                GROUP BY teacher_id
            ) att ON att.teacher_id = t.id
            LEFT JOIN (
                SELECT rc.teacher_id, COUNT(DISTINCT rc.student_id) AS fixed_schedule_students
                FROM regular_class rc
                INNER JOIN user_subscription_details usd ON usd.user_id = rc.student_id AND usd.status = 'active' AND usd.renew_date >= CURDATE()
                GROUP BY rc.teacher_id
            ) fixed_sched ON fixed_sched.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, ROUND(AVG(DATEDIFF(last_class, first_class)), 1) AS avg_lifetime_days
                FROM (
                    SELECT teacher_id, student_id, MIN(meeting_start) AS first_class, MAX(meeting_start) AS last_class
                    FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id, student_id
                ) sl GROUP BY teacher_id
            ) lifetime ON lifetime.teacher_id = t.id
            LEFT JOIN (
                SELECT teacher_id, ROUND(AVG(lifetime_days), 1) AS median_lifetime_days
                FROM (
                    SELECT teacher_id, DATEDIFF(MAX(meeting_start), MIN(meeting_start)) AS lifetime_days,
                        ROW_NUMBER() OVER (PARTITION BY teacher_id ORDER BY DATEDIFF(MAX(meeting_start), MIN(meeting_start))) AS rn,
                        COUNT(*) OVER (PARTITION BY teacher_id) AS total_students
                    FROM classes WHERE status = 'ended' AND (is_trial = 0 OR is_trial IS NULL)
                    GROUP BY teacher_id, student_id
                ) ranked WHERE rn IN (FLOOR((total_students + 1) / 2), CEIL((total_students + 1) / 2))
                GROUP BY teacher_id
            ) median_lt ON median_lt.teacher_id = t.id
            WHERE t.role_name = 'teacher' AND t.status = 'active'
            ${searchFilter}
            ORDER BY retention_score DESC
        `, {
            replacements: dateReplacements,
            type: QueryTypes.SELECT,
        });

        const parsed = teachers.map(t => ({
            teacher_id: parseInt(t.teacher_id),
            teacher_name: t.teacher_name,
            email: t.email,
            active_students: parseInt(t.active_students) || 0,
            fixed_schedule_students: parseInt(t.fixed_schedule_students) || 0,
            total_lessons_scheduled: parseInt(t.total_scheduled_lessons) || 0,
            total_lessons_attended: parseInt(t.total_lessons_attended) || 0,
            attendance_rate: parseFloat(t.attendance_rate) || 0,
            no_shows: parseInt(t.no_shows) || 0,
            no_show_rate: parseFloat(t.no_show_rate) || 0,
            avg_student_lifetime_days: parseFloat(t.avg_student_lifetime_days) || 0,
            avg_student_lifetime_months: parseFloat(t.avg_student_lifetime_months) || 0,
            median_student_lifetime_days: parseFloat(t.median_student_lifetime_days) || 0,
            median_student_lifetime_months: parseFloat(t.median_student_lifetime_months) || 0,
            total_all_time_students: parseInt(t.total_all_time_students) || 0,
            students_left: parseInt(t.students_left) || 0,
            students_left_percentage: parseFloat(t.students_left_percentage) || 0,
            retention_score: parseFloat(t.retention_score) || 0,
        }));

        // Pre-sort by each ranking criterion
        const rankedByRetention = [...parsed].sort((a, b) => b.retention_score - a.retention_score);
        const rankedByAttendance = [...parsed].sort((a, b) => b.attendance_rate - a.attendance_rate);
        const rankedByStudents = [...parsed].sort((a, b) => b.active_students - a.active_students);

        return res.status(200).json({
            status: 'success',
            data: {
                teachers: parsed,
                ranked_by_retention: rankedByRetention,
                ranked_by_attendance: rankedByAttendance,
                ranked_by_students: rankedByStudents,
            },
            message: 'Teacher comparison data retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getTeacherComparison:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch comparison data', error: error.message });
    }
}


/**
 * GET /teachers
 * Returns a simple list of active teachers for dropdown filters.
 */
async function getTeachersList(req, res) {
    try {
        const teachers = await dashboardSequelize.query(`
            SELECT id, full_name
            FROM users
            WHERE role_name = 'teacher' AND status = 'active'
            ORDER BY full_name
        `, { type: QueryTypes.SELECT });

        return res.status(200).json({
            status: 'success',
            data: teachers.map(t => ({ id: parseInt(t.id), full_name: t.full_name })),
            message: 'Teachers list retrieved successfully',
        });
    } catch (error) {
        console.error('Error in getTeachersList:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to fetch teachers list', error: error.message });
    }
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve date range from time_period or explicit date_from/date_to.
 * Returns { from, to } or null if no date filter.
 */
function resolveDateRange(time_period, date_from, date_to) {
    if (time_period && time_period !== 'custom') {
        const now = new Date();
        const to = now.toISOString().split('T')[0] + ' 23:59:59';
        let from;
        switch (time_period) {
            case '2weeks':
                from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
                break;
            case '1month':
                from = new Date(now);
                from.setMonth(from.getMonth() - 1);
                break;
            case '3months':
                from = new Date(now);
                from.setMonth(from.getMonth() - 3);
                break;
            default:
                return null;
        }
        return { from: from.toISOString().split('T')[0] + ' 00:00:00', to };
    }

    if (date_from && date_to) {
        return { from: date_from + ' 00:00:00', to: date_to + ' 23:59:59' };
    }

    return null;
}

/**
 * Sanitize sort column to prevent SQL injection.
 * Maps frontend column names to safe SQL expressions.
 */
function getSafeSortColumn(sort_by) {
    const allowedColumns = {
        'teacher_name': 't.full_name',
        'active_students': 'active_students',
        'fixed_schedule_students': 'fixed_schedule_students',
        'attendance_rate': 'attendance_rate',
        'no_show_rate': 'no_show_rate',
        'avg_student_lifetime_days': 'avg_student_lifetime_days',
        'median_student_lifetime_days': 'median_student_lifetime_days',
        'students_left': 'students_left',
        'students_left_percentage': 'students_left_percentage',
        'retention_score': 'retention_score',
        'total_lessons_scheduled': 'total_lessons_scheduled',
        'total_lessons_attended': 'total_lessons_attended',
        'total_all_time_students': 'total_all_time_students',
    };
    return allowedColumns[sort_by] || 'retention_score';
}


module.exports = {
    getTeacherPerformanceOverview,
    getTeacherDetail,
    getTeacherComparison,
    getTeachersList,
};
