// controller/admin/regular-class-activity.controller.js
const User = require('../../models/users');
const RegularClass = require('../../models/regularClass');
const Class = require('../../models/classes');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const { Op, Sequelize, QueryTypes } = require('sequelize');
const moment = require('moment-timezone');
const { sequelize } = require('../../connection/connection');
/**
 * Get teacher-student relationships with enrollment/cancellation tracking
 */

async function getRegularClassActivity(req, res) {
    try {
        const {
            period = '30days',
            startDate,
            endDate,
            status = 'all',
            subject,
            search,
            sortBy = 'totalStudents',
            sortOrder = 'desc',
            limit = 100,
            offset = 0
        } = req.query;

        let dateRange;

        // Handle date range based on period
        if (period === 'custom') {
            if (!startDate || !endDate) {
                return res.status(400).json({
                    status: 'error',
                    message: 'startDate and endDate are required when period is "custom"'
                });
            }
            dateRange = {
                start: moment(startDate).startOf('day').toDate(),
                end: moment(endDate).endOf('day').toDate()
            };
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

        // Subject filter
        if (subject) {
            whereConditions.subject = { [Op.like]: `%${subject}%` };
        }

        // Get all teachers matching criteria
        const teachers = await User.findAll({
            where: whereConditions,
            attributes: ['id', 'full_name', 'email', 'avatar', 'status', 'subject', 'timezone'],
            order: [['full_name', 'ASC']]
        });

        // Process each teacher to get student metrics
        const teacherStudentData = await Promise.all(
            teachers.map(async (teacher) => {
                // Get current active students assigned to this teacher
                const activeStudents = await User.count({
                    include: [
                        {
                            model: RegularClass,
                            as: 'StudentRegularClasses',
                            required: true,
                            where: {
                                teacher_id: teacher.id
                            }
                        },
                        {
                            model: UserSubscriptionDetails,
                            as: 'UserSubscriptions',
                            required: true,
                            where: {
                                status: 'active'
                            }
                        }
                    ],
                    distinct: true
                });

                // Get new enrollments
                const newEnrollmentsQuery = await sequelize.query(`
                    SELECT COUNT(*) as count
                    FROM (
                        SELECT 
                            usd.user_id,
                            usd.created_at,
                            usd.status,
                            ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at ASC) as rn
                        FROM user_subscription_details usd
                        INNER JOIN users u ON usd.user_id = u.id  
                        INNER JOIN regular_class rc ON u.id = rc.student_id  
                        WHERE rc.teacher_id = :teacher_id
                    ) ranked_subscriptions
                    WHERE rn = 1 
                    AND status = 'active' 
                    AND DATE(created_at) BETWEEN :start_date AND :end_date
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
                        AND status = 'active' 
                        AND (inactive_after_renew IS NULL OR inactive_after_renew != 1)
                    )
                `, {
                    replacements: {
                        teacher_id: teacher.id,
                        start_date: moment(dateRange.start).format('YYYY-MM-DD'),
                        end_date: moment(dateRange.end).format('YYYY-MM-DD')
                    },
                    type: QueryTypes.SELECT
                });

                const newEnrollments = parseInt(newEnrollmentsQuery[0].count);

                // Get new cancellations
                const newCancellationsQuery = await sequelize.query(`
                    SELECT COUNT(*) as count
                    FROM (
                        SELECT 
                            usd.user_id,
                            usd.updated_at,
                            usd.status,
                            usd.inactive_after_renew,
                            usd.created_at,
                            ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at ASC) as rn_first,
                            ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at DESC) as rn_latest
                        FROM user_subscription_details usd
                        INNER JOIN users u ON usd.user_id = u.id  
                        INNER JOIN classes c ON u.id = c.student_id  
                        WHERE c.teacher_id = :teacher_id
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
                `, {
                    replacements: {
                        teacher_id: teacher.id,
                        start_date: moment(dateRange.start).format('YYYY-MM-DD'),
                        end_date: moment(dateRange.end).format('YYYY-MM-DD')
                    },
                    type: QueryTypes.SELECT
                });

                const newCancellations = parseInt(newCancellationsQuery[0].count);

                // Calculate cancellation percentage
                const cancellationPercentage = (activeStudents + newCancellations) > 0 
                    ? ((newCancellations / (activeStudents + newCancellations)) * 100).toFixed(2)
                    : '0.00';

                return {
                    id: teacher.id,
                    name: teacher.full_name,
                    email: teacher.email,
                    avatar: teacher.avatar,
                    status: teacher.status,
                    totalStudents: activeStudents,
                    newEnrollments,
                    newCancellations,
                    cancellationPercentage: parseFloat(cancellationPercentage),
                    subject: teacher.subject,
                    timezone: teacher.timezone
                };
            })
        );

        // Sort the results
        teacherStudentData.sort((a, b) => {
            let compareValue = 0;
            switch (sortBy) {
                case 'name':
                    compareValue = a.name.localeCompare(b.name);
                    break;
                case 'totalStudents':
                    compareValue = a.totalStudents - b.totalStudents;
                    break;
                case 'newEnrollments':
                    compareValue = a.newEnrollments - b.newEnrollments;
                    break;
                case 'newCancellations':
                    compareValue = a.newCancellations - b.newCancellations;
                    break;
                case 'cancellationPercentage':
                    compareValue = a.cancellationPercentage - b.cancellationPercentage;
                    break;
                default:
                    compareValue = a.totalStudents - b.totalStudents;
            }
            return sortOrder === 'asc' ? compareValue : -compareValue;
        });

        // Apply pagination
        const totalCount = teacherStudentData.length;
        const paginatedData = teacherStudentData.slice(
            parseInt(offset), 
            parseInt(offset) + parseInt(limit)
        );

        // Calculate summary stats
        const stats = {
            totalTeachers: teacherStudentData.length,
            totalActiveStudents: teacherStudentData.reduce((sum, t) => sum + t.totalStudents, 0),
            totalNewEnrollments: teacherStudentData.reduce((sum, t) => sum + t.newEnrollments, 0),
            totalNewCancellations: teacherStudentData.reduce((sum, t) => sum + t.newCancellations, 0)
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher enrollment data fetched successfully',
            data: {
                teachers: paginatedData,
                stats,
                period,
                dateRange: {
                    start: moment(dateRange.start).format('YYYY-MM-DD'),
                    end: moment(dateRange.end).format('YYYY-MM-DD')
                },
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
        console.error('Error fetching teacher enrollment data:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher enrollment data',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
/**
 * Export teacher-student data as CSV
 */
async function exportRegularClassActivity(req, res) {
    try {
        const {
            period = '30days',
            startDate,
            endDate,
            status = 'all',
            subject,
            search,
            sortBy = 'totalStudents',
            sortOrder = 'desc'
        } = req.query;

        // Create a mock request to get all data without pagination
        const mockReq = {
            query: {
                ...req.query,
                limit: 10000,
                offset: 0
            }
        };

        // Use a promise to handle the async response
        const result = await new Promise((resolve, reject) => {
            const mockRes = {
                status: (code) => ({
                    json: (data) => {
                        if (code === 200) {
                            resolve(data);
                        } else {
                            reject(new Error(data.message || 'Failed to fetch data'));
                        }
                    }
                })
            };

            getRegularClassActivity(mockReq, mockRes);
        });

        if (!result || result.status !== 'success') {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch data for export'
            });
        }

        // Create CSV content
        const teachers = result.data.teachers;
        const csvHeaders = [
            'Teacher Name',
            'Email',
            'Status',
            'Total Students',
            'New Enrollments',
            'New Cancellations',
            'Cancellation %',
            'Subject',
            'Timezone'
        ].join(',');

        const csvRows = teachers.map(teacher => [
            `"${teacher.name}"`,
            `"${teacher.email}"`,
            teacher.status,
            teacher.totalStudents,
            teacher.newEnrollments,
            teacher.newCancellations,
            teacher.cancellationPercentage || 0,
            `"${teacher.subject || ''}"`,
            `"${teacher.timezone || ''}"`
        ].join(','));

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        // Create data URL for download
        const filename = `teacher-student-data-${period}-${new Date().toISOString().split('T')[0]}.csv`;

        return res.status(200).json({
            status: 'success',
            message: 'Teacher-student data exported successfully',
            data: {
                downloadUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`,
                filename
            }
        });

    } catch (err) {
        console.error('Error exporting teacher-student data:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to export teacher-student data',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get dashboard KPI metrics for teacher-student relationships
 */
async function getRegularClassDashboardKPIs(req, res) {
    try {
        const { period = '30days' } = req.query;

        // Get total teachers
        const totalTeachers = await User.count({
            where: { role_name: 'teacher' }
        });

        const activeTeachers = await User.count({
            where: {
                role_name: 'teacher',
                status: 'active'
            }
        });

        // Get total students with regular classes
        const totalStudentsWithRegularClasses = await User.count({
            include: [
                {
                    model: RegularClass,
                    as: 'StudentRegularClasses',
                    required: true
                }
            ],
            distinct: true
        });

        // Get subscription counts for all students with regular classes
        const studentsWithRegularClasses = await User.findAll({
            attributes: ['id'],
            include: [
                {
                    model: RegularClass,
                    as: 'StudentRegularClasses',
                    required: true,
                    attributes: ['id']
                }
            ]
        });

        const studentIds = studentsWithRegularClasses.map(student => student.id);

        const totalActiveSubscriptions = await UserSubscriptionDetails.count({
            where: {
                user_id: { [Op.in]: studentIds },
                status: 'active'
            }
        });

        const totalInactiveSubscriptions = await UserSubscriptionDetails.count({
            where: {
                user_id: { [Op.in]: studentIds },
                status: { [Op.ne]: 'active' }
            }
        });

        // Calculate rates
        const subscriptionRate = totalStudentsWithRegularClasses > 0 ?
            (totalActiveSubscriptions / totalStudentsWithRegularClasses * 100) : 0;

        const averageStudentsPerTeacher = activeTeachers > 0 ?
            Math.round(totalStudentsWithRegularClasses / activeTeachers) : 0;

        const kpiData = {
            totalTeachers,
            activeTeachers,
            totalStudentsWithRegularClasses,
            totalActiveSubscriptions,
            totalInactiveSubscriptions,
            subscriptionRate: Math.round(subscriptionRate * 10) / 10,
            averageStudentsPerTeacher,
            period
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher-student dashboard KPIs fetched successfully',
            data: kpiData
        });

    } catch (err) {
        console.error('Error fetching teacher-student dashboard KPIs:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher-student dashboard KPIs',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get detailed students lists (new enrollments and cancellations) for a teacher
 * Query params: teacherId (required), period | startDate & endDate
 */
async function getRegularClassActivityDetails(req, res) {
    try {
        const { teacherId, period = '30days', startDate, endDate } = req.query;

        if (!teacherId) {
            return res.status(400).json({
                status: 'error',
                message: 'teacherId is required'
            });
        }

        // Compute date range (date-only)
        let dateRange;
        if (period === 'custom' && startDate && endDate) {
            dateRange = {
                start: moment(startDate).format('YYYY-MM-DD'),
                end: moment(endDate).format('YYYY-MM-DD')
            };
        } else {
            const endD = moment().format('YYYY-MM-DD');
            let startD;
            switch (period) {
                case '7days':
                    startD = moment().subtract(7, 'days').format('YYYY-MM-DD');
                    break;
                case '30days':
                    startD = moment().subtract(30, 'days').format('YYYY-MM-DD');
                    break;
                case '90days':
                    startD = moment().subtract(90, 'days').format('YYYY-MM-DD');
                    break;
                case '6months':
                default:
                    startD = moment().subtract(6, 'months').format('YYYY-MM-DD');
                    break;
            }
            dateRange = { start: startD, end: endD };
        }

        // Validate teacher exists and get name
        const teacher = await User.findOne({
            where: { id: teacherId, role_name: 'teacher' },
            attributes: ['id', 'full_name']
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // New enrollments list: students whose FIRST subscription became active in range and are linked to teacher
        // Only include if their LATEST subscription is also active (not inactive)
        const newEnrollmentsList = await sequelize.query(`
            SELECT DISTINCT u.id, u.full_name AS name, u.email
            FROM (
                SELECT 
                    usd.user_id,
                    usd.created_at,
                    usd.status,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at ASC) as rn
                FROM user_subscription_details usd
                INNER JOIN users u2 ON usd.user_id = u2.id
                INNER JOIN regular_class rc2 ON u2.id = rc2.student_id
                WHERE rc2.teacher_id = :teacher_id
            ) ranked
            INNER JOIN users u ON u.id = ranked.user_id
            WHERE ranked.rn = 1 
              AND ranked.status = 'active'
              AND DATE(ranked.created_at) BETWEEN :start_date AND :end_date
              AND ranked.user_id IN (
                -- Only include users whose LATEST subscription is active
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
                AND status = 'active' 
                AND (inactive_after_renew IS NULL OR inactive_after_renew != 1)
              )
            ORDER BY u.full_name ASC
        `, {
            replacements: {
                teacher_id: teacher.id,
                start_date: dateRange.start,
                end_date: dateRange.end
            },
            type: QueryTypes.SELECT
        });

        // Cancellations list: students whose FIRST subscription considered lost in range
        const cancellationsList = await sequelize.query(`
            SELECT DISTINCT u.id, u.full_name AS name, u.email
            FROM (
                SELECT 
                    usd.user_id,
                    usd.updated_at,
                    usd.status,
                    usd.inactive_after_renew,
                    usd.created_at,
                    ROW_NUMBER() OVER (PARTITION BY usd.user_id ORDER BY usd.created_at ASC) as rn_first
                FROM user_subscription_details usd
                INNER JOIN users u2 ON usd.user_id = u2.id
                INNER JOIN classes c2 ON u2.id = c2.student_id
                WHERE c2.teacher_id = :teacher_id
            ) ranked
            INNER JOIN users u ON u.id = ranked.user_id
            WHERE ranked.rn_first = 1
              AND (
                (ranked.status = 'inactive' AND DATE(ranked.updated_at) BETWEEN :start_date AND :end_date)
                OR (ranked.status = 'active' AND ranked.inactive_after_renew = 1 AND DATE(ranked.updated_at) BETWEEN :start_date AND :end_date)
              )
              AND ranked.user_id NOT IN (
                SELECT DISTINCT user_id 
                FROM user_subscription_details 
                WHERE status = 'active' AND inactive_after_renew != 1
              )
              AND ranked.user_id IN (
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
            ORDER BY u.full_name ASC
        `, {
            replacements: {
                teacher_id: teacher.id,
                start_date: dateRange.start,
                end_date: dateRange.end
            },
            type: QueryTypes.SELECT
        });

        return res.status(200).json({
            status: 'success',
            message: 'Teacher activity details fetched successfully',
            data: {
                teacherId: teacher.id,
                teacherName: teacher.full_name,
                period,
                dateRange,
                newEnrollments: newEnrollmentsList.map(s => ({ id: s.id, name: s.name, email: s.email })),
                cancellations: cancellationsList.map(s => ({ id: s.id, name: s.name, email: s.email }))
            }
        });
    } catch (err) {
        console.error('Error fetching teacher activity details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher activity details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

module.exports = {
    getRegularClassActivity,
    exportRegularClassActivity,
    getRegularClassDashboardKPIs,
    getRegularClassActivityDetails
};