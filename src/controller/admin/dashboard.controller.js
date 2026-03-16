const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PaymentTransaction = require('../../models/PaymentTransaction');
const Class = require('../../models/classes');
const SubscriptionPlan = require('../../models/subscription_plan');
const Salesperson = require('../../models/Salesperson');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const CohortRetention = require("../../models/CohortRetention");
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');

// 🧠 Get all teachers (role_name = 'teacher')
const getAllTeachers = async (req, res) => {
    try {
        const teachers = await User.findAll({
            where: { role_name: 'teacher' },
            attributes: ['id', 'full_name'],
            order: [['full_name', 'ASC']],
            raw: true
        });

        return res.status(200).json({
            status: 'success',
            data: teachers
        });
    } catch (error) {
        console.error('Error fetching teachers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teachers'
        });
    }
};

// 🧭 Controller to fetch available payment sources
const getPaymentSources = async (req, res) => {
    try {
        // Get all distinct payment methods from PaymentTransaction
        const methods = await PaymentTransaction.findAll({
            attributes: [[PaymentTransaction.sequelize.fn('DISTINCT', PaymentTransaction.sequelize.col('payment_method')), 'payment_method']],
            raw: true
        });

        // Extract only valid method names
        const allMethods = methods.map((m) => m.payment_method).filter(Boolean);

        // Categorize payment sources
        const hasOffline = allMethods.includes('offline');
        const inSystemMethods = allMethods.filter((m) => m !== 'offline');

        // Build frontend-friendly options
        const paymentSources = [
            { label: 'All Customers', value: 'all' },
            {
                label: 'In-System Payments',
                value: 'in_system',
                methods: inSystemMethods.length > 0 ? inSystemMethods : ['online']
            },
            {
                label: 'Off-System Payments',
                value: 'off_system',
                methods: hasOffline ? ['offline'] : []
            }
        ];

        return res.status(200).json({
            status: 'success',
            data: paymentSources
        });
    } catch (error) {
        console.error('Error fetching payment sources:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment sources',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

async function getDashboardMetrics(req, res) {
    try {
        const currentUser = req.user;
        const { start_date, end_date, payment_source, teacher_id } = req.query;

        console.log('query', req.query);

        // ⭐ ADDED FOR TEACHER FILTER — fetch students first
        let studentIds = [];
        if (teacher_id) {
            const students = await Class.findAll({
                where: { teacher_id },
                attributes: ['student_id'],
                group: ['student_id'],
                raw: true
            });
            studentIds = students.map((s) => s.student_id);
        }

        // ✅ Always handle in UTC for global consistency
        const startDate = start_date ? moment.utc(start_date).startOf('day').toDate() : moment.utc().startOf('month').toDate();

        const endDate = end_date ? moment.utc(end_date).endOf('day').toDate() : moment.utc().endOf('month').toDate();

        // 🔍 Payment source filter
        const paymentWhere = { status: 'success' };
        if (payment_source === 'off_system') {
            paymentWhere.payment_method = 'offline';
        } else if (payment_source === 'in_system') {
            paymentWhere.payment_method = { [Op.ne]: 'offline' };
        }

        // 🔐 Check permissions
        const permissions = await getUserDashboardPermissions(currentUser.id, currentUser.role_name);

        const metrics = {};

        // ✅ 1. Total Users
        if (permissions.totalUsers) {
            const userWhere = {
                role_name: 'user',
                deleted_at: null
            };

            const totalUsers = await User.count({ where: userWhere });

            metrics.totalUsers = {
                value: totalUsers,
                change: `Total Users`
            };
        }

        // ✅ 2. Total Sales (payment source + date filter)
        if (permissions.totalSales) {
            // ✅ Current month range
            const currentRange = { [Op.between]: [startDate, endDate] };

            // 🔍 Base payment filter
            const paymentWhere = {};
            if (payment_source === 'off_system') {
                paymentWhere.payment_method = { [Op.ne]: 'unknown' };
            } else if (payment_source === 'in_system') {
                paymentWhere.payment_method = 'unknown';
            }

            // ⭐ ADDED FOR TEACHER FILTER
            if (teacher_id && teacher_id !== 'all') {
                paymentWhere.student_id = studentIds.length ? studentIds : [-1]; // will return empty
            }

            // 💰 Current month transactions (success + refunded)
            const currentTransactions = await PaymentTransaction.findAll({
                where: {
                    ...paymentWhere,
                    status: { [Op.in]: ['success', 'refunded'] },
                    created_at: currentRange
                },
                attributes: ['status', 'amount', 'refund_amount'],
                raw: true
            });

            const currentSales = currentTransactions.reduce((sum, tx) => {
                const amount = parseFloat(tx.amount) || 0;
                const refund = tx.status === 'refunded' ? parseFloat(tx.refund_amount || 0) : 0;
                return sum + (amount - refund);
            }, 0);

            // 💰 Total sales (all time, success + refunded)
            const allTransactions = await PaymentTransaction.findAll({
                where: {
                    ...paymentWhere,
                    status: { [Op.in]: ['success', 'refunded'] }
                },
                attributes: ['status', 'amount', 'refund_amount'],
                raw: true
            });

            const totalSales = allTransactions.reduce((sum, tx) => {
                const amount = parseFloat(tx.amount) || 0;
                const refund = tx.status === 'refunded' ? parseFloat(tx.refund_amount || 0) : 0;
                return sum + (amount - refund);
            }, 0);

            // 📊 Growth % = contribution of this month to total
            const growthPercent = totalSales > 0 ? ((currentSales / totalSales) * 100).toFixed(1) : '0.0';

            metrics.totalSales = {
                value: `₪${currentSales.toLocaleString()}`,
                change: `${growthPercent >= 0 ? '+' : ''}${growthPercent}% of total sales`,
                trend: parseFloat(growthPercent) >= 0 ? 'up' : 'down'
            };
        }

        // ✅ 3. Active Subscriptions (dynamic growth)
        if (permissions.activeSubscriptions) {
            const activeWhere = {
                status: { [Op.ne]: 'inactive' },
                type: { [Op.ne]: 'trial' },
                is_cancel: 0
            };

            // 💳 Apply payment source filter
            if (payment_source === 'off_system') {
                activeWhere.payment_status = 'offline';
            } else if (payment_source === 'in_system') {
                activeWhere.payment_status = 'online';
            }

            // ⭐ ADDED FOR TEACHER FILTER
            if (teacher_id && teacher_id !== 'all') {
                activeWhere.user_id = studentIds.length ? studentIds : [-1];
            }

            // 📆 Current month active subscriptions
            const currentActive = await UserSubscriptionDetails.count({
                where: {
                    ...activeWhere,
                    created_at: { [Op.between]: [startDate, endDate] }
                }
            });

            // 💪 Total active subscriptions (all time)
            const totalActive = await UserSubscriptionDetails.count({
                where: {
                    ...activeWhere
                }
            });

            // 📊 Growth % = (current / total) * 100
            const growthPercent = totalActive > 0 ? ((currentActive / totalActive) * 100).toFixed(1) : '0.0';

            metrics.activeSubscriptions = {
                value: currentActive,
                change: `${growthPercent >= 0 ? '+' : ''}${growthPercent}% of total active users`,
                trend: parseFloat(growthPercent) >= 0 ? 'up' : 'down'
            };
        }

        if (permissions.ltv) {
            // ⭐ TEACHER FILTER: restrict revenue to the teacher’s students
            let ltvPaymentWhere = {
                status: { [Op.in]: ['success', 'refunded'] }
            };
            // Apply payment source correctly again
            if (payment_source === 'off_system') {
                ltvPaymentWhere.payment_method = 'offline';
            } else if (payment_source === 'in_system') {
                ltvPaymentWhere.payment_method = { [Op.ne]: 'offline' };
            }
            console.log('ltvPaymentWhere', ltvPaymentWhere);
            if (teacher_id && teacher_id !== 'all') {
                ltvPaymentWhere.student_id = studentIds.length ? studentIds : [-1];
            }
            // 💰 Total Revenue (filtered by date + payment source)
            const totalPaymentsResult = await PaymentTransaction.findAll({
                where: ltvPaymentWhere,
                attributes: [[Sequelize.fn('SUM', Sequelize.literal('amount - IFNULL(refund_amount, 0)')), 'totalRevenue']],
                raw: true
            });
            const totalPaymentsResultOfSystem = await PaymentTransaction.findAll({
                where: {
                    status: { [Op.in]: ['success', 'refunded'] }
                },
                // where: ltvPaymentWhere,
                attributes: [[Sequelize.fn('SUM', Sequelize.literal('amount - IFNULL(refund_amount, 0)')), 'totalRevenue']],
                raw: true
            });

            const totalRevenue = parseFloat(totalPaymentsResult[0]?.totalRevenue) || 0;
            const totalRevenueOfSystem = parseFloat(totalPaymentsResultOfSystem[0]?.totalRevenue) || 0;

            console.log('totalRevenueOfSystem', totalRevenueOfSystem);
            // ⭐ TEACHER FILTER: count only subscriptions of teacher’s students
            let studentSubWhere = {
                status: { [Op.in]: ['active', 'inactive'] }
            };
            if (teacher_id && teacher_id !== 'all') {
                studentSubWhere.user_id = studentIds.length ? studentIds : [-1];
            }

            // 🧮 Total Students (unique users with active/inactive subscriptions)
            const activeStudents = await UserSubscriptionDetails.findAll({
                where: { status: { [Op.in]: ['active', 'inactive'] } },
                attributes: ['user_id'],
                group: ['user_id'],
                raw: true
            });

            const totalStudents = activeStudents.length;
            const averageLTV = totalStudents > 0 ? totalRevenueOfSystem / totalStudents : 0;

            // ⭐ TEACHER FILTER: subscription lifetime from teacher’s students only
            let lifetimeSubWhere = {
                type: { [Op.ne]: 'trial' },
                status: { [Op.in]: ['active', 'inactive'] }
            };
            if (teacher_id && teacher_id !== 'all') {
                lifetimeSubWhere.user_id = studentIds.length ? studentIds : [-1];
            }

            // 📆 Get all subscriptions (non-trials)
            const subscriptions = await UserSubscriptionDetails.findAll({
                where: {
                    type: { [Op.ne]: 'trial' },
                    status: { [Op.in]: ['active', 'inactive'] }
                },
                attributes: ['user_id', 'created_at', 'cancellation_date'],
                raw: true
            });

            // ⏳ Calculate lifetime (in months)
            const lifetimes = subscriptions.map((s) => {
                const start = moment(s.created_at);
                const end = s.cancellation_date ? moment(s.cancellation_date) : moment();
                return Math.max(0, end.diff(start, 'months', true));
            });

            const validLifetimes = lifetimes.filter((v) => !isNaN(v));

            const avgLifetime = validLifetimes.length > 0 ? (validLifetimes.reduce((a, b) => a + b, 0) / validLifetimes.length).toFixed(1) : 0;

            const medianLifetime =
                lifetimes.length > 0
                    ? (() => {
                          const sorted = [...lifetimes].sort((a, b) => a - b);
                          const mid = Math.floor(sorted.length / 2);
                          return sorted.length % 2 !== 0 ? sorted[mid].toFixed(1) : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1);
                      })()
                    : 0;

            // 👥 All-Time Active Customers
            let activeCustomerWhere = {
                status: { [Op.ne]: 'inactive' },
                type: { [Op.ne]: 'trial' },
                is_cancel: 0
            };
            // ⭐ TEACHER FILTER: only those students
            if (teacher_id && teacher_id !== 'all') {
                activeCustomerWhere.user_id = studentIds.length ? studentIds : [-1];
            }

            // 👥 All-Time Active Customers
            const totalActiveCustomers = await UserSubscriptionDetails.count({
                where: {
                    status: { [Op.ne]: 'inactive' },
                    type: { [Op.ne]: 'trial' },
                    is_cancel: 0
                }
            });

            // 💰 All-Time Revenue (net of refunds)
            const totalPaymentsResults = await PaymentTransaction.findAll({
                where: {
                    ...paymentWhere,
                    status: { [Op.in]: ['success', 'refunded'] }
                },
                attributes: [[Sequelize.fn('SUM', Sequelize.literal('amount - IFNULL(refund_amount, 0)')), 'totalRevenue']],
                raw: true
            });

            const totalRevenues = parseFloat(totalPaymentsResults[0]?.totalRevenue) || 0;

            // 🧮 Total (Lifetime) ARPU

            const totalCustomers = await UserSubscriptionDetails.count({
                where: {
                    status: { [Op.in]: ['active', 'inactive', 'inactive_after_renew'] },
                    type: { [Op.ne]: 'trial' }
                },
                distinct: true,
                col: 'user_id'
            });
            const totalARPU = totalActiveCustomers > 0 ? Number((totalRevenues / totalCustomers).toFixed(2)) : 0;

            // ------------------------------------------------------------

            // 👥 Active Customers for Selected Time (from FE)
            const activeCustomers = await UserSubscriptionDetails.count({
                where: {
                    status: { [Op.in]: ['active', 'inactive', 'inactive_after_renew'] },
                    type: { [Op.ne]: 'trial' },
                    created_at: { [Op.between]: [startDate, endDate] },
                    ...(teacher_id && teacher_id !== 'all' ? { user_id: studentIds.length ? studentIds : [-1] } : {})
                }
            }); 

            let subpaymentWhere = {
                status: { [Op.in]: ['success', 'refunded'] }
            };

            // Apply payment source correctly again
            if (payment_source === 'in_system') {
                subpaymentWhere.payment_method = 'unknown';
            } else if (payment_source === 'off_system') {
                subpaymentWhere.payment_method = { [Op.ne]: 'unknown' };
            }
            
            // 💸 Revenue for Selected Time
            const paymentsResult = await PaymentTransaction.findAll({
                where: {
                    ...subpaymentWhere,
                    ...(teacher_id && teacher_id !== 'all'
                    ? { student_id: studentIds.length ? studentIds : [-1] }
                    : {}),
                    created_at: { [Op.between]: [startDate, endDate] }
                },
                attributes: [[Sequelize.fn('SUM', Sequelize.literal('amount - IFNULL(refund_amount, 0)')), 'totalRevenue']],
                raw: true
            });
            
            const currentRevenue = parseFloat(paymentsResult[0]?.totalRevenue) || 0;
            const currentARPU = activeCustomers > 0 ? Number((currentRevenue / activeCustomers).toFixed(2)) : 0;
            
            console.log('currentRevenue',currentRevenue);
            console.log('activeCustomers',activeCustomers);
            // ------------------------------------------------------------

            // 📊 ARPU Growth vs Lifetime
            const arpuGrowth = totalARPU > 0 ? (((currentARPU - totalARPU) / totalARPU) * 100).toFixed(1) : '0.0';

            // 🎯 Metrics Output
            metrics.ltv = {
                value: `₪${Math.round(averageLTV).toLocaleString()}`,
                change: `Total Average LTV`
            };
            metrics.avgLifetime = {
                value: avgLifetime,
                change: `Total Average LifeTime`
            };
            metrics.medianLifetime = {
                value: medianLifetime,
                change: 'Stable from last month',
                trend: 'neutral'
            };
            metrics.arpu = {
                value: `₪ ${currentARPU.toLocaleString()}`,
                change: `${arpuGrowth >= 0 ? '+' : ''}${arpuGrowth}% vs total ARPU`,
                trend: parseFloat(arpuGrowth) >= 0 ? 'up' : 'down'
            };
            metrics.activeCustomers = {
                value: totalActiveCustomers,
                change: `Total Active Customers`,
                trend: null
            };
        }

        // ✅ Return Response
        return res.status(200).json({
            status: 'success',
            data: metrics
        });
    } catch (err) {
        console.error('Error fetching dashboard metrics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch dashboard metrics'
        });
    }
}

/**
 * Get revenue chart data with active students count
 * Updated according to requirements: Revenue + Active Students
 */


async function getRevenueChart(req, res) {
  try {
    const currentUser = req.user;
    const permissions = await getUserDashboardPermissions(currentUser.id, currentUser.role_name);

    if (!permissions.revenueChart) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied to revenue chart',
      });
    }

    const { period = 'monthly', startDate, endDate, months = 6 } = req.query;

    let dateConditions = {};
    let groupByFormat = '';

    // Date range logic
    if (startDate && endDate) {
      dateConditions = {
        created_at: {
          [Op.between]: [
            moment(startDate).startOf('day').toDate(),
            moment(endDate).endOf('day').toDate(),
          ],
        },
      };
    } else {
      const periodsBack = parseInt(months) || 6;
      if (period === 'daily') {
        dateConditions = {
          created_at: { [Op.gte]: moment().subtract(30, 'days').startOf('day').toDate() },
        };
      } else if (period === 'weekly') {
        dateConditions = {
          created_at: { [Op.gte]: moment().subtract(12, 'weeks').startOf('week').toDate() },
        };
      } else {
        dateConditions = {
          created_at: { [Op.gte]: moment().subtract(periodsBack, 'months').startOf('month').toDate() },
        };
      }
    }

    // Group by format
    switch (period) {
      case 'daily':
        groupByFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        groupByFormat = '%Y-%u';
        break;
      case 'yearly':
        groupByFormat = '%Y';
        break;
      default:
        groupByFormat = '%Y-%m';
    }

    // ✅ WORKING METHOD: Use subquery to count previous payments
    const allPayments = await PaymentTransaction.findAll({
      where: {
        status: 'success',
        ...dateConditions,
      },
      attributes: [
        'id',
        'student_email',
        'amount',
        [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), groupByFormat), 'period'],
        // Count previous payments for this customer
        [
          Sequelize.literal(`(
            SELECT COUNT(*) 
            FROM payment_transactions pt2 
            WHERE pt2.student_email = PaymentTransaction.student_email 
              AND pt2.status = 'success'
              AND pt2.created_at < PaymentTransaction.created_at
          )`),
          'previous_payment_count'
        ],
      ],
      order: [['created_at', 'ASC']],
      raw: true,
    });

    if (!allPayments.length) {
      return res.status(200).json({
        status: 'success',
        message: 'No transactions found for the given range',
        data: [],
      });
    }

    // ✅ CLASSIFY: Based on payment count
    const revenueMap = {};

    for (const payment of allPayments) {
      const { amount, previous_payment_count } = payment;
      const period = payment.period;
      const numericAmount = parseFloat(amount) || 0;

      if (!revenueMap[period]) {
        revenueMap[period] = { 
          period, 
          newSales: 0, 
          renewals: 0, 
          revenue: 0 
        };
      }

      // ✅ Classification Logic:
      // If previous_payment_count = 0 → First payment → NEW SALES
      // If previous_payment_count > 0 → Not first payment → RENEWALS
      const prevCount = parseInt(previous_payment_count) || 0;
      
      if (prevCount === 0) {
        revenueMap[period].newSales += numericAmount;
      } else {
        revenueMap[period].renewals += numericAmount;
      }

      revenueMap[period].revenue += numericAmount;
    }

    // Format and return
    const chartData = Object.values(revenueMap).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    return res.status(200).json({
      status: 'success',
      message: 'Revenue chart data fetched successfully',
      data: chartData,
    });
  } catch (err) {
    console.error('Error fetching revenue chart:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch revenue chart data',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}
/**
 * Get user activity chart (lessons scheduled/completed)
 * Updated according to requirements: Completed lessons with attendance data
 * Uses is_present field: 1 = present, 0 = absent (only for ended classes)
 */

async function getActivityChart(req, res) {
    try {
        const currentUser = req.user;
        const permissions = await getUserDashboardPermissions(currentUser.id, currentUser.role_name);

        if (!permissions.activityChart) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied to activity chart'
            });
        }

        const {
            period = 'monthly',
            months = 6,
            startDate,
            endDate,
            lessonType = 'all' // 👈 new filter
        } = req.query;
        let dateConditions = {};
        let groupByFormat = '';

        // 🕐 Date range
        if (startDate && endDate) {
            dateConditions = {
                meeting_start: {
                    [Op.between]: [moment(startDate).startOf('day').toDate(), moment(endDate).endOf('day').toDate()]
                }
            };
        } else {
            const periodsBack = parseInt(months) || 6;
            if (period === 'daily') {
                dateConditions = { meeting_start: { [Op.gte]: moment().subtract(30, 'days').startOf('day').toDate() } };
            } else if (period === 'weekly') {
                dateConditions = { meeting_start: { [Op.gte]: moment().subtract(12, 'weeks').startOf('week').toDate() } };
            } else {
                dateConditions = { meeting_start: { [Op.gte]: moment().subtract(periodsBack, 'months').startOf('month').toDate() } };
            }
        }

        // 🧮 Group by period
        switch (period) {
            case 'daily':
                groupByFormat = '%Y-%m-%d';
                break;
            case 'weekly':
                groupByFormat = '%Y-%u';
                break;
            case 'yearly':
                groupByFormat = '%Y';
                break;
            default:
                groupByFormat = '%Y-%m';
        }

        // 👇 Base where clause
        const whereClause = {
            ...dateConditions,
            meeting_start: {
                ...dateConditions.meeting_start,
                [Op.lt]: new Date()
            },
            status: { [Op.notIn]: ['cancelled', 'canceled'] }
        };

        // ✅ Use actual DB field from your model
        if (lessonType === 'trial') {
            whereClause.is_trial = true;
        } else if (lessonType === 'regular') {
            whereClause.is_trial = false;
        }

        // 📊 Query lessons
        const lessonsData = await Class.findAll({
            where: whereClause,
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), groupByFormat), 'period'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'totalLessons'],
                [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN is_present = 1 THEN 1 ELSE 0 END')), 'attendedLessons'],
                [Sequelize.fn('SUM', Sequelize.literal('CASE WHEN is_present = 0 THEN 1 ELSE 0 END')), 'missedLessons']
            ],
            group: [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), groupByFormat)],
            order: [[Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), groupByFormat), 'ASC']],
            raw: true
        });

        const chartData = lessonsData.map((item) => {
            const total = +item.totalLessons || 0;
            const attended = +item.attendedLessons || 0;
            const missed = +item.missedLessons || 0;
            const percentage = total ? Math.round((attended / total) * 100) : 0;

            return {
                period: item.period,
                totalLessons: total,
                attendedLessons: attended,
                missedLessons: missed,
                attendancePercentage: percentage,
                tooltip: {
                    type: lessonType,
                    totalLessons: total,
                    attended,
                    missed,
                    attendancePercentage: percentage
                }
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Activity chart data fetched successfully',
            data: chartData
        });
    } catch (err) {
        console.error('Error fetching activity chart:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch activity chart data',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get recent activity feed
 */
async function getRecentActivity(req, res) {
    try {
        const { limit = 4 } = req.query;

        // Get recent user registrations
        const recentUsers = await User.findAll({
            where: {
                role_name: 'user',
                created_at: {
                    [Op.gte]: moment().subtract(24, 'hours').unix()
                }
            },
            attributes: ['full_name', 'created_at'],
            order: [['created_at', 'DESC']],
            limit: Math.ceil(parseInt(limit) / 4)
        });

        // Get recent payments
        const recentPayments = await PaymentTransaction.findAll({
            where: {
                status: 'success',
                created_at: {
                    [Op.gte]: moment().subtract(24, 'hours').toDate()
                }
            },
            attributes: ['student_name', 'amount', 'created_at'],
            order: [['created_at', 'DESC']],
            limit: Math.ceil(parseInt(limit) / 4)
        });

        // Get recent subscriptions
        const recentSubscriptions = await UserSubscriptionDetails.findAll({
            where: {
                status: 'active',
                created_at: {
                    [Op.gte]: moment().subtract(24, 'hours').unix()
                }
            },
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['full_name']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: Math.ceil(parseInt(limit) / 4)
        });

        // Get recent completed classes
        const recentClasses = await Class.findAll({
            where: {
                status: {
                    [Op.notIn]: ['cancelled', 'canceled']
                },
                meeting_start: {
                    [Op.between]: [moment().subtract(24, 'hours').toDate(), new Date()]
                }
            },
            attributes: ['student_id', 'teacher_id', 'meeting_start', 'is_present'],
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['full_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['full_name'],
                    required: false
                }
            ],
            order: [['meeting_start', 'DESC']],
            limit: Math.ceil(parseInt(limit) / 4)
        });

        // Format activities
        const activities = [];

        recentUsers.forEach((user) => {
            activities.push({
                title: `New user registered: ${user.full_name}`,
                time: moment.unix(user.created_at).fromNow()
            });
        });

        recentPayments.forEach((payment) => {
            activities.push({
                title: `Payment processed: $${payment.amount}`,
                time: moment(payment.created_at).fromNow()
            });
        });

        recentSubscriptions.forEach((subscription) => {
            const userName = subscription.SubscriptionUser?.full_name || 'User';
            activities.push({
                title: `${userName} subscription activated`,
                time: moment.unix(subscription.created_at).fromNow()
            });
        });

        recentClasses.forEach((classItem) => {
            const studentName = classItem.Student?.full_name || 'Student';
            const status = classItem.is_present ? 'attended' : 'missed';
            activities.push({
                title: `Class ${status}: ${studentName}`,
                time: moment(classItem.meeting_start).fromNow()
            });
        });

        // Add fallback activity if no recent data
        if (activities.length === 0) {
            activities.push({ title: 'New order received', time: '5 minutes ago' });
        }

        // Sort by most recent first and limit
        const sortedActivities = activities
            .sort((a, b) => {
                // Convert "time ago" back to timestamp for proper sorting
                const timeA = moment(a.time, 'X').unix();
                const timeB = moment(b.time, 'X').unix();
                return timeB - timeA;
            })
            .slice(0, parseInt(limit));

        return res.status(200).json({
            status: 'success',
            message: 'Recent activities fetched successfully',
            data: sortedActivities
        });
    } catch (err) {
        console.error('Error fetching recent activities:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch recent activities',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Helper function to get user permissions
 */
async function getUserDashboardPermissions(userId, userRole) {
    // If super admin, allow all
    if (userRole === 'super_admin') {
        return {
            totalUsers: true,
            totalSales: true,
            activeSubscriptions: true,
            ltv: true,
            revenueChart: true,
            activityChart: true,
            recentActivity: true
        };
    }

    // Default admin permissions
    return {
        totalUsers: true,
        totalSales: true,
        activeSubscriptions: true,
        ltv: true, // Restricted for regular admins
        revenueChart: true,
        activityChart: true,
        recentActivity: true
    };
}

/**
 * Helper function to format period labels
 */
function formatPeriodLabel(period, periodType) {
    switch (periodType) {
        case 'daily':
            return moment(period, 'YYYY-MM-DD').format('MMM DD');
        case 'weekly':
            const [year, week] = period.split('-');
            return `Week ${week}`;
        case 'yearly':
            return period;
        default: // monthly
            return moment(period, 'YYYY-MM').format('MMM');
    }
}

const getCustomerLifetimeDistribution = async (req, res) => {
  try {
    const { start_date, end_date, teacher_id } = req.query;

    // ----------------------------------------
    // 1. Date Range (Only for identifying new customers)
    // ----------------------------------------
    const startDate = start_date
      ? moment.utc(start_date).startOf("month").toDate()
      : moment.utc().startOf("month").toDate();

    const endDate = end_date
      ? moment.utc(end_date).endOf("month").toDate()
      : moment.utc().endOf("month").toDate();

    // ----------------------------------------
    // 2. Fetch ALL non-trial subscriptions for ALL users
    // ----------------------------------------
    const allSubs = await UserSubscriptionDetails.findAll({
      where: {
        type: { [Op.ne]: "trial" }
      },
      attributes: ["user_id", "created_at", "cancellation_date", "status"],
      raw: true
    });


    // console.log('allsubs',allSubs);

    if (!allSubs.length) {
      return res.status(200).json({
        status: "success",
        data: [],
        message: "No subscriptions found"
      });
    }

    // ----------------------------------------
    // 3. Teacher Filter (applied on all users)
    // ----------------------------------------
    let allowedUsers = [...new Set(allSubs.map(s => s.user_id))];

    // console.log('allowerUsers',allowedUsers);

    if (teacher_id && teacher_id !== "all") {
      const teacherStudents = await Class.findAll({
        where: {
          teacher_id: Number(teacher_id),
          student_id: { [Op.in]: allowedUsers }
        },
        attributes: [
          [Sequelize.fn("DISTINCT", Sequelize.col("student_id")), "student_id"]
        ],
        raw: true
      });

      allowedUsers = teacherStudents.map(s => s.student_id);

      if (!allowedUsers.length) {
        return res.status(200).json({
          status: "success",
          data: [],
          message: "No students match teacher filter"
        });
      }
    }

    // Filter allSubs again by teacher
    const filteredSubs = allSubs.filter(s => allowedUsers.includes(s.user_id));

    // console.log('filteredSubs',filteredSubs);

    // ----------------------------------------
    // 4. Find FIRST subscription per user
    // ----------------------------------------
    const firstSubMap = {}; // user_id → first_sub_date

    filteredSubs.forEach(s => {
      const user = s.user_id;
      const date = new Date(s.created_at);
      if (!firstSubMap[user] || date < firstSubMap[user]) {
        firstSubMap[user] = date;
      }
    });

    // console.log('firstSubMap',firstSubMap);

    // ----------------------------------------
    // 5. Keep users whose FIRST subscription is inside the date window
    // ----------------------------------------
    const cohortUsers = Object.entries(firstSubMap)
      .filter(([uid, firstDate]) => firstDate >= startDate && firstDate <= endDate)
      .map(([uid]) => Number(uid));

    if (!cohortUsers.length) {
      return res.status(200).json({
        status: "success",
        data: [],
        message: "No new customers in selected date window"
      });
    }

    // console.log('cohortUsers',cohortUsers);

    // ----------------------------------------
    // 6. Compute lifetime per cohort user
    // ----------------------------------------
    const lifetimeMap = {}; // user → {start, end}

    cohortUsers.forEach(uid => {
      lifetimeMap[uid] = {
        start: moment.utc(firstSubMap[uid]),
        end: moment.utc(firstSubMap[uid]) // will be replaced
      };
    });

    filteredSubs.forEach(s => {
      const uid = s.user_id;
      if (!cohortUsers.includes(uid)) return;

      const createdAt = moment.utc(s.created_at);

      // Update end date:
      // If cancelled → use cancellation_date
      // Else → current date
      let endAt = s.cancellation_date
        ? moment.utc(s.cancellation_date)
        : moment.utc();

      if (endAt.isAfter(lifetimeMap[uid].end)) {
        lifetimeMap[uid].end = endAt;
      }
    });

    // ----------------------------------------
    // 7. Compute lifetime (in months)
    // ----------------------------------------
    const lifetimes = Object.values(lifetimeMap).map(({ start, end }) => {
      const months = Math.max(0, Math.floor(end.diff(start, "months", true)));
      return months;
    });

    // ----------------------------------------
    // 8. Bucket Lifetimes
    // ----------------------------------------
    const buckets = {
      "0-1": 0,
      "1-2": 0,
      "2-3": 0,
      "3-6": 0,
      "6-12": 0,
      "12+": 0
    };

    lifetimes.forEach(l => {
      if (l < 1) buckets["0-1"]++;
      else if (l < 2) buckets["1-2"]++;
      else if (l < 3) buckets["2-3"]++;
      else if (l < 6) buckets["3-6"]++;
      else if (l < 12) buckets["6-12"]++;
      else buckets["12+"]++;
    });

    return res.status(200).json({
      status: "success",
      data: Object.entries(buckets).map(([range, customers]) => ({
        range,
        customers
      }))
    });

  } catch (err) {
    console.error("❌ Error generating Customer Lifetime Distribution:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate customer lifetime distribution"
    });
  }
};

const getLtvOverTime = async (req, res) => {
    try {
        const { start_date, end_date, payment_source, teacher_id } = req.query;

        // ----------------------------------------
        // 1. Date Range (Monthly Cohort Window)
        // ----------------------------------------
        const startDate = start_date ? moment.utc(start_date).startOf('month').toDate() : moment.utc().startOf('year').toDate();

        const endDate = end_date ? moment.utc(end_date).endOf('month').toDate() : moment.utc().endOf('month').toDate();

        // ----------------------------------------
        // 2. Filter ONLY subs inside the window (used for detecting new users)
        // ----------------------------------------
        let whereWindow = {
            type: { [Op.ne]: 'trial' },
            weekly_lesson: { [Op.ne]: null },
            lesson_min: { [Op.ne]: null },
            created_at: { [Op.between]: [startDate, endDate] }
        };

        if (payment_source === 'off_system') whereWindow.payment_status = 'offline';
        if (payment_source === 'in_system') whereWindow.payment_status = 'online';

        const windowSubs = await UserSubscriptionDetails.findAll({
            where: whereWindow,
            attributes: ['user_id', 'created_at'],
            raw: true
        });

        if (!windowSubs.length) {
            return res.status(200).json({
                status: 'success',
                data: [],
                message: 'No subscriptions in chosen window'
            });
        }

        const windowUserIds = [...new Set(windowSubs.map((s) => s.user_id))];

        // ----------------------------------------
        // 3. Teacher Filter (applied on window users)
        // ----------------------------------------
        let filteredUserIds = windowUserIds;

        if (teacher_id && teacher_id !== 'all' && !isNaN(Number(teacher_id))) {
            const teacherStudents = await Class.findAll({
                where: {
                    teacher_id: Number(teacher_id),
                    student_id: { [Op.in]: filteredUserIds },
                    status: { [Op.in]: ['ended', 'pending'] },
                    meeting_start: { [Op.between]: [startDate, endDate] }
                },
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('student_id')), 'student_id']],
                raw: true
            });

            filteredUserIds = teacherStudents.map((s) => s.student_id);

            if (!filteredUserIds.length) {
                return res.status(200).json({
                    status: 'success',
                    data: [],
                    message: 'No students match teacher filter'
                });
            }
        }

        // ----------------------------------------
        // 4. Find FIRST subscription (cohort month) for these users
        // ----------------------------------------
        const firstSubs = await UserSubscriptionDetails.findAll({
            where: {
                user_id: { [Op.in]: filteredUserIds },
                type: { [Op.ne]: 'trial' }
            },
            attributes: ['user_id', [Sequelize.fn('MIN', Sequelize.col('created_at')), 'first_sub_date']],
            group: ['user_id'],
            raw: true
        });

        // Keep only users whose FIRST sub is inside window
        const cohortUsers = firstSubs
            .filter((u) => {
                const firstDate = new Date(u.first_sub_date);
                return firstDate >= startDate && firstDate <= endDate;
            })
            .map((u) => u.user_id);

        if (!cohortUsers.length) {
            return res.status(200).json({
                status: 'success',
                data: [],
                message: 'No cohort users found in window'
            });
        }

        // ----------------------------------------
        // 5. Fetch ALL payments of cohort users (TRUE LTV source)
        // ----------------------------------------
        const payments = await PaymentTransaction.findAll({
            where: {
                student_id: { [Op.in]: cohortUsers },
                status: { [Op.in]: ['success', 'refunded'] } // refunded still counts as paid (you can adjust)
            },
            attributes: ['student_id', 'amount'],
            raw: true
        });

        // Build LTV map from actual payments
        const userLtvMap = {};
        payments.forEach((p) => {
            const amt = Number(p.amount) || 0;
            if (!userLtvMap[p.student_id]) userLtvMap[p.student_id] = 0;
            userLtvMap[p.student_id] += amt;
        });

        // ----------------------------------------
        // 6. Build cohorts: group users by their FIRST subscription month
        // ----------------------------------------
        const cohorts = {};

        firstSubs.forEach((u) => {
            if (!cohortUsers.includes(u.user_id)) return;

            const month = moment.utc(u.first_sub_date).format('YYYY-MM');
            if (!cohorts[month]) cohorts[month] = [];
            cohorts[month].push(u.user_id);
        });

        // ----------------------------------------
        // 7. Compute AVG LTV per cohort month
        // ----------------------------------------
        const result = [];

        Object.entries(cohorts).forEach(([month, users]) => {
            const ltvs = users.map((uid) => userLtvMap[uid] || 0);
            const avg = ltvs.length > 0 ? Number((ltvs.reduce((a, b) => a + b, 0) / ltvs.length).toFixed(2)) : 0;

            result.push({ month, averageLTV: avg });
        });

        result.sort((a, b) => new Date(a.month + '-01') - new Date(b.month + '-01'));

        return res.status(200).json({
            status: 'success',
            data: result
        });
    } catch (err) {
        console.error('❌ LTV Error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to generate LTV'
        });
    }
};

