// controller/sales/family.controller.js - Complete Implementation
const { Family, FamilyChild, FamilyCartItem, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const { sequelize } = require('../../connection/connection');
const { Op, fn, col, literal } = require('sequelize');


// PayPlus API Configuration
const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || ''
};

// Standard subscription pricing
const SUBSCRIPTION_PRICES = {
    monthly: 90,
    quarterly: 250,
    yearly: 900
};

// Valid relationship types
const VALID_RELATIONSHIPS = [
    'son', 'daughter', 'stepson', 'stepdaughter', 
    'nephew', 'niece', 'grandson', 'granddaughter', 'other'
];

// Helper function to log family activity
const logFamilyActivity = async (activityData, transaction = null) => {
    try {
        await FamilyActivityLog.create(activityData, { transaction });
    } catch (error) {
        console.error('Error logging family activity:', error);
    }
};

// Helper function to calculate monthly equivalent amount
const getMonthlyEquivalent = (amount, subscriptionType) => {
    switch (subscriptionType) {
        case 'quarterly': return amount / 3;
        case 'yearly': return amount / 12;
        default: return amount;
    }
};

/**
 * Get family statistics for dashboard - FIXED VERSION
 */
const getFamilyStats = async (req, res) => {
    try {
        const salesUserId = req.user.id;

        // Get total families count
        const totalFamilies = await Family.count({
            where: req.user.role_name === 'sales_role' ? {} : { created_by: salesUserId }
        });

        // Get active families count
        const activeFamilies = await Family.count({
            where: {
                status: 'active',
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            }
        });

        // Get total children count
        const totalChildren = await FamilyChild.count({
            include: [{
                model: Family,
                as: 'family',
                where: req.user.role_name === 'sales_role' ? {} : { created_by: salesUserId }
            }]
        });

        // Calculate monthly revenue from active children - SIMPLIFIED APPROACH
        const activeChildren = await FamilyChild.findAll({
            where: {
                status: 'active',
                monthly_amount: { [Op.ne]: null }
            },
            include: [{
                model: Family,
                as: 'family',
                where: {
                    status: 'active',
                    ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
                }
            }],
            attributes: ['monthly_amount']
        });

        // Calculate total manually
        const monthlyRevenue = activeChildren.reduce((sum, child) => {
            return sum + (parseFloat(child.monthly_amount) || 0);
        }, 0);

        // Get cart items count
        const cartItems = await FamilyCartItem.count({
            where: { sales_user_id: salesUserId }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                totalFamilies,
                activeFamilies,
                totalChildren,
                monthlyRevenue,
                cartItems
            },
            message: 'Family statistics retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Corrected getFamilyList with proper subscription data mapping
 */
const getFamilyList = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            salesperson
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const salesUserId = req.user.id;

        // Build where conditions
        const whereConditions = {};
        
        if (search) {
            whereConditions[Op.or] = [
                { parent_name: { [Op.like]: `%${search}%` } },
                { parent_email: { [Op.like]: `%${search}%` } },
                { parent_phone: { [Op.like]: `%${search}%` } }
            ];
        }

        if (status !== 'all') {
            whereConditions.status = status;
        }

        if (salesperson) {
            whereConditions.created_by = salesperson;
        } else if (req.user.role_name !== 'sales_role') {
            whereConditions.created_by = salesUserId;
        }

        // Get families with related data
        const { count, rows: families } = await Family.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: FamilyChild,
                    as: 'children',
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                },
                {
                    model: FamilyPaymentTransaction,
                    as: 'paymentTransactions',
                    required: false,
                    attributes: [
                        'id', 'transaction_token', 'payplus_transaction_id',
                        'student_ids', 'subscription_ids', 'paid_children_ids',
                        'paid_children_details', 'amount', 'currency', 
                        'payment_type', 'status', 'processed_at', 'created_at'
                    ]
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset,
            distinct: true
        });

        // Process families with enhanced subscription information
        const familiesWithSubscriptionData = await Promise.all(families.map(async (family) => {
            const activeChildren = family.children.filter(child => child.status === 'active');
            const totalAmount = activeChildren.reduce((sum, child) => {
                return sum + (parseFloat(child.monthly_amount) || 0);
            }, 0);

            // Enhanced children processing with subscription status
            const enhancedChildren = await Promise.all(
                family.children.map(async (child) => {
                    const childData = child.toJSON();
                    
                    // Initialize subscription data
                    childData.current_subscription = null;
                    childData.has_active_subscription = false;
                    childData.subscription_history = [];

                    try {
                        // Find user record for this child
                        let matchingUser = null;
                        
                        if (child.child_email) {
                            matchingUser = await User.findOne({
                                where: { email: child.child_email }
                            });
                        }
                        
                        // Fallback: find by transaction history
                        if (!matchingUser) {
                            const familyTransactions = await FamilyPaymentTransaction.findAll({
                                where: { 
                                    family_id: family.id,
                                    paid_children_ids: {
                                        [Op.like]: `%"${child.id}"%`
                                    },
                                    status: 'success'
                                }
                            });
                            
                            for (const transaction of familyTransactions) {
                                if (transaction.student_ids && Array.isArray(transaction.student_ids)) {
                                    const users = await User.findAll({
                                        where: { 
                                            id: { [Op.in]: transaction.student_ids },
                                            full_name: { [Op.like]: `%${child.child_name}%` }
                                        }
                                    });
                                    
                                    if (users.length > 0) {
                                        matchingUser = users[0];
                                        break;
                                    }
                                }
                            }
                        }

                        if (matchingUser) {
                            // Get current active subscription
                            const currentSubscription = await UserSubscriptionDetails.findOne({
                                where: { 
                                    user_id: matchingUser.id,
                                    status: 'active'
                                },
                                order: [['created_at', 'DESC']]
                            });

                            if (currentSubscription) {
                                childData.current_subscription = {
                                    id: currentSubscription.id,
                                    type: currentSubscription.type,
                                    status: currentSubscription.status,
                                    payment_status: currentSubscription.payment_status,
                                    left_lessons: currentSubscription.left_lessons,
                                    cost_per_lesson: currentSubscription.cost_per_lesson,
                                    renew_date: currentSubscription.renew_date,
                                    created_at: currentSubscription.created_at,
                                    weekly_lesson: currentSubscription.weekly_lesson,
                                    lesson_min: currentSubscription.lesson_min,
                                    balance: currentSubscription.balance
                                };
                                childData.has_active_subscription = true;
                            }

                            // Get subscription history (last 3)
                            const subscriptionHistory = await UserSubscriptionDetails.findAll({
                                where: { user_id: matchingUser.id },
                                order: [['created_at', 'DESC']],
                                limit: 3
                            });

                            childData.subscription_history = subscriptionHistory.map(sub => ({
                                id: sub.id,
                                type: sub.type,
                                status: sub.status,
                                payment_status: sub.payment_status,
                                created_at: sub.created_at,
                                renew_date: sub.renew_date,
                                left_lessons: sub.left_lessons
                            }));
                        }

                    } catch (error) {
                        console.error(`Error fetching subscription data for child ${child.id}:`, error);
                        // Continue without subscription data rather than failing
                    }

                    return childData;
                })
            );

            return {
                ...family.toJSON(),
                children: enhancedChildren,
                totalAmount,
                activeChildrenCount: activeChildren.length,
                totalChildrenCount: family.children.length,
                activeSubscribersCount: enhancedChildren.filter(child => child.has_active_subscription).length,
                paymentTransactions: family.paymentTransactions // Keep existing transaction data
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                families: familiesWithSubscriptionData,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(count / parseInt(limit)),
                    totalCount: count,
                    limit: parseInt(limit)
                }
            },
            message: 'Families retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting families:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get family by ID with full details
 */
const getFamilyById = async (req, res) => {
    try {
        const { id } = req.params;
        const salesUserId = req.user.id;

        const family = await Family.findOne({
            where: {
                id,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            },
            include: [
                {
                    model: FamilyChild,
                    as: 'children',
                    required: false
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email'],
                    required: false
                }
            ]
        });

        if (!family) {
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Process children with subscription information (same logic as above)
        const enhancedChildren = await Promise.all(
            family.children.map(async (child) => {
                const childData = child.toJSON();
                
                childData.current_subscription = null;
                childData.has_active_subscription = false;
                childData.subscription_history = [];

                try {
                    let matchingUser = null;
                    
                    if (child.child_email) {
                        matchingUser = await User.findOne({
                            where: { email: child.child_email }
                        });
                    }
                    
                    if (!matchingUser) {
                        const familyTransactions = await FamilyPaymentTransaction.findAll({
                            where: { 
                                family_id: family.id,
                                paid_children_ids: {
                                    [Op.like]: `%"${child.id}"%` // MySQL-safe JSON array search
                                },
                                status: 'success'
                            }
                        });
                        
                        for (const transaction of familyTransactions) {
                            if (transaction.student_ids && Array.isArray(transaction.student_ids)) {
                                const users = await User.findAll({
                                    where: { 
                                        id: { [Op.in]: transaction.student_ids },
                                        full_name: { [Op.like]: `%${child.child_name}%` }
                                    }
                                });
                                
                                if (users.length > 0) {
                                    matchingUser = users[0];
                                    break;
                                }
                            }
                        }
                    }

                    if (matchingUser) {
                        const currentSubscription = await UserSubscriptionDetails.findOne({
                            where: { 
                                user_id: matchingUser.id,
                                status: 'active'
                            },
                            order: [['created_at', 'DESC']]
                        });

                        if (currentSubscription) {
                            childData.current_subscription = {
                                id: currentSubscription.id,
                                type: currentSubscription.type,
                                status: currentSubscription.status,
                                payment_status: currentSubscription.payment_status,
                                left_lessons: currentSubscription.left_lessons,
                                cost_per_lesson: currentSubscription.cost_per_lesson,
                                renew_date: currentSubscription.renew_date,
                                created_at: currentSubscription.created_at,
                                weekly_lesson: currentSubscription.weekly_lesson,
                                lesson_min: currentSubscription.lesson_min,
                                balance: currentSubscription.balance
                            };
                            childData.has_active_subscription = true;
                        }

                        const subscriptionHistory = await UserSubscriptionDetails.findAll({
                            where: { user_id: matchingUser.id },
                            order: [['created_at', 'DESC']],
                            limit: 5
                        });

                        childData.subscription_history = subscriptionHistory.map(sub => ({
                            id: sub.id,
                            type: sub.type,
                            status: sub.status,
                            payment_status: sub.payment_status,
                            created_at: sub.created_at,
                            renew_date: sub.renew_date,
                            left_lessons: sub.left_lessons
                        }));
                    }

                } catch (error) {
                    console.error(`Error fetching subscription data for child ${child.id}:`, error);
                }

                return childData;
            })
        );

        // Get payment history
        const paymentHistory = await FamilyPaymentTransaction.findAll({
            where: { family_id: id },
            order: [['created_at', 'DESC']],
            limit: 10
        });

        // Calculate family totals
        const activeChildren = enhancedChildren.filter(child => child.status === 'active');
        const totalAmount = activeChildren.reduce((sum, child) => {
            return sum + (parseFloat(child.monthly_amount) || 0);
        }, 0);

        return res.status(200).json({
            status: 'success',
            data: {
                family: {
                    ...family.toJSON(),
                    children: enhancedChildren,
                    totalAmount,
                    activeChildrenCount: activeChildren.length,
                    totalChildrenCount: enhancedChildren.length,
                    activeSubscribersCount: enhancedChildren.filter(child => child.has_active_subscription).length
                },
                paymentHistory
            },
            message: 'Family details retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family by ID:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create new family with children (without subscription types)
 */
const createFamily = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const {
            parentName,
            parentEmail,
            parentPhone,
            parentCountryCode,
            parentAddress,
            familyNotes,
            children
        } = req.body;

        // Validate required fields
        if (!parentName || !parentEmail || !children || children.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Parent name, email, and at least one child are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(parentEmail)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid parent email format'
            });
        }

        // Check if family with this email already exists
        const existingFamily = await Family.findOne({
            where: { parent_email: parentEmail },
            transaction
        });

        if (existingFamily) {
            if (transaction) await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Family with this email already exists'
            });
        }

        // Validate children data
        for (const [index, child] of children.entries()) {
            if (!child.name || !child.age || !child.relationshipToParent) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Child ${index + 1}: name, age, and relationship to parent are required`
                });
            }

            if (isNaN(parseInt(child.age)) || parseInt(child.age) < 5 || parseInt(child.age) > 100) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Child ${index + 1}: age must be between 5 and 100`
                });
            }

            if (!VALID_RELATIONSHIPS.includes(child.relationshipToParent)) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Child ${index + 1}: invalid relationship type`
                });
            }

            // Validate child email if provided
            if (child.email && !emailRegex.test(child.email)) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Child ${index + 1}: invalid email format`
                });
            }
        }

        // Create family
        const family = await Family.create({
            parent_name: parentName,
            parent_email: parentEmail,
            parent_phone: parentPhone,
            parent_country_code: parentCountryCode,
            parent_address: parentAddress,
            family_notes: familyNotes,
            status: 'pending',
            created_by: req.user.id
        }, { transaction });

        // Create children (with optional email)
        const createdChildren = [];
        for (const childData of children) {
            const child = await FamilyChild.create({
                family_id: family.id,
                child_name: childData.name,
                child_age: parseInt(childData.age),
                relationship_to_parent: childData.relationshipToParent,
                child_email: childData.email || null,  // Add this line
                child_notes: childData.notes || null,
                status: 'pending'
            }, { transaction });
            createdChildren.push(child);
        }

        // Log activity
        await logFamilyActivity({
            family_id: family.id,
            user_id: req.user.id,
            action_type: 'family_created',
            action_description: `Family created by ${req.user.full_name} with ${children.length} children`,
            new_values: {
                family_id: family.id,
                parent_name: parentName,
                children_count: children.length,
                children_details: children.map(c => ({
                    name: c.name,
                    age: c.age,
                    relationship: c.relationshipToParent,
                    email: c.email || null  // Add this line
                }))
            },
            metadata: {
                created_by_role: req.user.role_name,
                ip_address: req.ip,
                note: 'Subscription types to be set during payment generation'
            }
        }, transaction);

        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            data: {
                family: {
                    ...family.toJSON(),
                    children: createdChildren
                }
            },
            message: 'Family created successfully. Subscription types will be set during payment generation.'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error creating family:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update family
 */
