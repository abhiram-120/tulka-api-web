// controller/teacher/classes.controller.js
const moment = require('moment');
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const Class = require('../../models/classes');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Homework = require('../../models/homework');
const UserReview = require('../../models/userReviews');
const Feedback = require('../../models/lessonFeedback');
const TeacherHoliday = require('../../models/teacherHoliday');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialClassEvaluation = require('../../models/TrialClassEvaluation');
const RegularClass = require('../../models/regularClass');
const TeacherAvailability = require('../../models/teacherAvailability');
const StudentClassQuery = require('../../models/studentClassQuery');    

/**
 * Get the teacher's dashboard information including upcoming classes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacherDashboard = async (req, res) => {
    try {
        // Get teacher ID from authenticated user
        const teacherId = req.user.id;
        
        // Get current date and time in UTC
        const now = moment.utc();
        
        // Find the next class (first upcoming class)
        const nextClass = await Class.findOne({
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.gt]: now.format()
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                },
                is_regular_hide: 0  // Added filter
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [
                ['meeting_start', 'ASC']
            ]
        });
        
        // Find classes scheduled for today
        const todayStart = now.clone().startOf('day');
        const todayEnd = now.clone().endOf('day');
        
        const todayClasses = await Class.count({
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.between]: [todayStart.format(), todayEnd.format()]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                },
                is_regular_hide: 0  // Added filter
            }
        });
        
        // Get today's classes data
        const todayClassesData = await Class.findAll({
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.between]: [todayStart.format(), todayEnd.format()]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                },
                is_regular_hide: 0  // Added filter
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [
                ['meeting_start', 'ASC']
            ]
        });
        
        // Format today's classes
        const formattedTodayClasses = await Promise.all(todayClassesData.map(async cls => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            const duration = endTime.diff(startTime, 'minutes');
            
            // Calculate minutes remaining to class start
            const minutesRemaining = startTime.diff(now, 'minutes');
            
            // If it's a trial class, get student details from TrialClassRegistration
            let studentDetails = {
                id: cls.Student?.id,
                name: cls.Student?.full_name || 'Student',
                avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
            };
            
            if (cls.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: cls.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentDetails = {
                        id: null, // Trial students might not have a user ID yet
                        name: trialRegistration.student_name || 'Trial Student',
                        avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
                    };
                }
            }

            const isInProgress = now.isBetween(startTime, endTime);
            const isCompleted = now.isAfter(endTime);
            
            return {
                id: cls.id,
                title: cls.class_type === 'regular' ? 'Regular Class' : (cls.is_trial ? 'Trial Class' : 'Class'),
                student: studentDetails,
                duration: duration,
                goal: cls.student_goal || '',
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                start_datetime: startTime.format(),
                end_datetime: endTime.format(),
                minutes_remaining: minutesRemaining > 0 ? minutesRemaining : 0,
                // status: cls.status,
                status: isCompleted
                    ? 'ended'
                    : isInProgress
                    ? 'in_progress'
                    : 'pending',
                join_url: cls.join_url || null,
                is_trial: !!cls.is_trial,
                is_regular: cls.class_type === 'regular',
                // in_progress: now >= startTime && now <= endTime
                in_progress: isInProgress,
                completed: isCompleted
            };
        }));
        
        // Get teacher stats
        const totalCompletedClasses = await Class.count({
            where: {
                teacher_id: teacherId,
                status: 'completed',
                is_regular_hide: 0  // Added filter
            }
        });
        
        const totalScheduledClasses = await Class.count({
            where: {
                teacher_id: teacherId,
                status: {
                    [Op.in]: ['scheduled', 'pending', 'confirmed']
                },
                is_regular_hide: 0  // Added filter
            }
        });
        
        // Calculate completion rate
        const completionRate = totalScheduledClasses > 0 
            ? Math.round((totalCompletedClasses / (totalCompletedClasses + totalScheduledClasses)) * 100) 
            : 0;
        
        // Get comprehensive teacher data from users table
        const teacherData = await User.findOne({
            where: { id: teacherId },
            attributes: [
                'id', 
                'full_name', 
                'avatar', 
                'bio', 
                'email',
                'mobile',
                'country_code',
                'timezone',
                'language',
                'headline',
                'total_hours',
                [sequelize.literal('(SELECT ROUND(AVG((instructor_skills + content_quality + support_quality + purchase_worth) / 4), 1) FROM user_reviews WHERE instructor_id = User.id AND status = "active")'), 'rating'],
                [sequelize.literal('(SELECT COUNT(*) FROM classes WHERE teacher_id = User.id AND is_regular_hide = 0)'), 'total_classes']  // Added filter to subquery
            ],
            raw: true
        });
        
        // Get teacher reviews and metrics
        const reviews = await UserReview.findAll({
            where: {
                instructor_id: teacherId,
                // status: 'active'
            },
            limit: 5,
            order: [['created_at', 'DESC']]
        });
        
        // Calculate detailed review metrics
        const reviewMetrics = {
            avgInstructorSkills: 0,
            avgContentQuality: 0,
            avgSupportQuality: 0,
            avgPurchaseWorth: 0,
            totalReviews: 0
        };
        const allReviews = await UserReview.findAll({
            where: {
                instructor_id: teacherId,
                // status: 'active'
            }
        });
        if (allReviews.length > 0) {
            reviewMetrics.totalReviews = allReviews.length;
            reviewMetrics.avgInstructorSkills = (allReviews.reduce((sum, review) => sum + review.instructor_skills, 0) / allReviews.length).toFixed(1);
            reviewMetrics.avgContentQuality = (allReviews.reduce((sum, review) => sum + review.content_quality, 0) / allReviews.length).toFixed(1);
            reviewMetrics.avgSupportQuality = (allReviews.reduce((sum, review) => sum + review.support_quality, 0) / allReviews.length).toFixed(1);
            reviewMetrics.avgPurchaseWorth = (allReviews.reduce((sum, review) => sum + review.purchase_worth, 0) / allReviews.length).toFixed(1);
        }
        
        // Find next class after the immediate next class
        let nextAfterCurrentClass = null;
        if (nextClass) {
            nextAfterCurrentClass = await Class.findOne({
                where: {
                    teacher_id: teacherId,
                    meeting_start: {
                        [Op.gt]: nextClass.meeting_end
                    },
                    status: {
                        [Op.notIn]: ['canceled', 'rejected']
                    },
                    is_regular_hide: 0  // Added filter
                },
                include: [
                    {
                        model: User,
                        as: 'Student',
                        attributes: ['id', 'full_name']
                    }
                ],
                order: [
                    ['meeting_start', 'ASC']
                ]
            });
        }
        
        // Format next class data
        let formattedNextClass = null;
        if (nextClass) {
            const startTime = moment.utc(nextClass.meeting_start);
            const endTime = moment.utc(nextClass.meeting_end);
            const duration = endTime.diff(startTime, 'minutes');
            
            // Calculate minutes remaining
            const minutesRemaining = startTime.diff(now, 'minutes');
            
            // If it's a trial class, get student details from TrialClassRegistration
            let studentDetails = {
                id: nextClass.Student?.id,
                name: nextClass.Student?.full_name || 'Student',
                avatar: nextClass.Student?.avatar ? `https://tulkka.com${nextClass.Student?.avatar}` : null
            };
            
            if (nextClass.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: nextClass.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentDetails = {
                        id: null, // Trial students might not have a user ID yet
                        name: trialRegistration.student_name || 'Trial Student',
                        avatar: nextClass.Student?.avatar ? `https://tulkka.com${nextClass.Student?.avatar}` : null
                    };
                }
            }
            
            formattedNextClass = {
                id: nextClass.id,
                title: nextClass.class_type === 'regular' ? 'Regular Class' : (nextClass.is_trial ? 'Trial Class' : 'Class'),
                student: studentDetails,
                duration: duration,
                goal: nextClass.student_goal || '',
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                start_datetime: startTime.format(),
                end_datetime: endTime.format(),
                minutes_remaining: minutesRemaining > 0 ? minutesRemaining : 0,
                join_url: nextClass.join_url || null,
                has_files: false, // This would need to be implemented with file attachments logic
                has_messages: false // This would need message checking logic
            };
            
            // Check if there are homework assignments for this class
            const homeworkExists = await Homework.findOne({
                where: {
                    lesson_id: nextClass.id,
                    teacher_id: teacherId
                }
            });
            
            formattedNextClass.has_files = !!homeworkExists;
        }

        // Get recent completed classes with feedback
        const recentCompletedClasses = await Class.findAll({
            where: {
                teacher_id: teacherId,
                status: 'completed',
                feedback_id: {
                    [Op.not]: null
                },
                is_regular_hide: 0  // Added filter
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'avatar']
                }
            ],
            order: [
                ['meeting_end', 'DESC']
            ],
            limit: 5
        });

        const formattedCompletedClasses = await Promise.all(recentCompletedClasses.map(async cls => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            
            // If it's a trial class, get student details from TrialClassRegistration
            let studentDetails = {
                id: cls.Student?.id,
                name: cls.Student?.full_name || 'Student',
                avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
            };
            
            if (cls.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: cls.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentDetails = {
                        id: null,
                        name: trialRegistration.student_name || 'Trial Student',
                        avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
                    };
                }
            }
            
            return {
                id: cls.id,
                title: cls.class_type === 'regular' ? 'Regular Class' : (cls.is_trial ? 'Trial Class' : 'Class'),
                student: studentDetails,
                date: startTime.format('YYYY-MM-DD'),
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                feedback_id: cls.feedback_id
            };
        }));

        // If nextAfterCurrentClass is a trial class, get student name from TrialClassRegistration
        let nextAfterCurrentDetails = null;
        if (nextAfterCurrentClass) {
            let studentName = nextAfterCurrentClass.Student?.full_name || 'Student';
            
            if (nextAfterCurrentClass.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: nextAfterCurrentClass.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentName = trialRegistration.student_name || 'Trial Student';
                }
            }
            
            nextAfterCurrentDetails = {
                student_name: studentName,
                start_time: moment.utc(nextAfterCurrentClass.meeting_start).format('h:mm A')
            };
        }

        const OVERDUE_THRESHOLD_HOURS = process.env.TASK_OVERDUE_HOURS || 24;
        const DUE_SOON_THRESHOLD_HOURS = process.env.TASK_DUE_SOON_HOURS || 6;
        const MAX_URGENT_TASK_AGE_DAYS = 3; // Only show urgent tasks from last 3 days
        
        // Get completed classes for pending tasks (last 3 days for urgent view)
        const recentCompletedClassesForTasks = await Class.findAll({
            where: {
                teacher_id: teacherId,
                status: {
                    [Op.in]: ['ended', 'completed']
                },
                meeting_end: {
                    [Op.lt]: now.format(),
                    [Op.gte]: now.clone().subtract(MAX_URGENT_TASK_AGE_DAYS, 'days').format()
                },
                is_regular_hide: 0,
                is_present: 1 
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'avatar']
                }
            ],
            order: [['meeting_end', 'DESC']],
            limit: 15 // Limit for performance
        });

        const urgentTasks = [];
        let absentClassesExcluded = 0;
        
        // Process each completed class to check for missing tasks
        for (const cls of recentCompletedClassesForTasks) {
        
            if (!cls.is_present || cls.is_present === 0) {
                absentClassesExcluded++;
                console.log(`Skipping absent class ${cls.id} - student was not present`);
                continue;
            }

            const classEndTime = moment.utc(cls.meeting_end);
            const hoursAfterClass = now.diff(classEndTime, 'hours');
            
            // Skip very old tasks in urgent view
            if (hoursAfterClass > 72) continue;
            
            // Parallel check for existing feedback and homework
            const [feedback, homework, trialRegistration] = await Promise.all([
                Feedback.findOne({
                    where: { lesson_id: cls.id }
                }),
                Homework.findOne({
                    where: { 
                        lesson_id: cls.id,
                        teacher_id: teacherId 
                    }
                }),
                cls.is_trial && cls.demo_class_id ? 
                    TrialClassRegistration.findOne({
                        where: { id: cls.demo_class_id }
                    }) : null
            ]);
            
            // Determine student name (handle trial classes)
            let studentName = cls.Student?.full_name || 'Student';
            if (trialRegistration) {
                studentName = trialRegistration.student_name;
            }
            
            // Calculate time-based status
            const isOverdue = hoursAfterClass > OVERDUE_THRESHOLD_HOURS;
            const isDueSoon = hoursAfterClass > (OVERDUE_THRESHOLD_HOURS - DUE_SOON_THRESHOLD_HOURS);
            
            let timeStatus;
            if (isOverdue) {
                const overdueHours = Math.floor(hoursAfterClass - OVERDUE_THRESHOLD_HOURS);
                timeStatus = overdueHours > 24 ? 
                    `Overdue by ${Math.floor(overdueHours / 24)}d` :
                    `Overdue by ${overdueHours}h`;
            } else {
                const remainingHours = Math.floor(OVERDUE_THRESHOLD_HOURS - hoursAfterClass);
                timeStatus = remainingHours < 1 ? 
                    'Due very soon' : 
                    `${remainingHours}h remaining`;
            }
            
            // Create feedback task if missing
            if (!feedback) {
                urgentTasks.push({
                    id: cls.id,
                    type: 'feedback',
                    studentName: studentName,
                    lessonDate: classEndTime.format('YYYY-MM-DD'),
                    lessonTime: classEndTime.format('HH:mm'),
                    subject: cls.student_goal || (cls.is_trial ? 'Trial Class Evaluation' : 'Regular Class'),
                    remainingTime: timeStatus,
                    isOverdue: isOverdue,
                    isDueSoon: isDueSoon && !isOverdue,
                    hoursAfterClass: hoursAfterClass,
                    isTrialClass: !!cls.is_trial,
                    priority: isOverdue ? 'high' : (isDueSoon ? 'medium' : 'low'),
                    classType: cls.is_trial ? 'trial' : 'regular',
                    isPresent: cls.is_present
                });
            }
            
            // Create homework task if missing (skip for trial classes)
            if (!homework && !cls.is_trial) {
                urgentTasks.push({
                    id: cls.id,
                    type: 'homework',
                    studentName: studentName,
                    lessonDate: classEndTime.format('YYYY-MM-DD'),
                    lessonTime: classEndTime.format('HH:mm'),
                    subject: cls.student_goal || 'Regular Class',
                    remainingTime: timeStatus,
                    isOverdue: isOverdue,
                    isDueSoon: isDueSoon && !isOverdue,
                    hoursAfterClass: hoursAfterClass,
                    isTrialClass: false,
                    priority: isOverdue ? 'high' : (isDueSoon ? 'medium' : 'low'),
                    classType: 'regular',
                    isPresent: cls.is_present
                });
            }
        }
        
        // Sort urgent tasks by priority and urgency
        urgentTasks.sort((a, b) => {
            // First sort by overdue status
            if (a.isOverdue && !b.isOverdue) return -1;
            if (!a.isOverdue && b.isOverdue) return 1;
            
            // Then by hours after class (most urgent first)
            return b.hoursAfterClass - a.hoursAfterClass;
        });
        
        // Calculate task summary statistics
        const taskSummary = {
            total_urgent: urgentTasks.length,
            overdue_count: urgentTasks.filter(t => t.isOverdue).length,
            due_soon_count: urgentTasks.filter(t => t.isDueSoon).length,
            feedback_missing: urgentTasks.filter(t => t.type === 'feedback').length,
            homework_missing: urgentTasks.filter(t => t.type === 'homework').length,
            high_priority: urgentTasks.filter(t => t.priority === 'high').length,
            trial_tasks: urgentTasks.filter(t => t.isTrialClass).length,
            regular_tasks: urgentTasks.filter(t => !t.isTrialClass).length,
            absent_classes_excluded: absentClassesExcluded
        };

        console.log(`Dashboard: Generated ${urgentTasks.length} urgent tasks for teacher ${teacherId}`, taskSummary);

        return res.status(200).json({
            status: 'success',
            data: {
                current_time: now.format(),
                today_classes: todayClasses,
                today_classes_data: formattedTodayClasses,
                teacher: {
                    id: teacherData.id,
                    name: teacherData.full_name,
                    avatar: teacherData.avatar,
                    bio: teacherData.bio,
                    email: teacherData.email,
                    mobile: teacherData.mobile,
                    country_code: teacherData.country_code,
                    timezone: teacherData.timezone,
                    language: teacherData.language,
                    headline: teacherData.headline,
                    total_hours: teacherData.total_hours
                },
                teacher_stats: {
                    rating: teacherData?.rating || '0.0',
                    total_classes: teacherData?.total_classes || 0,
                    completion_rate: completionRate,
                    total_completed_classes: totalCompletedClasses,
                    total_scheduled_classes: totalScheduledClasses
                },
                review_metrics: reviewMetrics,
                recent_reviews: reviews.map(review => ({
                    id: review.id,
                    creator_id: review.creator_id,
                    instructor_skills: review.instructor_skills,
                    content_quality: review.content_quality,
                    support_quality: review.support_quality,
                    purchase_worth: review.purchase_worth,
                    description: review.description,
                    created_at: review.created_at
                })),
                recent_completed_classes: formattedCompletedClasses,
                next_class: formattedNextClass,
                next_after_current: nextAfterCurrentDetails,
                
                // ====== NEW: AUTO-GENERATED PENDING TASKS ======
                urgent_tasks: urgentTasks.slice(0, 5), // Top 5 most urgent tasks
                pending_tasks_count: urgentTasks.length,
                task_summary: taskSummary,
                task_config: {
                    overdue_threshold_hours: OVERDUE_THRESHOLD_HOURS,
                    due_soon_threshold_hours: DUE_SOON_THRESHOLD_HOURS,
                    max_urgent_age_days: MAX_URGENT_TASK_AGE_DAYS,
                    auto_clear_enabled: true,
                    exclude_absent_classes: true
                }
            }
        });
    } catch (error) {
        console.error('Error in getTeacherDashboard:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get class details by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getClassDetails = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        
        if (!classId) {
            return res.status(400).json({
                status: 'error',
                message: 'Class ID is required'
            });
        }
        
        // Find the class
        const classDetails = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar', 'timezone']
                }
            ]
        });
        
        if (!classDetails) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you do not have permission to view it'
            });
        }
        
        // Get homework for this class
        const homeworkAssignments = await Homework.findAll({
            where: {
                lesson_id: classId,
                teacher_id: teacherId
            }
        });
        
        // Format the class details
        const startTime = moment.utc(classDetails.meeting_start);
        const endTime = moment.utc(classDetails.meeting_end);
        const duration = endTime.diff(startTime, 'minutes');
        
        const formattedClassDetails = {
            id: classDetails.id,
            title: classDetails.class_type === 'regular' ? 'Regular Class' : (classDetails.is_trial ? 'Trial Class' : 'Class'),
            student: {
                id: classDetails.Student?.id,
                name: classDetails.Student?.full_name || 'Student',
                email: classDetails.Student?.email || '',
                avatar: classDetails.Student?.avatar || null,
                timezone: classDetails.Student?.timezone || 'UTC'
            },
            duration: duration,
            goal: classDetails.student_goal || '',
            goal_notes: classDetails.student_goal_note || '',
            date: startTime.format('YYYY-MM-DD'),
            day: startTime.format('dddd'),
            start_time: startTime.format('h:mm A'),
            end_time: endTime.format('h:mm A'),
            start_datetime: startTime.format(),
            end_datetime: endTime.format(),
            status: classDetails.status,
            join_url: classDetails.join_url || null,
            admin_url: classDetails.admin_url || null,
            is_trial: !!classDetails.is_trial,
            is_regular: classDetails.class_type === 'regular',
            homework: homeworkAssignments.map(hw => ({
                id: hw.id,
                title: hw.title || 'Homework',
                description: hw.description || '',
                status: hw.status || 'pending',
                attachment: hw.attachment || null
            }))
        };
        
        return res.status(200).json({
            status: 'success',
            data: formattedClassDetails
        });
    } catch (error) {
        console.error('Error in getClassDetails:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get completed classes history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCompletedClasses = async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        // Get pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // Get date range filters if provided
        const startDate = req.query.start_date ? moment.utc(req.query.start_date).startOf('day') : null;
        const endDate = req.query.end_date ? moment.utc(req.query.end_date).endOf('day') : null;
        
        // Build the where clause
        const whereClause = {
            teacher_id: teacherId,
            status: 'completed'
        };
        
        // Add date filters if provided
        if (startDate && endDate) {
            whereClause.meeting_start = {
                [Op.between]: [startDate.format(), endDate.format()]
            };
        } else if (startDate) {
            whereClause.meeting_start = {
                [Op.gte]: startDate.format()
            };
        } else if (endDate) {
            whereClause.meeting_start = {
                [Op.lte]: endDate.format()
            };
        }
        
        // Get completed classes
        const completedClasses = await Class.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'avatar']
                }
            ],
            order: [
                ['meeting_start', 'DESC']
            ],
            limit,
            offset
        });
        
        // Format the classes
        const formattedClasses = completedClasses.rows.map(cls => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            const duration = endTime.diff(startTime, 'minutes');
            
            return {
                id: cls.id,
                title: cls.class_type === 'regular' ? 'Regular Class' : (cls.is_trial ? 'Trial Class' : 'Class'),
                student: {
                    id: cls.Student?.id,
                    name: cls.Student?.full_name || 'Student',
                    avatar: cls.Student?.avatar || null
                },
                duration: duration,
                date: startTime.format('YYYY-MM-DD'),
                day: startTime.format('dddd'),
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                is_trial: !!cls.is_trial,
                feedback_id: cls.feedback_id || null,
                has_feedback: !!cls.feedback_id
            };
        });
        
        // Calculate pagination info
        const totalItems = completedClasses.count;
        const totalPages = Math.ceil(totalItems / limit);
        
        return res.status(200).json({
            status: 'success',
            data: {
                classes: formattedClasses,
                pagination: {
                    total_items: totalItems,
                    total_pages: totalPages,
                    current_page: page,
                    items_per_page: limit
                }
            }
        });
    } catch (error) {
        console.error('Error in getCompletedClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all upcoming classes for the teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUpcomingClasses = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const now = moment.utc();
        
        // Get pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // Find upcoming classes
        const upcomingClasses = await Class.findAndCountAll({
            where: {
                teacher_id: teacherId,
                is_regular_hide: 0,
                meeting_start: {
                    [Op.gt]: now.format()
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [
                ['meeting_start', 'ASC']
            ],
            limit,
            offset
        });
        
        // Format the classes with proper student details for both regular and trial classes
        const formattedClasses = await Promise.all(upcomingClasses.rows.map(async cls => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            const duration = endTime.diff(startTime, 'minutes');
            
            // Calculate minutes remaining to class start
            const minutesRemaining = startTime.diff(now, 'minutes');
            
            // If it's a trial class, get student details from TrialClassRegistration
            let studentDetails = {
                id: cls.Student?.id,
                name: cls.Student?.full_name || 'Student',
                avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
            };
            
            if (cls.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: cls.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentDetails = {
                        id: null, // Trial students might not have a user ID yet
                        name: trialRegistration.student_name || 'Trial Student',
                        avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
                    };
                }
            }
            
            return {
                id: cls.id,
                title: cls.class_type === 'regular' ? 'Regular Class' : (cls.is_trial ? 'Trial Class' : 'Class'),
                student: studentDetails,
                duration: duration,
                goal: cls.student_goal || '',
                date: startTime.format('YYYY-MM-DD'),
                day: startTime.format('dddd'),
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                start_datetime: startTime.format(),
                end_datetime: endTime.format(),
                minutes_remaining: minutesRemaining > 0 ? minutesRemaining : 0,
                status: cls.status,
                join_url: cls.join_url || null,
                is_trial: !!cls.is_trial,
                is_regular: cls.class_type === 'regular'
            };
        }));
        
        // Calculate pagination info
        const totalItems = upcomingClasses.count;
        const totalPages = Math.ceil(totalItems / limit);
        
        return res.status(200).json({
            status: 'success',
            data: {
                classes: formattedClasses,
                current_time: now.format(),
                pagination: {
                    total_items: totalItems,
                    total_pages: totalPages,
                    current_page: page,
                    items_per_page: limit
                }
            }
        });
    } catch (error) {
        console.error('Error in getUpcomingClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get classes scheduled for today
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTodayClasses = async (req, res) => {
    try {
        // Get teacher ID from authenticated user
        const teacherId = req.user.id;
        
        // Get current date in UTC
        const now = moment.utc();
        const todayStart = now.clone().startOf('day');
        const todayEnd = now.clone().endOf('day');
        
        // Get pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        // Build the where clause for today's classes
        const whereClause = {
            teacher_id: teacherId,
            is_regular_hide: 0,
            meeting_start: {
                [Op.between]: [todayStart.format(), todayEnd.format()]
            },
            status: {
                [Op.notIn]: ['canceled', 'rejected']
            }
        };
        
        // Find classes scheduled for today
        const todayClasses = await Class.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [
                ['meeting_start', 'ASC']
            ],
            limit,
            offset
        });
        
        // Format the classes
        const formattedClasses = todayClasses.rows.map(cls => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            const duration = endTime.diff(startTime, 'minutes');
            
            // Calculate minutes remaining to class start
            const minutesRemaining = startTime.diff(now, 'minutes');
            
            return {
                id: cls.id,
                title: cls.class_type === 'regular' ? 'Regular Class' : (cls.is_trial ? 'Trial Class' : 'Class'),
                student: {
                    id: cls.Student?.id,
                    name: cls.Student?.full_name || 'Student',
                    avatar: cls.Student?.avatar || null
                },
                duration: duration,
                goal: cls.student_goal || '',
                start_time: startTime.format('h:mm A'),
                end_time: endTime.format('h:mm A'),
                start_datetime: startTime.format(),
                end_datetime: endTime.format(),
                minutes_remaining: minutesRemaining > 0 ? minutesRemaining : 0,
                status: cls.status,
                join_url: cls.join_url || null,
                is_trial: !!cls.is_trial,
                is_regular: cls.class_type === 'regular',
                in_progress: now >= startTime && now <= endTime
            };
        });
        
        // Calculate pagination info
        const totalItems = todayClasses.count;
        const totalPages = Math.ceil(totalItems / limit);
        
        return res.status(200).json({
            status: 'success',
            data: {
                classes: formattedClasses,
                current_time: now.format(),
                total_today_classes: totalItems,
                pagination: {
                    total_items: totalItems,
                    total_pages: totalPages,
                    current_page: page,
                    items_per_page: limit
                }
            }
        });
    } catch (error) {
        console.error('Error in getTodayClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get weekly calendar data for teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getWeeklyCalendar = async (req, res) => {
    try {
        // Get teacher ID from authenticated user
        const teacherId = req.user.id;
        
        // Determine the calendar type (regular class or normal class)
        const calendarType = req.query.type || 'normalClass';
        
        // Get teacher's timezone from request or default to UTC
        const teacherTimezone = req.user.timezone || 'UTC';
        
        // Handle different date parameters based on calendar type
        let startDate, endDate, weekDates;
        
        if (calendarType === 'normalClass') {
            // For normal class, use provided date range or default to today + 6 days
            if (req.query.start_date && req.query.end_date) {
                startDate = moment.utc(req.query.start_date).startOf('day');
                endDate = moment.utc(req.query.end_date).endOf('day');
            } else {
                // Fallback to using date parameter or current date
                const selectedDate = req.query.date ? moment.utc(req.query.date) : moment.utc();
                startDate = selectedDate.clone().startOf('day');
                endDate = selectedDate.clone().add(6, 'days').endOf('day');
            }
            
            // Generate array of dates between start and end
            weekDates = [];
            const currentDate = startDate.clone();
            while (currentDate <= endDate) {
                weekDates.push(currentDate.format('YYYY-MM-DD'));
                currentDate.add(1, 'day');
            }
        } else if (calendarType === 'regularClass') {
            // For regular class, we're showing the weekly schedule (Mon-Sun)
            // Use the current week starting from Monday
            const today = moment.utc();
            const currentWeekMonday = today.clone().startOf('isoWeek');
            
            weekDates = Array.from({ length: 7 }, (_, i) => 
                currentWeekMonday.clone().add(i, 'days').format('YYYY-MM-DD')
            );
            
            startDate = moment.utc(weekDates[0]).startOf('day');
            endDate = moment.utc(weekDates[6]).endOf('day');
        }
        
        console.log(`Calendar type: ${calendarType}`);
        console.log(`Date range: ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`);
        console.log(`Teacher timezone: ${teacherTimezone}`);
        
        // Fetch teacher holidays within the date range and create blocked slots set
        const teacherHolidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId,
                status: 'approved', // Only consider approved holidays
                [Op.or]: [
                    {
                        form_date: {
                            [Op.between]: [startDate.format(), endDate.format()]
                        }
                    },
                    {
                        to_date: {
                            [Op.between]: [startDate.format(), endDate.format()]
                        }
                    },
                    {
                        [Op.and]: [
                            { form_date: { [Op.lte]: startDate.format() } },
                            { to_date: { [Op.gte]: endDate.format() } }
                        ]
                    },
                    {
                        [Op.and]: [
                            { form_date: { [Op.lte]: endDate.format() } },
                            { to_date: { [Op.gte]: startDate.format() } }
                        ]
                    }
                ]
            }
        });
        
        // Create a simple Set of blocked slot keys (date-time format)
        const holidayBlockedSlots = new Set();
        
        teacherHolidays.forEach(holiday => {
            // Parse holiday dates - subtract 1 minute from to_date to match PHP logic
            const holidayStart = moment.utc(holiday.form_date);
            const holidayEnd = moment.utc(holiday.to_date).subtract(1, 'minute');
            
            // Ensure we don't go beyond our calendar date range
            const effectiveStart = moment.max(holidayStart, startDate);
            const effectiveEnd = moment.min(holidayEnd, endDate);
            
            // Generate 30-minute intervals for the holiday period
            const current = effectiveStart.clone();
            
            while (current.isBefore(effectiveEnd) || current.isSame(effectiveEnd)) {
                const dateKey = current.format('YYYY-MM-DD');
                const timeKey = current.format('HH:mm');
                const slotKey = `${dateKey}-${timeKey}`;
                
                // Only add if this date is in our week dates
                if (weekDates.includes(dateKey)) {
                    holidayBlockedSlots.add(slotKey);
                }
                
                current.add(30, 'minutes');
            }
        });
        
        console.log(`Total holiday blocked slots: ${holidayBlockedSlots.size}`);
        
        // Find all classes within the date range for normal class view
        let classes = [];
        if (calendarType === 'normalClass') {
            classes = await Class.findAll({
                where: {
                    teacher_id: teacherId,
                    is_regular_hide: 0,
                    meeting_start: {
                        [Op.between]: [startDate.format(), endDate.format()]
                    },
                    status: {
                        [Op.notIn]: ['canceled', 'rejected', 'ended']
                    }
                },
                include: [
                    {
                        model: User,
                        as: 'Student',
                        attributes: ['id', 'full_name', 'email', 'avatar'],
                        include: [
                            {
                                model: UserSubscriptionDetails,
                                as: 'UserSubscriptions',
                                attributes: ['lesson_min', 'status'],
                                where: {
                                    status: 'active'
                                },
                                required: false
                            }
                        ]
                    }
                ],
                order: [
                    ['meeting_start', 'ASC']
                ]
            });
        }
        
        // Always fetch regular classes for both views with subscription details
        const regularClasses = await RegularClass.findAll({
            where: {
                teacher_id: teacherId
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar', 'timezone'],
                    include: [
                        {
                            model: UserSubscriptionDetails,
                            as: 'UserSubscriptions',
                            attributes: ['lesson_min', 'status'],
                            where: {
                                status: 'active'
                            },
                            required: false
                        }
                    ]
                }
            ]
        });
        
        console.log(`Found ${regularClasses.length} regular classes for teacher ${teacherId}`);
        regularClasses.forEach(cls => {
            console.log(`Regular class ${cls.id}: ${cls.Student?.full_name} on ${cls.day} at ${cls.start_time}`);
        });
        
        // Helper function to get lesson duration from subscription
        const getLessonDurationFromSubscription = (student) => {
            const defaultDuration = 30;
            
            if (!student || !student.UserSubscriptions || student.UserSubscriptions.length === 0) {
                return defaultDuration;
            }
            
            const subscription = student.UserSubscriptions[0];
            const lessonMinutes = subscription.lesson_min;
            
            if (!lessonMinutes || lessonMinutes <= 0) {
                return defaultDuration;
            }
            
            return lessonMinutes;
        };
        
        // Helper function to convert time from one timezone to another
        const convertTimeToTimezone = (timeString, fromTimezone, toTimezone) => {
            if (!timeString || fromTimezone === toTimezone) {
                return timeString;
            }

            try {
                // Create a date with the time in the source timezone
                const today = moment().tz(fromTimezone);
                const [hours, minutes] = timeString.split(':').map(Number);
                
                const sourceTime = today.clone().set({
                    hour: hours,
                    minute: minutes,
                    second: 0,
                    millisecond: 0
                });

                // Convert to target timezone
                const targetTime = sourceTime.clone().tz(toTimezone);
                return targetTime.format('HH:mm');
            } catch (error) {
                console.error(`Error converting time ${timeString} from ${fromTimezone} to ${toTimezone}:`, error);
                return timeString;
            }
        };
        
        // Fetch the teacher's availability
        const teacherAvailability = await TeacherAvailability.findOne({
            where: {
                user_id: teacherId
            }
        });
        
        // Process the availability data
        const availabilityByDay = {
            mon: teacherAvailability ? JSON.parse(teacherAvailability.mon) : {},
            tue: teacherAvailability ? JSON.parse(teacherAvailability.tue) : {},
            wed: teacherAvailability ? JSON.parse(teacherAvailability.wed) : {},
            thu: teacherAvailability ? JSON.parse(teacherAvailability.thu) : {},
            fri: teacherAvailability ? JSON.parse(teacherAvailability.fri) : {},
            sat: teacherAvailability ? JSON.parse(teacherAvailability.sat) : {},
            sun: teacherAvailability ? JSON.parse(teacherAvailability.sun) : {}
        };
        
        // Convert UTC availability to teacher's local timezone with DST handling
        const localAvailabilityByDay = convertAvailabilityToLocalTimezone(availabilityByDay, teacherTimezone);

        const calculateSpanningSlots = (startTime, duration) => {
            const slots = [];
            const slotsToSpan = Math.ceil(duration / 30);
            
            console.log(`Calculating spanning slots for ${duration} minutes: ${slotsToSpan} slots needed`);
            
            for (let i = 0; i < slotsToSpan; i++) {
                const slotTime = startTime.clone().add(i * 30, 'minutes');
                const slot = {
                    time: slotTime.format('HH:mm'),
                    date: slotTime.format('YYYY-MM-DD'),
                    isMainSlot: i === 0,
                    isContinuation: i > 0,
                    slotIndex: i,
                    totalSlots: slotsToSpan,
                    remainingSlots: slotsToSpan - i - 1,
                    minutesIntoClass: i * 30,
                    minutesRemaining: Math.max(0, duration - (i * 30))
                };
                
                slots.push(slot);
                console.log(`  Slot ${i + 1}/${slotsToSpan}: ${slot.time} (${slot.isMainSlot ? 'Main' : 'Continue'}) - ${slot.minutesRemaining}min remaining`);
            }
            
            return slots;
        };

        // Process classes for time slots (for normal calendar) with subscription-based spanning support
        const processedClasses = await Promise.all(classes.map(async (cls) => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            const dateStr = startTime.format('YYYY-MM-DD');
            const timeStr = startTime.format('HH:mm');
            
            const subscriptionDuration = getLessonDurationFromSubscription(cls.Student);
            const actualDuration = moment.duration(endTime.diff(startTime)).asMinutes();
            
            let duration = subscriptionDuration;
            if (Math.abs(actualDuration - subscriptionDuration) > 5) {
                console.warn(`Duration mismatch for class ${cls.id}: Subscription says ${subscriptionDuration}min, but meeting time indicates ${actualDuration}min. Using subscription duration.`);
            }
            
            let studentDetails = {
                id: cls.Student?.id,
                name: cls.Student?.full_name || 'Student',
                email: cls.Student?.email || '',
                avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
            };
            
            let classType = cls.class_type || 'regular';
            
            if (cls.is_trial) {
                const trialRegistration = await TrialClassRegistration.findOne({
                    where: {
                        class_id: cls.id,
                        teacher_id: teacherId
                    }
                });
                
                if (trialRegistration) {
                    studentDetails = {
                        id: null,
                        name: trialRegistration.student_name || 'Trial Student',
                        email: trialRegistration.email || '',
                        avatar: null
                    };
                    classType = 'trial';
                    duration = 25;
                }
            }
            
            const spanningSlots = calculateSpanningSlots(startTime, duration);
            
            return {
                id: cls.id,
                date: dateStr,
                time: timeStr,
                status: cls.status,
                student: studentDetails,
                type: cls.is_trial ? 'trial' : 'regular',
                class_type: classType,
                is_trial: !!cls.is_trial,
                duration: duration,
                duration_source: cls.is_trial ? 'default_trial' : 'subscription',
                spanning_slots: spanningSlots,
                slots_to_span: Math.ceil(duration / 30)
            };
        }));

        // Create a map to track which slots are occupied by classes (including spanning)
        const occupiedSlots = new Map();
        
        processedClasses.forEach(cls => {
            cls.spanning_slots.forEach(slot => {
                const slotKey = `${slot.date}-${slot.time}`;
                occupiedSlots.set(slotKey, {
                    ...cls,
                    slot_info: slot
                });
            });
        });

        // Generate time slots for the calendar view with PROPER TIMEZONE CONVERSION
        let timeSlots = [];
        
        // Time ranges from 00:00 to 23:30 (48 slots, 30 min each)
        timeSlots = Array.from({ length: 48 }).map((_, index) => {
            const hour = Math.floor(index / 2);
            const minute = index % 2 === 0 ? '00' : '30';
            const utcTime = `${hour.toString().padStart(2, '0')}:${minute}`;
            
            // Convert UTC time to teacher's local timezone
            const localTime = convertTimeToTimezone(utcTime, 'UTC', teacherTimezone);
            
            // Convert UTC time to reference timezone (Asia/Jerusalem)
            const referenceTime = convertTimeToTimezone(utcTime, 'UTC', 'Asia/Jerusalem');
            
            // Create slots for each day
            const slots = {};
            
            weekDates.forEach(date => {
                const weekday = moment(date).format('ddd').toLowerCase();
                const dayKey = weekday === 'sun' ? 'sun' : 
                              weekday === 'mon' ? 'mon' : 
                              weekday === 'tue' ? 'tue' : 
                              weekday === 'wed' ? 'wed' : 
                              weekday === 'thu' ? 'thu' : 
                              weekday === 'fri' ? 'fri' : 'sat';
                
                // Check if the time slot is available based on teacher's availability (using LOCAL time)
                const isAvailable = localAvailabilityByDay[dayKey][localTime] === true;
                
                // Check for holiday blocking first (highest priority)
                const slotKey = `${date}-${utcTime}`;
                const isHolidayBlocked = holidayBlockedSlots.has(slotKey);
                
                // Check if this slot is occupied by a class (including spanning)
                const occupiedClass = occupiedSlots.get(slotKey);
                
                if (occupiedClass) {
                    // Priority 1: Class occupies this slot - always show the class
                    const slotInfo = occupiedClass.slot_info;
                    
                    slots[date] = {
                        status: 'booked',
                        available: isAvailable,
                        class_id: occupiedClass.id,
                        student: occupiedClass.student,
                        type: occupiedClass.is_trial ? 'trial' : 'regular',
                        class_type: occupiedClass.class_type,
                        duration: occupiedClass.duration,
                        duration_source: occupiedClass.duration_source,
                        is_main_slot: slotInfo.isMainSlot,
                        is_continuation: slotInfo.isContinuation,
                        slot_index: slotInfo.slotIndex,
                        total_slots: slotInfo.totalSlots,
                        remaining_slots: slotInfo.remainingSlots,
                        main_slot_time: occupiedClass.time,
                        spans_minutes: occupiedClass.duration
                    };
                } else if (isHolidayBlocked) {
                    // Priority 2: Holiday blocking - only if no class exists
                    slots[date] = {
                        status: 'closed',
                        available: false
                    };
                } else {
                    // Priority 3: Regular availability rules
                    slots[date] = { 
                        status: isAvailable ? 'open' : 'closed',
                        available: isAvailable
                    };
                }
            });
            
            return {
                time: utcTime,
                localTime: localTime,
                referenceTime: referenceTime,
                slots: slots
            };
        });
        
        // Generate regular class schedule by day of week with availability and spanning
        const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const dayToKey = {
            "Monday": "mon",
            "Tuesday": "tue", 
            "Wednesday": "wed",
            "Thursday": "thu",
            "Friday": "fri",
            "Saturday": "sat",
            "Sunday": "sun"
        };
        
        // Helper function to normalize day names
        const normalizeDayName = (day) => {
            if (!day) return null;
            const dayLower = day.toLowerCase();
            switch (dayLower) {
                case 'monday': case 'mon': return 'Monday';
                case 'tuesday': case 'tue': return 'Tuesday';
                case 'wednesday': case 'wed': return 'Wednesday';
                case 'thursday': case 'thu': return 'Thursday';
                case 'friday': case 'fri': return 'Friday';
                case 'saturday': case 'sat': return 'Saturday';
                case 'sunday': case 'sun': return 'Sunday';
                default: return null;
            }
        };
        
        // Create a map for regular class spanning slots
        const regularClassOccupiedSlots = new Map();
        
        // Process regular classes with proper timezone conversion for display
        const processRegularClassWithSpanning = (regClass, dayOfWeek) => {
            let duration = getLessonDurationFromSubscription(regClass.Student);
            
            const normalizedDay = normalizeDayName(dayOfWeek);
            if (!normalizedDay) {
                console.warn(`Invalid day: ${dayOfWeek} for regular class ID: ${regClass.id}`);
                return [];
            }
            
            const dayIndex = daysOfWeek.indexOf(normalizedDay);
            if (dayIndex === -1) {
                console.warn(`Day not found in daysOfWeek: ${normalizedDay} for regular class ID: ${regClass.id}`);
                return [];
            }

            // FIXED: Create a proper date in the student's timezone first
            const studentTimezone = regClass.Student?.timezone || regClass.timezone || 'UTC';
            const classStartTime = regClass.start_time; // e.g., "20:00"

            // Parse the start time
            const [hours, minutes] = classStartTime.split(':').map(Number);

            // Create a date object in the STUDENT'S timezone for the given day
            const currentWeekMonday = moment.utc().startOf('isoWeek');
            const studentDayDate = currentWeekMonday.clone().add(dayIndex, 'days');

            // Create moment in student's timezone with the class time
            const studentClassDateTime = moment.tz(
                `${studentDayDate.format('YYYY-MM-DD')} ${classStartTime}`,
                'YYYY-MM-DD HH:mm',
                studentTimezone
            );

            // Convert to teacher's timezone to get the ACTUAL display time and day
            const teacherClassDateTime = studentClassDateTime.clone().tz(teacherTimezone);

            // Get the actual day in teacher's timezone (this might be different!)
            const teacherDayOfWeek = teacherClassDateTime.format('dddd');
            const teacherDate = teacherClassDateTime.format('YYYY-MM-DD');
            const teacherStartTime = teacherClassDateTime.format('HH:mm');

            console.log(`Regular class conversion: Student ${normalizedDay} ${classStartTime} (${studentTimezone}) -> Teacher ${teacherDayOfWeek} ${teacherStartTime} (${teacherTimezone})`);

            const spanningSlots = [];
            const slotsToSpan = Math.ceil(duration / 30);
            
            for (let i = 0; i < slotsToSpan; i++) {
                const slotDateTime = teacherClassDateTime.clone().add(i * 30, 'minutes');
                const slotTime = slotDateTime.format('HH:mm');
                const slotDate = slotDateTime.format('YYYY-MM-DD');
                const slotDay = slotDateTime.format('dddd');

                const slot = {
                    time: slotTime,
                    originalTime: classStartTime,
                    localTime: slotTime,
                    date: slotDate,
                    day: slotDay,
                    isMainSlot: i === 0,
                    isContinuation: i > 0,
                    slotIndex: i,
                    totalSlots: slotsToSpan,
                    remainingSlots: slotsToSpan - i - 1,
                    minutesIntoClass: i * 30,
                    minutesRemaining: Math.max(0, duration - (i * 30))
                };
                
                spanningSlots.push(slot);
            }
            
            const processedSlots = [];
            spanningSlots.forEach(slot => {
                const slotData = {
                    slot_key: `${slot.day}-${slot.time}`, // Use TEACHER's day, not original day
                    class_id: regClass.id,
                    student: {
                        id: regClass.Student?.id,
                        name: regClass.Student?.full_name || 'Student',
                        email: regClass.Student?.email || '',
                        avatar: regClass.Student?.avatar ? `https://tulkka.com${regClass.Student?.avatar}` : null,
                        timezone: studentTimezone
                    },
                    duration: duration,
                    class_type: regClass.class_type || 'regular',
                    type: 'regular',
                    original_utc_time: regClass.start_time,
                    local_start_time: teacherStartTime,
                    local_timezone: teacherTimezone,
                    student_timezone: studentTimezone,
                    slot_info: slot,
                    day_of_week: slot.day, // Use the actual day in teacher's timezone
                    weekly_schedule: true,
                    original_duration: duration,
                    duration_source: 'subscription'
                };
                
                processedSlots.push(slotData);
            });
            
            return processedSlots;
        };
        
        regularClasses.forEach(regCls => {
            try {
                const processedSlots = processRegularClassWithSpanning(regCls, regCls.day);
                
                processedSlots.forEach(slotData => {
                    regularClassOccupiedSlots.set(slotData.slot_key, slotData);
                });
            } catch (error) {
                console.error(`Error processing regular class ${regCls.id}:`, error);
            }
        });

        // Process regular class days with proper timezone conversion and holiday blocking
        const regularClassDays = daysOfWeek.map(day => {
            const dayKey = dayToKey[day];
            const daySchedule = {
                day: day,
                slots: []
            };
            
            // Generate slots from 00:00 to 23:30 (48 slots, 30 min each)
            for (let i = 0; i < 48; i++) {
                const hour = Math.floor(i / 2);
                const minute = i % 2 === 0 ? "00" : "30";
                const utcTime = `${hour.toString().padStart(2, '0')}:${minute}`;
                
                const localTime = convertTimeToTimezone(utcTime, 'UTC', teacherTimezone);
                const referenceTime = convertTimeToTimezone(utcTime, 'UTC', 'Asia/Jerusalem');
                
                const isAvailable = localAvailabilityByDay[dayKey][localTime] === true;
                
                // Check for holiday blocking in regular class view
                const dayIndex = daysOfWeek.indexOf(day);
                const currentWeekDate = moment.utc().startOf('isoWeek').add(dayIndex, 'days').format('YYYY-MM-DD');
                const holidaySlotKey = `${currentWeekDate}-${utcTime}`;
                const isHolidayBlocked = holidayBlockedSlots.has(holidaySlotKey);
                
                const slotKey = `${day}-${localTime}`;
                const occupiedRegularClass = regularClassOccupiedSlots.get(slotKey);
                
                if (occupiedRegularClass) {
                    // Priority 1: Regular class occupies this slot - always show the class
                    const slotInfo = occupiedRegularClass.slot_info;
                    
                    const slotData = {
                        time: utcTime,
                        localTime: localTime,
                        witTime: referenceTime,
                        status: 'booked',
                        available: isAvailable,
                        class_id: occupiedRegularClass.class_id,
                        student: occupiedRegularClass.student,
                        type: occupiedRegularClass.type,
                        class_type: occupiedRegularClass.class_type,
                        duration: occupiedRegularClass.duration,
                        duration_source: occupiedRegularClass.duration_source,
                        original_utc_time: occupiedRegularClass.original_utc_time,
                        local_start_time: occupiedRegularClass.local_start_time,
                        local_timezone: occupiedRegularClass.local_timezone,
                        is_main_slot: slotInfo.isMainSlot,
                        is_continuation: slotInfo.isContinuation,
                        slot_index: slotInfo.slotIndex,
                        total_slots: slotInfo.totalSlots,
                        remaining_slots: slotInfo.remainingSlots,
                        main_slot_time: occupiedRegularClass.local_start_time,
                        spans_minutes: occupiedRegularClass.duration,
                        day_of_week: occupiedRegularClass.day_of_week,
                        weekly_schedule: occupiedRegularClass.weekly_schedule,
                        original_duration: occupiedRegularClass.original_duration,
                        display_info: {
                            show_duration_badge: slotInfo.isMainSlot && occupiedRegularClass.duration > 30,
                            show_continuation_indicator: slotInfo.isContinuation,
                            continuation_text: slotInfo.isContinuation 
                                ? `Continues... (${slotInfo.remainingSlots + 1}/${slotInfo.totalSlots})`
                                : null,
                            main_slot_display: slotInfo.isMainSlot 
                                ? `${occupiedRegularClass.student.name} (${occupiedRegularClass.duration}min)`
                                : `${occupiedRegularClass.student.name} - Continuing`,
                            slot_color_class: slotInfo.isMainSlot ? 'main-regular-class' : 'continuation-regular-class'
                        }
                    };
                    
                    daySchedule.slots.push(slotData);
                } else if (isHolidayBlocked) {
                    // Priority 2: Holiday blocking - only if no class exists
                    daySchedule.slots.push({
                        time: utcTime,
                        localTime: localTime,
                        witTime: referenceTime,
                        status: 'closed',
                        available: false
                    });
                } else {
                    // Priority 3: Normal availability
                    daySchedule.slots.push({
                        time: utcTime,
                        localTime: localTime,
                        witTime: referenceTime,
                        status: isAvailable ? "open" : "closed",
                        available: isAvailable
                    });
                }
            }
            
            return daySchedule;
        });
        
        const displayDate = req.query.date ? moment.utc(req.query.date) : 
                           (req.query.start_date ? moment.utc(req.query.start_date) : moment.utc());
        
        const subscriptionStats = {
            regular_classes_with_subscriptions: regularClasses.filter(c => 
                c.Student?.UserSubscriptions && c.Student.UserSubscriptions.length > 0
            ).length,
            regular_classes_without_subscriptions: regularClasses.filter(c => 
                !c.Student?.UserSubscriptions || c.Student.UserSubscriptions.length === 0
            ).length,
            subscription_duration_breakdown: regularClasses.reduce((acc, cls) => {
                let duration = getLessonDurationFromSubscription(cls.Student);
                acc[`${duration}min`] = (acc[`${duration}min`] || 0) + 1;
                return acc;
            }, {}),
            normal_classes_with_subscriptions: classes.filter(c => 
                !c.is_trial && c.Student?.UserSubscriptions && c.Student.UserSubscriptions.length > 0
            ).length,
            trial_classes: classes.filter(c => c.is_trial).length
        };
        
        return res.status(200).json({
            status: 'success',
            data: {
                selectedDate: displayDate.format('YYYY-MM-DD'),
                currentMonth: displayDate.format('MMMM YYYY'),
                weekDates: weekDates,
                timeSlots: timeSlots,
                regularClasses: regularClassDays,
                calendarType: calendarType,
                timezone: teacherTimezone,
                isDST: isDSTActive(teacherTimezone),
                spanning_info: {
                    slot_duration_minutes: 30,
                    supports_spanning: true,
                    duration_source: 'user_subscription_details',
                    max_class_duration_minutes: 180,
                    subscription_stats: subscriptionStats,
                    regular_class_stats: {
                        total_regular_classes: regularClasses.length,
                        classes_with_custom_duration: regularClasses.filter(c => 
                            getLessonDurationFromSubscription(c.Student) !== 30
                        ).length,
                        spanning_slots_created: regularClassOccupiedSlots.size,
                        duration_breakdown: subscriptionStats.subscription_duration_breakdown
                    },
                    normal_class_stats: {
                        total_normal_classes: processedClasses.length,
                        classes_with_custom_duration: processedClasses.filter(c => c.duration !== 30).length,
                        spanning_slots_created: occupiedSlots.size,
                        trial_classes: subscriptionStats.trial_classes
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error in getWeeklyCalendar:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Convert the teacher availability from UTC to local timezone
 * @param {Object} availabilityByDay - Availability data by day from database
 * @param {string} timezone - Teacher's timezone
 * @returns {Object} - Converted availability data
 */
