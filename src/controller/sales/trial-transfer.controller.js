// controller/sales/trial-transfer.controller.js
const User = require('../../models/users');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialStudentTransfer = require('../../models/TrialStudentTransfer');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const TrialTransferNotification = require('../../models/TrialTransferNotification');
const TrialTransferActivityLog = require('../../models/TrialTransferActivityLog');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const SubscriptionPlan = require('../../models/subscription_plan');
const Class = require('../../models/classes');
const PaymentTransaction = require('../../models/PaymentTransaction');
const { whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const moment = require('moment');
const crypto = require('crypto');


/**
 * Get transfers that are ready for sales management (accepted transfers)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTransfertoSell = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            search,
            start_date,
            end_date,
            sort_by = 'transfer_date',
            sort_order = 'desc'
        } = req.query;

        // Base where clause for accepted transfers only
        const whereClause = {
            transfer_status: 'transfer_accepted' // Only show accepted transfers
        };

        // Add search filter if provided
        if (search) {
            whereClause[Op.or] = [
                { student_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } }
            ];
        }

        // Add date filters if provided
        if (start_date && end_date) {
            whereClause.transfer_date = {
                [Op.between]: [
                    moment.utc(start_date).startOf('day').toISOString(),
                    moment.utc(end_date).endOf('day').toISOString()
                ]
            };
        }

        // Define include models for the query
        const includeModels = [
            {
                model: User,
                as: 'teacher',
                attributes: ['id', 'full_name', 'avatar']
            },
            {
                model: Class,
                as: 'trialClass',
                attributes: ['is_present', 'status']
            }
        ];

        // Perform the main query
        const { count, rows } = await TrialClassRegistration.findAndCountAll({
            where: whereClause,
            include: includeModels,
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
            order: [['transfer_date', sort_order.toUpperCase()]],
            distinct: true
        });

        // Format the data for the frontend
        const formattedTransfers = await Promise.all(rows.map(async (trial) => {
            const trialJson = trial.toJSON();
            
            // Get sales agent information
            let salesAgent = null;
            if (trialJson.transferred_to) {
                salesAgent = await User.findByPk(trialJson.transferred_to, {
                    attributes: ['id', 'full_name', 'email', 'avatar']
                });
            }
            
            // Get payment transactions for this student
            let paymentInfo = {
                amount: 0,
                currency: 'ILS',
                status: null,
                subscription_plan: null,
                transaction_date: null
            };
            
            if (trialJson.email || trialJson.student_name) {
                // Find payment transactions by email or student name
                const whereClause = {
                    status: 'success' // Only get successful payments
                };
                
                if (trialJson.email) {
                    whereClause.student_email = trialJson.email;
                } else if (trialJson.student_name) {
                    whereClause.student_name = trialJson.student_name;
                }
                
                const paymentTransaction = await PaymentTransaction.findOne({
                    where: whereClause,
                    include: [
                        {
                            model: SubscriptionPlan,
                            as: 'Plan',
                            attributes: ['id', 'name', 'price']
                        }
                    ],
                    order: [['created_at', 'DESC']], // Get the latest payment
                    attributes: ['id', 'amount', 'currency', 'status', 'created_at', 'plan_id', 'lessons_per_month', 'lesson_minutes']
                });
                
                if (paymentTransaction) {
                    paymentInfo = {
                        amount: parseFloat(paymentTransaction.amount) || 0,
                        currency: paymentTransaction.currency || 'ILS',
                        status: paymentTransaction.status,
                        subscription_plan: paymentTransaction.Plan ? paymentTransaction.Plan.name : "Custom Plan",
                        transaction_date: paymentTransaction.created_at,
                        plan_details: {
                            id: paymentTransaction.Plan ? paymentTransaction.Plan.id : null,
                            name: paymentTransaction.Plan ? paymentTransaction.Plan.name : 'Custom Plan',
                            price: paymentTransaction.Plan ? paymentTransaction.Plan.price : paymentTransaction.amount,
                            lessons_per_month: paymentTransaction.lessons_per_month || 0,
                            lesson_minutes: paymentTransaction.lesson_minutes || 0
                        }
                    };
                }
            }
            
            return {
                id: trialJson.id,
                trial_class: {
                    id: trialJson.id,
                    meeting_start: trialJson.meeting_start,
                    meeting_end: trialJson.meeting_end,
                    status: trialJson.trial_class_status,
                    teacher: {
                        id: trialJson.teacher?.id || null,
                        name: trialJson.teacher?.full_name || 'Unknown Teacher',
                        avatar: trialJson.teacher?.avatar || "/placeholder.svg?height=32&width=32"
                    }
                },
                sales_user: {
                    id: salesAgent?.id || trialJson.transferred_to,
                    full_name: salesAgent?.full_name || 'Unknown Sales Agent',
                    email: salesAgent?.email || '',
                    avatar: salesAgent?.avatar || "/placeholder.svg?height=32&width=32"
                },
                student: {
                    student_name: trialJson.student_name,
                    mobile: trialJson.mobile,
                    email: trialJson.email
                },
                transfer_date: trialJson.transfer_date,
                priority_level: 'Medium', // Default priority - can be enhanced later
                notes: trialJson.status_change_notes || '',
                payment_amount: paymentInfo.amount,
                payment_currency: paymentInfo.currency,
                payment_status: paymentInfo.status,
                payment_date: paymentInfo.transaction_date,
                subscription_plan: paymentInfo.subscription_plan || "Trial Package",
                plan_details: paymentInfo.plan_details
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                transfers: formattedTransfers,
                total: count,
                pages: Math.ceil(count / parseInt(limit)),
                currentPage: parseInt(page)
            }
        });

    } catch (error) {
        console.error('Error in getTransfertoSell:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Transfer a trial student from appointment setter to sales user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const transferTrialStudent = async (req, res) => {
    let transaction;

    try {
        // Start transaction
        transaction = await sequelize.transaction();

        const {
            trial_class_id,
            sales_user_id,
            priority_level = 'Medium',
            notes,
            follow_up_date
        } = req.body;

        // Validate required fields
        if (!trial_class_id || !sales_user_id) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Trial class ID and sales user ID are required'
            });
        }

        // Check if current user is an appointment setter
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || currentUser.role_name !== 'sales_appointment_setter') {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only appointment setters can transfer trial students'
            });
        }

        // Check if trial class exists and is completed
        const trialClass = await TrialClassRegistration.findByPk(trial_class_id, { 
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            transaction 
        });
        
        if (!trialClass) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }
        
        // Check if class is already transferred
        if (trialClass.transfer_status !== 'not_transferred' && trialClass.transfer_status !== 'transfer_rejected') {
            // Get the current sales person's information
            let currentSalesPerson = null;
            if (trialClass.transferred_to) {
                currentSalesPerson = await User.findByPk(trialClass.transferred_to, { 
                    attributes: ['id', 'full_name', 'email'],
                    transaction 
                });
            }

            if (transaction) await transaction.rollback();
            
            const salesPersonName = currentSalesPerson ? currentSalesPerson.full_name : 'another sales agent';
            return res.status(400).json({
                status: 'error',
                message: `Trial class is already transferred to ${salesPersonName}`
            });
        }

        // Check if sales user exists and is a sales user
        const salesUser = await User.findByPk(sales_user_id, { transaction });
        if (!salesUser || salesUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Sales user not found or is not a sales user'
            });
        }

        // Check if trial class is completed
        const now = moment();
        const classEnd = moment(trialClass.meeting_end);
        if (classEnd.isAfter(now)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot transfer a trial class that has not been completed yet'
            });
        }

        // Update trial class status
        await trialClass.update({
            transfer_status: 'transferred',
            transferred_to: sales_user_id,
            transfer_date: new Date()
        }, { transaction });

        // Create trial class status history entry
        await TrialClassStatusHistory.create({
            trial_class_id: trialClass.id,
            previous_status: trialClass.trial_class_status,
            new_status: 'waiting_for_answer',
            changed_by_id: req.user.id,
            changed_by_type: 'sales_appointment_setter',
            notes: `Transferred to sales user ID: ${sales_user_id}`,
            created_at: new Date()
        }, { transaction });

        // Create transfer record
        const transfer = await TrialStudentTransfer.create({
            trial_class_id,
            appointment_setter_id: req.user.id,
            sales_user_id,
            student_id: null, // No user account yet
            student_name: trialClass.student_name,
            student_email: trialClass.email,
            student_phone: trialClass.mobile,
            priority_level,
            transfer_status: 'pending',
            notes,
            follow_up_date: follow_up_date ? moment(follow_up_date).toDate() : null
        }, { transaction });

        // Create notification for sales user
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: sales_user_id,
            user_role: 'sales_user',
            notification_type: 'new_transfer',
            message: `New trial student transfer from ${currentUser.full_name}: ${trialClass.student_name}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'appointment_setter',
            activity_type: 'transfer_created',
            details: `Transferred trial student ${trialClass.student_name} to sales user ${salesUser.full_name}`
        }, { transaction });

        // Update appointment setter's transfer count
        await User.increment('trial_transfers_count', {
            by: 1,
            where: { id: req.user.id },
            transaction
        });

        // Commit transaction
        await transaction.commit();

        // Send notification to student after transaction is committed
        setTimeout(async () => {
            // Get complete transfer data for notifications
            const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
                include: [
                    {
                        model: User,
                        as: 'appointmentSetter',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: User,
                        as: 'salesUser',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: TrialClassRegistration,
                        as: 'trialClass',
                        include: [
                            {
                                model: User,
                                as: 'teacher',
                                attributes: ['id', 'full_name', 'email']
                            }
                        ]
                    }
                ]
            });

            // Send notification to student about the transfer
            // await sendTrialTransferNotifications('transfer_created', completeTransfer);
        }, 100);

        // Fetch complete transfer with associations for the response
        const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name', 'email', 'avatar']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                }
            ]
        });

        return res.status(201).json({
            status: 'success',
            message: `Trial student ${trialClass.student_name} has been successfully transferred to ${salesUser.full_name}`,
            data: completeTransfer
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get transfers initiated by the appointment setter
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getInitiatedTransfers = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            search,
            start_date,
            end_date,
            sort_by = 'transfer_date',
            sort_order = 'desc'
        } = req.query;

        // Validate the current user is an appointment setter
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || currentUser.role_name !== 'sales_appointment_setter') {
            return res.status(403).json({
                status: 'error',
                message: 'Only appointment setters can view their initiated transfers'
            });
        }

        // Build the where clause
        const whereClause = {
            appointment_setter_id: req.user.id
        };

        // Add status filter if provided
        if (status) {
            whereClause.transfer_status = status;
        }

        // Add date range filter if provided
        if (start_date && end_date) {
            whereClause.transfer_date = {
                [Op.between]: [
                    moment(start_date).startOf('day').toDate(),
                    moment(end_date).endOf('day').toDate()
                ]
            };
        }

        // Add search filter if provided
        if (search) {
            whereClause[Op.or] = [
                { student_name: { [Op.like]: `%${search}%` } },
                { student_email: { [Op.like]: `%${search}%` } },
                { student_phone: { [Op.like]: `%${search}%` } }
            ];
        }

        // Determine the order
        const order = [[sort_by, sort_order.toUpperCase()]];

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get transfers with pagination
        const { count, rows } = await TrialStudentTransfer.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                },
                {
                    model: TrialPaymentLink,
                    as: 'paymentLinks',
                    attributes: ['id', 'payment_status', 'amount', 'created_at'],
                    required: false
                }
            ],
            order,
            limit: parseInt(limit),
            offset
        });

        // Format response
        const formattedTransfers = rows.map(transfer => {
            const transferJson = transfer.toJSON();
            
            // Determine payment status for the transfer
            let paymentStatus = 'Not Started';
            let paymentAmount = null;
            
            if (transferJson.paymentLinks && transferJson.paymentLinks.length > 0) {
                const latestPayment = transferJson.paymentLinks.sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at))[0];
                
                paymentStatus = latestPayment.payment_status === 'paid' ? 'Paid' : 
                    latestPayment.payment_status === 'pending' ? 'Pending' : 'Failed';
                paymentAmount = latestPayment.amount;
            }

            return {
                id: transferJson.id,
                studentName: transferJson.student_name,
                studentEmail: transferJson.student_email,
                studentPhone: transferJson.student_phone,
                salesUser: transferJson.salesUser ? {
                    id: transferJson.salesUser.id,
                    name: transferJson.salesUser.full_name,
                    avatar: transferJson.salesUser.avatar
                } : null,
                priority: transferJson.priority_level,
                status: transferJson.transfer_status,
                transferDate: moment(transferJson.transfer_date).format('YYYY-MM-DD'),
                responseDate: transferJson.response_date ? moment(transferJson.response_date).format('YYYY-MM-DD') : null,
                trialClass: transferJson.trialClass ? {
                    id: transferJson.trialClass.id,
                    date: moment(transferJson.trialClass.meeting_start).format('YYYY-MM-DD HH:mm'),
                    teacherName: transferJson.trialClass.teacher ? transferJson.trialClass.teacher.full_name : 'Unknown',
                    attended: transferJson.trialClass.trialClass ? transferJson.trialClass.trialClass.is_present : null
                } : null,
                payment: {
                    status: paymentStatus,
                    amount: paymentAmount
                },
                notes: transferJson.notes,
                followUpDate: transferJson.follow_up_date ? moment(transferJson.follow_up_date).format('YYYY-MM-DD') : null,
                rejectionReason: transferJson.rejection_reason
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                transfers: formattedTransfers,
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getInitiatedTransfers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Reassign a transfer to a different sales user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const reassignTransfer = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { sales_user_id, notes } = req.body;

        // Validate input
        if (!id || !sales_user_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Transfer ID and new sales user ID are required'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if current user is an appointment setter
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || currentUser.role_name !== 'sales_appointment_setter') {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only appointment setters can reassign transfers'
            });
        }

        // Check if transfer exists and belongs to the current user
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id,
                appointment_setter_id: req.user.id
            },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass'
            }],
            transaction
        });

        if (!transfer) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Transfer not found or does not belong to you'
            });
        }

        // Check if transfer can be reassigned (rejected status)
        if (transfer.transfer_status !== 'rejected') {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Only rejected transfers can be reassigned'
            });
        }

        // Check if new sales user exists and is a sales user
        const salesUser = await User.findByPk(sales_user_id, { transaction });
        if (!salesUser || salesUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Sales user not found or is not a sales user'
            });
        }

        // Update trial class status
        if (transfer.trialClass) {
            await transfer.trialClass.update({
                transferred_to: sales_user_id,
                transfer_date: new Date()
            }, { transaction });

            // Create trial class status history entry
            await TrialClassStatusHistory.create({
                trial_class_id: transfer.trialClass.id,
                previous_status: transfer.trialClass.trial_class_status,
                new_status: 'waiting_for_answer',
                changed_by_id: req.user.id,
                changed_by_type: 'sales_appointment_setter',
                notes: `Reassigned to sales user ID: ${sales_user_id}`,
                created_at: new Date()
            }, { transaction });
        }

        // Update transfer record
        await transfer.update({
            sales_user_id,
            transfer_status: 'pending',
            notes: notes || transfer.notes,
            rejection_reason: null,
            response_date: null,
            transfer_date: new Date()
        }, { transaction });

        // Create notification for new sales user
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: sales_user_id,
            user_role: 'sales_user',
            notification_type: 'new_transfer',
            message: `New trial student transfer from ${currentUser.full_name}: ${transfer.student_name}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'appointment_setter',
            activity_type: 'transfer_reassigned',
            details: `Reassigned trial student ${transfer.student_name} to sales user ${salesUser.full_name}`
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Fetch complete transfer with associations
        const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name', 'email', 'avatar']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Transfer reassigned successfully',
            data: completeTransfer
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in reassignTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get transfers received by the sales user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getReceivedTransfers = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            search,
            start_date,
            end_date,
            sort_by = 'transfer_date',
            sort_order = 'desc'
        } = req.query;

        // Validate the current user is a sales user
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || currentUser.role_name !== 'sales_role') {
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users can view their received transfers'
            });
        }

        // Build the where clause
        const whereClause = {
            sales_user_id: req.user.id
        };

        // Add status filter if provided
        if (status) {
            whereClause.transfer_status = status;
        }

        // Add date range filter if provided
        if (start_date && end_date) {
            whereClause.transfer_date = {
                [Op.between]: [
                    moment(start_date).startOf('day').toDate(),
                    moment(end_date).endOf('day').toDate()
                ]
            };
        }

        // Add search filter if provided
        if (search) {
            whereClause[Op.or] = [
                { student_name: { [Op.like]: `%${search}%` } },
                { student_email: { [Op.like]: `%${search}%` } },
                { student_phone: { [Op.like]: `%${search}%` } }
            ];
        }

        // Determine the order
        const order = [[sort_by, sort_order.toUpperCase()]];

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get transfers with pagination
        const { count, rows } = await TrialStudentTransfer.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                },
                {
                    model: TrialPaymentLink,
                    as: 'paymentLinks',
                    attributes: ['id', 'payment_status', 'amount', 'created_at'],
                    required: false
                }
            ],
            order,
            limit: parseInt(limit),
            offset
        });

        // Format response
        const formattedTransfers = rows.map(transfer => {
            const transferJson = transfer.toJSON();
            
            // Determine payment status for the transfer
            let paymentStatus = 'Not Started';
            let paymentAmount = null;
            
            if (transferJson.paymentLinks && transferJson.paymentLinks.length > 0) {
                const latestPayment = transferJson.paymentLinks.sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at))[0];
                
                paymentStatus = latestPayment.payment_status === 'paid' ? 'Paid' : 
                    latestPayment.payment_status === 'pending' ? 'Pending' : 'Failed';
                paymentAmount = latestPayment.amount;
            }

            return {
                id: transferJson.id,
                studentName: transferJson.student_name,
                studentEmail: transferJson.student_email,
                studentPhone: transferJson.student_phone,
                appointmentSetter: transferJson.appointmentSetter ? {
                    id: transferJson.appointmentSetter.id,
                    name: transferJson.appointmentSetter.full_name,
                    avatar: transferJson.appointmentSetter.avatar
                } : null,
                priority: transferJson.priority_level,
                status: transferJson.transfer_status,
                transferDate: moment(transferJson.transfer_date).format('YYYY-MM-DD'),
                responseDate: transferJson.response_date ? moment(transferJson.response_date).format('YYYY-MM-DD') : null,
                trialClass: transferJson.trialClass ? {
                    id: transferJson.trialClass.id,
                    date: moment(transferJson.trialClass.meeting_start).format('YYYY-MM-DD HH:mm'),
                    teacherName: transferJson.trialClass.teacher ? transferJson.trialClass.teacher.full_name : 'Unknown',
                    attended: transferJson.trialClass.trialClass ? transferJson.trialClass.trialClass.is_present : null
                } : null,
                payment: {
                    status: paymentStatus,
                    amount: paymentAmount
                },
                notes: transferJson.notes,
                followUpDate: transferJson.follow_up_date ? moment(transferJson.follow_up_date).format('YYYY-MM-DD') : null
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                transfers: formattedTransfers,
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getReceivedTransfers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Send notifications for trial transfer actions
 * @param {string} templateName - The notification template name
 * @param {Object} trialTransfer - Transfer data with associations
 * @param {Object} additionalData - Additional data for notifications
 * @returns {Promise<boolean>} - Success status
 */
async function sendTrialTransferNotifications(templateName, trialTransfer, additionalData = {}) {
    try {
        // Get trial class data
        const trialClass = trialTransfer.trialClass;
        
        if (!trialClass) {
            console.error('Cannot send notifications: Trial class data missing');
            return false;
        }
        
        // Get related users
        const salesUser = trialTransfer.salesUser;
        const teacher = trialClass.teacher;
        
        // Format class date
        const classDate = moment(trialClass.meeting_start).format('YYYY-MM-DD HH:mm');
        
        // Build notification parameters
        const notifyParams = {
            'student.name': trialTransfer.student_name,
            'class.date': classDate,
            'teacher.name': teacher ? teacher.full_name : 'your teacher',
            'sales.name': salesUser ? salesUser.full_name : 'our sales representative'
        };
        
        // Add any additional parameters
        Object.assign(notifyParams, additionalData);
        
        // Prepare student details for the notification
        const studentDetails = {
            mobile: trialTransfer.student_phone,
            email: trialTransfer.student_email,
            full_name: trialTransfer.student_name,
            country_code: trialClass.country_code || '+972', // Default to Israel code if missing
            language: trialClass.language || 'EN' // Default to English if language not specified
        };
        
        // Send the notification (function handles both email and WhatsApp)
        const sent = await whatsappReminderTrailClass(
            templateName,
            notifyParams,
            studentDetails
        );
        
        return sent;
    } catch (error) {
        console.error(`Error sending ${templateName} notification:`, error);
        return false;
    }
}

/**
 * Accept a trial student transfer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const acceptTransfer = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if current user is a sales user
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || currentUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users can accept transfers'
            });
        }

        // Check if transfer exists and belongs to the current user
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id,
                sales_user_id: req.user.id
            },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass',
                include: [
                    {
                        model: User,
                        as: 'teacher',
                        attributes: ['id', 'full_name', 'email']
                    }
                ]
            }, {
                model: User,
                as: 'appointmentSetter',
                attributes: ['id', 'full_name', 'email']
            }, {
                model: User,
                as: 'salesUser',
                attributes: ['id', 'full_name', 'email']
            }],
            transaction
        });

        if (!transfer) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Transfer not found or does not belong to you'
            });
        }

        // Check if transfer is pending
        if (transfer.transfer_status !== 'pending') {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Only pending transfers can be accepted'
            });
        }

        // Update transfer status
        await transfer.update({
            transfer_status: 'accepted',
            response_date: new Date()
        }, { transaction });

        // Update trial class status
        if (transfer.trialClass) {
            await transfer.trialClass.update({
                transfer_status: 'transfer_accepted',
                trial_class_status: 'new_enroll' // Set to new_enroll when accepted
            }, { transaction });

            // Create trial class status history entry
            await TrialClassStatusHistory.create({
                trial_class_id: transfer.trialClass.id,
                previous_status: transfer.trialClass.trial_class_status,
                new_status: 'new_enroll',
                changed_by_id: req.user.id,
                changed_by_type: 'sales_role',
                notes: `Transfer accepted by sales user ID: ${req.user.id}`,
                created_at: new Date()
            }, { transaction });
        }

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'transfer_accepted',
            message: `${currentUser.full_name} has accepted your transfer of ${transfer.student_name}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'sales_user',
            activity_type: 'transfer_accepted',
            details: `Accepted transfer of trial student ${transfer.student_name} from appointment setter ${transfer.appointmentSetter.full_name}`
        }, { transaction });

        // Update sales user's accepted transfer count
        await User.increment('accepted_trial_transfers_count', {
            by: 1,
            where: { id: req.user.id },
            transaction
        });

        // Commit transaction
        await transaction.commit();

        // Send notifications after transaction is committed
        // We do this outside the transaction to prevent blocking the API response
        // and to ensure the DB is in a consistent state first
        setTimeout(async () => {
            // Get complete transfer data for notifications
            const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
                include: [
                    {
                        model: User,
                        as: 'appointmentSetter',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: User,
                        as: 'salesUser',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: TrialClassRegistration,
                        as: 'trialClass',
                        include: [
                            {
                                model: User,
                                as: 'teacher',
                                attributes: ['id', 'full_name', 'email']
                            }
                        ]
                    }
                ]
            });

            // Send notifications to student
            // await sendTrialTransferNotifications('transfer_accepted', completeTransfer);
        }, 100);

        // Fetch complete transfer with associations for the response
        const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name', 'email', 'avatar']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Transfer accepted successfully',
            data: completeTransfer
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in acceptTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Reject a trial student transfer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const rejectTransfer = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { rejection_reason } = req.body;

        // Validate input
        if (!id || !rejection_reason) {
            return res.status(400).json({
                status: 'error',
                message: 'Transfer ID and rejection reason are required'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if current user is a sales user
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || currentUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users can reject transfers'
            });
        }

        // Check if transfer exists and belongs to the current user
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id,
                sales_user_id: req.user.id
            },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass',
                include: [
                    {
                        model: User,
                        as: 'teacher',
                        attributes: ['id', 'full_name', 'email']
                    }
                ]
            }, {
                model: User,
                as: 'appointmentSetter',
                attributes: ['id', 'full_name', 'email']
            }, {
                model: User,
                as: 'salesUser',
                attributes: ['id', 'full_name', 'email']
            }],
            transaction
        });

        if (!transfer) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Transfer not found or does not belong to you'
            });
        }

        // Check if transfer is pending
        if (transfer.transfer_status !== 'pending') {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Only pending transfers can be rejected'
            });
        }

        // Update transfer status
        await transfer.update({
            transfer_status: 'rejected',
            rejection_reason,
            response_date: new Date()
        }, { transaction });

        // Update trial class status
        if (transfer.trialClass) {
            await transfer.trialClass.update({
                transfer_status: 'transfer_rejected'
            }, { transaction });

            // Create trial class status history entry
            await TrialClassStatusHistory.create({
                trial_class_id: transfer.trialClass.id,
                previous_status: transfer.trialClass.trial_class_status,
                new_status: transfer.trialClass.trial_class_status, // Keep the same status
                changed_by_id: req.user.id,
                changed_by_type: 'sales_role',
                notes: `Transfer rejected by sales user ID: ${req.user.id}. Reason: ${rejection_reason}`,
                created_at: new Date()
            }, { transaction });
        }

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'transfer_rejected',
            message: `${currentUser.full_name} has rejected your transfer of ${transfer.student_name}. Reason: ${rejection_reason}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'sales_user',
            activity_type: 'transfer_rejected',
            details: `Rejected transfer of trial student ${transfer.student_name} from appointment setter ${transfer.appointmentSetter.full_name}. Reason: ${rejection_reason}`
        }, { transaction });

        // Update sales user's rejected transfer count
        await User.increment('rejected_trial_transfers_count', {
            by: 1,
            where: { id: req.user.id },
            transaction
        });

        // Commit transaction
        await transaction.commit();

        // Send notifications after transaction is committed
        setTimeout(async () => {
            // Get complete transfer data for notifications
            const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
                include: [
                    {
                        model: User,
                        as: 'appointmentSetter',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: User,
                        as: 'salesUser',
                        attributes: ['id', 'full_name', 'email']
                    },
                    {
                        model: TrialClassRegistration,
                        as: 'trialClass',
                        include: [
                            {
                                model: User,
                                as: 'teacher',
                                attributes: ['id', 'full_name', 'email']
                            }
                        ]
                    }
                ]
            });

            // We still notify the student but with a gentler message
            // await sendTrialTransferNotifications('transfer_rejected', completeTransfer);
        }, 100);

        // Fetch complete transfer with associations for the response
        const completeTransfer = await TrialStudentTransfer.findByPk(transfer.id, {
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name', 'email', 'avatar']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status']
                        }
                    ]
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: `Student transfer for ${transfer.student_name} has been declined`,
            data: completeTransfer
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in rejectTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a payment link for a trial student
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createPaymentLink = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const {
            subscription_plan_id,
            amount,
            currency = 'ILS',
            expiry_days = 7,
            email_notification = true,
            whatsapp_notification = true
        } = req.body;

        // Validate input
        if (!id || !amount) {
            return res.status(400).json({
                status: 'error',
                message: 'Transfer ID and amount are required'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if current user is a sales user
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || currentUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users can create payment links'
            });
        }

        // Check if transfer exists, is accepted, and belongs to the current user
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id,
                sales_user_id: req.user.id,
                transfer_status: 'accepted'
            },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass'
            }, {
                model: User,
                as: 'appointmentSetter',
                attributes: ['id', 'full_name', 'email']
            }],
            transaction
        });

        if (!transfer) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Transfer not found, not accepted, or does not belong to you'
            });
        }

        // Check if subscription plan exists if provided
        let subscriptionPlan = null;
        if (subscription_plan_id) {
            subscriptionPlan = await SubscriptionPlan.findByPk(subscription_plan_id, { transaction });
            if (!subscriptionPlan) {
                if (transaction) await transaction.rollback();
                return res.status(404).json({
                    status: 'error',
                    message: 'Subscription plan not found'
                });
            }
        }

        // Generate a unique token for the payment link
        const token = crypto.randomBytes(16).toString('hex');
        const expiryDate = moment().add(expiry_days, 'days').toDate();

        // Create payment link
        const paymentLink = await TrialPaymentLink.create({
            transfer_id: transfer.id,
            sales_user_id: req.user.id,
            subscription_plan_id: subscription_plan_id || null,
            amount,
            currency,
            link_token: token,
            payment_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/${token}`,
            payment_status: 'pending',
            sent_via_email: email_notification,
            sent_via_whatsapp: whatsapp_notification,
            email_sent_at: email_notification ? new Date() : null,
            whatsapp_sent_at: whatsapp_notification ? new Date() : null,
            expiry_date: expiryDate
        }, { transaction });

        // Update trial class status if exists
        if (transfer.trialClass) {
            await transfer.trialClass.update({
                trial_class_status: 'payment_sent'
            }, { transaction });

            // Create trial class status history entry
            await TrialClassStatusHistory.create({
                trial_class_id: transfer.trialClass.id,
                previous_status: transfer.trialClass.trial_class_status,
                new_status: 'payment_sent',
                changed_by_id: req.user.id,
                changed_by_type: 'sales_role',
                notes: `Payment link generated by sales user ID: ${req.user.id}. Amount: ${amount} ${currency}`,
                created_at: new Date()
            }, { transaction });
        }

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'payment_link_sent',
            message: `${currentUser.full_name} has sent a payment link of ${amount} ${currency} to ${transfer.student_name}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'sales_user',
            activity_type: 'payment_link_created',
            details: `Created payment link for trial student ${transfer.student_name}. Amount: ${amount} ${currency}${subscription_plan_id ? `. Subscription Plan ID: ${subscription_plan_id}` : ''}`
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // TODO: Add actual email and WhatsApp notification logic here
        // This would involve your notification service or third-party services

        // Fetch complete payment link with associations
        const completePaymentLink = await TrialPaymentLink.findByPk(paymentLink.id, {
            include: [
                {
                    model: TrialStudentTransfer,
                    as: 'transfer',
                    include: [
                        {
                            model: User,
                            as: 'appointmentSetter',
                            attributes: ['id', 'full_name', 'email']
                        },
                        {
                            model: User,
                            as: 'salesUser',
                            attributes: ['id', 'full_name', 'email']
                        }
                    ]
                },
                {
                    model: SubscriptionPlan,
                    as: 'subscriptionPlan'
                }
            ]
        });

        return res.status(201).json({
            status: 'success',
            message: 'Payment link created successfully',
            data: completePaymentLink
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in createPaymentLink:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific transfer by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTransferById = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate input
        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Transfer ID is required'
            });
        }

        // Check if current user is a sales user or appointment setter
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['sales_role', 'sales_appointment_setter'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users or appointment setters can view transfers'
            });
        }

        // Build the where clause based on user role
        const whereClause = { id };
        if (currentUser.role_name === 'sales_role') {
            whereClause.sales_user_id = req.user.id;
        } else if (currentUser.role_name === 'sales_appointment_setter') {
            whereClause.appointment_setter_id = req.user.id;
        }

        // Get transfer with associations
        const transfer = await TrialStudentTransfer.findOne({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'appointmentSetter',
                    attributes: ['id', 'full_name', 'email', 'avatar', 'mobile']
                },
                {
                    model: User,
                    as: 'salesUser',
                    attributes: ['id', 'full_name', 'email', 'avatar', 'mobile']
                },
                {
                    model: TrialClassRegistration,
                    as: 'trialClass',
                    include: [
                        {
                            model: User,
                            as: 'teacher',
                            attributes: ['id', 'full_name', 'email', 'avatar']
                        },
                        {
                            model: Class,
                            as: 'trialClass',
                            attributes: ['id', 'is_present', 'status', 'student_goal']
                        }
                    ]
                },
                {
                    model: TrialPaymentLink,
                    as: 'paymentLinks',
                    include: [
                        {
                            model: SubscriptionPlan,
                            as: 'subscriptionPlan',
                            attributes: ['id', 'name', 'price']
                        }
                    ]
                },
                {
                    model: TrialTransferActivityLog,
                    as: 'activityLogs',
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'full_name', 'role_name']
                        }
                    ]
                }
            ]
        });

        if (!transfer) {
            return res.status(404).json({
                status: 'error',
                message: 'Transfer not found or you do not have permission to view it'
            });
        }

        // Get the latest payment link if any
        let paymentInfo = null;
        if (transfer.paymentLinks && transfer.paymentLinks.length > 0) {
            const latestPayment = transfer.paymentLinks.sort((a, b) => 
                new Date(b.created_at) - new Date(a.created_at))[0];
            
            paymentInfo = {
                id: latestPayment.id,
                amount: latestPayment.amount,
                currency: latestPayment.currency,
                status: latestPayment.payment_status,
                createdAt: moment(latestPayment.created_at).format('YYYY-MM-DD HH:mm'),
                expiryDate: moment(latestPayment.expiry_date).format('YYYY-MM-DD HH:mm'),
                paymentUrl: latestPayment.payment_url,
                sentViaEmail: latestPayment.sent_via_email,
                sentViaWhatsapp: latestPayment.sent_via_whatsapp,
                subscriptionPlan: latestPayment.subscriptionPlan ? {
                    id: latestPayment.subscriptionPlan.id,
                    name: latestPayment.subscriptionPlan.name,
                    price: latestPayment.subscriptionPlan.price
                } : null
            };
        }

        // Format response
        const formattedTransfer = {
            id: transfer.id,
            student: {
                name: transfer.student_name,
                email: transfer.student_email,
                phone: transfer.student_phone
            },
            appointmentSetter: transfer.appointmentSetter ? {
                id: transfer.appointmentSetter.id,
                name: transfer.appointmentSetter.full_name,
                email: transfer.appointmentSetter.email,
                avatar: transfer.appointmentSetter.avatar,
                phone: transfer.appointmentSetter.mobile
            } : null,
            salesUser: transfer.salesUser ? {
                id: transfer.salesUser.id,
                name: transfer.salesUser.full_name,
                email: transfer.salesUser.email,
                avatar: transfer.salesUser.avatar,
                phone: transfer.salesUser.mobile
            } : null,
            priority: transfer.priority_level,
            status: transfer.transfer_status,
            transferDate: moment(transfer.transfer_date).format('YYYY-MM-DD HH:mm'),
            responseDate: transfer.response_date ? moment(transfer.response_date).format('YYYY-MM-DD HH:mm') : null,
            trialClass: transfer.trialClass ? {
                id: transfer.trialClass.id,
                date: moment(transfer.trialClass.meeting_start).format('YYYY-MM-DD HH:mm'),
                teacherName: transfer.trialClass.teacher ? transfer.trialClass.teacher.full_name : 'Unknown',
                attended: transfer.trialClass.trialClass ? 
                    transfer.trialClass.trialClass.is_present === true ? 'Yes' : 
                    transfer.trialClass.trialClass.is_present === false ? 'No' : 
                    transfer.trialClass.trialClass.is_present === 3 ? 'Late' : 'Unknown' : 'Unknown',
                status: transfer.trialClass.status,
                goal: transfer.trialClass.trialClass ? transfer.trialClass.trialClass.student_goal : null
            } : null,
            payment: paymentInfo,
            notes: transfer.notes,
            followUpDate: transfer.follow_up_date ? moment(transfer.follow_up_date).format('YYYY-MM-DD') : null,
            rejectionReason: transfer.rejection_reason,
            activity: transfer.activityLogs ? transfer.activityLogs.map(log => ({
                id: log.id,
                type: log.activity_type,
                details: log.details,
                date: moment(log.created_at).format('YYYY-MM-DD HH:mm'),
                user: log.user ? {
                    id: log.user.id,
                    name: log.user.full_name,
                    role: log.user.role_name
                } : null
            })).sort((a, b) => new Date(b.date) - new Date(a.date)) : []
        };

        return res.status(200).json({
            status: 'success',
            data: formattedTransfer
        });

    } catch (error) {
        console.error('Error in getTransferById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get notifications for the current user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getNotifications = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            is_read,
            type
        } = req.query;

        // Check if current user is a sales user or appointment setter
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['sales_role', 'sales_appointment_setter'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users or appointment setters can view notifications'
            });
        }

        // Build the where clause
        const whereClause = {
            user_id: req.user.id,
            user_role: currentUser.role_name === 'sales_role' ? 'sales_user' : 'appointment_setter'
        };

        // Add read filter if provided
        if (is_read !== undefined) {
            whereClause.is_read = is_read === 'true' || is_read === '1';
        }

        // Add type filter if provided
        if (type) {
            whereClause.notification_type = type;
        }

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get notifications with pagination
        const { count, rows } = await TrialTransferNotification.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: TrialStudentTransfer,
                    as: 'transfer',
                    attributes: ['id', 'student_name', 'student_email', 'transfer_date', 'transfer_status']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        // Format notifications
        const formattedNotifications = rows.map(notification => ({
            id: notification.id,
            type: notification.notification_type,
            message: notification.message,
            isRead: notification.is_read,
            readAt: notification.read_at ? moment(notification.read_at).format('YYYY-MM-DD HH:mm') : null,
            date: moment(notification.created_at).format('YYYY-MM-DD HH:mm'),
            transfer: notification.transfer ? {
                id: notification.transfer.id,
                studentName: notification.transfer.student_name,
                status: notification.transfer.transfer_status,
                transferDate: moment(notification.transfer.transfer_date).format('YYYY-MM-DD')
            } : null
        }));

        // Get unread count
        const unreadCount = await TrialTransferNotification.count({
            where: {
                user_id: req.user.id,
                user_role: currentUser.role_name === 'sales_role' ? 'sales_user' : 'appointment_setter',
                is_read: false
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                notifications: formattedNotifications,
                total: count,
                unreadCount,
                page: parseInt(page),
                pages: Math.ceil(count / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getNotifications:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Mark a notification as read
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const markNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate input
        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Notification ID is required'
            });
        }

        // Check if current user is a sales user or appointment setter
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['sales_role', 'sales_appointment_setter'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only sales users or appointment setters can mark notifications as read'
            });
        }

        // Find notification
        const notification = await TrialTransferNotification.findOne({
            where: {
                id,
                user_id: req.user.id,
                user_role: currentUser.role_name === 'sales_role' ? 'sales_user' : 'appointment_setter'
            }
        });

        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found or does not belong to you'
            });
        }

        // Update notification
        await notification.update({
            is_read: true,
            read_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification marked as read',
            data: {
                id: notification.id,
                isRead: true,
                readAt: moment(notification.read_at).format('YYYY-MM-DD HH:mm')
            }
        });

    } catch (error) {
        console.error('Error in markNotificationRead:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getTransfertoSell,
    transferTrialStudent,
    getInitiatedTransfers,
    reassignTransfer,
    getReceivedTransfers,
    acceptTransfer,
    rejectTransfer,
    createPaymentLink,
    getTransferById,
    getNotifications,
    markNotificationRead
};