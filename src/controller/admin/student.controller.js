const User = require('../../models/users');
const UserReview = require('../../models/userReviews');
const Class = require('../../models/classes');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const PaymentTransaction = require('../../models/PaymentTransaction');
const RecurringPayment = require('../../models/RecurringPayment');
const axios = require('axios');
const RegularClass = require('../../models/regularClass');
const PastDuePayment = require('../../models/PastDuePayment');
const DunningSchedule = require('../../models/DunningSchedule');
const LessonFeedback=require('../../models/lessonFeedback');
const Homework=require('../../models/homework')
const { Op, Sequelize ,fn,col,literal} = require('sequelize');
const moment = require('moment-timezone');
const bcrypt = require('bcrypt');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');
const { payplusUpdateLogger } = require('../../utils/payplusUpdateLogger');
const TrialClassRegistration = require('../../models/trialClassRegistration');

const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
};

async function getStudents(req, res) {
    try {
        const {
            exportAll,
            page = 1,
            limit = 10,
            search,
            status = 'all',
            subscription = 'all',
            subscriptionPlan = 'all',
            paymentStatus = 'all',
            subscriptionStatus = 'all',
            teacherId = 'all',
            noFutureLessons = false,
            noLessonDays = 'all',
            dateFrom = null,
            dateTo = null
        } = req.query;

        // Initialize base query conditions
        const whereConditions = { role_name: 'user' };
        const exportAllBool = exportAll === 'true';

        // Apply search filter across multiple fields
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } }
            ];
        }

        // Apply user status filter
        if (status && status.toLowerCase() !== 'all') {
            whereConditions.status = status.toLowerCase();
        }

        // Determine active filters
        const isNoSubscriptionFilter = subscriptionStatus === "no-subscription";
        const isNoFutureLessonsFilter = noFutureLessons === 'true' || noFutureLessons === true;
        const hasDateRangeFilter = dateFrom && dateTo;
        const isNoLessonDaysFilter = noLessonDays && noLessonDays !== 'all' && !isNaN(parseInt(noLessonDays));

        // Build subscription filter conditions
        const subscriptionWhere = {
            ...(subscription !== 'all' && { type: subscription }),
            ...(subscriptionPlan !== 'all' && { type: subscriptionPlan }),
            ...(paymentStatus !== 'all' && { payment_status: paymentStatus }),
            ...(subscriptionStatus !== 'all' && subscriptionStatus !== "no-subscription" && { 
                status: subscriptionStatus
            })
        };

        // Helper function to add inactive_after_renew condition for active subscriptions
        const addInactiveAfterRenewCondition = () => {
            subscriptionWhere[Op.or] = [
                { inactive_after_renew: 0 },
                { inactive_after_renew: null },
                { inactive_after_renew: false }
            ];
        };

        // When filtering for active subscriptions, also ensure inactive_after_renew is 0, null, or false
        if (subscriptionStatus === 'active') {
            addInactiveAfterRenewCondition();
        }

        // Handle date range filter for students with no lessons in specified period
        if (hasDateRangeFilter || isNoLessonDaysFilter) {
            const result = await applyDateRangeFilter({
                dateFrom,
                dateTo,
                noLessonDays,
                isNoLessonDaysFilter,
                page,
                limit
            });

            if (result.isEmpty) {
                return res.status(200).json(result.response);
            }

            whereConditions.id = { [Op.in]: result.filteredUserIds };
            subscriptionWhere.status = 'active';
            // Also ensure inactive_after_renew is 0 or null when filtering for active subscriptions
            addInactiveAfterRenewCondition();
        }

        // Handle filter for students with no future lessons
        if (isNoFutureLessonsFilter) {
            const result = await applyNoFutureLessonsFilter({ page, limit });

            if (result.isEmpty) {
                return res.status(200).json(result.response);
            }

            whereConditions.id = { [Op.in]: result.filteredUserIds };
            subscriptionWhere.status = 'active';
            // Also ensure inactive_after_renew is 0 or null when filtering for active subscriptions
            addInactiveAfterRenewCondition();
        }

        // Handle filter for students without any subscription
        if (isNoSubscriptionFilter) {
            const usersWithSubscriptions = await UserSubscriptionDetails.findAll({
                attributes: ['user_id'],
                raw: true
            });

            const userIdsWithSubscriptions = [...new Set(usersWithSubscriptions.map(s => s.user_id))];

            if (userIdsWithSubscriptions.length > 0) {
                whereConditions.id = { [Op.notIn]: userIdsWithSubscriptions };
            }
        }

        // Build main query with associations
        const queryOptions = buildQueryOptions({
            whereConditions,
            subscriptionWhere,
            subscription,
            subscriptionPlan,
            paymentStatus,
            subscriptionStatus,
            teacherId,
            isNoSubscriptionFilter,
            exportAllBool,
            page,
            limit
        });

        // Execute main query
        let { count, rows } = await User.findAndCountAll(queryOptions);

        // Extract latest subscription for each student
        rows = rows.map((student) => {
            const subs = student.UserSubscriptions || [];
            const sortedSubs = subs.sort((a, b) => {
                const aDate = new Date(a.renew_date || a.created_at || 0);
                const bDate = new Date(b.renew_date || b.created_at || 0);
                return bDate - aDate;
            });
            student.LatestSubscription = sortedSubs[0] || null;
            return student;
        });

        const userIds = rows.map((s) => s.id);

        // Fetch additional data in parallel
        const [
            paymentData,
            subscriptionData,
            lessonsData,
            subscriptionDurations,
            gracePeriodInfoMap,
            completedLessonsMap,
            nextClassesMap,
            summaryStats
        ] = await Promise.all([
            fetchPaymentData(userIds),
            fetchSubscriptionData(userIds),
            fetchLessonsData(userIds),
            getSubscriptionDurationsForUsers(userIds),
            fetchGracePeriodInfo(rows),
            fetchCompletedLessonsMap(rows),
            fetchNextClassesMap(userIds, teacherId),
            fetchSummaryStats()
        ]);

        // Build final student response objects
        const students = rows.map((student) => 
            buildStudentResponse(student, {
                nextClassesMap,
                paymentData,
                subscriptionData,
                lessonsData,
                subscriptionDurations,
                gracePeriodInfoMap,
                completedLessonsMap,
                isExport: exportAllBool
            })
        );

        // Return successful response
        return res.status(200).json({
            status: 'success',
            message: 'Users fetched successfully',
            data: {
                students,
                pagination: {
                    total: count,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(count / limit),
                    per_page: parseInt(limit)
                },
                summary: summaryStats
            }
        });

    } catch (err) {
        console.error('Error fetching users:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch users',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// Helper function to apply date range filter
async function applyDateRangeFilter({ dateFrom, dateTo, noLessonDays, isNoLessonDaysFilter, page, limit }) {
    let startDate, endDate;

    // Determine date range based on input
    if (dateFrom && dateTo) {
        startDate = moment(dateFrom).startOf('day').toDate();
        endDate = moment(dateTo).endOf('day').toDate();
    } else if (isNoLessonDaysFilter) {
        const daysAgo = parseInt(noLessonDays);
        startDate = moment().subtract(daysAgo, 'days').startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
    }

    // Get users with active subscriptions
    const activeSubscriptionUsers = await UserSubscriptionDetails.findAll({
        where: { status: 'active' },
        attributes: ['user_id'],
        raw: true
    });

    const activeUserIds = [...new Set(activeSubscriptionUsers.map(s => s.user_id))];

    if (activeUserIds.length === 0) {
        return {
            isEmpty: true,
            response: buildEmptyResponse(page, limit)
        };
    }

    // Find users who have completed classes in the date range
    const usersWithRecentClasses = await Class.findAll({
        where: {
            status: 'ended',
            meeting_start: {
                [Op.gte]: startDate,
                [Op.lte]: endDate
            },
            student_id: { [Op.in]: activeUserIds }
        },
        attributes: ['student_id'],
        raw: true
    });

    const userIdsWithRecentClasses = [...new Set(usersWithRecentClasses.map(c => c.student_id))];

    // Filter to get users with NO lessons in the date range
    const filteredUserIds = activeUserIds.filter(id => !userIdsWithRecentClasses.includes(id));

    if (filteredUserIds.length === 0) {
        return {
            isEmpty: true,
            response: buildEmptyResponse(page, limit)
        };
    }

    return {
        isEmpty: false,
        filteredUserIds
    };
}

// Helper function to apply no future lessons filter
async function applyNoFutureLessonsFilter({ page, limit }) {
    // Get users with active subscriptions
    const activeSubscriptionUsers = await UserSubscriptionDetails.findAll({
        where: { status: 'active' },
        attributes: ['user_id'],
        raw: true
    });

    const activeUserIds = [...new Set(activeSubscriptionUsers.map(s => s.user_id))];

    if (activeUserIds.length === 0) {
        return {
            isEmpty: true,
            response: buildEmptyResponse(page, limit)
        };
    }

    // Get users with future lessons
    const usersWithFutureLessons = await Class.findAll({
        where: {
            status: 'pending',
            meeting_start: { [Op.gte]: Sequelize.fn('NOW') },
            student_id: { [Op.in]: activeUserIds }
        },
        attributes: ['student_id'],
        raw: true
    });

    const userIdsWithFutureLessons = [...new Set(usersWithFutureLessons.map(c => c.student_id))];

    // Filter to get users with NO future lessons
    const filteredUserIds = activeUserIds.filter(id => !userIdsWithFutureLessons.includes(id));

    if (filteredUserIds.length === 0) {
        return {
            isEmpty: true,
            response: buildEmptyResponse(page, limit)
        };
    }

    return {
        isEmpty: false,
        filteredUserIds
    };
}

// Helper function to build query options
function buildQueryOptions(params) {
    const {
        whereConditions,
        subscriptionWhere,
        subscription,
        subscriptionPlan,
        paymentStatus,
        subscriptionStatus,
        teacherId,
        isNoSubscriptionFilter,
        exportAllBool,
        page,
        limit
    } = params;

    const queryOptions = {
        where: whereConditions,
        include: [
            {
                model: UserSubscriptionDetails,
                as: 'UserSubscriptions',
                required: subscription !== 'all' || subscriptionPlan !== 'all' || paymentStatus !== 'all' || (subscriptionStatus !== 'all' && subscriptionStatus !== 'no-subscription'),
                where: isNoSubscriptionFilter ? {} : subscriptionWhere,
                order: [['renew_date', 'DESC']],
                limit: 1,
                separate: false,
                include: [
                    {
                        model: User,
                        as: 'OfflinePaymentAdmin',
                        attributes: ['id', 'full_name'],
                        required: false
                    }
                ]
            },
            ...(teacherId !== 'all' ? [{
                model: Class,
                as: 'StudentClasses',
                required: true,
                separate: false,
                limit: 1,
                where: {
                    teacher_id: teacherId,
                    status: 'pending',
                    meeting_start: { [Op.gte]: Sequelize.fn('NOW') }
                },
                order: [['meeting_start', 'ASC']],
                include: [{
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email']
                }]
            }] : []),
            {
                model: PaymentTransaction,
                as: 'StudentPayments',
                required: false,
                where: { status: 'success' },
                order: [['created_at', 'DESC']],
                limit: 1,
                separate: false
            }
        ],
        attributes: ['id', 'full_name', 'email', 'mobile', 'status', 'created_at', 'is_parent', 'verified', 'role_name', 'role_id', 'timezone'],
        order: [['id', 'DESC']],
        distinct: true
    };

    if (!exportAllBool) {
        queryOptions.offset = (page - 1) * limit;
        queryOptions.limit = parseInt(limit);
    }

    return queryOptions;
}

// Helper function to fetch payment data
async function fetchPaymentData(userIds) {
    // Fetch all successful payment transactions for totals and dates
    const allPayments = await PaymentTransaction.findAll({
        where: { student_id: { [Op.in]: userIds }, status: 'success' },
        attributes: ['student_id', 'amount', 'created_at', 'currency', 'card_last_digits', 'transaction_id', 'payment_method'],
        order: [['created_at', 'DESC']],
        raw: true
    });

    // Fetch subscription payment statuses
    const subscriptions = await UserSubscriptionDetails.findAll({
        where: { user_id: { [Op.in]: userIds } },
        attributes: ['user_id', 'payment_status', 'created_at'],
        order: [['created_at', 'DESC']],
        raw: true
    });

    const totalPaidMap = {};
    const lastPaymentDateMap = {};
    const lastPaymentDetailsMap = {};
    
    // Calculate total paid and last payment date from transactions
    for (const p of allPayments) {
        const uid = p.student_id;
        if (!totalPaidMap[uid]) totalPaidMap[uid] = 0;
        if (!lastPaymentDateMap[uid]) {
            lastPaymentDateMap[uid] = p.created_at;
            lastPaymentDetailsMap[uid] = p;
        }
        
        totalPaidMap[uid] += Number(p.amount);
        
        if (moment(p.created_at).isAfter(lastPaymentDateMap[uid])) {
            lastPaymentDateMap[uid] = p.created_at;
            lastPaymentDetailsMap[uid] = p;
        }
    }

    // Determine payment type based on subscription payment_status
    const paymentTypeMap = {};
    const userPaymentStatuses = {};

    // Group subscriptions by user
    for (const sub of subscriptions) {
        const uid = sub.user_id;
        if (!userPaymentStatuses[uid]) {
            userPaymentStatuses[uid] = new Set();
        }
        
        // Map payment_status to payment type
        if (sub.payment_status) {
            const paymentStatus = sub.payment_status.toLowerCase();
            
            // Determine if offline or online based on payment_status
            if (paymentStatus === 'offline' || paymentStatus === 'manual' || paymentStatus === 'cash') {
                userPaymentStatuses[uid].add('offline');
            } else if (paymentStatus === 'online' || paymentStatus === 'stripe' || paymentStatus === 'card' || paymentStatus === 'credit_card') {
                userPaymentStatuses[uid].add('credit_card');
            }
        }
    }

    // Finalize payment type (offline, credit_card, or mixed)
    const paymentTypeFinal = {};
    for (const [uid, statusSet] of Object.entries(userPaymentStatuses)) {
        if (statusSet.size === 0) {
            paymentTypeFinal[uid] = 'unknown';
        } else if (statusSet.size === 1) {
            paymentTypeFinal[uid] = [...statusSet][0];
        } else {
            paymentTypeFinal[uid] = 'mixed';
        }
    }

    return { totalPaidMap, lastPaymentDateMap, lastPaymentDetailsMap, paymentTypeFinal };
}

// Helper function to fetch subscription data
async function fetchSubscriptionData(userIds) {
    const allSubscriptions = await UserSubscriptionDetails.findAll({
        where: { user_id: { [Op.in]: userIds } },
        attributes: ['user_id', 'weekly_lesson'],
        raw: true
    });

    const totalLessonsPaidMap = {};
    for (const s of allSubscriptions) {
        const uid = s.user_id;
        const lessons = Number(s.weekly_lesson || 0);
        if (!totalLessonsPaidMap[uid]) totalLessonsPaidMap[uid] = 0;
        totalLessonsPaidMap[uid] += lessons;
    }

    return { totalLessonsPaidMap };
}

// Helper function to fetch lessons data
async function fetchLessonsData(userIds) {
    const endedClasses = await Class.findAll({
        where: {
            student_id: { [Op.in]: userIds },
            status: 'ended'
        },
        attributes: ['student_id'],
        raw: true
    });

    const lessonsUsedMap = {};
    for (const c of endedClasses) {
        const uid = c.student_id;
        if (!lessonsUsedMap[uid]) lessonsUsedMap[uid] = 0;
        lessonsUsedMap[uid] += 1;
    }

    return { lessonsUsedMap };
}

// Helper function to fetch grace period information
async function fetchGracePeriodInfo(rows) {
    if (rows.length === 0) return {};

    const subscriptions = rows
        .map((s) => s.UserSubscriptions?.[0])
        .filter(Boolean);

    if (subscriptions.length === 0) return {};

    const subscriptionUserIds = subscriptions.map((s) => s.user_id);

    const activePastDuePayments = await PastDuePayment.findAll({
        where: {
            user_id: { [Op.in]: subscriptionUserIds },
            status: 'past_due',
            grace_period_expires_at: { [Op.ne]: null }
        },
        attributes: ['user_id', 'grace_period_expires_at'],
        order: [['grace_period_expires_at', 'DESC']],
        raw: true
    });

    const gracePeriodMap = {};
    const groupedByUser = {};

    // Group payments by user, keeping only the latest
    activePastDuePayments.forEach((payment) => {
        if (!groupedByUser[payment.user_id] ||
            moment(payment.grace_period_expires_at).isAfter(moment(groupedByUser[payment.user_id].grace_period_expires_at))) {
            groupedByUser[payment.user_id] = payment;
        }
    });

    // Calculate grace period details for each user
    Object.keys(groupedByUser).forEach((userId) => {
        const payment = groupedByUser[userId];
        const expiry = moment(payment.grace_period_expires_at);
        const daysRemaining = expiry.diff(moment(), 'days');

        gracePeriodMap[userId] = {
            isInGracePeriod: daysRemaining > 0,
            daysRemaining: Math.max(0, daysRemaining),
            gracePeriodEnd: expiry.format('YYYY-MM-DD'),
            gracePeriodStatus: getGracePeriodStatus(daysRemaining)
        };
    });

    // Set default values for users without grace period
    subscriptionUserIds.forEach((userId) => {
        if (!gracePeriodMap[userId]) {
            gracePeriodMap[userId] = {
                isInGracePeriod: false,
                daysRemaining: 0,
                gracePeriodEnd: null,
                gracePeriodStatus: 'none'
            };
        }
    });

    return gracePeriodMap;
}

// Helper function to fetch completed lessons map
async function fetchCompletedLessonsMap(rows) {
    if (rows.length === 0) return {};

    const subscriptions = rows
        .map((s) => s.UserSubscriptions?.[0])
        .filter(Boolean);

    if (subscriptions.length === 0) return {};

    // Calculate subscription date ranges
    const subscriptionRanges = subscriptions.map((sub) => {
        let startDate, endDate;

        if (sub.renew_date) {
            endDate = moment(sub.renew_date).endOf('day').toDate();
            startDate = sub.created_at
                ? moment(sub.created_at).startOf('day').toDate()
                : moment(sub.renew_date).subtract(sub.each_lesson || 1, 'months').startOf('day').toDate();
        } else {
            startDate = sub.created_at
                ? moment(sub.created_at).startOf('day').toDate()
                : moment().startOf('day').toDate();
            endDate = moment().endOf('day').toDate();
        }

        return {
            subscriptionId: sub.id,
            userId: sub.user_id,
            startDate,
            endDate
        };
    });

    const allStudentIds = [...new Set(subscriptionRanges.map((r) => r.userId))];

    // Fetch all classes for these students
    const allClasses = await Class.findAll({
        where: {
            student_id: { [Op.in]: allStudentIds },
            is_regular_hide: 0,
            status: { [Op.in]: ['ended', 'pending', 'started'] }
        },
        attributes: ['id', 'student_id', 'meeting_start'],
        raw: true
    });

    // Group classes by student for efficient lookup
    const classesByStudent = {};
    for (const cls of allClasses) {
        if (!classesByStudent[cls.student_id]) {
            classesByStudent[cls.student_id] = [];
        }
        classesByStudent[cls.student_id].push(cls);
    }

    // Count completed lessons for each subscription
    const completedLessonsMap = {};
    for (const range of subscriptionRanges) {
        const studentClasses = classesByStudent[range.userId] || [];
        const count = studentClasses.filter(
            (cls) => cls.meeting_start >= range.startDate && cls.meeting_start <= range.endDate
        ).length;
        completedLessonsMap[range.subscriptionId] = count || 0;
    }

    return completedLessonsMap;
}

// Helper function to fetch next classes map
async function fetchNextClassesMap(userIds, teacherId) {
    if (userIds.length === 0 || teacherId !== 'all') return {};

    const nextClasses = await Class.findAll({
        where: {
            student_id: { [Op.in]: userIds },
            status: 'pending',
            meeting_start: { [Op.gte]: Sequelize.fn('NOW') }
        },
        attributes: ['id', 'student_id', 'meeting_start', 'status'],
        include: [{
            model: User,
            as: 'Teacher',
            attributes: ['id', 'full_name', 'email']
        }],
        order: [['meeting_start', 'ASC']],
        raw: false
    });

    const nextClassesMap = {};
    const groupedByStudent = {};

    // Keep only the earliest class for each student
    nextClasses.forEach((cls) => {
        const studentId = cls.student_id;
        if (!groupedByStudent[studentId] ||
            moment(cls.meeting_start).isBefore(moment(groupedByStudent[studentId].meeting_start))) {
            groupedByStudent[studentId] = cls;
        }
    });

    Object.keys(groupedByStudent).forEach((studentId) => {
        nextClassesMap[studentId] = groupedByStudent[studentId];
    });

    return nextClassesMap;
}

// Helper function to fetch summary statistics
async function fetchSummaryStats() {
    const [activeStudents, pendingPayments, upcomingLessons] = await Promise.all([
        User.count({ where: { role_name: 'user', status: 'active' } }),
        UserSubscriptionDetails.count({ where: { payment_status: 'pending' } }),
        Class.count({
            where: {
                status: 'pending',
                meeting_start: { [Op.gte]: Sequelize.fn('NOW') }
            }
        })
    ]);

    return { activeStudents, pendingPayments, upcomingLessons };
}

// Helper function to clean phone number (remove everything after + including +)
function cleanPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return phone;
    }
    // Remove everything after + (including the + sign itself)
    const plusIndex = phone.indexOf('+');
    if (plusIndex !== -1) {
        return phone.substring(0, plusIndex).trim();
    }
    return phone.trim();
}

// Helper function to clean email (remove everything after + including +)
function cleanEmail(email) {
    if (!email || typeof email !== 'string') {
        return email;
    }
    // Remove everything after + (including the + sign itself)
    const plusIndex = email.indexOf('+');
    if (plusIndex !== -1) {
        return email.substring(0, plusIndex).trim();
    }
    return email.trim();
}