function convertAvailabilityToLocalTimezone(availabilityByDay, timezone) {
    // Create a result object with the same structure
    const localAvailabilityByDay = {
        mon: {},
        tue: {},
        wed: {},
        thu: {},
        fri: {},
        sat: {},
        sun: {}
    };
    
    // Get current date to handle DST correctly
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    
    // Process each day
    Object.keys(availabilityByDay).forEach(day => {
        const dayData = availabilityByDay[day];
        
        // Process each time slot in the day
        Object.keys(dayData).forEach(timeSlot => {
            // Only process if the slot is marked as available (true)
            if (dayData[timeSlot] === true) {
                // Split the time slot into hours and minutes
                const [hours, minutes] = timeSlot.split(':').map(Number);
                
                // Create a date object in UTC with the time slot
                const dateInUTC = new Date(Date.UTC(currentYear, currentMonth, currentDay, hours, minutes));
                
                // Convert to the teacher's timezone
                const localOptions = { 
                    timeZone: timezone, 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    hour12: false 
                };
                
                // Get the local time
                const formatter = new Intl.DateTimeFormat('en-US', localOptions);
                const parts = formatter.formatToParts(dateInUTC);
                
                let localHours = '';
                let localMinutes = '';
                
                parts.forEach(part => {
                    if (part.type === 'hour') {
                        // Handle 24:xx format by converting to 00:xx
                        let hourValue = parseInt(part.value);
                        if (hourValue === 24) {
                            hourValue = 0;
                        }
                        localHours = hourValue.toString().padStart(2, '0');
                    } else if (part.type === 'minute') {
                        localMinutes = part.value;
                    }
                });
                
                // Format as "HH:MM" for the local timezone
                const localTimeSlot = `${localHours}:${localMinutes}`;
                
                // Mark this slot as available in the local timezone
                localAvailabilityByDay[day][localTimeSlot] = true;
            }
        });
    });
    
    return localAvailabilityByDay;
}

