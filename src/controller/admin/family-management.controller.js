// controller/admin/family-management.controller.js
const { Family, FamilyChild, FamilyCartItem, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const { Op, Sequelize, literal } = require('sequelize');
const moment = require('moment-timezone');
const { downloadFamilyInvoiceFromPayPlus } = require('../../services/familyPayplus.service');

/**
 * Get family management dashboard statistics
 */
async function getFamilyDashboardStats(req, res) {
    try {
        const { period = '30days' } = req.query;

        // Calculate date range
        const end = new Date();
        let start;
        switch (period) {
            case '7days':
                start = moment().subtract(7, 'days').toDate();
                break;
            case '30days':
                start = moment().subtract(30, 'days').toDate();
                break;
            case '90days':
                start = moment().subtract(90, 'days').toDate();
                break;
            case '6months':
            default:
                start = moment().subtract(6, 'months').toDate();
                break;
        }

        // Get total families count
        const totalFamilies = await Family.count();

        // Get active families count
        const activeFamilies = await Family.count({
            where: { status: 'active' }
        });

        // Get total children count
        const totalChildren = await FamilyChild.count();

        // Get active children with subscriptions
        const activeChildren = await FamilyChild.count({
            where: { status: 'active' }
        });

        // Calculate monthly revenue from active children subscriptions
        const monthlyRevenue = await FamilyChild.sum('monthly_amount', {
            where: { 
                status: 'active',
                monthly_amount: { [Op.ne]: null }
            }
        }) || 0;

        // Get total transactions count in period
        const totalTransactions = await FamilyPaymentTransaction.count({
            where: {
                created_at: { [Op.between]: [start, end] }
            }
        });

        // Get active subscriptions from UserSubscriptionDetails linked to family children
        const activeSubscriptions = await UserSubscriptionDetails.count({
            where: {
                status: 'active'
            },
            include: [{
                model: User,
                as: 'SubscriptionUser',
                required: true,
                where: {
                    guardian: { [Op.ne]: null }
                }
            }]
        });

        // Get enrolled classes count
        const enrolledClasses = await Class.count({
            where: {
                status: { [Op.in]: ['pending', 'scheduled', 'completed'] },
                meeting_start: { [Op.gte]: start }
            },
            include: [{
                model: User,
                as: 'Student',
                required: true,
                where: {
                    guardian: { [Op.ne]: null }
                }
            }]
        });

        // Get pending payments (families with pending status)
        const pendingPayments = await Family.count({
            where: { status: 'pending' }
        });

        // Get recent activity
        const recentActivity = await FamilyActivityLog.findAll({
            limit: 10,
            order: [['created_at', 'DESC']],
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name']
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'role_name']
                }
            ]
        });

        // Format activity data
        const formattedActivity = recentActivity.map(activity => ({
            id: activity.id,
            type: activity.action_type,
            title: getActivityTitle(activity.action_type),
            description: activity.action_description,
            timestamp: activity.created_at,
            status: 'success',
            performedBy: activity.user ? activity.user.full_name : 'System',
            familyName: activity.family ? activity.family.parent_name : null
        }));

        const stats = {
            totalFamilies,
            activeFamilies,
            totalChildren,
            monthlyRevenue: parseFloat(monthlyRevenue.toFixed(2)),
            totalTransactions,
            activeSubscriptions,
            enrolledClasses,
            pendingPayments,
            recentActivity: formattedActivity
        };

        return res.status(200).json({
            status: 'success',
            message: 'Family dashboard stats fetched successfully',
            data: stats
        });

    } catch (err) {
        console.error('Error fetching family dashboard stats:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family dashboard stats',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get all families with filtering, pagination, and search
 */
async function getAllFamilies(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions[Op.or] = [
                { parent_name: { [Op.like]: `%${search}%` } },
                { parent_email: { [Op.like]: `%${search}%` } },
                { parent_phone: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Get families with children count and total amount
        const { count, rows: families } = await Family.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: FamilyChild,
                    as: 'children',
                    attributes: []
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            attributes: {
                include: [
                    [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('children.id'))), 'totalChildrenCount'],
                    [Sequelize.fn('SUM', Sequelize.col('children.monthly_amount')), 'totalAmount']
                ]
            },
            group: ['Family.id', 'creator.id'],
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]],
            subQuery: false
        });

        // Format response
        const formattedFamilies = families.map(family => ({
            id: family.id,
            parent_name: family.parent_name,
            parent_email: family.parent_email,
            parent_phone: family.parent_phone,
            parent_country_code: family.parent_country_code,
            parent_address: family.parent_address,
            family_notes: family.family_notes,
            status: family.status,
            totalChildrenCount: family.dataValues.totalChildrenCount || 0,
            totalAmount: parseFloat(family.dataValues.totalAmount || 0).toFixed(2),
            salesPerson: family.creator ? family.creator.full_name : null,
            created_at: family.created_at,
            updated_at: family.updated_at
        }));

        return res.status(200).json({
            status: 'success',
            message: 'Families fetched successfully',
            data: {
                families: formattedFamilies,
                pagination: {
                    total: count.length,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count.length / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching families:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch families',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get family details by ID
 */
async function getFamilyDetails(req, res) {
    try {
        const { id } = req.params;

        const family = await Family.findByPk(id, {
            include: [
                {
                    model: FamilyChild,
                    as: 'children'
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: FamilyPaymentTransaction,
                    as: 'paymentTransactions',
                    limit: 5,
                    order: [['created_at', 'DESC']]
                }
            ]
        });

        if (!family) {
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Get payment history (similar to sales side)
        const paymentHistory = await FamilyPaymentTransaction.findAll({
            where: { family_id: id },
            order: [['created_at', 'DESC']],
            limit: 50
        });

        return res.status(200).json({
            status: 'success',
            message: 'Family details fetched successfully',
            data: { 
                family,
                paymentHistory
            }
        });

    } catch (err) {
        console.error('Error fetching family details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get all family transactions with filtering
 */
async function getFamilyTransactions(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            paymentType = 'all',
            startDate,
            endDate,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions[Op.or] = [
                { transaction_token: { [Op.like]: `%${search}%` } },
                { payplus_transaction_id: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Payment type filter
        if (paymentType && paymentType !== 'all') {
            whereConditions.payment_type = paymentType;
        }

        // Date range filter
        if (startDate && endDate) {
            whereConditions.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Get transactions
        const { count, rows: transactions } = await FamilyPaymentTransaction.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email']
                },
                {
                    model: FamilyPaymentLink,
                    as: 'paymentLink',
                    include: [{
                        model: User,
                        as: 'salesUser',
                        attributes: ['id', 'full_name', 'email']
                    }]
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]]
        });

        // Format transactions
        const formattedTransactions = transactions.map(txn => ({
            id: txn.id,
            transaction_token: txn.transaction_token,
            payplus_transaction_id: txn.payplus_transaction_id,
            family_id: txn.family_id,
            family_name: txn.family ? txn.family.parent_name : null,
            family_email: txn.family ? txn.family.parent_email : null,
            amount: parseFloat(txn.amount),
            currency: txn.currency,
            payment_type: txn.payment_type,
            status: txn.status,
            payment_method: txn.payment_method,
            card_last_digits: txn.card_last_digits,
            salesPerson: txn.paymentLink?.salesUser?.full_name || null,
            processed_at: txn.processed_at,
            created_at: txn.created_at,
            paid_children_count: Array.isArray(txn.paid_children_ids) ? txn.paid_children_ids.length : 0
        }));

        // Calculate summary statistics
        const totalAmount = transactions.reduce((sum, txn) => sum + parseFloat(txn.amount), 0);
        const completedTransactions = transactions.filter(txn => txn.status === 'success').length;
        const pendingAmount = transactions
            .filter(txn => txn.status === 'pending')
            .reduce((sum, txn) => sum + parseFloat(txn.amount), 0);

        return res.status(200).json({
            status: 'success',
            message: 'Family transactions fetched successfully',
            data: {
                transactions: formattedTransactions,
                summary: {
                    totalAmount: parseFloat(totalAmount.toFixed(2)),
                    completedTransactions,
                    pendingAmount: parseFloat(pendingAmount.toFixed(2))
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching family transactions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family transactions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get family activity history/log
 */
async function getFamilyHistory(req, res) {
    try {
        const {
            page = 1,
            limit = 15,
            search = '',
            actionType = 'all',
            familyId,
            startDate,
            endDate,
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions.action_description = { [Op.like]: `%${search}%` };
        }

        // Action type filter
        if (actionType && actionType !== 'all') {
            whereConditions.action_type = actionType;
        }

        // Family filter
        if (familyId) {
            whereConditions.family_id = familyId;
        }

        // Date range filter
        if (startDate && endDate) {
            whereConditions.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Get activity logs
        const { count, rows: activities } = await FamilyActivityLog.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name'],
                    required: false
                },
                {
                    model: FamilyChild,
                    as: 'child',
                    attributes: ['id', 'child_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'role_name']
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', sortOrder]]
        });

        // Format activities
        const formattedActivities = activities.map(activity => ({
            id: activity.id,
            family_id: activity.family_id,
            family_name: activity.family ? activity.family.parent_name : null,
            child_id: activity.child_id,
            child_name: activity.child ? activity.child.child_name : null,
            action_type: activity.action_type,
            title: getActivityTitle(activity.action_type),
            description: activity.action_description,
            performed_by: activity.user ? activity.user.full_name : 'System',
            performed_by_role: activity.user ? activity.user.role_name : null,
            metadata: activity.metadata,
            created_at: activity.created_at
        }));

        // Calculate period statistics
        const todayCount = activities.filter(a => 
            moment(a.created_at).isSame(moment(), 'day')
        ).length;

        const weekCount = activities.filter(a => 
            moment(a.created_at).isAfter(moment().subtract(7, 'days'))
        ).length;

        const monthCount = activities.filter(a => 
            moment(a.created_at).isAfter(moment().subtract(30, 'days'))
        ).length;

        return res.status(200).json({
            status: 'success',
            message: 'Family history fetched successfully',
            data: {
                activities: formattedActivities,
                statistics: {
                    today: todayCount,
                    thisWeek: weekCount,
                    thisMonth: monthCount
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching family history:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family history',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get child subscriptions across all families
 */
async function getChildSubscriptions(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            subscriptionType = 'all',
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions for children
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions[Op.or] = [
                { child_name: { [Op.like]: `%${search}%` } },
                { child_email: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Subscription type filter
        if (subscriptionType && subscriptionType !== 'all') {
            whereConditions.subscription_type = subscriptionType;
        }

        // Get children with subscriptions
        const { count, rows: children } = await FamilyChild.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email', 'status']
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]]
        });

        // Format subscriptions
        const formattedSubscriptions = children.map(child => ({
            id: child.id,
            child_name: child.child_name,
            child_age: child.child_age,
            child_email: child.child_email,
            family_id: child.family_id,
            family_name: child.family ? child.family.parent_name : null,
            family_email: child.family ? child.family.parent_email : null,
            subscription_type: child.subscription_type,
            monthly_amount: parseFloat(child.monthly_amount || 0),
            custom_amount: parseFloat(child.custom_amount || 0),
            status: child.status,
            payplus_subscription_id: child.payplus_subscription_id,
            subscription_start_date: child.subscription_start_date,
            next_payment_date: child.next_payment_date,
            last_payment_date: child.last_payment_date,
            auto_renew: !!child.payplus_subscription_id,
            created_at: child.created_at
        }));

        // Calculate summary statistics
        const activeCount = children.filter(c => c.status === 'active').length;
        const totalRevenue = children
            .filter(c => c.status === 'active')
            .reduce((sum, c) => sum + parseFloat(c.monthly_amount || 0), 0);

        // Calculate expiring soon (within 30 days)
        const expiringSoon = children.filter(c => {
            if (!c.next_payment_date || c.status !== 'active') return false;
            const daysDiff = moment(c.next_payment_date).diff(moment(), 'days');
            return daysDiff >= 0 && daysDiff <= 30;
        }).length;

        return res.status(200).json({
            status: 'success',
            message: 'Child subscriptions fetched successfully',
            data: {
                subscriptions: formattedSubscriptions,
                summary: {
                    total: count,
                    active: activeCount,
                    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                    expiringSoon
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching child subscriptions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch child subscriptions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get child classes/enrollments
 */
async function getChildClasses(req, res) {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      startDate = '',
      endDate = '',
      sortBy = 'meeting_start',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const whereClause = {};
    
    if (status) {
      whereClause.status = status;
    }

    if (startDate && endDate) {
      whereClause.meeting_start = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    // FIXED: Explicitly specify only database columns to avoid methods/virtuals
    const classAttributes = [
      'id',
      'student_id',
      'teacher_id',
      'meeting_start',
      'meeting_end',
      'status',
      'is_trial',
      'is_present',
      'bonus_class',
      'class_type',
      'created_at',
      'updated_at'
    ];

    // Search in related models
    const includeClause = [
      {
        model: User,
        as: 'Student',
        attributes: ['id', 'full_name', 'email'],  // FIXED: Changed 'name' to 'full_name'
        where: search ? {
          full_name: { [Op.like]: `%${search}%` }  // FIXED: Changed 'name' to 'full_name'
        } : undefined,
        required: search ? true : false
      }
    ];

    // Get classes with pagination
    const { count, rows: classes } = await Class.findAndCountAll({
      attributes: classAttributes,
      where: whereClause,
      include: includeClause,
      limit: parseInt(limit),
      offset: offset,
      order: [[sortBy, sortOrder]],
      distinct: true
    });

    // Format response
    const formattedClasses = classes.map(cls => {
      const classData = cls.toJSON();
      
      return {
        id: classData.id,
        student_id: classData.student_id,
        student_name: classData.Student?.full_name || null,  // FIXED: Changed to full_name
        student_email: classData.Student?.email || null,
        teacher_id: classData.teacher_id,
        teacher_name: null,
        teacher_subject: null,
        meeting_start: classData.meeting_start,
        meeting_end: classData.meeting_end,
        status: classData.status,
        is_trial: classData.is_trial || false,
        is_present: classData.is_present || false,
        bonus_class: classData.bonus_class || false,
        class_type: classData.class_type || 'regular',
        totalSessions: 0,
        completedSessions: 0,
        progress: 0,
        attendance: 0,
        created_at: classData.created_at
      };
    });

    // Calculate summary statistics
    const totalClasses = count;
    const activeClasses = await Class.count({
      where: { status: 'ongoing' }
    });
    const completedClasses = await Class.count({
      where: { status: 'completed' }
    });

    // Calculate average progress
    const averageProgress = totalClasses > 0 
      ? (completedClasses / totalClasses) * 100 
      : 0;

    const summary = {
      total: totalClasses,
      active: activeClasses,
      completed: completedClasses,
      averageProgress: Math.round(averageProgress * 10) / 10
    };

    return res.status(200).json({
      status: 'success',
      message: 'Child classes fetched successfully',
      data: {
        classes: formattedClasses,
        summary,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error fetching child classes:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch child classes',
      error: error.message
    });
  }
}
/**
 * Helper function to get activity title from action type
 */
function getActivityTitle(actionType) {
    const titles = {
        'family_created': 'Family Created',
        'child_added': 'Child Added',
        'child_removed': 'Child Removed',
        'child_status_changed': 'Child Status Changed',
        'child_subscription_updated': 'Subscription Updated',
        'payment_generated': 'Payment Link Generated',
        'payment_completed': 'Payment Completed',
        'subscription_modified': 'Subscription Modified',
        'cart_updated': 'Cart Updated',
        'cart_subscription_configured': 'Subscription Configured'
    };
    return titles[actionType] || actionType;
}

/**
 * Download invoice for a family payment transaction
 * Uses the same service as sales side
 */
async function downloadFamilyInvoice(req, res) {
    try {
        const { id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query;

        // Find the family payment transaction
        const familyPayment = await FamilyPaymentTransaction.findByPk(id);

        if (!familyPayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        // Priority: payplus_transaction_id > transaction_token
        // Also try to extract from payplus_response_data if needed
        let transaction_uid = familyPayment.payplus_transaction_id || familyPayment.transaction_token;

        // If still not found, try to extract from payplus_response_data
        if ((!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') && familyPayment.payplus_response_data) {
            try {
                const responseData = typeof familyPayment.payplus_response_data === 'string' 
                    ? JSON.parse(familyPayment.payplus_response_data) 
                    : familyPayment.payplus_response_data;
                
                // Handle double-encoded JSON strings
                const parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                
                if (parsedData.transaction_uid) {
                    transaction_uid = parsedData.transaction_uid;
                }
            } catch (parseError) {
                console.error(`[downloadFamilyInvoice] Error parsing payplus_response_data:`, parseError);
            }
        }

        if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for this family payment',
                details: {
                    payment_id: id,
                    payplus_transaction_id: familyPayment.payplus_transaction_id,
                    transaction_token: familyPayment.transaction_token
                }
            });
        }

        // Delegate PayPlus API calls + streaming to the dedicated service
        await downloadFamilyInvoiceFromPayPlus({
            transaction_uid,
            type,
            format,
            paymentId: id,
            res,
            payplusResponseData: familyPayment.payplus_response_data
        });
    } catch (error) {
        console.error(`[downloadFamilyInvoice] Unexpected error downloading family invoice for payment ${req.params.id}:`, error);

        if (!res.headersSent) {
            return res.status(500).json({
                status: 'error',
                message: 'Error downloading family invoice',
                details: error.message
            });
        }
    }
}

module.exports = {
    getFamilyDashboardStats,
    getAllFamilies,
    getFamilyDetails,
    getFamilyTransactions,
    getFamilyHistory,
    getChildSubscriptions,
    getChildClasses,
    downloadFamilyInvoice
};