// Helper function to build student response object
function buildStudentResponse(student, data) {
    const {
        nextClassesMap,
        paymentData,
        subscriptionData,
        lessonsData,
        subscriptionDurations,
        gracePeriodInfoMap,
        completedLessonsMap,
        isExport = false
    } = data;

    const subscription = student.LatestSubscription;
    const nextClass = student.StudentClasses?.[0] || nextClassesMap[student.id] || null;
    const latestPayment = student.StudentPayments?.[0];

    const subscriptionDuration = subscriptionDurations[student.id] || {
        total_months: 0,
        total_days: 0,
        human_readable: 'First active month',
        exact_duration: 'N/A'
    };

    const gracePeriodInfo = subscription && subscription.user_id
        ? gracePeriodInfoMap[subscription.user_id] || getDefaultGracePeriod()
        : getDefaultGracePeriod();

    const completedLessons = subscription && subscription.id ? completedLessonsMap[subscription.id] || 0 : 0;

    const nextLessonDate = buildNextLessonDate(nextClass, student.timezone);
    const paymentInfo = buildPaymentInfo(subscription, latestPayment, student.id, paymentData);
    const subscriptionInfo = buildSubscriptionInfo(subscription, completedLessons, subscriptionDuration, gracePeriodInfo);
    const nextLessonInfo = buildNextLessonInfo(subscription, nextClass, nextLessonDate, student.id, subscriptionData, lessonsData);

    return {
        id: student.id,
        full_name: student.full_name,
        mobile: isExport ? cleanPhoneNumber(student.mobile) : student.mobile,
        email: student.email,
        teacher_name: nextClass?.Teacher?.full_name,
        teacher_email: nextClass?.Teacher?.email,
        timezone: student.timezone,
        role: { name: student.role_name, id: student.role_id },
        registration: {
            date: student.created_at,
            status: student.status || 'N/A',
            verified: student.verified,
            is_parent: student.is_parent
        },
        subscription: subscriptionInfo,
        payment: paymentInfo,
        next_lesson: nextLessonInfo
    };
}

// Helper function to build next lesson date
function buildNextLessonDate(nextClass, timezone) {
    if (!nextClass || !nextClass.meeting_start) return null;

    const utcDate = moment.utc(nextClass.meeting_start);
    return {
        israel: utcDate.tz('Asia/Jerusalem').format('YYYY-MM-DD HH:mm:ss'),
        user: timezone ? utcDate.tz(timezone).format('YYYY-MM-DD HH:mm:ss') : null,
        utc: utcDate.format('YYYY-MM-DD HH:mm:ss')
    };
}

// Helper function to build payment information
function buildPaymentInfo(subscription, latestPayment, studentId, paymentData) {
    if (!subscription) return null;

    const { totalPaidMap, lastPaymentDateMap, lastPaymentDetailsMap, paymentTypeFinal } = paymentData;
    
    // Use the latest payment details from paymentData if available (based on date), otherwise fall back to latestPayment from association
    const actualLatestPayment = lastPaymentDetailsMap[studentId] || latestPayment;
    
    let paymentInfo;

    if (subscription.payment_status === 'offline') {
        paymentInfo = {
            status: 'offline',
            type: 'offline',
            date: subscription.offline_payment_date
                ? moment(subscription.offline_payment_date).format('MM/DD/YY')
                : moment(subscription.created_at).format('MM/DD/YY'),
            renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : 'N/A',
            reason: subscription.offline_payment_reason || 'Offline payment processed by admin',
            processed_by: subscription.OfflinePaymentAdmin?.full_name || 'Admin',
            amount: subscription.cost_per_lesson * subscription.weekly_lesson || 0,
            method: 'offline'
        };
    } else if (subscription.payment_status === 'online' && actualLatestPayment) {
        paymentInfo = {
            status: 'paid',
            type: 'online',
            date: moment(actualLatestPayment.created_at).format('MM/DD/YY'),
            renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : 'N/A',
            amount: actualLatestPayment.amount,
            currency: actualLatestPayment.currency || 'ILS',
            method: actualLatestPayment.payment_method || 'credit_card',
            transaction_id: actualLatestPayment.transaction_id,
            card_digits: actualLatestPayment.card_last_digits
        };
    } else if (!actualLatestPayment) {
        paymentInfo = {
            status: subscription.payment_status || 'offline',
            type: 'offline',
            method: 'offline',
            payment_type: 'offline',
            renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : null,
            date: subscription.created_at ? moment(subscription.created_at).format('MM/DD/YY') : null
        };
    } else {
        paymentInfo = {
            status: subscription.payment_status || 'pending',
            type: 'unknown',
            date: subscription.created_at ? moment(subscription.created_at).format('MM/DD/YY') : 'N/A',
            renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : 'N/A',
            amount: 0,
            method: 'unknown'
        };
    }

    // Add aggregated payment data
    paymentInfo.total_paid_amount = Number((totalPaidMap[studentId] || 0).toFixed(2));
    paymentInfo.last_payment_date = lastPaymentDateMap[studentId]
        ? moment(lastPaymentDateMap[studentId]).format('MM/DD/YY')
        : null;

    const summaryType = paymentTypeFinal[studentId];
    paymentInfo.payment_type = summaryType === 'credit_card' ? 'credit_card'
        : summaryType === 'offline' ? 'offline'
        : summaryType === 'online' ? 'online'
        : 'No payments made';

    // Return null if no payment activity
    if (paymentInfo.total_paid_amount === 0 &&
        !paymentInfo.last_payment_date &&
        paymentInfo.payment_type === 'No payments made') {
        return null;
    }

    return paymentInfo;
}

// Helper function to build subscription information
function buildSubscriptionInfo(subscription, completedLessons, subscriptionDuration, gracePeriodInfo) {
    if (!subscription) return null;

    const subscriptionTotalDays = subscription.created_at && (subscription.cancellation_date || subscription.renew_date)
        ? moment(subscription.cancellation_date || subscription.renew_date).diff(moment(subscription.created_at), 'days')
        : null;

    return {
        id: subscription.id,
        type: subscription.type,
        subscription_type: subscription.type,
        created_at: subscription.created_at ? moment(subscription.created_at).format('MM/DD/YY') : 'N/A',
        total_duration: subscriptionTotalDays,
        lessons: `${completedLessons}/${subscription.weekly_lesson || 0}`,
        period: `${subscription.each_lesson || 0} months`,
        unused: `${subscription.left_lessons || 0} lessons`,
        renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : 'N/A',
        status: subscription.status,
        balance: subscription.balance,
        cost_per_lesson: subscription.cost_per_lesson,
        payment_status: subscription.payment_status,
        duration: subscriptionDuration,
        cancellation_date: subscription.cancellation_date ? moment(subscription.cancellation_date).format('MM/DD/YY') : null,
        cancellation_reason: subscription.cancellation_reason,
        cancelled_by_user_id: subscription.cancelled_by_user_id,
        is_cancel: subscription.is_cancel,
        inactive_after_renew: subscription.inactive_after_renew,
        grace_period_days: gracePeriodInfo.daysRemaining,
        grace_period_expires_at: gracePeriodInfo.gracePeriodEnd,
        grace_period_status: gracePeriodInfo.gracePeriodStatus,
        is_in_grace_period: gracePeriodInfo.isInGracePeriod,
        display: {
            lessons: `${completedLessons}/${subscription.weekly_lesson || 0} lessons`,
            period: `${subscription.each_lesson || 0} months (${subscription.each_lesson || 0} months)`,
            unused: `${subscription.left_lessons || 0} lessons`
        }
    };
}

// Helper function to build next lesson information
function buildNextLessonInfo(subscription, nextClass, nextLessonDate, studentId, subscriptionData, lessonsData) {
    if (!subscription) return null;

    if (subscription.status === 'inactive') {
        const { totalLessonsPaidMap } = subscriptionData;
        const { lessonsUsedMap } = lessonsData;

        return {
            summary: {
                total_lessons_paid: totalLessonsPaidMap[studentId] || 0,
                lessons_used: lessonsUsedMap[studentId] || 0,
                lessons_left: Math.max((totalLessonsPaidMap[studentId] || 0) - (lessonsUsedMap[studentId] || 0), 0)
            }
        };
    }

    if (nextClass) {
        return {
            id: nextClass.id,
            date: nextLessonDate,
            teacher: nextClass.Teacher?.full_name || 'N/A',
            status: nextClass.status
        };
    }

    return null;
}

// Helper function to build empty response
function buildEmptyResponse(page, limit) {
    return {
        status: 'success',
        message: 'Users fetched successfully',
        data: {
            students: [],
            pagination: {
                total: 0,
                current_page: parseInt(page),
                total_pages: 0,
                per_page: parseInt(limit)
            },
            summary: {
                activeStudents: 0,
                pendingPayments: 0,
                upcomingLessons: 0
            }
        }
    };
}

// Helper function to get default grace period
function getDefaultGracePeriod() {
    return {
        isInGracePeriod: false,
        daysRemaining: 0,
        gracePeriodEnd: null,
        gracePeriodStatus: 'none'
    };
}

