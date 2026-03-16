// controller/admin/teacher-activity.controller.js
const User = require('../../models/users');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const { Op, Sequelize, literal, QueryTypes } = require('sequelize');
const moment = require('moment-timezone');
const { sequelize } = require('../../connection/connection');
const PaymentTransaction = require('../../models/PaymentTransaction');

/**
 * Get teacher activity data with enrollment/cancellation metrics
 */
async function getTeacherActivity(req, res) {
    try {
        const {
            period,
            startDate,
            endDate,
            status = 'all',
            subject,
            search,
            sortBy = 'newCancellations',
            sortOrder = 'desc',
            limit = 100,
            offset = 0
        } = req.query;

        // Calculate date range based on period
        let dateRange;
        let prevDateRange;
        
        // Handle period parameter
        if (period && period !== 'custom') {
            const now = new Date();
            const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            let start;
            
            switch (period) {
                case '7days':
                case '7d':
                    start = new Date(end);
                    start.setDate(start.getDate() - 6); 
                    start.setHours(0, 0, 0, 0);
                    break;
                case '30days':
                case '30d':
                    start = new Date(end);
                    start.setDate(start.getDate() - 29); 
                    start.setHours(0, 0, 0, 0);
                    break;
                case '90days':
                case '90d':
                    start = new Date(end);
                    start.setDate(start.getDate() - 89); 
                    start.setHours(0, 0, 0, 0);
                    break;
                case '6months':
                    start = new Date(end);
                    start.setMonth(start.getMonth() - 6);
                    start.setHours(0, 0, 0, 0);
                    break;
                default:
                    // Invalid period, ignore and check for custom dates
                    start = null;
            }
            
            if (start) {
                dateRange = { start, end };
                
                // Calculate previous period for comparison
                const periodDiff = end.getTime() - start.getTime();
                prevDateRange = {
                    start: new Date(start.getTime() - periodDiff),
                    end: start
                };
            }
        }
        
        // If period is 'custom' or not provided, use startDate/endDate
        if (!dateRange && startDate && endDate) {
            dateRange = {
                start: new Date(startDate),
                end: new Date(endDate)
            };
            
            // Previous period for comparison
            const periodDiff = dateRange.end.getTime() - dateRange.start.getTime();
            prevDateRange = {
                start: new Date(dateRange.start.getTime() - periodDiff),
                end: dateRange.start
            };
        }
        
        const hasDateFilter = !!dateRange;

        // Base where conditions for teachers
        const whereConditions = {
            role_name: 'teacher'
        };

        // Search conditions
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Get all teachers matching criteria
        const teachers = await User.findAll({
            where: whereConditions,
            attributes: ['id', 'full_name', 'email', 'avatar', 'status', 'subject', 'timezone'],
            order: [['full_name', 'ASC']]
        });

        const teacherIds = teachers.map(t => t.id);

        // Build replacements with conditional date filtering
        const replacements = { ids: teacherIds };
        if (hasDateFilter) {
            replacements.start_date = dateRange.start;
            replacements.end_date = dateRange.end;
            replacements.prev_start = prevDateRange.start;
            replacements.prev_end = prevDateRange.end;
        }

        // Date filter clause for queries
        const dateFilter = hasDateFilter ? 'AND updated_at BETWEEN :start_date AND :end_date' : '';
        const prevDateFilter = hasDateFilter ? 'AND updated_at BETWEEN :prev_start AND :prev_end' : '';

        // TOTAL (completed + converted) WITH OPTIONAL DATE FILTER
        const totalsRows = await sequelize.query(
            `
                SELECT teacher_id, COUNT(*) AS total
                FROM trial_class_registrations
                WHERE teacher_id IN (:ids)
                  AND status IN ('completed','converted')
                  ${dateFilter}
                GROUP BY teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        );

        // COMPLETED ONLY
        const completedRows = await sequelize.query(
            `
                SELECT teacher_id, COUNT(*) AS completed
                FROM trial_class_registrations
                WHERE teacher_id IN (:ids)
                  AND status = 'completed'
                  ${dateFilter}
                GROUP BY teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        );

        // CONVERTED ONLY
        const convertedRows = await sequelize.query(
            `
                SELECT teacher_id, COUNT(*) AS converted
                FROM trial_class_registrations
                WHERE teacher_id IN (:ids)
                  AND status = 'converted'
                  ${dateFilter}
                GROUP BY teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        );

        // CANCELLATIONS
        const cancellationsRows = await sequelize.query(
            `
                SELECT c.teacher_id, COUNT(DISTINCT usd.user_id) AS cancellations
                FROM user_subscription_details usd
                INNER JOIN classes c ON c.student_id = usd.user_id
                WHERE c.teacher_id IN (:ids)
                  AND usd.status = 'inactive'
                  ${dateFilter.replace('updated_at', 'usd.updated_at')}
                  AND usd.user_id NOT IN (
                      SELECT DISTINCT user_id FROM user_subscription_details WHERE status = 'active'
                  )
                GROUP BY c.teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        );

        // PREVIOUS PERIOD (converted) - only if date filter exists
        const prevConvertedRows = hasDateFilter ? await sequelize.query(
            `
                SELECT teacher_id, COUNT(*) AS converted
                FROM trial_class_registrations
                WHERE teacher_id IN (:ids)
                  AND status = 'converted'
                  ${prevDateFilter}
                GROUP BY teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        ) : [];

        // PREVIOUS PERIOD (cancellations) - only if date filter exists
        const prevCancellationsRows = hasDateFilter ? await sequelize.query(
            `
                SELECT c.teacher_id, COUNT(DISTINCT usd.user_id) AS cancellations
                FROM user_subscription_details usd
                INNER JOIN classes c ON c.student_id = usd.user_id
                WHERE c.teacher_id IN (:ids)
                  AND usd.status = 'inactive'
                  ${prevDateFilter.replace('updated_at', 'usd.updated_at')}
                  AND usd.user_id NOT IN (
                      SELECT DISTINCT user_id FROM user_subscription_details WHERE status = 'active'
                  )
                GROUP BY c.teacher_id
            `,
            { replacements, type: Sequelize.QueryTypes.SELECT }
        ) : [];

        // Mapping
        const totalsMap = Object.fromEntries(totalsRows.map(r => [r.teacher_id, +r.total]));
        const completedMap = Object.fromEntries(completedRows.map(r => [r.teacher_id, +r.completed]));
        const convertedMap = Object.fromEntries(convertedRows.map(r => [r.teacher_id, +r.converted]));
        const cancellationsMap = Object.fromEntries(cancellationsRows.map(r => [r.teacher_id, +r.cancellations]));
        const prevConvertedMap = Object.fromEntries(prevConvertedRows.map(r => [r.teacher_id, +r.converted]));
        const prevCancellationsMap = Object.fromEntries(prevCancellationsRows.map(r => [r.teacher_id, +r.cancellations]));

        // Build response
        const teacherActivityData = teachers.map(t => {
            const totalStudents = totalsMap[t.id] || 0;
            const completedTrials = completedMap[t.id] || 0;
            const newEnrollments = convertedMap[t.id] || 0;
            const newCancellations = cancellationsMap[t.id] || 0;
            const prevEnrollments = prevConvertedMap[t.id] || 0;
            const prevCancellations = prevCancellationsMap[t.id] || 0;

            const enrollmentChange =
                prevEnrollments > 0
                    ? Math.round(((newEnrollments - prevEnrollments) / prevEnrollments) * 100)
                    : newEnrollments > 0
                    ? 100
                    : 0;

            const cancellationChange =
                prevCancellations > 0
                    ? Math.round(((newCancellations - prevCancellations) / prevCancellations) * 100)
                    : newCancellations > 0
                    ? 100
                    : 0;
                    
            const actualCompletedTrials = completedTrials + newEnrollments;
            const conversionRate =
                actualCompletedTrials > 0
                    ? Math.round((newEnrollments / actualCompletedTrials) * 100)
                    : 0;

            return {
                id: t.id,
                name: t.full_name,
                email: t.email,
                avatar: t.avatar,
                status: t.status,
                subject: t.subject,
                timezone: t.timezone,
                totalStudents,
                completedTrials,
                newEnrollments,
                newCancellations,
                conversionRate,
                enrollmentChange,
                cancellationChange,
                netChange: newEnrollments - newCancellations
            };
        });

        // Sorting
        teacherActivityData.sort((a, b) => {
            let value = 0;
            switch (sortBy) {
                case "name": value = a.name.localeCompare(b.name); break;
                case "totalStudents": value = a.totalStudents - b.totalStudents; break;
                case "newEnrollments": value = a.newEnrollments - b.newEnrollments; break;
                case "newCancellations": value = a.newCancellations - b.newCancellations; break;
            }
            return sortOrder === "asc" ? value : -value;
        });

        const totalCount = teacherActivityData.length;
        const paginatedData = teacherActivityData.slice(
            Number(offset),
            Number(offset) + Number(limit)
        );

        const stats = {
            totalTeachers: totalCount,
            totalActiveStudents: teacherActivityData.reduce((sum, t) => sum + t.totalStudents, 0),
            totalCompletedTrials: teacherActivityData.reduce((sum, t) => sum + t.completedTrials, 0),
            totalNewEnrollments: teacherActivityData.reduce((sum, t) => sum + t.newEnrollments, 0),
            totalNewCancellations: teacherActivityData.reduce((sum, t) => sum + t.newCancellations, 0),
            netGrowth: teacherActivityData.reduce((sum, t) => sum + t.netChange, 0),
            averageStudentsPerTeacher: teacherActivityData.length > 0 ?
                Math.round(teacherActivityData.reduce((sum, t) => sum + t.totalStudents, 0) / teacherActivityData.length) : 0,
            topPerformersByEnrollment: teacherActivityData.filter(t => t.newEnrollments > 5).length,
            highestRiskByCancellation: teacherActivityData.filter(t => t.newCancellations > 3).length
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher activity data fetched successfully',
            data: {
                teachers: paginatedData,
                stats,
                period: period || null,
                dateRange: hasDateFilter ? {
                    start: dateRange.start.toISOString(),
                    end: dateRange.end.toISOString()
                } : null,
                total: totalCount,
                pagination: {
                    current_page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
                    per_page: parseInt(limit),
                    total: totalCount,
                    total_pages: Math.ceil(totalCount / parseInt(limit))
                }
            }
        });
    } catch (err) {
        console.error('Error fetching teacher activity:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher activity',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
/**
 * Export teacher activity data as CSV
 */
async function exportTeacherActivity(req, res) {
    try {
        const {
            period = '30days',
            startDate,
            endDate,
            status = 'all',
            search,
            sortBy = 'newCancellations',
            sortOrder = 'desc'
        } = req.query;

        // FIX: Proper mock response object
        const mockRes = {
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                return data;
            }
        };

        const mockReq = { query: { ...req.query, limit: 10000, offset: 0 } };

        // Call actual function
        const activityData = await getTeacherActivity(mockReq, mockRes);

        if (!activityData || activityData.status !== 'success') {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch data for export'
            });
        }

        // CSV data
        const teachers = activityData.data.teachers;
        const csvHeaders = [
            'Teacher Name',
            'Email',
            'Status',
            'Total Trial Classes',
            'Completed Trials',
            'Converted',
            'Cancelled',
            'Net Change',
            'Conversion Rate %',
            'Subject',
            'Timezone'
        ].join(',');

        const csvRows = teachers.map(t => [
            `"${t.name}"`,
            `"${t.email}"`,
            t.status,
            t.totalStudents,
            t.completedTrials,
            t.newEnrollments,
            t.newCancellations,
            t.netChange,
            t.conversionRate,
            `"${t.subject || ''}"`,
            `"${t.timezone || ''}"`,
        ].join(','));

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        const filename = `teacher-activity-${period}-${new Date().toISOString().split('T')[0]}.csv`;

        return res.status(200).json({
            status: 'success',
            message: 'Teacher activity exported successfully',
            data: {
                downloadUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`,
                filename
            }
        });

    } catch (err) {
        console.error('Error exporting teacher activity:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to export teacher activity',
            error: err.message
        });
    }
}


