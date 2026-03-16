// sales.controller.js
const { Op, Sequelize,col, literal, fn } = require('sequelize');
const bcrypt = require('bcrypt');
const User = require('../../models/users');
const Salesperson = require('../../models/Salesperson');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialStudentTransfer = require('../../models/TrialStudentTransfer');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Class = require('../../models/classes');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');
const PaymentTransaction = require('../../models/PaymentTransaction');

async function getSalesSubscriptionStats(userIds) {
    if (!userIds.length) return {};

    const startOfMonth = moment.utc().startOf('month').toDate();
    const endOfMonth = moment.utc().endOf('month').toDate();

    const rows = await UserSubscriptionDetails.findAll({
        attributes: [
            [col('Payment.generated_by'), 'sales_person_id'],
            [fn('COUNT', col('UserSubscriptionDetails.id')), 'totalSubscriptions'],
            [
                fn(
                    'SUM',
                    literal(`
          CASE 
            WHEN UserSubscriptionDetails.is_cancel = 0 
            THEN Payment.amount 
            ELSE 0 
          END
        `)
                ),
                'activeSubscriptionAmount'
            ],
            [
                fn(
                    'SUM',
                    literal(`
          CASE 
            WHEN UserSubscriptionDetails.is_cancel = 0 
            THEN 1 
            ELSE 0 
          END
        `)
                ),
                'activeSubscriptions'
            ]
        ],
        include: [
            {
                model: PaymentTransaction,
                as: 'Payment',
                attributes: [],
                required: true,
                where: {
                    status: 'success',
                    generated_by: {
                        [Op.in]: userIds
                    },
                    created_at: {
                        [Op.between]: [startOfMonth, endOfMonth]
                    }
                }
            }
        ],
        group: ['Payment.generated_by'],
        raw: true
    });

    console.log('rows', rows);

    const statsMap = {};
    rows.forEach((row) => {
        statsMap[row.sales_person_id] = {
            totalSubscriptionsThisMonth: Number(row.totalSubscriptions),
            activeSubscriptionsThisMonth: Number(row.activeSubscriptions),
            activeSubscriptionAmountThisMonth: Number(row.activeSubscriptionAmount || 0)
        };
    });

    return statsMap;
}