async function getStudentGraphsAndTrends(req, res) {
    try {
        const { subscrptionType = 'All Types', timeDuration = 'monthly' } = req.query;

        //  Date filter based on duration
        const today = new Date();
        const startDate = new Date();
        if (timeDuration === 'monthly') startDate.setMonth(today.getMonth() - 1);
        else if (timeDuration === 'quarterly') startDate.setMonth(today.getMonth() - 3);
        else if (timeDuration === 'yearly') startDate.setFullYear(today.getFullYear() - 1);

        const dateFilter = { created_at: { [Op.gte]: startDate } };

        const typeFilter = subscrptionType && subscrptionType.toLowerCase() !== 'all types' ? { type: subscrptionType } : {};

        const subscriptionDataRaw = await UserSubscriptionDetails.findAll({
            where: {
                ...dateFilter,
                ...typeFilter,
                [Op.or]: [{ status: 'active' }, { status: 'Active' }, { status: 1 }, { status: true }]
            },
            attributes: [
                [fn('CONCAT', col('type'), ' ', col('lesson_min'), ' min'), 'name'],
                [fn('COUNT', col('id')), 'active'],
                [fn('SUM', literal(`CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END`)), 'new'],
                [fn('SUM', col('cost_per_lesson')), 'revenue']
            ],
            group: ['type', 'lesson_min'],
            order: [['type', 'ASC']]
        });

        const subscriptionData =
            subscriptionDataRaw.length > 0
                ? subscriptionDataRaw.map((item) => ({
                      name: item.get('name'),
                      active: parseInt(item.get('active')) || 0,
                      new: parseInt(item.get('new')) || 0,
                      revenue: parseFloat(item.get('revenue')) || 0
                  }))
                : [];

    // Daily class trend data (approximated from created_at)
        const dailyClassesRaw = await UserSubscriptionDetails.findAll({
            where: { ...dateFilter },
            attributes: [
                [fn('DATE', col('created_at')), 'date'],
                [fn('SUM', literal(`CASE WHEN lesson_min = 25 THEN 1 ELSE 0 END`)), '25min'],
                [fn('SUM', literal(`CASE WHEN lesson_min = 40 THEN 1 ELSE 0 END`)), '40min'],
                [fn('SUM', literal(`CASE WHEN lesson_min = 55 THEN 1 ELSE 0 END`)), '55min']
            ],
            group: [fn('DATE', col('created_at'))],
            order: [[fn('DATE', col('created_at')), 'ASC']]
        });

    const dailyClassesData = dailyClassesRaw.map(row => ({
            date: moment(row.get('date')).format('YYYY-MM-DD'),
            '25min': parseInt(row.get('25min')) || 0,
            '40min': parseInt(row.get('40min')) || 0,
            '55min': parseInt(row.get('55min')) || 0
        }));

    //  Subscriptions vs cancellations (monthly)
        const subVsCancelRaw = await UserSubscriptionDetails.findAll({
            attributes: [
                [fn('MONTHNAME', col('created_at')), 'month'],
                [fn('COUNT', col('id')), 'subscriptions'],
                [fn('SUM', literal(`CASE WHEN is_cancel = 1 THEN 1 ELSE 0 END`)), 'cancellations']
            ],
            group: [fn('MONTHNAME', col('created_at'))],
            order: [[fn('MIN', col('created_at')), 'ASC']]
        });

    const subVsCancelData = subVsCancelRaw.map(row => ({
            month: row.get('month'),
            subscriptions: parseInt(row.get('subscriptions')) || 0,
            cancellations: parseInt(row.get('cancellations')) || 0
        }));

    // Final JSON response
        return res.status(200).json({
            status: 'success',
            message: 'Student graph and trend data fetched successfully',
            data: {
                subscriptionData,
                dailyClassesData,
                subVsCancelData
            }
        });
    } catch (err) {
        console.error('Error fetching student graphs and trends:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch student graph and trend data',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
/**
 * Calculate days remaining in grace period
 * @param {Date|String} gracePeriodExpiresAt - Grace period expiration date
 * @returns {Number} - Days remaining (0 if expired)
 */
const calculateGracePeriodDays = (gracePeriodExpiresAt) => {
    if (!gracePeriodExpiresAt) return 0;

    const now = moment();
    const expiryDate = moment(gracePeriodExpiresAt);
    const daysRemaining = expiryDate.diff(now, 'days');

    return Math.max(0, daysRemaining);
};

/**
 * Get grace period status
 * @param {Number} daysRemaining - Days remaining in grace period
 * @returns {String} - Status: 'normal', 'expiring_soon', or 'expired'
 */
const getGracePeriodStatus = (daysRemaining) => {
    if (daysRemaining <= 0) return 'expired';
    if (daysRemaining <= 7) return 'expiring_soon';
    return 'normal';
};

/**
 * Determine grace period using PastDuePayment as source of truth.
 * Falls back to renew_date + 30 days when no past-due record exists.
 */
const getGracePeriodInfo = async (subscription) => {
    try {
        if (subscription && subscription.user_id) {
            const activePastDue = await PastDuePayment.findOne({
                where: {
                    user_id: subscription.user_id,
                    status: 'past_due',
                    grace_period_expires_at: { [Op.ne]: null }
                },
                order: [['grace_period_expires_at', 'DESC']]
            });

            if (activePastDue && activePastDue.grace_period_expires_at) {
                const expiry = moment(activePastDue.grace_period_expires_at);
                const daysRemaining = expiry.diff(moment(), 'days');
                return {
                    isInGracePeriod: daysRemaining > 0,
                    daysRemaining: Math.max(0, daysRemaining),
                    gracePeriodEnd: expiry.format('YYYY-MM-DD'),
                    gracePeriodStatus: getGracePeriodStatus(daysRemaining)
                };
            }
        }

        // No active past due record => no grace period
        return {
            isInGracePeriod: false,
            daysRemaining: 0,
            gracePeriodEnd: null,
            gracePeriodStatus: 'none'
        };
    } catch (error) {
        console.error('Error computing grace period info:', error);
        return {
            isInGracePeriod: false,
            daysRemaining: 0,
            gracePeriodEnd: null,
            gracePeriodStatus: 'expired'
        };
    }
};


/**
 * Calculate completed lessons for a subscription based on actual classes
 * @param {Object} subscription - Subscription object with user_id and renew_date
 * @returns {Number} - Number of completed lessons in the current subscription period
 */
async function getCompletedLessonsForSubscription(subscription) {
    try {
        if (!subscription || !subscription.user_id) {
            return 0;
        }

        // Get the subscription period start and end dates
        let startDate = null;
        let endDate = null;

        // If renew_date exists, use it as the end date
        if (subscription.renew_date) {
            endDate = moment(subscription.renew_date).endOf('day').toDate();
            
            // Use created_at as start date if available, otherwise calculate from renew_date
            if (subscription.created_at) {
                startDate = moment(subscription.created_at).startOf('day').toDate();
            } else {
                // Calculate start date: go back by the subscription period (each_lesson months)
                const periodMonths = subscription.each_lesson || 1;
                startDate = moment(subscription.renew_date).subtract(periodMonths, 'months').startOf('day').toDate();
            }
        } else {
            // If no renew_date, use created_at as start and current date as end
            startDate = subscription.created_at ? moment(subscription.created_at).startOf('day').toDate() : moment().startOf('day').toDate();
            endDate = moment().endOf('day').toDate();
        }

        // Count classes in the subscription period
        const completedLessons = await Class.count({
            where: {
                student_id: subscription.user_id,
                is_regular_hide: 0,
                meeting_start: {
                    [Op.gte]: startDate,
                    [Op.lte]: endDate
                },
                status: {
                    [Op.in]: ['ended', 'pending','started']
                }
            }
        });

        return completedLessons || 0;
    } catch (error) {
        console.error('Error calculating completed lessons for subscription:', error);
        return 0;
    }
}

/**
 * Get subscription durations for multiple users efficiently
 * @param {Array} userIds - Array of user IDs
 * @returns {Object} - Object with user_id as key and duration info as value
 */
async function getSubscriptionDurationsForUsers(userIds) {
    if (!userIds || userIds.length === 0) {
        return {};
    }

    try {
        // Get the earliest subscription for each user
        const earliestSubscriptions = await UserSubscriptionDetails.findAll({
            attributes: [
                'user_id',
                [Sequelize.fn('MIN', Sequelize.col('created_at')), 'first_subscription_date']
            ],
            where: {
                user_id: { [Op.in]: userIds },
                created_at: { [Op.ne]: null }
            },
            group: ['user_id'],
            raw: true
        });

        const durations = {};

        earliestSubscriptions.forEach(record => {
            const userId = record.user_id;
            const firstSubscriptionDate = moment(record.first_subscription_date);
            const now = moment();

            // Calculate the difference
            const totalDays = now.diff(firstSubscriptionDate, 'days');
            const totalMonths = now.diff(firstSubscriptionDate, 'months');
            const totalYears = now.diff(firstSubscriptionDate, 'years');

            // Create human-readable format
            let humanReadable = '';
            let exactDuration = '';

            if (totalYears >= 1) {
                const remainingMonths = totalMonths - (totalYears * 12);
                if (remainingMonths > 0) {
                    humanReadable = `subscribed for the past ${totalYears} year${totalYears > 1 ? 's' : ''} and ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`;
                    exactDuration = `${totalYears}y ${remainingMonths}m`;
                } else {
                    humanReadable = `subscribed for the past ${totalYears} year${totalYears > 1 ? 's' : ''}`;
                    exactDuration = `${totalYears}y`;
                }
            } else if (totalMonths >= 1) {
                humanReadable = `subscribed for the past ${totalMonths} month${totalMonths > 1 ? 's' : ''}`;
                exactDuration = `${totalMonths}m`;
            } else {
                // For anything less than a month (including same day)
                humanReadable = 'subscribed for less than a month';
                exactDuration = '<1m';
            }

            durations[userId] = {
                total_months: totalMonths,
                total_days: totalDays,
                human_readable: humanReadable,
                exact_duration: exactDuration
            };
        });

        return durations;
    } catch (error) {
        console.error('Error calculating subscription durations:', error);
        return {};
    }
}

async function getStudentDetails(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            },
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    order: [['id', 'DESC']],
                    limit: 1,
                    separate: true
                },
                {
                    model: Class,
                    as: 'StudentClasses',
                    required: false,
                    where: {
                        meeting_start: {
                            [Op.gte]: Sequelize.fn('NOW')
                        }
                    },
                    order: [['meeting_start', 'ASC']],
                    limit: 1,
                    include: [{
                            model: User,
                            as: 'Teacher',
                            attributes: ['id', 'full_name']
                    }]
                        }
            ],
            attributes: [
                'id', 'full_name', 'email', 'mobile', 'status',
                'created_at', 'is_parent', 'verified', 'role_name', 
                'role_id', 'timezone' , 'country_code'
                    ]
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const subscription = student.UserSubscriptions?.[0];
        const nextClass = student.StudentClasses?.[0];

        let nextLessonDate = null;
        if (nextClass && nextClass.meeting_start) {
            const utcDate = moment.utc(nextClass.meeting_start);
            nextLessonDate = {
                israel: utcDate.tz('Asia/Jerusalem').format('YYYY-MM-DD HH:mm:ss'),
                user: student.timezone ? utcDate.tz(student.timezone).format('YYYY-MM-DD HH:mm:ss') : null,
                utc: utcDate.format('YYYY-MM-DD HH:mm:ss')
            };
        }
        // Calculate grace period information
        const gracePeriodInfo = await getGracePeriodInfo(subscription);

        // Calculate completed lessons based on actual classes
        let completedLessons = 0;
        if (subscription) {
            completedLessons = await getCompletedLessonsForSubscription(subscription);
        }

        const formattedStudent = {
            id: student.id,
            full_name: student.full_name,
            mobile: student.mobile,
            country_code: student.country_code,
            email: student.email,
            timezone: student.timezone,
            role: {
                name: student.role_name,
                id: student.role_id
            },
            registration: {
                date: student.created_at,
                status: student.status || 'N/A',
                verified: student.verified,
                is_parent: student.is_parent
            },
            subscription: subscription ? {
                      id: subscription.id,
                      type: subscription.type,
                      subscription_type: subscription.type,
                      lessons: `${completedLessons}/${subscription.weekly_lesson || 0} lessons`,
                      period: `${subscription.each_lesson || 0} months (${subscription.each_lesson || 0} months)`,
                      unused: `${subscription.left_lessons || 0} lessons`,
                      renews: subscription.renew_date ? moment(subscription.renew_date).format('MM/DD/YY') : 'N/A',
                      status: subscription.status,
                      balance: subscription.balance,
                      cost_per_lesson: subscription.cost_per_lesson,
                      payment_status: subscription.payment_status,
                      duration: subscription.lesson_min,
                      cancellation_date: subscription.cancellation_date,
                      cancellation_reason: subscription.cancellation_reason,
                      cancelled_by_user_id: subscription.cancelled_by_user_id,
                      is_cancel: subscription.is_cancel,
                      inactive_after_renew: subscription.inactive_after_renew,
                      grace_period_days: gracePeriodInfo.daysRemaining,
                      grace_period_expires_at: gracePeriodInfo.gracePeriodEnd,
                      grace_period_status: gracePeriodInfo.gracePeriodStatus,
                      is_in_grace_period: gracePeriodInfo.isInGracePeriod,

                      display: {
                          lessons: `${completedLessons}/${subscription.weekly_lesson || 0} lessons`,
                          period: `${subscription.each_lesson || 0} months (${subscription.each_lesson || 0} months)`,
                          unused: `${subscription.left_lessons || 0} lessons`
                      }
            } : null,
            next_lesson: nextClass ? {
                      id: nextClass.id,
                      date: nextLessonDate,
                      teacher: nextClass.Teacher?.full_name || 'N/A',
                      status: nextClass.status
            } : null
        };

        return res.status(200).json({
            status: 'success',
            message: 'Student details fetched successfully',
            data: formattedStudent
        });

    } catch (err) {
        console.error('Error fetching student details:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch student details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// NEW: Get attendance statistics
async function getAttendanceStatistics(req, res) {
    try {
        const {
            studentId,
            teacherId,
            months = 6,
            startDate,
            endDate
        } = req.query;

        let whereConditions = {};
        let dateCondition = {};

        // Filter by student if provided
        if (studentId) {
            whereConditions.student_id = studentId;
        }

        // Filter by teacher if provided
        if (teacherId) {
            whereConditions.teacher_id = teacherId;
        }

        // Date range conditions
        if (startDate && endDate) {
            dateCondition = {
                meeting_start: {
                    [Op.between]: [
                        moment(startDate, 'YYYY-MM-DD').startOf('day').toDate(),
                        moment(endDate, 'YYYY-MM-DD').endOf('day').toDate()
                    ]
                }
            };
        } else {
            // Default to last N months
            const monthsBack = parseInt(months) || 6;
            dateCondition = {
                meeting_start: {
                    [Op.gte]: moment().subtract(monthsBack, 'months').startOf('month').toDate()
                }
            };
        }

        // Combine conditions
        whereConditions = { ...whereConditions, ...dateCondition };

        // Get all classes with the specified conditions
        const classes = await Class.findAll({
            where: whereConditions,
            attributes: [
                'status',
                'meeting_start',
                'created_at',
                'updated_at',
                'is_present',
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), '%Y-%m'), 'month_year'],
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), '%b'), 'month_name']
            ],
            order: [['meeting_start', 'ASC']]
        });

        // Group data by month
        const monthlyData = {};

        classes.forEach(classItem => {
            const monthKey = classItem.dataValues.month_year;
            const monthName = classItem.dataValues.month_name;

            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                    month: monthName,
                    attended: 0,
                    canceled: 0,
                    rescheduled: 0,
                    total: 0
                };
            }

            monthlyData[monthKey].total++;

            // Count by status with new logic
            const createdAt = classItem.created_at;
            const updatedAt = classItem.updated_at;
            const isPresent = classItem.is_present;
            const status = classItem.status;

            // Check if class was rescheduled (created_at != updated_at)
            if (createdAt !== updatedAt) {
                monthlyData[monthKey].rescheduled++;
            }
            // Check if class was canceled
            else if (status === 'canceled' || status === 'cancelled') {
                monthlyData[monthKey].canceled++;
            }
            // Check if class was attended (is_present = 1 AND status = 'ended')
            else if (isPresent === 1 && status === 'ended') {
                monthlyData[monthKey].attended++;
            }
            else {
                // For pending/other statuses, we don't count them in any category
                monthlyData[monthKey].total--;
            }
        });

        // Convert to array format and ensure we have data for recent months
        const result = [];
        const sortedMonths = Object.keys(monthlyData).sort();

        // Fill in any missing months with zero data
        const startMonth = moment().subtract(parseInt(months) || 6, 'months');
        const endMonth = moment();

        for (let m = moment(startMonth); m.isSameOrBefore(endMonth, 'month'); m.add(1, 'month')) {
            const monthKey = m.format('YYYY-MM');
            const monthName = m.format('MMM');

            if (monthlyData[monthKey]) {
                result.push(monthlyData[monthKey]);
            } else {
                result.push({
                    month: monthName,
                    attended: 0,
                    canceled: 0,
                    rescheduled: 0,
                    total: 0
                });
            }
        }

        // Calculate summary statistics
        const totalClasses = result.reduce((sum, month) => sum + month.total, 0);
        const totalAttended = result.reduce((sum, month) => sum + month.attended, 0);
        const totalCanceled = result.reduce((sum, month) => sum + month.canceled, 0);
        const totalRescheduled = result.reduce((sum, month) => sum + month.rescheduled, 0);

        const summary = {
            totalClasses,
            attendanceRate: totalClasses > 0 ? Math.round((totalAttended / totalClasses) * 100) : 0,
            cancellationRate: totalClasses > 0 ? Math.round((totalCanceled / totalClasses) * 100) : 0,
            rescheduleRate: totalClasses > 0 ? Math.round((totalRescheduled / totalClasses) * 100) : 0
        };

        return res.status(200).json({
            status: 'success',
            message: 'Attendance statistics fetched successfully',
            data: result,
            summary: summary
        });

    } catch (err) {
        console.error('Error fetching attendance statistics:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch attendance statistics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// NEW: Get progress statistics with updated attendance logic
async function getProgressStatistics(req, res) {
    try {
        const {
            studentId,
            teacherId,
            months = 6,
            startDate,
            endDate
        } = req.query;

        let whereConditions = {};
        let dateCondition = {};

        // Filter by student if provided
        if (studentId) {
            whereConditions.student_id = studentId;
        }

        // Filter by teacher if provided
        if (teacherId) {
            whereConditions.teacher_id = teacherId;
        }

        // Date range conditions
        if (startDate && endDate) {
            dateCondition = {
                meeting_start: {
                    [Op.between]: [moment(startDate, 'YYYY-MM-DD').startOf('day').toDate(), moment(endDate, 'YYYY-MM-DD').endOf('day').toDate()]
                }
            };
        } else {
            // Default to last N months
            const monthsBack = parseInt(months) || 6;
            dateCondition = {
                meeting_start: {
                    [Op.gte]: moment().subtract(monthsBack, 'months').startOf('month').toDate()
                }
            };
        }

        // Combine conditions
        whereConditions = { ...whereConditions, ...dateCondition };

        // Get attendance data for progress calculation
        const classes = await Class.findAll({
            where: whereConditions,
            attributes: [
                'status',
                'meeting_start',
                'student_id',
                'teacher_id',
                'created_at',
                'updated_at',
                'is_present',
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), '%Y-%m'), 'month_year'],
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('meeting_start'), '%b'), 'month_name']
            ],
            order: [['meeting_start', 'ASC']]
        });

        // Get subscription data for utilization calculation
        let subscriptionData = [];
        if (studentId) {
            subscriptionData = await UserSubscriptionDetails.findAll({
                where: {
                    user_id: studentId,
                    created_at: {
                        [Op.gte]: moment()
                            .subtract(parseInt(months) || 6, 'months')
                            .unix()
                    }
                },
                attributes: ['weekly_lesson', 'left_lessons', 'created_at', 'renew_date'],
                order: [['created_at', 'ASC']]
            });
        }

        // Get teacher feedback data
        let feedbackData = [];
        if (studentId) {
            const feedbackConditions = {
                creator_id: studentId
            };

            if (startDate && endDate) {
                feedbackConditions.created_at = {
                    [Op.between]: [moment(startDate, 'YYYY-MM-DD').startOf('day').unix(), moment(endDate, 'YYYY-MM-DD').endOf('day').unix()]
                };
            } else {
                feedbackConditions.created_at = {
                    [Op.gte]: moment()
                        .subtract(parseInt(months) || 6, 'months')
                        .unix()
                };
            }

            feedbackData = await UserReview.findAll({
                where: feedbackConditions,
                attributes: ['rates', 'created_at'],
                order: [['created_at', 'ASC']]
            });
        }

        // Process data by month
        const monthlyProgress = {};

        // Initialize months
        const startMonth = moment().subtract(parseInt(months) || 6, 'months');
        const endMonth = moment();

        for (let m = moment(startMonth); m.isSameOrBefore(endMonth, 'month'); m.add(1, 'month')) {
            const monthKey = m.format('YYYY-MM');
            const monthName = m.format('MMM');

            monthlyProgress[monthKey] = {
                month: monthName,
                score: 0,
                breakdown: {
                    attendance: 0,
                    completion: 0,
                    feedback: 0,
                    utilization: 0
                }
            };
        }

        // Calculate monthly attendance scores (40% weight) with updated logic
        const monthlyClasses = {};
        classes.forEach((classItem) => {
            const monthKey = classItem.dataValues.month_year;

            if (!monthlyClasses[monthKey]) {
                monthlyClasses[monthKey] = {
                    total: 0,
                    attended: 0,
                    completed: 0
                };
            }

            monthlyClasses[monthKey].total++;

            // Use the same logic as attendance statistics
            const createdAt = classItem.created_at;
            const updatedAt = classItem.updated_at;
            const isPresent = classItem.is_present;
            const status = classItem.status;

            // Check if class was attended (is_present = 1 AND status = 'ended')
            if (isPresent === 1 && status === 'ended') {
                monthlyClasses[monthKey].attended++;
                monthlyClasses[monthKey].completed++;
            }
            // Don't count rescheduled, canceled, or pending classes as attended
            else if (createdAt === updatedAt && (status === 'canceled' || status === 'cancelled')) {
                // Class was canceled, don't count as attended
            } else if (createdAt !== updatedAt) {
                // Class was rescheduled, don't count as attended
            } else {
                // For pending/other statuses, don't count as attended but keep in total
            }
        });

        // Calculate monthly feedback scores (20% weight)
        const monthlyFeedback = {};
        feedbackData.forEach((feedback) => {
            const feedbackDate = moment.unix(feedback.created_at);
            const monthKey = feedbackDate.format('YYYY-MM');

            if (!monthlyFeedback[monthKey]) {
                monthlyFeedback[monthKey] = {
                    totalRating: 0,
                    count: 0
                };
            }

            monthlyFeedback[monthKey].totalRating += parseFloat(feedback.rates) || 0;
            monthlyFeedback[monthKey].count++;
        });

        // Calculate progress scores for each month
        Object.keys(monthlyProgress).forEach((monthKey) => {
            const month = monthlyProgress[monthKey];

            // 1. Attendance Score (40% weight)
            const classData = monthlyClasses[monthKey];
            if (classData && classData.total > 0) {
                month.breakdown.attendance = Math.round((classData.attended / classData.total) * 100);
            } else {
                month.breakdown.attendance = 0; // No classes = 0 score
            }

            // 2. Completion Score (30% weight) - same as attendance for now
            month.breakdown.completion = month.breakdown.attendance;

            // 3. Feedback Score (20% weight)
            const feedbackMonth = monthlyFeedback[monthKey];
            if (feedbackMonth && feedbackMonth.count > 0) {
                // Convert rating (typically 1-5) to percentage
                const avgRating = feedbackMonth.totalRating / feedbackMonth.count;
                month.breakdown.feedback = Math.round((avgRating / 5) * 100);
            } else {
                // No feedback available, use attendance as proxy
                month.breakdown.feedback = month.breakdown.attendance;
            }

            // 4. Utilization Score (10% weight)
            // For now, use attendance rate as proxy for utilization
            month.breakdown.utilization = month.breakdown.attendance;

            // Calculate overall score with weights
            month.score = Math.round(month.breakdown.attendance * 0.4 + month.breakdown.completion * 0.3 + month.breakdown.feedback * 0.2 + month.breakdown.utilization * 0.1);
        });

        // Convert to array and filter out months with no data if student-specific
        const result = Object.values(monthlyProgress);

        // Calculate summary
        const scores = result.map((month) => month.score).filter((score) => score > 0);
        const averageScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        let trend = 'stable';
        if (scores.length >= 2) {
            const recentScores = scores.slice(-3); // Last 3 months
            const earlierScores = scores.slice(0, Math.max(1, scores.length - 3));
            const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
            const earlierAvg = earlierScores.reduce((a, b) => a + b, 0) / earlierScores.length;

            if (recentAvg > earlierAvg + 5) trend = 'improving';
            else if (recentAvg < earlierAvg - 5) trend = 'declining';
        }

        // Find strongest and weakest areas
        const areas = ['attendance', 'completion', 'feedback', 'utilization'];
        const areaAverages = {};
        areas.forEach((area) => {
            const areaScores = result.map((month) => month.breakdown[area]).filter((score) => score > 0);
            areaAverages[area] = areaScores.length > 0 ? areaScores.reduce((a, b) => a + b, 0) / areaScores.length : 0;
        });

        const strongestArea = Object.keys(areaAverages).reduce((a, b) => (areaAverages[a] > areaAverages[b] ? a : b));
        const weakestArea = Object.keys(areaAverages).reduce((a, b) => (areaAverages[a] < areaAverages[b] ? a : b));

        const summary = {
            averageScore,
            trend,
            strongestArea,
            weakestArea
        };

        return res.status(200).json({
            status: 'success',
            message: 'Progress statistics fetched successfully',
            data: result,
            summary: summary
        });
    } catch (err) {
        console.error('Error fetching progress statistics:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch progress statistics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateStudent(req, res) {
    try {
        const { id } = req.params;
        const { full_name, email, mobile, timezone, country_code } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            },
            attributes: ['id', 'full_name', 'email', 'mobile', 'timezone', 'guardian', 'is_parent']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        // Check if this is a child user (has guardian or formatted email)
        const isChildUser = !!(student.guardian || (student.email && student.email.includes('+')));

        // Enhanced email validation that allows spaces in alias part for formatted emails
        // Format: baseemail+alias with spaces@domain.com
        const validateEmail = (emailStr) => {
            if (!emailStr || typeof emailStr !== 'string') return false;
            
            // Check if it's a formatted email (contains +)
            if (emailStr.includes('+')) {
                const parts = emailStr.split('@');
                if (parts.length !== 2) return false;
                
                const [localPart, domain] = parts;
                const [baseEmail, alias] = localPart.split('+');
                
                // Validate base email (before +) - no spaces allowed
                if (!baseEmail || !/^[^\s@]+$/.test(baseEmail)) return false;
                
                // Validate alias (after +) - spaces are allowed
                if (!alias || alias.trim().length === 0) return false;
                
                // Validate domain - standard email domain format
                if (!domain || !/^[^\s@]+\.[^\s@]+$/.test(domain)) return false;
                
                return true;
            } else {
                // Standard email validation (no +, no spaces)
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
            }
        };
        
        if (email && !validateEmail(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        if (email && email !== student.email) {
            const existingUser = await User.findOne({
                where: {
                    email: email,
                    id: { [Op.ne]: id }
                }
            });

            if (existingUser) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email is already taken'
                });
            }
        }

        if (timezone) {
            try {
                moment.tz(timezone);
            } catch (error) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid timezone'
                });
            }
        }

        // Helper function to extract country code and components from mobile number
        const extractMobileComponents = (mobileNumber) => {
            if (!mobileNumber || typeof mobileNumber !== 'string') {
                return { countryCode: null, phoneNumber: null, fullBase: null, childSuffix: null };
            }

            const cleanMobile = mobileNumber.trim();

            // Split by '+' to separate base from child suffix
            // Format: {countryCode}{phoneNumber}+{childName}
            // Example: +972501234567+David or 972501234567+David
            let fullBase = cleanMobile;
            let childSuffix = null;

            const plusIndex = cleanMobile.lastIndexOf('+');
            if (plusIndex > 0) {
                // Not at start (country code) but later (child separator)
                // Check if there's content after the '+' (child suffix)
                const potentialSuffix = cleanMobile.substring(plusIndex + 1);
                if (potentialSuffix && potentialSuffix.length > 0) {
                    fullBase = cleanMobile.substring(0, plusIndex);
                    childSuffix = potentialSuffix;
                }
            }

            // Extract country code from fullBase
            let countryCode = null;
            let phoneNumber = fullBase;

            if (fullBase.startsWith('+')) {
                // Country code with + prefix
                // Try to match common patterns: +1 (US), +44 (UK), +91 (India), +972 (Israel), etc.
                const countryCodeMatch = fullBase.match(/^(\+\d{1,4})(.*)$/);
                if (countryCodeMatch) {
                    countryCode = countryCodeMatch[1]; // e.g., "+972"
                    phoneNumber = countryCodeMatch[2]; // e.g., "501234567"
                }
            } else if (/^\d{1,4}/.test(fullBase)) {
                // Country code without + prefix (handle this case too)
                const countryCodeMatch = fullBase.match(/^(\d{1,4})(.*)$/);
                if (countryCodeMatch) {
                    countryCode = countryCodeMatch[1]; // e.g., "972"
                    phoneNumber = countryCodeMatch[2]; // e.g., "501234567"
                }
            }

            return {
                countryCode, // e.g., "+972" or "972"
                phoneNumber, // e.g., "501234567"
                fullBase, // e.g., "+972501234567"
                childSuffix // e.g., "David" or null
            };
        };

        // Check if email was explicitly changed (not just provided with same value)
        // Use case-insensitive comparison to avoid false positives from case differences
        const emailWasChanged = email !== undefined && email && student.email && email.trim().toLowerCase() !== student.email.trim().toLowerCase();
        const nameWasChanged = full_name !== undefined && full_name !== student.full_name;
        
        let finalEmail = student.email; // Start with current email
        let finalMobile = mobile || student.mobile;
        let emailUpdatedFromName = false;
        let phoneUpdatedFromName = false;
        
        // Auto-update email/phone if name changed, email wasn't explicitly changed, and user is a child
        // IMPORTANT: Use parent's email/mobile as base (not child's current email/mobile base)
        if (nameWasChanged && !emailWasChanged && isChildUser) {
            // Get parent user to use their email/mobile as base
            let parentUser = null;
            if (student.guardian) {
                parentUser = await User.findOne({
                    where: { id: student.guardian },
                    attributes: ['id', 'email', 'mobile']
                });
            }
            
            // Update email using parent's email as base (if parent exists) or child's current email base
            const emailBase = parentUser ? parentUser.email : (student.email || '');
            
            if (emailBase && emailBase.includes('+')) {
                // Parent email is formatted - extract base part (before +)
                const parentEmailParts = emailBase.split('@');
                if (parentEmailParts.length === 2) {
                    const [parentLocalPart, parentDomain] = parentEmailParts;
                    const parentBaseEmail = parentLocalPart.split('+')[0]; // Get base email (before +)
                    
                    // Clean the new student name: remove special chars, keep spaces
                    const cleanStudentName = full_name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
                    // Use spaces in database format (as per current convention)
                    const studentNameWithSpaces = cleanStudentName.replace(/\s+/g, ' ').trim();
                    
                    if (parentBaseEmail && studentNameWithSpaces && parentDomain) {
                        finalEmail = `${parentBaseEmail}+${studentNameWithSpaces}@${parentDomain}`;
                        emailUpdatedFromName = true;
                    }
                }
            } else if (emailBase && !emailBase.includes('+')) {
                // Parent email is not formatted - use it directly as base
                const parentEmailParts = emailBase.split('@');
                if (parentEmailParts.length === 2) {
                    const [parentBaseEmail, parentDomain] = parentEmailParts;
                    
                    // Clean the new student name: remove special chars, keep spaces
                    const cleanStudentName = full_name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
                    const studentNameWithSpaces = cleanStudentName.replace(/\s+/g, ' ').trim();
                    
                    if (parentBaseEmail && studentNameWithSpaces && parentDomain) {
                        finalEmail = `${parentBaseEmail}+${studentNameWithSpaces}@${parentDomain}`;
                        emailUpdatedFromName = true;
                    }
                }
            }
            
            // Update phone using parent's mobile as base (if parent exists) or child's current mobile base
            // Use case-insensitive and format-agnostic comparison (handle hyphens vs spaces)
            let phoneWasChanged = false;
            if (mobile !== undefined && mobile && student.mobile) {
                // Normalize both phones for comparison (convert hyphens to spaces, lowercase)
                const normalizePhoneForComparison = (phoneStr) => {
                    if (!phoneStr) return '';
                    return phoneStr.replace(/-/g, ' ').toLowerCase().trim();
                };
                const normalizedRequestPhone = normalizePhoneForComparison(mobile);
                const normalizedCurrentPhone = normalizePhoneForComparison(student.mobile);
                phoneWasChanged = normalizedRequestPhone !== normalizedCurrentPhone;
            }
            
            if (!phoneWasChanged) {
                // Get parent's mobile as base
                const mobileBase = parentUser ? parentUser.mobile : student.mobile || '';

                if (mobileBase) {
                    // Extract base phone (remove any existing +childname suffix)
                    let basePhone = mobileBase;
                    if (mobileBase.includes('+')) {
                        basePhone = mobileBase.split('+')[0]; // Get base phone (before +)
                    }

                    // If country_code is provided in req.body, use it to update the base phone
                    if (country_code) {
                        const newCountryCode = country_code.startsWith('+') ? country_code : `+${country_code}`;
                        // Extract phone number without country code
                        const phoneComponents = extractMobileComponents(basePhone);
                        const phoneNumber = phoneComponents.phoneNumber || basePhone.replace(/^\+?\d{1,4}/, '');
                        basePhone = `${newCountryCode}${phoneNumber}`;
                        console.log(`   📱 Using country code from req.body: ${newCountryCode}`);
                        console.log(`   📱 Updated base phone: ${basePhone}`);
                    }

                    // Clean the new student name: remove special chars, keep spaces
                    const cleanStudentName = full_name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
                    // Use spaces in database format (as per current convention)
                    const studentNameWithSpaces = cleanStudentName.replace(/\s+/g, ' ').trim();
                    
                    if (basePhone && studentNameWithSpaces) {
                        finalMobile = `${basePhone}+${studentNameWithSpaces}`;
                        // Ensure phone doesn't exceed 32 characters
                        if (finalMobile.length > 32) {
                            const maxNameLength = 32 - basePhone.length - 1; // -1 for the '+' separator
                            const truncatedName = studentNameWithSpaces.substring(0, Math.max(0, maxNameLength));
                            finalMobile = `${basePhone}+${truncatedName}`;
                        }
                        phoneUpdatedFromName = true;
                    }
                }
            }
        } else if (email && emailWasChanged) {
            // Email was explicitly changed - normalize it (convert hyphens to spaces for database format)
            let normalizedEmail = email;
            if (normalizedEmail && normalizedEmail.includes('+')) {
                const emailParts = normalizedEmail.split('@');
                if (emailParts.length === 2) {
                    const [localPart, domain] = emailParts;
                    const [baseEmail, studentNamePart] = localPart.split('+');
                    
                    if (baseEmail && studentNamePart) {
                        // Replace hyphens with spaces in the student name part (database format)
                        const studentNameWithSpaces = studentNamePart.replace(/-/g, ' ');
                        normalizedEmail = `${baseEmail}+${studentNameWithSpaces}@${domain}`;
                    }
                }
            }
            finalEmail = normalizedEmail;
        }

        // Check for duplicate email if email is being changed
        if (finalEmail && finalEmail !== student.email) {
            const existingUser = await User.findOne({
                where: {
                    email: finalEmail,
                    id: { [Op.ne]: id }
                }
            });

            if (existingUser) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email is already taken'
                });
            }
        }

        // If parent's email is being changed, update all children's emails
        let childrenToUpdate = [];
        let parentEmailChanged = false;
        
        if (student.is_parent && finalEmail && finalEmail !== student.email && !finalEmail.includes('+')) {
            // Parent's base email is being changed (not a formatted email)
            parentEmailChanged = true;
            const oldParentEmail = student.email || '';
            const newParentEmail = finalEmail;
            
            // Extract old and new base emails (before @)
            const oldEmailParts = oldParentEmail.split('@');
            const newEmailParts = newParentEmail.split('@');
            
            if (oldEmailParts.length === 2 && newEmailParts.length === 2) {
                const oldBaseEmail = oldEmailParts[0];
                const oldDomain = oldEmailParts[1];
                const newBaseEmail = newEmailParts[0];
                const newDomain = newEmailParts[1];
                
                // Find all children (users with this parent as guardian)
                const children = await User.findAll({
                    where: {
                        guardian: id,
                        role_name: 'user'
                    },
                    attributes: ['id', 'email', 'full_name']
                });
                
                // Update each child's email
                for (const child of children) {
                    if (child.email && child.email.includes('+')) {
                        // Child has formatted email - update the base part
                        const childEmailParts = child.email.split('@');
                        if (childEmailParts.length === 2) {
                            const [childLocalPart, childDomain] = childEmailParts;
                            const [childBaseEmail, childAlias] = childLocalPart.split('+');
                            
                            // Check if child's base email matches parent's old base email
                            if (childBaseEmail === oldBaseEmail && childDomain === oldDomain && childAlias) {
                                const newChildEmail = `${newBaseEmail}+${childAlias}@${newDomain}`;
                                childrenToUpdate.push({
                                    childId: child.id,
                                    childName: child.full_name,
                                    oldEmail: child.email,
                                    newEmail: newChildEmail
                                });
                            }
                        }
                    }
                }
            }
        }

        // If parent's mobile is being changed, update all children's mobile numbers with new country code
