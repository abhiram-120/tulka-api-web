// controller/teacher/mystudents.controller.js
const moment = require('moment');
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const User = require('../../models/users');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialClassEvaluation = require('../../models/TrialClassEvaluation');
const { getStudentLevel, studentLevels } = require('../../utils/studentLevel');

/**
 * Get all student details for a teacher
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const formatHours = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    
    if (hrs === 0 && mins === 0) {
        return '0 minutes';
    }
    
    if (hrs === 0) {
        return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
    
    if (mins === 0) {
        return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
    }
    
    return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
};
const getMyStudents = async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        // Get pagination params
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit);
        const offset = (page - 1) * limit;  // Calculate offset from page
        
        // Get filter params
        const searchQuery = req.query.search || '';
        const statusFilter = req.query.status || 'all';
        const ageRangeFilter = req.query.ageRange || 'all';
        const riskLevelFilter = req.query.riskLevel || 'all';
        const totalClassesFilter = req.query.totalClasses || 'all';
        const sortBy = req.query.sortBy || 'name'; // Default sort by name
        const sortOrder = req.query.sortOrder || 'asc'; // Default ascending
        
        // Find all students who have had classes with this teacher
        const students = await User.findAll({
            attributes: [
                'id', 'full_name', 'email', 'avatar', 'date_of_birth', 'status',
                'created_at', 'timezone', 'student_level'
            ],
            include: [
                // Get regular class details
                {
                    model: RegularClass,
                    as: 'StudentRegularClasses',
                    required: true,
                    where: {
                        teacher_id: teacherId
                    },
                    attributes: ['id', 'day', 'start_time', 'end_time']
                },
                // Get subscription details - Include all fields needed
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    attributes: [
                        'id', 'type', 'renew_date', 'status', 
                        'left_lessons', 'weekly_lesson', 'created_at',
                        'lesson_min', 'each_lesson',
                        'cost_per_lesson', 'cancellation_date'
                    ],
                    where: {
                        status: 'active'
                    },
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ],
            order: [['full_name', 'ASC']]
        });
        
        // For each student, calculate additional metrics
        const studentsData = await Promise.all(students.map(async (student) => {
            const studentObj = student.toJSON();
            
            // Calculate age from date_of_birth
            let age = null;
            if (studentObj.date_of_birth) {
                const birthDate = moment(studentObj.date_of_birth);
                age = moment().diff(birthDate, 'years');
            }
            
            // Get classes with duration for this student
            const teacherClasses = await Class.findAll({
                attributes: [
                    'id',
                    'meeting_start',
                    'meeting_end',
                    'status',
                    'is_regular_hide',
                    [
                        sequelize.fn('TIMESTAMPDIFF', 
                            sequelize.literal('MINUTE'), 
                            sequelize.col('meeting_start'), 
                            sequelize.col('meeting_end')
                        ),
                        'duration_minutes'
                    ]
                ],
                where: {
                    student_id: student.id,
                    teacher_id: teacherId,
                    status: {
                        [Op.in]: ['ended']
                    }
                },
                order: [['meeting_start', 'DESC']],
                raw: true
            });
            
            // Filter out invalid durations and validate data
            const validClasses = teacherClasses.filter(cls => {
                const duration = parseInt(cls.duration_minutes) || 0;
                // Filter out classes with unrealistic durations (less than 5 mins or more than 180 mins)
                return duration >= 5 && duration <= 180;
            });
            
            // Calculate completed classes
            const completedClasses = validClasses.filter(cls => 
                 cls.status === 'ended' && cls.is_regular_hide == 0
            );
            
            // Calculate total minutes and hours for completed classes
            const teacherTotalMinutes = completedClasses.reduce((sum, cls) => {
                return sum + (parseInt(cls.duration_minutes) || 0);
            }, 0);
            
            // Get level from database using the utility function
            const level = getStudentLevel(studentObj.student_level);
            
            // Get subscription
            const subscription = studentObj.UserSubscriptions && studentObj.UserSubscriptions.length > 0 
                ? studentObj.UserSubscriptions[0] 
                : null;
            
            // Calculate billing cycle dates - INTEGRATED FROM getStudents
            let currentCycleStart = moment().startOf('month');
            let currentCycleEnd = moment().endOf('month');
            
            if (subscription && subscription.renew_date) {
                const renewDate = moment(subscription.renew_date);
                const createdDate = moment(subscription.created_at);
                
                // Determine billing cycle length
                const cycleLengthDays = renewDate.diff(createdDate, 'days');
                
                if (cycleLengthDays > 0) {
                    // Calculate how many cycles have passed
                    const daysSinceCreation = moment().diff(createdDate, 'days');
                    const cyclesPassed = Math.floor(daysSinceCreation / cycleLengthDays);
                    
                    // Calculate current cycle dates
                    currentCycleStart = createdDate.clone().add(cyclesPassed * cycleLengthDays, 'days');
                    currentCycleEnd = currentCycleStart.clone().add(cycleLengthDays, 'days');
                }
            }
            
            // Count COMPLETED lessons in current billing cycle - INTEGRATED FROM getStudents
            const completedLessonsThisCycle = validClasses.filter(cls => {
                const classDate = moment(cls.meeting_start);
                const isInCycle = classDate.isBetween(currentCycleStart, currentCycleEnd, null, '[]');
                const isCompleted = cls.status === 'ended' && cls.is_regular_hide == 0;
                return isInCycle && isCompleted;
            }).length;
            
            // Count ALL classes (booked + completed) in current billing cycle
            const classesThisCycle = validClasses.filter(cls => {
                const classDate = moment(cls.meeting_start);
                return classDate.isBetween(currentCycleStart, currentCycleEnd, null, '[]');
            }).length;
            
            // Get monthly classes
            const currentMonth = moment().format('YYYY-MM');
            const previousMonth = moment().subtract(1, 'month').format('YYYY-MM');
            
            const currentMonthClasses = completedClasses.filter(cls => 
                moment(cls.meeting_start).format('YYYY-MM') === currentMonth
            );
            
            const previousMonthClasses = completedClasses.filter(cls => 
                moment(cls.meeting_start).format('YYYY-MM') === previousMonth
            );
            
            // Calculate hours by month
            const currentMonthMinutes = currentMonthClasses.reduce(
                (sum, cls) => sum + (parseInt(cls.duration_minutes) || 0), 0
            );
            const previousMonthMinutes = previousMonthClasses.reduce(
                (sum, cls) => sum + (parseInt(cls.duration_minutes) || 0), 0
            );
            
            const withYouMinutes = teacherTotalMinutes;
            
            // Get other teachers' hours with validation
            const otherTeachersClassesHours = await Class.findAll({
                attributes: [
                    'id',
                    [sequelize.fn('TIMESTAMPDIFF', 
                        sequelize.literal('MINUTE'), 
                        sequelize.col('meeting_start'), 
                        sequelize.col('meeting_end')
                    ), 'duration_minutes']
                ],
                where: {
                    student_id: student.id,
                    teacher_id: { [Op.ne]: teacherId },
                    status: {
                        [Op.in]: ['ended']
                    }
                },
                raw: true
            });
            
            // Filter and sum other teachers' classes with validation
            const withOthersMinutes = otherTeachersClassesHours
                .filter(cls => {
                    const duration = parseInt(cls.duration_minutes) || 0;
                    return duration >= 5 && duration <= 180;
                })
                .reduce((sum, cls) => sum + (parseInt(cls.duration_minutes) || 0), 0);
            
            // Format hours for display
            const withYouFormatted = formatHours(withYouMinutes);
            const withOthersFormatted = formatHours(withOthersMinutes);
            const totalFormatted = formatHours(withYouMinutes + withOthersMinutes);
            
            // Get last class date
            const lastClass = await Class.findOne({
                attributes: ['meeting_end'],
                where: {
                    student_id: student.id,
                    teacher_id: teacherId,
                    status: {
                        [Op.in]: ['ended']
                    }
                },
                order: [['meeting_end', 'DESC']],
                limit: 1
            });
            
            // Get next class date
            const nextClass = await Class.findOne({
                attributes: ['meeting_start', 'meeting_end'],
                where: {
                    student_id: student.id,
                    teacher_id: teacherId,
                    meeting_start: {
                        [Op.gt]: new Date()
                    },
                    status: {
                        [Op.in]: ['scheduled', 'confirmed', 'pending']
                    }
                },
                order: [['meeting_start', 'ASC']],
                limit: 1
            });
            
            // Calculate days since last class
            let lastClassDays = null;
            if (lastClass) {
                const lastClassDate = moment(lastClass.meeting_end);
                lastClassDays = moment().diff(lastClassDate, 'days');
            }
            
            // Format regular class schedule
            let regularClasses = null;
            if (studentObj.StudentRegularClasses && studentObj.StudentRegularClasses.length > 0) {
                const daysArray = studentObj.StudentRegularClasses.map(cls => cls.day);
                const uniqueDays = [...new Set(daysArray)];
                const sampleClass = studentObj.StudentRegularClasses[0];
                const startTime = moment(sampleClass.start_time, 'HH:mm:ss');
                const endTime = moment(sampleClass.end_time, 'HH:mm:ss');
                const duration = endTime.diff(startTime, 'minutes');
                
                regularClasses = {
                    days: uniqueDays.join(', '),
                    duration: `${duration} mins`
                };
            }
            
            // Format subscription details - INTEGRATED LOGIC FROM getStudents
            let subscriptionDetails = null;
            if (subscription) {
                // Parse subscription type and extract duration if embedded
                let subscriptionTypeName = subscription.type || 'Unknown';
                let lessonMinutes = subscription.lesson_min || 25; // Default to 25 if not set
                
                // Check if type contains duration (e.g., "Monthly_25", "Monthly_55")
                const typeMatch = subscriptionTypeName.match(/^(.+?)_(\d+)$/);
                if (typeMatch) {
                    // Extract base type and duration from type string
                    subscriptionTypeName = typeMatch[1]; // e.g., "Monthly"
                    lessonMinutes = parseInt(typeMatch[2]); // e.g., 25
                }
                
                // Capitalize first letter of type
                subscriptionTypeName = subscriptionTypeName.charAt(0).toUpperCase() + subscriptionTypeName.slice(1).toLowerCase();
                
                // Format subscription type display
                let subscriptionType = 'Unknown';
                
                if (subscription.type === 'unlimited') {
                    subscriptionType = `Unlimited_${lessonMinutes}`;
                } else if (subscriptionTypeName === 'Paid') {
                    // For "paid" type, show differently
                    subscriptionType = `Paid Plan_${lessonMinutes}`;
                } else {
                    // For Monthly, Quarterly, Yearly, etc.
                    subscriptionType = `${subscriptionTypeName}_${lessonMinutes}`;
                }
                
                // Calculate remaining classes - MATCHING getStudents logic
                const totalAllowed = subscription.type === 'unlimited' 
                    ? 999 // Use high number for unlimited
                    : (subscription.weekly_lesson || subscription.left_lessons || 0);
                
                // Use completed lessons count from current cycle
                const remainingClasses = subscription.type === 'unlimited'
                    ? 'Unlimited'
                    : Math.max(0, totalAllowed - completedLessonsThisCycle);
                
                subscriptionDetails = {
                    type: subscriptionType,
                    usedThisCycle: completedLessonsThisCycle, // Only completed lessons
                    bookedThisCycle: classesThisCycle, // All booked lessons
                    totalAllowed: subscription.type === 'unlimited' ? 'Unlimited' : totalAllowed,
                    remainingClasses,
                    isUnlimited: subscription.type === 'unlimited',
                    // Additional details from getStudents
                    weeklyLesson: subscription.weekly_lesson,
                    eachLesson: subscription.each_lesson,
                    leftLessons: subscription.left_lessons,
                    lessonMin: lessonMinutes, // Use parsed or actual lesson_min
                    costPerLesson: subscription.cost_per_lesson
                };
            }
            
            // Calculate subscription renewal
            let subscriptionProgress = null;
            let renewalDate = null;
            let daysUntilRenewal = null;
            
            if (subscription && subscription.renew_date) {
                const startDate = moment(subscription.created_at);
                const endDate = moment(subscription.renew_date);
                const totalDays = endDate.diff(startDate, 'days');
                const daysElapsed = moment().diff(startDate, 'days');
                subscriptionProgress = totalDays > 0 ? Math.round((daysElapsed / totalDays) * 100) : 0;
                renewalDate = moment(subscription.renew_date).format('YYYY-MM-DD');
                daysUntilRenewal = moment(subscription.renew_date).diff(moment(), 'days');
            }
            
            return {
                id: studentObj.id,
                name: studentObj.full_name,
                avatar: studentObj.avatar,
                age: age,
                email: studentObj.email,
                level,
                status: studentObj.status || 'active',
                totalClasses: completedClasses.length,
                learningHours: {
                    withYou: withYouFormatted,
                    withOthers: withOthersFormatted,
                    total: totalFormatted,
                    byMonth: {
                        currentMonth: formatHours(currentMonthMinutes),
                        previousMonth: formatHours(previousMonthMinutes)
                    },
                    classCount: {
                        currentMonth: currentMonthClasses.length,
                        previousMonth: previousMonthClasses.length
                    }
                },
                lastClassDays,
                lastClassDate: lastClass ? moment(lastClass.meeting_end).format('YYYY-MM-DD') : null,
                nextClassDate: nextClass ? moment(nextClass.meeting_start).format('YYYY-MM-DD') : null,
                subscriptionStatus: subscription ? subscription.status : null,
                subscriptionRenewal: renewalDate,
                subscriptionDetails,
                daysUntilRenewal,
                subscriptionProgress,
                regularClasses,
                _sortValues: {
                    name: studentObj.full_name.toLowerCase(),
                    level: level,
                    totalClasses: completedClasses.length,
                    learningHours: withYouMinutes + withOthersMinutes, // Keep as minutes for sorting
                    lastClassDays: lastClassDays || 9999,
                    renewalDate: renewalDate ? moment(renewalDate).valueOf() : 0,
                    subscriptionUsage: completedLessonsThisCycle
                }
            };
        }));
        
        // Apply filters
        let filteredStudents = studentsData;
        
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            filteredStudents = filteredStudents.filter(student => 
                student.name.toLowerCase().includes(searchLower) ||
                (student.age && student.age.toString().includes(searchLower)) ||
                student.learningHours.total.includes(searchLower) // Search formatted hours string
            );
        }
        
        if (statusFilter !== 'all') {
            filteredStudents = filteredStudents.filter(student => student.status === statusFilter);
        }
        
        if (ageRangeFilter !== 'all') {
            if (ageRangeFilter === 'under25') {
                filteredStudents = filteredStudents.filter(student => student.age && student.age < 25);
            } else if (ageRangeFilter === '25to35') {
                filteredStudents = filteredStudents.filter(student => student.age && student.age >= 25 && student.age <= 35);
            } else if (ageRangeFilter === 'over35') {
                filteredStudents = filteredStudents.filter(student => student.age && student.age > 35);
            }
        }
        
        if (riskLevelFilter !== 'all') {
            if (riskLevelFilter === 'atRisk') {
                filteredStudents = filteredStudents.filter(student => student.lastClassDays > 7);
            } else if (riskLevelFilter === 'stable') {
                filteredStudents = filteredStudents.filter(student => student.lastClassDays !== null && student.lastClassDays <= 7);
            }
        }
        
        if (totalClassesFilter !== 'all') {
            if (totalClassesFilter === 'under20') {
                filteredStudents = filteredStudents.filter(student => student.totalClasses < 20);
            } else if (totalClassesFilter === '20to50') {
                filteredStudents = filteredStudents.filter(student => student.totalClasses >= 20 && student.totalClasses <= 50);
            } else if (totalClassesFilter === 'over50') {
                filteredStudents = filteredStudents.filter(student => student.totalClasses > 50);
            }
        }
        
        // Apply sorting
        if (sortBy && filteredStudents.length > 0) {
            filteredStudents.sort((a, b) => {
                let aValue, bValue;
                
                switch (sortBy) {
                    case 'name':
                        aValue = a._sortValues.name;
                        bValue = b._sortValues.name;
                        break;
                    case 'level':
                        aValue = a._sortValues.level;
                        bValue = b._sortValues.level;
                        break;
                    case 'totalClasses':
                        aValue = a._sortValues.totalClasses;
                        bValue = b._sortValues.totalClasses;
                        break;
                    case 'learningHours':
                        aValue = a._sortValues.learningHours;
                        bValue = b._sortValues.learningHours;
                        break;
                    case 'lastClass':
                        aValue = a._sortValues.lastClassDays;
                        bValue = b._sortValues.lastClassDays;
                        break;
                    case 'renewalDate':
                        aValue = a._sortValues.renewalDate;
                        bValue = b._sortValues.renewalDate;
                        break;
                    case 'subscriptionUsage':
                        aValue = a._sortValues.subscriptionUsage;
                        bValue = b._sortValues.subscriptionUsage;
                        break;
                    default:
                        aValue = a._sortValues.name;
                        bValue = b._sortValues.name;
                }
                
                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;
                
                if (sortOrder === 'asc') {
                    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
                } else {
                    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
                }
            });
        }
        
        // CALCULATE PAGINATION based on FILTERED data
        const totalFilteredStudents = filteredStudents.length;
        const totalPages = Math.ceil(totalFilteredStudents / limit);
        
        // APPLY PAGINATION using offset and limit
        const paginatedStudents = filteredStudents.slice(offset, offset + limit);
        
        // Remove sort values from response
        const finalStudents = paginatedStudents.map(student => {
            const { _sortValues, ...studentData } = student;
            return studentData;
        });
        

        const todayStart = moment().startOf('day');
        const todayEnd = moment().endOf('day');

        // Get all classes TODAY for this teacher
        const todayClasses = await Class.findAll({
            attributes: ['id', 'student_id', 'meeting_start', 'status'],
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.gte]: todayStart.toDate(),
                    [Op.lte]: todayEnd.toDate()
                },
                status: 'ended'
            },
            raw: true
        });

        // Count unique students TODAY
        const uniqueStudentsToday = new Set(todayClasses.map(cls => cls.student_id)).size;
        const totalClassesToday = todayClasses.length;
        const last7DaysStart = moment().subtract(7, 'days').startOf('day');
        const last7DaysEnd = moment().subtract(1, 'day').endOf('day'); // Exclude today

        // Get all classes in last 7 days (excluding today)
        const last7DaysClasses = await Class.findAll({
            attributes: ['id', 'student_id', 'meeting_start', 'status'],
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.gte]: last7DaysStart.toDate(),
                    [Op.lte]: last7DaysEnd.toDate()
                },
                status: 'ended'
            },
            raw: true
        });

        // Group classes by day for last 7 days
        const classesByDay = {};
        last7DaysClasses.forEach((cls) => {
            const day = moment(cls.meeting_start).format('YYYY-MM-DD');
            if (!classesByDay[day]) classesByDay[day] = [];
            classesByDay[day].push(cls);
        });

        // Calculate average classes per day (last 7 days)
        const totalClassesLast7Days = last7DaysClasses.length;
        const workingDaysLast7Days = Object.keys(classesByDay).length;
        const averageClassesLast7Days = workingDaysLast7Days > 0 
            ? parseFloat((totalClassesLast7Days / workingDaysLast7Days).toFixed(1))
            : 0;

        const studentsByDay = {};
        last7DaysClasses.forEach((cls) => {
            const day = moment(cls.meeting_start).format('YYYY-MM-DD');
            if (!studentsByDay[day]) studentsByDay[day] = new Set();
            studentsByDay[day].add(cls.student_id);
        });
        const uniqueCounts = Object.values(studentsByDay).map((set) => set.size);
        const averageUniqueStudentsLast7Days = uniqueCounts.length > 0 
            ? parseFloat((uniqueCounts.reduce((sum, count) => sum + count, 0) / uniqueCounts.length).toFixed(1))
            : 0;
        const classesPerDayChange = parseFloat((totalClassesToday - averageClassesLast7Days).toFixed(1));
        const uniqueStudentsPerDayChange = parseFloat((uniqueStudentsToday - averageUniqueStudentsLast7Days).toFixed(1));

        // Calculate total learning hours for metrics
        const totalLearningMinutes = studentsData.reduce(
            (sum, student) => sum + student._sortValues.learningHours, 0
        );
        
        // Calculate current month total minutes
        const currentMonthTotalMinutes = studentsData.reduce((sum, student) => {
            // Extract minutes from formatted string or calculate from student data
            const currentMonthStr = student.learningHours.byMonth.currentMonth;
            const [hours, mins] = currentMonthStr.split(':').map(part => parseInt(part.replace(' h', '')));
            return sum + (hours * 60 + mins);
        }, 0);

        // Generate metrics
        const metrics = {
            totalStudents: studentsData.length,
            activeStudents: studentsData.filter(s => s.status === 'active').length,
            atRiskStudents: studentsData.filter(s => s.lastClassDays !== null && s.lastClassDays > 7).length,
            newStudentsThisMonth: studentsData.filter(s => {
                const createdTimestamp = s.created_at;
                const createdDate = moment.unix(createdTimestamp);
                const startOfMonth = moment().startOf('month');
                return createdDate.isAfter(startOfMonth);
            }).length,
            totalLearningHours: formatHours(totalLearningMinutes),
            currentMonthHours: formatHours(currentMonthTotalMinutes),
            averageClassesPerDay: totalClassesToday, 
            averageClassesPerDayChange: classesPerDayChange, 
            uniqueStudentsPerDay: uniqueStudentsToday,  
            uniqueStudentsPerDayChange: uniqueStudentsPerDayChange,  
            averageClassesLast7Days: averageClassesLast7Days, 
            averageUniqueStudentsLast7Days: averageUniqueStudentsLast7Days 
        };
        
        return res.status(200).json({
            status: 'success',
            data: {
                students: finalStudents,
                metrics,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalStudents: totalFilteredStudents, // Total after filters
                    studentsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Error in getMyStudents:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};
/**
 * Get detailed information about a specific student
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentDetails = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const studentId = req.params.id;
        
        if (!studentId) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID is required'
            });
        }
        
        // Get student basic information
        const student = await User.findOne({
            where: {
                id: studentId
            },
            attributes: [
                'id', 'full_name', 'email', 'avatar', 'date_of_birth', 
                'status', 'bio', 'created_at', 'timezone', 'student_level'
            ],
            include: [
                // Get regular class details
                {
                    model: RegularClass,
                    as: 'StudentRegularClasses',
                    required: false,
                    where: {
                        teacher_id: teacherId
                    },
                    attributes: ['id', 'day', 'start_time', 'end_time']
                },
                // Get subscription details
                {
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    required: false,
                    attributes: [
                        'id', 'type', 'renew_date', 'status', 
                        'left_lessons', 'weekly_lesson', 'created_at'
                    ],
                    where: {
                        status: 'active'
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
        
        const studentObj = student.toJSON();
        
        // Calculate age from date_of_birth
        let age = null;
        if (studentObj.date_of_birth) {
            const birthDate = moment(studentObj.date_of_birth);
            age = moment().diff(birthDate, 'years');
        }
        
        // Get class history
        const classHistory = await Class.findAll({
            attributes: [
                'id',
                'meeting_start',
                'meeting_end',
                'student_goal',
                'feedback_id',
                [
                    sequelize.fn('TIMESTAMPDIFF', 
                        sequelize.literal('MINUTE'), 
                        sequelize.col('meeting_start'), 
                        sequelize.col('meeting_end')
                    ),
                    'duration_minutes'
                ]
            ],
            where: {
                student_id: studentId,
                teacher_id: teacherId,
                status: 'ended'
            },
            order: [['meeting_start', 'DESC']],
            limit: 20,
            raw: true
        });
        
        // Get total classes count
        const totalClasses = classHistory.length;
        
        // Format class history with detailed duration
        const formattedClassHistory = classHistory.map(cls => {
            const startTime = moment(cls.meeting_start);
            const endTime = moment(cls.meeting_end);
            const durationMinutes = parseInt(cls.duration_minutes) || 0;
            
            return {
                id: cls.id,
                date: startTime,
                day: startTime.format('dddd'),
                startTime: startTime.format('HH:mm'),
                endTime: endTime.format('HH:mm'),
                duration: durationMinutes,
                durationFormatted: formatHours(durationMinutes), 
                goal: cls.student_goal || '',
                feedback: cls.feedback_id ? true : false
            };
        });
        
        // Calculate total learning hours from class history
        const totalMinutes = formattedClassHistory.reduce((sum, cls) => sum + cls.duration, 0);
        const totalLearningHours = formatHours(totalMinutes); 
        
        // Get last class date
        const lastClass = formattedClassHistory.length > 0 ? formattedClassHistory[0] : null;
        
        // Get next class date
        const nextClass = await Class.findOne({
            attributes: ['meeting_start', 'meeting_end'],
            where: {
                student_id: studentId,
                teacher_id: teacherId,
                meeting_start: {
                    [Op.gt]: new Date()
                },
                is_regular_hide:0,
                status: ['pending']
            },
            order: [['meeting_start', 'ASC']],
            limit: 1
        });
        
        // Get trial classes if any
        const trialClasses = await TrialClassRegistration.findAll({
            where: {
                email: studentObj.email,
                teacher_id: teacherId
            },
            include: [
                {
                    model: TrialClassEvaluation,
                    as: 'evaluation',
                    required: false
                }
            ],
            order: [['meeting_start', 'DESC']]
        });
        
        // Format trial classes
        const formattedTrialClasses = trialClasses.map(trial => {
            const startTime = moment(trial.meeting_start);
            const endTime = moment(trial.meeting_end);
            
            return {
                id: trial.id,
                date: startTime.format('YYYY-MM-DD'),
                startTime: startTime.format('HH:mm'),
                endTime: endTime.format('HH:mm'),
                status: trial.status,
                level: trial.evaluation ? trial.evaluation.student_level : null,
                notes: trial.evaluation ? trial.evaluation.description : null
            };
        });
        
        // Get level from database using the utility function
        const level = getStudentLevel(studentObj.student_level);
        
        // Format regular class schedule
        let regularClasses = null;
        if (studentObj.StudentRegularClasses && studentObj.StudentRegularClasses.length > 0) {
            const daysArray = studentObj.StudentRegularClasses.map(cls => cls.day);
            const uniqueDays = [...new Set(daysArray)];
            
            // Get sample class to determine duration
            const sampleClass = studentObj.StudentRegularClasses[0];
            const startTime = moment(sampleClass.start_time, 'HH:mm:ss');
            const endTime = moment(sampleClass.end_time, 'HH:mm:ss');
            const duration = endTime.diff(startTime, 'minutes');
            
            regularClasses = {
                days: uniqueDays.join(', '),
                duration: `${duration} mins`
            };
        }
        
        // Format subscription details
        const subscription = studentObj.UserSubscriptions && studentObj.UserSubscriptions.length > 0 
            ? studentObj.UserSubscriptions[0] 
            : null;
        
        // Calculate subscription progress if available
        let subscriptionProgress = null;
        if (subscription && subscription.renew_date) {
            const startDate = moment(subscription.created_at);
            const endDate = moment(subscription.renew_date);
            const totalDays = endDate.diff(startDate, 'days');
            const daysElapsed = moment().diff(startDate, 'days');
            subscriptionProgress = totalDays > 0 ? Math.round((daysElapsed / totalDays) * 100) : 0;
        }
        
        // Generate progress metrics
        const startOfPreviousMonth = moment().subtract(1, 'month').startOf('month');
        const endOfPreviousMonth = moment().subtract(1, 'month').endOf('month');
        const startOfCurrentMonth = moment().startOf('month');
        
        // Calculate monthly learning hours
        const currentMonthClasses = formattedClassHistory.filter(cls => 
            moment(cls.date).isSameOrAfter(startOfCurrentMonth)
        );
        
        const previousMonthClasses = formattedClassHistory.filter(cls => {
            const classDate = moment(cls.date);
            return classDate.isSameOrAfter(startOfPreviousMonth) && classDate.isSameOrBefore(endOfPreviousMonth);
        });
        
        const currentMonthMinutes = currentMonthClasses.reduce((sum, cls) => sum + cls.duration, 0);
        const previousMonthMinutes = previousMonthClasses.reduce((sum, cls) => sum + cls.duration, 0);
        
        const currentMonthHours = formatHours(currentMonthMinutes); 
        const previousMonthHours = formatHours(previousMonthMinutes); 
        
        // Calculate growth percentage for hours
        let growthPercentage = null;
        if (previousMonthMinutes > 0) {
            growthPercentage = Math.round(((currentMonthMinutes - previousMonthMinutes) / previousMonthMinutes) * 100);
        }
        
        // Calculate growth percentage for classes
        let classCountGrowthPercentage = null;
        if (previousMonthClasses.length > 0) {
            classCountGrowthPercentage = Math.round(
                ((currentMonthClasses.length - previousMonthClasses.length) / previousMonthClasses.length) * 100
            );
        }
        
        const progressMetrics = {
            currentMonthClasses: currentMonthClasses.length,
            previousMonthClasses: previousMonthClasses.length,
            currentMonthHours: currentMonthHours,
            previousMonthHours: previousMonthHours,
            growthPercentage,
            classCountGrowthPercentage,
            hoursByClass: formattedClassHistory.map(cls => ({
                id: cls.id,
                date: cls.date,
                hours: cls.durationFormatted 
            }))
        };
        
        const studentDetails = {
            id: studentObj.id,
            name: studentObj.full_name,
            avatar: studentObj.avatar,
            age: age, 
            email: studentObj.email,
            level,
            status: studentObj.status || 'active',
            totalClasses,
            totalLearningHours: totalLearningHours,
            learningHours: totalLearningHours, // Keep for backward compatibility
            learningHoursByMonth: {
                currentMonth: currentMonthHours,
                previousMonth: previousMonthHours
            },
            lastClassDate: lastClass ? lastClass.date : null,
            nextClassDate: nextClass ? moment(nextClass.meeting_start) : null,
            subscriptionStatus: subscription ? subscription.status : null,
            subscriptionRenewal: subscription ? moment(subscription.renew_date).format('YYYY-MM-DD') : null,
            subscriptionProgress,
            regularClasses,
            classHistory: formattedClassHistory,
            trialClasses: formattedTrialClasses,
            progressMetrics
        };
        
        return res.status(200).json({
            status: 'success',
            data: studentDetails
        });
    } catch (error) {
        console.error('Error in getStudentDetails:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};


/**
 * Update student level
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateStudentLevel = async (req, res) => {
    try {
        const teacherId = req.userId;
        const studentId = req.params.id;
        const { level_id } = req.body;

        // Validate level_id - allow null to clear assignment
        if (level_id !== null && level_id !== undefined) {
            if (level_id < 1 || level_id > 15) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid level_id. Must be between 1 and 15, or null to clear'
                });
            }
        }

        // Check if student exists and belongs to this teacher
        const student = await User.findOne({
            where: { id: studentId },
            include: [
                {
                    model: RegularClass,
                    as: 'StudentRegularClasses',
                    required: true,
                    where: {
                        teacher_id: teacherId
                    },
                    attributes: ['id']
                }
            ]
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found or does not belong to this teacher'
            });
        }

        // Update the student level
        await User.update(
            { student_level: level_id },
            { where: { id: studentId } }
        );

        // Get the level name using the utility function (handle null case)
        const levelName = level_id !== null ? getStudentLevel(level_id) : null;

        return res.status(200).json({
            status: 'success',
            message: level_id !== null 
                ? 'Student level updated successfully' 
                : 'Student level cleared successfully',
            data: {
                studentId: studentId,
                level: levelName,
                levelId: level_id
            }
        });
    } catch (error) {
        console.error('Error in updateStudentLevel:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all available student levels
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getStudentLevels = async (req, res) => {
    try {
        // Convert the levels object to array format
        const levelsArray = Object.entries(studentLevels).map(([id, label]) => ({
            id: parseInt(id),
            label: label
        }));

        // Sort by id
        levelsArray.sort((a, b) => a.id - b.id);

        return res.status(200).json({
            status: 'success',
            message: 'Student levels retrieved successfully',
            data: levelsArray
        });
    } catch (error) {
        console.error('Error in getStudentLevels:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getMyStudents,
    getStudentDetails,
    updateStudentLevel,
    getStudentLevels
};