const updateFamily = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { id } = req.params;
        const salesUserId = req.user.id;

        const {
            parentName,
            parentEmail,
            parentPhone,
            parentCountryCode,
            parentAddress,
            familyNotes
        } = req.body;

        // Check if family exists and user has permission
        const family = await Family.findOne({
            where: {
                id,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            },
            transaction
        });

        if (!family) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Store old values for activity log
        const oldValues = {
            parent_name: family.parent_name,
            parent_email: family.parent_email,
            parent_phone: family.parent_phone,
            parent_address: family.parent_address,
            family_notes: family.family_notes
        };

        // Update family
        await family.update({
            parent_name: parentName || family.parent_name,
            parent_email: parentEmail || family.parent_email,
            parent_phone: parentPhone || family.parent_phone,
            parent_country_code: parentCountryCode || family.parent_country_code,
            parent_address: parentAddress || family.parent_address,
            family_notes: familyNotes
        }, { transaction });

        // Log activity
        await logFamilyActivity({
            family_id: id,
            user_id: req.user.id,
            action_type: 'family_updated',
            action_description: `Family updated by ${req.user.full_name}`,
            old_values: oldValues,
            new_values: {
                parent_name: family.parent_name,
                parent_email: family.parent_email,
                parent_phone: family.parent_phone,
                parent_address: family.parent_address,
                family_notes: family.family_notes
            },
            metadata: {
                updated_by_role: req.user.role_name
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { family },
            message: 'Family updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating family:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete family
 */
const deleteFamily = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { id } = req.params;
        const salesUserId = req.user.id;

        // Check if family exists and user has permission
        const family = await Family.findOne({
            where: {
                id,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            },
            include: [{
                model: FamilyChild,
                as: 'children'
            }],
            transaction
        });

        if (!family) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Check if family has active subscriptions
        const activeChildren = family.children.filter(child => child.status === 'active');
        if (activeChildren.length > 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete family with active subscriptions. Please cancel all subscriptions first.'
            });
        }

        // Log activity before deletion
        await logFamilyActivity({
            family_id: id,
            user_id: req.user.id,
            action_type: 'family_deleted',
            action_description: `Family deleted by ${req.user.full_name}`,
            old_values: {
                parent_name: family.parent_name,
                parent_email: family.parent_email,
                children_count: family.children.length
            },
            metadata: {
                deleted_by_role: req.user.role_name,
                deletion_reason: 'Manual deletion'
            }
        }, transaction);

        // Delete family (will cascade to children)
        await family.destroy({ transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Family deleted successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error deleting family:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update family status
 */
const updateFamilyStatus = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { id } = req.params;
        const { status } = req.body;
        const salesUserId = req.user.id;

        // Validate status
        const validStatuses = ['active', 'pending', 'suspended', 'cancelled'];
        if (!validStatuses.includes(status)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        // Find family
        const family = await Family.findOne({
            where: {
                id,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            },
            transaction
        });

        if (!family) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        const oldStatus = family.status;

        // Update family status
        await family.update({ status }, { transaction });

        // Log activity
        await logFamilyActivity({
            family_id: id,
            user_id: req.user.id,
            action_type: 'family_status_changed',
            action_description: `Family status changed from ${oldStatus} to ${status} by ${req.user.full_name}`,
            old_values: { status: oldStatus },
            new_values: { status },
            metadata: {
                changed_by_role: req.user.role_name
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { family },
            message: 'Family status updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating family status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Add child to family
 */

const addChildToFamily = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId } = req.params;
        const salesUserId = req.user.id;

        // FIXED: Accept both field name formats for backward compatibility
        const {
            childName,
            childAge,
            relationshipToParent,
            childEmail,
            childNotes,
            // New format (what frontend is actually sending)
            name,
            age,
            email,
            notes
        } = req.body;

        // Use new format if available, fall back to old format
        const finalChildName = name || childName;
        const finalChildAge = age || childAge;
        const finalChildEmail = email || childEmail;
        const finalChildNotes = notes || childNotes;

        // Validate required fields
        if (!finalChildName || !finalChildAge || !relationshipToParent) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Child name, age, and relationship to parent are required'
            });
        }

        // Validate age
        if (isNaN(parseInt(finalChildAge)) || parseInt(finalChildAge) < 5 || parseInt(finalChildAge) > 100) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Child age must be between 5 and 100'
            });
        }

        // Validate relationship
        if (!VALID_RELATIONSHIPS.includes(relationshipToParent)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid relationship type'
            });
        }

        // Validate child email if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (finalChildEmail && !emailRegex.test(finalChildEmail)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid child email format'
            });
        }

        // Check if family exists
        const family = await Family.findOne({
            where: {
                id: familyId,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            },
            transaction
        });

        if (!family) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Create child
        const child = await FamilyChild.create({
            family_id: familyId,
            child_name: finalChildName,
            child_age: parseInt(finalChildAge),
            relationship_to_parent: relationshipToParent,
            child_email: finalChildEmail || null,
            child_notes: finalChildNotes,
            status: 'pending'
        }, { transaction });

        // Log activity
        await logFamilyActivity({
            family_id: familyId,
            child_id: child.id,
            user_id: req.user.id,
            action_type: 'child_added',
            action_description: `Child ${finalChildName} added to family by ${req.user.full_name}`,
            new_values: {
                child_id: child.id,
                child_name: finalChildName,
                child_age: finalChildAge,
                relationship_to_parent: relationshipToParent,
                child_email: finalChildEmail || null
            },
            metadata: {
                added_by_role: req.user.role_name
            }
        }, transaction);

        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            data: { child },
            message: 'Child added to family successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error adding child to family:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update child
 */