// If parent's mobile is being changed, update all children's mobile numbers
let childrenMobileToUpdate = [];
let parentMobileChanged = false;

if (student.is_parent && mobile && mobile !== student.mobile) {
    parentMobileChanged = true;

    const newParentMobile = mobile; // NEVER mix country code here

    // Update parent mobile directly
    finalMobile = newParentMobile;

    const children = await User.findAll({
        where: {
            guardian: id,
            role_name: 'user'
        },
        attributes: ['id', 'mobile', 'full_name']
    });

    for (const child of children) {
        if (child.mobile && child.mobile.includes('+')) {
            const childSuffix = child.mobile.split('+')[1];

            let newChildMobile = `${newParentMobile}+${childSuffix}`;

            if (newChildMobile.length > 32) {
                const maxLen = 32 - newParentMobile.length - 1;
                newChildMobile = `${newParentMobile}+${childSuffix.substring(0, maxLen)}`;
            }

            childrenMobileToUpdate.push({
                childId: child.id,
                childName: child.full_name,
                oldMobile: child.mobile,
                newMobile: newChildMobile
            });
        }
    }
}

const updatedStudent = await student.update({
    full_name: full_name || student.full_name,
    email: finalEmail,
    mobile: finalMobile,
    country_code: country_code || student.country_code,
    timezone: timezone || student.timezone
});

// 🔥 UNIVERSAL PARENT → CHILD SYNC (except full_name)
if (student.is_parent) {
    const children = await User.findAll({
        where: { guardian: id, role_name: 'user' },
        attributes: ['id', 'full_name', 'mobile', 'email']
    });

    for (const child of children) {
        const updates = {};

        // EMAIL
        if (email !== undefined) {
            const baseEmail = updatedStudent.email.split('@')[0];
            const domain = updatedStudent.email.split('@')[1];
            const cleanName = child.full_name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
            const nameWithSpaces = cleanName.replace(/\s+/g, ' ').trim();
            updates.email = `${baseEmail}+${nameWithSpaces}@${domain}`;
        }

        // MOBILE
        if (mobile !== undefined) {
            const cleanName = child.full_name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
            const nameWithSpaces = cleanName.replace(/\s+/g, ' ').trim();
            let newMobile = `${updatedStudent.mobile}+${nameWithSpaces}`;

            if (newMobile.length > 32) {
                const maxLen = 32 - updatedStudent.mobile.length - 1;
                newMobile = `${updatedStudent.mobile}+${nameWithSpaces.substring(0, maxLen)}`;
            }

            updates.mobile = newMobile;
        }

        // COUNTRY CODE
        if (country_code !== undefined) {
            updates.country_code = country_code;
        }

        // TIMEZONE
        if (timezone !== undefined) {
            updates.timezone = timezone;
        }

        if (Object.keys(updates).length > 0) {
            await User.update(updates, { where: { id: child.id } });
        }
    }
}

        // Update all children's emails if parent email changed
        if (parentEmailChanged && childrenToUpdate.length > 0) {
            console.log(`📧 Updating ${childrenToUpdate.length} children emails...`);
            for (const childUpdate of childrenToUpdate) {
                try {
await User.update(
    {
        mobile: childUpdate.newMobile,
        country_code: country_code || student.country_code
    },
    { where: { id: childUpdate.childId } }
);
                    console.log(`   ✅ Updated ${childUpdate.childName}: ${childUpdate.newEmail}`);
                } catch (childUpdateError) {
                    console.error(`   ❌ Error updating child ${childUpdate.childName} email:`, childUpdateError);
                }
            }
        }

        // Update all children's mobile numbers if parent mobile changed
        if (parentMobileChanged && childrenMobileToUpdate.length > 0) {
            console.log(`📱 Updating ${childrenMobileToUpdate.length} children mobiles...`);
            for (const childUpdate of childrenMobileToUpdate) {
                try {
                    await User.update({ mobile: childUpdate.newMobile }, { where: { id: childUpdate.childId } });
                    console.log(`   ✅ Updated ${childUpdate.childName}:`);
                    console.log(`      Old: ${childUpdate.oldMobile} (${childUpdate.oldCountryCode})`);
                    console.log(`      New: ${childUpdate.newMobile} (${childUpdate.newCountryCode})`);
                } catch (childUpdateError) {
                    console.error(`   ❌ Error updating child ${childUpdate.childName} mobile:`, childUpdateError);
                }
            }
        }

        // Update PayPlus customer if student has online payment
        let payplusUpdateResult = null;
        try {
            // Determine which email to search with (use updated email if provided, otherwise current email)
            const searchEmail = email || updatedStudent.email;
            
            // First, try to find payment by student_id
            let latestPayment = await PaymentTransaction.findOne({
                where: {
                    student_id: id,
                    status: 'success',
                    payment_method: { [Op.ne]: 'offline' }
                },
                order: [['id', 'DESC']],
                attributes: ['id', 'response_data', 'student_email']
            });

            // If not found by student_id, try searching by email
            if (!latestPayment && searchEmail) {
                latestPayment = await PaymentTransaction.findOne({
                    where: {
                        student_email: searchEmail,
                        status: 'success',
                        payment_method: { [Op.ne]: 'offline' }
                    },
                    order: [['created_at', 'DESC']],
                    attributes: ['id', 'response_data', 'student_email']
                });
            }

            // If still not found, try searching in response_data for customer_email match
            if (!latestPayment && searchEmail) {
                // Get all successful online payments and check response_data
                const allPayments = await PaymentTransaction.findAll({
                    where: {
                        status: 'success',
                        payment_method: { [Op.ne]: 'offline' }
                    },
                    order: [['created_at', 'DESC']],
                    attributes: ['id', 'response_data', 'student_email'],
                    limit: 100 // Limit to recent payments for performance
                });

                // Search through response_data for matching customer_email
                for (const payment of allPayments) {
                    if (!payment.response_data) continue;
                    
                    let responseData = payment.response_data;
                    
                    // Parse response_data if it's a string
                    if (typeof responseData === 'string') {
                        try {
                            responseData = JSON.parse(responseData);
                            // Handle double-encoded JSON
                            if (typeof responseData === 'string') {
                                responseData = JSON.parse(responseData);
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                    
                    // Extract customer_email from both formats (root level or nested in data)
                    const customerEmail = responseData?.customer_email || responseData?.data?.customer_email;
                    
                    // Check if customer_email matches
                    if (customerEmail && customerEmail.toLowerCase() === searchEmail.toLowerCase()) {
                        latestPayment = payment;
                        break;
                    }
                }
            }

            if (latestPayment && latestPayment.response_data) {
                let responseData = latestPayment.response_data;
                
                // Handle different response_data formats
                if (typeof responseData === 'object' && responseData !== null) {
                    // Already an object
                } else if (typeof responseData === 'string') {
                    try {
                        responseData = JSON.parse(responseData);
                        // Handle double-encoded JSON
                        if (typeof responseData === 'string') {
                            responseData = JSON.parse(responseData);
                        }
                    } catch (parseError) {
                        console.error('Error parsing response_data:', parseError);
                        responseData = null;
                    }
                } else {
                    responseData = null;
                }
                
                // Extract customer_uid from response_data (handle both formats: root level or nested in data)
                const customerUid = responseData?.customer_uid || responseData?.data?.customer_uid || null;

                if (customerUid) {
                    // Prepare update payload for PayPlus
                    const updatePayload = {};
                    const oldValues = {};
                    const newValues = {};

                    // Include fields that are provided in the request
                    if (full_name !== undefined) {
                        updatePayload.customer_name = full_name;
                        oldValues.full_name = student.full_name;
                        newValues.full_name = full_name;
                    }
                    
                    // For email: use the final email (which may have been auto-updated from name change or normalized)
                    // Convert spaces to hyphens for PayPlus format
                    let payplusEmail = finalEmail;
                    if (payplusEmail && payplusEmail.includes('+')) {
                        const emailParts = payplusEmail.split('@');
                        if (emailParts.length === 2) {
                            const [localPart, domain] = emailParts;
                            const [baseEmail, studentNamePart] = localPart.split('+');
                            
                            if (baseEmail && studentNamePart) {
                                // Convert spaces to hyphens for PayPlus (payment link format)
                                const studentNameWithHyphens = studentNamePart.replace(/\s+/g, '-');
                                payplusEmail = `${baseEmail}+${studentNameWithHyphens}@${domain}`;
                            }
                        }
                    }
                    
                    // Include email in PayPlus update if:
                    // 1. Email was explicitly provided in request, OR
                    // 2. Email was auto-updated from name change, OR
                    // 3. Email was normalized (changed from hyphens to spaces), OR
                    // 4. Full name was changed (which may have triggered email update)
                    if (email !== undefined || emailUpdatedFromName || (normalizedEmail && normalizedEmail !== email) || (full_name !== undefined && finalEmail !== student.email)) {
                        updatePayload.email = payplusEmail;
                        updatePayload.communication_email = payplusEmail;
                        oldValues.email = student.email;
                        newValues.email = payplusEmail;
                    }
                    // For phone: use finalMobile (which may have been auto-updated from name change)
                    // Convert spaces to hyphens for PayPlus format
                    let payplusPhone = finalMobile;
                    if (payplusPhone && payplusPhone.includes('+')) {
                        const phoneParts = payplusPhone.split('+');
                        if (phoneParts.length >= 2) {
                            const basePhone = phoneParts[0];
                            const studentNamePart = phoneParts[1];
                            
                            if (basePhone && studentNamePart) {
                                // Convert spaces to hyphens for PayPlus (payment link format)
                                const studentNameWithHyphens = studentNamePart.replace(/\s+/g, '-');
                                payplusPhone = `${basePhone}+${studentNameWithHyphens}`;
                                // Truncate if exceeds 20 characters (PayPlus limit)
                                if (payplusPhone.length > 20) {
                                    const maxNameLength = 20 - basePhone.length - 1;
                                    const truncatedName = studentNameWithHyphens.substring(0, Math.max(0, maxNameLength));
                                    payplusPhone = `${basePhone}+${truncatedName}`;
                                }
                            }
                        }
                    }
                    
                    if (mobile !== undefined || phoneUpdatedFromName) {
                        updatePayload.phone = payplusPhone;
                        oldValues.mobile = student.mobile;
                        newValues.mobile = payplusPhone;
                    }

                    // Call PayPlus API if any fields are provided
                    if (Object.keys(updatePayload).length > 0) {
                        const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${customerUid}`;

                        try {
                            const response = await axios.post(
                                payplusUrl,
                                updatePayload,
                                {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'api-key': PAYPLUS_CONFIG.apiKey,
                                        'secret-key': PAYPLUS_CONFIG.secretKey
                                    },
                                    timeout: 30000
                                }
                            );

                            if (response.status === 200) {
                                payplusUpdateResult = {
                                    success: true,
                                    customer_uid: customerUid,
                                    updated_fields: Object.keys(updatePayload)
                                };

                                // Log successful update
                                payplusUpdateLogger.logPayPlusUpdate({
                                    student_id: id,
                                    student_email: updatedStudent.email,
                                    customer_uid: customerUid,
                                    update_type: 'student_update',
                                    fields_updated: Object.keys(updatePayload),
                                    old_values: oldValues,
                                    new_values: newValues,
                                    success: true,
                                    payplus_response: response.data,
                                    updated_by: req.user?.id || null
                                });
                            } else {
                                payplusUpdateResult = {
                                    success: false,
                                    customer_uid: customerUid,
                                    error: `PayPlus API returned status ${response.status}`
                                };

                                // Log failed update
                                payplusUpdateLogger.logPayPlusUpdate({
                                    student_id: id,
                                    student_email: updatedStudent.email,
                                    customer_uid: customerUid,
                                    update_type: 'student_update',
                                    fields_updated: Object.keys(updatePayload),
                                    old_values: oldValues,
                                    new_values: newValues,
                                    success: false,
                                    error_message: `PayPlus API returned status ${response.status}`,
                                    payplus_response: response.data,
                                    updated_by: req.user?.id || null
                                });
                            }
                        } catch (apiError) {
                            payplusUpdateResult = {
                                success: false,
                                customer_uid: customerUid,
                                error: apiError.message || 'Unknown error'
                            };

                            // Log API error
                            payplusUpdateLogger.logPayPlusUpdate({
                                student_id: id,
                                student_email: updatedStudent.email,
                                customer_uid: customerUid,
                                update_type: 'student_update',
                                fields_updated: Object.keys(updatePayload),
                                old_values: oldValues,
                                new_values: newValues,
                                success: false,
                                error_message: apiError.message || 'Unknown error',
                                payplus_response: apiError.response?.data || null,
                                updated_by: req.user?.id || null
                            });
                        }
                    } else {
                        // Log skipped update
                        payplusUpdateLogger.logPayPlusUpdateSkipped({
                            student_id: id,
                            student_email: updatedStudent.email,
                            reason: 'No fields provided in request'
                        });
                    }
                } else {
                    // Log skipped - no customer_uid
                    payplusUpdateLogger.logPayPlusUpdateSkipped({
                        student_id: id,
                        student_email: updatedStudent.email,
                        reason: 'No customer_uid found in payment transaction'
                    });
                }
            } else {
                // Log skipped - no payment found
                payplusUpdateLogger.logPayPlusUpdateSkipped({
                    student_id: id,
                    student_email: updatedStudent.email,
                    reason: 'No successful online payment found'
                });
            }
            
            // If parent's email changed, also update all children's PayPlus records
            if (parentEmailChanged && childrenToUpdate.length > 0) {
                for (const childUpdate of childrenToUpdate) {
                    try {
                        // Find child's PayPlus customer_uid
                        let childLatestPayment = await PaymentTransaction.findOne({
                            where: {
                                student_id: childUpdate.childId,
                                status: 'success',
                                payment_method: { [Op.ne]: 'offline' }
                            },
                            order: [['created_at', 'DESC']],
                            attributes: ['id', 'response_data', 'student_email']
                        });
                        
                        // If not found by student_id, try searching by email
                        if (!childLatestPayment && childUpdate.oldEmail) {
                            childLatestPayment = await PaymentTransaction.findOne({
                                where: {
                                    student_email: childUpdate.oldEmail,
                                    status: 'success',
                                    payment_method: { [Op.ne]: 'offline' }
                                },
                                order: [['created_at', 'DESC']],
                                attributes: ['id', 'response_data', 'student_email']
                            });
                        }
                        
                        if (childLatestPayment && childLatestPayment.response_data) {
                            let childResponseData = childLatestPayment.response_data;
                            
                            // Parse response_data if needed
                            if (typeof childResponseData === 'string') {
                                try {
                                    childResponseData = JSON.parse(childResponseData);
                                    if (typeof childResponseData === 'string') {
                                        childResponseData = JSON.parse(childResponseData);
                                    }
                                } catch (parseError) {
                                    console.error(`Error parsing child ${childUpdate.childId} response_data:`, parseError);
                                    continue;
                                }
                            }
                            
                            const childCustomerUid = childResponseData?.customer_uid || childResponseData?.data?.customer_uid || null;
                            
                            if (childCustomerUid) {
                                // Convert child email to PayPlus format (spaces to hyphens)
                                let childPayplusEmail = childUpdate.newEmail;
                                if (childPayplusEmail && childPayplusEmail.includes('+')) {
                                    const emailParts = childPayplusEmail.split('@');
                                    if (emailParts.length === 2) {
                                        const [localPart, domain] = emailParts;
                                        const [baseEmail, studentNamePart] = localPart.split('+');
                                        
                                        if (baseEmail && studentNamePart) {
                                            const studentNameWithHyphens = studentNamePart.replace(/\s+/g, '-');
                                            childPayplusEmail = `${baseEmail}+${studentNameWithHyphens}@${domain}`;
                                        }
                                    }
                                }
                                
                                const childUpdatePayload = {
                                    email: childPayplusEmail,
                                    communication_email: childPayplusEmail
                                };
                                
                                const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${childCustomerUid}`;
                                
                                try {
                                    const childResponse = await axios.post(
                                        payplusUrl,
                                        childUpdatePayload,
                                        {
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'api-key': PAYPLUS_CONFIG.apiKey,
                                                'secret-key': PAYPLUS_CONFIG.secretKey
                                            },
                                            timeout: 30000
                                        }
                                    );
                                    
                                    if (childResponse.status === 200) {
                                        payplusUpdateLogger.logPayPlusUpdate({
                                            student_id: childUpdate.childId,
                                            student_email: childUpdate.newEmail,
                                            customer_uid: childCustomerUid,
                                            update_type: 'child_email_update_from_parent',
                                            fields_updated: ['email'],
                                            old_values: { email: childUpdate.oldEmail },
                                            new_values: { email: childPayplusEmail },
                                            success: true,
                                            payplus_response: childResponse.data,
                                            updated_by: req.user?.id || null,
                                            parent_id: id
                                        });
                                    } else {
                                        console.error(`❌ PayPlus update failed for child ${childUpdate.childName}: Status ${childResponse.status}`);
                                    }
                                } catch (childPayplusError) {
                                    console.error(`Error updating PayPlus for child ${childUpdate.childName}:`, childPayplusError);
                                    payplusUpdateLogger.logPayPlusUpdate({
                                        student_id: childUpdate.childId,
                                        student_email: childUpdate.newEmail,
                                        customer_uid: childCustomerUid,
                                        update_type: 'child_email_update_from_parent',
                                        fields_updated: ['email'],
                                        old_values: { email: childUpdate.oldEmail },
                                        new_values: { email: childPayplusEmail },
                                        success: false,
                                        error_message: childPayplusError.message || 'Unknown error',
                                        payplus_response: childPayplusError.response?.data || null,
                                        updated_by: req.user?.id || null,
                                        parent_id: id
                                    });
                                }
                            }
                        }
                    } catch (childError) {
                        console.error(`Error processing PayPlus update for child ${childUpdate.childName}:`, childError);
                    }
                }
            }

            // Update children's mobile in PayPlus if parent's mobile changed
            if (parentMobileChanged && childrenMobileToUpdate.length > 0) {
                console.log(`💳 Updating PayPlus for ${childrenMobileToUpdate.length} children (mobile)...`);
                for (const childUpdate of childrenMobileToUpdate) {
                    try {
                        // Find child's PayPlus customer_uid
                        let childLatestPayment = await PaymentTransaction.findOne({
                            where: {
                                student_id: childUpdate.childId,
                                status: 'success',
                                payment_method: { [Op.ne]: 'offline' }
                            },
                            order: [['created_at', 'DESC']],
                            attributes: ['id', 'response_data']
                        });

                        if (childLatestPayment && childLatestPayment.response_data) {
                            let childResponseData = childLatestPayment.response_data;

                            // Parse response_data if needed
                            if (typeof childResponseData === 'string') {
                                try {
                                    childResponseData = JSON.parse(childResponseData);
                                    if (typeof childResponseData === 'string') {
                                        childResponseData = JSON.parse(childResponseData);
                                    }
                                } catch (parseError) {
                                    console.error(`Error parsing child ${childUpdate.childId} response_data:`, parseError);
                                    continue;
                                }
                            }

                            const childCustomerUid = childResponseData?.customer_uid || childResponseData?.data?.customer_uid || null;

                            if (childCustomerUid) {
                                // Convert child mobile to PayPlus format (spaces to hyphens)
                                let childPayplusMobile = childUpdate.newMobile;
                                if (childPayplusMobile && childPayplusMobile.includes('+')) {
                                    const mobileParts = childPayplusMobile.split('+');
                                    if (mobileParts.length >= 2) {
                                        const baseMobile = mobileParts[0];
                                        const studentNamePart = mobileParts[1];

                                        if (baseMobile && studentNamePart) {
                                            const studentNameWithHyphens = studentNamePart.replace(/\s+/g, '-');
                                            childPayplusMobile = `${baseMobile}+${studentNameWithHyphens}`;

                                            // Truncate if exceeds 20 characters (PayPlus limit)
                                            if (childPayplusMobile.length > 20) {
                                                const maxNameLength = 20 - baseMobile.length - 1;
                                                const truncatedName = studentNameWithHyphens.substring(0, Math.max(0, maxNameLength));
                                                childPayplusMobile = `${baseMobile}+${truncatedName}`;
                                            }
                                        }
                                    }
                                }

                                const childUpdatePayload = {
                                    phone: childPayplusMobile
                                };

                                const payplusUrl = `${PAYPLUS_CONFIG.baseUrl}/Customers/Update/${childCustomerUid}`;

                                try {
                                    const childResponse = await axios.post(payplusUrl, childUpdatePayload, {
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'api-key': PAYPLUS_CONFIG.apiKey,
                                            'secret-key': PAYPLUS_CONFIG.secretKey
                                        },
                                        timeout: 30000
                                    });

                                    if (childResponse.status === 200) {
                                        console.log(`   ✅ Updated PayPlus mobile for ${childUpdate.childName}`);
                                        console.log(`      ${childUpdate.oldCountryCode} → ${childUpdate.newCountryCode}`);
                                        payplusUpdateLogger.logPayPlusUpdate({
                                            student_id: childUpdate.childId,
                                            student_email: null,
                                            customer_uid: childCustomerUid,
                                            update_type: 'child_mobile_update_from_parent',
                                            fields_updated: ['phone'],
                                            old_values: {
                                                mobile: childUpdate.oldMobile,
                                                country_code: childUpdate.oldCountryCode
                                            },
                                            new_values: {
                                                mobile: childPayplusMobile,
                                                country_code: childUpdate.newCountryCode
                                            },
                                            success: true,
                                            payplus_response: childResponse.data,
                                            updated_by: req.user?.id || null,
                                            parent_id: id
                                        });
                                    } else {
                                        console.error(`❌ PayPlus mobile update failed for child ${childUpdate.childName}: Status ${childResponse.status}`);
                                    }
                                } catch (childPayplusError) {
                                    console.error(`Error updating PayPlus mobile for child ${childUpdate.childName}:`, childPayplusError);
                                    payplusUpdateLogger.logPayPlusUpdate({
                                        student_id: childUpdate.childId,
                                        student_email: null,
                                        customer_uid: childCustomerUid,
                                        update_type: 'child_mobile_update_from_parent',
                                        fields_updated: ['phone'],
                                        old_values: {
                                            mobile: childUpdate.oldMobile,
                                            country_code: childUpdate.oldCountryCode
                                        },
                                        new_values: {
                                            mobile: childPayplusMobile,
                                            country_code: childUpdate.newCountryCode
                                        },
                                        success: false,
                                        error_message: childPayplusError.message || 'Unknown error',
                                        payplus_response: childPayplusError.response?.data || null,
                                        updated_by: req.user?.id || null,
                                        parent_id: id
                                    });
                                }
                            }
                        }
                    } catch (childError) {
                        console.error(`Error processing PayPlus mobile update for child ${childUpdate.childName}:`, childError);
                    }
                }
            }
        } catch (payplusError) {
            console.error('Error updating PayPlus customer:', payplusError);
            // Don't fail the entire operation if PayPlus update fails
            payplusUpdateResult = {
                success: false,
                error: payplusError.message || 'Unknown error'
            };

            // Log error
            payplusUpdateLogger.logPayPlusUpdate({
                student_id: id,
                student_email: updatedStudent.email,
                customer_uid: null,
                update_type: 'student_update',
                fields_updated: [],
                old_values: {},
                new_values: {},
                success: false,
                error_message: payplusError.message || 'Unknown error',
                updated_by: req.user?.id || null
            });
        }

        const responseData = {
            id: updatedStudent.id,
            full_name: updatedStudent.full_name,
            email: updatedStudent.email,
            mobile: updatedStudent.mobile,
            timezone: updatedStudent.timezone,
            role: {
                name: updatedStudent.role_name,
                id: updatedStudent.role_id
            }
        };

        // Include PayPlus update result if available
        if (payplusUpdateResult) {
            responseData.payplus_update = payplusUpdateResult;
        }

        return res.status(200).json({
            status: 'success',
            message: 'Student updated successfully',
            data: responseData
        });
    } catch (err) {
        console.error('Error updating student:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update student',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updatePassword(req, res) {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 6 characters long'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            }
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await student.update({
            password: hashedPassword
        });

        return res.status(200).json({
            status: 'success',
            message: 'Password updated successfully'
        });
    } catch (err) {
        console.error('Error updating password:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update password',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function inactivateStudent(req, res) {
    try {
        const { id } = req.params;
        const { reason, cancelClasses } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            }
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        await student.update({
            status: 'inactive',
            updated_at: Math.floor(Date.now() / 1000),
            offline: true,
            offline_message: reason
        });

        if (cancelClasses) {
            await Class.update(
                {
                    status: 'canceled',
                    updated_at: Math.floor(Date.now() / 1000)
                },
                {
                    where: {
                        student_id: id,
                        meeting_start: {
                            [Op.gt]: new Date()
                        },
                        status: 'pending'
                    }
                }
            );
        }

        return res.status(200).json({
            status: 'success',
            message: 'Student inactivated successfully'
        });
    } catch (err) {
        console.error('Error inactivating student:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to inactivate student',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// Inactivate Subscription Function
async function inactivateSubscription(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params; // Student ID
        const { timing, cancelClasses, reason = 'Subscription inactivated by admin' } = req.body;

        if (!id) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        if (!timing || !['immediate', 'end-of-month'].includes(timing)) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid timing option. Must be "immediate" or "end-of-month"'
            });
        }

        // Find the student
        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            },
            transaction: dbTransaction
        });

        if (!student) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Find the active subscription
        const activeSubscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: id,
                status: 'active'
            },
            order: [['id', 'DESC']],
            transaction: dbTransaction
        });

        if (!activeSubscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        let updateData = {};
        let message = '';
        let recurringPaymentResult = null;
        let pastDueHandlingResult = null;

        // Find all active past due payments for this user and subscription
        const activePastDuePayments = await PastDuePayment.findAll({
            where: {
                user_id: id,
                subscription_id: activeSubscription.id,
                status: 'past_due'
            },
            transaction: dbTransaction
        });

        if (activePastDuePayments.length > 0) {

            const cancelledPaymentIds = [];
            const disabledDunningIds = [];

            for (const pastDuePayment of activePastDuePayments) {
                try {
                    // Update past due payment status to canceled
                    const cancelNote = `[${new Date().toISOString()}] Automatically cancelled due to subscription ${timing} cancellation by admin. ${reason ? 'Reason: ' + reason : ''}`;
                    
                    await pastDuePayment.update({
                        status: 'canceled',
                        canceled_at: new Date(),
                        notes: `${pastDuePayment.notes || ''}\n${cancelNote}`
                    }, { transaction: dbTransaction });

                    cancelledPaymentIds.push(pastDuePayment.id);

                    // Disable associated dunning schedule
                    const dunningSchedule = await DunningSchedule.findOne({
                        where: { past_due_payment_id: pastDuePayment.id },
                        transaction: dbTransaction
                    });

                    if (dunningSchedule) {
                        await dunningSchedule.update({
                            is_enabled: false,
                            is_paused: true,
                            next_reminder_at: null,
                            paused_reason: `Subscription cancelled ${timing} by admin. ${reason || ''}`
                        }, { transaction: dbTransaction });

                        disabledDunningIds.push(dunningSchedule.id);
                        console.log(`✅ Disabled dunning schedule ${dunningSchedule.id} for past due payment ${pastDuePayment.id}`);
                    }

                } catch (error) {
                    console.error(`❌ Error processing past due payment ${pastDuePayment.id}:`, error);
                }
            }

            pastDueHandlingResult = {
                cancelled_payments: cancelledPaymentIds.length,
                disabled_dunning_schedules: disabledDunningIds.length,
                payment_ids: cancelledPaymentIds,
                dunning_ids: disabledDunningIds
            };

        } else {
            console.log(`ℹ️ No active past due payments found for user ${id}`);
            pastDueHandlingResult = {
                cancelled_payments: 0,
                disabled_dunning_schedules: 0,
                message: 'No active past due payments found'
            };
        }

        if (timing === 'immediate') {
            // Immediate inactivation - similar to PHP logic
            updateData = {
                status: 'inactive',
                is_cancel: 1,
                cancellation_date: new Date(),
                cancelled_by_user_id: req.user?.id || null,
                cancellation_reason: reason,
                updated_at: Math.floor(Date.now() / 1000)
            };
            message = 'Subscription inactivated immediately';

            // Update user subscription_id to null
            await student.update(
                {
                    subscription_id: null,
                    subscription_type: null
                },
                { transaction: dbTransaction }
            );

            console.log(activeSubscription.payment_status);
        } else if (timing === 'end-of-month') {
            // Set flag to inactivate after current period ends
            updateData = {
                status: 'active',
                inactive_after_renew: 1,
                // is_cancel: 1,
                cancellation_date: new Date(),
                cancelled_by_user_id: req.user?.id || null,
                cancellation_reason: reason,
                updated_at: Math.floor(Date.now() / 1000)
            };
            message = 'Subscription will be inactivated at the end of current period';
            console.log(`📅 Subscription ${activeSubscription.id} marked for cancellation at renewal`);
        }

        if (activeSubscription.payment_status === 'online') {
            console.log(`🔄 Cancelling recurring payments for online subscription ${activeSubscription.id}`);

            try {
                recurringPaymentResult = await cancelUserRecurringPayments(id, `Subscription inactivated immediately by admin. Reason: ${reason}`, req.user?.id || null, dbTransaction);

                console.log(`📊 Recurring payment cancellation result:`, recurringPaymentResult);

                if (recurringPaymentResult.successful > 0) {
                    message += `. ${recurringPaymentResult.successful} recurring payment(s) cancelled at PayPlus.`;
                }
            } catch (recurringError) {
                console.error('❌ Error cancelling recurring payments:', recurringError);
                // Don't fail the entire operation, but log the error
                message += ' Note: Some recurring payments may need manual cancellation.';
            }
        }
        // Update the subscription
        await activeSubscription.update(updateData, { transaction: dbTransaction });


        if (cancelClasses && timing === 'immediate') {
            // Cancel all pending classes
            await Class.update(
                {
                    status: 'canceled',
                    canceled_by: 'Admin',
                    cancel_reason: `Subscription canceled by admin. Reason: ${reason}`,
                    updated_at: Math.floor(Date.now() / 1000)
                },
                {
                    where: {
                        student_id: id,
                        meeting_start: {
                            [Op.gt]: new Date()
                        },
                        status: 'pending'
                    },
                    transaction: dbTransaction
                }
            );

            // Get student info for logging
            const student = await User.findByPk(id, {
                attributes: ['id', 'full_name'],
                transaction: dbTransaction
            });

            // Get classes before deletion for logging
            const regularClassesToDelete = await RegularClass.findAll({
                where: { student_id: id },
                attributes: ['id', 'student_id', 'teacher_id', 'day', 'start_time'],
                transaction: dbTransaction
            });

            const hiddenClassesToDelete = await Class.findAll({
                where: {
                    student_id: id,
                    is_regular_hide: 1
                },
                attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status'],
                transaction: dbTransaction
            });

            // Delete regular classes
            const deletedRegularClassesCount = await RegularClass.destroy({
                where: {
                    student_id: id
                },
                transaction: dbTransaction
            });

            // Log bulk class deletion before cancellation
            const totalDeleted = deletedRegularClassesCount + hiddenClassesToDelete.length;
            if (totalDeleted > 0) {
                const classesDeleted = [
                    ...regularClassesToDelete.map(rc => ({
                        class_id: rc.id,
                        class_type: 'regular_class_pattern',
                        student_id: rc.student_id,
                        teacher_id: rc.teacher_id
                    })),
                    ...hiddenClassesToDelete.map(hc => ({
                        class_id: hc.id,
                        class_type: 'regular',
                        student_id: hc.student_id,
                        teacher_id: hc.teacher_id,
                        meeting_start: hc.meeting_start,
                        status: hc.status
                    }))
                ];

                classDeletionLogger.logBulkClassDeletion({
                    deletion_source: 'admin_panel',
                    deleted_by: req.user?.id || null,
                    deleted_by_role: 'admin',
                    deletion_reason: `Bulk cancellation during subscription cancellation for student ${id}`,
                    total_deleted: totalDeleted,
                    classes_deleted: classesDeleted,
                    subscription_updates: [{
                        subscription_id: activeSubscription.id,
                        student_id: id,
                        timing: timing
                    }],
                    lessons_refunded_total: 0
                });
            }

            // Cancel next month lessons that are hidden
            const cancelledHiddenClassesResult = await Class.update(
                {
                    status: 'canceled',
                    cancelled_by: req.user?.id || null,
                    cancelled_at: moment.utc().toDate(),
                    cancellation_reason: 'Bulk cancellation during subscription cancellation',
                    join_url: null,
                    updated_at: moment.utc().toDate()
                },
                {
                    where: {
                        student_id: id,
                        is_regular_hide: 1
                    },
                    transaction: dbTransaction
                }
            );
            const cancelledHiddenClassesCount = cancelledHiddenClassesResult[0] || 0;
        } else if (timing === 'end-of-month') {
            console.log(`⏳ Classes will NOT be cancelled until renewal date for end-of-month cancellation`);
        }

        await dbTransaction.commit();

        const responseData = {
            status: 'success',
            message: message,
            data: {
                subscription_id: activeSubscription.id,
                timing: timing,
                classes_canceled: cancelClasses && timing === 'immediate',
                payment_status: activeSubscription.payment_status,
                cancellation_reason: reason
            }
        };

        // Include recurring payment result if any
        if (recurringPaymentResult) {
            responseData.data.recurring_payment_action = recurringPaymentResult;
        }

        // Include past due handling result if any
        if (pastDueHandlingResult && pastDueHandlingResult.cancelled_payments > 0) {
            responseData.data.past_due_handling = pastDueHandlingResult;
            responseData.message += ` ${pastDueHandlingResult.cancelled_payments} past due payment(s) cancelled.`;
        }

        // Include past due handling result if any
        if (pastDueHandlingResult && pastDueHandlingResult.cancelled_payments > 0) {
            responseData.data.past_due_handling = pastDueHandlingResult;
            responseData.message += ` ${pastDueHandlingResult.cancelled_payments} past due payment(s) cancelled.`;
        }

        return res.status(200).json(responseData);
    } catch (err) {
        if (dbTransaction) {
            try {
                await dbTransaction.rollback();
            } catch (rollbackError) {
                console.error('❌ Error rolling back transaction:', rollbackError);
            }
        }

        console.error('❌ Error inactivating subscription:', err);
        console.error('❌ Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to inactivate subscription',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Extract recurring payment UID from PayPlus webhook data
 * @param {Object} webhookData - Webhook data from RecurringPayment.webhook_data
 * @returns {String|null} - Extracted recurring payment UID or null
 */
const extractRecurringPaymentUid = (webhookData) => {
    try {
        console.log(`🔍 Extracting recurring payment UID from webhook data`);

        if (!webhookData) {
            console.log(`⚠️ No webhook data provided for recurring UID extraction`);
            return null;
        }

        // Parse webhook data if it's a string
        let parsedWebhookData = webhookData;
        if (typeof webhookData === 'string') {
            try {
                parsedWebhookData = JSON.parse(webhookData);
            } catch (parseError) {
                console.error(`❌ Error parsing webhook data for recurring UID:`, parseError);
                return null;
            }
        }

        // Try to extract recurring payment UID from various locations
        let recurringUid = null;

        // Method 1: From original_webhook.recurring_payment_uid (most accurate)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.recurring_payment_uid) {
            recurringUid = parsedWebhookData.original_webhook.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in original_webhook: ${recurringUid}`);
            return recurringUid;
        }

        // Method 2: From recurring_info object
        if (parsedWebhookData.recurring_info) {
            if (parsedWebhookData.recurring_info.recurring_payment_uid) {
                recurringUid = parsedWebhookData.recurring_info.recurring_payment_uid;
                console.log(`💰 Found recurring payment UID in recurring_info: ${recurringUid}`);
                return recurringUid;
            }
            if (parsedWebhookData.recurring_info.recurring_uid) {
                recurringUid = parsedWebhookData.recurring_info.recurring_uid;
                console.log(`💰 Found recurring UID in recurring_info: ${recurringUid}`);
                return recurringUid;
            }
        }

        // Method 3: Direct field
        if (parsedWebhookData.recurring_payment_uid) {
            recurringUid = parsedWebhookData.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in root: ${recurringUid}`);
            return recurringUid;
        }

        // Method 4: From transaction object
        if (parsedWebhookData.transaction && parsedWebhookData.transaction.recurring_payment_uid) {
            recurringUid = parsedWebhookData.transaction.recurring_payment_uid;
            console.log(`💰 Found recurring payment UID in transaction: ${recurringUid}`);
            return recurringUid;
        }

        // Method 5: From original_webhook.recurring_id (alternative field)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.recurring_id) {
            recurringUid = parsedWebhookData.original_webhook.recurring_id;
            console.log(`💰 Found recurring ID in original_webhook (fallback): ${recurringUid}`);
            return recurringUid;
        }

        console.log(`⚠️ Recurring payment UID not found in webhook data structure`);
        return null;
    } catch (error) {
        console.error(`❌ Error extracting recurring payment UID:`, error);
        return null;
    }
};