/**
 * Get sales persons list
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSalesPersons(req, res) {
    try {
        const { page = 1, limit = 10, search = '', role = 'all', profitability } = req.query;
        const parsedLimit = parseInt(limit);
        const parsedPage = parseInt(page);

        // Base where conditions for sales roles
        const whereConditions = {
            role_name: {
                [Op.in]: ['sales_role', 'sales_appointment_setter']
            }
        };

        // Add search filter if provided
        if (search.trim()) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } }
            ];
        }

        // Add role filter
        if (role !== 'all') {
            whereConditions.role_name = role;
        }

        /**
         * STEP 1 — Get ALL matching sales user IDs (NO pagination yet)
         */
        const allUsers = await User.findAll({
            where: whereConditions,
            attributes: ['id', 'full_name', 'email', 'mobile', 'role_name', 'created_at', 'status','country_code'],
            order: [['id', 'DESC']],
            raw: true
        });

        let userIds = allUsers.map(u => u.id);

        /**
         * STEP 2 — Get subscription stats for ALL users
         */
        const subscriptionStatsMap = await getSalesSubscriptionStats(userIds);

        /**
         * STEP 3 — Apply profitability filter BEFORE pagination
         */
        if (profitability === 'profitable') {
            userIds = userIds.filter(id => {
                const amount =
                    subscriptionStatsMap[String(id)]?.activeSubscriptionAmountThisMonth || 0;
                return amount > 0;
            });
        }

        if (profitability === 'not_profitable') {
            userIds = userIds.filter(id => {
                const amount =
                    subscriptionStatsMap[String(id)]?.activeSubscriptionAmountThisMonth || 0;
                return amount <= 0;
            });
        }

        const totalFilteredCount = userIds.length;

        /**
         * STEP 4 — Apply pagination AFTER filtering
         */
        const paginatedIds = userIds.slice(
            (parsedPage - 1) * parsedLimit,
            parsedPage * parsedLimit
        );

        /**
         * STEP 5 — Fetch only paginated users
         */
        const { rows } = await User.findAndCountAll({
            where: {
                id: { [Op.in]: paginatedIds }
            },
            attributes: ['id', 'full_name', 'email', 'mobile', 'role_name', 'created_at', 'status'],
            order: [['id', 'DESC']]
        });

        /**
         * STEP 6 — Get stats only for paginated users
         */
        const finalUserIds = rows.map(user => user.id);

        const trialCounts = await TrialClassRegistration.findAll({
            attributes: ['booked_by', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
            where: {
                booked_by: {
                    [Op.in]: finalUserIds
                }
            },
            group: ['booked_by'],
            raw: true
        });

        const trialCountMap = {};
        trialCounts.forEach(item => {
            trialCountMap[item.booked_by] = Number(item.total);
        });

        /**
         * STEP 7 — Format response (YOUR ORIGINAL LOGIC)
         */
        const formattedUsers = rows.map(user => {
            const roleDisplay = {
                sales_role: 'Sales Agent',
                sales_appointment_setter: 'Sales Appointment Setter',
                support_agent: 'Support Agent'
            };

            const stats = subscriptionStatsMap[String(user.id)] || {
                totalSubscriptionsThisMonth: 0,
                activeSubscriptionsThisMonth: 0,
                activeSubscriptionAmountThisMonth: 0
            };

            return {
                id: user.id,
                name: user.full_name,
                email: user.email,
                phone: user.mobile,
                country_code: user.country_code,
                role: roleDisplay[user.role_name] || user.role_name,
                status: user.status,
                activeSubscriptionValue: stats.activeSubscriptionAmountThisMonth,
                subscriptions: {
                    thisMonth: stats.totalSubscriptionsThisMonth,
                    active: stats.activeSubscriptionsThisMonth
                },
                trialClassesBooked: trialCountMap[user.id] || 0,
                profitabilityStatus:
                    stats.activeSubscriptionAmountThisMonth > 0
                        ? 'Profitable'
                        : 'Not Profitable',
                workDuration: calculateWorkDuration(user.created_at)
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Sales persons fetched successfully',
            data: {
                users: formattedUsers,
                pagination: {
                    total: totalFilteredCount,
                    current_page: parsedPage,
                    total_pages: Math.ceil(totalFilteredCount / parsedLimit),
                    per_page: parsedLimit
                }
            }
        });

    } catch (error) {
        console.error('Error fetching sales persons:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch sales persons',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get detailed information about a sales person
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSalesPersonDetails(req, res) {
    try {
        const { id } = req.params;

        const user = await User.findOne({
            where: {
                id,
                role_name: {
                    [Op.in]: ['sales_role', 'sales_appointment_setter']
                }
            },
            attributes: [
                'id',
                'full_name',
                'email',
                'mobile',
                'role_name',
                'created_at',
                'status',
                'avatar',
                'bio',
                'city',
                'about',
                'updated_at'
            ]
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales person not found'
            });
        }

        // Debug log to check avatar value
        console.log('User avatar from database:', user.avatar);

        // Map role names to display values
        const roleDisplay = {
            'sales_role': 'Sales Agent',
            'sales_appointment_setter': 'Appointment Setter'
        };

        // Format the user data to match frontend interface
        const formattedUser = {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            phone: user.mobile,
            role_name: roleDisplay[user.role_name] || user.role_name,
            avatar: user.avatar, // Make sure avatar is included
            created_at: new Date(user.created_at * 1000).toISOString(), // Convert Unix timestamp to ISO string
            last_login: user.updated_at ? new Date(user.updated_at * 1000).toISOString() : null,
            status: user.status,
            department: 'Sales', // Default department
            location: user.city || null,
            manager: null, // Can be implemented later
            bio: user.about || user.bio
        };

        // Debug log to check formatted response
        console.log('Formatted user response:', {
            id: formattedUser.id,
            full_name: formattedUser.full_name,
            avatar: formattedUser.avatar
        });

        return res.status(200).json({
            status: 'success',
            message: 'Sales person details fetched successfully',
            data: formattedUser
        });

    } catch (error) {
        console.error('Error fetching sales person details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch sales person details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get performance metrics for a sales person
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSalesPersonPerformance(req, res) {
    try {
        const { id } = req.params;
        const { from, to } = req.query;

        // Parse date range or use current month
        const startDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const endDate = to ? new Date(to) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

        // Verify user exists and is a sales person
        const user = await User.findOne({
            where: {
                id,
                role_name: {
                    [Op.in]: ['sales_role', 'sales_appointment_setter']
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales person not found'
            });
        }

        // Get trial classes booked by this sales person
        const trialClassesBooked = await TrialClassRegistration.count({
            where: {
                booked_by: id,
                created_at: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // Get total enrollments (converted trials + direct subscriptions)
        const convertedTrials = await TrialClassRegistration.count({
            where: {
                booked_by: id,
                trial_class_status: 'new_enroll',
                created_at: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // Get subscription sales from Salesperson table
        const subscriptionSales = await Salesperson.findAll({
            where: {
                user_id: id,
                action_type: 'subscription',
                created_at: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        const totalEnrollments = convertedTrials + subscriptionSales.length;

        // Calculate total revenue from subscription sales
        const totalRevenue = subscriptionSales.reduce((sum, sale) => {
            return sum + parseFloat(sale.revenue_generated || 0);
        }, 0);

        // Get transfer data
        const totalTransfers = await TrialStudentTransfer.count({
            where: {
                [Op.or]: [
                    { appointment_setter_id: id },
                    { sales_user_id: id }
                ],
                created_at: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // Get current active leads (pending trial registrations)
        const currentActiveLeads = await TrialClassRegistration.count({
            where: {
                booked_by: id,
                trial_class_status: {
                    [Op.in]: ['trial_1', 'trial_2', 'trial_3', 'waiting_for_answer', 'follow_up']
                }
            }
        });

        // Calculate conversion rate
        const conversionRate = trialClassesBooked > 0 ? (totalEnrollments / trialClassesBooked) * 100 : 0;

        // Mock average response time (can be calculated from actual data later)
        const averageResponseTime = 15; // minutes

        // Get recent activities
        const recentActivities = await getRecentActivities(id, 20);

        // Format performance data
        const performanceData = {
            totalTrialsBooked: trialClassesBooked,
            totalEnrollments: totalEnrollments,
            conversionRate: Math.round(conversionRate * 10) / 10, // Round to 1 decimal
            totalRevenue: Math.round(totalRevenue * 100) / 100, // Round to 2 decimals
            averageResponseTime: averageResponseTime,
            totalTransfers: totalTransfers,
            currentActiveLeads: currentActiveLeads
        };

        return res.status(200).json({
            status: 'success',
            message: 'Sales person performance fetched successfully',
            data: performanceData,
            activities: recentActivities
        });

    } catch (error) {
        console.error('Error fetching sales person performance:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch sales person performance',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get recent activities for a sales person
 * @param {number} userId - Sales person user ID
 * @param {number} limit - Number of activities to return
 * @returns {Array} Array of recent activities
 */
async function getRecentActivities(userId, limit = 20) {
    try {
        const activities = [];

        // Get recent trial class bookings
        const recentTrials = await TrialClassRegistration.findAll({
            where: {
                booked_by: userId
            },
            order: [['created_at', 'DESC']],
            limit: Math.ceil(limit / 4),
            attributes: ['id', 'student_name', 'email', 'created_at', 'trial_class_status']
        });

        recentTrials.forEach(trial => {
            activities.push({
                id: `trial_${trial.id}`,
                type: 'trial_booked',
                description: `Booked trial class for ${trial.student_name} (${trial.email || 'No Email'})`,
                timestamp: new Date(trial.created_at).toISOString(),
                studentName: trial.student_name
            });
        });

        // Get recent subscription sales
        const recentSales = await Salesperson.findAll({
            where: {
                user_id: userId,
                action_type: 'subscription'
            },
            include: [{
                model: User,
                as: 'student',
                attributes: ['full_name']
            }],
            order: [['created_at', 'DESC']],
            limit: Math.ceil(limit / 4),
            attributes: ['id', 'created_at', 'revenue_generated', 'student_id']
        });

        recentSales.forEach(sale => {
            activities.push({
                id: `enrollment_${sale.id}`,
                type: 'enrollment',
                description: `Successfully enrolled ${sale.student?.full_name || 'student'}`,
                timestamp: new Date(sale.created_at).toISOString(),
                studentName: sale.student?.full_name,
                amount: parseFloat(sale.revenue_generated || 0)
            });
        });

        // Get recent transfers
        const recentTransfers = await TrialStudentTransfer.findAll({
            where: {
                [Op.or]: [
                    { appointment_setter_id: userId },
                    { sales_user_id: userId }
                ]
            },
            order: [['created_at', 'DESC']],
            limit: Math.ceil(limit / 4),
            attributes: ['id', 'student_name', 'created_at', 'transfer_status', 'appointment_setter_id']
        });

        recentTransfers.forEach(transfer => {
            const isTransferFrom = transfer.appointment_setter_id === userId;
            activities.push({
                id: `transfer_${transfer.id}`,
                type: 'transfer',
                description: isTransferFrom 
                    ? `Transferred lead ${transfer.student_name}` 
                    : `Received transferred lead ${transfer.student_name}`,
                timestamp: new Date(transfer.created_at).toISOString(),
                studentName: transfer.student_name
            });
        });

        // Get recent payment links created with student details
        const recentPaymentLinks = await TrialPaymentLink.findAll({
            where: {
                sales_user_id: userId
            },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass', // You'll need to set up this association
                attributes: ['student_name', 'email'],
                required: false // LEFT JOIN - in case trial_class_id is null
            }],
            order: [['created_at', 'DESC']],
            limit: Math.ceil(limit / 4),
            attributes: ['id', 'amount', 'currency', 'created_at', 'payment_status', 'trial_class_id']
        });

        recentPaymentLinks.forEach(link => {
            let description = 'Created payment link';
            let studentName = null;
            let studentEmail = null;

            // If there's trial class data, include student details
            if (link.trialClass) {
                studentName = link.trialClass.student_name;
                studentEmail = link.trialClass.email;
                description = `Created payment link for ${studentName}`;
                if (studentEmail) {
                    description += ` (${studentEmail})`;
                }
            }

            // Add amount and currency to description
            const amount = parseFloat(link.amount || 0);
            const currency = link.currency || 'ILS';
            // description += ` - ${amount} ${currency}`;

            activities.push({
                id: `payment_${link.id}`,
                type: 'payment',
                description: description,
                timestamp: new Date(link.created_at).toISOString(),
                amount: amount,
                currency: currency,
                studentName: studentName,
                studentEmail: studentEmail,
                paymentStatus: link.payment_status
            });
        });

        // Sort all activities by timestamp and return the most recent ones
        return activities
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit)
            .map((activity, index) => ({
                ...activity,
                id: index + 1 // Reassign simple numeric IDs
            }));

    } catch (error) {
        console.error('Error fetching recent activities:', error);
        return [];
    }
}

/**
 * Update sales person details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function updateSalesPerson(req, res) {
    try {
        const { id } = req.params;
        const updateData = req.body;

        console.log('Update request data:', updateData); // Debug log

        // Find the user first
        const user = await User.findOne({
            where: {
                id: id,
                role_name: {
                    [Op.in]: ['sales_role', 'sales_appointment_setter', 'support_agent']
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales person not found'
            });
        }

        // Map frontend field names to database field names
        const fieldMapping = {
            name: 'full_name',
            phone: 'mobile',
            role: 'role_name',
            email: 'email',
            status: 'status',
            password: 'password'
        };

        // Create the update object with mapped fields
        const dbUpdateData = {};
        
        for (const [key, value] of Object.entries(updateData)) {
            const dbField = fieldMapping[key];
            if (dbField) {
                if (key === 'password' && value) {
                    console.log('Hashing password for user:', id);
                    dbUpdateData[dbField] = await bcrypt.hash(value, 10);
                } else if (value !== undefined && value !== null && value !== '') {
                    dbUpdateData[dbField] = value;
                }
            }
        }

        // Check if there are any fields to update
        if (Object.keys(dbUpdateData).length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No changes detected',
                data: {
                    id: user.id,
                    name: user.full_name,
                    email: user.email,
                    phone: user.mobile,
                    role: user.role_name === 'sales_role' ? 'Sales Agent' : 
                          user.role_name === 'sales_appointment_setter' ? 'Appointment Setter' : user.role_name,
                    status: user.status,
                    workDuration: calculateWorkDuration(user.created_at)
                }
            });
        }

        // Map role display names to database values
        // if (dbUpdateData.role_name) {
        //     const roleMapping = {
        //         'Sales Agent': 'sales_role',
        //         'Appointment Setter': 'sales_appointment_setter'
        //     };
        //     dbUpdateData.role_name = roleMapping[dbUpdateData.role_name] || dbUpdateData.role_name;
        // }

        if (dbUpdateData.role_name) {
  const validRoles = [
    'sales_role',
    'sales_appointment_setter',
    'support_agent'
  ];

  if (!validRoles.includes(dbUpdateData.role_name)) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid role provided'
    });
  }

  // Sync flags
  dbUpdateData.is_sales_user =
    dbUpdateData.role_name === 'sales_role';

  dbUpdateData.is_appointment_setter =
    dbUpdateData.role_name === 'sales_appointment_setter';
}


        // Check if any values are actually different from current values (excluding password)
        let hasChanges = false;
        for (const [field, value] of Object.entries(dbUpdateData)) {
            if (field === 'password') {
                hasChanges = true;
                break;
            } else if (user[field] !== value) {
                hasChanges = true;
                break;
            }
        }

        if (!hasChanges) {
            return res.status(200).json({
                status: 'success',
                message: 'No changes detected',
                data: {
                    id: user.id,
                    name: user.full_name,
                    email: user.email,
                    phone: user.mobile,
                    role: user.role_name === 'sales_role' ? 'Sales Agent' : 
                          user.role_name === 'sales_appointment_setter' ? 'Appointment Setter' : user.role_name,
                    status: user.status,
                    workDuration: calculateWorkDuration(user.created_at)
                }
            });
        }

        console.log('Database update data:', dbUpdateData);

        // Perform the update
        const [updatedRows] = await User.update(dbUpdateData, {
            where: { id: id }
        });

        if (updatedRows === 0) {
            return res.status(200).json({
                status: 'warning',
                message: 'No changes were applied. The data might be identical to existing values.',
                data: {
                    id: user.id,
                    name: user.full_name,
                    email: user.email,
                    phone: user.mobile,
                    role: user.role_name === 'sales_role' ? 'Sales Agent' : 
                          user.role_name === 'sales_appointment_setter' ? 'Appointment Setter' : user.role_name,
                    status: user.status,
                    workDuration: calculateWorkDuration(user.created_at)
                }
            });
        }

        // Fetch the updated user
        const updatedUser = await User.findOne({
            where: { id },
            attributes: [
                'id',
                'full_name',
                'email',
                'mobile',
                'role_name',
                'created_at',
                'status'
            ]
        });

        // Map database role names to display names
        // const roleDisplay = {
        //     'sales_role': 'Sales Agent',
        //     'sales_appointment_setter': 'Appointment Setter'
        // };
        const roleDisplay = {
  sales_role: 'Sales Agent',
  sales_appointment_setter: 'Appointment Setter',
  support_agent: 'Support Agent'
};


        // Format the response
        const formattedUser = {
            id: updatedUser.id,
            name: updatedUser.full_name,
            email: updatedUser.email,
            phone: updatedUser.mobile,
            role: roleDisplay[updatedUser.role_name] || updatedUser.role_name,
            status: updatedUser.status,
            workDuration: calculateWorkDuration(updatedUser.created_at)
        };

        console.log('User updated successfully:', formattedUser);

        return res.status(200).json({
            status: 'success',
            message: 'Sales person updated successfully',
            data: formattedUser
        });

    } catch (error) {
        console.error('Error updating sales person:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating the sales person. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Delete a sales person
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function deleteSalesPerson(req, res) {
    try {
        const { id } = req.params;

        const user = await User.findOne({
            where: {
                id,
                role_name: {
                    [Op.in]: ['sales_role', 'sales_appointment_setter']
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Sales person not found'
            });
        }

        await user.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Sales person deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting sales person:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete sales person',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Calculate work duration from start date
 * @param {number} startDate - Unix timestamp in seconds
 * @returns {string} Formatted duration string
 */
function calculateWorkDuration(startDate) {
    const start = new Date(startDate * 1000);
    const now = new Date();
    
    const diffMonths = (now.getFullYear() - start.getFullYear()) * 12 + 
                      (now.getMonth() - start.getMonth());
    
    const years = Math.floor(diffMonths / 12);
    const months = diffMonths % 12;
    
    if (years > 0) {
        return `${years} year${years > 1 ? 's' : ''} ${months} month${months > 1 ? 's' : ''}`;
    }
    return `${months} month${months > 1 ? 's' : ''}`;
}

// Export other sales-related functions here as needed
async function getSalesMetrics(req, res) {
    try {
        // Implementation for getting overall sales metrics
        res.status(200).json({
            status: 'success',
            message: 'Sales metrics fetched successfully',
            data: {
                // Add metrics data here
            }
        });
    } catch (error) {
        console.error('Error fetching sales metrics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch sales metrics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Export all controller functions
module.exports = {
    getSalesPersons,
    getSalesMetrics,
    updateSalesPerson,
    deleteSalesPerson,
    getSalesPersonDetails,
    getSalesPersonPerformance
};