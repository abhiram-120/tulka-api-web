const Users = require('../../models/users');
const UserReview = require('../../models/userReviews');
const { Op, Sequelize } = require('sequelize');
const { getLocalDate } = require('../../utils/date.utils');

/**
 * Get teacher reviews with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherReviews(req, res) {
    try {
        const teacherId = req.params.id;
        const { 
            page = 1, 
            limit = 10, 
            sort_by = 'created_at', 
            sort_order = 'DESC',
            min_rating,
            max_rating,
            from_date,
            to_date,
            search
        } = req.query;

        // Get requesting user for timezone conversion
        const user = await Users.findOne({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'User not found' 
            });
        }

        // Verify teacher exists and is active
        const teacher = await Users.findOne({
            where: { 
                id: teacherId,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'headline']
        });

        if (!teacher) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Teacher not found or inactive' 
            });
        }

        // Pagination setup
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const validSortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) 
            ? sort_order.toUpperCase() 
            : 'DESC';

        // Build where clause for reviews
        const whereClause = { 
            instructor_id: teacherId 
        };

        // Rating filter
        if (min_rating) {
            whereClause.rates = {
                ...(whereClause.rates || {}),
                [Op.gte]: parseFloat(min_rating)
            };
        }

        if (max_rating) {
            whereClause.rates = {
                ...(whereClause.rates || {}),
                [Op.lte]: parseFloat(max_rating)
            };
        }

        // Date range filters
        if (from_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.gte]: new Date(from_date)
            };
        }

        if (to_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.lte]: new Date(to_date)
            };
        }

        // Search in description
        if (search && search.trim()) {
            whereClause.description = {
                [Op.like]: `%${search.trim()}%`
            };
        }

        // Get total count for pagination
        const totalCount = await UserReview.count({
            where: whereClause
        });

        // Get reviews with pagination - FIXED: Using correct alias 'reviewer'
        const reviews = await UserReview.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'reviewer', // Changed from 'Creator' to 'reviewer' based on associations.js
                    attributes: ['id', 'full_name', 'avatar'],
                    required: false
                }
            ],
            order: [[sort_by, validSortOrder]],
            limit: parseInt(limit),
            offset: offset
        });

        if (!reviews || reviews.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No reviews found for this teacher',
                data: {
                    teacher: {
                        id: teacher.id,
                        name: teacher.full_name,
                        avatar: teacher.avatar,
                        headline: teacher.headline
                    },
                    reviews: [],
                    statistics: {
                        totalReviews: 0,
                        averageRating: 0,
                        ratingDistribution: {
                            "5": 0, "4": 0, "3": 0, "2": 0, "1": 0
                        }
                    },
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: 0,
                        totalItems: 0,
                        itemsPerPage: parseInt(limit),
                        hasNextPage: false,
                        hasPreviousPage: false
                    }
                }
            });
        }

        // Calculate statistics for all reviews (not just current page)
        const allReviews = await UserReview.findAll({
            where: { instructor_id: teacherId },
            attributes: ['rates', 'content_quality', 'instructor_skills', 'purchase_worth', 'support_quality']
        });

        let statistics = {
            totalReviews: 0,
            averageRating: 0,
            averageContentQuality: 0,
            averageInstructorSkills: 0,
            averagePurchaseWorth: 0,
            averageSupportQuality: 0,
            ratingDistribution: {
                "5": 0, "4": 0, "3": 0, "2": 0, "1": 0
            }
        };

        if (allReviews.length > 0) {
            statistics.totalReviews = allReviews.length;
            
            // Calculate averages
            const ratesSum = allReviews.reduce((sum, review) => sum + parseFloat(review.rates || 0), 0);
            const contentQualitySum = allReviews.reduce((sum, review) => sum + parseFloat(review.content_quality || 0), 0);
            const instructorSkillsSum = allReviews.reduce((sum, review) => sum + parseFloat(review.instructor_skills || 0), 0);
            const purchaseWorthSum = allReviews.reduce((sum, review) => sum + parseFloat(review.purchase_worth || 0), 0);
            const supportQualitySum = allReviews.reduce((sum, review) => sum + parseFloat(review.support_quality || 0), 0);

            statistics.averageRating = parseFloat((ratesSum / allReviews.length).toFixed(1));
            statistics.averageContentQuality = parseFloat((contentQualitySum / allReviews.length).toFixed(1));
            statistics.averageInstructorSkills = parseFloat((instructorSkillsSum / allReviews.length).toFixed(1));
            statistics.averagePurchaseWorth = parseFloat((purchaseWorthSum / allReviews.length).toFixed(1));
            statistics.averageSupportQuality = parseFloat((supportQualitySum / allReviews.length).toFixed(1));

            // Calculate rating distribution
            allReviews.forEach(review => {
                const rating = Math.floor(parseFloat(review.rates || 0));
                if (rating >= 1 && rating <= 5) {
                    statistics.ratingDistribution[rating.toString()]++;
                }
            });
        }

        // Format reviews for response - FIXED: Changed from review.Creator to review.reviewer
        const formattedReviews = reviews.map(review => {
            const localDateTime = getLocalDate(review.created_at, user.timezone);
            
            return {
                id: review.id,
                rating: parseFloat(review.rates || 0),
                description: review.description,
                contentQuality: parseFloat(review.content_quality || 0),
                instructorSkills: parseFloat(review.instructor_skills || 0),
                purchaseWorth: parseFloat(review.purchase_worth || 0),
                supportQuality: parseFloat(review.support_quality || 0),
                status: review.status,
                createdAt: localDateTime,
                student: review.reviewer ? { // Changed from review.Creator to review.reviewer
                    id: review.reviewer.id,
                    name: review.reviewer.full_name,
                    avatar: review.reviewer.avatar
                } : {
                    id: null,
                    name: 'Anonymous',
                    avatar: null
                }
            };
        });

        // Pagination info
        const totalPages = Math.ceil(totalCount / parseInt(limit));
        const currentPage = parseInt(page);

        const pagination = {
            currentPage: currentPage,
            totalPages: totalPages,
            totalItems: totalCount,
            itemsPerPage: parseInt(limit),
            hasNextPage: currentPage < totalPages,
            hasPreviousPage: currentPage > 1
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher reviews retrieved successfully',
            data: {
                teacher: {
                    id: teacher.id,
                    name: teacher.full_name,
                    avatar: teacher.avatar,
                    headline: teacher.headline
                },
                reviews: formattedReviews,
                statistics: statistics,
                pagination: pagination,
                filters: {
                    sortBy: sort_by,
                    sortOrder: validSortOrder,
                    minRating: min_rating || null,
                    maxRating: max_rating || null,
                    fromDate: from_date || null,
                    toDate: to_date || null,
                    search: search || null
                }
            }
        });

    } catch (error) {
        console.error('Error fetching teacher reviews:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching teacher reviews',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    getTeacherReviews
};