/**
 * Extract terminal UID from PayPlus webhook data with enhanced parsing
 * @param {String} pageRequestUid - PayPlus page request UID
 * @param {Object} webhookData - Webhook data from RecurringPayment.webhook_data
 * @returns {String|null} - Extracted terminal UID or null
 */
const extractTerminalUidFromPageRequest = (pageRequestUid, webhookData = null) => {
    try {
        console.log(`🔍 Extracting terminal UID from webhook data:`, {
            hasWebhookData: !!webhookData,
            pageRequestUid
        });

        if (!webhookData) {
            console.log(`⚠️ No webhook data provided, using fallback terminal UID`);
            return null;
        }

        // Parse webhook data if it's a string
        let parsedWebhookData = webhookData;
        if (typeof webhookData === 'string') {
            try {
                parsedWebhookData = JSON.parse(webhookData);
            } catch (parseError) {
                console.error(`❌ Error parsing webhook data string:`, parseError);
                return null;
            }
        }

        // Try to extract terminal UID from various locations in the webhook data
        let terminalUid = null;

        // Method 1: Direct terminal_uid field
        if (parsedWebhookData.terminal_uid) {
            terminalUid = parsedWebhookData.terminal_uid;
            console.log(`🟢 Found terminal UID in root webhook data: ${terminalUid}`);
            return terminalUid;
        }

        // Method 2: From original_webhook object (most common location)
        if (parsedWebhookData.original_webhook && parsedWebhookData.original_webhook.terminal_uid) {
            terminalUid = parsedWebhookData.original_webhook.terminal_uid;
            console.log(`🟢 Found terminal UID in original_webhook: ${terminalUid}`);
            return terminalUid;
        }

        // Method 3: From nested data structure if present
        if (parsedWebhookData.data && parsedWebhookData.data.terminal_uid) {
            terminalUid = parsedWebhookData.data.terminal_uid;
            console.log(`🟢 Found terminal UID in data object: ${terminalUid}`);
            return terminalUid;
        }

        // Method 4: From transaction object if present
        if (parsedWebhookData.transaction && parsedWebhookData.transaction.terminal_uid) {
            terminalUid = parsedWebhookData.transaction.terminal_uid;
            console.log(`🟢 Found terminal UID in transaction object: ${terminalUid}`);
            return terminalUid;
        }

        console.log(`⚠️ Terminal UID not found in webhook data structure`);
        return null;
    } catch (error) {
        console.error(`❌ Error extracting terminal UID:`, error);
        return null;
    }
};

/**
 * REPLACE the existing cancelPayPlusRecurringPayment function with this complete version
 */
const cancelPayPlusRecurringPayment = async (recurringPaymentUid, pageRequestUid = null, webhookData = null) => {
    try {
        console.log(`🔄 Attempting to cancel PayPlus recurring payment with data:`, {
            recurringPaymentUid,
            pageRequestUid,
            hasWebhookData: !!webhookData
        });

        // First, try to extract the actual recurring payment UID from webhook data
        let actualRecurringUid = recurringPaymentUid;

        if (webhookData) {
            const extractedRecurringUid = extractRecurringPaymentUid(webhookData);
            if (extractedRecurringUid && extractedRecurringUid !== recurringPaymentUid) {
                console.log(`🔄 Using extracted recurring payment UID: ${extractedRecurringUid} instead of ${recurringPaymentUid}`);
                actualRecurringUid = extractedRecurringUid;
            }
        }

        if (!actualRecurringUid || actualRecurringUid === 'undefined' || actualRecurringUid === '' || actualRecurringUid === 'N/A') {
            console.log('⚠️ No valid recurring payment UID found, skipping PayPlus cancellation');
            return true; // Consider it successful if there's nothing to cancel
        }

        // Extract terminal UID from webhook data
        let terminalUid = extractTerminalUidFromPageRequest(pageRequestUid, webhookData);

        // Try to get terminal UID from PaymentTransactions if not found in webhook
        if (!terminalUid) {
            terminalUid = await extractTerminalUidFromPaymentTransactions(actualRecurringUid, pageRequestUid);
        }

        // Fall back to config terminal UID if extraction fails
        if (!terminalUid) {
            terminalUid = PAYPLUS_CONFIG.terminalUid;
            console.log(`🟢 Using fallback terminal UID from config: ${terminalUid}`);
        } else {
            console.log(`🟢 Using extracted terminal UID: ${terminalUid}`);
        }

        console.log(`🔄 Making PayPlus API call to cancel recurring payment:`, {
            recurringUid: actualRecurringUid,
            terminalUid,
            endpoint: `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${actualRecurringUid}`
        });

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${actualRecurringUid}`,
            {
                terminal_uid: terminalUid,
                _method: 'DELETE'
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                timeout: 30000
            }
        );

        console.log(`📊 PayPlus API response:`, {
            status: response.status,
            statusText: response.statusText,
            data: response.data
        });

        if (response.status === 200 || response.status === 204) {
            console.log(`✅ Successfully cancelled PayPlus recurring payment: ${actualRecurringUid} with terminal: ${terminalUid}`);
            return true;
        } else {
            console.error(`❌ PayPlus API returned status ${response.status} for recurring payment cancellation`);
            console.error(`Response data:`, response.data);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error cancelling PayPlus recurring payment ${recurringPaymentUid}:`, {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });

        // If the error is that the recurring payment doesn't exist, consider it successful
        if (error.response?.status === 404 || error.response?.data?.includes('not found') || error.response?.data?.includes('Not Found') || error.message?.includes('not found')) {
            console.log('ℹ️ Recurring payment not found at PayPlus, considering cancellation successful');
            return true;
        }

        // If it's already cancelled, also consider it successful
        if (error.response?.data?.includes('already cancelled') || error.response?.data?.includes('already canceled') || error.response?.data?.includes('inactive')) {
            console.log('ℹ️ Recurring payment already cancelled at PayPlus, considering cancellation successful');
            return true;
        }

        return false;
    }
};

// REPLACE the existing getRecurringPaymentUidForCancellation function
const getRecurringPaymentUidForCancellation = (recurringPaymentRecord) => {
    try {
        console.log(`🔍 Getting recurring payment UID for cancellation from record ${recurringPaymentRecord.id}`);

        // First priority: Parse webhook_data to get recurring_payment_uid
        if (recurringPaymentRecord.webhook_data) {
            const parsedWebhookData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);

            if (parsedWebhookData.recurring_payment_uid) {
                console.log(`✅ Found recurring_payment_uid in webhook data: ${parsedWebhookData.recurring_payment_uid}`);
                return parsedWebhookData.recurring_payment_uid;
            }
        }

        // Second priority: Use payplus_transaction_uid if available
        if (recurringPaymentRecord.payplus_transaction_uid && recurringPaymentRecord.payplus_transaction_uid !== 'N/A' && recurringPaymentRecord.payplus_transaction_uid !== '') {
            console.log(`⚠️ Using payplus_transaction_uid as fallback: ${recurringPaymentRecord.payplus_transaction_uid}`);
            return recurringPaymentRecord.payplus_transaction_uid;
        }

        console.log(`❌ No valid recurring payment UID found for record ${recurringPaymentRecord.id}`);
        return null;
    } catch (error) {
        console.error(`❌ Error getting recurring payment UID for cancellation:`, error);
        return null;
    }
};