/**
 * Get live KPI metrics for teacher dashboard
 */
async function getTeacherDashboardKPIs(req, res) {
    try {
        const { period, startDate, endDate } = req.query;

        let dateRange;
        let actualPeriod = period;

        // Handle date range - prioritize explicit dates over period
        if (startDate && endDate) {
            // If both dates are provided, use them (regardless of period value)
            dateRange = {
                start: moment(startDate).startOf('day').toDate(),
                end: moment(endDate).endOf('day').toDate()
            };
            actualPeriod = 'custom';
        } else if (period === 'custom') {
            // If period is 'custom' but dates not provided, return error
            return res.status(400).json({
                status: 'error',
                message: 'startDate and endDate are required when period is "custom"'
            });
        } else {
            // Calculate dates based on period
            const end = moment().endOf('day').toDate();
            let start;
            
            switch (period) {
                case '7days':
                    start = moment().subtract(7, 'days').startOf('day').toDate();
                    break;
                case '30days':
                    start = moment().subtract(30, 'days').startOf('day').toDate();
                    break;
                case '90days':
                    start = moment().subtract(90, 'days').startOf('day').toDate();
                    break;
                case '6months':
                    start = moment().subtract(6, 'months').startOf('day').toDate();
                    break;
                default:
                    start = moment().subtract(30, 'days').startOf('day').toDate();
            }
            
            dateRange = { start, end };
        }

        console.log('KPI Period:', actualPeriod);
        console.log('KPI Using dateRange:', dateRange);
        console.log('KPI Start Date:', moment(dateRange.start).format('YYYY-MM-DD'));
        console.log('KPI End Date:', moment(dateRange.end).format('YYYY-MM-DD'));

        // Get total and active teachers
        const totalTeachers = await User.count({ where: { role_name: 'teacher' } });
        const activeTeachers = await User.count({
            where: { role_name: 'teacher', status: 'active' }
        });

        // Get total active students (last 30 days always)
        const totalActiveStudents = await Class.count({
            where: {
                meeting_start: { [Op.gte]: moment().subtract(30, 'days').toDate() },
                status: { [Op.in]: ['pending', 'completed', 'scheduled'] }
            },
            distinct: true,
            col: 'student_id'
        });

        // New enrollments
        const newEnrollmentsQuery = await sequelize.query(
            `
            SELECT COUNT(*) as count
            FROM trial_class_registrations
            WHERE status = 'converted' 
            AND DATE(updated_at) BETWEEN :start_date AND :end_date
            `,
            { 
                replacements: { 
                    start_date: moment(dateRange.start).format('YYYY-MM-DD'),
                    end_date: moment(dateRange.end).format('YYYY-MM-DD')
                }, 
                type: QueryTypes.SELECT 
            }
        );
        const newEnrollments = parseInt(newEnrollmentsQuery[0].count);

        // New cancellations - COUNT DUPLICATES (teacher-student relationships)
        const newCancellationsQuery = await sequelize.query(
            `
            SELECT COUNT(*) as count
            FROM (
                SELECT 
                    usd.user_id,
                    c.teacher_id,
                    usd.updated_at,
                    usd.status,
                    usd.inactive_after_renew,
                    usd.created_at,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at ASC) as rn_first,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn_latest
                FROM user_subscription_details usd
                INNER JOIN users u ON usd.user_id = u.id  
                INNER JOIN classes c ON u.id = c.student_id
            ) ranked_subscriptions
            WHERE rn_first = 1 
            AND (
                (status = 'inactive' AND DATE(updated_at) BETWEEN :start_date AND :end_date)
                OR 
                (status = 'active' AND inactive_after_renew = 1 AND DATE(updated_at) BETWEEN :start_date AND :end_date)
            )
            AND user_id NOT IN (
                SELECT DISTINCT user_id 
                FROM user_subscription_details 
                WHERE status = 'active' AND inactive_after_renew != 1
            )
            AND user_id IN (
                SELECT user_id
                FROM (
                    SELECT 
                        user_id,
                        status,
                        inactive_after_renew,
                        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                    FROM user_subscription_details
                ) latest_subs
                WHERE rn = 1 
                AND (
                    status = 'inactive' 
                    OR (status = 'active' AND inactive_after_renew = 1)
                )
            )
            `,
            { 
                replacements: { 
                    start_date: moment(dateRange.start).format('YYYY-MM-DD'),
                    end_date: moment(dateRange.end).format('YYYY-MM-DD')
                }, 
                type: QueryTypes.SELECT 
            }
        );
        const newCancellations = parseInt(newCancellationsQuery[0].count);

        console.log('KPI New Cancellations:', newCancellations);

        // Growth calculation
        let growthPercentage = 0;
        const periodDiff = dateRange.end.getTime() - dateRange.start.getTime();
        const prevStart = new Date(dateRange.start.getTime() - periodDiff);

        const prevEnrollmentsQuery = await sequelize.query(
            `
            SELECT COUNT(*) as count
            FROM trial_class_registrations
            WHERE status = 'converted'
            AND DATE(updated_at) BETWEEN :prev_start AND :start_date
            `,
            { 
                replacements: { 
                    prev_start: moment(prevStart).format('YYYY-MM-DD'),
                    start_date: moment(dateRange.start).format('YYYY-MM-DD')
                }, 
                type: QueryTypes.SELECT 
            }
        );

        const prevEnrollments = parseInt(prevEnrollmentsQuery[0].count);
        growthPercentage = prevEnrollments > 0
            ? ((newEnrollments - prevEnrollments) / prevEnrollments) * 100
            : newEnrollments > 0 ? 100 : 0;

        // Retention rate
        const retentionRate = await calculateRetentionRate(dateRange.start, dateRange.end);

        // Build KPI data
        const kpiData = {
            totalTeachers,
            activeTeachers,
            totalActiveStudents,
            newEnrollments,
            newCancellations,
            netGrowth: newEnrollments - newCancellations,
            averageStudentsPerTeacher: activeTeachers > 0 
                ? Math.round(totalActiveStudents / activeTeachers) 
                : 0,
            growthPercentage: Math.round(growthPercentage),
            retentionRate: Math.round(retentionRate),
            period: actualPeriod,
            dateRange: {
                start: moment(dateRange.start).format('YYYY-MM-DD'),
                end: moment(dateRange.end).format('YYYY-MM-DD')
            }
        };

        return res.status(200).json({
            status: 'success',
            message: 'Dashboard KPIs fetched successfully',
            data: kpiData
        });
    } catch (err) {
        console.error('Error fetching dashboard KPIs:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch dashboard KPIs',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
/**
 * Get detailed lists for Trial Class Activity (converted and cancellations) per teacher
 */
async function getTeacherActivityDetails(req, res) {
    try {
        const { teacherId, startDate, endDate } = req.query;

        if (!teacherId) {
            return res.status(400).json({ status: 'error', message: 'teacherId is required' });
        }

        // Validate teacher
        const teacher = await User.findOne({ 
            where: { id: teacherId, role_name: 'teacher' }, 
            attributes: ['id', 'full_name'] 
        });
        
        if (!teacher) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found' });
        }

        // Build date filter - if dates provided, use them; otherwise no date filter (all time)
        let dateFilter = '';
        let convertedReplacements = { teacher_id: teacher.id };
        let cancellationWhere = { status: 'inactive' };
        
        if (startDate && endDate) {
            dateFilter = 'AND tcr.updated_at BETWEEN :start_date AND :end_date';
            convertedReplacements.start_date = startDate;
            convertedReplacements.end_date = endDate;
            cancellationWhere.updated_at = { [Op.between]: [startDate, endDate] };
        }

        // Converted trial students (newEnrollments)
        const convertedRows = await sequelize.query(`
            SELECT DISTINCT u.id, u.full_name AS name, u.email
            FROM users u
            INNER JOIN trial_class_registrations tcr ON u.trial_user_id = tcr.id
            WHERE tcr.teacher_id = :teacher_id
              AND tcr.status = 'converted'
              ${dateFilter}
            ORDER BY u.full_name ASC
        `, {
            replacements: convertedReplacements,
            type: QueryTypes.SELECT
        });
        const newEnrollments = convertedRows.map(r => ({ id: r.id, name: r.name, email: r.email }));

        // True cancellations list
        const latestInactive = await UserSubscriptionDetails.findAll({
            where: cancellationWhere,
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    required: true,
                    include: [
                        { 
                            model: Class, 
                            as: 'StudentClasses', 
                            required: true, 
                            where: { teacher_id: teacher.id }, 
                            attributes: ['id'] 
                        }
                    ],
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            order: [['user_id', 'ASC'], ['updated_at', 'DESC']],
            attributes: ['user_id', 'updated_at', 'id']
        });

        // Latest per user
        const latestByUser = {};
        latestInactive.forEach(rec => {
            const userId = rec.user_id;
            if (!latestByUser[userId] || new Date(rec.updated_at) > new Date(latestByUser[userId].updated_at)) {
                latestByUser[userId] = rec;
            }
        });

        // Filter to users with no active subscription
        const cancellations = [];
        for (const userId of Object.keys(latestByUser)) {
            const hasActive = await UserSubscriptionDetails.count({ 
                where: { user_id: userId, status: 'active' } 
            });
            if (hasActive === 0) {
                const u = latestByUser[userId].SubscriptionUser;
                if (u) {
                    cancellations.push({ 
                        id: u.id, 
                        name: u.full_name, 
                        email: u.email 
                    });
                }
            }
        }

        return res.status(200).json({
            status: 'success',
            message: 'Teacher trial activity details fetched successfully',
            data: {
                teacherId: teacher.id,
                teacherName: teacher.full_name,
                startDate: startDate || null,
                endDate: endDate || null,
                newEnrollments,
                cancellations
            }
        });
    } catch (err) {
        console.error('Error fetching teacher trial activity details:', err);
        return res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch teacher trial activity details', 
            error: process.env.NODE_ENV === 'development' ? err.message : undefined 
        });
    }
}