const refreshCohortRetention = async (req, res) => {
  try {
    console.log('🔄 Cohort Retention Refresh (Subscription Based + Filters)');

    const {
      start_month,
      end_month,
      subscription_type,
      sales_reps,
      trial_coordinator,
      trial_source_website,
      trial_source_app
    } = req.query;

    // Normalize arrays
    const salesReps = Array.isArray(sales_reps)
      ? sales_reps
      : sales_reps ? [sales_reps] : [];

    const trialCoordinators = Array.isArray(trial_coordinator)
      ? trial_coordinator
      : trial_coordinator ? [trial_coordinator] : [];

    /**
     * -----------------------------------------
     * STEP 0 — Fetch Dropdown Data
     * -----------------------------------------
     */
    const salesUser = await User.findAll({
      where: { role_name: 'sales_role' },
      attributes: ['id', 'full_name', 'email'],
      order: [['created_at', 'ASC']],
      raw: true
    });

    const TrialUser = await User.findAll({
      where: { role_name: 'sales_appointment_setter' },
      attributes: ['id', 'full_name', 'email'],
      order: [['created_at', 'ASC']],
      raw: true
    });

    /**
     * -----------------------------------------
     * STEP 1 — Fetch All Subscriptions
     * -----------------------------------------
     */
    const subRecords = await UserSubscriptionDetails.findAll({
      attributes: [
        'user_id',
        'created_at',
        'renew_date',
        'cancellation_date',
        'type',
        'plan_id',
        'weekly_lesson',
        'lesson_min',
        'cancellation_reason',
        'cancelled_by_user_id'
      ],
      order: [['created_at', 'ASC']],
      raw: true
    });

    if (!subRecords.length) {
      return res.json({
        success: true,
        cohorts: [],
        salesUser,
        TrialUser
      });
    }

    /**
     * -----------------------------------------
     * STEP 2 — Build Subscription Maps
     * -----------------------------------------
     */
    const userFirstSubscription = {};
    const userFirstSubscriptionType = {};
    const userIntervals = {};

    for (const sub of subRecords) {
      const uid = sub.user_id;
      if (!uid || !sub.created_at) continue;

      const start = moment.utc(sub.created_at);
      const end = sub.cancellation_date
        ? moment.utc(sub.cancellation_date)
        : moment.utc();

      if (!userIntervals[uid]) userIntervals[uid] = [];
      userIntervals[uid].push({
        start,
        end,
        created_at: sub.created_at || null,
        renew_date: sub.renew_date || null,
        plan_type: sub.type || null,
        plan_id: sub.plan_id || null,
        weekly_lesson: sub.weekly_lesson || null,
        lesson_min: sub.lesson_min || null,
        cancellation_reason: sub.cancellation_reason || null,
        cancellation_date: sub.cancellation_date || null
      });

      if (!userFirstSubscription[uid]) {
        userFirstSubscription[uid] = start.clone();
        userFirstSubscriptionType[uid] = String(sub.type || '').toLowerCase().trim();
      }
    }

    let userIds = Object.keys(userFirstSubscription);

    /**
     * -----------------------------------------
     * STEP 3 — Fetch Users (For Filters + Modal)
     * -----------------------------------------
     */
    const userAttributes = ['id', 'full_name', 'email', 'trial_user_id'];
    const hasSalesOwnerField = Boolean(User.rawAttributes?.sales_owner_id);
    const hasTrialBookedByTypeField = Boolean(User.rawAttributes?.trial_booked_by_type);

    if (hasSalesOwnerField) userAttributes.push('sales_owner_id');
    if (hasTrialBookedByTypeField) userAttributes.push('trial_booked_by_type');

    let users = await User.findAll({
      where: { id: userIds },
      attributes: userAttributes,
      raw: true
    });

    /**
     * -----------------------------------------
     * STEP 4 — Apply Filters
     * -----------------------------------------
     */

    // Fallback mapping for envs where users table does not have `sales_owner_id`
    let salesOwnerByUser = {};
    if (!hasSalesOwnerField && salesReps.length && !salesReps.includes('all')) {
      const firstPayments = await PaymentTransaction.findAll({
        where: {
          status: 'success',
          student_id: userIds
        },
        attributes: ['student_id', 'generated_by', 'created_at'],
        order: [['created_at', 'ASC']],
        raw: true
      });

      for (const p of firstPayments) {
        if (!salesOwnerByUser[p.student_id]) {
          salesOwnerByUser[p.student_id] = p.generated_by;
        }
      }
    }

    // Fallback mapping for envs where users table does not have `trial_booked_by_type`
    let firstClassTypeByUser = {};
    if (!hasTrialBookedByTypeField && (trial_source_website === '1' || trial_source_app === '1')) {
      const classRecords = await Class.findAll({
        where: { student_id: userIds },
        attributes: ['student_id', 'class_type', 'created_at'],
        order: [['created_at', 'ASC']],
        raw: true
      });

      for (const cls of classRecords) {
        if (!firstClassTypeByUser[cls.student_id]) {
          firstClassTypeByUser[cls.student_id] = String(cls.class_type || '').toLowerCase().trim();
        }
      }
    }

    // Subscription Type (based on FIRST subscription)
    if (subscription_type) {
      const prefix = subscription_type.toLowerCase();

      users = users.filter((u) => {
        const firstType = userFirstSubscriptionType[u.id] || '';
        return firstType.startsWith(prefix);
      });
    }

    // Sales Rep Filter
    if (salesReps.length && !salesReps.includes('all')) {
      const salesRepSet = new Set(salesReps.map((v) => String(v)));
      users = users.filter((u) => {
        const ownerId = hasSalesOwnerField ? u.sales_owner_id : salesOwnerByUser[u.id];
        return salesRepSet.has(String(ownerId));
      });
    }

    // Trial Coordinator Filter
    if (trialCoordinators.length && !trialCoordinators.includes('all')) {
      const trialCoordinatorSet = new Set(trialCoordinators.map((v) => String(v)));
      users = users.filter((u) =>
        trialCoordinatorSet.has(String(u.trial_user_id))
      );
    }

    // Trial Source Filter
    if (trial_source_website === '1' || trial_source_app === '1') {
      users = users.filter((u) => {
        const sourceType = hasTrialBookedByTypeField
          ? String(u.trial_booked_by_type || '').toLowerCase().trim()
          : firstClassTypeByUser[u.id] || '';

        if (
          trial_source_website === '1' &&
          sourceType.startsWith('website')
        ) return true;

        if (
          trial_source_app === '1' &&
          (sourceType.startsWith('app') || sourceType.includes('android') || sourceType.includes('ios'))
        ) return true;

        return false;
      });
    }

    userIds = users.map((u) => u.id);

    const userProfileMap = {};
    users.forEach((u) => {
      userProfileMap[u.id] = {
        id: u.id,
        name: u.full_name || null,
        email: u.email || null
      };
    });

    const formatDate = (value) => (value ? moment.utc(value).format('YYYY-MM-DD') : null);
    const getPlanLabel = (interval) => {
      if (!interval) return null;
      if (interval.weekly_lesson && interval.lesson_min) {
        return `Up to ${interval.weekly_lesson} classes / ${interval.lesson_min}-minute lesson`;
      }
      if (interval.plan_type) return interval.plan_type;
      if (interval.plan_id) return `Plan #${interval.plan_id}`;
      return null;
    };

    const buildMonthDetailStudent = (uid, interval, monthStart, monthEnd) => ({
      ...userProfileMap[uid],
      first_subscription_date: formatDate(userFirstSubscription[uid]),
      retention_month_start: monthStart.format('YYYY-MM-DD'),
      retention_month_end: monthEnd.format('YYYY-MM-DD'),
      subscription_start_date: interval ? formatDate(interval.created_at || interval.start) : null,
      renew_date: interval ? formatDate(interval.renew_date) : null,
      cancelled_on: interval ? formatDate(interval.cancellation_date) : null,
      cancellation_reason: interval?.cancellation_reason || null,
      plan: getPlanLabel(interval),
      plan_type: interval?.plan_type || null,
      plan_id: interval?.plan_id || null
    });

    /**
     * -----------------------------------------
     * STEP 5 — Group Into Cohorts
     * -----------------------------------------
     */
    const cohorts = {};

    for (const uid of userIds) {
      const firstStart = userFirstSubscription[uid];
      const label = firstStart.format('YYYY-MM');

      if (start_month && label < start_month) continue;
      if (end_month && label > end_month) continue;

      if (!cohorts[label]) {
        cohorts[label] = {
          cohort_year: firstStart.year(),
          cohort_month: firstStart.month() + 1,
          cohort_label: label,
          total: 0,
          users: []
        };
      }

      cohorts[label].total++;
      cohorts[label].users.push(uid);
    }

    /**
     * -----------------------------------------
     * STEP 6 — Retention Calculation
     * -----------------------------------------
     */
    const insertRows = [];

    for (const label in cohorts) {
      const group = cohorts[label];
      const total = group.total;

      const monthCounts = Array(12).fill(0);
      const monthDetails = {};

      for (const uid of group.users) {
        const firstStart = userFirstSubscription[uid];
        const intervals = userIntervals[uid] || [];

        for (let m = 1; m <= 12; m++) {
          const monthStart = firstStart.clone().add(m - 1, 'months').startOf('day');
          const monthEnd = monthStart.clone().add(1, 'months').subtract(1, 'seconds');

          const overlappingInterval = intervals.find(
            (iv) =>
              iv.start.isSameOrBefore(monthEnd) &&
              iv.end.isSameOrAfter(monthStart)
          );

          if (!monthDetails[`month_${m}`]) {
            monthDetails[`month_${m}`] = {
              renewed: [],
              not_renewed: []
            };
          }

          if (overlappingInterval) {
            monthCounts[m - 1]++;
            monthDetails[`month_${m}`].renewed.push(
              buildMonthDetailStudent(uid, overlappingInterval, monthStart, monthEnd)
            );
          } else {
            const lastKnownInterval = [...intervals].reverse().find((iv) =>
              iv.start.isSameOrBefore(monthEnd)
            );

            monthDetails[`month_${m}`].not_renewed.push(
              buildMonthDetailStudent(uid, lastKnownInterval || null, monthStart, monthEnd)
            );
          }
        }
      }

      insertRows.push({
        cohort_year: group.cohort_year,
        cohort_month: group.cohort_month,
        cohort_label: group.cohort_label,
        total_users: total,

        ...Object.fromEntries(
          monthCounts.map((v, i) => [`month_${i + 1}_active`, v])
        ),

        ...Object.fromEntries(
          monthCounts.map((v, i) => [
            `month_${i + 1}_percent`,
            total > 0 ? ((v / total) * 100).toFixed(2) : '0.00'
          ])
        ),

        month_details: monthDetails
      });
    }

    /**
     * -----------------------------------------
     * STEP 7 — Save Snapshot
     * -----------------------------------------
     */
    await CohortRetention.destroy({ where: {} });
    await CohortRetention.bulkCreate(insertRows);

    return res.json({
      success: true,
      cohorts: insertRows,
      salesUser,
      TrialUser,
      message: 'Cohort Retention Updated'
    });

  } catch (err) {
    console.error('❌ Cohort Retention Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getLtvByPlanType = async (req, res) => {
    try {
        const { start_date, end_date, payment_source, teacher_id } = req.query;

        // ------------------------------
        // 1. Date Range
        // ------------------------------
        const startDate = start_date ? moment.utc(start_date).startOf('day').toDate() : moment.utc().startOf('month').toDate();

        const endDate = end_date ? moment.utc(end_date).endOf('day').toDate() : moment.utc().endOf('month').toDate();

        // ------------------------------
        // 2. Subscription Filter
        // ------------------------------
        let subscriptionWhere = {
            weekly_lesson: { [Op.ne]: null },
            lesson_min: { [Op.ne]: null },
            created_at: { [Op.between]: [startDate, endDate] }
        };

        if (payment_source === 'off_system') {
            subscriptionWhere.payment_status = 'offline';
        }

        if (payment_source === 'in_system') {
            subscriptionWhere.payment_status = 'online';
        }

        // ------------------------------
        // 3. Fetch Subscriptions
        // ------------------------------
        let subs = await UserSubscriptionDetails.findAll({
            where: subscriptionWhere,
            order: [['created_at', 'DESC']],
            raw: true
        });

        // console.log('subs length',subs.length);

        if (!subs.length) {
            return res.status(200).json({
                status: 'success',
                data: [],
                studentCountByPlan: {},
                message: 'No subscription data found'
            });
        }

        // Unique student IDs
        let subStudentIds = [...new Set(subs.map((s) => s.user_id))].filter(Boolean);

        // console.log('subStudentIds',subStudentIds.length);

        // ------------------------------
        // 4. Teacher Filter
        // ------------------------------
        if (teacher_id && teacher_id !== 'all' && !isNaN(Number(teacher_id))) {
            const teacherStudents = await Class.findAll({
                where: {
                    teacher_id: Number(teacher_id),
                    student_id: { [Op.in]: subStudentIds },
                    status: { [Op.in]: ['ended', 'pending'] },
                    meeting_start: { [Op.between]: [startDate, endDate] }
                },
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('student_id')), 'student_id']],
                raw: true
            });

            const teacherStudentIds = teacherStudents.map((s) => s.student_id);

            if (!teacherStudentIds.length) {
                return res.status(200).json({
                    status: 'success',
                    data: [],
                    studentCountByPlan: {},
                    message: 'No matching students for selected teacher'
                });
            }

            // Filter subscriptions
            subs = subs.filter((sub) => teacherStudentIds.includes(sub.user_id));
        }

        // ----------------------------------------------
        // 5. Fetch REAL revenue per subscription using payment table
        // ----------------------------------------------
        const paymentIds = subs.map((s) => s.payment_id).filter((id) => id !== null && id !== undefined);

        // console.log('paymentMap lenght', paymentIds.length);

        let paymentMap = {};

        if (paymentIds.length > 0) {
            const payments = await PaymentTransaction.findAll({
                where: {
                    id: { [Op.in]: paymentIds },
                    status: { [Op.in]: ['success', 'refunded'] }
                },
                attributes: ['id', 'amount'],
                raw: true
            });

            paymentMap = payments.reduce((acc, p) => {
                acc[p.id] = Number(p.amount) || 0;
                return acc;
            }, {});
        }
        // console.log('paymentMap length of user', Object.keys(paymentMap).length);
        // ----------------------------------------------
        // 6. Group by Plan using REAL payment amounts
        // ----------------------------------------------
        const planLtvMap = {};

        subs.forEach((sub) => {
            const label = `Up to ${sub.weekly_lesson} classes / ${sub.lesson_min}-minute lesson`;

            const amount = sub.payment_id ? paymentMap[sub.payment_id] || 0 : 0;

            if (!planLtvMap[label]) planLtvMap[label] = 0;
            planLtvMap[label] += amount;
        });

        // Calculate totals & percentages
        const totalRevenue = Object.values(planLtvMap).reduce((a, b) => a + b, 0);

        const responseData = Object.entries(planLtvMap).map(([label, amount]) => ({
            planType: label,
            value: Number(amount.toFixed(2)),
            percentage: totalRevenue > 0 ? Number(((amount / totalRevenue) * 100).toFixed(1)) : 0
        }));
        
        // ------------------------------
        // 7. Count subscriptions per plan (CASE B)
        // ------------------------------
        const planStudentCount = {};
        
        subs.forEach((sub) => {
          const label = `Up to ${sub.weekly_lesson} classes / ${sub.lesson_min}-minute lesson`;
          
          if (!planStudentCount[label]) planStudentCount[label] = 0;
          planStudentCount[label] += 1; // count subs, NOT students
        });
        // console.log('response data',responseData);
        // console.log('response data',responseData.length);
        // console.log('planStudentCount',planStudentCount);

        // ------------------------------
        // 8. Return
        // ------------------------------
        return res.status(200).json({
            status: 'success',
            data: responseData,
            studentCountByPlan: planStudentCount
        });
    } catch (err) {
        console.error('❌ Error generating LTV by plan type:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to generate LTV by plan type'
        });
    }
};



module.exports = {
    getDashboardMetrics,
    getRevenueChart,
    getActivityChart,
    getRecentActivity,
    getAllTeachers,
    getPaymentSources,
    getCustomerLifetimeDistribution,
    getLtvOverTime,
    getLtvByPlanType,
    refreshCohortRetention
};
