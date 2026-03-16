// controller/admin/subscription.controller.js
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const SubscriptionPlan = require('../../models/subscription_plan');
const { Op, Sequelize } = require('sequelize');

// Duration Controllers
async function getDurations(req, res) {
    try {
        const durations = await SubscriptionDuration.findAll({
            attributes: ['id', 'name', 'months', 'status'],
            order: [['id', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Subscription durations fetched successfully',
            data: durations
        });
    } catch (err) {
        console.error('Error fetching durations:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch subscription durations',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function createDuration(req, res) {
    try {
        const { name, months, status } = req.body;

        // Validation
        if (!name || !months) {
            return res.status(400).json({
                status: 'error',
                message: 'Name and months are required'
            });
        }

        // Check if duration exists
        const existingDuration = await SubscriptionDuration.findOne({
            where: { name: name }
        });

        if (existingDuration) {
            return res.status(400).json({
                status: 'error',
                message: 'Duration with this name already exists'
            });
        }

        // Create duration
        const duration = await SubscriptionDuration.create({
            name,
            months,
            status: status || 'active',
            created_at: new Date(),
            updated_at: new Date()
        });

        return res.status(201).json({
            status: 'success',
            message: 'Subscription duration created successfully',
            data: duration
        });
    } catch (err) {
        console.error('Error creating duration:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create subscription duration',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateDuration(req, res) {
    try {
        const { id } = req.params;
        const { name, months, status } = req.body;

        // Find duration
        const duration = await SubscriptionDuration.findByPk(id);

        if (!duration) {
            return res.status(404).json({
                status: 'error',
                message: 'Duration not found'
            });
        }

        // Check if name already exists (except for this record)
        if (name && name !== duration.name) {
            const existingDuration = await SubscriptionDuration.findOne({
                where: { 
                    name: name,
                    id: { [Op.ne]: id }
                }
            });

            if (existingDuration) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Duration with this name already exists'
                });
            }
        }

        // Update duration
        await duration.update({
            name: name || duration.name,
            months: months || duration.months,
            status: status || duration.status,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Subscription duration updated successfully',
            data: duration
        });
    } catch (err) {
        console.error('Error updating duration:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update subscription duration',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function deleteDuration(req, res) {
    try {
        const { id } = req.params;

        // Find duration
        const duration = await SubscriptionDuration.findByPk(id);

        if (!duration) {
            return res.status(404).json({
                status: 'error',
                message: 'Duration not found'
            });
        }

        // Check if duration is used in any lesson lengths
        const lessonLengths = await LessonLength.findOne({
            where: { duration_id: id }
        });

        if (lessonLengths) {
            return res.status(400).json({
                status: 'error',
                message: 'Duration cannot be deleted as it is associated with lesson lengths'
            });
        }

        // Check if duration is used in any subscription plans
        const subscriptionPlans = await SubscriptionPlan.findOne({
            where: { duration_id: id }
        });

        if (subscriptionPlans) {
            return res.status(400).json({
                status: 'error',
                message: 'Duration cannot be deleted as it is associated with subscription plans'
            });
        }

        // Delete duration
        await duration.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Subscription duration deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting duration:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete subscription duration',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// Lesson Length Controllers
async function getLessonLengths(req, res) {
    try {
        const { duration_id } = req.query;
        
        const whereCondition = {};
        if (duration_id) {
            whereCondition.duration_id = duration_id;
        }

        const lessonLengths = await LessonLength.findAll({
            where: whereCondition,
            include: [{
                model: SubscriptionDuration,
                as: 'Duration',
                attributes: ['id', 'name']
            }],
            attributes: ['id', 'duration_id', 'minutes', 'status'],
            order: [['id', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Lesson lengths fetched successfully',
            data: lessonLengths
        });
    } catch (err) {
        console.error('Error fetching lesson lengths:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch lesson lengths',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function createLessonLength(req, res) {
    try {
        const { duration_id, minutes, status } = req.body;

        // Validation
        if (!duration_id || !minutes) {
            return res.status(400).json({
                status: 'error',
                message: 'Duration ID and minutes are required'
            });
        }

        // Check if duration exists
        const duration = await SubscriptionDuration.findByPk(duration_id);
        if (!duration) {
            return res.status(404).json({
                status: 'error',
                message: 'Duration not found'
            });
        }

        // Check if lesson length exists for this duration
        const existingLessonLength = await LessonLength.findOne({
            where: { 
                duration_id: duration_id,
                minutes: minutes
            }
        });

        if (existingLessonLength) {
            return res.status(400).json({
                status: 'error',
                message: 'Lesson length already exists for this duration'
            });
        }

        // Create lesson length
        const lessonLength = await LessonLength.create({
            duration_id,
            minutes,
            status: status || 'active',
            created_at: new Date(),
            updated_at: new Date()
        });

        return res.status(201).json({
            status: 'success',
            message: 'Lesson length created successfully',
            data: lessonLength
        });
    } catch (err) {
        console.error('Error creating lesson length:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create lesson length',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateLessonLength(req, res) {
    try {
        const { id } = req.params;
        const { duration_id, minutes, status } = req.body;

        // Find lesson length
        const lessonLength = await LessonLength.findByPk(id);

        if (!lessonLength) {
            return res.status(404).json({
                status: 'error',
                message: 'Lesson length not found'
            });
        }

        // If duration_id is provided, check if it exists
        if (duration_id) {
            const duration = await SubscriptionDuration.findByPk(duration_id);
            if (!duration) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Duration not found'
                });
            }
        }

        // Check if combination already exists (except for this record)
        if ((duration_id || minutes) && (duration_id !== lessonLength.duration_id || minutes !== lessonLength.minutes)) {
            const existingLessonLength = await LessonLength.findOne({
                where: { 
                    duration_id: duration_id || lessonLength.duration_id,
                    minutes: minutes || lessonLength.minutes,
                    id: { [Op.ne]: id }
                }
            });

            if (existingLessonLength) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Lesson length already exists for this duration'
                });
            }
        }

        // Update lesson length
        await lessonLength.update({
            duration_id: duration_id || lessonLength.duration_id,
            minutes: minutes || lessonLength.minutes,
            status: status || lessonLength.status,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Lesson length updated successfully',
            data: lessonLength
        });
    } catch (err) {
        console.error('Error updating lesson length:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update lesson length',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function deleteLessonLength(req, res) {
    try {
        const { id } = req.params;

        // Find lesson length
        const lessonLength = await LessonLength.findByPk(id);

        if (!lessonLength) {
            return res.status(404).json({
                status: 'error',
                message: 'Lesson length not found'
            });
        }

        // Check if lesson length is used in any lessons per month
        const lessonsPerMonth = await LessonsPerMonth.findOne({
            where: { lesson_length_id: id }
        });

        if (lessonsPerMonth) {
            return res.status(400).json({
                status: 'error',
                message: 'Lesson length cannot be deleted as it is associated with lessons per month'
            });
        }

        // Check if lesson length is used in any subscription plans
        const subscriptionPlans = await SubscriptionPlan.findOne({
            where: { lesson_length_id: id }
        });

        if (subscriptionPlans) {
            return res.status(400).json({
                status: 'error',
                message: 'Lesson length cannot be deleted as it is associated with subscription plans'
            });
        }

        // Delete lesson length
        await lessonLength.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Lesson length deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting lesson length:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete lesson length',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// Lessons Per Month Controllers
async function getLessonsPerMonth(req, res) {
    try {
        const { lesson_length_id } = req.query;
        
        const whereCondition = {};
        if (lesson_length_id) {
            whereCondition.lesson_length_id = lesson_length_id;
        }

        const lessonsPerMonth = await LessonsPerMonth.findAll({
            where: whereCondition,
            include: [{
                model: LessonLength,
                as: 'LessonLength',
                attributes: ['id', 'minutes'],
                include: [{
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name']
                }]
            }],
            attributes: ['id', 'lesson_length_id', 'lessons', 'status'],
            order: [['id', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Lessons per month fetched successfully',
            data: lessonsPerMonth
        });
    } catch (err) {
        console.error('Error fetching lessons per month:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch lessons per month',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function createLessonsPerMonth(req, res) {
    try {
        const { lesson_length_id, lessons, status } = req.body;

        // Validation
        if (!lesson_length_id || !lessons) {
            return res.status(400).json({
                status: 'error',
                message: 'Lesson length ID and lessons are required'
            });
        }

        // Check if lesson length exists
        const lessonLength = await LessonLength.findByPk(lesson_length_id);
        if (!lessonLength) {
            return res.status(404).json({
                status: 'error',
                message: 'Lesson length not found'
            });
        }

        // Check if lessons per month exists for this lesson length
        const existingLessonsPerMonth = await LessonsPerMonth.findOne({
            where: { 
                lesson_length_id: lesson_length_id,
                lessons: lessons
            }
        });

        if (existingLessonsPerMonth) {
            return res.status(400).json({
                status: 'error',
                message: 'Lessons per month already exists for this lesson length'
            });
        }

        // Create lessons per month
        const lessonsPerMonth = await LessonsPerMonth.create({
            lesson_length_id,
            lessons,
            status: status || 'active',
            created_at: new Date(),
            updated_at: new Date()
        });

        return res.status(201).json({
            status: 'success',
            message: 'Lessons per month created successfully',
            data: lessonsPerMonth
        });
    } catch (err) {
        console.error('Error creating lessons per month:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create lessons per month',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateLessonsPerMonth(req, res) {
    try {
        const { id } = req.params;
        const { lesson_length_id, lessons, status } = req.body;

        // Find lessons per month
        const lessonsPerMonth = await LessonsPerMonth.findByPk(id);

        if (!lessonsPerMonth) {
            return res.status(404).json({
                status: 'error',
                message: 'Lessons per month not found'
            });
        }

        // If lesson_length_id is provided, check if it exists
        if (lesson_length_id) {
            const lessonLength = await LessonLength.findByPk(lesson_length_id);
            if (!lessonLength) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Lesson length not found'
                });
            }
        }

        // Check if combination already exists (except for this record)
        if ((lesson_length_id || lessons) && (lesson_length_id !== lessonsPerMonth.lesson_length_id || lessons !== lessonsPerMonth.lessons)) {
            const existingLessonsPerMonth = await LessonsPerMonth.findOne({
                where: { 
                    lesson_length_id: lesson_length_id || lessonsPerMonth.lesson_length_id,
                    lessons: lessons || lessonsPerMonth.lessons,
                    id: { [Op.ne]: id }
                }
            });

            if (existingLessonsPerMonth) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Lessons per month already exists for this lesson length'
                });
            }
        }

        // Update lessons per month
        await lessonsPerMonth.update({
            lesson_length_id: lesson_length_id || lessonsPerMonth.lesson_length_id,
            lessons: lessons || lessonsPerMonth.lessons,
            status: status || lessonsPerMonth.status,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Lessons per month updated successfully',
            data: lessonsPerMonth
        });
    } catch (err) {
        console.error('Error updating lessons per month:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update lessons per month',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function deleteLessonsPerMonth(req, res) {
    try {
        const { id } = req.params;

        // Find lessons per month
        const lessonsPerMonth = await LessonsPerMonth.findByPk(id);

        if (!lessonsPerMonth) {
            return res.status(404).json({
                status: 'error',
                message: 'Lessons per month not found'
            });
        }

        // Check if lessons per month is used in any subscription plans
        const subscriptionPlans = await SubscriptionPlan.findOne({
            where: { lessons_per_month_id: id }
        });

        if (subscriptionPlans) {
            return res.status(400).json({
                status: 'error',
                message: 'Lessons per month cannot be deleted as it is associated with subscription plans'
            });
        }

        // Delete lessons per month
        await lessonsPerMonth.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Lessons per month deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting lessons per month:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete lessons per month',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// Subscription Plan Controllers
async function getSubscriptionPlans(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            duration_id,
            lesson_length_id,
            lessons_per_month_id,
            status
        } = req.query;

        // Where conditions
        const whereConditions = {};
        
        if (duration_id) {
            whereConditions.duration_id = duration_id;
        }
        
        if (lesson_length_id) {
            whereConditions.lesson_length_id = lesson_length_id;
        }
        
        if (lessons_per_month_id) {
            whereConditions.lessons_per_month_id = lessons_per_month_id;
        }
        
        if (status && status.toLowerCase() !== 'all') {
            whereConditions.status = status;
        }

        // Query options
        const queryOptions = {
            where: whereConditions,
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name']
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    attributes: ['id', 'minutes']
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    attributes: ['id', 'lessons']
                }
            ],
            attributes: [
                'id', 'name', 'duration_id', 'lesson_length_id', 
                'lessons_per_month_id', 'price', 'status'
            ],
            order: [['id', 'ASC']],
            offset: (page - 1) * limit,
            limit: parseInt(limit),
            distinct: true
        };

        // Execute query
        const { count, rows } = await SubscriptionPlan.findAndCountAll(queryOptions);

        return res.status(200).json({
            status: 'success',
            message: 'Subscription plans fetched successfully',
            data: {
                plans: rows,
                pagination: {
                    total: count,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(count / limit),
                    per_page: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Error fetching subscription plans:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch subscription plans',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function getSubscriptionPlan(req, res) {
    try {
        const { id } = req.params;

        const plan = await SubscriptionPlan.findByPk(id, {
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months']
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    attributes: ['id', 'minutes']
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    attributes: ['id', 'lessons']
                }
            ],
            attributes: [
                'id', 'name', 'duration_id', 'lesson_length_id', 
                'lessons_per_month_id', 'price', 'status'
            ]
        });

        if (!plan) {
            return res.status(404).json({
                status: 'error',
                message: 'Subscription plan not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Subscription plan fetched successfully',
            data: plan
        });
    } catch (err) {
        console.error('Error fetching subscription plan:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch subscription plan',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function createSubscriptionPlan(req, res) {
    try {
        const { name, duration_id, lesson_length_id, lessons_per_month_id, price, status } = req.body;

        // Validation
        if (!name || !duration_id || !lesson_length_id || !lessons_per_month_id || !price) {
            return res.status(400).json({
                status: 'error',
                message: 'Name, duration ID, lesson length ID, lessons per month ID, and price are required'
            });
        }

        // Check if duration exists
        const duration = await SubscriptionDuration.findByPk(duration_id);
        if (!duration) {
            return res.status(404).json({
                status: 'error',
                message: 'Duration not found'
            });
        }

        // Check if lesson length exists
        const lessonLength = await LessonLength.findByPk(lesson_length_id);
        if (!lessonLength) {
            return res.status(404).json({
                status: 'error',
                message: 'Lesson length not found'
            });
        }

        // Check if lessons per month exists
        const lessonsPerMonth = await LessonsPerMonth.findByPk(lessons_per_month_id);
        if (!lessonsPerMonth) {
            return res.status(404).json({
                status: 'error',
                message: 'Lessons per month not found'
            });
        }

        // Check if subscription plan with same combination exists
        const existingPlan = await SubscriptionPlan.findOne({
            where: { 
                duration_id,
                lesson_length_id,
                lessons_per_month_id
            }
        });

        if (existingPlan) {
            return res.status(400).json({
                status: 'error',
                message: 'Subscription plan with this combination already exists'
            });
        }

        // Create subscription plan
        const plan = await SubscriptionPlan.create({
            name,
            duration_id,
            lesson_length_id,
            lessons_per_month_id,
            price,
            status: status || 'active',
            created_at: new Date(),
            updated_at: new Date()
        });

        return res.status(201).json({
            status: 'success',
            message: 'Subscription plan created successfully',
            data: plan
        });
    } catch (err) {
        console.error('Error creating subscription plan:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create subscription plan',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateSubscriptionPlan(req, res) {
    try {
        const { id } = req.params;
        const { name, duration_id, lesson_length_id, lessons_per_month_id, price, status } = req.body;

        // Find subscription plan
        const plan = await SubscriptionPlan.findByPk(id);

        if (!plan) {
            return res.status(404).json({
                status: 'error',
                message: 'Subscription plan not found'
            });
        }

        // Check references if provided
        if (duration_id) {
            const duration = await SubscriptionDuration.findByPk(duration_id);
            if (!duration) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Duration not found'
                });
            }
        }

        if (lesson_length_id) {
            const lessonLength = await LessonLength.findByPk(lesson_length_id);
            if (!lessonLength) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Lesson length not found'
                });
            }
        }

        if (lessons_per_month_id) {
            const lessonsPerMonth = await LessonsPerMonth.findByPk(lessons_per_month_id);
            if (!lessonsPerMonth) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Lessons per month not found'
                });
            }
        }

        // Check if combination already exists (except for this record)
        if (duration_id || lesson_length_id || lessons_per_month_id) {
            const existingPlan = await SubscriptionPlan.findOne({
                where: { 
                    duration_id: duration_id || plan.duration_id,
                    lesson_length_id: lesson_length_id || plan.lesson_length_id,
                    lessons_per_month_id: lessons_per_month_id || plan.lessons_per_month_id,
                    id: { [Op.ne]: id }
                }
            });

            if (existingPlan) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Subscription plan with this combination already exists'
                });
            }
        }

        // Update subscription plan
        await plan.update({
            name: name || plan.name,
            duration_id: duration_id || plan.duration_id,
            lesson_length_id: lesson_length_id || plan.lesson_length_id,
            lessons_per_month_id: lessons_per_month_id || plan.lessons_per_month_id,
            price: price || plan.price,
            status: status || plan.status,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Subscription plan updated successfully',
            data: plan
        });
    } catch (err) {
        console.error('Error updating subscription plan:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update subscription plan',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function deleteSubscriptionPlan(req, res) {
    try {
        const { id } = req.params;

        // Find subscription plan
        const plan = await SubscriptionPlan.findByPk(id);

        if (!plan) {
            return res.status(404).json({
                status: 'error',
                message: 'Subscription plan not found'
            });
        }

        // Check if plan is used in any user subscriptions
        const userSubscriptions = await UserSubscriptionDetails.findOne({
            where: { plan_id: id }
        });

        if (userSubscriptions) {
            return res.status(400).json({
                status: 'error',
                message: 'Subscription plan cannot be deleted as it is associated with user subscriptions'
            });
        }

        // Delete subscription plan
        await plan.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Subscription plan deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting subscription plan:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete subscription plan',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// User Subscription Functions
async function assignSubscription(req, res) {
    try {
        const { user_id, plan_id, renew_date, left_lessons, balance, cost_per_lesson } = req.body;

        // Validation
        if (!user_id || !plan_id) {
            return res.status(400).json({
                status: 'error',
                message: 'User ID and Plan ID are required'
            });
        }

        // Check if user exists
        const user = await User.findOne({
            where: {
                id: user_id,
                role_name: 'user'
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Check if plan exists
        const plan = await SubscriptionPlan.findByPk(plan_id, {
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    attributes: ['id', 'name', 'months']
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    attributes: ['id', 'minutes']
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    attributes: ['id', 'lessons']
                }
            ]
        });

        if (!plan) {
            return res.status(404).json({
                status: 'error',
                message: 'Subscription plan not found'
            });
        }

        // Calculate renew date if not provided
        let renewDate = renew_date ? new Date(renew_date) : new Date();
        if (!renew_date) {
            renewDate.setMonth(renewDate.getMonth() + plan.Duration.months);
        }

        // Calculate left lessons if not provided
        const calculatedLeftLessons = left_lessons !== undefined ? 
            left_lessons : 
            (plan.LessonsPerMonth.lessons * plan.Duration.months);

        // Create user subscription
        const userSubscription = await UserSubscriptionDetails.create({
            user_id,
            plan_id,
            type: plan.Duration.name,
            each_lesson: plan.Duration.months,
            renew_date: renewDate,
            weekly_comp_class: 0, // Default values, can be updated later
            weekly_lesson: plan.LessonsPerMonth.lessons,
            status: 'active',
            lesson_min: plan.LessonLength.minutes,
            left_lessons: calculatedLeftLessons,
            balance: balance || 0,
            cost_per_lesson: cost_per_lesson || (plan.price / (plan.LessonsPerMonth.lessons * plan.Duration.months)),
            created_at: new Date(),
            updated_at: new Date()
        });

        // Update user status to active if it's not
        if (user.status !== 'active') {
            await user.update({
                status: 'active',
                updated_at: Math.floor(Date.now() / 1000)
            });
        }

        return res.status(201).json({
            status: 'success',
            message: 'Subscription assigned to user successfully',
            data: userSubscription
        });
    } catch (err) {
        console.error('Error assigning subscription:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to assign subscription',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function updateUserSubscription(req, res) {
    try {
        const { id } = req.params;
        const { plan_id, renew_date, left_lessons, status, balance, cost_per_lesson } = req.body;

        // Find user subscription
        const subscription = await UserSubscriptionDetails.findByPk(id);

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User subscription not found'
            });
        }

        // If plan_id is provided, check if it exists
        let plan;
        if (plan_id) {
            plan = await SubscriptionPlan.findByPk(plan_id, {
                include: [
                    {
                        model: SubscriptionDuration,
                        as: 'Duration',
                        attributes: ['id', 'name', 'months']
                    },
                    {
                        model: LessonLength,
                        as: 'LessonLength',
                        attributes: ['id', 'minutes']
                    },
                    {
                        model: LessonsPerMonth,
                        as: 'LessonsPerMonth',
                        attributes: ['id', 'lessons']
                    }
                ]
            });

            if (!plan) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Subscription plan not found'
                });
            }
        }

        // Update subscription details
        const updateData = {};
        
        if (plan_id) {
            updateData.plan_id = plan_id;
            updateData.type = plan.Duration.name;
            updateData.each_lesson = plan.Duration.months;
            updateData.weekly_lesson = plan.LessonsPerMonth.lessons;
            updateData.lesson_min = plan.LessonLength.minutes;
        }
        
        if (renew_date) {
            updateData.renew_date = new Date(renew_date);
        }
        
        if (left_lessons !== undefined) {
            updateData.left_lessons = left_lessons;
        }
        
        if (status) {
            updateData.status = status;
        }
        
        if (balance !== undefined) {
            updateData.balance = balance;
        }
        
        if (cost_per_lesson !== undefined) {
            updateData.cost_per_lesson = cost_per_lesson;
        }
        
        updateData.updated_at = new Date();
        
        await subscription.update(updateData);

        return res.status(200).json({
            status: 'success',
            message: 'User subscription updated successfully',
            data: subscription
        });
    } catch (err) {
        console.error('Error updating user subscription:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update user subscription',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function cancelUserSubscription(req, res) {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Find user subscription
        const subscription = await UserSubscriptionDetails.findByPk(id, {
            include: [{
                model: User,
                as: 'User',
                attributes: ['id', 'full_name', 'email', 'status']
            }]
        });

        if (!subscription) {
            return res.status(404).json({
                status: 'error',
                message: 'User subscription not found'
            });
        }

        // Update subscription status
        await subscription.update({
            status: 'inactive',
            updated_at: new Date()
        });

        // Check if user has any active subscriptions
        const activeSubscriptions = await UserSubscriptionDetails.findOne({
            where: {
                user_id: subscription.user_id,
                status: 'active',
                id: { [Op.ne]: id }
            }
        });

        // If no active subscriptions, inactivate the user
        if (!activeSubscriptions && subscription.User.status === 'active') {
            await User.update(
                {
                    status: 'inactive',
                    updated_at: Math.floor(Date.now() / 1000),
                    offline: true,
                    offline_message: reason || 'Subscription canceled'
                },
                {
                    where: { id: subscription.user_id }
                }
            );
        }

        return res.status(200).json({
            status: 'success',
            message: 'User subscription canceled successfully'
        });
    } catch (err) {
        console.error('Error canceling user subscription:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to cancel user subscription',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

module.exports = {
    // Duration endpoints
    getDurations,
    createDuration,
    updateDuration,
    deleteDuration,
    
    // Lesson Length endpoints
    getLessonLengths,
    createLessonLength,
    updateLessonLength,
    deleteLessonLength,
    
    // Lessons Per Month endpoints
    getLessonsPerMonth,
    createLessonsPerMonth,
    updateLessonsPerMonth,
    deleteLessonsPerMonth,
    
    // Subscription Plan endpoints
    getSubscriptionPlans,
    getSubscriptionPlan,
    createSubscriptionPlan,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
    
    // User Subscription endpoints
    assignSubscription,
    updateUserSubscription,
    cancelUserSubscription
};