const updateChild = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId, childId } = req.params;
        const salesUserId = req.user.id;

        const {
            childName,
            childAge,
            relationshipToParent,
            childEmail,  // Add this line
            subscriptionType,
            customAmount,
            childNotes
        } = req.body;

        // Find child
        const child = await FamilyChild.findOne({
            where: { id: childId, family_id: familyId },
            include: [{
                model: Family,
                as: 'family',
                where: req.user.role_name === 'sales_role' ? {} : { created_by: salesUserId }
            }],
            transaction
        });

        if (!child) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Child not found'
            });
        }

        // Store old values
        const oldValues = {
            child_name: child.child_name,
            child_age: child.child_age,
            relationship_to_parent: child.relationship_to_parent,
            child_email: child.child_email,  // Add this line
            subscription_type: child.subscription_type,
            monthly_amount: child.monthly_amount,
            custom_amount: child.custom_amount,
            child_notes: child.child_notes
        };

        // Validate new values if provided
        if (childAge && (isNaN(parseInt(childAge)) || parseInt(childAge) < 5 || parseInt(childAge) > 100)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Child age must be between 5 and 100'
            });
        }

        if (relationshipToParent && !VALID_RELATIONSHIPS.includes(relationshipToParent)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid relationship type'
            });
        }

        // Validate child email if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (childEmail && !emailRegex.test(childEmail)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid child email format'
            });
        }

        if (subscriptionType && !['monthly', 'quarterly', 'yearly'].includes(subscriptionType)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid subscription type'
            });
        }

        // Calculate amount if subscription type is provided
        let monthlyAmount = child.monthly_amount;
        if (subscriptionType) {
            monthlyAmount = customAmount ? parseFloat(customAmount) : SUBSCRIPTION_PRICES[subscriptionType];
        }
        
        // Update child
        await child.update({
            child_name: childName || child.child_name,
            child_age: childAge ? parseInt(childAge) : child.child_age,
            relationship_to_parent: relationshipToParent || child.relationship_to_parent,
            child_email: childEmail !== undefined ? (childEmail || null) : child.child_email,  // Add this line
            subscription_type: subscriptionType || child.subscription_type,
            monthly_amount: monthlyAmount,
            custom_amount: customAmount ? parseFloat(customAmount) : child.custom_amount,
            child_notes: childNotes !== undefined ? childNotes : child.child_notes
        }, { transaction });

        // Log activity
        await logFamilyActivity({
            family_id: familyId,
            child_id: childId,
            user_id: req.user.id,
            action_type: 'child_updated',
            action_description: `Child ${child.child_name} updated by ${req.user.full_name}`,
            old_values: oldValues,
            new_values: {
                child_name: child.child_name,
                child_age: child.child_age,
                relationship_to_parent: child.relationship_to_parent,
                child_email: child.child_email,  // Add this line
                subscription_type: child.subscription_type,
                monthly_amount: child.monthly_amount,
                custom_amount: child.custom_amount
            },
            metadata: {
                updated_by_role: req.user.role_name
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { child },
            message: 'Child updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating child:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update child status
 */
const updateChildStatus = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId, childId } = req.params;
        const { status } = req.body;
        const salesUserId = req.user.id;

        // Validate status
        const validStatuses = ['active', 'paused', 'cancelled', 'pending'];
        if (!validStatuses.includes(status)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        // Find child
        const child = await FamilyChild.findOne({
            where: { id: childId, family_id: familyId },
            include: [{
                model: Family,
                as: 'family',
                where: req.user.role_name === 'sales_role' ? {} : { created_by: salesUserId }
            }],
            transaction
        });

        if (!child) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Child not found'
            });
        }

        const oldStatus = child.status;

        // Update child status
        await child.update({ status }, { transaction });

        // Log activity
        await logFamilyActivity({
            family_id: familyId,
            child_id: childId,
            user_id: req.user.id,
            action_type: 'child_status_changed',
            action_description: `Child ${child.child_name} status changed from ${oldStatus} to ${status} by ${req.user.full_name}`,
            old_values: { status: oldStatus },
            new_values: { status },
            metadata: {
                changed_by_role: req.user.role_name
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { child },
            message: 'Child status updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating child status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Remove child
 */
const removeChild = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId, childId } = req.params;
        const salesUserId = req.user.id;

        // Find child
        const child = await FamilyChild.findOne({
            where: { id: childId, family_id: familyId },
            include: [{
                model: Family,
                as: 'family',
                where: req.user.role_name === 'sales_role' ? {} : { created_by: salesUserId }
            }],
            transaction
        });

        if (!child) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Child not found'
            });
        }

        // Check if child has active subscription
        if (child.status === 'active') {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot remove child with active subscription. Please cancel subscription first.'
            });
        }

        // Log activity before deletion
        await logFamilyActivity({
            family_id: familyId,
            child_id: childId,
            user_id: req.user.id,
            action_type: 'child_removed',
            action_description: `Child ${child.child_name} removed from family by ${req.user.full_name}`,
            old_values: {
                child_name: child.child_name,
                child_age: child.child_age,
                relationship_to_parent: child.relationship_to_parent,
                status: child.status
            },
            metadata: {
                removed_by_role: req.user.role_name
            }
        }, transaction);

        // Remove child
        await child.destroy({ transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Child removed successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error removing child:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get cart items for current sales user
 */
const getCartItems = async (req, res) => {
    try {
        const salesUserId = req.user.id;

        const cartItems = await FamilyCartItem.findAll({
            where: { sales_user_id: salesUserId },
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code']
                },
                {
                    model: FamilyChild,
                    as: 'child',
                    attributes: ['id', 'child_name', 'child_age', 'relationship_to_parent', 'status']
                }
            ],
            order: [['added_at', 'DESC']]
        });

        // Group by family
        const familiesMap = new Map();
        
        cartItems.forEach(item => {
            const familyId = item.family.id;
            if (!familiesMap.has(familyId)) {
                familiesMap.set(familyId, {
                    id: item.family.id,
                    parentName: item.family.parent_name,
                    parentEmail: item.family.parent_email,
                    parentPhone: item.family.parent_phone,
                    parentCountryCode: item.family.parent_country_code,
                    children: [],
                    hasSelectedChildren: false
                });
            }

            const family = familiesMap.get(familyId);
            const amount = item.cart_custom_amount || 
                         (item.cart_subscription_type ? SUBSCRIPTION_PRICES[item.cart_subscription_type] : null);
            
            family.children.push({
                id: item.child.id,
                name: item.child.child_name,
                age: item.child.child_age,
                relationshipToParent: item.child.relationship_to_parent,
                status: item.child.status,
                selected: item.selected,
                subscriptionType: item.cart_subscription_type,
                customAmount: item.cart_custom_amount,
                amount: amount,
                hasSubscriptionConfigured: !!item.cart_subscription_type,
                familyId: familyId,
                familyName: item.family.parent_name,
                parentName: item.family.parent_name,
                parentEmail: item.family.parent_email
            });

            if (item.selected) {
                family.hasSelectedChildren = true;
            }
        });

        const cartFamilies = Array.from(familiesMap.values());

        return res.status(200).json({
            status: 'success',
            data: {
                cartFamilies,
                totalFamilies: cartFamilies.length,
                totalChildren: cartItems.length,
                selectedChildren: cartItems.filter(item => item.selected).length,
                configuredChildren: cartItems.filter(item => item.cart_subscription_type).length
            },
            message: 'Cart items retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting cart items:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Add family to cart (all children initially selected)
 */
const addFamilyToCart = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId } = req.body;
        const salesUserId = req.user.id;

        // Get family with children
        const family = await Family.findByPk(familyId, {
            include: [{
                model: FamilyChild,
                as: 'children',
                where: { status: { [Op.ne]: 'cancelled' } },
                required: true
            }],
            transaction
        });

        if (!family) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family not found or has no active children'
            });
        }

        // Add all children to cart
        const cartItems = [];
        for (const child of family.children) {
            // Check if already in cart
            const existingItem = await FamilyCartItem.findOne({
                where: {
                    sales_user_id: salesUserId,
                    child_id: child.id
                },
                transaction
            });

            if (!existingItem) {
                const cartItem = await FamilyCartItem.create({
                    sales_user_id: salesUserId,
                    family_id: familyId,
                    child_id: child.id,
                    selected: true
                }, { transaction });
                cartItems.push(cartItem);
            }
        }

        // Log activity
        await logFamilyActivity({
            family_id: familyId,
            user_id: salesUserId,
            action_type: 'cart_updated',
            action_description: `Family ${family.parent_name} added to cart by ${req.user.full_name}`,
            metadata: {
                children_added: family.children.length,
                action: 'add_family_to_cart'
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                family: family,
                cartItems: cartItems,
                childrenAdded: cartItems.length
            },
            message: `Family added to cart with ${cartItems.length} children`
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error adding family to cart:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Add specific children to cart
 */
const addChildrenToCart = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId, childrenIds } = req.body;
        const salesUserId = req.user.id;

        console.log('Add children to cart request:', { familyId, childrenIds, salesUserId });

        // Validate input
        if (!Array.isArray(childrenIds) || childrenIds.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Children IDs array is required'
            });
        }

        // Validate all childrenIds are numbers
        const validChildrenIds = childrenIds.filter(id => Number.isInteger(id) && id > 0);
        if (validChildrenIds.length !== childrenIds.length) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'All children IDs must be valid positive integers'
            });
        }

        // Get children details with family information
        const children = await FamilyChild.findAll({
            where: { 
                id: { [Op.in]: validChildrenIds },
                status: { [Op.ne]: 'cancelled' }
            },
            include: [{
                model: Family,
                as: 'family',
                attributes: ['id', 'parent_name', 'parent_email', 'status']
            }],
            transaction
        });

        console.log(`Found ${children.length} children out of ${validChildrenIds.length} requested`);

        if (children.length !== validChildrenIds.length) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Some children not found or are cancelled'
            });
        }

        // Verify all children belong to the same family (if familyId provided)
        if (familyId) {
            const childrenNotInFamily = children.filter(child => child.family_id !== familyId);
            if (childrenNotInFamily.length > 0) {
                if (transaction) await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Some children do not belong to the specified family'
                });
            }
        }

        // Check for active subscriptions for each child
        const childrenWithActiveSubscriptions = [];
        const eligibleChildren = [];

        for (const child of children) {
            let hasActiveSubscription = false;

            try {
                let matchingUser = null;
                
                // Try to find user by email first
                if (child.child_email) {
                    matchingUser = await User.findOne({
                        where: { email: child.child_email },
                        transaction
                    });
                }
                
                // Fallback: try to find by transaction history
                if (!matchingUser) {
                    const familyTransactions = await FamilyPaymentTransaction.findAll({
                        where: { 
                            family_id: child.family_id,
                            paid_children_ids: {
                                [Op.like]: `%"${child.id}"%` // MySQL-safe JSON array search
                            },
                            status: 'success'
                        },
                        transaction
                    });
                    
                    for (const txn of familyTransactions) {
                        if (txn.student_ids && Array.isArray(txn.student_ids)) {
                            const users = await User.findAll({
                                where: { 
                                    id: { [Op.in]: txn.student_ids },
                                    full_name: { [Op.like]: `%${child.child_name}%` }
                                },
                                transaction
                            });
                            
                            if (users.length > 0) {
                                matchingUser = users[0];
                                break;
                            }
                        }
                    }
                }

                // Check for active subscription
                if (matchingUser) {
                    const activeSubscription = await UserSubscriptionDetails.findOne({
                        where: { 
                            user_id: matchingUser.id,
                            status: 'active'
                        },
                        transaction
                    });

                    if (activeSubscription) {
                        hasActiveSubscription = true;
                        childrenWithActiveSubscriptions.push({
                            childId: child.id,
                            childName: child.child_name,
                            subscriptionType: activeSubscription.type,
                            subscriptionStatus: activeSubscription.status,
                            subscriptionId: activeSubscription.id
                        });
                    }
                }
            } catch (error) {
                console.error(`Error checking subscription for child ${child.id}:`, error);
                // Continue processing other children rather than failing completely
            }

            if (!hasActiveSubscription) {
                eligibleChildren.push(child);
            }
        }

        console.log(`Found ${childrenWithActiveSubscriptions.length} children with active subscriptions`);
        console.log(`Found ${eligibleChildren.length} eligible children`);

        // If any children have active subscriptions, return partial error
        if (childrenWithActiveSubscriptions.length > 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'partial_error',
                message: 'Some children already have active subscriptions',
                data: {
                    childrenWithActiveSubscriptions,
                    eligibleChildrenIds: eligibleChildren.map(c => c.id)
                }
            });
        }

        // Add eligible children to cart
        const cartItems = [];
        for (const child of eligibleChildren) {
            // Check if already in cart
            const existingItem = await FamilyCartItem.findOne({
                where: {
                    sales_user_id: salesUserId,
                    child_id: child.id
                },
                transaction
            });

            if (!existingItem) {
                const cartItem = await FamilyCartItem.create({
                    sales_user_id: salesUserId,
                    family_id: child.family_id,
                    child_id: child.id,
                    selected: true
                }, { transaction });
                cartItems.push(cartItem);
            } else {
                console.log(`Child ${child.id} already in cart, skipping`);
            }
        }

        // Log activity for the family
        const uniqueFamilyIds = [...new Set(eligibleChildren.map(child => child.family_id))];
        for (const familyId of uniqueFamilyIds) {
            const familyChildren = eligibleChildren.filter(child => child.family_id === familyId);
            await logFamilyActivity({
                family_id: familyId,
                user_id: salesUserId,
                action_type: 'cart_updated',
                action_description: `${familyChildren.length} children added to cart by ${req.user.full_name}`,
                new_values: {
                    added_children: familyChildren.map(child => ({
                        child_id: child.id,
                        child_name: child.child_name
                    }))
                },
                metadata: {
                    action: 'add_children_to_cart',
                    children_count: familyChildren.length
                }
            }, transaction);
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                cartItems,
                childrenAdded: cartItems.length,
                skippedExisting: eligibleChildren.length - cartItems.length
            },
            message: `${cartItems.length} children added to cart successfully`
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error adding children to cart:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Toggle child selection in cart
 */
