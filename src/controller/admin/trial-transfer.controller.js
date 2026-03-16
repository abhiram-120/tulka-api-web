// controller/admin/trial-transfer.controller.js
const User = require('../../models/users');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialStudentTransfer = require('../../models/TrialStudentTransfer');
const TrialPaymentLink = require('../../models/TrialPaymentLink');
const TrialTransferNotification = require('../../models/TrialTransferNotification');
const TrialTransferActivityLog = require('../../models/TrialTransferActivityLog');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const SubscriptionPlan = require('../../models/subscription_plan');
const Class = require('../../models/classes');
const { whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const moment = require('moment');

/**
 * Get all transfers in the system
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllTransfers = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            search,
            start_date,
            end_date,
            appointment_setter_id,
            sales_user_id,
            sort_by = 'transfer_date',
            sort_order = 'desc'
        } = req.query;

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can view all transfers'
            });
        }

        // Build the where clause
        const whereClause = {};

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

        // Add appointment setter filter if provided
        if (appointment_setter_id) {
            whereClause.appointment_setter_id = appointment_setter_id;
        }

        // Add sales user filter if provided
        if (sales_user_id) {
            whereClause.sales_user_id = sales_user_id;
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
                            attributes: ['id', 'is_present', 'status', 'student_goal']
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
                    attended: transferJson.trialClass.trialClass ? 
                        transferJson.trialClass.trialClass.is_present === true ? 'Yes' : 
                        transferJson.trialClass.trialClass.is_present === false ? 'No' : 
                        transferJson.trialClass.trialClass.is_present === 3 ? 'Late' : 'Unknown' : 'Unknown',
                    goal: transferJson.trialClass.trialClass ? transferJson.trialClass.trialClass.student_goal : null
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
        console.error('Error in getAllTransfers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific transfer by ID (admin version)
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

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can view transfer details'
            });
        }

        // Get transfer with associations
        const transfer = await TrialStudentTransfer.findByPk(id, {
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
                message: 'Transfer not found'
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
 * 
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
        console.error(`Error sending ${templateName} notification from admin:`, error);
        return false;
    }
}

/**
 * Accept a transfer on behalf of a sales user (admin action)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const acceptTransfer = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;

        // Start transaction
        transaction = await sequelize.transaction();

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can accept transfers on behalf of sales users'
            });
        }

        // Check if transfer exists
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id
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
                message: 'Transfer not found'
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
                changed_by_type: 'admin',
                notes: `Transfer accepted by admin: ${req.user.id} on behalf of sales user: ${transfer.sales_user_id}`,
                created_at: new Date()
            }, { transaction });
        }

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'transfer_accepted',
            message: `Admin ${currentUser.full_name} has accepted your transfer of ${transfer.student_name} on behalf of ${transfer.salesUser?.full_name || 'the sales user'}`,
            is_read: false
        }, { transaction });

        // Create notification for sales user
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.sales_user_id,
            user_role: 'sales_user',
            notification_type: 'admin_accepted_transfer',
            message: `Admin ${currentUser.full_name} has accepted the transfer of ${transfer.student_name} on your behalf`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'admin',
            activity_type: 'admin_accepted_transfer',
            details: `Admin accepted transfer of trial student ${transfer.student_name} from appointment setter ${transfer.appointmentSetter?.full_name || 'unknown'} on behalf of sales user ${transfer.salesUser?.full_name || 'unknown'}`
        }, { transaction });

        // Update sales user's accepted transfer count (even though they didn't do it themselves)
        if (transfer.sales_user_id) {
            await User.increment('accepted_trial_transfers_count', {
                by: 1,
                where: { id: transfer.sales_user_id },
                transaction
            });
        }

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

            // Send notification to student
            await sendTrialTransferNotifications('transfer_accepted', completeTransfer);
        }, 100);

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
            message: 'Transfer accepted successfully by admin',
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

        console.error('Error in admin acceptTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Reject a transfer on behalf of a sales user (admin action)
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

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can reject transfers on behalf of sales users'
            });
        }

        // Check if transfer exists
        const transfer = await TrialStudentTransfer.findOne({
            where: {
                id
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
                message: 'Transfer not found'
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
            rejection_reason: `[Admin: ${currentUser.full_name}] ${rejection_reason}`,
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
                changed_by_type: 'admin',
                notes: `Transfer rejected by admin ID: ${req.user.id} on behalf of sales user ID: ${transfer.sales_user_id}. Reason: ${rejection_reason}`,
                created_at: new Date()
            }, { transaction });
        }

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'transfer_rejected',
            message: `Admin ${currentUser.full_name} has rejected your transfer of ${transfer.student_name} on behalf of ${transfer.salesUser?.full_name || 'the sales user'}. Reason: ${rejection_reason}`,
            is_read: false
        }, { transaction });

        // Create notification for sales user
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.sales_user_id,
            user_role: 'sales_user',
            notification_type: 'admin_rejected_transfer',
            message: `Admin ${currentUser.full_name} has rejected the transfer of ${transfer.student_name} on your behalf. Reason: ${rejection_reason}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'admin',
            activity_type: 'admin_rejected_transfer',
            details: `Admin rejected transfer of trial student ${transfer.student_name} from appointment setter ${transfer.appointmentSetter?.full_name || 'unknown'} on behalf of sales user ${transfer.salesUser?.full_name || 'unknown'}. Reason: ${rejection_reason}`
        }, { transaction });

        // Update sales user's rejected transfer count (even though they didn't do it themselves)
        if (transfer.sales_user_id) {
            await User.increment('rejected_trial_transfers_count', {
                by: 1,
                where: { id: transfer.sales_user_id },
                transaction
            });
        }

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

            // Send notification to student with a gentler message
            await sendTrialTransferNotifications('transfer_rejected', completeTransfer);
        }, 100);

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
            message: 'Transfer rejected successfully by admin',
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

        console.error('Error in admin rejectTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Reassign a transfer to a different sales user (admin only)
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

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id, { transaction });
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            if (transaction) await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can reassign transfers'
            });
        }

        // Check if transfer exists
        const transfer = await TrialStudentTransfer.findOne({
            where: { id },
            include: [{
                model: TrialClassRegistration,
                as: 'trialClass'
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
                message: 'Transfer not found'
            });
        }

        // Check if old and new sales users are different
        if (transfer.sales_user_id === sales_user_id) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'New sales user is the same as the current one'
            });
        }

        // Check if new sales user exists and is a sales user
        const newSalesUser = await User.findByPk(sales_user_id, { transaction });
        if (!newSalesUser || newSalesUser.role_name !== 'sales_role') {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'New sales user not found or is not a sales user'
            });
        }

        const oldSalesUserId = transfer.sales_user_id;
        const oldSalesUser = transfer.salesUser;

        // Update trial class status
        if (transfer.trialClass) {
            await transfer.trialClass.update({
                transferred_to: sales_user_id
            }, { transaction });

            // Create trial class status history entry
            await TrialClassStatusHistory.create({
                trial_class_id: transfer.trialClass.id,
                previous_status: transfer.trialClass.trial_class_status,
                new_status: transfer.trialClass.trial_class_status, // Status stays the same
                changed_by_id: req.user.id,
                changed_by_type: 'admin',
                notes: `Transfer reassigned by admin ID: ${req.user.id}. From sales user ID: ${oldSalesUserId} to sales user ID: ${sales_user_id}`,
                created_at: new Date()
            }, { transaction });
        }

        // Update transfer record
        await transfer.update({
            sales_user_id,
            transfer_status: 'pending', // Reset to pending for the new sales user
            notes: notes ? `[Admin reassigned] ${notes}` : transfer.notes,
            rejection_reason: null,
            response_date: null
        }, { transaction });

        // Create notification for old sales user (if exists)
        if (oldSalesUserId) {
            await TrialTransferNotification.create({
                transfer_id: transfer.id,
                user_id: oldSalesUserId,
                user_role: 'sales_user',
                notification_type: 'transfer_reassigned',
                message: `Admin ${currentUser.full_name} has reassigned the transfer of ${transfer.student_name} from you to ${newSalesUser.full_name}`,
                is_read: false
            }, { transaction });
        }

        // Create notification for new sales user
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: sales_user_id,
            user_role: 'sales_user',
            notification_type: 'new_transfer',
            message: `Admin ${currentUser.full_name} has assigned you a transfer of ${transfer.student_name} ${oldSalesUserId ? `(previously assigned to ${oldSalesUser?.full_name || 'another sales user'})` : ''}`,
            is_read: false
        }, { transaction });

        // Create notification for appointment setter
        await TrialTransferNotification.create({
            transfer_id: transfer.id,
            user_id: transfer.appointment_setter_id,
            user_role: 'appointment_setter',
            notification_type: 'transfer_reassigned',
            message: `Admin ${currentUser.full_name} has reassigned your transfer of ${transfer.student_name} from ${oldSalesUser?.full_name || 'previous sales user'} to ${newSalesUser.full_name}`,
            is_read: false
        }, { transaction });

        // Create activity log entry
        await TrialTransferActivityLog.create({
            transfer_id: transfer.id,
            user_id: req.user.id,
            user_role: 'admin',
            activity_type: 'admin_reassigned_transfer',
            details: `Admin reassigned transfer of trial student ${transfer.student_name} from sales user ${oldSalesUser?.full_name || 'unknown'} to sales user ${newSalesUser.full_name}`
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
            message: 'Transfer reassigned successfully by admin',
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

        console.error('Error in admin reassignTransfer:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get transfer statistics for admin dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTransferStats = async (req, res) => {
    try {
        // Extract query parameters
        const { 
            start_date, 
            end_date,
            appointment_setter_id,
            sales_user_id
        } = req.query;

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can access transfer statistics'
            });
        }

        // Set default date range to current month if not provided
        const startDate = start_date ? 
            moment(start_date).startOf('day').toDate() : 
            moment().startOf('month').toDate();
        
        const endDate = end_date ? 
            moment(end_date).endOf('day').toDate() : 
            moment().endOf('month').toDate();

        // Base where clause for date range
        const baseWhereClause = {
            transfer_date: {
                [Op.between]: [startDate, endDate]
            }
        };

        // Add appointment setter filter if provided
        if (appointment_setter_id) {
            baseWhereClause.appointment_setter_id = appointment_setter_id;
        }

        // Add sales user filter if provided
        if (sales_user_id) {
            baseWhereClause.sales_user_id = sales_user_id;
        }

        // Get total transfers count
        const totalTransfers = await TrialStudentTransfer.count({
            where: baseWhereClause
        });

        // Get transfers by status
        const pendingTransfers = await TrialStudentTransfer.count({
            where: {
                ...baseWhereClause,
                transfer_status: 'pending'
            }
        });

        const acceptedTransfers = await TrialStudentTransfer.count({
            where: {
                ...baseWhereClause,
                transfer_status: 'accepted'
            }
        });

        const rejectedTransfers = await TrialStudentTransfer.count({
            where: {
                ...baseWhereClause,
                transfer_status: 'rejected'
            }
        });

        // Get conversion rate (payments after acceptance)
        const transfersWithPayment = await TrialStudentTransfer.count({
            where: {
                ...baseWhereClause,
                transfer_status: 'accepted'
            },
            include: [{
                model: TrialPaymentLink,
                as: 'paymentLinks',
                where: {
                    payment_status: 'paid'
                },
                required: true
            }]
        });

        const conversionRate = acceptedTransfers > 0 ? 
            (transfersWithPayment / acceptedTransfers) * 100 : 0;

        // Get average response time (from transfer to accept/reject)
        const transfersWithResponse = await TrialStudentTransfer.findAll({
            where: {
                ...baseWhereClause,
                response_date: { [Op.not]: null }
            },
            attributes: [
                'transfer_date',
                'response_date'
            ]
        });

        let totalResponseTimeHours = 0;
        transfersWithResponse.forEach(transfer => {
            const transferDate = moment(transfer.transfer_date);
            const responseDate = moment(transfer.response_date);
            const diffHours = responseDate.diff(transferDate, 'hours', true);
            totalResponseTimeHours += diffHours;
        });

        const avgResponseTimeHours = transfersWithResponse.length > 0 ? 
            totalResponseTimeHours / transfersWithResponse.length : 0;

        // Get stats by appointment setter
        const statsByAppointmentSetter = await TrialStudentTransfer.findAll({
            where: baseWhereClause,
            attributes: [
                'appointment_setter_id',
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_transfers'],
                [sequelize.fn('SUM', sequelize.literal('CASE WHEN transfer_status = \'accepted\' THEN 1 ELSE 0 END')), 'accepted_transfers'],
                [sequelize.fn('SUM', sequelize.literal('CASE WHEN transfer_status = \'rejected\' THEN 1 ELSE 0 END')), 'rejected_transfers']
            ],
            include: [{
                model: User,
                as: 'appointmentSetter',
                attributes: ['id', 'full_name'],
                required: true
            }],
            group: ['appointment_setter_id', 'appointmentSetter.id', 'appointmentSetter.full_name']
        });

        // Get stats by sales user
        const statsBySalesUser = await TrialStudentTransfer.findAll({
            where: baseWhereClause,
            attributes: [
                'sales_user_id',
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_transfers'],
                [sequelize.fn('SUM', sequelize.literal('CASE WHEN transfer_status = \'accepted\' THEN 1 ELSE 0 END')), 'accepted_transfers'],
                [sequelize.fn('SUM', sequelize.literal('CASE WHEN transfer_status = \'rejected\' THEN 1 ELSE 0 END')), 'rejected_transfers']
            ],
            include: [{
                model: User,
                as: 'salesUser',
                attributes: ['id', 'full_name'],
                required: true
            }],
            group: ['sales_user_id', 'salesUser.id', 'salesUser.full_name']
        });

        // Format the stats by appointment setter
        const formattedStatsByAppointmentSetter = statsByAppointmentSetter.map(stat => {
            const statData = stat.toJSON();
            const acceptanceRate = statData.total_transfers > 0 ? 
                (statData.accepted_transfers / statData.total_transfers) * 100 : 0;
            
            return {
                id: statData.appointment_setter_id,
                name: statData.appointmentSetter.full_name,
                totalTransfers: parseInt(statData.total_transfers),
                acceptedTransfers: parseInt(statData.accepted_transfers),
                rejectedTransfers: parseInt(statData.rejected_transfers),
                acceptanceRate: acceptanceRate.toFixed(2)
            };
        });

        // Format the stats by sales user
        const formattedStatsBySalesUser = statsBySalesUser.map(stat => {
            const statData = stat.toJSON();
            const acceptanceRate = statData.total_transfers > 0 ? 
                (statData.accepted_transfers / statData.total_transfers) * 100 : 0;
            
            return {
                id: statData.sales_user_id,
                name: statData.salesUser.full_name,
                totalTransfers: parseInt(statData.total_transfers),
                acceptedTransfers: parseInt(statData.accepted_transfers),
                rejectedTransfers: parseInt(statData.rejected_transfers),
                acceptanceRate: acceptanceRate.toFixed(2)
            };
        });

        // Return the compiled statistics
        return res.status(200).json({
            status: 'success',
            data: {
                dateRange: {
                    start: moment(startDate).format('YYYY-MM-DD'),
                    end: moment(endDate).format('YYYY-MM-DD')
                },
                totals: {
                    totalTransfers,
                    pendingTransfers,
                    acceptedTransfers,
                    rejectedTransfers
                },
                conversionRate: conversionRate.toFixed(2),
                avgResponseTimeHours: avgResponseTimeHours.toFixed(2),
                byAppointmentSetter: formattedStatsByAppointmentSetter,
                bySalesUser: formattedStatsBySalesUser
            }
        });

    } catch (error) {
        console.error('Error in getTransferStats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get activity logs for all transfers (admin view)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getActivityLogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            transfer_id,
            activity_type,
            user_id,
            start_date,
            end_date
        } = req.query;

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can view activity logs'
            });
        }

        // Build the where clause
        const whereClause = {};

        // Add transfer_id filter if provided
        if (transfer_id) {
            whereClause.transfer_id = transfer_id;
        }

        // Add activity_type filter if provided
        if (activity_type) {
            whereClause.activity_type = activity_type;
        }

        // Add user_id filter if provided
        if (user_id) {
            whereClause.user_id = user_id;
        }

        // Add date range filter if provided
        if (start_date && end_date) {
            whereClause.created_at = {
                [Op.between]: [
                    moment(start_date).startOf('day').toDate(),
                    moment(end_date).endOf('day').toDate()
                ]
            };
        }

        // Calculate pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get activity logs with pagination
        const { count, rows } = await TrialTransferActivityLog.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'role_name']
                },
                {
                    model: TrialStudentTransfer,
                    as: 'transfer',
                    attributes: ['id', 'student_name', 'student_email', 'transfer_status']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        // Format activity logs
        const formattedLogs = rows.map(log => {
            const logJson = log.toJSON();
            
            return {
                id: logJson.id,
                type: logJson.activity_type,
                details: logJson.details,
                date: moment(logJson.created_at).format('YYYY-MM-DD HH:mm:ss'),
                user: logJson.user ? {
                    id: logJson.user.id,
                    name: logJson.user.full_name,
                    role: logJson.user.role_name
                } : null,
                transfer: logJson.transfer ? {
                    id: logJson.transfer.id,
                    studentName: logJson.transfer.student_name,
                    status: logJson.transfer.transfer_status
                } : null
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                logs: formattedLogs,
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getActivityLogs:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get status history for a specific trial class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTrialClassStatusHistory = async (req, res) => {
    try {
        const { trial_class_id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        // Validate input
        if (!trial_class_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Trial class ID is required'
            });
        }

        // Validate the current user is an admin
        const currentUser = await User.findByPk(req.user.id);
        if (!currentUser || !['admin', 'super_admin'].includes(currentUser.role_name)) {
            return res.status(403).json({
                status: 'error',
                message: 'Only administrators can view status history'
            });
        }

        // Check if the trial class exists
        const trialClass = await TrialClassRegistration.findByPk(trial_class_id);
        if (!trialClass) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Get trial class status history
        const statusHistory = await TrialClassStatusHistory.findAll({
            where: { trial_class_id },
            include: [{
                model: User,
                as: 'changedBy',
                attributes: ['id', 'full_name', 'role_name']
            }],
            order: [['created_at', 'ASC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit)
        });
        
        // Count total records
        const totalCount = await TrialClassStatusHistory.count({
            where: { trial_class_id }
        });
        
        // Format status history
        const formattedHistory = statusHistory.map(history => ({
            id: history.id,
            timestamp: history.created_at,
            previousStatus: history.previous_status,
            newStatus: history.new_status,
            changedBy: history.changedBy?.full_name || 'System',
            changedByRole: history.changed_by_type,
            notes: history.notes,
            attendanceChange: history.attendance_change
        }));
        
        return res.status(200).json({
            status: 'success',
            data: {
                statusHistory: formattedHistory,
                total: totalCount,
                page: parseInt(page),
                pages: Math.ceil(totalCount / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getTrialClassStatusHistory:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getAllTransfers,
    getTransferById,
    acceptTransfer,
    rejectTransfer,
    reassignTransfer,
    getTransferStats,
    getActivityLogs,
    getTrialClassStatusHistory
};