/**
 * Helper function to calculate retention rate
 */
async function calculateRetentionRate(startDate, endDate) {
    try {
        // Get students who had classes before the period
        const prevStudents = await Class.findAll({
            where: {
                meeting_start: { [Op.lt]: startDate },
                status: { [Op.in]: ['completed', 'ended'] }
            },
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('student_id')), 'student_id']],
            raw: true
        });

        if (prevStudents.length === 0) return 0;

        const prevStudentIds = prevStudents.map(s => s.student_id).filter(id => id);

        // Count how many of these students had classes in the current period
        const continuingStudents = await Class.count({
            where: {
                student_id: { [Op.in]: prevStudentIds },
                meeting_start: { [Op.between]: [startDate, endDate] },
                status: { [Op.in]: ['completed', 'pending', 'scheduled'] }
            },
            distinct: true,
            col: 'student_id'
        });

        return prevStudentIds.length > 0 ? 
            (continuingStudents / prevStudentIds.length * 100) : 0;

    } catch (error) {
        console.error('Error calculating retention rate:', error);
        return 0;
    }
}

async function getMonthlyPerformanceTrends(req, res) {
    try {
        const { months = 6 } = req.query;
        
        const periodsBack = parseInt(months) || 6;
        const dateConditions = {
            created_at: { 
                [Op.gte]: moment().subtract(periodsBack, 'months').startOf('month').toDate() 
            }
        };
        
        const groupByFormat = '%Y-%m';
        
        // 1. Get total revenue by month
        const revenueByMonth = await PaymentTransaction.findAll({
            where: {
                status: 'success',
                ...dateConditions
            },
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), groupByFormat), 'month'],
                [Sequelize.fn('SUM', Sequelize.col('amount')), 'totalRevenue']
            ],
            group: ['month'],
            raw: true
        });
        
        // 2. Get total classes by month
        const classesByMonth = await Class.findAll({
            where: dateConditions,
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), groupByFormat), 'month'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'totalClasses']
            ],
            group: ['month'],
            raw: true
        });
        
        // 3. Get count of active teachers who taught in each month
        const teachersByMonth = await Class.findAll({
            where: dateConditions,
            include: [{
                model: User,
                as: 'Teacher',
                where: { 
                    role_name: 'teacher', 
                    status: 'active' 
                },
                attributes: []
            }],
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('Class.created_at'), groupByFormat), 'month'],
                [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('teacher_id'))), 'activeTeachers']
            ],
            group: ['month'],
            raw: true
        });
        
        // Combine all data
        const performanceMap = {};
        
        // Initialize with revenue data
        revenueByMonth.forEach(item => {
            performanceMap[item.month] = {
                month: item.month,
                totalRevenue: parseFloat(item.totalRevenue) || 0,
                totalClasses: 0,
                activeTeachers: 0
            };
        });
        
        // Add classes data
        classesByMonth.forEach(item => {
            if (!performanceMap[item.month]) {
                performanceMap[item.month] = {
                    month: item.month,
                    totalRevenue: 0,
                    totalClasses: 0,
                    activeTeachers: 0
                };
            }
            performanceMap[item.month].totalClasses = parseInt(item.totalClasses) || 0;
        });
        
        // Add teachers data
        teachersByMonth.forEach(item => {
            if (!performanceMap[item.month]) {
                performanceMap[item.month] = {
                    month: item.month,
                    totalRevenue: 0,
                    totalClasses: 0,
                    activeTeachers: 0
                };
            }
            performanceMap[item.month].activeTeachers = parseInt(item.activeTeachers) || 0;
        });
        
        // Calculate averages and format output
        const chartData = Object.values(performanceMap)
            .map(item => {
                const teachers = item.activeTeachers || 1; // Avoid division by zero
                const [year, month] = item.month.split('-');
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                
                return {
                    month: monthNames[parseInt(month) - 1],
                    Avg_lessons: Math.round(item.totalClasses / teachers),
                    Avg_revenue: Math.round(item.totalRevenue / teachers)
                };
            })
            .sort((a, b) => {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return monthNames.indexOf(a.month) - monthNames.indexOf(b.month);
            });
        
        return res.status(200).json({
            status: 'success',
            message: 'Monthly performance trends fetched successfully',
            data: chartData
        });
        
    } catch (err) {
        console.error('Error fetching monthly performance trends:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch monthly performance trends',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
module.exports = {
    getTeacherActivity,
    exportTeacherActivity,
    getTeacherDashboardKPIs,
    getTeacherActivityDetails,
    getMonthlyPerformanceTrends
};