/**
 * Check if DST is currently active for the given timezone
 * @param {string} timezone - Timezone to check
 * @returns {boolean} - True if DST is active, false otherwise
 */
function isDSTActive(timezone) {
    try {
        // Get current date
        const now = new Date();
        
        // Create two identical dates 6 months apart to check for DST differences
        const jan = new Date(now.getFullYear(), 0, 1); // January
        const jul = new Date(now.getFullYear(), 6, 1); // July
        
        // Format the dates with timezone information
        const janFormat = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeStyle: 'long'
        });
        
        const julFormat = new Intl.DateTimeFormat('en-US', {
            timeStyle: 'long',
            timeZone: timezone
        });
        
        // Get the timezone offset strings (e.g., "GMT+02:00")
        const janTimeStr = janFormat.format(jan);
        const julTimeStr = julFormat.format(jul);
        
        // Extract offset values
        const janOffsetMatch = janTimeStr.match(/GMT([+-]\d{2}):(\d{2})$/);
        const julOffsetMatch = julTimeStr.match(/GMT([+-]\d{2}):(\d{2})$/);
        
        if (!janOffsetMatch || !julOffsetMatch) {
            return false; // Can't determine
        }
        
        // Calculate the actual offsets in minutes
        const janOffset = (parseInt(janOffsetMatch[1]) * 60) + 
                        (parseInt(janOffsetMatch[2]) * (janOffsetMatch[1].startsWith('-') ? -1 : 1));
        
        const julOffset = (parseInt(julOffsetMatch[1]) * 60) + 
                        (parseInt(julOffsetMatch[2]) * (julOffsetMatch[1].startsWith('-') ? -1 : 1));
        
        // If offsets are different, the timezone has DST
        if (janOffset === julOffset) {
            return false; // No DST
        }
        
        // Now check current date's offset
        const nowFormat = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeStyle: 'long'
        });
        
        const nowTimeStr = nowFormat.format(now);
        const nowOffsetMatch = nowTimeStr.match(/GMT([+-]\d{2}):(\d{2})$/);
        
        if (!nowOffsetMatch) {
            return false;
        }
        
        const nowOffset = (parseInt(nowOffsetMatch[1]) * 60) + 
                        (parseInt(nowOffsetMatch[2]) * (nowOffsetMatch[1].startsWith('-') ? -1 : 1));
        
        // In most timezones, DST means the offset is more positive (less negative)
        // For example, EST is UTC-5 in winter and UTC-4 in summer (DST)
        // For locations east of UTC, IST is UTC+2 in winter and UTC+3 in summer (DST)
        const dstOffset = Math.max(janOffset, julOffset);
        
        // DST is active if the current offset matches the DST offset
        return nowOffset === dstOffset;
    } catch (error) {
        console.error('Error checking DST status:', error);
        return false;
    }
}
/**
 * Helper function to generate time slots for calendar
 * @param {string} selectedTz - Teacher's timezone
 * @param {string} referenceTz - Reference timezone (WIT)
 * @returns {Array} Array of time slots
 */