// REPLACE the existing getTerminalUidFromRecord function
const getTerminalUidFromRecord = async (recurringPaymentRecord) => {
    try {
        console.log(`🔍 Getting terminal UID from record ${recurringPaymentRecord.id}`);

        // 1) From webhook data
        if (recurringPaymentRecord.webhook_data) {
            const parsedWebhookData = parseWebhookDataFromDB(recurringPaymentRecord.webhook_data);
            if (parsedWebhookData?.terminal_uid) {
                console.log(`✅ Found terminal_uid in webhook data: ${parsedWebhookData.terminal_uid}`);
                return parsedWebhookData.terminal_uid;
            }
        }

        // 2) From PaymentTransaction.response_data (best-effort)
        const possibleRecurringUid = getRecurringPaymentUidForCancellation(recurringPaymentRecord);
        const pageRequestUid = recurringPaymentRecord.payplus_page_request_uid || null;

        const fromTx = await extractTerminalUidFromPaymentTransactions(possibleRecurringUid, pageRequestUid);
        if (fromTx) return fromTx;

        console.log(`⚠️ No terminal UID found (webhook/transactions) for record ${recurringPaymentRecord.id}`);
        return null;
    } catch (error) {
        console.error(`❌ Error getting terminal UID from record:`, error);
        return null;
    }
};

// ADD this new function that's missing in student.controller.js
const extractTerminalUidFromPaymentTransactions = async (actualRecurringUid = null, pageRequestUid = null) => {
    try {
        // Strategy A: match by recurring_payment_uid
        let tx = null;

        if (actualRecurringUid) {
            tx = await PaymentTransaction.findOne({
                // MySQL JSON_EXTRACT on response_data (stored as JSON or TEXT containing JSON)
                where: Sequelize.where(Sequelize.fn('JSON_EXTRACT', Sequelize.col('response_data'), '$.recurring_payment_uid'), actualRecurringUid),
                order: [['created_at', 'DESC']],
                attributes: ['id', 'response_data', 'created_at']
            });
        }

        // Strategy B: fallback to match by page_request_uid (if no match by recurring UID)
        if (!tx && pageRequestUid) {
            tx = await PaymentTransaction.findOne({
                where: Sequelize.where(Sequelize.fn('JSON_EXTRACT', Sequelize.col('response_data'), '$.page_request_uid'), pageRequestUid),
                order: [['created_at', 'DESC']],
                attributes: ['id', 'response_data', 'created_at']
            });
        }

        if (!tx) {
            console.log('⚠️ No PaymentTransaction matched by recurring_payment_uid or page_request_uid');
            return null;
        }

        // Parse response_data and return terminal_uid
        let payload = tx.response_data;
        if (typeof payload === 'string') {
            try {
                payload = JSON.parse(payload);
            } catch (e) {}
        }
        const terminalUid = payload?.terminal_uid || null;

        if (terminalUid) {
            console.log(`✅ Resolved terminal_uid from PaymentTransactions: ${terminalUid}`);
        } else {
            console.log('⚠️ PaymentTransaction found but terminal_uid missing in response_data');
        }

        return terminalUid || null;
    } catch (err) {
        console.error('❌ Error extracting terminal_uid from PaymentTransactions:', err);
        return null;
    }
};

// REPLACE the existing parseWebhookDataFromDB function
const parseWebhookDataFromDB = (webhookDataFromDB) => {
    try {
        let parsedData = webhookDataFromDB;
        if (typeof webhookDataFromDB === 'string') {
            parsedData = JSON.parse(webhookDataFromDB);
        }

        return {
            recurring_payment_uid: parsedData.original_webhook?.recurring_payment_uid || null,
            terminal_uid: parsedData.original_webhook?.terminal_uid || '',
            transaction_uid: parsedData.transaction_uid || '',
            page_request_uid: parsedData.original_webhook?.page_request_uid || ''
        };
    } catch (error) {
        console.error(`❌ Error parsing webhook data from DB:`, error);
        return {
            recurring_payment_uid: null,
            terminal_uid: null,
            transaction_uid: '',
            page_request_uid: ''
        };
    }
};

// REPLACE the existing cancelUserRecurringPayments function
const cancelUserRecurringPayments = async (userId, reason, cancelledBy, transaction) => {
    try {
        console.log(`🔄 Cancelling recurring payments for user ${userId}`);

        // Find all active recurring payments for this user
        const activeRecurringPayments = await RecurringPayment.findAll({
            where: {
                student_id: userId,
                status: { [Op.in]: ['pending', 'paid'] }
            },
            transaction
        });

        console.log(`📋 Found ${activeRecurringPayments.length} active recurring payments for user ${userId}`);

        let successCount = 0;
        let failureCount = 0;
        const results = [];

        for (const recurringPayment of activeRecurringPayments) {
            try {
                let payPlusCancelled = true;
                let actualRecurringUid = null;
                let terminalUid = null;

                // Get the actual recurring payment UID for cancellation using enhanced extraction
                actualRecurringUid = getRecurringPaymentUidForCancellation(recurringPayment);

                // Get terminal UID from webhook data
                terminalUid = await getTerminalUidFromRecord(recurringPayment);

                console.log(`🔍 Processing recurring payment ${recurringPayment.id}:`, {
                    originalPayplusUid: recurringPayment.payplus_transaction_uid,
                    extractedRecurringUid: actualRecurringUid,
                    extractedTerminalUid: terminalUid,
                    pageRequestUid: recurringPayment.payplus_page_request_uid
                });

                // Try to cancel at PayPlus if we have the UID
                if (actualRecurringUid && actualRecurringUid !== 'N/A' && actualRecurringUid !== '') {
                    // Parse webhook data for the API call
                    let webhookDataForApi = null;
                    try {
                        if (recurringPayment.webhook_data) {
                            webhookDataForApi = parseWebhookDataFromDB(recurringPayment.webhook_data);
                        }
                    } catch (parseError) {
                        console.log(`⚠️ Could not parse webhook data for payment ${recurringPayment.id}: ${parseError.message}`);
                    }

                    // Make the PayPlus API call with enhanced data
                    payPlusCancelled = await cancelPayPlusRecurringPayment(actualRecurringUid, recurringPayment.payplus_page_request_uid, webhookDataForApi);
                } else {
                    console.log(`⚠️ No valid recurring payment UID found for payment ${recurringPayment.id}, skipping PayPlus cancellation`);
                    payPlusCancelled = true; // Consider successful if there's nothing to cancel
                }

                // Update the recurring payment record regardless of PayPlus result
                const updateRemarks = `${recurringPayment.remarks || ''}\n[${new Date().toISOString()}] Cancelled: ${reason}. PayPlus cancelled: ${payPlusCancelled}. Used recurring UID: ${
                    actualRecurringUid || 'N/A'
                }. Terminal UID: ${terminalUid || 'N/A'}`;

                await recurringPayment.update(
                    {
                        status: 'cancelled',
                        is_active: false,
                        cancelled_at: new Date(),
                        cancelled_by: cancelledBy,
                        remarks: updateRemarks
                    },
                    { transaction }
                );

                if (payPlusCancelled) {
                    successCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        status: 'success',
                        message: 'Cancelled successfully at PayPlus'
                    });
                } else {
                    failureCount++;
                    results.push({
                        id: recurringPayment.id,
                        payplus_uid: recurringPayment.payplus_transaction_uid,
                        actual_recurring_uid: actualRecurringUid,
                        status: 'partial_success',
                        message: 'Marked as cancelled locally but PayPlus cancellation failed'
                    });
                }

                console.log(`✅ Processed recurring payment ${recurringPayment.id} for user ${userId} - PayPlus result: ${payPlusCancelled}`);
            } catch (error) {
                failureCount++;
                console.error(`❌ Error processing recurring payment ${recurringPayment.id}:`, error);

                results.push({
                    id: recurringPayment.id,
                    payplus_uid: recurringPayment.payplus_transaction_uid,
                    status: 'error',
                    message: error.message
                });
            }
        }

        console.log(`📊 Recurring payment cancellation summary for user ${userId}: ${successCount} successful, ${failureCount} failed`);

        return {
            total: activeRecurringPayments.length,
            successful: successCount,
            failed: failureCount,
            results
        };
    } catch (error) {
        console.error(`❌ Error in cancelUserRecurringPayments for user ${userId}:`, error);
        throw error;
    }
};

async function activateStudent(req, res) {
    try {
        const { id } = req.params;
        const { note } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            }
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        await student.update({
            status: 'active',
            updated_at: Math.floor(Date.now() / 1000),
            offline: false,
            offline_message: note || null
        });

        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: id,
                status: 'inactive'
            },
            order: [['id', 'DESC']]
        });

        if (subscription) {
            await subscription.update({
                status: 'active',
                updated_at: Math.floor(Date.now() / 1000)
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Student activated successfully'
        });
    } catch (err) {
        console.error('Error activating student:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to activate student',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function getStudentTeacherFeedback(req, res) {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10, teacher_id, from_date, to_date, sort_by = 'created_at', sort_order = 'DESC' } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: {
                id: id,
                role_name: 'user'
            }
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const whereConditions = {
            creator_id: id
        };

        if (teacher_id && teacher_id !== 'all') {
            whereConditions.instructor_id = teacher_id;
        }

        if (from_date) {
            whereConditions.created_at = {
                ...(whereConditions.created_at || {}),
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').unix()
            };
        }

        if (to_date) {
            whereConditions.created_at = {
                ...(whereConditions.created_at || {}),
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').unix()
            };
        }

        const validSortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

        const { count, rows } = await UserReview.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: User,
                    as: 'instructor',
                    attributes: ['id', 'full_name', 'avatar', 'headline'],
                    required: true
                }
            ],
            order: [['created_at', validSortOrder]],
            offset: (page - 1) * limit,
            limit: parseInt(limit),
            distinct: true
        });

        if (!rows || rows.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No feedback found',
                data: [],
                pagination: {
                    total: 0,
                    current_page: parseInt(page),
                    total_pages: 0,
                    per_page: parseInt(limit)
                }
            });
        }

        const feedbackData = rows.map((review) => {
            const feedbackDate = new Date(review.created_at * 1000);

            return {
                id: review.id.toString(),
                teacherName: review.instructor ? review.instructor.full_name : 'Unknown Teacher',
                teacherId: review.instructor_id,
                date: feedbackDate.toISOString(),
                rating: Math.round(parseFloat(review.rates)) || 0,
                comment: review.description || 'No comment provided',
                lessonType: 'General',
                status: review.status || 'pending',
                details: {
                    content_quality: review.content_quality,
                    instructor_skills: review.instructor_skills,
                    purchase_worth: review.purchase_worth,
                    support_quality: review.support_quality,
                    teacher_avatar: review.instructor ? review.instructor.avatar : null,
                    teacher_headline: review.instructor ? review.instructor.headline : null
                }
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Student feedback fetched successfully',
            data: feedbackData,
            pagination: {
                total: count,
                current_page: parseInt(page),
                total_pages: Math.ceil(count / limit),
                per_page: parseInt(limit)
            }
        });
    } catch (err) {
        console.error('Error fetching student feedback:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch student feedback',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}
/**
 * Get comprehensive lesson overview data for a student
 */
async function getLessonOverview(req, res) {
    try {
        const { id } = req.params;
        const page = parseInt(req.query.page || '1');
        const limit = parseInt(req.query.limit || '10');

        const { date_from, date_to, teacher, status, attendance } = req.query;

        console.log('query', req.query);

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Get student with subscription details
        const student = await User.findOne({
            where: { id: id, role_name: 'user' },
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    // where: { status: 'active' },
                    // status: ['active', 'inactive', 'inactive_after_renew', 'paused'],
                    required: false,
                    order: [['created_at', 'DESC']]
                    // limit: 1
                }
            ],
            attributes: ['id', 'full_name', 'email', 'timezone', 'next_month_subscription', 'next_year_subscription']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // After finding student
        const rawSubs = student.UserSubscriptions || [];
        // Sort subscriptions by renew_date (fallback to created_at if needed)
        const sortedSubs = [...rawSubs].sort((a, b) => {
            const aDate = a.renew_date || a.created_at;
            const bDate = b.renew_date || b.created_at;
            return new Date(bDate) - new Date(aDate); // newest first
        });
        const subscription = sortedSubs[0] || null;

        // For counts across all subs
        const subscriptionIds = sortedSubs.map((sub) => sub.id);

        // ---------------------------------------------
        // 🔹 Calculate PREVIOUS MONTH remaining lessons (correct way)
        // ---------------------------------------------
        let previousMonthRemaining = 0;

        // if (student.UserSubscriptions && student.UserSubscriptions.length > 1) {
        if (sortedSubs.length > 1) {
            const currentSub = sortedSubs[0];
            const previousSub = sortedSubs[1];

            console.log('previousSub', previousSub);

            // Only include previous leftover if user did NOT renew automatically
            console.log('student.next_month_subscription || student.next_year_subscription', student.next_month_subscription, student.next_year_subscription);
            if (!student.next_month_subscription && !student.next_year_subscription) {
                previousMonthRemaining = previousSub.left_lessons || 0;
            }
        }

        if (!subscription) {
            return res.status(200).json({
                status: 'success',
                message: 'No active subscription found',
                data: {
                    currentMonth: {
                        month: moment().format('MMMM YYYY'),
                        totalAdded: 0,
                        used: 0,
                        remaining: 0,
                        daysLeft: 0,
                        billingCycle: 'Monthly',
                        renewDate: moment().format('YYYY-MM-DD')
                    },
                    bonusLessons: { total: 0, used: 0, remaining: 0, expiryDate: null, breakdown: [] },
                    monthlyHistory: [],
                    lessonActivity: []
                }
            });
        }

        // -------------------------------------------------------
        // 🔹 Count TRIAL COMPLETED lessons (completed + converted)
        // -------------------------------------------------------
        const trialCompletedCount = await TrialClassRegistration.count({
            where: {
                email: student.email, // find all trials of this user
                status: {
                    [Op.in]: ['completed', 'converted']
                }
            }
        });

        const completedLessonsCount = await Class.count({
            where: {
                student_id: id,
                // subscription_id: { [Op.in]: subscriptionIds },
                status: 'ended'
            }
        });

        // Calculate current month data
        const currentMonth = moment().format('MMMM YYYY');
        const totalLessons = subscription.weekly_lesson || 0;
        const remainingLessons = subscription.left_lessons || 0;
        const usedLessons = Math.max(0, totalLessons - remainingLessons);
        const renewDate = subscription.renew_date || moment().add(1, 'month').format('YYYY-MM-DD');
        const daysLeft = Math.max(0, moment(renewDate).diff(moment(), 'days'));

        // Calculate bonus lessons
        const bonusTotal = subscription.bonus_class || 0;
        const bonusUsed = subscription.bonus_completed_class || 0;
        const bonusRemaining = Math.max(0, bonusTotal - bonusUsed);

        // Get bonus lesson breakdown
        const bonusBreakdown = await getBonusLessonBreakdown(subscription);

        // Get monthly history
        const monthlyHistory = await getMonthlyHistory(id);

        const { data: lessonActivity, pagination: lessonActivityPagination } = await getLessonActivity(
            id, // 1st argument
            { date_from, date_to, teacher, status, attendance }, // 2nd argument – filters only
            page, // 3rd argument
            limit
        );

        // 🔹 Top Teachers (via teacher_id)
        const topTeachersRaw = await Class.findAll({
            where: {
                student_id: id,
                status: 'ended'
            },
            attributes: ['teacher_id', [Sequelize.fn('COUNT', Sequelize.col('teacher_id')), 'total_classes']],
            group: ['teacher_id'],
            order: [[Sequelize.literal('total_classes'), 'DESC']],
            limit: 3,
            raw: true
        });

        // Get teacher details
        const teacherIds = topTeachersRaw.map((t) => t.teacher_id);
        const teachers = await User.findAll({
            where: { id: { [Op.in]: teacherIds } },
            attributes: ['id', 'full_name'],
            raw: true
        });

        const topTeachers = topTeachersRaw.map((t) => {
            const teacher = teachers.find((te) => te.id === t.teacher_id);
            return {
                teacher_id: t.teacher_id,
                name: teacher?.full_name || 'Unknown',
                classes_completed: parseInt(t.total_classes)
            };
        });

        const responseData = {
            currentMonth: {
                month: currentMonth,
                totalAdded: totalLessons,
                used: usedLessons,
                remaining: remainingLessons,
                daysLeft: daysLeft,
                billingCycle: subscription.type?.includes('Yearly') ? 'Yearly' : 'Monthly',
                renewDate: renewDate,
                previousMonthRemainingLessons: previousMonthRemaining
            },
            bonusLessons: {
                total: bonusTotal,
                used: bonusUsed,
                remaining: bonusRemaining,
                expiryDate: subscription.bonus_expire_date,
                breakdown: bonusBreakdown
            },
            monthlyHistory: monthlyHistory,
            lessonActivity,
            lessonActivityPagination,
            topTeachers,
            trialCompletedCount,
            totalCompletedLessons: completedLessonsCount
        };

        return res.status(200).json({
            status: 'success',
            message: 'Lesson overview fetched successfully',
            data: responseData
        });
    } catch (error) {
        console.error('Error fetching lesson overview:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch lesson overview',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

const exportLessonActivityCSV = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      date_from,
      date_to,
      teacher,
      status,
      attendance,
      booked_by,
      booked_from,
    } = req.query;

    // Fetch ALL lesson activity (no pagination, limit is huge)
    const { data: lessonActivity } = await getLessonActivity(
      id,
      { date_from, date_to, teacher, status, attendance, booked_by, booked_from },
      1,
      50000 // huge limit to ensure full export
    );

    if (!lessonActivity.length) {
      return res.status(200).send("No lesson history found.");
    }

    // -----------------------------
    // CSV Columns (Headers)
    // -----------------------------
    const headers = [
      "Lesson Date",
      "Lesson Time",
      "Status",
      "Teacher",
      "Duration",
      "Attendance",
      "Booked By",
      "Feedback Sent",
      "Homework Sent",
      "Homework Status"
    ];

    const csvRows = [headers];

    // -----------------------------
    // Build CSV Rows
    // -----------------------------
    lessonActivity.forEach((cls) => {
      csvRows.push([
        cls.date ? moment(cls.date).format("YYYY-MM-DD") : "N/A",
        cls.date ? moment(cls.date).format("HH:mm") : "N/A",
        cls.status || "N/A",
        cls.teacher || "Unknown",
        cls.duration || "45 min",
        cls.attendance || "N/A",
        cls.booked_by || "N/A",
        cls.feedback_sent ? "Yes" : "No",
        cls.homework_sent ? "Yes" : "No",
        cls.homework_status || "N/A",
      ]);
    });

    const csvString = csvRows.map((r) => r.join(",")).join("\n");

    const filename = `lesson-history-${id}-${moment().format("YYYYMMDD-HHmm")}.csv`;

    // -----------------------------
    // Response headers for CSV download
    // -----------------------------
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

    return res.send("\uFEFF" + csvString);
  } catch (error) {
    console.error("❌ Lesson Activity Export Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export lesson activity CSV",
    });
  }
};

async function getAllTeachers (req,res){
    try {
        const teachers = await User.findAll({
      where: { role_name: "teacher" },
      attributes: ["id", "full_name", "email"]
    });

    return res.status(200).json({
      success: true,
      data: teachers
    });
    } catch (error) {
        console.error("Error returning lessons:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to return lessons.",
      error: error.message,
    });
    }
}


/**
 * Add bonus lessons to a student
 */
async function addBonusLessons(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const { lessons, reason, expiryDate } = req.body;

        if (!id || !lessons || !reason || !expiryDate) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID, lessons count, reason, and expiry date are required'
            });
        }

        if (lessons <= 0 || lessons > 50) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Lessons count must be between 1 and 50'
            });
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: 'active' },
            order: [['created_at', 'DESC']],
            transaction: dbTransaction
        });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        // Parse existing bonus data
        let bonusData = [];
        if (subscription.data_of_bonus_class) {
            try {
                const parsed = JSON.parse(subscription.data_of_bonus_class);
                bonusData = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                console.error('Error parsing bonus data:', error);
                bonusData = [];
            }
        }

        // Add new bonus entry
        const newBonusEntry = {
            refresh: false,
            bonus_class: lessons.toString(),
            bonus_created_at: moment().format('YYYY-MM-DD HH:mm'),
            bonus_expire_date: moment(expiryDate).format('YYYY-MM-DD HH:mm'),
            bonus_completed_class: 0,
            bonus_reason: reason.trim(),
            admin_id: req.user?.id || null
        };

        bonusData.unshift(newBonusEntry);

        // Update subscription
        const currentBonusTotal = (subscription.bonus_class || 0) + parseInt(lessons);
         const updatedRemainingLessons =
        (subscription.left_lessons || 0) + parseInt(lessons);
        
        await subscription.update({
            bonus_class: currentBonusTotal,
            bonus_expire_date: moment(expiryDate).format('YYYY-MM-DD HH:mm:ss'),
            left_lessons: updatedRemainingLessons,
            data_of_bonus_class: JSON.stringify(bonusData),
            updated_at: new Date()
        }, { transaction: dbTransaction });

        await dbTransaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Bonus lessons added successfully',
            data: {
                id: subscription.id,
                bonus_class: currentBonusTotal,
                bonus_expire_date: subscription.bonus_expire_date,
                bonus_reason: reason
            }
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error adding bonus lessons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to add bonus lessons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