const toggleChildSelection = async (req, res) => {
    try {
        const { familyId, childId } = req.params;
        const { selected } = req.body;
        const salesUserId = req.user.id;

        const cartItem = await FamilyCartItem.findOne({
            where: {
                sales_user_id: salesUserId,
                family_id: familyId,
                child_id: childId
            }
        });

        if (!cartItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Cart item not found'
            });
        }

        await cartItem.update({ selected: selected });

        return res.status(200).json({
            status: 'success',
            data: { cartItem },
            message: 'Child selection updated successfully'
        });

    } catch (error) {
        console.error('Error toggling child selection:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Toggle family selection (all children)
 */
const toggleFamilySelection = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId } = req.params;
        const salesUserId = req.user.id;

        // Get all cart items for this family
        const cartItems = await FamilyCartItem.findAll({
            where: {
                sales_user_id: salesUserId,
                family_id: familyId
            },
            transaction
        });

        if (cartItems.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No cart items found for this family'
            });
        }

        // Check if all are currently selected
        const allSelected = cartItems.every(item => item.selected);
        const newSelectedState = !allSelected;

        // Update all items
        await FamilyCartItem.update(
            { selected: newSelectedState },
            {
                where: {
                    sales_user_id: salesUserId,
                    family_id: familyId
                },
                transaction
            }
        );

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { 
                familyId,
                selected: newSelectedState,
                itemsUpdated: cartItems.length
            },
            message: `Family selection ${newSelectedState ? 'enabled' : 'disabled'} for all children`
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error toggling family selection:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update cart item subscription configuration
 */
