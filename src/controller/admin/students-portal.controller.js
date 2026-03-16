const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Class = require('../../models/classes');
const { Op } = require('sequelize');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');

/**
 * Get all students with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudents = async (req, res) => {
    try {
        const { 
            search, 
            status = 'active', 
            page = 1, 
            limit = 20 
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        const whereConditions = {
            role_name: 'user',
            status: status
        };
        
        // Add search conditions if provided
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }
        
        // Find students with their subscription details
        const students = await User.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['full_name', 'ASC']]
        });
        
        // Format the response
        const formattedStudents = students.rows.map(student => {
            const subscription = student.UserSubscriptions && student.UserSubscriptions[0];
            
            return {
                id: student.id,
                name: student.full_name,
                email: student.email,
                mobile: student.mobile,
                country_code: student.country_code,
                status: student.status,
                subscription: subscription ? {
                    id: subscription.id,
                    type: subscription.type,
                    regularClasses: subscription.weekly_lesson || 0,
                    lessonMin: subscription.lesson_min,
                    leftLessons: subscription.left_lessons,
                    howOften: subscription.how_often,
                    renewDate: subscription.renew_date ? moment(subscription.renew_date).format() : null,
                    inactiveAfterRenew: subscription.inactive_after_renew || 0 // Include for admin visibility
                } : null
            };
        });
        
        return res.status(200).json({
            status: 'success',
            data: formattedStudents,
            pagination: {
                total: students.count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(students.count / parseInt(limit))
            },
            message: 'Students retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching students:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get student by ID with subscription details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const student = await User.findByPk(id, {
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    where: {
                        status: 'active', // Only active subscriptions
                        is_cancel: 0 // Exclude subscriptions marked for cancellation
                    },
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ]
        });
        
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        const subscription = student.UserSubscriptions && student.UserSubscriptions[0];

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'Student has no active subscription or subscription is marked for cancellation'
            });
        }
        
        const formattedStudent = {
            id: student.id,
            name: student.full_name,
            email: student.email,
            mobile: student.mobile,
            country_code: student.country_code,
            status: student.status,
            timezone: student.timezone,
            subscription: {
                id: subscription.id,
                type: subscription.type,
                regularClasses: subscription.weekly_lesson || 0,
                lessonMin: subscription.lesson_min,
                leftLessons: subscription.left_lessons,
                howOften: subscription.how_often,
                renewDate: subscription.renew_date ? moment(subscription.renew_date).format() : null,
                status: subscription.status,
                inactiveAfterRenew: subscription.inactive_after_renew || 0 // Include for admin visibility
            }
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedStudent
        });
        
    } catch (error) {
        console.error('Error fetching student details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get student subscription details
 * UPDATED: Excludes subscriptions marked as inactive_after_renew = 1
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentSubscription = async (req, res) => {
    try {
        const { id } = req.params;
        
        const subscriptionDetails = await UserSubscriptionDetails.findAll({
            where: { 
                user_id: id,
                status: 'active',
                is_cancel: 0 // Exclude subscriptions marked for cancellation
            },
            order: [['created_at', 'DESC']],
            limit: 1
        });
        
        if (!subscriptionDetails || subscriptionDetails.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Active subscription details not found for this student or subscription is marked for cancellation'
            });
        }
        
        const subscription = subscriptionDetails[0];
        
        const formattedSubscription = {
            id: subscription.id,
            type: subscription.type,
            regularClasses: subscription.weekly_lesson || 0,
            lessonMin: subscription.lesson_min,
            leftLessons: subscription.left_lessons,
            howOften: subscription.how_often,
            renewDate: subscription.renew_date ? moment(subscription.renew_date).format() : null,
            status: subscription.status,
            balance: subscription.balance,
            costPerLesson: subscription.cost_per_lesson,
            inactiveAfterRenew: subscription.inactive_after_renew || 0 // Include for admin visibility
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedSubscription
        });
        
    } catch (error) {
        console.error('Error fetching student subscription details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Search students by name or email
 * UPDATED: Excludes students with subscriptions marked as inactive_after_renew = 1
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const searchStudents = async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Search query must be at least 2 characters'
            });
        }
        
        const students = await User.findAll({
            where: {
                role_name: 'user',
                [Op.or]: [
                    { full_name: { [Op.like]: `%${query}%` } },
                    { email: { [Op.like]: `%${query}%` } }
                ]
            },
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    where: {
                        status: 'active',
                        is_cancel: 0 // Exclude subscriptions marked for cancellation
                    },
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ],
            limit: 20
        });
        
        // Filter out students without valid subscriptions
        const formattedStudents = students
            .filter(student => {
                const subscription = student.UserSubscriptions && student.UserSubscriptions[0];
                return subscription && subscription.inactive_after_renew !== 1;
            })
            .map(student => {
                const subscription = student.UserSubscriptions[0];
                
                return {
                    id: student.id,
                    name: student.full_name,
                    email: student.email,
                    subscription: {
                        type: subscription.type,
                        regularClasses: subscription.weekly_lesson || 0,
                        inactiveAfterRenew: subscription.inactive_after_renew || 0
                    }
                };
            });
        
        return res.status(200).json({
            status: 'success',
            data: formattedStudents,
            message: `Found ${formattedStudents.length} eligible students`
        });
        
    } catch (error) {
        console.error('Error searching students:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all subscribed students with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getSubscribedStudents = async (req, res) => {
    try {
        const { 
            search, 
            status = 'active', 
            page = 1, 
            limit = 20 
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        const whereConditions = {
            role_name: 'user',
            status: status
        };
        
        // Add search conditions if provided
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }
        
        // Find students with their subscription details, ensuring they have active subscriptions
        const students = await User.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: true, // This should make it an INNER JOIN
                    where: {
                        status: 'active', // Only active subscriptions
                        // is_cancel: 0 // Exclude subscriptions marked for cancellation
                    },
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['full_name', 'ASC']]
        });
        
        // Format the response - Filter out users with null subscriptions as an extra safety measure
        const formattedStudents = students.rows
            .filter(student => {
                // Ensure we only include users that actually have at least one subscription row
                return student.UserSubscriptions && student.UserSubscriptions.length > 0;
            })
            .map(student => {
                const subscription = student.UserSubscriptions[0];
                
                return {
                    id: student.id,
                    name: student.full_name,
                    email: student.email,
                    status: student.status,
                    studentTimezone: student.timezone,
                    subscription: {
                        id: subscription.id,
                        type: subscription.type,
                        regularClasses: subscription.weekly_lesson || 0,
                        leftLessons: subscription.left_lessons || 0,
                        renewDate: subscription.renew_date ? moment(subscription.renew_date).format() : null,
                        inactiveAfterRenew: subscription.inactive_after_renew || 0, // Include for admin visibility
                        status: subscription.status,
                        lessonMin: subscription.lesson_min
                    }
                };
            });
        
        return res.status(200).json({
            status: 'success',
            data: formattedStudents,
            pagination: {
                total: formattedStudents.length, // Use actual filtered count
                totalBeforeFiltering: students.count, // Original count before filtering
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(formattedStudents.length / parseInt(limit))
            },
            message: 'Subscribed students retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching subscribed students:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};


module.exports = {
    getStudents,
    getStudentById,
    getStudentSubscription,
    searchStudents,
    getSubscribedStudents
};