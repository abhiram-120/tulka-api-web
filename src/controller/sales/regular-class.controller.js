const Salesperson = require('../../models/Salesperson');
const User = require('../../models/users');
const Class = require('../../models/classes');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');

/**
 * Create a new regular class booking
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createRegularClass = async (req, res) => {
    let transaction;
    
    try {
        const {
            student_id,
            teacher_id,
            meeting_start,    // In UTC
            meeting_end,      // In UTC
            student_goal,
            peak_hours,
            subscription_id
        } = req.body;

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if teacher exists and is active
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            transaction
        });

        if (!teacher) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Check student's subscription and available classes
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: student_id,
                id: subscription_id,
                status: 'active'
            },
            transaction
        });

        if (!subscription) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Active subscription not found'
            });
        }

        // Check if student has available classes
        if (subscription.left_lessons <= 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No classes remaining in subscription'
            });
        }

        // Parse UTC times
        const startTime = moment.utc(meeting_start);
        const endTime = moment.utc(meeting_end);

        // Validate class duration based on subscription
        const duration = moment.duration(endTime.diff(startTime)).asMinutes();
        if (duration !== parseInt(subscription.lesson_min)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Class duration must be ${subscription.lesson_min} minutes`
            });
        }

        // Check for existing classes
        const existingClass = await Class.findOne({
            where: {
                teacher_id,
                [Op.or]: [
                    {
                        meeting_start: {
                            [Op.between]: [startTime.format(), endTime.format()]
                        }
                    },
                    {
                        meeting_end: {
                            [Op.between]: [startTime.format(), endTime.format()]
                        }
                    }
                ],
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            },
            transaction
        });

        if (existingClass) {
            if (transaction) await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Teacher already has a class scheduled during this time slot'
            });
        }

        // Create class entry
        const classEntry = await Class.create({
            student_id,
            teacher_id,
            status: 'scheduled',
            meeting_start: startTime.format(),
            meeting_end: endTime.format(),
            is_trial: false,
            student_goal,
            subscription_id,
            class_type: 'website',
            next_month_class_term: false,
            bonus_class: false,
            join_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
            admin_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null
        }, { transaction });

        // Update subscription remaining classes
        await subscription.update({
            left_lessons: subscription.left_lessons - 1
        }, { transaction });

        // Create salesperson activity if booked by sales
        if (req.user.role_name === 'sales_role') {
            await Salesperson.create({
                user_id: req.user.id,
                role_type: req.user.role_type || 'sales_role',
                action_type: 'regular_class',
                student_id,
                class_id: classEntry.id,
                meeting_type: 'online',
                appointment_time: startTime.format(),
                appointment_duration: duration,
                peak_hour_status: peak_hours || false,
                success_status: 'successful'
            }, { transaction });
        }

        // Commit transaction
        await transaction.commit();

        // Fetch complete data
        const completeClass = await Class.findByPk(classEntry.id, {
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        return res.status(201).json({
            status: 'success',
            data: completeClass
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error in createRegularClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all regular classes with pagination and filters
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRegularClasses = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status,
            teacher_id,
            student_id,
            start_date,
            end_date,
            search,
            sort_by = 'created_at',
            sort_order = 'DESC',
            subscription_id
        } = req.query;

        const whereClause = {
            is_trial: false,
            class_type: 'website'
        };
        
        // Apply filters
        if (status) whereClause.status = status;
        if (teacher_id) whereClause.teacher_id = teacher_id;
        if (student_id) whereClause.student_id = student_id;
        if (subscription_id) whereClause.subscription_id = subscription_id;
        
        if (start_date && end_date) {
            whereClause.meeting_start = {
                [Op.between]: [
                    moment.utc(start_date).startOf('day').format(),
                    moment.utc(end_date).endOf('day').format()
                ]
            };
        }

        // Apply search
        if (search) {
            whereClause[Op.or] = [
                { 'Student.full_name': { [Op.like]: `%${search}%` } },
                { 'Teacher.full_name': { [Op.like]: `%${search}%` } }
            ];
        }

        const classes = await Class.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            limit: parseInt(limit),
            offset: (page - 1) * limit,
            order: [[sort_by, sort_order]],
            distinct: true
        });

        // Format response
        const formattedClasses = classes.rows.map(classItem => ({
            ...classItem.toJSON(),
            meeting_start_formatted: moment.utc(classItem.meeting_start).format(),
            meeting_end_formatted: moment.utc(classItem.meeting_end).format(),
            created_at_formatted: moment(classItem.created_at).format()
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                classes: formattedClasses,
                total: classes.count,
                pages: Math.ceil(classes.count / limit),
                currentPage: parseInt(page)
            }
        });

    } catch (error) {
        console.error('Error in getRegularClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get regular class by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRegularClassById = async (req, res) => {
    try {
        const { id } = req.params;

        const classItem = await Class.findOne({
            where: {
                id,
                is_trial: false,
                class_type: 'website'
            },
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        if (!classItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        // Format response
        const formattedClass = {
            ...classItem.toJSON(),
            meeting_start_formatted: moment.utc(classItem.meeting_start).format(),
            meeting_end_formatted: moment.utc(classItem.meeting_end).format(),
            created_at_formatted: moment(classItem.created_at).format()
        };

        return res.status(200).json({
            status: 'success',
            data: formattedClass
        });

    } catch (error) {
        console.error('Error in getRegularClassById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update regular class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateRegularClass = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { id } = req.params;
        const updateData = req.body;

        const classItem = await Class.findOne({
            where: {
                id,
                is_trial: false,
                class_type: 'website'
            },
            transaction
        });

        if (!classItem) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        // Handle time updates if provided
        if (updateData.meeting_start || updateData.meeting_end) {
            const startTime = moment.utc(updateData.meeting_start || classItem.meeting_start);
            const endTime = moment.utc(updateData.meeting_end || classItem.meeting_end);

            // Check for timing conflicts
            const existingClass = await Class.findOne({
                where: {
                    teacher_id: classItem.teacher_id,
                    id: { [Op.ne]: id },
                    [Op.or]: [
                        {
                            meeting_start: {
                                [Op.between]: [startTime.format(), endTime.format()]
                            }
                        },
                        {
                            meeting_end: {
                                [Op.between]: [startTime.format(), endTime.format()]
                            }
                        }
                    ],
                    status: {
                        [Op.notIn]: ['canceled', 'rejected']
                    }
                },
                transaction
            });

            if (existingClass) {
                await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'Teacher already has a class scheduled during this time slot'
                });
            }

            updateData.meeting_start = startTime.format();
            updateData.meeting_end = endTime.format();
        }

        // Update class
        await classItem.update(updateData, { transaction });

        await transaction.commit();

        // Fetch updated record
        const updatedClass = await Class.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            data: updatedClass
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error in updateRegularClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Cancel regular class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const cancelRegularClass = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { id } = req.params;
        const { cancellation_reason } = req.body;

        const classItem = await Class.findOne({
            where: {
                id,
                is_trial: false,
                class_type: 'website'
            },
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'subscription',
                    attributes: ['id', 'left_lessons']
                }
            ],
            transaction
        });

        if (!classItem) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        // Update class status
        await classItem.update({
            status: 'canceled',
            student_goal_note: cancellation_reason
        }, { transaction });

        // Refund the class to subscription if cancelled before class time
        if (moment.utc().isBefore(moment.utc(classItem.meeting_start))) {
            await UserSubscriptionDetails.update({
                left_lessons: Sequelize.literal('left_lessons + 1')
            }, {
                where: { id: classItem.subscription_id },
                transaction
            });
        }

        // Update salesperson activity if exists
        await Salesperson.update({
            success_status: 'cancelled'
        }, {
            where: {
                class_id: id,
                action_type: 'regular_class'
            },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Class cancelled successfully'
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error in cancelRegularClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get class statistics for a student
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentClassStats = async (req, res) => {
    try {
        const { student_id, start_date, end_date } = req.query;

        const whereClause = {
            student_id,
            is_trial: false,
            class_type: 'website'
        };

        if (start_date && end_date) {
            whereClause.created_at = {
                [Op.between]: [
                    moment.utc(start_date).startOf('day').format(),
                    moment.utc(end_date).endOf('day').format()
                ]
            };
        }

        // Get class statistics
        const stats = await Class.findAll({
            where: whereClause,
            attributes: [
                'status',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });

        // Get subscription details
        const subscriptionDetails = await UserSubscriptionDetails.findOne({
            where: {
                user_id: student_id,
                status: 'active'
            },
            attributes: [
                'type',
                'left_lessons',
                'weekly_lesson',
                'lesson_min',
                'renew_date'
            ]
        });

        // Format statistics
        const statsFormatted = stats.reduce((acc, stat) => {
            acc[stat.status] = parseInt(stat.getDataValue('count'));
            return acc;
        }, {});

        return res.status(200).json({
            status: 'success',
            data: {
                class_statistics: statsFormatted,
                subscription_details: subscriptionDetails || null
            }
        });

    } catch (error) {
        console.error('Error in getStudentClassStats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get teacher class schedule
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherSchedule = async (req, res) => {
    try {
        const { teacher_id, start_date, end_date } = req.query;

        // Validate teacher exists
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Get teacher's classes
        const classes = await Class.findAll({
            where: {
                teacher_id,
                meeting_start: {
                    [Op.between]: [
                        moment.utc(start_date).startOf('day').format(),
                        moment.utc(end_date).endOf('day').format()
                    ]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        // Get teacher's availability
        const availability = await TeacherAvailability.findOne({
            where: { user_id: teacher_id }
        });

        // Get teacher's holidays
        const holidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacher_id,
                [Op.or]: [
                    {
                        form_date: {
                            [Op.between]: [start_date, end_date]
                        }
                    },
                    {
                        to_date: {
                            [Op.between]: [start_date, end_date]
                        }
                    }
                ]
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                classes: classes.map(classItem => ({
                    ...classItem.toJSON(),
                    meeting_start_formatted: moment.utc(classItem.meeting_start).format(),
                    meeting_end_formatted: moment.utc(classItem.meeting_end).format()
                })),
                availability: availability ? JSON.parse(availability.toJSON()) : null,
                holidays: holidays.map(holiday => ({
                    ...holiday.toJSON(),
                    form_date_formatted: moment(holiday.form_date).format(),
                    to_date_formatted: moment(holiday.to_date).format()
                }))
            }
        });

    } catch (error) {
        console.error('Error in getTeacherSchedule:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    createRegularClass,
    getRegularClasses,
    getRegularClassById,
    updateRegularClass,
    cancelRegularClass,
    getStudentClassStats,
    getTeacherSchedule
};