async function returnLessons(req, res) {
  const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

  try {
    const { id } = req.params;
    const { lessons, reason, validityType = "subscription_end", daysValid } = req.body;

    if (!id || !lessons || lessons <= 0) {
      await dbTransaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid data. Provide student ID and positive lesson count."
      });
    }

    // Fetch active subscription
    const subscription = await UserSubscriptionDetails.findOne({
      where: { user_id: id, status: "active" },
      order: [["created_at", "DESC"]],
      transaction: dbTransaction
    });

    if (!subscription) {
      await dbTransaction.rollback();
      return res.status(404).json({
        success: false,
        message: "No active subscription found for this student."
      });
    }

    // Calculate total lessons (weekly_lesson may be total planned lessons)
    const totalLessons = subscription.weekly_lesson || 0;
    const usedLessons = Math.max(0, totalLessons - (subscription.left_lessons || 0));

    // 🚨 Validate that return lessons <= used lessons
    if (lessons > usedLessons) {
      await dbTransaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot return ${lessons} lessons. Student has only used ${usedLessons}.`
      });
    }

    // 🧮 Update remaining lessons
    const updatedLeftLessons = (subscription.left_lessons || 0) + lessons;

    // 🕒 Compute expiry
    let expiryDate = null;
    if (validityType === "days" && daysValid) {
      expiryDate = moment().add(daysValid, "days").toDate();
    } else if (validityType === "subscription_end") {
      expiryDate = subscription.renew_date || null;
    }

    // 🧾 Prepare audit record
    let history = [];
    if (subscription.data_of_bonus_class) {
      try {
        let parsed = JSON.parse(subscription.data_of_bonus_class);
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
        history = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        history = [];
      }
    }

    const auditEntry = {
      type: "lesson_return",
      lessons,
      reason,
      validityType,
      daysValid,
      expires_at: expiryDate,
      admin_id: req.user?.id || null,
      created_at: new Date(),
    };

    history.unshift(auditEntry);

    // 🧱 Update subscription
    await subscription.update(
      {
        left_lessons: updatedLeftLessons,
        data_of_bonus_class: JSON.stringify(history),
        updated_at: new Date(),
      },
      { transaction: dbTransaction }
    );

    await dbTransaction.commit();

    return res.status(200).json({
      success: true,
      message: "Lessons returned successfully.",
      data: {
        returned: lessons,
        newRemaining: updatedLeftLessons,
        audit: auditEntry,
      },
    });
  } catch (error) {
    await dbTransaction.rollback();
    console.error("Error returning lessons:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to return lessons.",
      error: error.message,
    });
  }
}

/**
 * Expire current bonus lessons for a student
 */
async function expireBonusLessons(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;

        if (!id) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: "active" },
            order: [['created_at', 'DESC']],
            transaction: dbTransaction
        });

//         console.log('🎯 Subscription fetched for user', id, {
//   id: subscription.id,
//   bonus_class: subscription.bonus_class,
//   left_lessons: subscription.left_lessons,
//   data_of_bonus_class: subscription.data_of_bonus_class,
// });


        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        if (!subscription.bonus_class || subscription.bonus_class <= 0) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No active bonus lessons to expire'
            });
        }

        // // Mark current active bonus as expired
        // const currentBonusIndex = bonusData.findIndex(bonus => !bonus.refresh);
        // if (currentBonusIndex !== -1) {
        //     bonusData[currentBonusIndex] = {
        //         ...bonusData[currentBonusIndex],
        //         refresh: true,
        //         bonus_completed_class: subscription.bonus_completed_class || 0,
        //         refresh_reason: 'Expired by admin',
        //         refresh_date: moment().format('YYYY-MM-DD HH:mm'),
        //         refreshed_by_admin_id: req.user?.id
        //     };
        // }

        // const expiredLessons = subscription.bonus_class - (subscription.bonus_completed_class || 0);

        // // Update subscription
        // await subscription.update({
        //     bonus_class: 0,
        //     bonus_completed_class: 0,
        //     bonus_expire_date: null,
        //     data_of_bonus_class: JSON.stringify(bonusData),
        //     updated_at: new Date()
        // }, { transaction: dbTransaction });

        // await dbTransaction.commit();

        // Find currently active bonus
//         const currentBonusIndex = bonusData.findIndex(
//         (bonus) => bonus.refresh !== true
//         );

//     let expiredLessons = 0;

//     if (currentBonusIndex !== -1) {
//       const currentBonus = bonusData[currentBonusIndex];
//       const bonusCount = parseInt(currentBonus.bonus_class || 0);
//       const usedCount = parseInt(subscription.bonus_completed_class || 0);
//       expiredLessons = Math.max(0, bonusCount - usedCount);

//       console.log(
//   `💥 Expired ${expiredLessons} bonus lessons for Student ${id} | Left before: ${subscription.left_lessons}, Left after: ${updatedRemainingLessons}`
//     );


//       // Mark as expired
//       bonusData[currentBonusIndex] = {
//         ...currentBonus,
//         refresh: true,
//         bonus_completed_class: subscription.bonus_completed_class || 0,
//         refresh_reason: 'Expired by admin',
//         refresh_date: moment().format('YYYY-MM-DD HH:mm'),
//         refreshed_by_admin_id: req.user?.id || null,
//       };
//     }

//     // 🧠 Adjust the student's remaining lessons
//     const updatedRemainingLessons = Math.max(
//       0,
//       (subscription.left_lessons || 0) - expiredLessons
//     );

//     // 🧮 Update subscription record
//     await subscription.update(
//       {
//         bonus_class: 0,
//         bonus_completed_class: 0,
//         bonus_expire_date: null,
//         left_lessons: updatedRemainingLessons, // ✅ Deduct expired bonus lessons
//         data_of_bonus_class: JSON.stringify(bonusData),
//         updated_at: new Date(),
//       },
//       { transaction: dbTransaction }
//     );

//     await dbTransaction.commit();

let bonusData = [];

if (subscription.data_of_bonus_class) {
  try {
    let parsed = JSON.parse(subscription.data_of_bonus_class);

    // 🧠 Handle double-encoded JSON
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }

    bonusData = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error("Error parsing bonus data:", err);
    bonusData = [];
  }
}

    if (!bonusData.length) {
      await dbTransaction.rollback();
      return res.status(400).json({
        status: "error",
        message: "No bonus data found to expire",
      });
    }

    // 🔹 Find all unexpired bonuses
    const unexpiredBonuses = bonusData.filter((b) => b.refresh === false);

    if (!unexpiredBonuses.length) {
      await dbTransaction.rollback();
      return res.status(200).json({
        status: "success",
        message: "No active bonus lessons to expire",
        data: { expired_lessons: 0, remaining_lessons: subscription.left_lessons },
      });
    }

    // 🔹 Calculate total expired lessons
    const expiredLessons = unexpiredBonuses.reduce(
      (sum, b) => sum + parseInt(b.bonus_class || 0),
      0
    );

    // 🔹 Mark all bonuses as expired
    const updatedBonusData = bonusData.map((b) =>
      b.refresh
        ? b
        : {
            ...b,
            refresh: true,
            refresh_reason: "Expired by admin",
            refresh_date: moment().format("YYYY-MM-DD HH:mm"),
            refreshed_by_admin_id: req.user?.id || null,
          }
    );

    // 🔹 Deduct from remaining lessons
    const updatedLeftLessons = Math.max(
      0,
      (subscription.left_lessons || 0) - expiredLessons
    );

    // 🔹 Update subscription
    await subscription.update(
      {
        bonus_class: 0,
        bonus_completed_class: 0,
        bonus_expire_date: null,
        left_lessons: updatedLeftLessons,
        data_of_bonus_class: JSON.stringify(updatedBonusData),
        updated_at: new Date(),
      },
      { transaction: dbTransaction }
    );

    await dbTransaction.commit();

    // console.log(
    //   `💥 Expired ${expiredLessons} bonus lessons for Student ${id} | Left before: ${subscription.left_lessons}, Left after: ${updatedLeftLessons}`
    // );

        return res.status(200).json({
            status: 'success',
            message: 'Bonus lessons expired successfully',
            data: {
                expired_lessons: expiredLessons,
                remaining_lessons: updatedLeftLessons
            }
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error expiring bonus lessons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to expire bonus lessons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get bonus lesson history with admin details
 */
async function getBonusLessonHistory(req, res) {
    try {
        const { id } = req.params;

        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: 'active' },
            order: [['created_at', 'DESC']],
            attributes: ['id', 'bonus_class', 'bonus_completed_class', 'data_of_bonus_class', 'bonus_expire_date'],
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found'
            });
        }

        let bonusHistory = [];
        if (subscription.data_of_bonus_class) {
            try {
                bonusHistory = JSON.parse(subscription.data_of_bonus_class);

                // Fetch admin details for each bonus entry
                for (let bonus of bonusHistory) {
                    bonus.is_current = bonus.refresh === false;

                    if (bonus.admin_id) {
                        const admin = await User.findByPk(bonus.admin_id, {
                            attributes: ['id', 'full_name', 'email']
                        });
                        if (admin) {
                            bonus.admin_name = admin.full_name;
                            bonus.admin_email = admin.email;
                        }
                    }

                    if (bonus.refreshed_by_admin_id) {
                        const refreshAdmin = await User.findByPk(bonus.refreshed_by_admin_id, {
                            attributes: ['id', 'full_name', 'email']
                        });
                        if (refreshAdmin) {
                            bonus.refreshed_by_admin_name = refreshAdmin.full_name;
                            bonus.refreshed_by_admin_email = refreshAdmin.email;
                        }
                    }
                }
            } catch (error) {
                console.error('Error parsing bonus class history:', error);
                bonusHistory = [];
            }
        }

        return res.status(200).json({
            status: 'success',
            data: {
                current_bonus_class: subscription.bonus_class || 0,
                current_bonus_completed: subscription.bonus_completed_class || 0,
                bonus_expire_date: subscription.bonus_expire_date,
                student_info: {
                    id: subscription.SubscriptionUser?.id,
                    name: subscription.SubscriptionUser?.full_name,
                    email: subscription.SubscriptionUser?.email
                },
                bonus_history: bonusHistory
            },
            message: 'Bonus class history retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching bonus class history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
}

/**
 * Add regular lessons to current subscription
 */
async function addRegularLessons(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const { lessons, reason = 'Regular lessons added by admin' } = req.body;

        if (!id || !lessons) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID and lessons count are required'
            });
        }

        if (lessons <= 0 || lessons > 50) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Lessons count must be between 1 and 50'
            });
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: 'active' },
            order: [['created_at', 'DESC']],
            transaction: dbTransaction
        });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        // Update left lessons
        const newLeftLessons = (subscription.left_lessons || 0) + parseInt(lessons);

        await subscription.update(
            {
                left_lessons: newLeftLessons,
                updated_at: new Date()
            },
            { transaction: dbTransaction }
        );

        await dbTransaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Regular lessons added successfully',
            data: {
                added_lessons: parseInt(lessons),
                total_left_lessons: newLeftLessons,
                reason: reason
            }
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error adding regular lessons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to add regular lessons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Update rollover settings for a student
 */
async function updateRolloverSettings(req, res) {
    try {
        const { id } = req.params;
        const { next_month_subscription, next_year_subscription } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        const student = await User.findOne({
            where: { id: id, role_name: 'user' }
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        await student.update({
            next_month_subscription: next_month_subscription !== undefined ? next_month_subscription : student.next_month_subscription,
            next_year_subscription: next_year_subscription !== undefined ? next_year_subscription : student.next_year_subscription
        });

        return res.status(200).json({
            status: 'success',
            message: 'Rollover settings updated successfully',
            data: {
                next_month_subscription: student.next_month_subscription,
                next_year_subscription: student.next_year_subscription
            }
        });
    } catch (error) {
        console.error('Error updating rollover settings:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update rollover settings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get monthly lesson statistics
 */
async function getMonthlyLessonStats(req, res) {
    try {
        const { id } = req.params;
        const { months = 6 } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Get subscription history for the student
        const subscriptions = await UserSubscriptionDetails.findAll({
            where: { user_id: id },
            order: [['created_at', 'DESC']],
            limit: parseInt(months)
        });

        if (subscriptions.length === 0) {
            return res.status(200).json({
                status: 'success',
                data: {
                    monthly_stats: [],
                    summary: {
                        total_allocated: 0,
                        total_used: 0,
                        total_wasted: 0,
                        average_efficiency: 0
                    }
                },
                message: 'No subscription history found'
            });
        }

        const monthlyStats = [];
        let totalAllocated = 0;
        let totalUsed = 0;

        for (const subscription of subscriptions) {
            const month = moment(subscription.created_at).format('MMMM YYYY');
            const allocated = subscription.weekly_lesson || 0;
            const used = allocated - (subscription.left_lessons || 0);
            const bonusUsed = subscription.bonus_completed_class || 0;
            const efficiency = allocated > 0 ? Math.round((used / allocated) * 100) : 0;

            monthlyStats.push({
                month: month,
                allocated: allocated,
                used: used,
                bonus_used: bonusUsed,
                rollover_from_previous: 0, // This would need additional logic to track
                rollover_to_next: subscription.left_lessons || 0,
                efficiency_rate: efficiency
            });

            totalAllocated += allocated;
            totalUsed += used;
        }

        const totalWasted = totalAllocated - totalUsed;
        const averageEfficiency = totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                monthly_stats: monthlyStats,
                summary: {
                    total_allocated: totalAllocated,
                    total_used: totalUsed,
                    total_wasted: Math.max(0, totalWasted),
                    average_efficiency: averageEfficiency
                }
            },
            message: 'Monthly lesson statistics retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching monthly lesson stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch monthly lesson statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Roll over unused lessons from previous months
 */
async function rolloverLessons(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;
        const { month, lessons, rollover_type } = req.body;

        if (!id || !month || !lessons || !rollover_type) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID, month, lessons count, and rollover type are required'
            });
        }

        if (!['next_month', 'next_year'].includes(rollover_type)) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Rollover type must be either "next_month" or "next_year"'
            });
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: 'active' },
            order: [['created_at', 'DESC']],
            transaction: dbTransaction
        });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        // Add rollover lessons to current subscription
        const newLeftLessons = (subscription.left_lessons || 0) + parseInt(lessons);

        await subscription.update(
            {
                left_lessons: newLeftLessons,
                updated_at: new Date()
            },
            { transaction: dbTransaction }
        );

        // Update student rollover settings
        const updateData = {};
        if (rollover_type === 'next_month') {
            updateData.next_month_subscription = true;
        } else {
            updateData.next_year_subscription = true;
        }

        await User.update(updateData, {
            where: { id: id },
            transaction: dbTransaction
        });

        await dbTransaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Lessons rolled over successfully',
            data: {
                rolled_over_lessons: parseInt(lessons),
                total_left_lessons: newLeftLessons,
                rollover_type: rollover_type,
                from_month: month
            }
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error rolling over lessons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to rollover lessons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Clear unused lessons (remove them permanently)
 */
async function clearUnusedLessons(req, res) {
    const dbTransaction = await UserSubscriptionDetails.sequelize.transaction();

    try {
        const { id } = req.params;

        if (!id) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Get active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { user_id: id, status: 'active' },
            order: [['created_at', 'DESC']],
            transaction: dbTransaction
        });

        if (!subscription) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No active subscription found for this student'
            });
        }

        const clearedLessons = subscription.left_lessons || 0;

        if (clearedLessons <= 0) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No unused lessons to clear'
            });
        }

        // Clear unused lessons
        await subscription.update(
            {
                left_lessons: 0,
                updated_at: new Date()
            },
            { transaction: dbTransaction }
        );

        await dbTransaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Unused lessons cleared successfully',
            data: {
                cleared_lessons: clearedLessons,
                remaining_lessons: 0
            }
        });
    } catch (error) {
        await dbTransaction.rollback();
        console.error('Error clearing unused lessons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to clear unused lessons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// HELPER FUNCTIONS

/**
 * Get bonus lesson breakdown from subscription data
 */
async function getBonusLessonBreakdown(subscription) {
    const breakdown = [];

    if (subscription.data_of_bonus_class) {
        try {
            const bonusData = JSON.parse(subscription.data_of_bonus_class);

            for (let i = 0; i < bonusData.length; i++) {
                const bonus = bonusData[i];
                let adminName = 'Unknown Admin';

                if (bonus.admin_id) {
                    const admin = await User.findByPk(bonus.admin_id, {
                        attributes: ['full_name']
                    });
                    if (admin) {
                        adminName = admin.full_name;
                    }
                }

                breakdown.push({
                    id: `bonus_${i}`,
                    date: bonus.bonus_created_at || bonus.created_at || new Date().toISOString(),
                    type: 'admin_added',
                    reason: bonus.bonus_reason || 'Bonus lessons added',
                    lessons: parseInt(bonus.bonus_class) || 0,
                    status: bonus.refresh ? 'used' : 'available',
                    admin_name: adminName,
                    created_at: bonus.bonus_created_at || new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error parsing bonus data:', error);
        }
    }

    return breakdown;
}

/**
 * Get monthly history for student
 */
async function getMonthlyHistory(studentId, limit = 6) {
    try {
        const subscriptions = await UserSubscriptionDetails.findAll({
            where: { user_id: studentId },
            order: [['created_at', 'DESC']],
            limit: limit,
            attributes: ['weekly_lesson', 'left_lessons', 'created_at', 'status']
        });

        return subscriptions.map((sub, index) => {
            const month = moment(sub.created_at).format('MMMM YYYY');
            const added = sub.weekly_lesson || 0;
            const unused = sub.left_lessons || 0;
            const used = added - unused;

            return {
                month: month,
                added: added,
                used: Math.max(0, used),
                unused: unused,
                status: index === 0 ? 'current' : 'completed'
            };
        });
    } catch (error) {
        console.error('Error fetching monthly history:', error);
        return [];
    }
}

async function getLessonActivity(studentId, filters = {}, page = 1, limit = 10) {
  try {
    const offset = (page - 1) * limit;

    const where = { 
      student_id: studentId,
    //   is_regular_hide: 0
    };

    console.log('filters',filters);
    console.log('studentId',studentId);

    // Date filters
    if (filters.date_from) {
      where.meeting_start = {
        ...(where.meeting_start || {}),
        [Op.gte]: new Date(filters.date_from)
      };
    }

    if (filters.date_to) {
      where.meeting_start = {
        ...(where.meeting_start || {}),
        [Op.lte]: new Date(filters.date_to + " 23:59:59")
      };
    }

    // // Status filter
    // if (filters.status && filters.status !== "all") {
    //   where.status = filters.status;
    // }

     // Status filter — FIXED
    if (filters.status && filters.status !== "all") {
      if (filters.status === "cancelled") {
        where.cancelled_at = { [Op.ne]: null };
      } else {
        where.status = filters.status;
      }
    }

    // Attendance filter
    if (filters.attendance) {
    where.is_present = filters.attendance === "Arrived" ? 1 : 0;
    }

    const include = [
      {
        model: User,
        as: "Teacher",
        attributes: ["full_name", "email"]
      },
      {
        model: LessonFeedback,
        as: "Feedback",
        attributes: ["id"]
      },
      {
        model: Homework,
        as: "Homework",
        attributes: ["id", "status"]
      }
    ];

    // Teacher filter
    if (filters.teacher) {
      include[0].where = {
        [Op.or]: [
          { full_name: { [Op.like]: `%${filters.teacher}%` } },
          { email: { [Op.like]: `%${filters.teacher}%` } }
        ]
      };
      include[0].required = true;
    }

    // Count total
    const totalRecords = await Class.count({ where });

    const classes = await Class.findAll({
      where,
      include,
      order: [["meeting_start", "DESC"]],
      offset,
      limit
    });

    const mapped = classes.map((cls) => {
        const startUTC = cls.meeting_start
        ? moment.utc(cls.meeting_start).local().format("YYYY-MM-DD HH:mm")
        : null;

      const endUTC = cls.meeting_end
        ? moment.utc(cls.meeting_end).local().format("YYYY-MM-DD HH:mm")
        : null;
        return {
      id: cls.id,
      date: cls.meeting_start
      ? moment(cls.meeting_start).utc().toISOString()
      : null,
      status: cls.status,
      teacher: cls.Teacher?.full_name || "Unknown",
      duration: cls.meeting_end
          ? moment
              .utc(moment(cls.meeting_end).diff(moment(cls.meeting_start)))
              .format("mm") + " min"
          : "45 min",
      attendance: cls.is_present ? "Arrived" : "Not Arrived",
      booked_by: cls.booked_by,
      booked_from:cls.class_type,
      feedback_sent: !!cls.Feedback,
      homework_sent: !!cls.Homework,
      homework_status: cls.Homework?.status || null
  }});

    return {
      data: mapped,
      pagination: {
        page,
        limit,
        total: totalRecords,
        pages: Math.ceil(totalRecords / limit)
      }
    };
  } catch (error) {
    console.error("Error fetching lesson activity with pagination:", error);
    return { data: [], pagination: { page, limit, total: 0, pages: 0 } };
  }
}



/**
 * Get all payment records for a student with enhanced refund details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getStudentPaymentHistory(req, res) {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10, status = 'all', payment_method = 'all', from_date, to_date, sort_by = 'created_at', sort_order = 'DESC' } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Verify student exists
        const student = await User.findOne({
            where: { id: id, role_name: 'user' },
            attributes: ['id', 'full_name', 'email']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Build where conditions for payments
        const whereConditions = {
            student_id: id
        };

        // Add status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Add payment method filter
        if (payment_method && payment_method !== 'all') {
            whereConditions.payment_method = payment_method;
        }

        // Add date range filter
        if (from_date) {
            whereConditions.created_at = {
                ...(whereConditions.created_at || {}),
                [Op.gte]: moment(from_date, 'YYYY-MM-DD').startOf('day').toDate()
            };
        }

        if (to_date) {
            whereConditions.created_at = {
                ...(whereConditions.created_at || {}),
                [Op.lte]: moment(to_date, 'YYYY-MM-DD').endOf('day').toDate()
            };
        }

        // Validate sort order
        const validSortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

        // Get payment transactions with enhanced fields for refunds
        const { count, rows: paymentTransactions } = await PaymentTransaction.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: User,
                    as: 'StudentUser', // Use the correct alias from associations
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                },
                {
                    model: User,
                    as: 'SalesAgent', // Use the correct alias for generated_by relationship
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ],
            order: [[sort_by, validSortOrder]],
            offset: (page - 1) * limit,
            limit: parseInt(limit),
            distinct: true
        });

        // Get recurring payments
        const recurringPayments = await RecurringPayment.findAll({
            where: { student_id: id },
            order: [['created_at', 'DESC']],
            limit: 10
        });

        // Enhanced format payment transactions with refund details
        const formattedPayments = paymentTransactions.map((payment) => {
            const basePayment = {
                id: payment.id,
                transaction_id: payment.transaction_id || payment.token,
                type: 'one_time',
                amount: parseFloat(payment.amount || 0),
                currency: payment.currency || 'ILS',
                status: payment.status,
                payment_method: payment.payment_method || 'credit_card',
                card_last_digits: payment.card_last_digits,
                date: payment.created_at,
                subscription_details: {
                    lessons_per_month: payment.lessons_per_month,
                    lesson_minutes: payment.lesson_minutes,
                    custom_months: payment.custom_months,
                    is_recurring: payment.is_recurring
                },
                can_download_invoice: payment.payment_processor === 'payplus' && payment.status === 'success',
                generated_by: payment.generated_by,
                processor: payment.payment_processor
            };

            // Add refund details if payment is refunded
            if (payment.status === 'refunded') {
                basePayment.refund_details = {
                    refund_amount: parseFloat(payment.refund_amount || 0),
                    refund_type: payment.refund_type || 'full',
                    refund_reason: payment.refund_reason || 'No reason provided',
                    refund_date: payment.refund_date || payment.updated_at,
                    lessons_deducted: payment.lessons_deducted || 0,
                    subscription_action: payment.subscription_action || 'continue',
                    refund_processed_by: payment.refund_processed_by,
                    refund_processed_by_name: payment.refund_processed_by_name,
                    email_notification_sent: payment.email_notification_sent || false,
                    custom_refund_reason: payment.custom_refund_reason || '',
                    acknowledged_used_lessons: payment.acknowledged_used_lessons || false,
                    // Additional fields for frontend RefundDetails interface
                    original_amount: parseFloat(payment.amount || 0),
                    currency: payment.currency || 'ILS',
                    transaction_id: payment.transaction_id || payment.token,
                    student_name: payment.student_name || student.full_name,
                    payment_date: payment.created_at
                };

                // Override can_download_invoice for refunded payments
                basePayment.can_download_invoice = false;
            }

            return basePayment;
        });

        // Format recurring payments (no changes needed here)
        const formattedRecurringPayments = recurringPayments.map((payment) => ({
            id: payment.id,
            transaction_id: payment.transaction_id || payment.payplus_transaction_uid,
            type: 'recurring',
            amount: parseFloat(payment.amount || 0),
            currency: payment.currency || 'ILS',
            status: payment.status,
            payment_method: payment.payment_method || 'credit_card',
            card_last_digits: payment.card_last_digits,
            date: payment.payment_date || payment.created_at,
            recurring_details: {
                frequency: payment.recurring_frequency,
                next_payment: payment.next_payment_date,
                is_active: payment.is_active
            },
            can_download_invoice: payment.status === 'paid',
            processor: 'payplus'
        }));

        // ----------------------------------------------
        // ⭐ UPDATED SUMMARY CALCULATION (FINAL VERSION)
        // ----------------------------------------------

        let totalPaid = 0;
        let totalRefunded = 0;
        let successfulPayments = 0;
        let failedPayments = 0;

        formattedPayments.forEach((p) => {
            const isSuccessOriginal = p.status === "success" || p.status === "paid";
            const isRefunded = p.status === "refunded";

            // Count "successful" even if refunded later
            if (isSuccessOriginal || isRefunded) {
                successfulPayments += 1;
                totalPaid += p.amount; // always original amount
            }

            // Refund amount
            if (p.refund_details?.refund_amount) {
                totalRefunded += p.refund_details.refund_amount;
            }

            // Failed
            if (p.status === "failed") {
                failedPayments += 1;
            }
        });

        const netPaid = totalPaid - totalRefunded;

        // ----------------------------------------------

        // // Calculate summary statistics
        // const totalAmount = formattedPayments.filter((p) => p.status === 'success').reduce((sum, p) => sum + p.amount, 0);

        // const successfulPayments = formattedPayments.filter((p) => p.status === 'success').length;
        // const failedPayments = formattedPayments.filter((p) => p.status === 'failed').length;

        return res.status(200).json({
            status: 'success',
            message: 'Payment history retrieved successfully',
            data: {
                student: {
                    id: student.id,
                    name: student.full_name,
                    email: student.email
                },
                payments: formattedPayments,
                recurring_payments: formattedRecurringPayments,
                // summary: {
                //     total_amount: totalAmount,
                //     successful_payments: successfulPayments,
                //     failed_payments: failedPayments,
                //     total_payments: count
                // },
                summary: {
                    total_paid: totalPaid,
                    total_refunded: totalRefunded,
                    net_paid: netPaid,
                    successful_payments: successfulPayments,
                    failed_payments: failedPayments,
                    total_payments: count
                },
                pagination: {
                    total: count,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(count / limit),
                    per_page: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Error fetching student payment history:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment history',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Download invoice for a specific transaction - FIXED VERSION
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function downloadStudentInvoice(req, res) {
    try {
        const { id, transaction_id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query;

        if (!id || !transaction_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID and transaction ID are required'
            });
        }

        // Verify student exists and owns this transaction
        const student = await User.findOne({
            where: { id: id, role_name: 'user' },
            attributes: ['id', 'full_name', 'email']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Find the payment transaction
        const paymentTransaction = await PaymentTransaction.findOne({
            where: {
                student_id: id,
                [Op.or]: [{ transaction_id: transaction_id }, { token: transaction_id }],
                status: 'success'
            }
        });

        if (!paymentTransaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment transaction not found or not successful'
            });
        }

        // Check if transaction is from PayPlus (required for invoice download)
        if (paymentTransaction.payment_processor !== 'payplus') {
            return res.status(400).json({
                status: 'error',
                message: 'Invoice download is only available for PayPlus transactions'
            });
        }

        // Use the actual transaction UID for PayPlus API call
        const transaction_uid = paymentTransaction.transaction_id || paymentTransaction.token;

        // Validate type parameter
        if (!['original', 'copy'].includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: 'Type must be either "original" or "copy"'
            });
        }

        // FIXED: Use POST method with proper payload for PayPlus API
        const payplusUrl = `${process.env.PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
        const requestData = {
            transaction_uid: transaction_uid,
            filter: {}
        };

        const headers = {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': process.env.PAYPLUS_API_KEY,
            'secret-key': process.env.PAYPLUS_SECRET_KEY
        };

        // Get invoice documents using POST method
        const response = await axios.post(payplusUrl, requestData, {
            headers,
            timeout: 30000
        });

        if (response.status !== 200 || !response.data) {
            console.error(`❌ Invalid PayPlus API response:`, response.data);
            return res.status(404).json({
                status: 'error',
                message: 'Failed to retrieve invoice information from PayPlus',
                transaction_uid: transaction_uid,
                payplus_response: response.data
            });
        }

        // Check if the response contains invoice data
        let invoices = [];

        // Handle different response formats from PayPlus
        if (response.data.invoices && Array.isArray(response.data.invoices)) {
            invoices = response.data.invoices;
        } else if (response.data.results && Array.isArray(response.data.results)) {
            invoices = response.data.results;
        } else if (response.data.data && Array.isArray(response.data.data)) {
            invoices = response.data.data;
        } else if (Array.isArray(response.data)) {
            invoices = response.data;
        } else {
            console.error(`❌ Unexpected PayPlus response format:`, response.data);
            return res.status(404).json({
                status: 'error',
                message: 'Unexpected response format from PayPlus API',
                transaction_uid: transaction_uid,
                response_keys: Object.keys(response.data)
            });
        }

        if (invoices.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No invoice documents found for this transaction',
                transaction_uid: transaction_uid,
                payplus_response: response.data
            });
        }

        // Find the first successful invoice or just take the first one
        let invoice = invoices.find((inv) => inv.status === 'success' || inv.status === 'approved');
        if (!invoice) {
            invoice = invoices[0]; // Take the first invoice if no successful one found
        }

        // Get the appropriate download URL - try multiple possible field names
        let downloadUrl = null;

        if (type === 'original') {
            downloadUrl = invoice.original_doc_url || invoice.original_url || invoice.original_document_url || invoice.doc_url || invoice.document_url || invoice.pdf_url || invoice.url;
        } else {
            downloadUrl =
                invoice.copy_doc_url ||
                invoice.copy_url ||
                invoice.copy_document_url ||
                invoice.original_doc_url || // Fallback to original if copy not available
                invoice.doc_url ||
                invoice.document_url ||
                invoice.pdf_url ||
                invoice.url;
        }

        if (!downloadUrl) {
            console.error(`❌ No download URL found in invoice:`, invoice);
            return res.status(404).json({
                status: 'error',
                message: `${type} document URL not available for this invoice`,
                transaction_uid: transaction_uid,
                available_fields: Object.keys(invoice),
                invoice_data: invoice
            });
        }

        // Download the document from PayPlus
        const documentResponse = await axios.get(downloadUrl, {
            responseType: 'stream',
            timeout: 60000,
            headers: {
                'api-key': process.env.PAYPLUS_API_KEY,
                'secret-key': process.env.PAYPLUS_SECRET_KEY,
                'User-Agent': 'Tulkka-Admin-Portal/1.0'
            }
        });

        if (documentResponse.status !== 200) {
            throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
        }

        // Determine content type and filename
        const contentType = documentResponse.headers['content-type'] || 'application/pdf';
        const filename = `invoice_${student.full_name.replace(/\s+/g, '_')}_${transaction_uid}_${type}.${format}`;

        // Set response headers for file download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache');

        // Stream the document to the client
        documentResponse.data.pipe(res);

        // Handle stream errors
        documentResponse.data.on('error', (error) => {
            console.error(`❌ Error streaming invoice document:`, error);
            if (!res.headersSent) {
                res.status(500).json({
                    status: 'error',
                    message: 'Error streaming invoice document',
                    details: error.message
                });
            }
        });

        // Log successful download
        documentResponse.data.on('end', () => {
            console.log(`✅ Successfully downloaded invoice for student ${student.full_name}, transaction ${transaction_uid}`);
        });
    } catch (error) {
        console.error(`❌ Error downloading invoice for student ${req.params.id}, transaction ${req.params.transaction_id}:`, error);

        // Prevent sending response if headers already sent
        if (res.headersSent) {
            return;
        }

        // Handle specific errors
        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;

            console.error(`❌ PayPlus API Error - Status: ${statusCode}, Data:`, errorData);

            if (statusCode === 404) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Invoice document not found in PayPlus system',
                    transaction_id: req.params.transaction_id,
                    details: 'The transaction may not have generated an invoice yet, or the invoice may have been deleted.'
                });
            }

            if (statusCode === 401 || statusCode === 403) {
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication failed with PayPlus API',
                    details: 'Please check PayPlus API credentials configuration.'
                });
            }

            return res.status(500).json({
                status: 'error',
                message: 'PayPlus API error during invoice retrieval',
                details: errorData || error.message,
                status_code: statusCode
            });
        }

        // Handle network or other errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({
                status: 'error',
                message: 'PayPlus API is currently unavailable',
                details: 'Please try again later.'
            });
        }

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while downloading invoice',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Please contact support.'
        });
    }
}