const updateCartItemSubscription = async (req, res) => {
    try {
        const { familyId, childId } = req.params;
        const { subscriptionType, customAmount } = req.body;
        const salesUserId = req.user.id;

        const cartItem = await FamilyCartItem.findOne({
            where: {
                sales_user_id: salesUserId,
                family_id: familyId,
                child_id: childId
            }
        });

        if (!cartItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Cart item not found'
            });
        }

        // Validate subscription type if provided
        if (subscriptionType && !['monthly', 'quarterly', 'yearly'].includes(subscriptionType)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid subscription type'
            });
        }

        // Validate custom amount if provided
        if (customAmount && (isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0)) {
            return res.status(400).json({
                status: 'error',
                message: 'Custom amount must be a positive number'
            });
        }

        await cartItem.update({ 
            cart_subscription_type: subscriptionType,
            cart_custom_amount: customAmount ? parseFloat(customAmount) : null
        });

        return res.status(200).json({
            status: 'success',
            data: { cartItem },
            message: 'Cart item subscription details updated successfully'
        });

    } catch (error) {
        console.error('Error updating cart item subscription:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Remove child from cart
 */
const removeChildFromCart = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId, childId } = req.params;
        const salesUserId = req.user.id;

        const deletedCount = await FamilyCartItem.destroy({
            where: {
                sales_user_id: salesUserId,
                family_id: familyId,
                child_id: childId
            },
            transaction
        });

        if (deletedCount === 0) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Cart item not found'
            });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Child removed from cart successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error removing child from cart:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Remove family from cart
 */
