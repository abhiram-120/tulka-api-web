const User = require('../../models/users');
const Class = require('../../models/classes');
const UserOccupation = require('../../models/usersOccupation');
const TeacherHoliday = require('../../models/teacherHoliday');
const UserReview = require('../../models/userReviews');
const moment = require('moment-timezone');
const { Op, Sequelize } = require('sequelize');
const TeacherAvailability = require('../../models/teacherAvailability');


/**
 * Get teacher availability for a date range in UTC
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherAvailability(req, res) {
    try {
        const { start_date, end_date, language, teacher_ids } = req.query;
        
        if (!start_date || !end_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Start date and end date are required'
            });
        }

        // Parse dates in UTC
        const utcStartDate = moment.utc(start_date).startOf('day');
        const utcEndDate = moment.utc(end_date).endOf('day');

        // Build where clause for teachers
        const whereClause = { 
            role_name: 'teacher', 
            status: 'active'
        };

        if (language && language.toLowerCase() !== 'any') {
            whereClause.language = language;
        }

        if (teacher_ids) {
            let teacherIdsArray;
            if (Array.isArray(teacher_ids)) {
                teacherIdsArray = teacher_ids;
            } else if (typeof teacher_ids === 'string') {
                teacherIdsArray = teacher_ids.split(',').map(id => parseInt(id.trim(), 10));
            } else {
                teacherIdsArray = [parseInt(teacher_ids, 10)];
            }
            whereClause.id = { [Op.in]: teacherIdsArray };
        }

        // OPTIMIZATION 1: Batch all database queries using Promise.all
        const [teachers, teacherRatings, existingClasses] = await Promise.all([
            // Get teachers with availability
            User.findAll({
                where: whereClause,
                attributes: ['id', 'full_name', 'timezone', 'bio', 'avatar', 'language'],
                include: [
                    {
                        model: TeacherAvailability,
                        as: 'availability',
                        required: true,
                        attributes: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                    },
                    {
                        model: TeacherHoliday,
                        as: 'holidays',
                        where: {
                            status: 'approved',
                            [Op.and]: [
                                { form_date: { [Op.lte]: utcEndDate.format() } },
                                { to_date: { [Op.gte]: utcStartDate.format() } }
                            ],
                            status:'approved'
                        },
                        required: false,
                        attributes: ['form_date', 'to_date']
                    }
                ]
            }),
            
            // Get teacher ratings
            UserReview.findAll({
                attributes: [
                    'instructor_id',
                    [Sequelize.fn('AVG', Sequelize.literal('(instructor_skills + content_quality + support_quality + purchase_worth) / 4')), 'avg_rating'],
                    [Sequelize.fn('COUNT', Sequelize.col('id')), 'review_count']
                ],
                where: { status: 'active' },
                group: ['instructor_id']
            }),
            
            // Get existing classes
            Class.findAll({
                where: {
                    meeting_start: { [Op.between]: [utcStartDate.format(), utcEndDate.format()] },
                    status: { [Op.notIn]: ['canceled', 'rejected'] }
                },
                attributes: ['teacher_id', 'meeting_start', 'meeting_end'],
                include: [{
                    model: User,
                    as: 'Student',
                    attributes: ['full_name']
                }]
            })
        ]);

        // OPTIMIZATION 2: Pre-compute and cache data structures
        const ratingsMap = new Map(teacherRatings.map(rating => [
            rating.instructor_id,
            {
                rating: parseFloat(rating.getDataValue('avg_rating') || 0).toFixed(1),
                reviewCount: parseInt(rating.getDataValue('review_count') || 0)
            }
        ]));

        // OPTIMIZATION 3: Pre-parse all teacher availability data
        const teacherDataMap = new Map();
        const teacherIdsSet = new Set();
        
        teachers.forEach(teacher => {
            teacherIdsSet.add(teacher.id);
            const parsedAvailability = {};
            const availability = teacher.availability;
            
            if (availability) {
                ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
                    try {
                        parsedAvailability[day] = availability[day] ? JSON.parse(availability[day]) : null;
                    } catch (error) {
                        console.error(`Error parsing availability for teacher ${teacher.id} on ${day}:`, error);
                        parsedAvailability[day] = null;
                    }
                });
            }

            teacherDataMap.set(teacher.id, {
                teacher,
                parsedAvailability,
                holidays: teacher.holidays || [],
                rating: ratingsMap.get(teacher.id) || { rating: '0.0', reviewCount: 0 }
            });
        });

        // OPTIMIZATION 4: Filter existing classes to only relevant teachers upfront
        const relevantClasses = existingClasses.filter(cls => teacherIdsSet.has(cls.teacher_id));
        
        // OPTIMIZATION 5: Group classes by teacher and pre-convert to moment objects
        const classesByTeacher = new Map();
        relevantClasses.forEach(cls => {
            if (!classesByTeacher.has(cls.teacher_id)) {
                classesByTeacher.set(cls.teacher_id, []);
            }
            classesByTeacher.get(cls.teacher_id).push({
                start: moment.utc(cls.meeting_start),
                end: moment.utc(cls.meeting_end),
                studentName: cls.Student?.full_name || 'a student'
            });
        });

        // OPTIMIZATION 6: Pre-convert holidays to moment objects and group by teacher
        teacherDataMap.forEach((data, teacherId) => {
            data.convertedHolidays = data.holidays.map(holiday => ({
                start: moment.utc(holiday.form_date),
                end: moment.utc(holiday.to_date)
            }));
        });

        // OPTIMIZATION 7: Generate availability matrix with reduced iterations
        const availabilityMatrix = {};
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        
        let currentDate = moment(utcStartDate);
        
        while (currentDate.isSameOrBefore(utcEndDate)) {
            const dateKey = currentDate.format('YYYY-MM-DD');
            const dayOfWeekIndex = currentDate.day();
            const dayOfWeek = dayNames[dayOfWeekIndex];
            
            availabilityMatrix[dateKey] = {};
            
            // Generate all time slots for the day
            for (let hour = 0; hour < 24; hour++) {
                for (let minute of [0, 30]) {
                    const slotStartUTC = currentDate.clone().hour(hour).minute(minute);
                    const slotEndUTC = slotStartUTC.clone().add(30, 'minutes');
                    const timeKey = slotStartUTC.format('HH:mm');
                    
                    // OPTIMIZATION 8: Process all teachers for this slot in a single loop
                    const availableTeachers = [];
                    
                    teacherDataMap.forEach((data, teacherId) => {
                        const { teacher, parsedAvailability, convertedHolidays, rating } = data;
                        
                        let teacherStatus = {
                            id: teacher.id,
                            name: teacher.full_name,
                            timezone: teacher.timezone,
                            is_available: false,
                            message: '',
                            rating: rating.rating,
                            reviews: rating.reviewCount,
                            languages: [teacher.language],
                            imageUrl: teacher.avatar || '/placeholder.svg',
                            initials: teacher.full_name.split(' ').map(n => n[0]).join('')
                        };

                        // Check teacher availability for this day/time
                        const daySchedule = parsedAvailability[dayOfWeek];
                        if (!daySchedule || !daySchedule[timeKey]) {
                            teacherStatus.message = daySchedule ? `Teacher is unavailable at ${timeKey}` : "Teacher is not available on this day";
                            return; // Skip to next teacher
                        }

                        // Check holidays
                        const isOnHoliday = convertedHolidays.some(holiday => 
                            slotStartUTC.isBefore(holiday.end) && slotEndUTC.isAfter(holiday.start)
                        );
                        
                        if (isOnHoliday) {
                            teacherStatus.message = "Teacher is on holiday";
                            return; // Skip to next teacher
                        }

                        // Check class conflicts
                        const teacherClasses = classesByTeacher.get(teacherId) || [];
                        const conflictingClass = teacherClasses.find(cls => 
                            slotStartUTC.isBefore(cls.end) && slotEndUTC.isAfter(cls.start)
                        );

                        if (conflictingClass) {
                            teacherStatus.message = `Teacher has a class with ${conflictingClass.studentName}`;
                            return; // Skip to next teacher
                        }

                        // Teacher is available
                        teacherStatus.is_available = true;
                        availableTeachers.push(teacherStatus);
                    });
                    
                    availabilityMatrix[dateKey][timeKey] = {
                        count: availableTeachers.length,
                        teachers: availableTeachers
                    };
                }
            }
            currentDate.add(1, 'day');
        }

        return res.status(200).json({
            status: 'success',
            data: availabilityMatrix
        });

    } catch (error) {
        console.error('Error in getTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Get specific teacher's availability
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherAvailabilityById(req, res) {
    try {
        const { teacherId } = req.params;
        const { start_date, end_date, student_id } = req.query;

        const teacher = await User.findOne({
            where: {
                id: teacherId,
                role_name: 'teacher',
                status: 'active'
            }
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        const student = await User.findByPk(student_id);
        const studentTimezone = student?.timezone || 'Asia/Jerusalem';

        const utcStartDate = moment.tz(start_date, studentTimezone).utc();
        const utcEndDate = moment.tz(end_date, studentTimezone).utc();

        const existingClasses = await Class.findAll({
            where: {
                teacher_id: teacherId,
                meeting_start: {
                    [Op.between]: [utcStartDate, utcEndDate]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            }
        });

        const availability = await calculateTeacherAvailability(
            [teacher],
            existingClasses,
            utcStartDate,
            utcEndDate,
            studentTimezone
        );

        return res.status(200).json({
            status: 'success',
            data: availability[0]
        });

    } catch (error) {
        console.error('Error in getTeacherAvailabilityById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Get filtered teachers based on criteria
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getFilteredTeachers(req, res) {
    try {
        const { languages, rating, availability } = req.query;

        let whereClause = {
            role_name: 'teacher',
            status: 'active'
        };

        // Add language filter if provided
        if (languages) {
            whereClause['$users_occupations.value$'] = {
                [Op.in]: languages.split(',')
            };
        }

        const teachers = await User.findAll({
            where: whereClause,
            include: [{
                model: UserOccupation,
                where: {
                    type: 'language'
                },
                required: false
            }]
        });

        return res.status(200).json({
            status: 'success',
            data: teachers
        });

    } catch (error) {
        console.error('Error in getFilteredTeachers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Get available time slots
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTimeSlotAvailability(req, res) {
    try {
        const { date, teacher_id } = req.query;

        if (!date) {
            return res.status(400).json({
                status: 'error',
                message: 'Date is required'
            });
        }

        // Parse date in UTC
        const utcDate = moment.utc(date);
        const utcStartDate = utcDate.clone().startOf('day');
        const utcEndDate = utcDate.clone().endOf('day');

        // Get teacher with availability
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            include: [
                {
                    model: TeacherAvailability,
                    as: 'availability',
                    required: true
                },
                {
                    model: TeacherHoliday,
                    as: 'holidays',
                    where: {
                        status: 'approved',
                        [Op.and]: [
                            { form_date: { [Op.lte]: utcEndDate.format() } },
                            { to_date: { [Op.gte]: utcStartDate.format() } }
                        ],
                        status:'approved'
                    },
                    required: false
                }
            ]
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or not active'
            });
        }

        // Get existing classes with student information for this teacher and date
        const existingClasses = await Class.findAll({
            where: {
                teacher_id: teacher_id,
                meeting_start: {
                    [Op.between]: [utcStartDate.format(), utcEndDate.format()]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            },
            include: [{
                model: User,
                as: 'Student',  // Using the correct alias from associations.js
                attributes: ['full_name']
            }]
        });

        // Generate time slots
        const timeSlots = [];
        const dayOfWeek = utcDate.format('ddd').toLowerCase();

        // Generate 30-minute slots for the entire day in UTC
        for (let hour = 0; hour < 24; hour++) {
            for (let minute of [0, 30]) {
                const slotStartUTC = utcDate.clone().hour(hour).minute(minute);
                const slotEndUTC = slotStartUTC.clone().add(30, 'minutes');
                const timeKey = slotStartUTC.format('HH:mm');
                let slotInfo = {
                    start: slotStartUTC.format(),  // UTC format
                    end: slotEndUTC.format(),      // UTC format
                    is_available: false,
                    message: ''
                };

                try {
                    // Check teacher's availability for this time slot
                    if (!teacher.availability || !teacher.availability[dayOfWeek]) {
                        slotInfo.message = "Teacher is not available on this day";
                        timeSlots.push(slotInfo);
                        continue;
                    }

                    const daySchedule = JSON.parse(teacher.availability[dayOfWeek]);

                    if (!daySchedule || !daySchedule[timeKey]) {
                        slotInfo.message = `Teacher is unavailable at ${timeKey}`;
                        timeSlots.push(slotInfo);
                        continue;
                    }

                    // Check if teacher is on holiday
                    const holiday = teacher.holidays?.find(holiday => {
                        const holidayStart = moment.utc(holiday.form_date); // Remove startOf('day')
                        const holidayEnd = moment.utc(holiday.to_date);     // Remove endOf('day')
                        return slotStartUTC.isBefore(holidayEnd) && 
                               slotEndUTC.isAfter(holidayStart);
                    });
                    

                    if (holiday) {
                        slotInfo.message = "Teacher is on holiday";
                        timeSlots.push(slotInfo);
                        continue;
                    }

                    // Check for class conflicts
                    const conflictingClass = existingClasses.find(cls => {
                        const classStart = moment.utc(cls.meeting_start);
                        const classEnd = moment.utc(cls.meeting_end);
                        return slotStartUTC.isBefore(classEnd) &&
                            slotEndUTC.isAfter(classStart);
                    });

                    if (conflictingClass) {
                        slotInfo.message = `Teacher has a class with ${conflictingClass.Student?.full_name || 'a student'}`;
                        timeSlots.push(slotInfo);
                        continue;
                    }

                    // If we reach here, the slot is available
                    slotInfo.is_available = true;
                    slotInfo.message = ""; // Clear message for available slots
                    timeSlots.push(slotInfo);

                } catch (error) {
                    console.error(`Error processing availability for time slot:`, error);
                    slotInfo.message = "Error processing availability";
                    timeSlots.push(slotInfo);
                }
            }
        }

        return res.status(200).json({
            status: 'success',
            data: timeSlots
        });

    } catch (error) {
        console.error('Error in getTimeSlotAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Check teacher availability for specific time range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function checkTeacherAvailability(req, res) {
    try {
        const { teacherId } = req.params;
        const { start_time, end_time, student_id } = req.body;

        const teacher = await User.findByPk(teacherId);
        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        const student = await User.findByPk(student_id);
        const studentTimezone = student?.timezone || 'Asia/Jerusalem';
        const teacherTimezone = teacher.timezone || 'Asia/Jerusalem';

        // Convert times to UTC
        const utcStartTime = moment.tz(start_time, studentTimezone).utc();
        const utcEndTime = moment.tz(end_time, studentTimezone).utc();

        // Check for existing classes
        const existingClass = await Class.findOne({
            where: {
                teacher_id: teacherId,
                [Op.or]: [
                    {
                        meeting_start: {
                            [Op.between]: [utcStartTime, utcEndTime]
                        }
                    },
                    {
                        meeting_end: {
                            [Op.between]: [utcStartTime, utcEndTime]
                        }
                    }
                ],
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            }
        });

        // Check if time is within teacher's working hours in their timezone
        const teacherStartTime = moment.tz(start_time, studentTimezone).tz(teacherTimezone);
        const teacherEndTime = moment.tz(end_time, studentTimezone).tz(teacherTimezone);

        const isWithinWorkingHours = teacherStartTime.hour() >= 8 &&
            teacherEndTime.hour() < 20;

        const isAvailable = !existingClass && isWithinWorkingHours;

        return res.status(200).json({
            status: 'success',
            data: {
                is_available: isAvailable,
                teacher_timezone: teacherTimezone,
                working_hours: isWithinWorkingHours
            }
        });

    } catch (error) {
        console.error('Error in checkTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
}

/**
 * Helper function to calculate teacher availability
 */