/**
 * Get payment statistics for a student
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getStudentPaymentStats(req, res) {
    try {
        const { id } = req.params;
        const { months = 12 } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }

        // Verify student exists
        const student = await User.findOne({
            where: { id: id, role_name: 'user' },
            attributes: ['id', 'full_name', 'email']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const monthsBack = parseInt(months) || 12;
        const dateCondition = {
            created_at: {
                [Op.gte]: moment().subtract(monthsBack, 'months').startOf('month').toDate()
            }
        };

        // Get payment transactions statistics
        const paymentStats = await PaymentTransaction.findAll({
            where: {
                student_id: id,
                ...dateCondition
            },
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), '%Y-%m'), 'month'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_payments'],
                [
                    Sequelize.fn(
                        'SUM',
                        Sequelize.literal(`
              CASE 
                WHEN status = 'success' THEN amount
                WHEN status = 'refunded' THEN -COALESCE(refund_amount, amount)
                ELSE 0 
              END
            `)
                    ),
                    'total_amount'
                ],
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'success' THEN 1 END")), 'successful_payments'],
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'failed' THEN 1 END")), 'failed_payments'],
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'refunded' THEN 1 END")), 'refunded_payments'],
                [Sequelize.fn('SUM', Sequelize.literal("CASE WHEN status = 'refunded' THEN COALESCE(refund_amount, amount) ELSE 0 END")), 'total_refunded']
            ],
            group: [Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), '%Y-%m')],
            order: [[Sequelize.fn('DATE_FORMAT', Sequelize.col('created_at'), '%Y-%m'), 'ASC']],
            raw: true
        });

        const overallStats = await PaymentTransaction.findOne({
            where: { student_id: id },
            attributes: [
                // Count all payments
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_payments'],

                // Total paid (success + refunded)
                [Sequelize.fn('SUM', Sequelize.literal("CASE WHEN status IN ('success', 'refunded') THEN amount ELSE 0 END")), 'total_amount'],

                // Average only on success
                [Sequelize.fn('AVG', Sequelize.literal("CASE WHEN status = 'success' THEN amount END")), 'average_payment'],

                // Success count
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'success' THEN 1 END")), 'successful_payments'],

                // Failed count
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'failed' THEN 1 END")), 'failed_payments'],

                // Refunded count
                [Sequelize.fn('COUNT', Sequelize.literal("CASE WHEN status = 'refunded' THEN 1 END")), 'refunded_payments']
            ],
            raw: true
        });

        // Get latest payment
        const latestPayment = await PaymentTransaction.findOne({
            where: { student_id: id },
            order: [['created_at', 'DESC']],
            attributes: ['amount', 'currency', 'status', 'created_at', 'payment_method']
        });

        // Format monthly data
        const monthlyData = [];
        for (let i = monthsBack - 1; i >= 0; i--) {
            const month = moment().subtract(i, 'months').format('YYYY-MM');
            const monthName = moment().subtract(i, 'months').format('MMM YYYY');

            const monthStat = paymentStats.find((stat) => stat.month === month);

            monthlyData.push({
                month: monthName,
                total_payments: parseInt(monthStat?.total_payments || 0),
                total_amount: parseFloat(monthStat?.total_amount || 0),
                total_refunded: parseFloat(monthStat?.total_refunded || 0),
                net_total: parseFloat((monthStat?.total_amount || 0) - (monthStat?.total_refunded || 0)),
                successful_payments: parseInt(monthStat?.successful_payments || 0),
                failed_payments: parseInt(monthStat?.failed_payments || 0),
                refunded_payments: parseInt(monthStat?.refunded_payments || 0),
                success_rate: monthStat?.total_payments ? Math.round((parseInt(monthStat.successful_payments || 0) / parseInt(monthStat.total_payments)) * 100) : 0
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Payment statistics retrieved successfully',
            data: {
                student: {
                    id: student.id,
                    name: student.full_name,
                    email: student.email
                },
                overall_stats: {
                    total_payments: parseInt(overallStats?.total_payments || 0),
                    total_amount: parseFloat(overallStats?.total_amount || 0), // ✔ 3325 correct
                    successful_payments: parseInt(overallStats?.successful_payments || 0),
                    failed_payments: parseInt(overallStats?.failed_payments || 0),
                    refunded_payments: parseInt(overallStats?.refunded_payments || 0),
                    average_payment: parseFloat(overallStats?.average_payment || 0),
                    success_rate: overallStats?.total_payments ? Math.round((parseInt(overallStats?.successful_payments || 0) / parseInt(overallStats?.total_payments)) * 100) : 0
                },
                latest_payment: latestPayment
                    ? {
                          amount: parseFloat(latestPayment.amount),
                          currency: latestPayment.currency,
                          status: latestPayment.status,
                          date: latestPayment.created_at,
                          method: latestPayment.payment_method
                      }
                    : null,
                monthly_data: monthlyData
            }
        });
    } catch (err) {
        console.error('Error fetching student payment statistics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment statistics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get detailed refund information for a specific transaction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getRefundDetails(req, res) {
    try {
        const { id, transaction_id } = req.params;

        if (!id || !transaction_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID and transaction ID are required'
            });
        }

        // Verify student exists
        const student = await User.findOne({
            where: { id: id, role_name: 'user' },
            attributes: ['id', 'full_name', 'email']
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Find the refunded transaction with all refund details
        const transaction = await PaymentTransaction.findOne({
            where: {
                student_id: id,
                [Op.or]: [{ transaction_id: transaction_id }, { token: transaction_id }],
                status: 'refunded'
            },
            attributes: [
                'id',
                'transaction_id',
                'token',
                'amount',
                'currency',
                'status',
                'payment_method',
                'card_last_digits',
                'student_name',
                'created_at',
                'refund_amount',
                'refund_type',
                'refund_reason',
                'refund_date',
                'lessons_deducted',
                'subscription_action',
                'refund_processed_by',
                'refund_processed_by_name',
                'email_notification_sent',
                'custom_refund_reason',
                'acknowledged_used_lessons'
            ],
            include: [
                {
                    model: User,
                    as: 'RefundProcessor',
                    foreignKey: 'refund_processed_by',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Refunded transaction not found'
            });
        }

        // Format the refund details response
        const refundDetails = {
            transaction: {
                id: transaction.id,
                transaction_id: transaction.transaction_id || transaction.token,
                original_amount: parseFloat(transaction.amount),
                currency: transaction.currency,
                payment_method: transaction.payment_method,
                card_last_digits: transaction.card_last_digits,
                payment_date: transaction.created_at,
                student_name: transaction.student_name || student.full_name
            },
            refund: {
                refund_amount: parseFloat(transaction.refund_amount || 0),
                refund_type: transaction.refund_type || 'full',
                refund_reason: transaction.refund_reason || 'No reason provided',
                refund_date: transaction.refund_date,
                lessons_deducted: transaction.lessons_deducted || 0,
                subscription_action: transaction.subscription_action || 'continue',
                email_notification_sent: transaction.email_notification_sent || false,
                custom_refund_reason: transaction.custom_refund_reason || '',
                acknowledged_used_lessons: transaction.acknowledged_used_lessons || false
            },
            processing: {
                processed_by_id: transaction.refund_processed_by,
                processed_by_name: transaction.refund_processed_by_name || 'Unknown Admin',
                processed_by_email: null // We don't have this without the association
            },
            student: {
                id: student.id,
                name: student.full_name,
                email: student.email
            }
        };

        return res.status(200).json({
            status: 'success',
            message: 'Refund details retrieved successfully',
            data: refundDetails
        });
    } catch (err) {
        console.error('Error fetching refund details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch refund details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

const getStudentKPI = async (req, res) => {
  try {
    const { id } = req.params;

    // Filters from query params
    const { start_date, end_date, teacher_name } = req.query;

    console.log('attributes of kpi',req.params,req.query);

    // Base where condition
    let where = {
      student_id: id
    };

    // ---- DATE FILTER ----
    if (start_date && end_date) {
      where.meeting_start = {
        [Op.between]: [
          moment(start_date).utc().toDate(),
          moment(end_date).utc().endOf("day").toDate()
        ]
      };
    }

    // ---- TEACHER NAME FILTER ----
    let teacherFilter = {};
    if (teacher_name) {
      teacherFilter = {
        full_name: {
          [Op.like]: `%${teacher_name}%`
        }
      };
    }

    // ---- Fetch all classes matching filters ----
    const classes = await Class.findAll({
      where,
      include: [
        {
          model: User,
          as: "Teacher",
          attributes: ["id", "full_name"],
          where: teacherFilter
        }
      ]
    });

    // -------- FORMAT UTC DATES --------
    const formattedClasses = classes.map((c) => ({
      ...c.get(),
      meeting_start_utc: c.meeting_start
        ? moment(c.meeting_start).utc().format("YYYY-MM-DD HH:mm:ss")
        : null,
      meeting_end_utc: c.meeting_end
        ? moment(c.meeting_end).utc().format("YYYY-MM-DD HH:mm:ss")
        : null,
    }));

    // -------- KPI METRICS --------
    let total_classes = classes.filter((c) => 
      c.is_regular_hide === false
    ).length;
    const cancelled = classes.filter((c)=>c.status==='canceled' && c.is_regular_hide === false).length;
    const pending = classes.filter((c) => c.status === "pending" && c.is_regular_hide === false).length;
    
    // Only count ended classes with is_present flag
    const attended = classes.filter((c) => c.status === 'ended' && c.is_present === true).length;
    const notAttended = classes.filter((c) => c.status === 'ended' && c.is_present === false).length;
    
    // total_classes-=cancelled;

    return res.json({
      success: true,
      kpi: {
        total_classes,
        pending,
        attended,
        notAttended,
        cancelled,
      },
      filtersApplied: { start_date, end_date, teacher_name },
      classes: formattedClasses
    });
  } catch (error) {
    console.log("KPI Error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};

const addPrevUnusedLessons = async (req, res) => {
  const { id } = req.params; // studentId
  const { prev_unused_lessons } = req.body;

  try {
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Student ID is required",
      });
    }

    // Fetch all subscriptions of this student
    const subs = await UserSubscriptionDetails.findAll({
      where: { user_id: id },
      order: [["renew_date", "DESC"]],
    });

    if (!subs || subs.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No subscriptions found for this student",
      });
    }

    // Current = most recent
    const currentSub = subs[0];

    // Previous subscription
    const previousSub = subs[1];

    if (!previousSub) {
      return res.status(400).json({
        success: false,
        message: "No previous subscription found",
      });
    }

    const prevLeft = previousSub.left_lessons || 0;

    if (prevLeft <= 0) {
      return res.status(400).json({
        success: false,
        message: "No previous leftover lessons to add",
      });
    }

    if (!prev_unused_lessons || prev_unused_lessons <= 0)
      return res.status(400).json({ success: false, message: "Invalid lesson count" });

    if (prev_unused_lessons > prevLeft)
      return res.status(400).json({
        success: false,
        message: `Cannot add more than ${prevLeft} unused lessons`,
      });


    // Step 1: Add leftover to current subscription
    const updatedLeft = (currentSub.left_lessons || 0) + prev_unused_lessons;

    // Update current subscription
    await currentSub.update({
      left_lessons: updatedLeft,
    });

    // Step 2: Set previous subscription leftover to 0
    await previousSub.update({
      left_lessons: prevLeft - prev_unused_lessons,
    });

    return res.status(200).json({
      success: true,
      message: "Previous unused lessons successfully moved to current subscription",
    //   data: {
    //     currentSubscription: {
    //       id: currentSub.id,
    //       new_left_lessons: updatedLeft,
    //     },
    //     previousSubscription: {
    //       id: previousSub.id,
    //       previous_left_lessons: prevLeft,
    //     },
    //   },
    data: {
        added: prev_unused_lessons,
        current_new_left: updatedLeft,
        previous_left_after_update: prevLeft - prev_unused_lessons,
      },
    });
  } catch (error) {
    console.error("Error updating unused lessons:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update unused lessons",
    });
  }
};

module.exports = {
    getStudents,
    getStudentKPI,
    getStudentDetails,
    updateStudent,
    updatePassword,
    inactivateStudent,
    inactivateSubscription,
    activateStudent,
    getStudentTeacherFeedback,
    getAttendanceStatistics,
    getProgressStatistics,
    getLessonOverview,
    addBonusLessons,
    expireBonusLessons,
    getBonusLessonHistory,
    addRegularLessons,
    updateRolloverSettings,
    getMonthlyLessonStats,
    rolloverLessons,
    clearUnusedLessons,
    getStudentPaymentHistory,
    downloadStudentInvoice,
    getStudentPaymentStats,
    getRefundDetails,
    getStudentGraphsAndTrends,
    returnLessons,
    exportLessonActivityCSV,
    getAllTeachers,
    addPrevUnusedLessons,
    cancelUserRecurringPayments
};