const removeFamilyFromCart = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { familyId } = req.params;
        const salesUserId = req.user.id;

        const deletedCount = await FamilyCartItem.destroy({
            where: {
                sales_user_id: salesUserId,
                family_id: familyId
            },
            transaction
        });

        if (deletedCount === 0) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No cart items found for this family'
            });
        }

        // Log activity
        await logFamilyActivity({
            family_id: familyId,
            user_id: salesUserId,
            action_type: 'cart_updated',
            action_description: `Family removed from cart by ${req.user.full_name}`,
            metadata: {
                action: 'remove_family_from_cart',
                items_removed: deletedCount
            }
        }, transaction);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { removedItems: deletedCount },
            message: 'Family removed from cart successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error removing family from cart:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Clear entire cart
 */
const clearCart = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const salesUserId = req.user.id;

        const deletedCount = await FamilyCartItem.destroy({
            where: { sales_user_id: salesUserId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { clearedItems: deletedCount },
            message: 'Cart cleared successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error clearing cart:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get selected children summary
 */
const getSelectedChildrenSummary = async (req, res) => {
    try {
        const salesUserId = req.user.id;

        const selectedItems = await FamilyCartItem.findAll({
            where: { 
                sales_user_id: salesUserId,
                selected: true
            },
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email']
                },
                {
                    model: FamilyChild,
                    as: 'child',
                    attributes: ['id', 'child_name', 'relationship_to_parent']
                }
            ]
        });

        const configuredItems = selectedItems.filter(item => item.cart_subscription_type);
        const totalAmount = configuredItems.reduce((sum, item) => {
            const amount = item.cart_custom_amount || SUBSCRIPTION_PRICES[item.cart_subscription_type];
            return sum + amount;
        }, 0);

        return res.status(200).json({
            status: 'success',
            data: {
                selectedCount: selectedItems.length,
                configuredCount: configuredItems.length,
                totalAmount,
                readyForPayment: selectedItems.length > 0 && selectedItems.every(item => item.cart_subscription_type),
                items: selectedItems
            },
            message: 'Selected children summary retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting selected children summary:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Prepare children payment data
 */
const prepareChildrenPayment = async (req, res) => {
    try {
        const { childrenData } = req.body;
        const salesUserId = req.user.id;

        if (!childrenData || childrenData.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No children data provided'
            });
        }

        // Validate and prepare payment data
        const preparedData = [];
        let totalAmount = 0;

        for (const childData of childrenData) {
            const { childId, subscriptionType, customAmount } = childData;
            
            // Get child details
            const child = await FamilyChild.findByPk(childId, {
                include: [{
                    model: Family,
                    as: 'family'
                }]
            });

            if (!child) {
                return res.status(404).json({
                    status: 'error',
                    message: `Child with ID ${childId} not found`
                });
            }

            const amount = customAmount || SUBSCRIPTION_PRICES[subscriptionType];
            totalAmount += amount;

            preparedData.push({
                childId: child.id,
                childName: child.child_name,
                familyId: child.family_id,
                parentName: child.family.parent_name,
                parentEmail: child.family.parent_email,
                relationshipToParent: child.relationship_to_parent,
                subscriptionType,
                amount,
                customAmount
            });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                preparedData,
                totalAmount,
                childrenCount: preparedData.length,
                familiesCount: new Set(preparedData.map(d => d.familyId)).size
            },
            message: 'Payment data prepared successfully'
        });

    } catch (error) {
        console.error('Error preparing children payment:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Generate Family Payment Link - Creates a single PayPlus payment link for all selected children
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const generateFamilyPaymentLink = async (req, res) => {
    let transaction;
    const startTime = Date.now();
    console.log('Ashish');
    try {
        transaction = await sequelize.transaction();

        const {
            selectedChildrenWithSubscriptions,
            paymentType, // 'one_time' or 'recurring'
            description,
            customNote,
            currency = 'ILS',
            recurStartDate
        } = req.body;

        // Validation
        if (!selectedChildrenWithSubscriptions || !Array.isArray(selectedChildrenWithSubscriptions) || selectedChildrenWithSubscriptions.length === 0) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'At least one child with subscription configuration is required'
            });
        }

        if (!description?.trim()) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment description is required'
            });
        }

        // Validate all children have required plan details
        for (const child of selectedChildrenWithSubscriptions) {
            if (!child.childName || !child.amount || child.amount <= 0) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid child data: ${child.childName || 'Unknown child'} - name and amount required`
                });
            }
        }

        console.log(`🏠 Generating family payment link for ${selectedChildrenWithSubscriptions.length} children`);

        // Calculate totals
        const totalAmount = selectedChildrenWithSubscriptions.reduce((sum, child) => sum + parseFloat(child.amount), 0);
        const childrenCount = selectedChildrenWithSubscriptions.length;
        const familiesCount = new Set(selectedChildrenWithSubscriptions.map(child => child.familyId)).size;

        // Get primary family contact info
        const primaryChild = selectedChildrenWithSubscriptions[0];
        const parentName = primaryChild.parentName;
        const parentEmail = selectedChildrenWithSubscriptions.find(child => child.parentEmail)?.parentEmail || '';
        const parentPhone = selectedChildrenWithSubscriptions.find(child => child.parentPhone)?.parentPhone || '';

        // Create detailed plan description
        const planDescription = `${description} - ${childrenCount} children from ${familiesCount} ${familiesCount === 1 ? 'family' : 'families'}`;

        // Prepare items for PayPlus
        const paymentItems = selectedChildrenWithSubscriptions.map(child => ({
            name: `${child.childName} (${child.relationshipToParent}) - ${child.planDescription || 'Learning Plan'}`,
            quantity: 1,
            price: parseFloat(child.amount),
            vat_type: 0
        }));

        // Generate unique identifiers
        const linkToken = generateLinkToken();
        const shortId = generateShortId(); // For backward compatibility in URLs
        console.log('linkToken :',linkToken);
        // Prepare children details for storage
        const childrenDetails = selectedChildrenWithSubscriptions.map(child => ({
            childId: child.childId,
            childName: child.childName,
            familyId: child.familyId,
            parentName: child.parentName,
            relationshipToParent: child.relationshipToParent,
            planType: child.planType,
            durationMonths: child.durationMonths || child.customMonths,
            lessonMinutes: child.lessonMinutes,
            lessonsPerMonth: child.lessonsPerMonth,
            amount: child.amount,
            planDescription: child.planDescription
        }));

        // Encode additional data for PayPlus
        const encodedData = encodeURIComponent(Buffer.from(JSON.stringify({
            family_payment: true,
            link_token: linkToken,
            short_id: shortId,
            children_count: childrenCount,
            payment_type: paymentType,
            salesperson_id: req.user?.id || null,
            families_count: familiesCount
        })).toString('base64'));

        // Determine recurring settings
        const isRecurring = paymentType === 'recurring';
        const recurringType = getPayPlusRecurringType('monthly');
        const recurringRange = getPayPlusRecurringRange('monthly');

        // Prepare PayPlus request
        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: totalAmount,
            currency_code: currency,
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            refURL_success: `${process.env.FRONTEND_URL}/payment/family/success?token=${linkToken}`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/family/failed?token=${linkToken}`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/family-payment/webhook`,
            expiry_datetime: "10080", // 7 days
            customer: {
                customer_name: parentName,
                email: parentEmail,
                phone: parentPhone
            },
            items: paymentItems,
            more_info: 'family_payment',
            more_info_1: linkToken,
            more_info_2: childrenCount.toString(),
            more_info_3: familiesCount.toString(),
            more_info_4: shortId,
            more_info_5: encodedData
        };

        // Add recurring settings if needed
        if (isRecurring) {
            payPlusRequest.charge_method = 3; // Recurring
            payPlusRequest.payments = 1;
            payPlusRequest.recurring_settings = {
                instant_first_payment: true,
                recurring_type: recurringType,
                recurring_range: recurringRange,
                number_of_charges: 0, // Unlimited
                start_date_on_payment_date: !recurStartDate,
                start_date: recurStartDate ? Math.min(parseInt(moment(recurStartDate).format('DD')), 28) : undefined,
                jump_payments: 30, // Monthly billing cycle
                successful_invoice: true,
                customer_failure_email: true,
                send_customer_success_email: true
            };
        } else {
            payPlusRequest.charge_method = 1; // One-time
            payPlusRequest.payments = 1;
        }

        console.log('🟨 PayPlus Family Payment Request:', JSON.stringify(payPlusRequest, null, 2));

        // Make API call to PayPlus
        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey,
                },
                timeout: 30000
            }
        );

        if (response.data.results.status !== 'success') {
            await transaction.rollback();
            throw new Error(response.data.results.description || 'PayPlus API error');
        }

        const paymentUrl = response.data.data.payment_page_link;
        const pageRequestUid = response.data.data.page_request_uid;
        const qrCode = response.data.data.qr_code_image;

        // Create family payment link record
        const familyPaymentLink = await FamilyPaymentLink.create({
            link_token: linkToken,
            sales_user_id: req.user?.id || null,
            selected_children_ids: selectedChildrenWithSubscriptions.map(c => c.childId), // Legacy field
            selected_children_details: childrenDetails,
            total_amount: totalAmount,
            currency,
            payment_type: paymentType,
            description,
            custom_note: customNote,
            payplus_payment_url: paymentUrl,
            payplus_page_request_uid: pageRequestUid,
            payplus_qr_code: qrCode,
            expires_at: moment().add(7, 'days').toDate(),
            status: 'active'
        }, { transaction });

        await transaction.commit();

        const processingTime = Date.now() - startTime;
        console.log(`✅ Family payment link generated successfully in ${processingTime}ms`);

        // Generate short payment link for easy sharing
        const shortPaymentLink = `${process.env.FRONTEND_URL}/payment/family/${linkToken}`;

        return res.status(200).json({
            status: 'success',
            data: {
                payment_link: paymentUrl,
                short_payment_link: shortPaymentLink,
                link_token: linkToken,
                family_payment_link_id: familyPaymentLink.id,
                page_request_uid: pageRequestUid,
                qr_code_image: qrCode,
                expires_at: moment().add(7, 'days').toISOString(),
                details: {
                    totalAmount,
                    childrenCount,
                    familiesCount,
                    paymentType,
                    currency,
                    description,
                    parentContact: {
                        name: parentName,
                        email: parentEmail,
                        phone: parentPhone
                    },
                    childrenDetails
                }
            },
            message: `Family payment link generated successfully for ${childrenCount} children`
        });

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        const processingTime = Date.now() - startTime;
        console.error('❌ Error generating family payment link:', error.response?.data || error.message);

        return res.status(500).json({
            status: 'error',
            message: 'Failed to generate family payment link',
            details: error.response?.data?.results?.description || error.message,
            processingTime
        });
    }
};

/**
 * Get payment links
 */
const getPaymentLinks = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status = 'all'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const salesUserId = req.user.id;

        const whereConditions = {
            ...(req.user.role_name !== 'sales_role' && { sales_user_id: salesUserId })
        };

        if (status !== 'all') {
            whereConditions.status = status;
        }

        const { count, rows: paymentLinks } = await FamilyPaymentLink.findAndCountAll({
            where: whereConditions,
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                paymentLinks,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(count / parseInt(limit)),
                    totalCount: count,
                    limit: parseInt(limit)
                }
            },
            message: 'Payment links retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting payment links:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get payment link details
 */
const getPaymentLinkDetails = async (req, res) => {
    try {
        const { linkId } = req.params;
        const salesUserId = req.user.id;

        const paymentLink = await FamilyPaymentLink.findOne({
            where: {
                id: linkId,
                ...(req.user.role_name !== 'sales_role' && { sales_user_id: salesUserId })
            },
            include: [{
                model: FamilyPaymentTransaction,
                as: 'transactions',
                required: false
            }]
        });

        if (!paymentLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment link not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: { paymentLink },
            message: 'Payment link details retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting payment link details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get family payment history
 */
const getFamilyPaymentHistory = async (req, res) => {
    try {
        const { familyId } = req.params;
        const {
            page = 1,
            limit = 10
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const salesUserId = req.user.id;

        // Check if user has access to this family
        const family = await Family.findOne({
            where: {
                id: familyId,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            }
        });

        if (!family) {
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        const { count, rows: transactions } = await FamilyPaymentTransaction.findAndCountAll({
            where: { family_id: familyId },
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(count / parseInt(limit)),
                    totalCount: count,
                    limit: parseInt(limit)
                }
            },
            message: 'Family payment history retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family payment history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Handle PayPlus webhook for family payments
 */
const handlePayPlusWebhook = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        
        const webhookData = req.body;
        console.log('PayPlus Family Webhook received:', webhookData);

        // Extract payment information
        const {
            transaction_uid,
            status_code,
            more_info_1: linkToken,
            more_info_2: paymentType,
            more_info_5: childrenDataEncoded
        } = webhookData;

        if (!linkToken) {
            await transaction.commit();
            return res.status(400).json({
                status: 'error',
                message: 'Missing link token in webhook'
            });
        }

        // Find the payment link
        const paymentLink = await FamilyPaymentLink.findOne({
            where: { link_token: linkToken },
            transaction
        });

        if (!paymentLink) {
            await transaction.commit();
            return res.status(404).json({
                status: 'error',
                message: 'Payment link not found'
            });
        }

        // Parse children data
        let childrenData;
        try {
            childrenData = JSON.parse(decodeURIComponent(childrenDataEncoded));
        } catch (error) {
            console.error('Error parsing children data:', error);
            childrenData = { selected_children: paymentLink.selected_children_details };
        }

        // Create transaction record
        const paymentTransaction = await FamilyPaymentTransaction.create({
            payment_link_id: paymentLink.id,
            transaction_token: crypto.randomBytes(16).toString('hex'),
            payplus_transaction_id: transaction_uid,
            family_id: childrenData.selected_children?.[0]?.family_id || paymentLink.selected_children_details[0]?.family_id,
            paid_children_ids: childrenData.selected_children?.map(c => c.child_id) || paymentLink.selected_children_details.map(c => c.child_id),
            paid_children_details: childrenData.selected_children || paymentLink.selected_children_details,
            amount: paymentLink.total_amount,
            currency: paymentLink.currency,
            payment_type: paymentLink.payment_type,
            status: status_code === '000' ? 'success' : 'failed',
            payplus_response_data: webhookData,
            processed_at: new Date()
        }, { transaction });

        // If payment successful, update children subscriptions and family status
        if (status_code === '000') {
            // Update payment link status
            await paymentLink.update({
                status: 'used',
                used_at: new Date()
            }, { transaction });

            // Update children with their subscription details
            for (const childDetail of paymentLink.selected_children_details) {
                await FamilyChild.update({
                    subscription_type: childDetail.subscription_type,
                    monthly_amount: childDetail.amount,
                    custom_amount: childDetail.custom_amount || null,
                    status: 'active',
                    subscription_start_date: new Date(),
                    payplus_subscription_id: paymentType === 'recurring' ? transaction_uid : null
                }, {
                    where: { id: childDetail.child_id },
                    transaction
                });

                // Log activity for each child
                await logFamilyActivity({
                    family_id: childDetail.family_id,
                    child_id: childDetail.child_id,
                    user_id: paymentLink.sales_user_id,
                    action_type: 'payment_completed',
                    action_description: `Payment completed for ${childDetail.child_name} - ${childDetail.subscription_type} subscription`,
                    new_values: {
                        subscription_type: childDetail.subscription_type,
                        amount: childDetail.amount,
                        payment_type: paymentType,
                        transaction_id: transaction_uid
                    },
                    metadata: {
                        payplus_transaction_id: transaction_uid,
                        payment_link_id: paymentLink.id
                    }
                }, transaction);
            }

            // Update family status to active if it was pending
            const familyIds = [...new Set(paymentLink.selected_children_details.map(c => c.family_id))];
            for (const familyId of familyIds) {
                const family = await Family.findByPk(familyId, { transaction });
                if (family && family.status === 'pending') {
                    await family.update({ status: 'active' }, { transaction });
                }
            }
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Webhook processed successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error processing PayPlus family webhook:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Modify subscription
 */
const modifySubscription = async (req, res) => {
    // TODO: Implement subscription modification logic
    return res.status(501).json({
        status: 'error',
        message: 'Subscription modification not implemented yet'
    });
};

/**
 * Get family activity log
 */
const getFamilyActivityLog = async (req, res) => {
    try {
        const { familyId } = req.params;
        const {
            page = 1,
            limit = 20,
            actionType
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const salesUserId = req.user.id;

        // Check if user has access to this family
        const family = await Family.findOne({
            where: {
                id: familyId,
                ...(req.user.role_name !== 'sales_role' && { created_by: salesUserId })
            }
        });

        if (!family) {
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        const whereConditions = { family_id: familyId };
        if (actionType) {
            whereConditions.action_type = actionType;
        }

        const { count, rows: activities } = await FamilyActivityLog.findAndCountAll({
            where: whereConditions,
            include: [{
                model: User,
                attributes: ['id', 'full_name', 'email'],
                required: false
            }],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                activities,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(count / parseInt(limit)),
                    totalCount: count,
                    limit: parseInt(limit)
                }
            },
            message: 'Family activity log retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family activity log:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get family revenue report
 */
const getFamilyRevenueReport = async (req, res) => {
    // TODO: Implement revenue report
    return res.status(501).json({
        status: 'error',
        message: 'Revenue report not implemented yet'
    });
};

/**
 * Get family conversion report
 */
const getFamilyConversionReport = async (req, res) => {
    // TODO: Implement conversion report
    return res.status(501).json({
        status: 'error',
        message: 'Conversion report not implemented yet'
    });
};

/**
 * Get cart subscription summary
 */
const getCartSubscriptionSummary = async (req, res) => {
    try {
        const salesUserId = req.user.id;

        const cartItems = await FamilyCartItem.findAll({
            where: { sales_user_id: salesUserId },
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email']
                },
                {
                    model: FamilyChild,
                    as: 'child',
                    attributes: ['id', 'child_name', 'relationship_to_parent']
                }
            ]
        });

        const configuredItems = cartItems.filter(item => item.cart_subscription_type);
        const totalConfigured = configuredItems.length;
        const totalItems = cartItems.length;
        const configuredAmount = configuredItems.reduce((sum, item) => {
            const amount = item.cart_custom_amount || SUBSCRIPTION_PRICES[item.cart_subscription_type];
            return sum + amount;
        }, 0);

        return res.status(200).json({
            status: 'success',
            data: {
                totalItems,
                totalConfigured,
                configuredAmount,
                pendingConfiguration: totalItems - totalConfigured,
                configurationComplete: totalConfigured === totalItems,
                items: configuredItems
            },
            message: 'Cart subscription summary retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting cart subscription summary:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Bulk configure cart subscriptions
 */
const bulkConfigureCartSubscriptions = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();
        const { childIds, subscriptionType, customAmount } = req.body;
        const salesUserId = req.user.id;

        if (!childIds || childIds.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No children specified'
            });
        }

        if (!subscriptionType || !['monthly', 'quarterly', 'yearly'].includes(subscriptionType)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid subscription type'
            });
        }

        const updatedCount = await FamilyCartItem.update({
            cart_subscription_type: subscriptionType,
            cart_custom_amount: customAmount ? parseFloat(customAmount) : null
        }, {
            where: {
                sales_user_id: salesUserId,
                child_id: { [Op.in]: childIds }
            },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: { 
                updatedCount: updatedCount[0],
                subscriptionType,
                customAmount
            },
            message: `Bulk configured ${updatedCount[0]} cart items`
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error bulk configuring cart subscriptions:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get subscription modifications (placeholder)
 */
const getSubscriptionModifications = async (req, res) => {
    return res.status(501).json({
        status: 'error',
        message: 'Subscription modifications feature not implemented yet'
    });
};

/**
 * Process subscription modification (placeholder)
 */
const processSubscriptionModification = async (req, res) => {
    return res.status(501).json({
        status: 'error',
        message: 'Subscription modification processing not implemented yet'
    });
};

/**
 * Bulk family actions (placeholder)
 */
const bulkFamilyActions = async (req, res) => {
    return res.status(501).json({
        status: 'error',
        message: 'Bulk family actions not implemented yet'
    });
};

/**
 * Export families (placeholder)
 */
const exportFamilies = async (req, res) => {
    return res.status(501).json({
        status: 'error',
        message: 'Family export feature not implemented yet'
    });
};

/**
 * Import families (placeholder)
 */
const importFamilies = async (req, res) => {
    return res.status(501).json({
        status: 'error',
        message: 'Family import feature not implemented yet'
    });
};

// Export all controller functions
module.exports = {
    // Family Management
    getFamilyStats,
    getFamilyList,
    getFamilyById,
    createFamily,
    updateFamily,
    deleteFamily,
    updateFamilyStatus,
    
    // Children Management
    addChildToFamily,
    updateChild,
    updateChildStatus,
    removeChild,
    
    // Cart Management
    getCartItems,
    addFamilyToCart,
    addChildrenToCart,
    toggleChildSelection,
    toggleFamilySelection,
    updateCartItemSubscription,
    removeChildFromCart,
    removeFamilyFromCart,
    clearCart,
    getSelectedChildrenSummary,
    getCartSubscriptionSummary,
    bulkConfigureCartSubscriptions,    
    
    // Payment Management
    prepareChildrenPayment,
    generateFamilyPaymentLink,
    getPaymentLinks,
    getPaymentLinkDetails,
    getFamilyPaymentHistory,
    handlePayPlusWebhook,
    modifySubscription,
    getSubscriptionModifications,
    processSubscriptionModification,
    
    // Activity & Reports
    getFamilyActivityLog,
    getFamilyRevenueReport,
    getFamilyConversionReport,

    // Bulk Operations
    bulkFamilyActions, 
    exportFamilies, 
    importFamilies,
      
};