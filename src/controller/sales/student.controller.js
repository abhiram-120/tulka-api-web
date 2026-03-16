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
        const { search, status = 'active', page = 1, limit = 20 } = req.query;

        const offset = (page - 1) * parseInt(limit);

        const whereConditions = {
            role_name: 'user',
            status: status
        };

        // Add search conditions if provided
        if (search) {
            whereConditions[Op.or] = [{ full_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }];
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
        const formattedStudents = students.rows.map((student) => {
            const subscription = student.UserSubscriptions && student.UserSubscriptions[0];

            return {
                id: student.id,
                name: student.full_name,
                email: student.email,
                mobile: student.mobile,
                country_code: student.country_code,
                status: student.status,
                subscription: subscription
                    ? {
                          id: subscription.id,
                          type: subscription.type,
                          regularClasses: subscription.weekly_lesson || 0,
                          lessonMin: subscription.lesson_min,
                          leftLessons: subscription.left_lessons,
                          howOften: subscription.how_often,
                          renewDate: subscription.renew_date ? moment(subscription.renew_date).format() : null
                      }
                    : null
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
                inactiveAfterRenew: subscription.inactive_after_renew || 0 // Include for debugging
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
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentSubscription = async (req, res) => {
    try {
        const { id } = req.params;

        const subscriptionDetails = await UserSubscriptionDetails.findAll({
            where: { user_id: id },
            order: [['created_at', 'DESC']],
            limit: 1
        });

        if (!subscriptionDetails || subscriptionDetails.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Subscription details not found for this student'
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
            costPerLesson: subscription.cost_per_lesson
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
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const searchStudents = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;
    const searchTerm = search?.trim() || "";
    const pageNumber = parseInt(page);
    const pageLimit = parseInt(limit);
    const offset = (pageNumber - 1) * pageLimit;

    const where = { role_name: "user" };

    if (searchTerm !== "") {
      where[Op.or] = [
        { full_name: { [Op.like]: `%${searchTerm}%` } },
        { email: { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    const students = await User.findAll({
      where,
      include: [
        {
          model: UserSubscriptionDetails,
          as: "UserSubscriptions",
          separate: true,
          limit: 1,
          order: [["created_at", "DESC"]],
        },
      ],
      limit: pageLimit,     // FIXED
      offset: offset,       // FIXED
      order: [["created_at", "DESC"]],
    });

    const formatted = students.map((s) => ({
      id: s.id,
      name: s.full_name,
      email: s.email,
      phone: s.country_code + s.mobile,
      countryCode: s.country_code,
      parentName: s.parent_name,
      age: s.student_age,
      subscription: s.UserSubscriptions?.[0]
        ? {
            type: s.UserSubscriptions[0].type,
            regularClasses: s.UserSubscriptions[0].weekly_lesson,
          }
        : null,
    }));

    const totalCount = await User.count({ where });
    const hasMore = pageNumber * pageLimit < totalCount;

    return res.status(200).json({
      status: "success",
      data: formatted,
      hasMore,
      page: pageNumber,
    });
  } catch (error) {
    console.error("Error searching students:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: error.message,
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
        const { search, status = 'active', page = 1, limit = 20 } = req.query;

        const offset = (page - 1) * parseInt(limit);

        const whereConditions = {
            role_name: 'user',
            status: status
        };

        // Add search conditions if provided
        if (search) {
            whereConditions[Op.or] = [{ full_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }];
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
                        // is_cancel: 0
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
            .filter((student) => {
                // Ensure we only include users that actually have at least one subscription row
                return student.UserSubscriptions && student.UserSubscriptions.length > 0;
            })
            .map((student) => {
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
                        inactiveAfterRenew: subscription.inactive_after_renew || 0, // Include for debugging
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
