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

        // Get teacher reviews and ratings
        const teacherRatings = await UserReview.findAll({
            attributes: [
                'instructor_id',
                [Sequelize.fn('AVG', Sequelize.literal('(instructor_skills + content_quality + support_quality + purchase_worth) / 4')), 'avg_rating'],
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'review_count']
            ],
            where: { status: 'active' },
            group: ['instructor_id']
        });

        // Create ratings map
        const ratingsMap = new Map(teacherRatings.map(rating => [
            rating.instructor_id,
            {
                rating: parseFloat(rating.getDataValue('avg_rating') || 0).toFixed(1),
                reviewCount: parseInt(rating.getDataValue('review_count') || 0)
            }
        ]));

        // Base where clause
        const whereClause = { 
            role_name: 'teacher', 
            status: 'active'
        };

        // Add language filter to where clause if specified and not 'any'
        if (language && language.toLowerCase() !== 'any') {
            whereClause.language = language;
        }

        // Add teacher_ids filter if provided
        if (teacher_ids) {
            // Handle both array and comma-separated string formats
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

        // Fetch all active teachers with availability
        const teachers = await User.findAll({
            where: whereClause,
            attributes: ['id', 'full_name', 'timezone', 'bio', 'avatar', 'language'],
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
                        ]
                    },
                    required: false
                }
            ]
        });
        
        // Log detailed information about teachers found
        // console.log(`Found ${teachers.length} teachers after filtering`);
        // teachers.forEach(teacher => {
        //     console.log(`Teacher ${teacher.id} (${teacher.full_name}):`);
        //     console.log(`  UI Language: ${teacher.language}`);
        //     console.log(`  Has availability data:`, !!teacher.availability);
        //     console.log(`  Has holidays:`, teacher.holidays ? teacher.holidays.length : 0);
        // });

        // Get all existing classes in the selected date range with student information
        const existingClasses = await Class.findAll({
            where: {
                teacher_id: teachers.map(t => t.id),
                meeting_start: { [Op.between]: [utcStartDate.format(), utcEndDate.format()] },
                status: { [Op.notIn]: ['canceled', 'rejected'] }
            },
            include: [{
                model: User,
                as: 'Student',
                attributes: ['full_name']
            }]
        });

        // Generate availability matrix
        const availabilityMatrix = {};
        let currentDate = moment(utcStartDate);

        while (currentDate.isSameOrBefore(utcEndDate)) {
            for (let hour = 0; hour < 24; hour++) {
                for (let minute of [0, 30]) {
                    const slotStartUTC = currentDate.clone().hour(hour).minute(minute);
                    const slotEndUTC = slotStartUTC.clone().add(30, 'minutes');
                    const dateKey = slotStartUTC.format('YYYY-MM-DD');
                    const timeKey = slotStartUTC.format('HH:mm');
                    const dayOfWeek = slotStartUTC.format('ddd').toLowerCase();

                    if (!availabilityMatrix[dateKey]) {
                        availabilityMatrix[dateKey] = {};
                    }

                    // Process each teacher's availability
                    const availableTeachers = teachers.map(teacher => {
                        try {
                            let teacherStatus = {
                                id: teacher.id,
                                name: teacher.full_name,
                                timezone: teacher.timezone,
                                is_available: false,
                                message: '',
                                rating: ratingsMap.get(teacher.id)?.rating || '0.0',
                                reviews: ratingsMap.get(teacher.id)?.reviewCount || 0,
                                // Create a languages array from the language field
                                languages: [teacher.language],  // IMPORTANT: This is the fix
                                imageUrl: teacher.avatar || '/placeholder.svg',
                                initials: teacher.full_name.split(' ').map(n => n[0]).join('')
                            };

                            // Check if teacher has availability
                            if (!teacher.availability || !teacher.availability[dayOfWeek]) {
                                teacherStatus.message = "Teacher is not available on this day";
                                return teacherStatus;
                            }

                            // Safely parse JSON
                            let daySchedule;
                            try {
                                daySchedule = JSON.parse(teacher.availability[dayOfWeek]);
                            } catch (error) {
                                console.error(`Error parsing availability JSON for teacher ${teacher.id} on ${dayOfWeek}:`, error);
                                teacherStatus.message = "Error parsing teacher availability";
                                return teacherStatus;
                            }

                            if (!daySchedule || !daySchedule[timeKey]) {
                                teacherStatus.message = `Teacher is unavailable at ${timeKey}`;
                                return teacherStatus;
                            }

                            // Check if teacher is on holiday
                            if (teacher.holidays && teacher.holidays.some(holiday => {
                                const holidayStart = moment.utc(holiday.form_date);
                                const holidayEnd = moment.utc(holiday.to_date);
                                return (slotStartUTC.isSameOrAfter(holidayStart) && slotStartUTC.isBefore(holidayEnd)) ||
                                    (slotEndUTC.isAfter(holidayStart) && slotEndUTC.isSameOrBefore(holidayEnd)) ||
                                    (slotStartUTC.isSameOrBefore(holidayStart) && slotEndUTC.isSameOrAfter(holidayEnd));
                            })) {
                                teacherStatus.message = "Teacher is on holiday";
                                teacherStatus.is_available = false;
                                return teacherStatus;
                            }

                            // Check for class conflicts
                            const conflictingClass = existingClasses.find(cls => {
                                const classStart = moment.utc(cls.meeting_start);
                                const classEnd = moment.utc(cls.meeting_end);
                                return cls.teacher_id === teacher.id &&
                                    slotStartUTC.isBefore(classEnd) &&
                                    slotEndUTC.isAfter(classStart);
                            });

                            if (conflictingClass) {
                                teacherStatus.message = `Teacher has a class with ${conflictingClass.Student?.full_name || 'a student'}`;
                                return teacherStatus;
                            }

                            // If we reach here, the teacher is available
                            teacherStatus.is_available = true;
                            return teacherStatus;

                        } catch (error) {
                            console.error(`Error processing availability for teacher ${teacher.id}:`, error);
                            return {
                                id: teacher.id,
                                name: teacher.full_name,
                                is_available: false,
                                message: "Error processing availability"
                            };
                        }
                    });

                    // Log detailed debugging for the first time slot of each day
                    // if (hour === 0 && minute === 0) {
                    //     availableTeachers.forEach(t => {
                    //         if (!t.is_available) {
                    //             console.log(`  Teacher ${t.id} (${t.name}) is not available: ${t.message}`);
                    //         } else {
                    //             console.log(`  Teacher ${t.id} (${t.name}) IS AVAILABLE`);
                    //             console.log(`    Will be included in response: YES`);
                    //             console.log(`    Languages: ${t.languages}`);
                    //         }
                    //     });
                    // }

                    // Filter and store only available teachers
                    const actuallyAvailable = availableTeachers.filter(t => t.is_available);
                    
                    // Additional verification that available teachers are included
                    // if (actuallyAvailable.length > 0 && hour === 0 && minute === 0) {
                    //     console.log(`  Time slot ${timeKey} has ${actuallyAvailable.length} available teachers:`, 
                    //         actuallyAvailable.map(t => t.id));
                    // }
                    
                    availabilityMatrix[dateKey][timeKey] = {
                        count: actuallyAvailable.length,
                        teachers: actuallyAvailable || [] // Ensure we never have null
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
                        ]
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
                        slotInfo.message = `Teacher has a class with ${conflictingClass.Student.full_name}`;  // Updated to use correct alias
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