async function calculateTeacherAvailability(teachers, existingClasses, startDate, endDate, studentTimezone) {
    return teachers.map(teacher => {
        const teacherTimezone = teacher.timezone || 'Asia/Jerusalem';
        const teacherClasses = existingClasses.filter(cls => cls.teacher_id === teacher.id);

        // Generate 30-minute slots
        const slots = [];
        let currentTime = moment(startDate);

        while (currentTime.isBefore(endDate)) {
            const slotStart = currentTime.clone();
            const slotEnd = currentTime.clone().add(30, 'minutes');

            // Convert to teacher's timezone to check working hours
            const teacherTime = slotStart.tz(teacherTimezone);

            if (teacherTime.hour() >= 8 && teacherTime.hour() < 20) {
                const isAvailable = !teacherClasses.some(cls => {
                    const classStart = moment(cls.meeting_start);
                    const classEnd = moment(cls.meeting_end);
                    return slotStart.isBetween(classStart, classEnd, null, '[]') ||
                        slotEnd.isBetween(classStart, classEnd, null, '[]');
                });

                if (isAvailable) {
                    slots.push({
                        start: slotStart.tz(studentTimezone).format(),
                        end: slotEnd.tz(studentTimezone).format()
                    });
                }
            }

            currentTime.add(30, 'minutes');
        }

        return {
            teacher: {
                id: teacher.id,
                name: teacher.full_name,
                timezone: teacherTimezone,
                bio: teacher.bio
            },
            availability: slots
        };
    });
}

/**
 * Helper function to generate time slots
 */
function generateTimeSlots(date, existingClasses, timezone) {
    const slots = [];
    let currentTime = moment(date).startOf('day').add(8, 'hours');
    const endTime = moment(date).startOf('day').add(20, 'hours');

    while (currentTime.isBefore(endTime)) {
        const slotStart = currentTime.clone();
        const slotEnd = currentTime.clone().add(30, 'minutes');

        const isAvailable = !existingClasses.some(cls => {
            const classStart = moment(cls.meeting_start);
            const classEnd = moment(cls.meeting_end);
            return slotStart.isBetween(classStart, classEnd, null, '[]') ||
                slotEnd.isBetween(classStart, classEnd, null, '[]');
        });

        if (isAvailable) {
            slots.push({
                start: slotStart.tz(timezone).format(),
                end: slotEnd.tz(timezone).format()
            });
        }

        currentTime.add(30, 'minutes');
    }

    return slots;
}

module.exports = {
    getTeacherAvailability,
    getTeacherAvailabilityById,
    getFilteredTeachers,
    getTimeSlotAvailability,
    checkTeacherAvailability
};