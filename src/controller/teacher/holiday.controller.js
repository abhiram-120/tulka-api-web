const moment = require('moment');
const { Op } = require('sequelize');
const TeacherHoliday = require('../../models/teacherHoliday');
const User = require('../../models/users');

/**
 * Get all holidays for a teacher with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getHolidays = async (req, res) => {
    try {
        const teacherId = req.user.id;

        const teacher = await User.findByPk(teacherId);
        const teacherTimezone = teacher.timezone || "Asia/Jerusalem";
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // Get total count for pagination metadata
        const count = await TeacherHoliday.count({
            where: {
                user_id: teacherId
            }
        });
        
        // Get paginated holidays
        const holidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId
            },
            order: [['form_date', 'ASC']],
            attributes: ['id', 'title', 'reason', 'form_date', 'to_date', 'status', 'approver_id', 'response'],
            limit: limit,
            offset: offset
        });

        const formattedHolidays = await Promise.all(holidays.map(async holiday => {
            let approverName = null;
            if (holiday.approver_id) {
                const approver = await User.findByPk(holiday.approver_id);
                approverName = approver ? approver.name : null;
            }
            // const start = moment(holiday.form_date);
            // const end = moment(holiday.to_date);
            const start = moment.utc(holiday.form_date).tz(teacherTimezone);
            const end = moment.utc(holiday.to_date).tz(teacherTimezone);
            const duration = moment.duration(end.diff(start));

            const durationString = [
                duration.days() > 0 ? `${duration.days()} day${duration.days() > 1 ? 's' : ''}` : '',
                duration.hours() > 0 ? `${duration.hours()} hour${duration.hours() > 1 ? 's' : ''}` : '',
                duration.minutes() > 0 ? `${duration.minutes()} minute${duration.minutes() > 1 ? 's' : ''}` : ''
            ].filter(Boolean).join(' ');
            return {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: start.format('YYYY-MM-DD HH:mm:ss'),
                endDate: end.format('YYYY-MM-DD HH:mm:ss'),
                duration: durationString,
                status: holiday.status,
                approver: approverName,
                response: holiday.response
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedHolidays,
            pagination: {
                total: count,
                page: page,
                limit: limit,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Error in getHolidays:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a new holiday request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createHolidayRequest = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const { title, reason, startDate, endDate } = req.body;

        console.log('holiday body', req.body);

        const teacher = await User.findByPk(teacherId);
        const teacherTimezone = teacher.timezone || 'Asia/Jerusalem';

        // Validate required fields
        if (!title || !startDate || !endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Title, start date, and end date are required'
            });
        }

        // Validate dates
        // const start = moment(startDate);
        // const end = moment(endDate);

        // const start = moment.tz(startDate, teacherTimezone).startOf("day");
        // const end = moment.tz(endDate, teacherTimezone).endOf("day");

        let start, end;

        // If partial-day (has time in string)
        const hasTime = startDate.includes(':');

        // PARTIAL-DAY: use exact time
        if (hasTime) {
            start = moment.tz(startDate, 'YYYY-MM-DD HH:mm:ss', teacherTimezone);
            end = moment.tz(endDate, 'YYYY-MM-DD HH:mm:ss', teacherTimezone);
        }
        // FULL DAY: force full-day boundaries
        else {
            start = moment.tz(startDate, teacherTimezone).startOf('day');
            end = moment.tz(endDate, teacherTimezone).endOf('day');
        }

        if (!start.isValid() || !end.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format'
            });
        }

        if (end.isBefore(start)) {
            return res.status(400).json({
                status: 'error',
                message: 'End date cannot be before start date'
            });
        }

        // Check for overlapping holidays
        const existingHoliday = await TeacherHoliday.findOne({
            where: {
                user_id: teacherId,
                status: { [Op.in]: ['pending', 'approved'] },
                form_date: { [Op.lt]: end.toDate() },
                to_date: { [Op.gt]: start.toDate() }
            }
        });

        if (existingHoliday) {
            return res.status(400).json({
                status: 'error',
                message: 'You already have a holiday scheduled during this period'
            });
        }

        // Create holiday request
        const holiday = await TeacherHoliday.create({
            user_id: teacherId,
            title,
            reason: reason || null,
            form_date: start.toDate(),
            to_date: end.toDate(),
            status: 'pending',
            approver_id: null
        });

        return res.status(201).json({
            status: 'success',
            message: 'Holiday request created successfully',
            data: {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
                endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
                duration: end.diff(start, 'days') + 1,
                status: holiday.status
            }
        });
    } catch (error) {
        console.error('Error in createHolidayRequest:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get a specific holiday by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getHolidayById = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const holidayId = req.params.id;

        const holiday = await TeacherHoliday.findOne({
            where: {
                id: holidayId,
                user_id: teacherId
            }
        });

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        let approverName = null;
        if (holiday.approver_id) {
            const approver = await User.findByPk(holiday.approver_id);
            approverName = approver ? approver.name : null;
        }

        return res.status(200).json({
            status: 'success',
            data: {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
                endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
                duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
                status: holiday.status,
                approver: approverName
            }
        });
    } catch (error) {
        console.error('Error in getHolidayById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update an existing holiday
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateHoliday = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const holidayId = req.params.id;
        const { title, reason, startDate, endDate } = req.body;

        const teacher = await User.findByPk(teacherId);
        const teacherTimezone = teacher.timezone || 'Asia/Jerusalem';

        let start, end;

        if (startDate && endDate) {
            const hasTime = startDate.includes(':');

            if (hasTime) {
                // Partial-day
                start = moment.tz(startDate, 'YYYY-MM-DD HH:mm:ss', teacherTimezone);
                end = moment.tz(endDate, 'YYYY-MM-DD HH:mm:ss', teacherTimezone);
            } else {
                // Full-day
                start = moment.tz(startDate, teacherTimezone).startOf('day');
                end = moment.tz(endDate, teacherTimezone).endOf('day');
            }
        }

        // Find the holiday
        const holiday = await TeacherHoliday.findOne({
            where: {
                id: holidayId,
                user_id: teacherId
            }
        });

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        // Only allow updates if the status is pending
        if (holiday.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot update a holiday that has been ${holiday.status}`
            });
        }

        // Validate dates if provided
        if (startDate && endDate) {
            const start = moment(startDate);
            const end = moment(endDate);

            if (!start.isValid() || !end.isValid()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid date format'
                });
            }

            if (end.isBefore(start)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'End date cannot be before start date'
                });
            }

            // Check for overlapping holidays excluding current holiday
            const existingHoliday = await TeacherHoliday.findOne({
                where: {
                    id: { [Op.ne]: holidayId },
                    user_id: teacherId,
                    status: {
                    [Op.in]: ['pending', 'approved']
                    },
                    [Op.or]: [
                        {
                            form_date: {
                                [Op.between]: [start.toDate(), end.toDate()]
                            }
                        },
                        {
                            to_date: {
                                [Op.between]: [start.toDate(), end.toDate()]
                            }
                        }
                    ]
                }
            });

            if (existingHoliday) {
                return res.status(400).json({
                    status: 'error',
                    message: 'You already have a holiday scheduled during this period'
                });
            }
        }

        await holiday.update({
            title: title || holiday.title,
            reason: reason !== undefined ? reason : holiday.reason,
            form_date: start ? start.toDate() : holiday.form_date,
            to_date: end ? end.toDate() : holiday.to_date,
            status: startDate || endDate ? 'pending' : holiday.status,
            approver_id: startDate || endDate ? null : holiday.approver_id
        });

        return res.status(200).json({
            status: 'success',
            message: 'Holiday updated successfully',
            data: {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: moment(holiday.form_date).format('YYYY-MM-DD HH:mm:ss'),
                endDate: moment(holiday.to_date).format('YYYY-MM-DD HH:mm:ss'),
                duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
                status: holiday.status
            }
        });
    } catch (error) {
        console.error('Error in updateHoliday:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete a holiday
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteHoliday = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const holidayId = req.params.id;

        const holiday = await TeacherHoliday.findOne({
            where: {
                id: holidayId,
                user_id: teacherId
            }
        });

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        // Allow deletion for any status (pending, approved, or rejected)

        await holiday.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Holiday deleted successfully'
        });
    } catch (error) {
        console.error('Error in deleteHoliday:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all pending holidays for a teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherPendingHolidays = async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        const holidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId,
                status: 'pending'
            },
            order: [['form_date', 'ASC']],
            attributes: ['id', 'title', 'reason', 'form_date', 'to_date', 'status']
        });

        const formattedHolidays = holidays.map(holiday => ({
            id: holiday.id,
            title: holiday.title,
            reason: holiday.reason,
            startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
            endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
            duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
            status: holiday.status
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedHolidays
        });
    } catch (error) {
        console.error('Error in getTeacherPendingHolidays:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all approved holidays for a teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherApprovedHolidays = async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        const holidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId,
                status: 'approved'
            },
            order: [['form_date', 'ASC']],
            attributes: ['id', 'title', 'reason', 'form_date', 'to_date', 'status', 'approver_id','response']
        });

        const formattedHolidays = await Promise.all(holidays.map(async holiday => {
            let approverName = null;
            if (holiday.approver_id) {
                const approver = await User.findByPk(holiday.approver_id);
                approverName = approver ? approver.name : null;
            }
            
            return {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
                endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
                duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
                status: holiday.status,
                approver: approverName
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedHolidays
        });
    } catch (error) {
        console.error('Error in getTeacherApprovedHolidays:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all rejected holidays for a teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherRejectedHolidays = async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        const holidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId,
                status: 'rejected'
            },
            order: [['form_date', 'ASC']],
            attributes: ['id', 'title', 'reason', 'form_date', 'to_date', 'status', 'approver_id','response']
        });

        const formattedHolidays = await Promise.all(holidays.map(async holiday => {
            let approverName = null;
            if (holiday.approver_id) {
                const approver = await User.findByPk(holiday.approver_id);
                approverName = approver ? approver.name : null;
            }
            
            return {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
                endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
                duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
                status: holiday.status,
                approver: approverName
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedHolidays
        });
    } catch (error) {
        console.error('Error in getTeacherRejectedHolidays:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// Let's keep these in the controller but they'll be used in admin routes
// They're included here for reference but would be exposed through a different router

/**
 * Approve or reject a holiday request (for admin/supervisor users)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const respondToHolidayRequest = async (req, res) => {
    try {
        const approverId = req.user.id;
        const holidayId = req.params.id;
        const { action } = req.body;

        // Validate action
        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid action. Must be "approved" or "rejected"'
            });
        }

        // Find the holiday
        const holiday = await TeacherHoliday.findByPk(holidayId);

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday request not found'
            });
        }

        // Only pending requests can be approved/rejected
        if (holiday.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot ${action} a holiday request that has already been ${holiday.status}`
            });
        }

        // Update the holiday status
        await holiday.update({
            status: action,
            approver_id: approverId
        });

        return res.status(200).json({
            status: 'success',
            message: `Holiday request ${action} successfully`
        });
    } catch (error) {
        console.error('Error in respondToHolidayRequest:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all pending holiday requests (for admin/supervisor users)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPendingHolidayRequests = async (req, res) => {
    try {
        const holidays = await TeacherHoliday.findAll({
            where: {
                status: 'pending'
            },
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'name', 'email']
                }
            ],
            order: [['form_date', 'ASC']],
            attributes: ['id', 'title', 'reason', 'form_date', 'to_date', 'response']
        });

        const formattedHolidays = holidays.map(holiday => ({
            id: holiday.id,
            title: holiday.title,
            reason: holiday.reason,
            startDate: moment(holiday.form_date).format('YYYY-MM-DD'),
            endDate: moment(holiday.to_date).format('YYYY-MM-DD'),
            duration: moment(holiday.to_date).diff(moment(holiday.form_date), 'days') + 1,
            teacher: holiday.teacher ? {
                id: holiday.teacher.id,
                name: holiday.teacher.name,
                email: holiday.teacher.email
            } : null,
            response: holiday.response
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedHolidays
        });
    } catch (error) {
        console.error('Error in getPendingHolidayRequests:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    // Teacher routes
    getHolidays,
    createHolidayRequest,
    getHolidayById,
    updateHoliday,
    deleteHoliday,
    getTeacherPendingHolidays,
    getTeacherApprovedHolidays,
    getTeacherRejectedHolidays,
    
    // Admin routes (exported here but will be used in admin router)
    respondToHolidayRequest,
    getPendingHolidayRequests
};