const generateTimeSlots = (selectedTz, referenceTz) => {
    // Time ranges from 11:00 to 23:30 (26 slots)
    return Array.from({ length: 26 }).map((_, index) => {
        // Start from 11:00, increment by 30 mins
        const hour = 11 + Math.floor(index / 2);
        const minute = index % 2 === 0 ? '00' : '30';
        const localTime = `${hour < 10 ? '0' + hour : hour}:${minute}`;
        
        // Convert local time to reference timezone
        // This is a simplified approach - in a real app use proper timezone conversion
        const localMoment = moment.tz(`2023-01-01 ${localTime}`, 'YYYY-MM-DD HH:mm', selectedTz);
        const referenceMoment = localMoment.clone().tz(referenceTz);
        const referenceTime = referenceMoment.format('HH:mm');
        
        return {
            localTime: localTime,
            referenceTime: referenceTime
        };
    });
};

/**
 * Get class queries for a specific class (for teachers to view student pre-class queries)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getClassQueries = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        
        if (!classId) {
            return res.status(400).json({
                status: 'error',
                message: 'Class ID is required'
            });
        }
        
        // First verify that the class belongs to this teacher
        const classDetails = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });
        
        if (!classDetails) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you do not have permission to view it'
            });
        }
        
        // Find queries for this class
        const queries = await StudentClassQuery.findAll({
            where: { 
                class_id: classId
            },
            order: [['created_at', 'DESC']]
        });

        if (!queries || queries.length === 0) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'No queries found for this class' 
            });
        }

        // Response
        return res.status(200).json({
            status: 'success',
            message: 'Class queries retrieved successfully',
            data: queries
        });
    } catch (error) {
        console.error('Error in getClassQueries:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Download class query attachment (for teachers to download student uploaded files)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadClassQueryAttachment = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const queryId = req.params.id;
        
        if (!queryId) {
            return res.status(400).json({
                status: 'error',
                message: 'Query ID is required'
            });
        }
        
        // Find the query and verify the teacher has access to it
        const query = await StudentClassQuery.findOne({
            where: { id: queryId },
            include: [
                {
                    model: Class,
                    as: 'Class', // Adjust association name if different
                    where: {
                        teacher_id: teacherId
                    },
                    required: true
                }
            ]
        });

        if (!query) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Query not found or you do not have permission to access it' 
            });
        }

        if (!query.attachment) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'No attachment found for this query' 
            });
        }

        // Parse attachment JSON to get file URLs
        let attachments;
        try {
            attachments = JSON.parse(query.attachment);
        } catch (error) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid attachment data'
            });
        }

        if (!Array.isArray(attachments) || attachments.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No attachments found'
            });
        }

        // For simplicity, return the first attachment URL
        // You can modify this to handle multiple attachments if needed
        const fileUrl = attachments[0];
        
        // Construct full URL if it's a relative path
        const fullFileUrl = fileUrl.startsWith('http') 
            ? fileUrl 
            : `https://tulkka-backend.s3.eu-central-1.amazonaws.com/${fileUrl}`;

        res.status(200).json({ 
            status: 'success', 
            message: 'Download link retrieved successfully', 
            fileUrl: fullFileUrl,
            attachments: attachments.map(url => url.startsWith('http') ? url : `https://tulkka-backend.s3.eu-central-1.amazonaws.com/${url}`)
        });
    } catch (error) {
        console.error('Error in downloadClassQueryAttachment:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get pending tasks (homework and feedback) for teacher dashboard
 * Auto-populates based on completed classes without homework/feedback
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPendingTasks = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const now = moment.utc();
        
        // Configurable thresholds (can be set via environment variables)
        const OVERDUE_THRESHOLD_HOURS = parseInt(process.env.TASK_OVERDUE_HOURS) || 24;
        const DUE_SOON_THRESHOLD_HOURS = parseInt(process.env.TASK_DUE_SOON_HOURS) || 6;
        const MAX_TASK_AGE_DAYS = parseInt(process.env.MAX_TASK_AGE_DAYS) || 7;
        
        console.log(`Fetching pending tasks for teacher ${teacherId} with thresholds: overdue=${OVERDUE_THRESHOLD_HOURS}h, dueSoon=${DUE_SOON_THRESHOLD_HOURS}h, maxAge=${MAX_TASK_AGE_DAYS}d`);
        
        // Get all completed/ended classes that might need tasks
        const completedClasses = await Class.findAll({
            where: {
                teacher_id: teacherId,
                status: {
                    [Op.in]: ['ended', 'completed']
                },
                meeting_end: {
                    [Op.lt]: now.format(), // Only past classes
                    [Op.gte]: now.clone().subtract(MAX_TASK_AGE_DAYS, 'days').format() // Don't go too far back
                },
                is_present: 1 
            },
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'avatar', 'email']
                }
            ],
            order: [['meeting_end', 'DESC']]
        });

        console.log(`Found ${completedClasses.length} completed classes for teacher ${teacherId} in the last ${MAX_TASK_AGE_DAYS} days`);

        const pendingTasks = [];
        let feedbackChecks = 0;
        let homeworkChecks = 0;
        let evaluationChecks = 0;
        let trialRegistrationChecks = 0;
        let absentClassesSkipped = 0;
        
        // Process each completed class to identify missing tasks
        for (const cls of completedClasses) {
        
            if (!cls.is_present || cls.is_present === 0) {
                absentClassesSkipped++;
                console.log(`Skipping absent class ${cls.id} - student was not present`);
                continue;
            }

            const classEndTime = moment.utc(cls.meeting_end);
            const classStartTime = moment.utc(cls.meeting_start);
            const hoursAfterClass = now.diff(classEndTime, 'hours');
            
            // Parallel database queries for better performance
            const [feedback, homework, evaluation, trialRegistration] = await Promise.all([
                // Check feedback for regular classes and trial classes with a student
                (!cls.is_trial || (cls.is_trial && cls.student_id)) ? Feedback.findOne({
                    where: { lesson_id: cls.id }
                }).then(result => {
                    feedbackChecks++;
                    return result;
                }) : Promise.resolve(null),
                
                // Check homework for regular classes and trial classes with a student
                (!cls.is_trial || (cls.is_trial && cls.student_id)) ? Homework.findOne({
                    where: { 
                        lesson_id: cls.id,
                        teacher_id: teacherId 
                    }
                }).then(result => {
                    homeworkChecks++;
                    return result;
                }) : Promise.resolve(null),
                
                // Only check evaluation for trial classes
                cls.is_trial && cls.demo_class_id ? 
                    TrialClassEvaluation.findOne({
                        where: { trial_class_registrations_id: cls.demo_class_id }
                    }).then(result => {
                        evaluationChecks++;
                        return result;
                    }) : Promise.resolve(null),
                
                // Get trial registration data for trial classes
                (cls.is_trial && cls.demo_class_id) ? 
                    TrialClassRegistration.findOne({
                        where: { id: cls.demo_class_id }
                    }).then(result => {
                        trialRegistrationChecks++;
                        return result;
                    }) : Promise.resolve(null)
            ]);
            
            // Determine student name and details (handle trial classes)
            let studentName = cls.Student?.full_name || 'Student';
            let studentEmail = cls.Student?.email || '';
            let studentAvatar = cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null;
            
            if (cls.is_trial && trialRegistration) {
                studentName = trialRegistration.student_name || 'Trial Student';
                studentEmail = trialRegistration.email || '';
                studentAvatar = null; // Trial students typically don't have avatars
            }
            
            // Calculate time-based status and priority
            const isOverdue = hoursAfterClass > OVERDUE_THRESHOLD_HOURS;
            const isDueSoon = hoursAfterClass > (OVERDUE_THRESHOLD_HOURS - DUE_SOON_THRESHOLD_HOURS);
            
            let timeStatus;
            let priority;
            let statusVariant;
            
            if (isOverdue) {
                const overdueHours = Math.floor(hoursAfterClass - OVERDUE_THRESHOLD_HOURS);
                if (overdueHours > 48) {
                    timeStatus = `Overdue by ${Math.floor(overdueHours / 24)}d ${overdueHours % 24}h`;
                } else {
                    timeStatus = `Overdue by ${overdueHours}h`;
                }
                priority = 'high';
                statusVariant = 'destructive';
            } else if (isDueSoon) {
                const remainingHours = Math.floor(OVERDUE_THRESHOLD_HOURS - hoursAfterClass);
                timeStatus = remainingHours < 1 ? 'Due very soon' : `Due in ${remainingHours}h`;
                priority = 'medium';
                statusVariant = 'default';
            } else {
                const remainingHours = Math.floor(OVERDUE_THRESHOLD_HOURS - hoursAfterClass);
                timeStatus = `${remainingHours}h remaining`;
                priority = 'low';
                statusVariant = 'outline';
            }
            
            // Determine class category for task logic
            const isTrialWithDemo = !!cls.is_trial && !!cls.demo_class_id;
            const isTrialWithStudent = !!cls.is_trial && !!cls.student_id && !cls.demo_class_id;
            const isRegularClass = !cls.is_trial;
            
            // FOR TRIAL CLASSES: Create evaluation task if missing and demo_class_id exists
            if (cls.is_trial && cls.demo_class_id && !evaluation) {
                const evaluationTask = {
                    id: `evaluation-${cls.id}`,
                    type: 'evaluation',
                    classId: cls.id,
                    studentName: studentName,
                    studentId: cls.student_id,
                    studentEmail: studentEmail,
                    studentAvatar: studentAvatar,
                    lessonDate: classEndTime.format('YYYY-MM-DD'),
                    lessonTime: classStartTime.format('HH:mm'),
                    lessonEndTime: classEndTime.format('HH:mm'),
                    lessonDateTime: cls.meeting_start,
                    lessonDuration: classEndTime.diff(classStartTime, 'minutes'),
                    subject: cls.student_goal || 'Trial Class Evaluation',
                    status: isOverdue ? 'overdue' : 'pending',
                    remainingTime: timeStatus,
                    isOverdue: isOverdue,
                    isDueSoon: isDueSoon && !isOverdue,
                    hoursAfterClass: hoursAfterClass,
                    isTrialClass: true,
                    priority: priority,
                    statusVariant: statusVariant,
                    createdAt: cls.meeting_end,
                    classType: 'trial',
                    requiresEvaluation: true,
                    classStatus: cls.status,
                    isPresent: cls.is_present,
                    metadata: {
                        originalClassGoal: cls.student_goal,
                        classId: cls.id,
                        meetingStartUTC: cls.meeting_start,
                        meetingEndUTC: cls.meeting_end,
                        demoClassId: cls.demo_class_id,
                        isPresent: cls.is_present
                    }
                };
                
                pendingTasks.push(evaluationTask);
                
                console.log(`Created evaluation task for trial class ${cls.id}: ${studentName} - ${timeStatus}`);
            }
            
            // FOR REGULAR and TRIAL-WITH-STUDENT CLASSES: Create feedback task if missing
            if ((isRegularClass || isTrialWithStudent) && !feedback) {
                const feedbackTask = {
                    id: `feedback-${cls.id}`,
                    type: 'feedback',
                    classId: cls.id,
                    studentName: studentName,
                    studentId: cls.student_id,
                    studentEmail: studentEmail,
                    studentAvatar: studentAvatar,
                    lessonDate: classEndTime.format('YYYY-MM-DD'),
                    lessonTime: classStartTime.format('HH:mm'),
                    lessonEndTime: classEndTime.format('HH:mm'),
                    lessonDateTime: cls.meeting_start,
                    lessonDuration: classEndTime.diff(classStartTime, 'minutes'),
                    subject: cls.student_goal || 'Regular Class',
                    status: isOverdue ? 'overdue' : 'pending',
                    remainingTime: timeStatus,
                    isOverdue: isOverdue,
                    isDueSoon: isDueSoon && !isOverdue,
                    hoursAfterClass: hoursAfterClass,
                    isTrialClass: false,
                    priority: priority,
                    statusVariant: statusVariant,
                    createdAt: cls.meeting_end,
                    classType: 'regular',
                    requiresEvaluation: false,
                    classStatus: cls.status,
                    isPresent: cls.is_present,
                    metadata: {
                        originalClassGoal: cls.student_goal,
                        classId: cls.id,
                        meetingStartUTC: cls.meeting_start,
                        meetingEndUTC: cls.meeting_end,
                        isPresent: cls.is_present
                    }
                };
                
                pendingTasks.push(feedbackTask);
                
                console.log(`Created feedback task for regular class ${cls.id}: ${studentName} - ${timeStatus}`);
            }
            
            // FOR REGULAR and TRIAL-WITH-STUDENT CLASSES: Create homework task if missing
            if ((isRegularClass || isTrialWithStudent) && !homework) {
                const homeworkTask = {
                    id: `homework-${cls.id}`,
                    type: 'homework',
                    classId: cls.id,
                    studentName: studentName,
                    studentId: cls.student_id,
                    studentEmail: studentEmail,
                    studentAvatar: studentAvatar,
                    lessonDate: classEndTime.format('YYYY-MM-DD'),
                    lessonTime: classStartTime.format('HH:mm'),
                    lessonEndTime: classEndTime.format('HH:mm'),
                    lessonDateTime: cls.meeting_start,
                    lessonDuration: classEndTime.diff(classStartTime, 'minutes'),
                    subject: cls.student_goal || 'Regular Class',
                    status: isOverdue ? 'overdue' : 'pending',
                    remainingTime: timeStatus,
                    isOverdue: isOverdue,
                    isDueSoon: isDueSoon && !isOverdue,
                    hoursAfterClass: hoursAfterClass,
                    isTrialClass: false,
                    priority: priority,
                    statusVariant: statusVariant,
                    createdAt: cls.meeting_end,
                    classType: 'regular',
                    requiresEvaluation: false,
                    classStatus: cls.status,
                    isPresent: cls.is_present,
                    metadata: {
                        originalClassGoal: cls.student_goal,
                        classId: cls.id,
                        meetingStartUTC: cls.meeting_start,
                        meetingEndUTC: cls.meeting_end,
                        isPresent: cls.is_present
                    }
                };
                
                pendingTasks.push(homeworkTask);
                
                console.log(`Created homework task for regular class ${cls.id}: ${studentName} - ${timeStatus}`);
            }
        }
        
        // Sort tasks by priority and urgency
        pendingTasks.sort((a, b) => {
            // Priority order: high (overdue) > medium (due soon) > low (normal)
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[b.priority] - priorityOrder[a.priority];
            }
            
            // If same priority, sort by hours after class (most urgent first)
            return b.hoursAfterClass - a.hoursAfterClass;
        });
        
        // Calculate comprehensive statistics
        const stats = {
            total: pendingTasks.length,
            overdue: pendingTasks.filter(task => task.isOverdue).length,
            dueSoon: pendingTasks.filter(task => task.isDueSoon && !task.isOverdue).length,
            pending: pendingTasks.filter(task => !task.isOverdue && !task.isDueSoon).length,
            feedback: pendingTasks.filter(task => task.type === 'feedback').length,
            homework: pendingTasks.filter(task => task.type === 'homework').length,
            evaluation: pendingTasks.filter(task => task.type === 'evaluation').length,
            highPriority: pendingTasks.filter(task => task.priority === 'high').length,
            mediumPriority: pendingTasks.filter(task => task.priority === 'medium').length,
            lowPriority: pendingTasks.filter(task => task.priority === 'low').length,
            trialClasses: pendingTasks.filter(task => task.isTrialClass).length,
            regularClasses: pendingTasks.filter(task => !task.isTrialClass).length,
            byStatus: {
                overdue: pendingTasks.filter(task => task.status === 'overdue').length,
                pending: pendingTasks.filter(task => task.status === 'pending').length
            }
        };
        
        // Performance metrics for debugging
        const performanceMetrics = {
            completedClassesScanned: completedClasses.length,
            absentClassesSkipped: absentClassesSkipped,
            feedbackQueriesExecuted: feedbackChecks,
            homeworkQueriesExecuted: homeworkChecks,
            evaluationQueriesExecuted: evaluationChecks,
            trialRegistrationQueriesExecuted: trialRegistrationChecks,
            tasksGenerated: pendingTasks.length,
            processingTimeMs: Date.now() - now.valueOf()
        };
        
        console.log(`Generated ${pendingTasks.length} pending tasks for teacher ${teacherId}:`, {
            stats,
            performance: performanceMetrics
        });
        
        // Filter options for frontend
        const filterOptions = {
            all: pendingTasks.length,
            overdue: stats.overdue,
            dueSoon: stats.dueSoon,
            feedback: stats.feedback,
            homework: stats.homework,
            evaluation: stats.evaluation,
            trial: stats.trialClasses,
            regular: stats.regularClasses
        };
        
        return res.status(200).json({
            status: 'success',
            data: {
                tasks: pendingTasks,
                stats: stats,
                filterOptions: filterOptions,
                current_time: now.format(),
                server_timezone: 'UTC',
                config: {
                    overdue_threshold_hours: OVERDUE_THRESHOLD_HOURS,
                    due_soon_threshold_hours: DUE_SOON_THRESHOLD_HOURS,
                    max_task_age_days: MAX_TASK_AGE_DAYS,
                    auto_clear_enabled: true,
                    trial_homework_enabled: false, // Trial classes don't generate homework tasks
                    task_refresh_interval_seconds: 30,
                    exclude_absent_classes: true
                },
                performance: performanceMetrics
            },
            message: `Found ${pendingTasks.length} pending tasks (${stats.overdue} overdue, ${stats.dueSoon} due soon, ${absentClassesSkipped} absent classes excluded)`
        });
        
    } catch (error) {
        console.error('Error in getPendingTasks:', error);
        
        // Return error response with helpful context
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch pending tasks',
            details: process.env.NODE_ENV === 'development' ? {
                error: error.message,
                stack: error.stack,
                teacherId: req.user?.id,
                timestamp: moment.utc().format()
            } : undefined,
            data: {
                tasks: [],
                stats: {
                    total: 0,
                    overdue: 0,
                    dueSoon: 0,
                    feedback: 0,
                    homework: 0,
                    evaluation: 0
                }
            }
        });
    }
};



// Rest of the controller methods remain the same
module.exports = {
    getTeacherDashboard,
    getUpcomingClasses,
    getClassDetails,
    getCompletedClasses,
    getTodayClasses,
    getWeeklyCalendar,
    getClassQueries,
    downloadClassQueryAttachment,
    getPendingTasks
};