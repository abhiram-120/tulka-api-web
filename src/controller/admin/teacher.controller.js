const User = require('../../models/users');
const Class = require('../../models/classes');
const TeacherAvailability = require('../../models/teacherAvailability');
const TeacherHoliday = require('../../models/teacherHoliday');
const UserReview = require('../../models/userReviews');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const SubscriptionPlan = require('../../models/subscription_plan');
const PaymentTransaction = require('../../models/PaymentTransaction');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const { Op, Sequelize, literal } = require('sequelize');
const moment = require('moment-timezone');
const bcrypt = require('bcrypt');
const RegularClass = require('../../models/regularClass');

/**
 * Get all teachers with pagination, filtering, and search
 */
async function getTeachers(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            status = 'all',
            rating = 'all',
            availability = 'all',
            sortBy = 'created_at',
            sortOrder = 'desc'
        } = req.query;

        // Base where conditions for teachers
        const whereConditions = {
            role_name: 'teacher'
        };

        // Search conditions
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status.toLowerCase() !== 'all') {
            whereConditions.status = status.toLowerCase();
        }

        // Determine sorting parameters
        let order = [[sortBy, sortOrder.toUpperCase()]];
        if (sortBy === 'rating') {
            order = [[literal('avg_rating'), sortOrder.toUpperCase()]];
        }

        // Modified query to deal with GROUP BY issues
        // First, get all teacher IDs that match the criteria
        const teacherQuery = {
            where: whereConditions,
            attributes: ['id'],
            include: [
                {
                    model: UserReview,
                    as: 'teacherReviews',
                    required: false,
                    attributes: []
                }
            ],
            group: ['User.id'],
            having: {}
        };

        // Filter by rating if specified
        if (rating && rating !== 'all') {
            const [minRating, maxRating] = rating.split('-').map(Number);
            teacherQuery.attributes.push([Sequelize.fn('AVG', Sequelize.col('teacherReviews.rates')), 'avg_rating']);
            teacherQuery.having = Sequelize.literal(`avg_rating >= ${minRating} AND avg_rating <= ${maxRating}`);
        }

        // Get matching teacher IDs
        const matchingTeachers = await User.findAll(teacherQuery);
        const teacherIds = matchingTeachers.map((t) => t.id);

        // If no matching teachers, return empty result
        if (teacherIds.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No teachers found',
                data: {
                    teachers: [],
                    pagination: {
                        total: 0,
                        current_page: parseInt(page),
                        total_pages: 0,
                        per_page: parseInt(limit)
                    }
                }
            });
        }

        // Now fetch complete teacher data without GROUP BY issues
        const queryOptions = {
            where: {
                id: { [Op.in]: teacherIds }
            },
            include: [
                {
                    model: TeacherAvailability,
                    as: 'availability',
                    required: false,
                    attributes: [
                        'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
                    ]
                },
                {
                    model: TeacherHoliday,
                    as: 'holidays',
                    required: false,
                    where: {
                        status: 'approved',
                        form_date: {
                            [Op.lte]: Sequelize.fn('DATE_ADD', Sequelize.fn('CURDATE'), Sequelize.literal('INTERVAL 30 DAY'))
                        },
                        to_date: {
                            [Op.gte]: Sequelize.fn('CURDATE')
                        }
                    }
                }
            ],
            attributes: [
                'id', 'full_name', 'email', 'mobile', 'status',
                'created_at', 'verified', 'role_name', 'role_id',
                'timezone', 'experience', 'education', 'avatar',
                [
                    Sequelize.literal(`(
                        SELECT AVG(rates) 
                        FROM user_reviews 
                        WHERE user_reviews.instructor_id = User.id
                    )`),
                    'avg_rating'
                ],
                [
                    Sequelize.literal(`(
                        SELECT COUNT(*) 
                        FROM user_reviews 
                        WHERE user_reviews.instructor_id = User.id
                    )`),
                    'review_count'
                ],
                [
                    Sequelize.literal(`(
                        SELECT COUNT(*) 
                        FROM classes 
                        WHERE classes.teacher_id = User.id 
                        AND classes.meeting_start >= NOW() 
                        AND classes.status = 'pending'
                    )`),
                    'upcoming_classes'
                ]
            ],
            group: ['User.id'],
            order,
            offset: (page - 1) * limit,
            limit: parseInt(limit)
        };

        // Add optional next class information as a separate query
        const addNextClassInfo = async (teachers) => {
            return Promise.all(teachers.map(async (teacher) => {
                // Find the next class for this teacher
                const nextClass = await Class.findOne({
                    where: {
                        teacher_id: teacher.id,
                        meeting_start: { [Op.gte]: new Date() },
                        status: 'pending'
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

                // Prepare next class information
                let nextClassInfo = null;
                if (nextClass) {
                    const utcDate = moment.utc(nextClass.meeting_start);
                    nextClassInfo = {
                        date: {
                            israel: utcDate.tz('Asia/Jerusalem').format('YYYY-MM-DD HH:mm:ss'),
                            teacher: teacher.timezone ? utcDate.tz(teacher.timezone).format('YYYY-MM-DD HH:mm:ss') : null,
                            utc: utcDate.format('YYYY-MM-DD HH:mm:ss')
                        },
                        student: nextClass.Student
                            ? {
                                id: nextClass.Student.id,
                                name: nextClass.Student.full_name,
                                email: nextClass.Student.email
                            }
                            : null,
                        status: nextClass.status
                    };
                }

                // Modify the teacher object
                return {
                    ...teacher.toJSON(),
                    next_class: nextClassInfo
                };
            })
            );
        };

        // Execute query
        const teachers = await User.findAll(queryOptions);
        const totalCount = teacherIds.length;

        // Format teachers
        const formattedTeachers = await addNextClassInfo(teachers);

        // Calculate availability and finalize formatting
        const finalTeachers = formattedTeachers.map((teacher) => {
            const availabilityPercentage = calculateActualAvailabilityPercentage(teacher);

            const holidays = teacher.holidays
                ? teacher.holidays.map((holiday) => ({
                    id: holiday.id,
                    title: holiday.title,
                    reason: holiday.reason,
                    startDate: holiday.form_date,
                    endDate: holiday.to_date,
                    status: holiday.status
                }))
                : [];

            return {
                id: teacher.id,
                full_name: teacher.full_name,
                avatar: teacher.avatar,
                email: teacher.email,
                mobile: teacher.mobile,
                timezone: teacher.timezone,
                experience: teacher.experience,
                education: teacher.education,
                role: {
                    name: teacher.role_name,
                    id: teacher.role_id
                },
                registration: {
                    date: teacher.created_at,
                    status: teacher.status || 'N/A',
                    verified: teacher.verified
                },
                metrics: {
                    rating: teacher.avg_rating ? parseFloat(teacher.avg_rating).toFixed(1) : '0.0',
                    reviewCount: parseInt(teacher.review_count || 0),
                    upcomingClasses: parseInt(teacher.upcoming_classes || 0),
                    availability: availabilityPercentage + '%'
                },
                next_class: teacher.next_class,
                holidays
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Teachers fetched successfully',
            data: {
                teachers: finalTeachers,
                pagination: {
                    total: totalCount,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(totalCount / limit),
                    per_page: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Error fetching teachers:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teachers',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teacher details by ID
 */
async function getTeacherDetails(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            },
            include: [
                {
                    model: TeacherAvailability,
                    as: 'availability',
                    required: false
                },
                {
                    model: TeacherHoliday,
                    as: 'holidays',
                    required: false,
                    where: {
                        to_date: {
                            [Op.gte]: Sequelize.fn('CURDATE')
                        }
                    },
                    order: [['form_date', 'ASC']]
                },
                {
                    model: Class,
                    as: 'TeacherClasses',
                    required: false,
                    where: {
                        meeting_start: {
                            [Op.gte]: Sequelize.fn('NOW')
                        }
                    },
                    include: [
                        {
                            model: User,
                            as: 'Student',
                            attributes: ['id', 'full_name', 'email', 'mobile']
                        }
                    ],
                    order: [['meeting_start', 'ASC']],
                    limit: 10
                },
                {
                    model: UserReview,
                    as: 'teacherReviews',
                    required: false,
                    include: [
                        {
                            model: User,
                            as: 'reviewer',
                            attributes: ['id', 'full_name', 'avatar']
                        }
                    ],
                    order: [['created_at', 'DESC']],
                    limit: 5
                }
            ],
            attributes: [
                'id', 'full_name', 'email', 'mobile', 'status',
                'created_at', 'verified', 'role_name', 'role_id',
                'timezone', 'experience', 'education', 'bio', 'avatar',
                'subject', 'video_demo', 'video_demo_source', 'about',
                'address', 'city', 'country_id', 'total_hours'
            ]
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        const upcomingClasses = teacher.TeacherClasses ? teacher.TeacherClasses.map(cls => {
            const utcDate = moment.utc(cls.meeting_start);
            const endDate = moment.utc(cls.meeting_end);

            return {
                id: cls.id,
                start: {
                    israel: utcDate.tz('Asia/Jerusalem').format('YYYY-MM-DD HH:mm:ss'),
                    teacher: teacher.timezone ? utcDate.tz(teacher.timezone).format('YYYY-MM-DD HH:mm:ss') : null,
                    utc: utcDate.format('YYYY-MM-DD HH:mm:ss')
                },
                end: {
                    israel: endDate.tz('Asia/Jerusalem').format('YYYY-MM-DD HH:mm:ss'),
                    teacher: teacher.timezone ? endDate.tz(teacher.timezone).format('YYYY-MM-DD HH:mm:ss') : null,
                    utc: endDate.format('YYYY-MM-DD HH:mm:ss')
                },
                status: cls.status,
                student: cls.Student ? {
                    id: cls.Student.id,
                    name: cls.Student.full_name,
                    email: cls.Student.email,
                    mobile: cls.Student.mobile
                } : null
            };
        })
            : [];

        const teacherWithCalculatedData = {
            ...teacher.toJSON(),
            availability: teacher.availability,
            holidays: teacher.holidays,
            upcoming_classes: upcomingClasses.length
        };

        const availabilityPercentage = calculateActualAvailabilityPercentage(teacherWithCalculatedData);

        let availabilityByDay = {};
        if (teacher.availability) {
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            days.forEach((day) => {
                try {
                    const dayData = JSON.parse(teacher.availability[day] || '{}');
                    const slots = Object.values(dayData);
                    const availableDaySlots = slots.filter((slot) => slot === true).length;

                    availabilityByDay[day] = {
                        total: slots.length,
                        available: availableDaySlots,
                        percentage: slots.length > 0 ? (availableDaySlots / slots.length) * 100 : 0
                    };
                } catch (e) {
                    console.error(`Error parsing availability for ${day}:`, e);
                    availabilityByDay[day] = { total: 0, available: 0, percentage: 0 };
                }
            });
        }

        const holidays = teacher.holidays
            ? teacher.holidays.map((holiday) => ({
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: holiday.form_date,
                endDate: holiday.to_date,
                status: holiday.status
            }))
            : [];

        // Calculate average rating
        let avgRating = 0;
        if (teacher.teacherReviews && teacher.teacherReviews.length > 0) {
            const sum = teacher.teacherReviews.reduce((acc, review) => acc + review.rates, 0);
            avgRating = sum / teacher.teacherReviews.length;
        }

        // Format reviews
        const reviews = teacher.teacherReviews
            ? teacher.teacherReviews.map((review) => ({
                id: review.id,
                rate: review.rates,
                comment: review.description,
                createdAt: review.created_at,
                reviewer: review.reviewer
                    ? {
                        id: review.reviewer.id,
                        name: review.reviewer.full_name,
                        avatar: review.reviewer.avatar
                    }
                    : null
            }))
            : [];

        // Format the response
        const formattedTeacher = {
            id: teacher.id,
            full_name: teacher.full_name,
            avatar: teacher.avatar,
            email: teacher.email,
            mobile: teacher.mobile,
            timezone: teacher.timezone,
            role: {
                name: teacher.role_name,
                id: teacher.role_id
            },
            registration: {
                date: teacher.created_at,
                status: teacher.status || 'N/A',
                verified: teacher.verified
            },
            bio: teacher.bio,
            experience: teacher.experience,
            education: teacher.education,
            subject: teacher.subject,
            about: teacher.about,
            location: {
                address: teacher.address,
                city: teacher.city,
                country_id: teacher.country_id
            },
            media: {
                video_demo: teacher.video_demo,
                video_source: teacher.video_demo_source
            },
            metrics: {
                total_hours: teacher.total_hours || 0,
                rating: avgRating.toFixed(1),
                reviewCount: reviews.length,
                upcomingClassesCount: upcomingClasses.length,
                availability: availabilityPercentage + '%'
            },
            availability: {
                overall: availabilityPercentage + '%',
                byDay: availabilityByDay
            },
            upcoming_classes: upcomingClasses,
            holidays,
            reviews
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher details fetched successfully',
            data: formattedTeacher
        });
    } catch (err) {
        console.error('Error fetching teacher details:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update teacher information
 */
async function updateTeacher(req, res) {
    try {
        const { id } = req.params;
        const {
            full_name,
            email,
            mobile,
            timezone,
            bio,
            experience,
            education,
            subject,
            about,
            address,
            city,
            country_id,
            status, // Added status to destructuring
            password // Added password field
        } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher first
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }
        const oldStatus = teacher.status;

        // Validate email format
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid email format'
                });
            }

            // Check if email is already taken
            if (email !== teacher.email) {
                const existingUser = await User.findOne({
                    where: {
                        email: email,
                        id: { [Op.ne]: id }
                    }
                });

                if (existingUser) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Email is already taken'
                    });
                }
            }
        }

        // Validate timezone
        if (timezone) {
            try {
                moment.tz(timezone);
            } catch (error) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid timezone'
                });
            }
        }

        // Validate status
        const validStatuses = ['active', 'inactive', 'pending', 'suspended'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        // Prepare update object
        const updateFields = {
            full_name: full_name || teacher.full_name,
            email: email || teacher.email,
            mobile: mobile || teacher.mobile,
            timezone: timezone || teacher.timezone,
            bio: bio !== undefined ? bio : teacher.bio,
            experience: experience !== undefined ? experience : teacher.experience,
            education: education !== undefined ? education : teacher.education,
            subject: subject !== undefined ? subject : teacher.subject,
            about: about !== undefined ? about : teacher.about,
            address: address !== undefined ? address : teacher.address,
            city: city !== undefined ? city : teacher.city,
            country_id: country_id !== undefined ? country_id : teacher.country_id,
            status: status || teacher.status,
            updated_at: Math.floor(Date.now() / 1000)
        };

        const newStatus = updateFields.status;

        // Password update
        if (password && password.trim() !== '') {
            console.log('Hashing password for teacher:', id);
            const salt = await bcrypt.genSalt(10);
            updateFields.password = await bcrypt.hash(password, salt);
            // updateFields.password = await bcrypt.hash(password, 10);
        }

        console.log('updatedTeacher:', updateFields);

        // Update the teacher
        const updatedTeacher = await teacher.update(updateFields);

        if (oldStatus !== "inactive" && newStatus === "inactive") {

            const teacherTZ = teacher.timezone || "Asia/Jerusalem";

            const inactiveAtTeacherTZ = moment()
                .tz(teacherTZ)
                .format("YYYY-MM-DD HH:mm:ss");

            const inactiveAtUTC = moment
                .tz(inactiveAtTeacherTZ, teacherTZ)
                .utc()
                .format("YYYY-MM-DD HH:mm:ss");

            // Fetch pending AND scheduled classes
            const futureClasses = await Class.findAll({
                where: {
                    teacher_id: id,
                    status: { [Op.in]: ["pending", "scheduled"] },
                    meeting_start: { [Op.gt]: inactiveAtUTC }
                },
                raw: true
            });

            // Cancel classes
            await Class.update(
                {
                    status: "canceled",
                    cancellation_reason: "Teacher status changed to inactive",
                    cancelled_by: req.user?.id || null,
                    cancelled_at: new Date()
                },
                {
                    where: {
                        teacher_id: id,
                        status: { [Op.in]: ["pending", "scheduled"] },
                        meeting_start: { [Op.gt]: inactiveAtUTC },
                        is_regular_hide:0,
                    }
                }
            );

            // Count cancellations per student
            const countMap = {};
            futureClasses.forEach(c => {
                const sid = c.student_id ?? c.studentId;
                if (sid) {
                    countMap[sid] = (countMap[sid] || 0) + 1;
                }
            });

            const studentIds = Object.keys(countMap).map(id => Number(id));

            const activeStudents = await User.findAll({
                where: { id: studentIds },
                raw: true
            });

            const activeSubscriptions = await UserSubscriptionDetails.findAll({
                where: {
                    user_id: activeStudents.map(s => s.id),
                    status: "active",
                    is_cancel: 0,
                },
                order: [['id', 'DESC']]
            });

            for (const sub of activeSubscriptions) {
                const addCount = countMap[sub.user_id] || 0;

                await UserSubscriptionDetails.update(
                    {
                        left_lessons: (sub.left_lessons || 0) + addCount
                    },
                    {
                        where: { id: sub.id }
                    }
                );
            }
            await RegularClass.destroy({
                where: { teacher_id: id }
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Teacher updated successfully',
            data: {
                id: updatedTeacher.id,
                full_name: updatedTeacher.full_name,
                email: updatedTeacher.email,
                mobile: updatedTeacher.mobile,
                timezone: updatedTeacher.timezone,
                bio: updatedTeacher.bio,
                experience: updatedTeacher.experience,
                education: updatedTeacher.education,
                subject: updatedTeacher.subject,
                about: updatedTeacher.about,
                address: updatedTeacher.address,
                city: updatedTeacher.city,
                country_id: updatedTeacher.country_id,
                status: updatedTeacher.status
            }
        });
    } catch (err) {
        console.error('Error updating teacher:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update teacher',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update teacher password
 */
async function updatePassword(req, res) {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 6 characters long'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update the password
        await teacher.update({
            password: hashedPassword,
            updated_at: Math.floor(Date.now() / 1000)
        });

        return res.status(200).json({
            status: 'success',
            message: 'Password updated successfully'
        });
    } catch (err) {
        console.error('Error updating password:', err);
        console.error('Error stack:', err.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update password',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Deactivate a teacher
 */
async function inactivateTeacher(req, res) {
    try {
        const { id } = req.params;
        const { reason, cancelClasses } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Update teacher status
        await teacher.update({
            status: 'inactive',
            updated_at: Math.floor(Date.now() / 1000),
            offline: true,
            offline_message: reason
        });

        // If cancelClasses is true, cancel all future classes
        if (cancelClasses) {
            await Class.update(
                {
                    status: 'canceled',
                    updated_at: Math.floor(Date.now() / 1000),
                    cancellation_reason: 'Teacher deactivated by admin',
                    cancelled_by: req.user?.id || null,
                    cancelled_at: new Date()
                },
                {
                    where: {
                        teacher_id: id,
                        meeting_start: {
                            [Op.gt]: new Date()
                        },
                        status: 'pending'
                    }
                }
            );
        }

        return res.status(200).json({
            status: 'success',
            message: 'Teacher inactivated successfully'
        });
    } catch (err) {
        console.error('Error inactivating teacher:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to inactivate teacher',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Activate a teacher
 */
async function activateTeacher(req, res) {
    try {
        const { id } = req.params;
        const { note } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Update teacher status
        await teacher.update({
            status: 'active',
            updated_at: Math.floor(Date.now() / 1000),
            offline: false,
            offline_message: note || null
        });

        return res.status(200).json({
            status: 'success',
            message: 'Teacher activated successfully'
        });
    } catch (err) {
        console.error('Error activating teacher:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to activate teacher',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teacher availability
 */
async function getTeacherAvailability(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            },
            include: [
                {
                    model: TeacherAvailability,
                    as: 'availability',
                    required: false
                }
            ]
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        if (!teacher.availability) {
            return res.status(200).json({
                status: 'success',
                message: 'Teacher has no availability set',
                data: {
                    mon: {},
                    tue: {},
                    wed: {},
                    thu: {},
                    fri: {},
                    sat: {},
                    sun: {}
                }
            });
        }

        // Format availability data
        const availabilityData = {
            mon: JSON.parse(teacher.availability.mon || '{}'),
            tue: JSON.parse(teacher.availability.tue || '{}'),
            wed: JSON.parse(teacher.availability.wed || '{}'),
            thu: JSON.parse(teacher.availability.thu || '{}'),
            fri: JSON.parse(teacher.availability.fri || '{}'),
            sat: JSON.parse(teacher.availability.sat || '{}'),
            sun: JSON.parse(teacher.availability.sun || '{}')
        };

        return res.status(200).json({
            status: 'success',
            message: 'Teacher availability fetched successfully',
            data: availabilityData
        });
    } catch (err) {
        console.error('Error fetching teacher availability:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher availability',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update teacher availability
 */
async function updateTeacherAvailability(req, res) {
    try {
        const { id } = req.params;
        const { mon, tue, wed, thu, fri, sat, sun } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Find or create availability record
        const [availability, created] = await TeacherAvailability.findOrCreate({
            where: { user_id: id },
            defaults: {
                user_id: id,
                mon: '{}',
                tue: '{}',
                wed: '{}',
                thu: '{}',
                fri: '{}',
                sat: '{}',
                sun: '{}'
            }
        });

        // Update availability
        await availability.update({
            mon: mon ? JSON.stringify(mon) : availability.mon,
            tue: tue ? JSON.stringify(tue) : availability.tue,
            wed: wed ? JSON.stringify(wed) : availability.wed,
            thu: thu ? JSON.stringify(thu) : availability.thu,
            fri: fri ? JSON.stringify(fri) : availability.fri,
            sat: sat ? JSON.stringify(sat) : availability.sat,
            sun: sun ? JSON.stringify(sun) : availability.sun
        });

        return res.status(200).json({
            status: 'success',
            message: 'Teacher availability updated successfully',
            data: {
                mon: JSON.parse(availability.mon),
                tue: JSON.parse(availability.tue),
                wed: JSON.parse(availability.wed),
                thu: JSON.parse(availability.thu),
                fri: JSON.parse(availability.fri),
                sat: JSON.parse(availability.sat),
                sun: JSON.parse(availability.sun)
            }
        });
    } catch (err) {
        console.error('Error updating teacher availability:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update teacher availability',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teacher holidays
 */
async function getTeacherHolidays(req, res) {
    try {
        const { id } = req.params;
        const { status, upcoming } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Build where conditions for holidays
        const whereConditions = { user_id: id };

        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        if (upcoming === 'true') {
            whereConditions.to_date = {
                [Op.gte]: Sequelize.fn('CURDATE')
            };
        }

        // Get holidays
        const holidays = await TeacherHoliday.findAll({
            where: whereConditions,
            order: [['form_date', 'DESC']]
        });

        // Format holiday data
        const formattedHolidays = holidays.map((holiday) => ({
            id: holiday.id,
            title: holiday.title,
            reason: holiday.reason,
            startDate: holiday.form_date,
            endDate: holiday.to_date,
            status: holiday.status,
            approver_id: holiday.approver_id,
            response: holiday.response
        }));

        return res.status(200).json({
            status: 'success',
            message: 'Teacher holidays fetched successfully',
            data: formattedHolidays
        });
    } catch (err) {
        console.error('Error fetching teacher holidays:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher holidays',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Create a holiday request for a teacher
 */
async function createHoliday(req, res) {
    try {
        const { id } = req.params;
        const { title, reason, start_date, end_date } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        if (!title || !start_date || !end_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Title, start date, and end date are required'
            });
        }

        // Find the teacher
        const teacher = await User.findOne({
            where: {
                id: id,
                role_name: 'teacher'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Validate dates
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format'
            });
        }

        if (startDate > endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Start date must be before end date'
            });
        }

        // Check for overlapping holidays
        const overlappingHoliday = await TeacherHoliday.findOne({
            where: {
                user_id: id,
                [Op.or]: [
                    {
                        // New holiday starts during an existing holiday
                        form_date: { [Op.lte]: startDate },
                        to_date: { [Op.gte]: startDate }
                    },
                    {
                        // New holiday ends during an existing holiday
                        form_date: { [Op.lte]: endDate },
                        to_date: { [Op.gte]: endDate }
                    },
                    {
                        // New holiday completely contains an existing holiday
                        form_date: { [Op.gte]: startDate },
                        to_date: { [Op.lte]: endDate }
                    }
                ],
                status: { [Op.ne]: 'rejected' }
            }
        });

        if (overlappingHoliday) {
            return res.status(400).json({
                status: 'error',
                message: 'This holiday period overlaps with an existing holiday'
            });
        }

        // Create holiday
        const holiday = await TeacherHoliday.create({
            user_id: id,
            title,
            reason,
            form_date: startDate,
            to_date: endDate,
            status: 'pending'
        });

        return res.status(201).json({
            status: 'success',
            message: 'Holiday request created successfully',
            data: {
                id: holiday.id,
                title: holiday.title,
                reason: holiday.reason,
                startDate: holiday.form_date,
                endDate: holiday.to_date,
                status: holiday.status
            }
        });
    } catch (err) {
        console.error('Error creating holiday:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create holiday',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update holiday status (approve/reject)
 */
async function updateHolidayStatus(req, res) {
    try {
        const { id, holidayId } = req.params;
        const { status, response } = req.body;

        if (!id || !holidayId) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID and Holiday ID are required'
            });
        }

        if (!status || !['approved', 'rejected'].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid status (approved/rejected) is required'
            });
        }

        // Find the holiday
        const holiday = await TeacherHoliday.findOne({
            where: {
                id: holidayId,
                user_id: id
            }
        });

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        // Update holiday status
        await holiday.update({
            status,
            response,
            approver_id: req.user?.id || null
        });

        // If holiday is approved and it's for current/future dates, handle class cancellations
        if (status === 'approved' && new Date(holiday.to_date) >= new Date()) {
            await Class.update(
                {
                    status: 'canceled',
                    updated_at: Math.floor(Date.now() / 1000),
                    cancellation_reason: `Teacher on holiday: ${holiday.title}`,
                    cancelled_by: req.user?.id || null,
                    cancelled_at: new Date()
                },
                {
                    where: {
                        teacher_id: id,
                        meeting_start: {
                            [Op.between]: [holiday.form_date, holiday.to_date]
                        },
                        status: 'pending'
                    }
                }
            );
        }

        return res.status(200).json({
            status: 'success',
            message: `Holiday ${status} successfully`,
            data: {
                id: holiday.id,
                title: holiday.title,
                status: holiday.status,
                response: holiday.response
            }
        });
    } catch (err) {
        console.error('Error updating holiday status:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update holiday status',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teachers currently on holiday
 */
async function getTeachersOnHoliday(req, res) {
    try {
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher'
            },
            include: [
                {
                    model: TeacherHoliday,
                    as: 'holidays',
                    required: true,
                    where: {
                        status: 'approved',
                        form_date: { [Op.lte]: Sequelize.fn('CURDATE') },
                        to_date: { [Op.gte]: Sequelize.fn('CURDATE') }
                    }
                }
            ],
            attributes: ['id', 'full_name', 'email', 'avatar']
        });

        const formattedTeachers = teachers.map((teacher) => ({
            id: teacher.id,
            name: teacher.full_name,
            email: teacher.email,
            avatar: teacher.avatar,
            holiday: {
                title: teacher.holidays[0].title,
                reason: teacher.holidays[0].reason,
                startDate: teacher.holidays[0].form_date,
                endDate: teacher.holidays[0].to_date
            }
        }));

        return res.status(200).json({
            status: 'success',
            message: 'Teachers on holiday fetched successfully',
            data: formattedTeachers
        });
    } catch (err) {
        console.error('Error fetching teachers on holiday:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teachers on holiday',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get absent and late teachers
 */
async function getAbsentLateTeachers(req, res) {
    try {
        const { period = '30days' } = req.query;

        // Determine date range based on period
        let startDate;
        const endDate = new Date();

        switch (period) {
            case '7days':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30days':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
                break;
            case '90days':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 90);
                break;
            default:
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
        }

        // Get absent classes
        const absentClasses = await Class.findAll({
            where: {
                status: 'absent',
                meeting_start: {
                    [Op.between]: [startDate, endDate]
                }
            },
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name']
                }
            ],
            order: [['meeting_start', 'DESC']]
        });

        // Process and aggregate data
        const teacherAbsenceMap = new Map();

        absentClasses.forEach((cls) => {
            if (!cls.Teacher) return;

            const teacherId = cls.Teacher.id;
            if (!teacherAbsenceMap.has(teacherId)) {
                teacherAbsenceMap.set(teacherId, {
                    id: teacherId,
                    name: cls.Teacher.full_name,
                    email: cls.Teacher.email,
                    avatar: cls.Teacher.avatar,
                    absences: [],
                    totalAbsent: 0
                });
            }

            teacherAbsenceMap.get(teacherId).absences.push({
                classId: cls.id,
                date: cls.meeting_start,
                student: cls.Student ? cls.Student.full_name : 'N/A'
            });
            teacherAbsenceMap.get(teacherId).totalAbsent++;
        });

        // Convert map to array and sort by number of absences
        const absentTeachers = Array.from(teacherAbsenceMap.values()).sort((a, b) => b.totalAbsent - a.totalAbsent);

        return res.status(200).json({
            status: 'success',
            message: 'Absent teachers fetched successfully',
            data: {
                period,
                teachers: absentTeachers
            }
        });
    } catch (err) {
        console.error('Error fetching absent/late teachers:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch absent/late teachers',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teacher's students with filtering and pagination
 */

async function getTeacherStudents(req, res) {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10, search, sortBy = 'name', sortOrder = 'asc' } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        const teacher = await User.findOne({ where: { id, role_name: 'teacher' } });
        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // ===============================
        // 1️⃣ Find all students who have recurring (non-trial) classes
        // ===============================
        const classRecords = await Class.findAll({
            where: {
                teacher_id: id,
                is_trial: false,
                student_id: { [Op.ne]: null }
            },
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('student_id')), 'student_id']],
            raw: true
        });

        const studentIds = classRecords.map((r) => r.student_id);

        if (studentIds.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No subscribed students found for this teacher',
                data: {
                    students: [],
                    stats: {
                        totalStudents: 0,
                        activeStudents: 0,
                        totalClasses: 0,
                        averageRetention: '0 months'
                    },
                    pagination: {
                        total: 0,
                        current_page: parseInt(page),
                        total_pages: 0,
                        per_page: parseInt(limit)
                    }
                }
            });
        }

        // ===============================
        // 2️⃣ Base where condition for all students
        // ===============================
        let baseConditions = {
            id: { [Op.in]: studentIds },
            role_name: 'user'
        };

        if (search) {
            baseConditions[Op.or] = [{ full_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }, { mobile: { [Op.like]: `%${search}%` } }];
        }

        // ===============================
        // 3️⃣ Fetch all students (for metrics)
        // ===============================
        const allStudents = await User.findAll({
            where: baseConditions,
            include: [
                {
                    model: Class,
                    as: 'StudentClasses',
                    where: { teacher_id: id, is_trial: false },
                    required: false,
                    attributes: ['id', 'meeting_start', 'meeting_end', 'status', 'is_trial', 'student_id', 'teacher_id']
                },
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    where: { status: { [Op.ne]: null } },
                    attributes: [
                        "id",
                        "how_often",
                        "lesson_min",
                        "status",
                        "is_cancel",
                        "left_lessons",
                        "weekly_lesson",
                        "weekly_comp_class"
                    ]
                }
            ]
        });

        // ===============================
        // 4️⃣ Format & calculate details
        // ===============================
        const processedStudents = allStudents
            .map((student) => {
                const data = student.toJSON();
                const classes = data.StudentClasses || [];
                let subDetails = null;

                if (Array.isArray(data.UserSubscriptions)) {
                    subDetails =
                        data.UserSubscriptions.find(
                            (s) => s.status === "active" && (s.is_cancel == 0 || s.is_cancel === false)
                        ) || data.UserSubscriptions[0] || null;
                }

                console.log('subdetails',subDetails);

                // ---- Calculate Lesson Counts ----
                let completedClasses = 0;
                let upcomingClasses = 0;

                if (subDetails && subDetails.weekly_lesson != null) {
                    completedClasses = Number(subDetails.weekly_comp_class) || 0;
                    upcomingClasses = Number(subDetails.left_lessons) || 0;
                } else {
                    // fallback DB calculation
                    completedClasses = classes.filter((c) => c.status === "ended").length;
                    upcomingClasses = classes.filter(
                        (c) =>
                            (c.status === "pending" || c.status === "scheduled") &&
                            new Date(c.meeting_start) >= new Date()
                    ).length;
                }

                // ---- Compute Last & Next Class ----
                let lastCompleted = null;
                let nextUpcoming = null;

                if (classes.length > 0) {
                    // last completed class
                    lastCompleted = classes
                        .filter(c => c.status === "completed" || c.status === "ended")
                        .sort((a, b) => new Date(b.meeting_start) - new Date(a.meeting_start))[0];

                    // next upcoming class
                    nextUpcoming = classes
                        .filter(
                            c =>
                                (c.status === "pending" || c.status === "scheduled") &&
                                new Date(c.meeting_start) >= new Date()
                        )
                        .sort((a, b) => new Date(a.meeting_start) - new Date(b.meeting_start))[0];
                }

                // ---- Plan Type ----
                // const planType =
                //     subDetails && subDetails.how_often && subDetails.lesson_min
                //         ? `${subDetails.how_often} lessons/month • ${subDetails.lesson_min}-minute lesson`
                //         : "Plan not available";

                let planType = "Plan not available";

                if (subDetails) {
                    const lessons = subDetails.weekly_lesson ?? null;
                    const minutes = subDetails.lesson_min ?? null;

                    if (lessons && minutes) {
                        planType = `${lessons} lessons/month • ${minutes}-minute lesson`;
                    } else if (subDetails.how_often && minutes) {
                        // Backup if weekly_lesson is missing (rare)
                        planType = `${subDetails.how_often} • ${minutes}-minute lesson`;
                    }
                }

                // ---- Subscription Status ----
                const subscriptionStatus =
                    subDetails && subDetails.status === "active" && subDetails.is_cancel == 0
                        ? "active"
                        : "inactive";

                // ---- Retention ----
                let retentionMonths = "0 months";
                if (classes.length > 0) {
                    const firstClass = classes.sort(
                        (a, b) => new Date(a.meeting_start) - new Date(b.meeting_start)
                    )[0];

                    const totalDays = moment().diff(moment(firstClass.meeting_start), "days");
                    retentionMonths = `${Math.ceil(totalDays / 30)} months`;
                }

                return {
                    id: data.id,
                    name: data.full_name,
                    email: data.email,
                    mobile: data.mobile,
                    avatar: data.avatar,
                    subscriptionStatus,
                    classesSummary: {
                        completed: completedClasses,
                        upcoming: upcomingClasses
                    },
                    lastClass: lastCompleted
                        ? {
                            date: moment(lastCompleted.meeting_start).format('DD MMM YYYY'),
                            time: moment(lastCompleted.meeting_start).format('HH:mm')
                        }
                        : null,
                    nextClass: nextUpcoming
                        ? {
                            date: moment(nextUpcoming.meeting_start).format('DD MMM YYYY'),
                            time: moment(nextUpcoming.meeting_start).format('HH:mm')
                        }
                        : null,
                    planType,
                    retentionTime: retentionMonths
                };
            })
            .filter(Boolean);

        // ===============================
        // 5️⃣ Sort active first
        // ===============================
        processedStudents.sort((a, b) => {
            if (a.subscriptionStatus === b.subscriptionStatus) return 0;
            return a.subscriptionStatus === 'active' ? -1 : 1;
        });

        // ===============================
        // 6️⃣ Pagination
        // ===============================
        const startIndex = (page - 1) * limit;
        const paginatedStudents = processedStudents.slice(startIndex, startIndex + parseInt(limit));

        // ===============================
        // 7️⃣ Global metrics (from full data)
        // ===============================
        const stats = {
            totalStudents: processedStudents.length,
            activeStudents: processedStudents.filter((s) => s.subscriptionStatus === 'active').length,
            totalClasses: processedStudents.reduce((sum, s) => sum + s.classesSummary.completed, 0),
            averageRetention:
                processedStudents.length > 0
                    ? Math.ceil(
                        processedStudents.reduce((sum, s) => {
                            const months = parseFloat(s.retentionTime.split(' ')[0]) || 0;
                            return sum + months;
                        }, 0) / processedStudents.length
                    ) + ' months'
                    : '0 months'
        };

        // ===============================
        // 8️⃣ Response
        // ===============================

        return res.status(200).json({
            status: 'success',
            message: 'Teacher students fetched successfully',
            data: {
                students: paginatedStudents,
                stats,
                pagination: {
                    total: processedStudents.length,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(processedStudents.length / limit),
                    per_page: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Error fetching teacher students:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher students',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get teacher student details using existing associations
 */
async function getTeacherStudentDetails(req, res) {
    try {
        const { id, studentId } = req.params;

        if (!id || !studentId) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID and Student ID are required'
            });
        }

        // Verify teacher exists
        const teacher = await User.findOne({
            where: { id: id, role_name: 'teacher' }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Get student details with classes using associations
        const student = await User.findOne({
            where: { id: studentId, role_name: 'user' },
            include: [
                {
                    model: Class,
                    as: 'StudentClasses',
                    where: {
                        teacher_id: id
                    },
                    required: false,
                    order: [['meeting_start', 'DESC']],
                    limit: 50
                }
            ]
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const classes = student.StudentClasses || [];

        const studentDetails = {
            student: {
                id: student.id,
                name: student.full_name,
                email: student.email,
                mobile: student.mobile,
                avatar: student.avatar,
                status: student.status
            },
            relationship: {
                firstClass: classes.length > 0 ? classes[classes.length - 1].meeting_start : null,
                lastClass: classes.find((c) => c.status === 'completed')?.meeting_start || null,
                totalClasses: classes.length,
                completedClasses: classes.filter((c) => c.status === 'completed').length,
                upcomingClasses: classes.filter((c) => (c.status === 'pending' || c.status === 'scheduled') && new Date(c.meeting_start) >= new Date()).length
            },
            classes: classes.map((cls) => ({
                id: cls.id,
                date: cls.meeting_start,
                status: cls.status,
                isTrial: cls.is_trial,
                isPresent: cls.is_present
            }))
        };

        return res.status(200).json({
            status: 'success',
            message: 'Student details fetched successfully',
            data: studentDetails
        });
    } catch (err) {
        console.error('Error fetching student details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch student details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get top performing teachers based on ratings and metrics - FIXED
 */
async function getTopPerformingTeachers(req, res) {
    try {
        const { limit = 10 } = req.query;

        // First get teachers with reviews (without GROUP BY to avoid field reference issues)
        const teachersWithReviews = await UserReview.findAll({
            where: {
                status: 'active' // Only active reviews
            },
            include: [
                {
                    model: User,
                    as: 'instructor',
                    where: {
                        role_name: 'teacher',
                        status: 'active'
                    },
                    attributes: ['id', 'full_name', 'avatar', 'email']
                }
            ],
            attributes: ['instructor_id', 'rates'],
            raw: true
        });

        if (teachersWithReviews.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No top performing teachers found',
                data: []
            });
        }

        // Group by teacher and calculate metrics
        const teacherMetrics = new Map();

        teachersWithReviews.forEach((review) => {
            const teacherId = review.instructor_id;
            const rating = parseFloat(review.rates);

            if (!teacherMetrics.has(teacherId)) {
                teacherMetrics.set(teacherId, {
                    id: teacherId,
                    name: review['instructor.full_name'],
                    avatar: review['instructor.avatar'],
                    email: review['instructor.email'],
                    ratings: [],
                    totalRating: 0,
                    reviewCount: 0
                });
            }

            const teacher = teacherMetrics.get(teacherId);
            teacher.ratings.push(rating);
            teacher.totalRating += rating;
            teacher.reviewCount++;
        });
        console.log('Teachers with reviews:', teachersWithReviews);

        // Calculate averages and filter
        const qualifiedTeachers = [];
        for (const [teacherId, teacher] of teacherMetrics) {
            const avgRating = teacher.totalRating / teacher.reviewCount;

            // Only include teachers with 4.0+ rating and 5+ reviews
            if (avgRating >= 4.0 && teacher.reviewCount >= 5) {
                teacher.avgRating = avgRating;
                qualifiedTeachers.push(teacher);
            }
        }

        // Get additional metrics for qualified teachers
        const formattedTeachers = await Promise.all(
            qualifiedTeachers.map(async (teacher, index) => {
                // Get recent class count
                const recentClasses = await Class.count({
                    where: {
                        teacher_id: teacher.id,
                        status: 'completed',
                        meeting_start: { [Op.gte]: moment().subtract(6, 'months').toDate() }
                    }
                });

                // Get unique students count
                const uniqueStudents = await Class.count({
                    where: {
                        teacher_id: teacher.id,
                        status: 'completed',
                        meeting_start: { [Op.gte]: moment().subtract(6, 'months').toDate() },
                        student_id: { [Op.ne]: null }
                    },
                    distinct: true,
                    col: 'student_id'
                });

                // Get trial conversion rate
                const trialClasses = await Class.count({
                    where: {
                        teacher_id: teacher.id,
                        is_trial: true,
                        meeting_start: { [Op.gte]: moment().subtract(6, 'months').toDate() }
                    }
                });

                // Simple conversion calculation based on trial classes and active subscriptions
                const conversions = await UserSubscriptionDetails.count({
                    where: {
                        status: 'active',
                        created_at: { [Op.gte]: moment().subtract(6, 'months').toDate() }
                    },
                    include: [
                        {
                            model: User,
                            as: 'SubscriptionUser',
                            include: [
                                {
                                    model: Class,
                                    as: 'StudentClasses',
                                    where: {
                                        teacher_id: teacher.id,
                                        is_trial: true,
                                        meeting_start: { [Op.gte]: moment().subtract(6, 'months').toDate() }
                                    },
                                    required: true
                                }
                            ]
                        }
                    ]
                });

                const conversionRate = trialClasses > 0 ? Math.round((conversions / trialClasses) * 100) : 0;

                // Determine achievement reason
                let reason = '';
                if (teacher.avgRating >= 4.8 && recentClasses >= 100) {
                    reason = 'Outstanding ratings and high class volume';
                } else if (conversionRate >= 70) {
                    reason = 'Exceptional trial-to-enrollment conversion rate';
                } else if (uniqueStudents >= 50) {
                    reason = 'High student retention and engagement';
                } else if (teacher.avgRating >= 4.7) {
                    reason = 'Consistently excellent student feedback';
                } else {
                    reason = 'Strong overall performance metrics';
                }

                return {
                    id: teacher.id,
                    name: teacher.name,
                    avatar: teacher.avatar,
                    email: teacher.email,
                    rating: teacher.avgRating.toFixed(1),
                    reviewCount: teacher.reviewCount,
                    classes: recentClasses,
                    uniqueStudents: uniqueStudents,
                    conversionRate,
                    reason,
                    rank: 0 // Will be set after sorting
                };
            })
        );

        // Sort by rating, then by review count, then by classes
        formattedTeachers.sort((a, b) => {
            if (parseFloat(b.rating) !== parseFloat(a.rating)) {
                return parseFloat(b.rating) - parseFloat(a.rating);
            }
            if (b.reviewCount !== a.reviewCount) {
                return b.reviewCount - a.reviewCount;
            }
            return b.classes - a.classes;
        });

        // Set ranks and limit results
        const topTeachers = formattedTeachers.slice(0, parseInt(limit)).map((teacher, index) => ({
            ...teacher,
            rank: index + 1
        }));

        return res.status(200).json({
            status: 'success',
            message: 'Top performing teachers fetched successfully',
            data: topTeachers
        });
    } catch (err) {
        console.error('Error fetching top performing teachers:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch top performing teachers',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get dashboard analytics for teacher metrics - FIXED
 */
async function getTeacherDashboardAnalytics(req, res) {
    try {
        // Get total teachers count
        const totalTeachers = await User.count({
            where: { role_name: 'teacher' }
        });

        // Get active teachers count
        const activeTeachers = await User.count({
            where: {
                role_name: 'teacher',
                status: 'active'
            }
        });

        // Calculate total lessons in the last 30 days
        const totalLessons = await Class.count({
            where: {
                meeting_start: {
                    [Op.gte]: moment().subtract(30, 'days').toDate()
                },
                status: { [Op.in]: ['completed', 'pending'] }
            }
        });

        // Calculate average lessons per teacher (Total lessons / Active teachers)
        const averageLessons = activeTeachers > 0 ? Math.round(totalLessons / activeTeachers) : 0;

        // Calculate total revenue from active subscriptions - FIXED field reference
        const revenueData = await UserSubscriptionDetails.findAll({
            where: {
                status: 'active'
            },
            include: [
                {
                    model: SubscriptionPlan,
                    as: 'SubscriptionPlan',
                    required: false // Changed to false to handle cases where plan might not exist
                }
            ],
            attributes: ['balance', 'cost_per_lesson', 'created_at'] // Use existing fields
        });

        const totalRevenue = revenueData.reduce((sum, sub) => {
            // Use balance or cost_per_lesson from UserSubscriptionDetails, or total_price from SubscriptionPlan
            const amount = parseFloat(sub.balance || sub.cost_per_lesson || sub.SubscriptionPlan?.total_price || 0);
            return sum + amount;
        }, 0);

        const averageRevenue = activeTeachers > 0 ? Math.round(totalRevenue / activeTeachers) : 0;

        return res.status(200).json({
            status: 'success',
            message: 'Dashboard analytics fetched successfully',
            data: {
                totalTeachers,
                activeTeachers,
                totalLessons,
                averageLessons,
                totalRevenue: Math.round(totalRevenue),
                averageRevenue,
                period: 'last_30_days'
            }
        });
    } catch (err) {
        console.error('Error fetching dashboard analytics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch dashboard analytics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Enhanced Teacher Metrics with correct associations
 */
async function getTeacherMetrics(req, res) {
    try {
        const { id } = req.params;
        const { period = '6months', startDate, endDate } = req.query;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Verify teacher exists
        const teacher = await User.findOne({
            where: { id: id, role_name: 'teacher' }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Calculate date range
        const dateRange = calculateDateRange(period, startDate, endDate);

        // Parallel execution for better performance
        const [revenueMetrics, trialConversionData, retentionData, classesBreakdown, performanceMetrics] = await Promise.all([
            getRevenueMetrics(id, dateRange),
            getTrialConversionData(id, dateRange),
            getRetentionData(id, dateRange),
            getClassesBreakdown(id, dateRange),
            getPerformanceMetrics(id, dateRange)
        ]);

        return res.status(200).json({
            status: 'success',
            message: 'Teacher metrics fetched successfully',
            data: {
                period,
                dateRange,
                revenue: revenueMetrics,
                trialConversion: trialConversionData,
                retention: retentionData,
                classes: classesBreakdown,
                performance: performanceMetrics
            }
        });
    } catch (err) {
        console.error('Error fetching teacher metrics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch teacher metrics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Calculate revenue metrics for the teacher with correct associations
 */
async function getRevenueMetrics(teacherId, dateRange) {
    try {
        // Get students with active subscriptions who have classes with this teacher
        const activeStudentsWithSubscriptions = await UserSubscriptionDetails.findAll({
            where: {
                status: 'active'
            },
            include: [
                {
                    model: User,
                    as: 'SubscriptionUser',
                    where: {
                        role_name: 'user',
                        status: 'active'
                    },
                    include: [
                        {
                            model: Class,
                            as: 'StudentClasses',
                            where: {
                                teacher_id: teacherId,
                                meeting_start: { [Op.gte]: moment().subtract(60, 'days').toDate() },
                                status: { [Op.in]: ['completed', 'pending', 'scheduled'] }
                            },
                            required: true
                        }
                    ]
                },
                {
                    model: SubscriptionPlan,
                    as: 'SubscriptionPlan',
                    required: false
                }
            ]
        });

        // Calculate monthly subscription value using available fields
        const monthlySubscriptionValue = activeStudentsWithSubscriptions.reduce((total, subscription) => {
            // Use balance, cost_per_lesson, or plan total_price
            const amount = parseFloat(subscription.balance || subscription.cost_per_lesson || subscription.SubscriptionPlan?.total_price || 0);

            // Estimate monthly value (this is a simplified calculation)
            const monthlyAmount = subscription.SubscriptionPlan?.duration_id === 1 ? amount : amount / (subscription.SubscriptionPlan?.duration_id || 1);
            return total + monthlyAmount;
        }, 0);

        // Calculate average monthly payment per student
        const avgMonthlyPayment = activeStudentsWithSubscriptions.length > 0 ? monthlySubscriptionValue / activeStudentsWithSubscriptions.length : 0;

        // Calculate average student lifetime
        const avgStudentLifetime = await calculateAvgStudentLifetime(teacherId);

        return {
            monthlySubscriptionValue: Math.round(monthlySubscriptionValue),
            activeStudents: activeStudentsWithSubscriptions.length,
            avgMonthlyPayment: Math.round(avgMonthlyPayment),
            avgStudentLifetime: parseFloat(avgStudentLifetime.toFixed(1))
        };
    } catch (error) {
        console.error('Error in getRevenueMetrics:', error);
        return {
            monthlySubscriptionValue: 0,
            activeStudents: 0,
            avgMonthlyPayment: 0,
            avgStudentLifetime: 0
        };
    }
}

/**
 * Get trial conversion data by month with correct associations
 */

async function getTrialConversionData(teacherId, dateRange) {
    try {
        const monthlyData = [];
        const months = generateMonthlyIntervals(dateRange.start, dateRange.end);

        for (const month of months) {
            const { start, end, label } = month;

            // 1️⃣ Fetch trial classes (completed, missed, ended) EXCLUDING cancelled
            const trialClasses = await Class.findAll({
                where: {
                    teacher_id: teacherId,
                    is_trial: true,
                    demo_class_id: { [Op.ne]: null },
                    meeting_start: { [Op.between]: [start, end] },
                    status: { [Op.ne]: 'cancelled' }
                },
                include: [
                    {
                        model: TrialClassRegistration,
                        as: 'linkedTrialRegistration', // CORRECT ALIAS
                        attributes: ['id', 'email', 'meeting_start'],
                        required: false
                    }
                ]
            });

            const totalTrials = trialClasses.length;

            if (totalTrials === 0) {
                monthlyData.push({
                    month: label,
                    tc: 0,
                    totalTrials: 0,
                    registeredTotal: 0,
                    registeredWithTeacher: 0,
                    notRegistered: 0,
                    conversionRate: 0
                });
                continue;
            }

            // Extract all emails from linked registration
            const trialEmails = trialClasses
                .map(c => c.linkedTrialRegistration?.email)
                .filter(email => email);

            // 2️⃣ Conversions: subscription within 30 days
            const conversions = await UserSubscriptionDetails.findAll({
                where: {
                    created_at: {
                        [Op.between]: [
                            start,
                            moment(end).add(30, "days").toDate()
                        ]
                    }
                },
                include: [
                    {
                        model: User,
                        as: 'SubscriptionUser',
                        required: true,
                        where: { email: { [Op.in]: trialEmails } },
                        attributes: ["id", "email"]
                    }
                ]
            });

            const registeredTotal = conversions.length;

            // 3️⃣ Registered WITH teacher
            let registeredWithTeacher = 0;

            for (const conv of conversions) {
                const studentId = conv.SubscriptionUser.id;

                const hasRegularClass = await Class.findOne({
                    where: {
                        student_id: studentId,
                        teacher_id: teacherId,
                        is_trial: false,
                        meeting_start: { [Op.gte]: start }
                    }
                });

                if (hasRegularClass) registeredWithTeacher++;
            }

            const notRegistered = Math.max(0, totalTrials - registeredTotal);

            const conversionRate = Math.min(
                100,
                Math.round((registeredTotal / totalTrials) * 100)
            );

            monthlyData.push({
                month: label,
                tc: totalTrials,
                totalTrials,
                registeredTotal,
                registeredWithTeacher,
                notRegistered,
                conversionRate
            });
        }

        return monthlyData;

    } catch (error) {
        console.error("Error in getTrialConversionData:", error);
        return [];
    }
}



/**
 * Get retention data (renewals, cancellations, LTV) with correct associations
 */
async function getRetentionData(teacherId, dateRange) {
    try {
        const monthlyData = [];
        const months = generateMonthlyIntervals(dateRange.start, dateRange.end);

        for (const month of months) {
            const { start, end, label } = month;

            // 0️⃣ Get all students of this teacher
            const teacherStudents = await Class.findAll({
                where: {
                    teacher_id: teacherId,
                    student_id: { [Op.ne]: null }
                },
                attributes: ["student_id"],
                group: ["student_id"],
                raw: true
            });

            const studentIds = teacherStudents.map(s => s.student_id);

            if (studentIds.length === 0) {
                monthlyData.push({
                    month: label,
                    renewals: 0,
                    cancellations: 0,
                    ltv: 0
                });
                continue;
            }

            // 1️⃣ RENEWALS — subscription updated to ACTIVE inside this period
            const renewals = await UserSubscriptionDetails.count({
                where: {
                    user_id: { [Op.in]: studentIds },
                    status: "active",
                    updated_at: { [Op.between]: [start, end] }
                }
            });

            // 2️⃣ CANCELLATIONS — subscription cancelled inside this period
            const cancellations = await UserSubscriptionDetails.count({
                where: {
                    user_id: { [Op.in]: studentIds },
                    updated_at: { [Op.between]: [start, end] },
                    [Op.or]: [
                        { status: "cancelled" },
                        { is_cancel: 1 },
                        { cancellation_date: { [Op.ne]: null } }
                    ]
                }
            });

             // 3️⃣ LTV — calculate effective revenue per transaction
            const transactions = await PaymentTransaction.findAll({
                where: {
                    student_id: { [Op.in]: studentIds },
                    created_at: { [Op.lte]: end },
                    status: { [Op.in]: ["success", "refunded"] }
                },
                attributes: ["student_id", "amount", "refund_amount"],
                raw: true
            });

            const revenueMap = {};

            for (const tx of transactions) {
                const sid = tx.student_id;
                const amount = Number(tx.amount || 0);
                const refund = Number(tx.refund_amount || 0);

                const effectiveAmount = amount - refund;

                if (!revenueMap[sid]) revenueMap[sid] = 0;
                revenueMap[sid] += effectiveAmount;
            }

            const totals = Object.values(revenueMap);
            const avgLTV = totals.length
                ? totals.reduce((a, b) => a + b, 0) / totals.length
                : 0;

            monthlyData.push({
                month: label,
                renewals,
                cancellations,
                ltv: Math.round(avgLTV)
            });
        }

        return monthlyData;

    } catch (error) {
        console.error("Error in getRetentionData:", error);
        return [];
    }
}



/**
 * Get classes breakdown (regular vs trial) with correct associations
 */
// async function getClassesBreakdown(teacherId, dateRange) {
//     try {
//         const monthlyData = [];
//         const months = generateMonthlyIntervals(dateRange.start, dateRange.end);

//         for (const month of months) {
//             const classStats = await Class.findAll({
//                 where: {
//                     teacher_id: teacherId,
//                     meeting_start: {
//                         [Op.between]: [month.start, month.end]
//                     }
//                 },
//                 attributes: [
//                     [Sequelize.fn('COUNT', Sequelize.literal('CASE WHEN is_trial = false THEN 1 END')), 'regular'],
//                     [Sequelize.fn('COUNT', Sequelize.literal('CASE WHEN is_trial = true THEN 1 END')), 'trial']
//                 ],
//                 raw: true
//             });

//             monthlyData.push({
//                 month: month.label,
//                 regular: parseInt(classStats[0]?.regular || 0),
//                 trial: parseInt(classStats[0]?.trial || 0)
//             });
//         }

//         return monthlyData;
//     } catch (error) {
//         console.error('Error in getClassesBreakdown:', error);
//         return [];
//     }
// }

async function getClassesBreakdown(teacherId, dateRange) {
    try {
        const monthlyData = [];
        const months = generateMonthlyIntervals(dateRange.start, dateRange.end);

        for (const month of months) {
            const { start, end, label } = month;

            // Fetch all classes for this teacher in the month
            const classes = await Class.findAll({
                where: {
                    teacher_id: teacherId,
                    meeting_start: { [Op.between]: [start, end] },
                    status: { [Op.ne]: "cancelled" } // exclude cancelled
                },
                raw: true
            });

            let trialCount = 0;
            let regularCount = 0;

            for (const cls of classes) {
                const isTrialClass =
                    cls.is_trial === true || cls.demo_class_id !== null;

                if (isTrialClass) {
                    // Include completed or missed trial classes
                    if (cls.is_present === 1 || cls.status === "ended") {
                        trialCount++;
                    }
                } else {
                    // Regular classes → must be completed and attended
                    if (
                        cls.is_trial === 0 &&
                        cls.status === "ended" &&
                        cls.is_present === 1    
                    ) {
                        regularCount++;
                    }
                }
            }

            monthlyData.push({
                month: label,
                regular: regularCount,
                trial: trialCount
            });
        }

        return monthlyData;

    } catch (error) {
        console.error('Error in getClassesBreakdown:', error);
        return [];
    }
}


/**
 * Get performance metrics with correct associations
 */
// async function getPerformanceMetrics(teacherId, dateRange) {
//     try {
//         const currentMonth = {
//             start: moment().startOf('month').toDate(),
//             end: moment().endOf('month').toDate()
//         };

//         const [classes, reviews, trialConversionRate] = await Promise.all([
//             Class.findAll({
//                 where: {
//                     teacher_id: teacherId,
//                     meeting_start: {
//                         [Op.between]: [currentMonth.start, currentMonth.end]
//                     }
//                 }
//             }),
//             UserReview.findAll({
//                 where: {
//                     instructor_id: teacherId,
//                     created_at: {
//                         [Op.between]: [Math.floor(currentMonth.start.getTime() / 1000), Math.floor(currentMonth.end.getTime() / 1000)]
//                     }
//                 }
//             }),
//             calculateTrialConversionRate(teacherId, currentMonth)
//         ]);

//         const completedClasses = classes.filter((c) => c.status === 'ended' || c.status === 'completed');
//         const onTimeClasses = classes.filter((c) => c.is_present && (c.status === 'ended' || c.status === 'completed'));

//         // Calculate retention rate
//         const retentionRate = await calculateRetentionRate(teacherId, currentMonth);

//         return {
//             trialConversionRate,
//             studentRetentionRate: retentionRate,
//             classCompletionRate: classes.length > 0 ? Math.round((completedClasses.length / classes.length) * 100) : 0,
//             onTimePerformance: completedClasses.length > 0 ? Math.round((onTimeClasses.length / completedClasses.length) * 100) : 0
//         };
//     } catch (error) {
//         console.error('Error in getPerformanceMetrics:', error);
//         return {
//             trialConversionRate: 0,
//             studentRetentionRate: 0,
//             classCompletionRate: 0,
//             onTimePerformance: 0
//         };
//     }
// }

async function getPerformanceMetrics(teacherId, dateRange) {
    try {
        const monthStart = dateRange.start;
        const monthEnd = dateRange.end;

        // Fetch all classes for the selected period
        const classes = await Class.findAll({
            where: {
                teacher_id: teacherId,
                meeting_start: { [Op.between]: [monthStart, monthEnd] }
            }
        });

        // Completed = student attended
        const completedClasses = classes.filter(c =>
            c.status === "ended" && c.is_present === true
        );

        // No-shows = student absent
        const noShowClasses = classes.filter(c =>
            c.status === "ended" && c.is_present === false
        );

        // CLASS COMPLETION RATE
        const totalForCompletion = completedClasses.length + noShowClasses.length;
        const classCompletionRate =
            totalForCompletion > 0
                ? Math.round((completedClasses.length / totalForCompletion) * 100)
                : 0;

        // --- RETENTION RATE CALCULATION ---
        const startingActive = await Class.count({
            where: {
                teacher_id: teacherId,
                is_trial: 0,
                meeting_start: { [Op.lt]: monthStart }
            },
            distinct: true,
            col: "student_id"
        });

        const endingActive = await Class.count({
            where: {
                teacher_id: teacherId,
                is_trial: 0,
                meeting_start: { [Op.lte]: monthEnd }
            },
            distinct: true,
            col: "student_id"
        });

        const newStudents = await Class.count({
            where: {
                teacher_id: teacherId,
                is_trial: 0,
                meeting_start: { [Op.between]: [monthStart, monthEnd] }
            },
            distinct: true,
            col: "student_id"
        });

        const retainedStudents = Math.max(endingActive - newStudents, 0);

        const retentionRate =
            startingActive > 0
                ? Math.round((retainedStudents / startingActive) * 100)
                : 0;

        // TRIAL CONVERSION RATE
        const trialConversionRate = await calculateTrialConversionRate(teacherId, { start: monthStart, end: monthEnd });

        return {
            trialConversionRate,
            studentRetentionRate: retentionRate,
            classCompletionRate,
            onTimePerformance: null // removed as requested
        };

    } catch (error) {
        console.error("Error in getPerformanceMetrics:", error);
        return {
            trialConversionRate: 0,
            studentRetentionRate: 0,
            classCompletionRate: 0,
            onTimePerformance: null
        };
    }
}


/**
 * Updated calculateAvgStudentLifetime with correct associations
 */
async function calculateAvgStudentLifetime(teacherId) {
    try {
        const studentClasses = await Class.findAll({
            where: {
                teacher_id: teacherId,
                student_id: { [Op.ne]: null },
                status: { [Op.in]: ['completed', 'pending', 'scheduled'] }
            },
            attributes: ['student_id', 'meeting_start'],
            order: [['meeting_start', 'ASC']]
        });

        if (studentClasses.length === 0) return 0;

        const studentRetentions = new Map();

        studentClasses.forEach((cls) => {
            if (!studentRetentions.has(cls.student_id)) {
                studentRetentions.set(cls.student_id, []);
            }
            studentRetentions.get(cls.student_id).push(new Date(cls.meeting_start));
        });

        let totalRetentionMonths = 0;
        let validStudents = 0;

        for (const [studentId, classDates] of studentRetentions) {
            if (classDates.length === 0) continue;

            const sortedDates = classDates.sort((a, b) => a - b);
            const firstClassDate = sortedDates[0];
            const retentionMonths = moment().diff(moment(firstClassDate), 'months');

            if (retentionMonths >= 0) {
                totalRetentionMonths += retentionMonths;
                validStudents++;
            }
        }

        return validStudents > 0 ? totalRetentionMonths / validStudents : 0;
    } catch (error) {
        console.error('Error calculating avg student lifetime:', error);
        return 0;
    }
}

/**
 * Calculate trial conversion rate with correct logic
 */
// async function calculateTrialConversionRate(teacherId, month) {
//     try {
//         const trialClasses = await Class.count({
//             where: {
//                 teacher_id: teacherId,
//                 is_trial: true,
//                 meeting_start: {
//                     [Op.between]: [month.start, month.end]
//                 }
//             }
//         });

//         if (trialClasses === 0) return 0;

//         // Count conversions using correct associations
//         const conversions = await UserSubscriptionDetails.count({
//             where: {
//                 created_at: {
//                     [Op.between]: [month.start, moment(month.end).add(30, 'days').toDate()]
//                 }
//             },
//             include: [
//                 {
//                     model: User,
//                     as: 'SubscriptionUser', // Correct association name
//                     include: [
//                         {
//                             model: Class,
//                             as: 'StudentClasses', // Correct association name
//                             where: {
//                                 teacher_id: teacherId,
//                                 is_trial: true,
//                                 meeting_start: {
//                                     [Op.between]: [month.start, month.end]
//                                 }
//                             },
//                             required: true
//                         }
//                     ]
//                 }
//             ]
//         });

//         return Math.round((conversions / trialClasses) * 100);
//     } catch (error) {
//         console.error('Error calculating trial conversion rate:', error);
//         return 0;
//     }
// }

async function calculateTrialConversionRate(teacherId, month) {
    try {
        // 1️⃣ Get trials from TrialClassRegistration
        const trials = await TrialClassRegistration.findAll({
            where: {
                teacher_id: teacherId,
                status: { [Op.in]: ["completed", "converted"] },
                meeting_start: { [Op.between]: [month.start, month.end] }
            },
            attributes: ["id", "email"]
        });

        if (trials.length === 0) return 0;

        const trialEmails = trials.map(t => t.email).filter(Boolean);

        // 2️⃣ Get users by email
        const users = await User.findAll({
            where: { email: { [Op.in]: trialEmails } },
            attributes: ["id", "email"]
        });

        const userIds = users.map(u => u.id);
        if (userIds.length === 0) return 0;

        // 3️⃣ All subscriptions within 30 days (NO include)
        const subscriptions = await UserSubscriptionDetails.findAll({
            where: {
                user_id: { [Op.in]: userIds },
                created_at: {
                    [Op.between]: [
                        month.start,
                        moment(month.end).add(30, "days").toDate()
                    ]
                }
            },
            attributes: ["id", "user_id"]
        });

        if (subscriptions.length === 0) return 0;

        const convertedUserIds = subscriptions.map(s => s.user_id);

        // 4️⃣ Check if these users took REGULAR classes with this teacher
        const regularClasses = await Class.findAll({
            where: {
                teacher_id: teacherId,
                is_trial: 0, 
                student_id: { [Op.in]: convertedUserIds },
                meeting_start: { [Op.gte]: month.start }
            },
            attributes: ["id", "student_id"]
        });

        const usersWithRegularClasses = new Set(
            regularClasses.map(c => c.student_id)
        );

        // FINAL COUNT
        const conversionsWithTeacher = subscriptions.filter(s =>
            usersWithRegularClasses.has(s.user_id)
        ).length;

        const conversionRate = Math.round((conversionsWithTeacher / trials.length) * 100);

        return Math.min(conversionRate, 100);

    } catch (error) {
        console.error("Error calculating trial conversion rate:", error);
        return 0;
    }
}




/**
 * Calculate retention rate for a teacher
 * (Active students at end ÷ active students at start, exclude new students)
 */
async function calculateRetentionRate(teacherId, month) {
    try {
        const prevMonth = {
            start: moment(month.start).subtract(1, 'month').startOf('month').toDate(),
            end: moment(month.start).subtract(1, 'month').endOf('month').toDate()
        };

        const prevMonthStudents = await Class.findAll({
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.between]: [prevMonth.start, prevMonth.end]
                }
            },
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('student_id')), 'student_id']],
            raw: true
        });

        if (prevMonthStudents.length === 0) return 0;

        const prevStudentIds = prevMonthStudents.map((s) => s.student_id).filter((id) => id);

        const continuingStudents = await Class.count({
            where: {
                teacher_id: teacherId,
                student_id: { [Op.in]: prevStudentIds },
                meeting_start: {
                    [Op.between]: [month.start, month.end]
                }
            },
            distinct: true,
            col: 'student_id'
        });

        return Math.round((continuingStudents / prevStudentIds.length) * 100);
    } catch (error) {
        console.error('Error calculating retention rate:', error);
        return 0;
    }
}


// Helper functions

function calculateDateRange(period, startDate, endDate) {
    if (period === 'custom' && startDate && endDate) {
        return {
            start: new Date(startDate),
            end: new Date(endDate)
        };
    }

    const end = new Date();
    let start;

    switch (period) {
        case '30days':
            start = moment().subtract(30, 'days').toDate();
            break;
        case '3months':
            start = moment().subtract(3, 'months').toDate();
            break;
        case '6months':
        default:
            start = moment().subtract(6, 'months').toDate();
            break;
        case '1year':
            start = moment().subtract(1, 'year').toDate();
            break;
    }

    return { start, end };
}

function generateMonthlyIntervals(startDate, endDate) {
    const intervals = [];
    const current = moment(startDate).startOf('month');
    const end = moment(endDate);

    while (current.isSameOrBefore(end, 'month')) {
        intervals.push({
            label: current.format('MMM'),
            start: current.clone().startOf('month').toDate(),
            end: current.clone().endOf('month').toDate()
        });
        current.add(1, 'month');
    }

    return intervals;
}

function calculateActualAvailabilityPercentage(teacher) {
    let availabilityPercentage = 0;

    if (teacher.availability) {
        const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        let totalSlots = 0;
        let availableSlots = 0;

        days.forEach((day) => {
            try {
                const dayData = JSON.parse(teacher.availability[day] || '{}');
                const slots = Object.values(dayData);
                totalSlots += slots.length;
                availableSlots += slots.filter((slot) => slot === true).length;
            } catch (e) {
                console.error(`Error parsing availability for ${day}:`, e);
            }
        });

        const baseAvailabilityPercentage = totalSlots > 0 ? (availableSlots / totalSlots) * 100 : 0;

        let holidayImpactPercentage = 0;
        if (teacher.holidays && teacher.holidays.length > 0) {
            const today = new Date();
            const next30Days = new Date();
            next30Days.setDate(today.getDate() + 30);

            let totalHolidayDays = 0;
            teacher.holidays.forEach((holiday) => {
                const startDate = new Date(holiday.startDate);
                const endDate = new Date(holiday.endDate);

                const effectiveStart = startDate > today ? startDate : today;
                const effectiveEnd = endDate < next30Days ? endDate : next30Days;

                if (effectiveStart <= effectiveEnd) {
                    const daysDiff = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
                    totalHolidayDays += daysDiff;
                }
            });

            holidayImpactPercentage = (totalHolidayDays / 30) * 100;
        }

        let classesImpactPercentage = 0;
        if (teacher.upcoming_classes) {
            const upcomingClassesCount = parseInt(teacher.upcoming_classes || 0);
            classesImpactPercentage = Math.min(upcomingClassesCount * 2, baseAvailabilityPercentage);
        }

        availabilityPercentage = Math.max(0, baseAvailabilityPercentage - holidayImpactPercentage - classesImpactPercentage);
    }

    return Math.round(availabilityPercentage);
}

module.exports = {
    getTeachers,
    getTeacherDetails,
    updateTeacher,
    updatePassword,
    inactivateTeacher,
    activateTeacher,
    getTeacherAvailability,
    updateTeacherAvailability,
    getTeacherHolidays,
    createHoliday,
    updateHolidayStatus,
    getTeacherMetrics,
    getTeachersOnHoliday,
    getAbsentLateTeachers,
    getTeacherStudents,
    getTeacherStudentDetails,
    getTopPerformingTeachers,
    getTeacherDashboardAnalytics
};
