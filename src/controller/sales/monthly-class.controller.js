// controller/sales/monthly-class.controller.js
const Salesperson = require('../../models/Salesperson');
const User = require('../../models/users');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const TeacherAvailability = require('../../models/teacherAvailability');
const TeacherHoliday = require('../../models/teacherHoliday');
const UserReview = require('../../models/userReviews');
const { Op, Sequelize } = require('sequelize');
const { whatsappReminderAddClass } = require('../../cronjobs/reminder');
const moment = require('moment');
const { sequelize } = require('../../connection/connection');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const momentTz = require('moment-timezone');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');

const cleanEmail = (email) => {
    if (!email) return '';
    const emailParts = email.split('@');
    if (emailParts.length === 2) {
        const localPart = emailParts[0].split('+')[0];
        return `${localPart}@${emailParts[1]}`;
    }
    return email;
};
/**
 * Create multiple monthly classes at once
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createMonthlyClasses = async (req, res) => {
    let transaction;
    
    try {
        const {
            student_id,
            teacher_id,
            time_slots,  // Array of { day: string, time: string }
            student_goal,
            subscription_id
        } = req.body;

        if (!student_id || !teacher_id || !time_slots || !time_slots.length || !subscription_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if teacher exists and is active
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            transaction
        });

        if (!teacher) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Check student's subscription and available classes
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: student_id,
                id: subscription_id,
                status: 'active'
            },
            transaction
        });

        if (!subscription) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Active subscription not found'
            });
        }

        // Calculate total classes needed (4 classes per time slot)
        const totalClassesNeeded = time_slots.length * 4;

        // Check if student has enough available classes
        if (subscription.left_lessons < totalClassesNeeded) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Not enough classes remaining in subscription. Available: ${subscription.left_lessons}, Requested: ${totalClassesNeeded}`
            });
        }

        // Get student data for response
        const student = await User.findByPk(student_id, {
            attributes: ['id', 'full_name', 'email', 'timezone'],
            transaction
        });

        // Create an array to store created classes
        const createdClasses = [];
        const bookedTimeSlots = [];

        // Generate a batch ID for this monthly booking set
        const batchId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Calculate the class duration from subscription
        const classDuration = parseInt(subscription.lesson_min) || 60; // default to 60 min if not specified

        // Generate a 4-week schedule for each time slot
        for (const slot of time_slots) {
            // Get day name and time
            const { day, time } = slot;
            
            // Calculate next 4 occurrences of this day+time
            const nextOccurrences = getNextOccurrences(day, time, 4);
            
            for (const occurrence of nextOccurrences) {
                const startTime = moment.utc(occurrence);
                const endTime = moment.utc(occurrence).add(classDuration, 'minutes');
                
                // Check for conflicts for this specific time
                const conflictingClass = await Class.findOne({
                    where: {
                        teacher_id,
                        [Op.or]: [
                            {
                                meeting_start: {
                                    [Op.between]: [startTime.format(), endTime.format()]
                                }
                            },
                            {
                                meeting_end: {
                                    [Op.between]: [startTime.format(), endTime.format()]
                                }
                            }
                        ],
                        status: {
                            [Op.notIn]: ['canceled', 'rejected']
                        }
                    },
                    transaction
                });

                if (conflictingClass) {
                    // Skip this occurrence if there's a conflict
                    continue;
                }

                // Create class entry
                const classEntry = await Class.create({
                    student_id,
                    teacher_id,
                    status: 'pending',
                    meeting_start: startTime.format(),
                    meeting_end: endTime.format(),
                    is_trial: false,
                    student_goal,
                    subscription_id,
                    class_type: 'website',
                    next_month_class_term: false,
                    bonus_class: false,
                    join_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
                    admin_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
                    batch_id: batchId,
                    booked_by: req.user.role_name,
                    booked_by_admin_id: req.user.id
                }, { transaction });

                createdClasses.push(classEntry);
                bookedTimeSlots.push({
                    day,
                    time,
                    meeting_start: startTime.format(),
                    meeting_end: endTime.format()
                });
            }
        }

        // Verify that all required classes were created
        if (createdClasses.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Could not book any classes. All requested slots have scheduling conflicts.'
            });
        }

        // Check if we were able to book all 4 weeks for each slot
        const totalSlotsRequested = time_slots.length;
        const classesPerSlot = 4;
        const expectedClasses = totalSlotsRequested * classesPerSlot;
        
        if (createdClasses.length < expectedClasses) {
            // Some classes weren't created due to conflicts
            if (transaction) await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: `Could not book all required classes. Expected ${expectedClasses}, but only ${createdClasses.length} were available due to scheduling conflicts.`
            });
        }

        // Update subscription remaining classes
        await subscription.update({
            left_lessons: subscription.left_lessons - createdClasses.length
        }, { transaction });

        // Create salesperson activity if booked by sales
        if (req.user.role_name.includes('sales')) {
            for (const classEntry of createdClasses) {
                await Salesperson.create({
                    user_id: req.user.id,
                    role_type: req.user.role_type || 'sales_role',
                    action_type: 'regular_class',
                    student_id,
                    class_id: classEntry.id,
                    subscription_id,
                    meeting_type: 'online',
                    appointment_time: moment.utc(classEntry.meeting_start).format(),
                    appointment_duration: classDuration,
                    success_status: 'successful'
                }, { transaction });
            }
        }

        // Commit transaction
        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            message: `Successfully booked ${createdClasses.length} classes`,
            data: {
                teacher: {
                    id: teacher.id,
                    name: teacher.full_name
                },
                student: {
                    id: student.id,
                    name: student.full_name
                },
                subscription: {
                    id: subscription.id,
                    type: subscription.type,
                    remaining_classes: subscription.left_lessons
                },
                booked_slots: bookedTimeSlots,
                classes: createdClasses.map(cls => ({
                    id: cls.id,
                    meeting_start: moment.utc(cls.meeting_start).format(),
                    meeting_end: moment.utc(cls.meeting_end).format()
                }))
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error in createMonthlyClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get available teachers based on time slot
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAvailableTeachers = async (req, res) => {
    try {
        const { day, time, languages, occupancy_rate } = req.query;

        if (!day || !time) {
            return res.status(400).json({
                status: 'error',
                message: 'Day and time are required parameters'
            });
        }

        // Parse maximum occupancy rate (default to 100%)
        const maxOccupancyRate = occupancy_rate ? parseInt(occupancy_rate) : 100;

        // Get all active teachers with their availability
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'bio']
        });

        // Fetch teacher availability separately
        const teacherAvailabilities = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teachers.map(t => t.id)
                }
            }
        });

        // Create a map of teacher IDs to their availability
        const availabilityMap = new Map();
        teacherAvailabilities.forEach(availability => {
            availabilityMap.set(availability.user_id, availability);
        });

        // Calculate the next occurrence of the specified day and time
        const nextOccurrence = getNextDayTime(day, time);
        const startTime = moment.utc(nextOccurrence);
        const endTime = moment.utc(nextOccurrence).add(60, 'minutes'); // Assuming 60-minute classes

        // Find all existing classes in this time slot
        const existingClasses = await Class.findAll({
            where: {
                meeting_start: {
                    [Op.between]: [startTime.format(), endTime.format()]
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            },
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id']
                }
            ]
        });

        // Create a set of teacher IDs who already have classes in this time slot
        const busyTeacherIds = new Set(existingClasses.map(cls => cls.Teacher.id));

        // Filter teachers based on availability and occupancy
        const availableTeachers = teachers.filter(teacher => {
            // Check if teacher already has a class at this time
            if (busyTeacherIds.has(teacher.id)) {
                return false;
            }

            // Check if teacher has specified this day in their availability
            try {
                const dayKey = day.toLowerCase().substring(0, 3); // Convert to mon, tue, wed, etc.
                const teacherAvailability = availabilityMap.get(teacher.id);

                if (!teacherAvailability || !teacherAvailability[dayKey]) {
                    return false;
                }

                // Parse the availability JSON for this day
                const dayAvailability = JSON.parse(teacherAvailability[dayKey]);

                // Check if time slot is available
                if (!dayAvailability || !dayAvailability[time]) {
                    return false;
                }

                // Handle language filtering
                // Note: Since UserOccupation is not available, we're skipping language filtering
                // You'll need to find an alternative way to implement language filtering

                // Calculate teacher's occupancy rate (simulation for demo)
                const teacherOccupancyRate = getTeacherOccupancyRate(teacher.id);
                if (teacherOccupancyRate > maxOccupancyRate) {
                    return false;
                }

                // Teacher is available for this slot
                return true;
            } catch (error) {
                console.error(`Error processing availability for teacher ${teacher.id}:`, error);
                return false;
            }
        });

        // Format response with reviews data
        const formattedTeachers = availableTeachers.map(teacher => {
            const teacherInfo = {
                id: teacher.id,
                name: teacher.full_name,
                imageUrl: teacher.avatar || null,
                initials: getInitials(teacher.full_name),
                languages: [], // Since UserOccupation is not available, we cannot provide languages
                rating: generateRandomRating(),
                reviews: Math.floor(Math.random() * 200),
                occupancyRate: getTeacherOccupancyRate(teacher.id)
            };
            return teacherInfo;
        });

        return res.status(200).json({
            status: 'success',
            data: formattedTeachers
        });

    } catch (error) {
        console.error('Error in getAvailableTeachers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get weekly teacher availability for the current week, including past days
 * FIXED: Only include teachers in time slots if they are actually available for booking
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getWeeklyTeacherAvailability = async (req, res) => {
    try {
        const {
            languages,
            time_of_day,
            start_time_utc,
            end_time_utc,
            occupancy_rate = 85, // DEFAULT: 85% - Show teachers with occupancy <= 85%
            student_class_time = 25 // Default lesson duration
        } = req.query;
        
        const lessonDuration = parseInt(student_class_time, 10);
        const maxOccupancyThreshold = parseFloat(occupancy_rate);

        const now = momentTz.utc();
        const weekStart = now.clone().startOf('day');
        const weekEnd = now.clone().add(7, 'days').endOf('day');

        // Get all active teachers
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'bio', 'timezone']
        });

        // Fetch teacher availability
        const teacherAvailabilities = await TeacherAvailability.findAll({
            where: { user_id: teachers.map(t => t.id) }
        });

        // Create a map of teacher IDs to their availability
        const availabilityMap = new Map();
        teacherAvailabilities.forEach(availability => {
            availabilityMap.set(availability.user_id, availability);
        });

        // Fetch regular classes with UserSubscriptions
        const regularClasses = await RegularClass.findAll({
            where: {
                teacher_id: teachers.map(t => t.id)
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
                const today = momentTz().tz(fromTimezone);
                const [hours, minutes] = timeString.split(':').map(Number);
                
                const sourceTime = today.clone().set({
                    hour: hours,
                    minute: minutes,
                    second: 0,
                    millisecond: 0
                });

                const targetTime = sourceTime.clone().tz(toTimezone);
                return targetTime.format('HH:mm');
            } catch (error) {
                console.error(`Error converting time ${timeString} from ${fromTimezone} to ${toTimezone}:`, error);
                return timeString;
            }
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

        // ========================================================================
        // NEW: CALCULATE TEACHER OCCUPANCY AND AVAILABILITY
        // ========================================================================

        /**
         * Calculate total available slots for each teacher across the week
         * A slot is a 30-minute time block
         */
        const calculateTeacherTotalSlots = (teacherId, teacherAvailability) => {
            let totalSlots = 0;
            const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            
            daysOfWeek.forEach(day => {
                const dayKey = day.toLowerCase().substring(0, 3);
                
                if (teacherAvailability && teacherAvailability[dayKey]) {
                    try {
                        const dayAvailability = JSON.parse(teacherAvailability[dayKey] || '{}');
                        
                        // Count all available time slots for this day
                        for (const timeSlot in dayAvailability) {
                            if (dayAvailability[timeSlot] === true) {
                                totalSlots++;
                            }
                        }
                    } catch (error) {
                        console.error(`Error parsing availability for teacher ${teacherId}, day ${dayKey}:`, error);
                    }
                }
            });
            
            return totalSlots;
        };

        /**
         * Calculate booked slots for each teacher from regular classes
         * Each regular class occupies slots based on its duration
         */
        const regularClassOccupiedSlots = new Map(); // Map to store occupied slots
        const teacherBookedSlotsCount = new Map(); // Map to count booked slots per teacher
        
        regularClasses.forEach(regClass => {
            try {
                const duration = getLessonDurationFromSubscription(regClass.Student);
                const normalizedDay = normalizeDayName(regClass.day);
                
                if (!normalizedDay) {
                    console.warn(`Invalid day: ${regClass.day} for regular class ID: ${regClass.id}`);
                    return;
                }
                
                // Convert regular class time to UTC
                const teacherTimezone = 'UTC';
                const localClassTime = convertTimeToTimezone(regClass.start_time, regClass.timezone || 'UTC', teacherTimezone);
                
                const [hours, minutes] = localClassTime.split(':').map(Number);
                const startMinutes = hours * 60 + minutes;
                
                // Calculate spanning slots based on duration (each slot = 30 min)
                const slotsToSpan = Math.ceil(duration / 30);
                
                // Count booked slots for this teacher
                const currentCount = teacherBookedSlotsCount.get(regClass.teacher_id) || 0;
                teacherBookedSlotsCount.set(regClass.teacher_id, currentCount + slotsToSpan);
                
                // Store occupied slots for conflict checking
                for (let i = 0; i < slotsToSpan; i++) {
                    const slotMinutes = startMinutes + (i * 30);
                    const slotHours = Math.floor(slotMinutes / 60) % 24;
                    const slotMins = slotMinutes % 60;
                    const slotTime = `${slotHours.toString().padStart(2, '0')}:${slotMins.toString().padStart(2, '0')}`;
                    
                    const slotKey = `${regClass.teacher_id}-${normalizedDay}-${slotTime}`;
                    regularClassOccupiedSlots.set(slotKey, {
                        class_id: regClass.id,
                        student: regClass.Student?.full_name || 'Student',
                        duration: duration,
                        is_main_slot: i === 0,
                        is_continuation: i > 0,
                        slot_index: i,
                        total_slots: slotsToSpan
                    });
                }
            } catch (error) {
                console.error(`Error processing regular class ${regClass.id}:`, error);
            }
        });

        /**
         * Calculate occupancy and availability for each teacher
         */
        const teacherStats = new Map();
        
        for (const teacher of teachers) {
            const teacherAvailability = availabilityMap.get(teacher.id);
            
            // Calculate total available slots
            const totalSlots = calculateTeacherTotalSlots(teacher.id, teacherAvailability);
            
            // Get booked slots from regular classes
            const bookedSlots = teacherBookedSlotsCount.get(teacher.id) || 0;
            
            // Calculate free slots
            const freeSlots = totalSlots - bookedSlots;
            
            // Calculate occupancy and availability percentages
            let occupancy = 0;
            let availability = 100;
            
            if (totalSlots > 0) {
                occupancy = parseFloat(((bookedSlots / totalSlots) * 100).toFixed(2));
                availability = parseFloat((100 - occupancy).toFixed(2));
            }
            
            teacherStats.set(teacher.id, {
                totalSlots,
                bookedSlots,
                freeSlots,
                occupancy,
                availability
            });
        }

        // ========================================================================
        // FILTER TEACHERS BASED ON OCCUPANCY RATE
        // ========================================================================
        
        /**
         * Only include teachers whose occupancy is <= maxOccupancyThreshold
         * Example: If slider = 70%, only show teachers with occupancy <= 70%
         */
        const filteredTeachers = teachers.filter(teacher => {
            const stats = teacherStats.get(teacher.id);
            return stats && stats.occupancy <= maxOccupancyThreshold;
        });

        console.log(`Filtering teachers with occupancy <= ${maxOccupancyThreshold}%`);
        console.log(`Total teachers: ${teachers.length}, Filtered teachers: ${filteredTeachers.length}`);

        // ========================================================================
        // BUILD WEEKLY AVAILABILITY STRUCTURE
        // ========================================================================

        const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const weeklyAvailability = {};

        // Parse time range parameters if provided
        let startMinutesInUTC = null;
        let endMinutesInUTC = null;

        if (time_of_day !== 'all' && start_time_utc && end_time_utc) {
            const [startHour, startMinute] = start_time_utc.split(':').map(Number);
            const [endHour, endMinute] = end_time_utc.split(':').map(Number);
            startMinutesInUTC = startHour * 60 + startMinute;
            endMinutesInUTC = endHour * 60 + endMinute;
        }

        // Initialize weekly structure
        daysOfWeek.forEach(day => {
            weeklyAvailability[day] = {};
            for (let hour = 0; hour < 24; hour++) {
                for (const minute of [0, 30]) {
                    const timeSlot = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    
                    // Skip time filtering if time_of_day is 'all'
                    if (time_of_day === 'all') {
                        weeklyAvailability[day][timeSlot] = {
                            count: 0,
                            teachers: []
                        };
                        continue;
                    }

                    // Check if time slot is within the specified UTC range
                    if (startMinutesInUTC !== null && endMinutesInUTC !== null) {
                        const timeInMinutes = hour * 60 + minute;
                        const isWithinRange =
                            timeInMinutes >= startMinutesInUTC &&
                            timeInMinutes <= endMinutesInUTC;

                        if (isWithinRange) {
                            weeklyAvailability[day][timeSlot] = {
                                count: 0,
                                teachers: []
                            };
                        }
                    } else {
                        weeklyAvailability[day][timeSlot] = {
                            count: 0,
                            teachers: []
                        };
                    }
                }
            }
        });
        
        // Helper to check if a slot is occupied by a regular class
        const hasRegularClassConflict = (teacherId, dayOfWeek, timeSlot) => {
            const slotKey = `${teacherId}-${dayOfWeek}-${timeSlot}`;
            return regularClassOccupiedSlots.has(slotKey);
        };

        // Helper function to check if teacher has enough consecutive available slots
        const hasConsecutiveAvailability = (teacherId, day, startTimeSlot, duration, teacherAvailability) => {
            const requiredSlots = Math.ceil(duration / 30);
            const dayKey = day.toLowerCase().substring(0, 3);
            
            const [startHours, startMinutes] = startTimeSlot.split(':').map(Number);
            const startTotalMinutes = startHours * 60 + startMinutes;
            
            for (let i = 0; i < requiredSlots; i++) {
                const slotMinutes = startTotalMinutes + (i * 30);
                const slotHours = Math.floor(slotMinutes / 60) % 24;
                const slotMins = slotMinutes % 60;
                const checkTimeSlot = `${slotHours.toString().padStart(2, '0')}:${slotMins.toString().padStart(2, '0')}`;
                
                let isSlotAvailable = false;
                if (teacherAvailability && teacherAvailability[dayKey]) {
                    try {
                        const dayAvailability = JSON.parse(teacherAvailability[dayKey] || '{}');
                        isSlotAvailable = dayAvailability && dayAvailability[checkTimeSlot];
                    } catch (_) {
                        isSlotAvailable = false;
                    }
                }
                
                if (!isSlotAvailable || hasRegularClassConflict(teacherId, day, checkTimeSlot)) {
                    return false;
                }
            }
            
            return true;
        };

        // ========================================================================
        // PROCESS ONLY FILTERED TEACHERS (Based on Occupancy)
        // ========================================================================
        
        for (const teacher of filteredTeachers) {
            const teacherAvailability = availabilityMap.get(teacher.id);
            const stats = teacherStats.get(teacher.id);

            for (const day of daysOfWeek) {
                const dayKey = day.toLowerCase().substring(0, 3);

                for (let hour = 0; hour < 24; hour++) {
                    for (const minute of [0, 30]) {
                        const timeSlot = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

                        // Skip if filtered out earlier
                        if (!weeklyAvailability[day][timeSlot]) continue;

                        // Check basic teacher availability
                        let isTeacherAvailable = true;

                        if (!teacherAvailability || !teacherAvailability[dayKey]) {
                            isTeacherAvailable = false;
                        } else {
                            try {
                                const dayAvailability = JSON.parse(teacherAvailability[dayKey] || '{}');
                                if (!dayAvailability || !dayAvailability[timeSlot]) {
                                    isTeacherAvailable = false;
                                }
                            } catch (_) {
                                isTeacherAvailable = false;
                            }
                        }

                        if (!isTeacherAvailable) continue;

                        // Skip if occupied by regular class
                        if (hasRegularClassConflict(teacher.id, day, timeSlot)) {
                            continue;
                        }

                        // Check consecutive availability for lesson duration
                        if (!hasConsecutiveAvailability(teacher.id, day, timeSlot, lessonDuration, teacherAvailability)) {
                            continue;
                        }

                        // ========================================================================
                        // INCLUDE TEACHER WITH AVAILABILITY PERCENTAGE
                        // ========================================================================
                        
                        const teacherInfo = {
                            id: teacher.id,
                            name: teacher.full_name,
                            imageUrl: teacher.avatar || null,
                            initials: getInitials(teacher.full_name),
                            timezone: teacher.timezone,
                            rating: '0.0',
                            reviews: 0,
                            // NEW: Include availability percentage
                            availability: stats.availability,
                            occupancy: stats.occupancy,
                            totalSlots: stats.totalSlots,
                            bookedSlots: stats.bookedSlots,
                            freeSlots: stats.freeSlots
                        };

                        weeklyAvailability[day][timeSlot].count += 1;
                        weeklyAvailability[day][timeSlot].teachers.push(teacherInfo);
                    }
                }
            }
        }

        // Clean up empty time slots
        for (const day in weeklyAvailability) {
            for (const timeSlot in weeklyAvailability[day]) {
                if (weeklyAvailability[day][timeSlot].teachers.length === 0) {
                    delete weeklyAvailability[day][timeSlot];
                }
            }
        }
        
        // ========================================================================
        // RETURN RESPONSE WITH TEACHER STATS
        // ========================================================================
        
        return res.status(200).json({
            status: 'success',
            data: weeklyAvailability
            // data: {
            //     weeklyAvailability,
            //     filters: {
            //         occupancy_rate: maxOccupancyThreshold,
            //         total_teachers: teachers.length,
            //         filtered_teachers: filteredTeachers.length
            //     }
            // }
        });
    } catch (error) {
        console.error('Error in getWeeklyTeacherAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Check which classes are available and which are not for a 4-week pattern
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const checkClassAvailability = async (req, res) => {
    try {
        const {
            teacher_id,
            time_slots  // Array of { day: string, time: string }
        } = req.body;

        if (!teacher_id || !time_slots || !time_slots.length) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // Get teacher info
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name']
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Get teacher holidays
        const teacherHolidays = await TeacherHoliday.findAll({
            where: { user_id: teacher_id,status:'approved' }
        });

        // Default class duration
        const classDuration = 60;

        // Check availability for each requested time slot
        const results = [];

        for (const slot of time_slots) {
            const { day, time } = slot;

            // Calculate next 4 occurrences of this day and time (always 4 weeks)
            const occurrences = getNextOccurrences(day, time, 4);

            // Check each occurrence
            for (const occurrence of occurrences) {
                const startTime = moment.utc(occurrence);
                const endTime = moment.utc(occurrence).add(classDuration, 'minutes');
                const dateStr = startTime.format('YYYY-MM-DD');
                const dayName = startTime.format('dddd');

                // Create result object for this occurrence
                const availabilityInfo = {
                    day: dayName,
                    time,
                    date: dateStr,
                    iso_datetime: startTime.format(),
                    end_datetime: endTime.format(),
                    available: true,
                    unavailability_reason: null
                };

                // Skip teacher availability check - we're allowing bookings regardless of teacher's configured availability

                // Check for holiday conflicts
                const isHoliday = teacherHolidays.some(holiday => {
                    const holidayStart = moment.utc(holiday.form_date);
                    const holidayEnd = moment.utc(holiday.to_date);
                    return startTime.isBetween(holidayStart, holidayEnd, null, '[]');
                });

                if (isHoliday) {
                    availabilityInfo.available = false;
                    availabilityInfo.unavailability_reason = 'Teacher on holiday';
                }

                // Check for existing class conflicts
                const conflictingClass = await Class.findOne({
                    where: {
                        teacher_id,
                        [Op.or]: [
                            {
                                meeting_start: {
                                    [Op.between]: [startTime.format(), endTime.format()]
                                }
                            },
                            {
                                meeting_end: {
                                    [Op.between]: [startTime.format(), endTime.format()]
                                }
                            }
                        ],
                        status: {
                            [Op.notIn]: ['canceled', 'rejected']
                        }
                    }
                });

                if (conflictingClass) {
                    availabilityInfo.available = false;
                    availabilityInfo.unavailability_reason = 'Teacher has another class scheduled';
                }

                results.push(availabilityInfo);
            }
        }

        // Split into available and unavailable classes
        const availableClasses = results.filter(cls => cls.available);
        const unavailableClasses = results.filter(cls => !cls.available);

        // Check if all 4 weeks are available - the key check for the new requirement
        const allWeeksAvailable = time_slots.every(slot => {
            const slotResults = results.filter(
                r => r.day.toLowerCase() === slot.day.toLowerCase() && r.time === slot.time
            );
            return slotResults.every(r => r.available);
        });

        return res.status(200).json({
            status: 'success',
            data: {
                teacher: {
                    id: teacher.id,
                    name: teacher.full_name
                },
                all_weeks_available: allWeeksAvailable,
                available_classes: availableClasses,
                unavailable_classes: unavailableClasses,
                summary: {
                    total: results.length,
                    available: availableClasses.length,
                    unavailable: unavailableClasses.length
                }
            }
        });
    } catch (error) {
        console.error('Error in checkClassAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * API 2: Find alternative classes when needed
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const findAlternativeClasses = async (req, res) => {
    try {
        const {
            teacher_id,
            original_date,
            original_time,
            search_range = 3  // Days to search before/after
        } = req.body;

        if (!teacher_id || !original_date || !original_time) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // Get teacher info
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name']
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Parse the original date and time
        const originalDateTime = moment.utc(`${original_date} ${original_time}`);
        if (!originalDateTime.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date or time format'
            });
        }

        // Class duration (default)
        const classDuration = 60;

        // Get teacher availability
        const teacherAvailability = await TeacherAvailability.findOne({
            where: { user_id: teacher_id }
        });

        // Get teacher holidays
        const teacherHolidays = await TeacherHoliday.findAll({
            where: { user_id: teacher_id,status:'approved' }
        });

        // Find alternatives
        const alternatives = [];

        // Look for days within the search range
        for (let dayOffset = -search_range; dayOffset <= search_range; dayOffset++) {
            // Skip the original day
            if (dayOffset === 0) continue;

            const currentDate = originalDateTime.clone().add(dayOffset, 'days');
            const dayName = currentDate.format('dddd');
            const dayKey = dayName.toLowerCase().substring(0, 3);

            // Skip if teacher doesn't have availability for this day
            if (!teacherAvailability || !teacherAvailability[dayKey]) {
                continue;
            }

            // Parse the teacher's availability for this day
            let dayAvailability = {};
            try {
                dayAvailability = JSON.parse(teacherAvailability[dayKey]) || {};
            } catch (error) {
                console.error(`Error parsing availability for day ${dayKey}:`, error);
                continue;
            }

            // Check each time slot in the teacher's availability
            for (const timeSlot in dayAvailability) {
                if (dayAvailability[timeSlot]) {
                    const [hours, minutes] = timeSlot.split(':').map(Number);
                    const slotDateTime = currentDate.clone().hour(hours).minute(minutes).second(0);
                    const slotEndTime = slotDateTime.clone().add(classDuration, 'minutes');

                    // Check for holiday conflicts
                    const isHoliday = teacherHolidays.some(holiday => {
                        const holidayStart = moment.utc(holiday.form_date);
                        const holidayEnd = moment.utc(holiday.to_date);
                        return slotDateTime.isBetween(holidayStart, holidayEnd, null, '[]');
                    });

                    if (isHoliday) continue;

                    // Check for existing class conflicts
                    const conflictingClass = await Class.findOne({
                        where: {
                            teacher_id,
                            [Op.or]: [
                                {
                                    meeting_start: {
                                        [Op.between]: [slotDateTime.format(), slotEndTime.format()]
                                    }
                                },
                                {
                                    meeting_end: {
                                        [Op.between]: [slotDateTime.format(), slotEndTime.format()]
                                    }
                                }
                            ],
                            status: {
                                [Op.notIn]: ['canceled', 'rejected']
                            }
                        }
                    });

                    if (conflictingClass) continue;

                    // This time slot is available, add it to alternatives
                    alternatives.push({
                        day: dayName,
                        time: timeSlot,
                        date: slotDateTime.format('YYYY-MM-DD'),
                        iso_datetime: slotDateTime.format(),
                        end_datetime: slotEndTime.format()
                    });
                }
            }
        }

        // Sort alternatives by closest to original time
        alternatives.sort((a, b) => {
            const aTime = a.time.split(':').map(Number);
            const bTime = b.time.split(':').map(Number);
            const originalTimeParts = original_time.split(':').map(Number);

            const aMinutes = (aTime[0] * 60) + aTime[1];
            const bMinutes = (bTime[0] * 60) + bTime[1];
            const originalMinutes = (originalTimeParts[0] * 60) + originalTimeParts[1];

            return Math.abs(aMinutes - originalMinutes) - Math.abs(bMinutes - originalMinutes);
        });

        return res.status(200).json({
            status: 'success',
            data: {
                teacher: {
                    id: teacher.id,
                    name: teacher.full_name
                },
                original: {
                    date: original_date,
                    time: original_time,
                    iso_datetime: originalDateTime.format()
                },
                alternatives: alternatives.slice(0, 10) // Limit to top 10 alternatives
            }
        });
    } catch (error) {
        console.error('Error in findAlternativeClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create hidden classes for next month cycle (similar to setMonthlyClasses.js)
 * @param {Object} regularClass - RegularClass instance
 * @param {Object} student - Student user object
 * @param {Object} teacher - Teacher user object
 * @param {Object} subscription - UserSubscriptionDetails instance
 * @param {string} batchId - Batch ID for grouping classes
 * @param {Object} transaction - Sequelize transaction
 */
async function createNextMonthHiddenClasses(regularClass, student, teacher, subscription, batchId, transaction) {
    try {
        // Calculate next month dates - from lesson_reset_at to lesson_reset_at + 1 month
        const currentDateNextMonth = moment.utc(subscription.lesson_reset_at).startOf('day');
        const renewDateNextMonth = moment.utc(subscription.lesson_reset_at).add(1, 'month');

        // Get existing lessons to avoid duplicates
        const existingLessons = await Class.findAll({
            where: {
                student_id: student.id,
                teacher_id: teacher.id,
                status: { [Op.ne]: 'canceled' }
            },
            transaction
        });

        const existingLessonTimes = existingLessons.map(lesson => 
            moment.utc(lesson.meeting_start).format('YYYY-MM-DD HH:mm')
        );

        // Parse days from regularClass (support comma-separated)
        const classDays = regularClass.day.split(',').map(day => day.trim().toLowerCase());
        
        // Helper function to get day index
        const getDayIndex = (dayName) => {
            const weekdayMap = {
                'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
                'thursday': 4, 'friday': 5, 'saturday': 6
            };
            return weekdayMap[dayName.toLowerCase()];
        };

        // Get teacher availability
        const teacherAvailability = await TeacherAvailability.findOne({
            where: { user_id: teacher.id },
            transaction
        });

        const dayIndices = classDays.map(day => getDayIndex(day));
        let iterationDate = currentDateNextMonth.clone();
        let nextMonthClassesCreated = 0;
        let nextMonthClassesSkipped = 0;

        while (iterationDate.isBefore(renewDateNextMonth)) {
            const dayOfWeek = iterationDate.day();

            if (dayIndices.includes(dayOfWeek)) {
                const classTime = regularClass.start_time.split(':');
                const classDate = iterationDate.clone().set({
                    hour: parseInt(classTime[0]),
                    minute: parseInt(classTime[1]),
                    second: 0
                });

                // Convert to student's timezone for proper scheduling
                const studentTimezone = student.timezone || 'UTC';
                const classDateUserTimezone = moment.tz(
                    classDate.format('YYYY-MM-DD HH:mm'),
                    studentTimezone
                );

                const startMeetingUTC = classDateUserTimezone.clone().tz('UTC');
                const endMeetingUTC = startMeetingUTC.clone().add(subscription.lesson_min || 60, 'minutes');

                const classTimeKey = startMeetingUTC.format('YYYY-MM-DD HH:mm');

                // Check if lesson already exists (refetch to include classes created in this transaction)
                // This ensures we catch duplicates when multiple regular classes are booked simultaneously
                const existingClassAtTime = await Class.findOne({
                    where: {
                        student_id: student.id,
                        teacher_id: teacher.id,
                        meeting_start: startMeetingUTC.format(),
                        status: { [Op.ne]: 'canceled' }
                    },
                    transaction
                });

                if (existingClassAtTime) {
                    nextMonthClassesSkipped++;
                    iterationDate.add(1, 'day');
                    continue;
                }

                // Check for teacher holidays
                const isTeacherOnHoliday = await TeacherHoliday.findOne({
                    where: {
                        user_id: teacher.id,
                        status: 'approved',
                        [Op.and]: [
                            { form_date: { [Op.lte]: startMeetingUTC.format() } },
                            { to_date: { [Op.gt]: startMeetingUTC.format() } }
                        ]
                    },
                    transaction
                });

                const isTeacherOnHolidayEndTime = await TeacherHoliday.findOne({
                    where: {
                        user_id: teacher.id,
                        status: 'approved',
                        [Op.and]: [
                            { form_date: { [Op.lte]: endMeetingUTC.format() } },
                            { to_date: { [Op.gte]: endMeetingUTC.format() } }
                        ]
                    },
                    transaction
                });

                if (isTeacherOnHoliday || isTeacherOnHolidayEndTime) {
                    nextMonthClassesSkipped++;
                    iterationDate.add(1, 'day');
                    continue;
                }

                // Check teacher availability
                let isTeacherAvailable = false;
                if (teacherAvailability) {
                    const dayKey = startMeetingUTC.format('ddd').toLowerCase();
                    const startTimeSlot = startMeetingUTC.format('HH:mm');

                    try {
                        const availabilityData = JSON.parse(teacherAvailability[dayKey] || '{}');

                        if (subscription.lesson_min > 30) {
                            const nextTimeSlot = startMeetingUTC.clone().add(30, 'minutes').format('HH:mm');
                            isTeacherAvailable = availabilityData[startTimeSlot] === true &&
                                availabilityData[nextTimeSlot] === true;
                        } else {
                            isTeacherAvailable = availabilityData[startTimeSlot] === true;
                        }
                    } catch (error) {
                        isTeacherAvailable = false;
                    }
                }

                if (isTeacherAvailable) {
                    // Check for overlapping classes
                    const overlappingClasses = await Class.count({
                        where: {
                            teacher_id: teacher.id,
                            status: { [Op.ne]: 'canceled' },
                            [Op.and]: [
                                { meeting_start: { [Op.lt]: endMeetingUTC.format() } },
                                { meeting_end: { [Op.gt]: startMeetingUTC.format() } }
                            ]
                        },
                        transaction
                    });

                    if (overlappingClasses === 0) {
                        // Create hidden class for next month
                        const newHiddenClass = await Class.create({
                            meeting_start: startMeetingUTC.format(),
                            meeting_end: endMeetingUTC.format(),
                            teacher_id: teacher.id,
                            student_id: student.id,
                            booked_by: 'System',
                            status: 'pending',
                            batch_id: batchId,
                            is_regular_hide: 1, // Hidden class for next month
                            is_trial: false,
                            class_type: 'website',
                            next_month_class_term: false,
                            bonus_class: false,
                            join_url: teacher.enable_zoom_link ? teacher.add_zoom_link : null,
                            admin_url: teacher.enable_zoom_link ? teacher.add_zoom_link : null,
                            subscription_id: subscription.id
                        }, { transaction });

                        nextMonthClassesCreated++;
                    } else {
                        nextMonthClassesSkipped++;
                    }
                } else {
                    nextMonthClassesSkipped++;
                }
            }

            iterationDate.add(1, 'day');
        }
    } catch (error) {
        console.error(`Error creating next month hidden classes for regular class ${regularClass.id}:`, error);
        // Don't throw - allow the booking to continue even if next month creation fails
    }
}

/**
 * Book confirmed classes and create a single RegularClass entry for recurring patterns
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const bookClasses = async (req, res) => {
    let transaction;

    try {
        const {
            student_id,
            teacher_id,
            subscription_id,
            classes,  // Array of { date: YYYY-MM-DD, time: HH:MM }
            regular_patterns, // NEW: Array of patterns instead of single pattern
            regular_pattern, // Keep for backward compatibility
            student_goal = ''
        } = req.body;

        if (!student_id || !teacher_id || !subscription_id || !classes || !classes.length) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        // Determine which patterns to use (prioritize regular_patterns)
        const selectedSlots = regular_patterns && Array.isArray(regular_patterns) && regular_patterns.length > 0
            ? regular_patterns
            : (regular_pattern ? [regular_pattern] : []);

        console.log('Final selectedSlots:', selectedSlots);

        if (selectedSlots.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No recurring patterns provided'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if teacher exists
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            transaction
        });

        if (!teacher) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Check if student exists
        const student = await User.findByPk(student_id, {
            attributes: ['id', 'full_name', 'email', 'timezone'],
            transaction
        });

        if (!student) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Check subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                id: subscription_id,
                user_id: student_id,
                status: 'active'
            },
            transaction
        });

        if (!subscription) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Active subscription not found'
            });
        }

        // NEW: Enhanced validation using subscription plan logic
        const validationResult = validateBookingEligibility(subscription, selectedSlots);
        
        if (!validationResult.isValid) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: validationResult.error
            });
        }

        // Get class duration from subscription
        const classDuration = parseInt(subscription.lesson_min) || 60;
        
        // Calculate lesson count in the current period (30 days back from reset date)
        const reset30DaysBack = moment(subscription.lesson_reset_at).subtract(30, 'days');
        const resetDate = moment(subscription.lesson_reset_at).format('YYYY-MM-DD 23:59');
        
        const lessonCount = await Class.count({
            where: {
                student_id: student_id,
                status: { [Op.ne]: 'canceled' },
                meeting_end: {
                    [Op.gt]: reset30DaysBack.toDate(),
                    [Op.lt]: moment(resetDate).toDate()
                }
            },
            transaction
        });

        // NEW: Validate that all classes are scheduled before the renewal date
        // Use renew_date as primary renewal boundary; fallback to lesson_reset_at for backward compatibility
        const renewalDate = subscription.renew_date
            ? moment(subscription.renew_date).endOf('day')
            : moment(subscription.lesson_reset_at).endOf('day');
        const sortedClasses = classes.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Check each class date is before renewal date
        const classesBeyondRenewal = [];
        for (const cls of sortedClasses) {
            const classDate = moment.utc(`${cls.date} ${cls.time}`);
            if (classDate.isAfter(renewalDate)) {
                classesBeyondRenewal.push({
                    date: cls.date,
                    time: cls.time,
                    renewal_date: renewalDate.format('YYYY-MM-DD')
                });
            }
        }

        if (classesBeyondRenewal.length > 0) {
            if (transaction) await transaction.rollback();
            const renewalDateFormatted = renewalDate.format('YYYY-MM-DD');
            return res.status(400).json({
                status: 'error',
                message: `Cannot book classes beyond subscription renewal date (${renewalDateFormatted}). ${classesBeyondRenewal.length} class(es) are scheduled after the renewal date.`,
                data: {
                    renewal_date: renewalDateFormatted,
                    invalid_classes: classesBeyondRenewal
                }
            });
        }

        // NEW: Validate remaining lessons upfront before processing any classes
        // Calculate how many lessons will be needed for immediate booking
        const totalClassesToBook = sortedClasses.length;
        const lessonsNeededForImmediateBooking = validationResult.bookingType === 'full' 
            ? totalClassesToBook 
            : (validationResult.bookingType === 'partial' ? validationResult.immediateClasses : 0);

        // Check if we have enough lessons (including bonus classes if applicable)
        const availableRegularLessons = subscription.left_lessons || 0;
        const availableBonusClasses = subscription.bonus_class > 0 && 
            subscription.bonus_class !== subscription.bonus_completed_class 
            ? subscription.bonus_class - (subscription.bonus_completed_class || 0)
            : 0;
        
        const totalAvailableLessons = availableRegularLessons + availableBonusClasses;

        if (lessonsNeededForImmediateBooking > 0 && lessonsNeededForImmediateBooking > totalAvailableLessons) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Insufficient lessons remaining. Attempting to book ${lessonsNeededForImmediateBooking} class(es) but only ${availableRegularLessons} regular lesson(s) and ${availableBonusClasses} bonus class(es) available (total: ${totalAvailableLessons}). Please reduce the number of classes or wait for subscription renewal.`,
                data: {
                    requested_lessons: lessonsNeededForImmediateBooking,
                    available_regular_lessons: availableRegularLessons,
                    available_bonus_classes: availableBonusClasses,
                    total_available: totalAvailableLessons
                }
            });
        }

        // NEW: Enhanced booking logic based on booking type
        const bookedClasses = [];
        const failedClasses = [];
        const pendingClasses = []; // Kept for backward-compatible response shape but no longer used for renewal-dependent booking

        // Generate a unique batch ID for this group of classes
        const batchId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let lessonsToDeduct = 0;
        let classesBooked = 0;
        let bonusClassesUsed = 0;

        for (const cls of sortedClasses) {
            const { date, time } = cls;

            // Parse the date and time
            const startTime = moment.utc(`${date} ${time}`);
            const endTime = startTime.clone().add(classDuration, 'minutes');
            const weekDay = startTime.format('dddd'); // Full day name (Monday, Tuesday, etc.)

            // Check if this time slot is available
            const isAvailable = await isTimeSlotAvailable(
                teacher_id,
                startTime,
                endTime,
                transaction
            );

            if (!isAvailable) {
                failedClasses.push({
                    date,
                    time,
                    reason: 'Time slot is no longer available'
                });
                continue;
            }

            // NEW: Determine if this class should be booked immediately
            const shouldBookImmediately = validationResult.bookingType === 'full' || 
                (validationResult.bookingType === 'partial' && classesBooked < validationResult.immediateClasses);

            // **BONUS CLASS LOGIC** - Check if this should be a bonus class
            let shouldUseBonusClass = false;
            if (shouldBookImmediately && lessonCount >= subscription.weekly_lesson) {
                // Weekly lessons completed, check if bonus class is available
                if (subscription.bonus_class > 0 && 
                    subscription.left_lessons <= subscription.bonus_class && 
                    subscription.bonus_class != subscription.bonus_completed_class) {
                    
                    const bonusExpireDate = moment(subscription.bonus_expire_date).endOf('day');
                    if (!bonusExpireDate.isBefore(startTime)) {
                        shouldUseBonusClass = true;
                    }
                }
            }

            // Check if lessons are available (unless using bonus class)
            // This is a safety check - upfront validation should have caught this, but we check again here
            if (shouldBookImmediately && !shouldUseBonusClass) {
                const remainingAfterDeduction = subscription.left_lessons - lessonsToDeduct;
                if (remainingAfterDeduction <= 0) {
                    if (transaction) await transaction.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: `Insufficient lessons remaining. Only ${subscription.left_lessons} lesson(s) available, but attempting to book ${lessonsToDeduct + 1} class(es). Please reduce the number of classes or wait for subscription renewal.`,
                        data: {
                            available_lessons: subscription.left_lessons,
                            attempted_bookings: lessonsToDeduct + 1,
                            renewal_date: moment(subscription.lesson_reset_at).format('YYYY-MM-DD')
                        }
                    });
                }
            }

            // Create the class entry only if we can book it immediately
            try {
                if (shouldBookImmediately) {
                    const classData = {
                        student_id,
                        teacher_id,
                        status: 'pending',
                        meeting_start: startTime.format(),
                        meeting_end: endTime.format(),
                        is_trial: false,
                        student_goal,
                        subscription_id,
                        class_type: 'website',
                        next_month_class_term: false,
                        bonus_class: shouldUseBonusClass ? 1 : 0,
                        join_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
                        admin_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
                        batch_id: batchId,
                        booked_by: req.user?.role_name || 'system',
                        booked_by_admin_id: req.user?.id,
                        booking_type: validationResult.bookingType,
                        renewal_dependent: false
                    };

                    const newClass = await Class.create(classData, { transaction });

                    if (shouldBookImmediately) {
                        bookedClasses.push({
                            id: newClass.id,
                            date,
                            time,
                            day: weekDay,
                            meeting_start: startTime.format(),
                            meeting_end: endTime.format(),
                            status: 'booked',
                            is_bonus_class: shouldUseBonusClass
                        });
                        classesBooked++;
                        
                        if (shouldUseBonusClass) {
                            bonusClassesUsed++;
                        }
                        lessonsToDeduct++; // Always deduct a lesson (bonus or regular)
                    }
                } else {
                    // Do NOT create renewal-dependent classes anymore – just record them as failed
                    failedClasses.push({
                        date,
                        time,
                        reason: 'Insufficient lessons remaining; class not booked.'
                    });
                }
            } catch (error) {
                failedClasses.push({
                    date,
                    time,
                    reason: 'Database error: ' + error.message
                });
            }
        }

        // If no classes were processed successfully, rollback
        if (bookedClasses.length === 0 && pendingClasses.length === 0) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Could not book any classes',
                data: {
                    failed: failedClasses
                }
            });
        }

        // NEW: FIXED - Create RegularClass entries for ALL patterns
        const regularClassEntries = [];

        console.log('Creating RegularClass entries for', selectedSlots.length, 'patterns');

        for (let i = 0; i < selectedSlots.length; i++) {
            const pattern = selectedSlots[i];
            const { day, time } = pattern;

            console.log(`Creating RegularClass ${i + 1}:`, { day, time });

            // Get user's timezone from student data
            const userTimezone = student.timezone || 'UTC';

            // Convert UTC time to student's timezone using current date to avoid DST issues
            const today = moment.utc();
            const [hours, minutes] = time.split(':').map(Number);
            const utcTime = today.clone().set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
            const startTimeInStudentTimezone = utcTime.tz(userTimezone).format('HH:mm');
            const endTimeInStudentTimezone = utcTime
                .clone()
                .add(classDuration, 'minutes')
                .tz(userTimezone)
                .format('HH:mm');

            const regularClassEntry = await RegularClass.create({
                student_id,
                teacher_id,
                day: day,
                start_time: startTimeInStudentTimezone,
                end_time: endTimeInStudentTimezone,
                timezone: userTimezone,
                batch_id: batchId,
                student_lesson_reset_at: subscription.lesson_reset_at,
                // NEW: Add booking metadata
                booking_type: validationResult.bookingType,
                max_recurring_classes: Math.floor((subscription.regularClasses || 0) / 4)
            }, { transaction });

            regularClassEntries.push({
                id: regularClassEntry.id,
                day: regularClassEntry.day,
                start_time: regularClassEntry.start_time,
                end_time: regularClassEntry.end_time,
                timezone: regularClassEntry.timezone,
                booking_type: validationResult.bookingType
            });

            console.log(`RegularClass ${i + 1}/${selectedSlots.length} created with ID: ${regularClassEntry.id} (Day: ${day}, Time: ${startTimeInStudentTimezone})`);

            // Create next month hidden classes for this regular class pattern
            try {
                console.log(`Creating next month hidden classes for RegularClass ${i + 1}/${selectedSlots.length} (ID: ${regularClassEntry.id})`);
                await createNextMonthHiddenClasses(
                    regularClassEntry,
                    student,
                    teacher,
                    subscription,
                    batchId,
                    transaction
                );
                console.log(`✅ Completed next month hidden classes for RegularClass ${i + 1}/${selectedSlots.length} (ID: ${regularClassEntry.id})`);
            } catch (nextMonthError) {
                console.error(`Error creating next month hidden classes for regular class ${regularClassEntry.id}:`, nextMonthError);
                // Don't stop the process if next month creation fails
            }
        }

        console.log(`✅ Total RegularClass entries created: ${regularClassEntries.length} - All next month hidden classes processed`);

        // **UPDATE SUBSCRIPTION WITH BONUS CLASS LOGIC**
        const subscriptionUpdateData = {
            left_lessons: Math.max(0, subscription.left_lessons - lessonsToDeduct),
            updated_at: new Date()
        };

        // If bonus classes were used, increment bonus completed count
        if (bonusClassesUsed > 0) {
            subscriptionUpdateData.bonus_completed_class = (subscription.bonus_completed_class || 0) + bonusClassesUsed;
        }

        await UserSubscriptionDetails.update(subscriptionUpdateData, {
            where: { id: subscription.id },
            transaction
        });

        const newLeftLessons = subscriptionUpdateData.left_lessons;

        // Create salesperson activity if booked by sales - SALES SPECIFIC LOGIC
        if (req.user && req.user.role_name && req.user.role_name.includes('sales')) {
            // Create activities for immediately booked classes with enhanced tracking
            for (const cls of bookedClasses) {
                await Salesperson.create({
                    user_id: req.user.id,
                    role_type: req.user.role_type || 'sales_role',
                    action_type: 'regular_class',
                    student_id,
                    class_id: cls.id,
                    subscription_id,
                    meeting_type: 'online',
                    appointment_time: cls.meeting_start,
                    appointment_duration: classDuration,
                    success_status: 'successful',
                    // Add bonus class tracking for sales analytics
                    is_bonus_class: cls.is_bonus_class || false,
                    total_classes_booked: bookedClasses.length,
                    bonus_classes_used: bonusClassesUsed,
                    sales_commission_type: cls.is_bonus_class ? 'bonus_class' : 'regular_class'
                }, { transaction });
            }

            // Create a summary entry for the entire booking session
            await Salesperson.create({
                user_id: req.user.id,
                role_type: req.user.role_type || 'sales_role',
                action_type: 'regular_class',
                student_id,
                subscription_id,
                meeting_type: 'online',
                appointment_time: moment.utc().format(),
                appointment_duration: classDuration * bookedClasses.length,
                success_status: 'successful',
                // Enhanced sales tracking
                total_recurring_patterns: regularClassEntries.length,
                total_sessions_booked: bookedClasses.length,
                pending_sessions: pendingClasses.length,
                bonus_classes_used: bonusClassesUsed,
                regular_classes_used: bookedClasses.length - bonusClassesUsed,
                booking_type: validationResult.bookingType
            }, { transaction });
        }

        try {
            const totalRecurringClasses = regularClassEntries.length;
            const immediateClasses = bookedClasses.length;
            const pendingClassesCount = 0; // We no longer create renewal-dependent classes

            // FIXED: Create proper time display with both day and time
            let patternsText = '';
            if (regularClassEntries.length === 1) {
                // Single recurring class - show day and time
                const pattern = regularClassEntries[0];
                patternsText = `${pattern.day} at ${pattern.start_time}`;
            } else {
                // Multiple recurring classes - show all day/time combinations
                patternsText = regularClassEntries.map(p => `${p.day} at ${p.start_time}`).join(', ');
            }

            let statusMessage = '';
            if (validationResult.bookingType === 'full') {
                statusMessage = `All ${immediateClasses} lessons booked immediately${bonusClassesUsed > 0 ? ` (${bonusClassesUsed} bonus classes used)` : ''}`;
            } else if (validationResult.bookingType === 'partial') {
                statusMessage = `${immediateClasses} lessons booked now${bonusClassesUsed > 0 ? ` (${bonusClassesUsed} bonus classes used)` : ''}`;
            }

            const notifyOptions = {
                'student.name': student.full_name,
                'time.day': patternsText,
            };

            const notifyOptionsTeacher = {
                'instructor.name': teacher.full_name,
                'student.name': student.full_name,
                'time.day': patternsText,
                'total.classes': (immediateClasses + pendingClassesCount).toString(),
                'recurring.patterns': totalRecurringClasses.toString(),
                'booking.status': statusMessage
            };

            await whatsappReminderAddClass('regular_class_book_for_student', notifyOptions, student.id);
            await whatsappReminderAddClass('regular_class_book_for_teacher', notifyOptionsTeacher, teacher.id);
        } catch (notificationError) {
            // Log but don't fail the booking if notifications fail
            console.error('WhatsApp notification error:', notificationError);
        }

        // Commit transaction
        await transaction.commit();

        // FIXED: Return properly formatted timeSlots data without duplication
        const formattedTimeSlots = [...bookedClasses, ...pendingClasses].map(cls => ({
            date: cls.date,
            time: cls.time,
            day: cls.day,
            meeting_start: cls.meeting_start,
            meeting_end: cls.meeting_end,
            status: cls.status,
            is_bonus_class: cls.is_bonus_class || false
        }));

        // Sort by date to ensure proper order
        formattedTimeSlots.sort((a, b) => new Date(a.date) - new Date(b.date));

        // NEW: Enhanced success response with detailed booking information and sales metrics
        let responseMessage = `Successfully booked ${bookedClasses.length} class${bookedClasses.length !== 1 ? 'es' : ''} across ${regularClassEntries.length} recurring pattern${regularClassEntries.length !== 1 ? 's' : ''}.`;
        if (failedClasses.length > 0) {
            responseMessage += ` ${failedClasses.length} class${failedClasses.length !== 1 ? 'es' : ''} could not be booked due to insufficient lessons or scheduling conflicts.`;
        }
        if (bonusClassesUsed > 0) {
            responseMessage += ` ${bonusClassesUsed} bonus class${bonusClassesUsed !== 1 ? 'es' : ''} were used.`;
        }

        return res.status(201).json({
            status: 'success',
            message: responseMessage,
            data: {
                teacher: {
                    id: teacher.id,
                    name: teacher.full_name
                },
                student: {
                    id: student.id,
                    name: student.full_name
                },
                subscription: {
                    id: subscription.id,
                    type: subscription.type,
                    total_lessons_in_plan: subscription.regularClasses || subscription.weekly_lesson || 0,
                    previous_lessons_remaining: subscription.left_lessons,
                    current_lessons_remaining: newLeftLessons,
                    lessons_deducted: lessonsToDeduct,
                    bonus_classes_used: bonusClassesUsed,
                    bonus_classes_remaining: subscription.bonus_class - (subscription.bonus_completed_class || 0) - bonusClassesUsed
                },
                booking_summary: {
                    booking_type: validationResult.bookingType,
                    total_recurring_classes: regularClassEntries.length,
                    total_sessions_scheduled: bookedClasses.length,
                    immediate_sessions: bookedClasses.length,
                    pending_sessions: 0,
                    bonus_sessions_used: bonusClassesUsed,
                    regular_sessions_used: bookedClasses.length - bonusClassesUsed,
                    max_allowed_recurring: Math.floor((subscription.regularClasses || 0) / 4)
                },
                // SALES SPECIFIC METRICS
                sales_metrics: {
                    sales_person_id: req.user?.id,
                    sales_person_name: req.user?.full_name || 'Unknown',
                    commission_eligible_classes: bookedClasses.length,
                    bonus_class_commission: bonusClassesUsed,
                    regular_class_commission: bookedClasses.length - bonusClassesUsed,
                    total_revenue_generated: bookedClasses.length * (subscription.lesson_price || 0),
                    booking_session_id: batchId
                },
                regular_classes: regularClassEntries,
                batch_id: batchId,
                immediately_booked: bookedClasses,
                pending_after_renewal: pendingClasses,
                failed: failedClasses.length > 0 ? failedClasses : null,
                timeSlots: formattedTimeSlots,
                // Calculation breakdown for frontend
                calculation: {
                    subscription_plan_lessons: subscription.regularClasses || subscription.weekly_lesson || 0,
                    lessons_before_booking: subscription.left_lessons,
                    lessons_deducted_now: lessonsToDeduct,
                    lessons_after_booking: newLeftLessons,
                    bonus_classes_used: bonusClassesUsed,
                    recurring_classes_created: regularClassEntries.length,
                    weeks_per_pattern: 4,
                    can_still_book_recurring: Math.floor(newLeftLessons / 4)
                }
            }
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error in bookClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Helper function to check if a time slot is available
 * @param {number} teacherId - Teacher ID
 * @param {moment} startTime - Start time (moment object)
 * @param {moment} endTime - End time (moment object) 
 * @param {Object} transaction - Sequelize transaction
 * @returns {boolean} True if available, false if not
 */
async function isTimeSlotAvailable(teacherId, startTime, endTime, transaction) {
    // Check for existing classes
    const conflictingClass = await Class.findOne({
        where: {
            teacher_id: teacherId,
            [Op.or]: [
                {
                    meeting_start: {
                        [Op.between]: [startTime.format(), endTime.format()]
                    }
                },
                {
                    meeting_end: {
                        [Op.between]: [startTime.format(), endTime.format()]
                    }
                }
            ],
            status: {
                [Op.notIn]: ['canceled', 'rejected']
            }
        },
        transaction
    });

    if (conflictingClass) {
        return false;
    }

    // Check teacher availability
    const dayName = startTime.format('dddd');
    const dayKey = dayName.toLowerCase().substring(0, 3);
    const timeStr = startTime.format('HH:mm');

    const teacherAvailability = await TeacherAvailability.findOne({
        where: { user_id: teacherId },
        transaction
    });

    if (!teacherAvailability || !teacherAvailability[dayKey]) {
        return false;
    }

    try {
        const dayAvailability = JSON.parse(teacherAvailability[dayKey]);
        if (!dayAvailability || !dayAvailability[timeStr]) {
            return false;
        }
    } catch (error) {
        console.error(`Error parsing availability for day ${dayKey}:`, error);
        return false;
    }

    // Check for holidays
    const teacherHolidays = await TeacherHoliday.findAll({
        where: { user_id: teacherId ,status:'approved'},
        transaction
    });

    const isHoliday = teacherHolidays.some(holiday => {
        const holidayStart = moment.utc(holiday.form_date);
        const holidayEnd = moment.utc(holiday.to_date);
        return startTime.isBetween(holidayStart, holidayEnd, null, '[]');
    });

    if (isHoliday) {
        return false;
    }

    return true;
}

/**
 * Helper function to get the next N occurrences of a day and time
 * @param {string} day - Day of the week (e.g., 'Monday')
 * @param {string} time - Time in HH:MM format
 * @param {number} count - Number of occurrences to generate
 * @returns {Array} Array of ISO datetime strings
 */
function getNextOccurrences(day, time, count) {
    const occurrences = [];
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === day.toLowerCase());

    if (dayIndex === -1) {
        throw new Error(`Invalid day: ${day}`);
    }

    // Parse the time
    const [hours, minutes] = time.split(':').map(Number);

    // Start from today
    let currentDate = moment.utc();
    const todayIndex = currentDate.day();

    // Check if today's day has already passed for this week
    const isSameDay = todayIndex === dayIndex;
    const isPastDay = todayIndex > dayIndex;

    // If today is the requested day, check if the time has already passed
    const isSameDayButPastTime = isSameDay &&
        (currentDate.hour() > hours ||
            (currentDate.hour() === hours && currentDate.minute() > minutes));

    if (isPastDay || isSameDayButPastTime) {
        // This week's occurrence has passed, start from next week
        const daysToAdd = (dayIndex - todayIndex + 7) % 7;
        currentDate.add(daysToAdd, 'days');
    } else {
        // Today is before or equal to the target day (and time hasn't passed)
        const daysToAdd = (dayIndex - todayIndex + 7) % 7;
        currentDate.add(daysToAdd, 'days');
    }

    // Set the time for the first occurrence
    currentDate.set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
    });

    // Add the first occurrence
    occurrences.push(currentDate.format());

    // Generate the remaining occurrences (always 4 weeks total)
    for (let i = 1; i < count; i++) {
        currentDate.add(7, 'days');
        occurrences.push(currentDate.format());
    }

    return occurrences;
}

/**
 * Helper function to get the next occurrence of a specific day and time
 * @param {string} day - Day of the week (e.g., 'Monday')
 * @param {string} time - Time in HH:MM format
 * @returns {string} ISO datetime string
 */
function getNextDayTime(day, time) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === day.toLowerCase());

    if (dayIndex === -1) {
        throw new Error(`Invalid day: ${day}`);
    }

    // Parse the time
    const [hours, minutes] = time.split(':').map(Number);

    // Start from today
    let currentDate = moment.utc();

    // Calculate days until the next occurrence of the specified day
    let daysUntilNext = (dayIndex - currentDate.day() + 7) % 7;
    if (daysUntilNext === 0) {
        // If it's the same day, check if the time has passed
        const currentHour = currentDate.hour();
        const currentMinute = currentDate.minute();

        if (currentHour > hours || (currentHour === hours && currentMinute >= minutes)) {
            // Time has passed, so move to next week
            daysUntilNext = 7;
        }
    }

    // Add the calculated days
    currentDate.add(daysUntilNext, 'days');

    // Set the time
    currentDate.set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
    });

    return currentDate.format();
}

/**
 * Get a teacher's basic details by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTeacher = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher ID is required'
            });
        }

        // Find teacher with just basic details
        const teacher = await User.findOne({
            where: {
                id,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'bio', 'timezone', 'email']
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Format response
        const formattedTeacher = {
            id: teacher.id,
            name: teacher.full_name,
            email: teacher.email,
            imageUrl: teacher.avatar || null,
            initials: getInitials(teacher.full_name),
            bio: teacher.bio || '',
            timezone: teacher.timezone
        };

        return res.status(200).json({
            status: 'success',
            data: formattedTeacher
        });

    } catch (error) {
        console.error('Error in getTeacher:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const getAllTeachers = async (req, res) => {
    try {
        // Find all active teachers with basic details
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'avatar', 'timezone', 'language']
        });

        if (!teachers || teachers.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No teachers found'
            });
        }

        // Format response
        const formattedTeachers = teachers.map(teacher => ({
            id: teacher.id,
            name: teacher.full_name,
            imageUrl: teacher.avatar || null,
            initials: getInitials(teacher.full_name),
            timezone: teacher.timezone,
            language: teacher.language
        }));

        return res.status(200).json({
            status: 'success',
            data: formattedTeachers
        });

    } catch (error) {
        console.error('Error in getAllTeachers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get weekly calendar view for a selected teacher (sales view)
 * Mirrors teacher dashboard weekly-calendar but teacher is chosen via query
 * GET /sales/weekly-calendar?teacher_id=123&type=normalClass|regularClass&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&date=YYYY-MM-DD
 */
const getWeeklyCalendarForTeacher = async (req, res) => {
    try {
        const teacherId = parseInt(req.query.teacher_id, 10);
        if (!teacherId) {
            return res.status(400).json({ status: 'error', message: 'teacher_id is required' });
        }

        const calendarType = req.query.type || 'normalClass';

        // Resolve teacher timezone for display and availability conversion
        const teacher = await User.findOne({ where: { id: teacherId }, attributes: ['id', 'timezone'] });
        const teacherTimezone = teacher?.timezone || 'UTC';

        const now = moment.utc();
        let startDate, endDate, weekDates;

        if (calendarType === 'normalClass') {
            if (req.query.start_date && req.query.end_date) {
                startDate = moment.utc(req.query.start_date).startOf('day');
                endDate = moment.utc(req.query.end_date).endOf('day');
            } else {
                const selectedDate = req.query.date ? moment.utc(req.query.date) : moment.utc();
                startDate = selectedDate.clone().startOf('day');
                endDate = selectedDate.clone().add(6, 'days').endOf('day');
            }
            weekDates = [];
            const currentDate = startDate.clone();
            while (currentDate <= endDate) {
                weekDates.push(currentDate.format('YYYY-MM-DD'));
                currentDate.add(1, 'day');
            }
        } else {
            const today = moment.utc();
            const currentWeekMonday = today.clone().startOf('isoWeek');
            weekDates = Array.from({ length: 7 }, (_, i) => currentWeekMonday.clone().add(i, 'days').format('YYYY-MM-DD'));
            startDate = moment.utc(weekDates[0]).startOf('day');
            endDate = moment.utc(weekDates[6]).endOf('day');
        }

        // Teacher holidays → blocked slot set in UTC slotKey `${YYYY-MM-DD}-${HH:mm}`
        const teacherHolidays = await TeacherHoliday.findAll({
            where: {
                user_id: teacherId,
                status:'approved',
                [Op.or]: [
                    { form_date: { [Op.between]: [startDate.format(), endDate.format()] } },
                    { to_date: { [Op.between]: [startDate.format(), endDate.format()] } },
                    { [Op.and]: [{ form_date: { [Op.lte]: startDate.format() } }, { to_date: { [Op.gte]: endDate.format() } }] },
                    { [Op.and]: [{ form_date: { [Op.lte]: endDate.format() } }, { to_date: { [Op.gte]: startDate.format() } }] }
                ]
            }
        });

        const holidayBlockedSlots = new Set();
        teacherHolidays.forEach(holiday => {
            const holidayStart = moment.utc(holiday.form_date);
            const holidayEnd = moment.utc(holiday.to_date).subtract(1, 'minute');
            const effectiveStart = moment.max(holidayStart, startDate);
            const effectiveEnd = moment.min(holidayEnd, endDate);
            const current = effectiveStart.clone();
            while (current.isBefore(effectiveEnd) || current.isSame(effectiveEnd)) {
                const dateKey = current.format('YYYY-MM-DD');
                const timeKey = current.format('HH:mm');
                if (weekDates.includes(dateKey)) {
                    holidayBlockedSlots.add(`${dateKey}-${timeKey}`);
                }
                current.add(30, 'minutes');
            }
        });

        // Normal classes in range (exclude canceled/rejected/ended), include student and active subscription
        let classes = [];
        if (calendarType === 'normalClass') {
            classes = await Class.findAll({
                where: {
                    teacher_id: teacherId,
                    meeting_start: { [Op.between]: [startDate.format(), endDate.format()] },
                    status: { [Op.notIn]: ['canceled', 'rejected', 'ended'] }
                },
                include: [{
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'avatar'],
                    include: [{
                        model: UserSubscriptionDetails,
                        as: 'UserSubscriptions',
                        attributes: ['lesson_min', 'status'],
                        where: { status: 'active' },
                        required: false
                    }]
                }],
                order: [['meeting_start', 'ASC']]
            });
        }

        // Regular classes for the teacher (always fetched)
        const regularClasses = await RegularClass.findAll({
            where: { teacher_id: teacherId },
            include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'email', 'avatar', 'timezone'],
                include: [{
                    model: UserSubscriptionDetails,
                    as: 'UserSubscriptions',
                    attributes: ['lesson_min', 'status'],
                    where: { status: 'active' },
                    required: false
                }]
            }]
        });

        // Helpers
        const getLessonDurationFromSubscription = (student) => {
            const defaultDuration = 30;
            if (!student || !student.UserSubscriptions || student.UserSubscriptions.length === 0) return defaultDuration;
            const lessonMinutes = student.UserSubscriptions[0].lesson_min;
            return !lessonMinutes || lessonMinutes <= 0 ? defaultDuration : lessonMinutes;
        };

        const convertTimeToTimezone = (timeString, fromTimezone, toTimezone) => {
            if (!timeString || fromTimezone === toTimezone) return timeString;
            try {
                const today = moment.tz(fromTimezone);
                const [h, m] = timeString.split(':').map(Number);
                const source = today.clone().set({ hour: h, minute: m, second: 0, millisecond: 0 });
                return source.clone().tz(toTimezone).format('HH:mm');
            } catch (_) {
                return timeString;
            }
        };

        const convertAvailabilityToLocalTimezone = (availabilityByDay, timezone) => {
            const localAvailabilityByDay = { mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} };
            const nowDate = new Date();
            const y = nowDate.getFullYear();
            const mo = nowDate.getMonth();
            const d = nowDate.getDate();
            Object.keys(availabilityByDay).forEach(day => {
                const dayData = availabilityByDay[day] || {};
                Object.keys(dayData).forEach(ts => {
                    if (dayData[ts] === true) {
                        const [hh, mm] = ts.split(':').map(Number);
                        const dateInUTC = new Date(Date.UTC(y, mo, d, hh, mm));
                        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
                        const parts = fmt.formatToParts(dateInUTC);
                        let lh = '', lm = '';
                        parts.forEach(p => {
                            if (p.type === 'hour') {
                                let hv = parseInt(p.value, 10);
                                if (hv === 24) hv = 0;
                                lh = hv.toString().padStart(2, '0');
                            } else if (p.type === 'minute') lm = p.value;
                        });
                        localAvailabilityByDay[day][`${lh}:${lm}`] = true;
                    }
                });
            });
            return localAvailabilityByDay;
        };

        const isDSTActive = (timezone) => {
            try {
                const nowD = new Date();
                const jan = new Date(nowD.getFullYear(), 0, 1);
                const jul = new Date(nowD.getFullYear(), 6, 1);
                const fmt = (d) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeStyle: 'long' }).format(d);
                const getOff = (s) => {
                    const m = s.match(/GMT([+-]\d{2}):(\d{2})$/);
                    if (!m) return 0;
                    return (parseInt(m[1], 10) * 60) + (parseInt(m[2], 10) * (m[1].startsWith('-') ? -1 : 1));
                };
                const janOff = getOff(fmt(jan));
                const julOff = getOff(fmt(jul));
                if (janOff === julOff) return false;
                const nowOff = getOff(fmt(nowD));
                return nowOff === Math.max(janOff, julOff);
            } catch (_) { return false; }
        };

        // Teacher availability
        const teacherAvailability = await TeacherAvailability.findOne({ where: { user_id: teacherId } });
        const availabilityByDay = {
            mon: teacherAvailability ? JSON.parse(teacherAvailability.mon || '{}') : {},
            tue: teacherAvailability ? JSON.parse(teacherAvailability.tue || '{}') : {},
            wed: teacherAvailability ? JSON.parse(teacherAvailability.wed || '{}') : {},
            thu: teacherAvailability ? JSON.parse(teacherAvailability.thu || '{}') : {},
            fri: teacherAvailability ? JSON.parse(teacherAvailability.fri || '{}') : {},
            sat: teacherAvailability ? JSON.parse(teacherAvailability.sat || '{}') : {},
            sun: teacherAvailability ? JSON.parse(teacherAvailability.sun || '{}') : {}
        };
        const localAvailabilityByDay = convertAvailabilityToLocalTimezone(availabilityByDay, teacherTimezone);

        // Process normal classes into occupied spanning slots map
        const processedClasses = await Promise.all(classes.map(async (cls) => {
            const startTime = moment.utc(cls.meeting_start);
            const endTime = moment.utc(cls.meeting_end);
            let subscriptionDuration = getLessonDurationFromSubscription(cls.Student);
            const actualDuration = moment.duration(endTime.diff(startTime)).asMinutes();
            let duration = Math.abs(actualDuration - subscriptionDuration) > 5 ? subscriptionDuration : subscriptionDuration;

            // Build student details; override for trial classes from TrialClassRegistration
            let studentDetails = {
                id: cls.Student?.id,
                name: cls.Student?.full_name || 'Student',
                email: cls.Student?.email || '',
                avatar: cls.Student?.avatar ? `https://tulkka.com${cls.Student?.avatar}` : null
            };

            if (cls.is_trial) {
                // Prefer lookup by class_id + teacher_id; fallback to demo_class_id
                let trialRegistration = await TrialClassRegistration.findOne({
                    where: { class_id: cls.id, teacher_id: teacherId }
                });
                if (!trialRegistration && cls.demo_class_id) {
                    trialRegistration = await TrialClassRegistration.findOne({ where: { id: cls.demo_class_id } });
                }
                if (trialRegistration) {
                    studentDetails = {
                        id: null,
                        name: trialRegistration.student_name || 'Trial Student',
                        email: trialRegistration.email || '',
                        avatar: null
                    };
                }
                // Default trial duration to 25 minutes (as used in teacher dashboard)
                duration = 25;
                subscriptionDuration = 25;
            }
            const spanningSlots = Array.from({ length: Math.ceil(duration / 30) }).map((_, i) => {
                const slotTime = startTime.clone().add(i * 30, 'minutes');
                return {
                    time: slotTime.format('HH:mm'),
                    date: slotTime.format('YYYY-MM-DD'),
                    isMainSlot: i === 0,
                    isContinuation: i > 0,
                    slotIndex: i,
                    totalSlots: Math.ceil(duration / 30),
                    remainingSlots: Math.ceil(duration / 30) - i - 1
                };
            });
            return {
                id: cls.id,
                time: startTime.format('HH:mm'),
                date: startTime.format('YYYY-MM-DD'),
                status: cls.status,
                is_regular_hide: cls.is_regular_hide, // expose hidden flag
                student: studentDetails,
                class_type: cls.is_trial ? 'trial' : (cls.class_type || 'regular'),
                is_trial: !!cls.is_trial,
                duration,
                duration_source: cls.is_trial ? 'default_trial' : 'subscription',
                spanning_slots: spanningSlots
            };
        }));

        const occupiedSlots = new Map();
        processedClasses.forEach(cls => {
            cls.spanning_slots.forEach(slot => {
                occupiedSlots.set(`${slot.date}-${slot.time}`, { ...cls, slot_info: slot });
            });
        });

        // Build timeSlots grid (UTC base, with local display times)
        const timeSlots = Array.from({ length: 48 }).map((_, index) => {
            const hour = Math.floor(index / 2);
            const minute = index % 2 === 0 ? '00' : '30';
            const utcTime = `${hour.toString().padStart(2, '0')}:${minute}`;
            const localTime = convertTimeToTimezone(utcTime, 'UTC', teacherTimezone);
            const referenceTime = convertTimeToTimezone(utcTime, 'UTC', 'Asia/Jerusalem');

            const slots = {};
            weekDates.forEach(date => {
                const weekday = moment(date).format('ddd').toLowerCase();
                const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][['sun','mon','tue','wed','thu','fri','sat'].indexOf(weekday)] || weekday;
                const isAvailable = localAvailabilityByDay[dayKey]?.[localTime] === true;
                const slotKey = `${date}-${utcTime}`;
                const isHolidayBlocked = holidayBlockedSlots.has(slotKey);
                const occupiedClass = occupiedSlots.get(slotKey);

                if (occupiedClass) {
                    const si = occupiedClass.slot_info;
                    slots[date] = {
                        status: 'booked',
                        available: isAvailable,
                        is_regular_hide: !!occupiedClass.is_regular_hide,
                        class_id: occupiedClass.id,
                        student: occupiedClass.student,
                        type: occupiedClass.is_trial ? 'trial' : 'regular',
                        class_type: occupiedClass.class_type,
                        duration: occupiedClass.duration,
                        duration_source: occupiedClass.duration_source,
                        is_main_slot: si.isMainSlot,
                        is_continuation: si.isContinuation,
                        slot_index: si.slotIndex,
                        total_slots: si.totalSlots,
                        remaining_slots: si.remainingSlots,
                        main_slot_time: occupiedClass.time,
                        spans_minutes: occupiedClass.duration
                    };
                } else if (isHolidayBlocked) {
                    slots[date] = { status: 'closed', available: false };
                } else {
                    slots[date] = { status: isAvailable ? 'open' : 'closed', available: isAvailable };
                }
            });

            return { time: utcTime, localTime, referenceTime, slots };
        });

        // Regular class weekly grid (teacher-timezone aware)
        const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const dayToKey = { Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed', Thursday: 'thu', Friday: 'fri', Saturday: 'sat', Sunday: 'sun' };

        const normalizeDayName = (day) => {
            if (!day) return null;
            const dl = day.toLowerCase();
            switch (dl) {
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

        const regularClassOccupiedSlots = new Map();
        const processRegularClassWithSpanning = (regClass, dayOfWeek) => {
            let duration = getLessonDurationFromSubscription(regClass.Student);
            const normalizedDay = normalizeDayName(dayOfWeek);
            if (!normalizedDay) return [];
            const dayIndex = daysOfWeek.indexOf(normalizedDay);
            if (dayIndex === -1) return [];

            const studentTimezone = regClass.Student?.timezone || regClass.timezone || 'UTC';
            const classStartTime = regClass.start_time;
            const currentWeekMonday = moment.utc().startOf('isoWeek');
            const studentDayDate = currentWeekMonday.clone().add(dayIndex, 'days');
            const studentClassDateTime = moment.tz(`${studentDayDate.format('YYYY-MM-DD')} ${classStartTime}`, 'YYYY-MM-DD HH:mm', studentTimezone);
            const teacherClassDateTime = studentClassDateTime.clone().tz(teacherTimezone);

            const spanningSlots = [];
            const slotsToSpan = Math.ceil(duration / 30);
            for (let i = 0; i < slotsToSpan; i++) {
                const slotDateTime = teacherClassDateTime.clone().add(i * 30, 'minutes');
                spanningSlots.push({
                    time: slotDateTime.format('HH:mm'),
                    localTime: slotDateTime.format('HH:mm'),
                    date: slotDateTime.format('YYYY-MM-DD'),
                    day: slotDateTime.format('dddd'),
                    isMainSlot: i === 0,
                    isContinuation: i > 0,
                    slotIndex: i,
                    totalSlots: slotsToSpan,
                    remainingSlots: slotsToSpan - i - 1
                });
            }

            const processedSlots = [];
            spanningSlots.forEach(slot => {
                processedSlots.push({
                    slot_key: `${slot.day}-${slot.time}`,
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
                    local_start_time: teacherClassDateTime.format('HH:mm'),
                    local_timezone: teacherTimezone,
                    student_timezone: studentTimezone,
                    slot_info: slot,
                    day_of_week: slot.day,
                    weekly_schedule: true,
                    original_duration: duration,
                    duration_source: 'subscription'
                });
            });
            return processedSlots;
        };

        regularClasses.forEach(regCls => {
            try {
                const processedSlots = processRegularClassWithSpanning(regCls, regCls.day);
                processedSlots.forEach(slotData => {
                    regularClassOccupiedSlots.set(slotData.slot_key, slotData);
                });
            } catch (_) {}
        });

        const regularClassDays = daysOfWeek.map(day => {
            const dayKey = dayToKey[day];
            const daySchedule = { day, slots: [] };
            for (let i = 0; i < 48; i++) {
                const hour = Math.floor(i / 2);
                const minute = i % 2 === 0 ? '00' : '30';
                const utcTime = `${hour.toString().padStart(2, '0')}:${minute}`;
                const localTime = convertTimeToTimezone(utcTime, 'UTC', teacherTimezone);
                const referenceTime = convertTimeToTimezone(utcTime, 'UTC', 'Asia/Jerusalem');
                const isAvailable = localAvailabilityByDay[dayKey]?.[localTime] === true;

                const weekDate = moment.utc().startOf('isoWeek').add(daysOfWeek.indexOf(day), 'days').format('YYYY-MM-DD');
                const holidayKey = `${weekDate}-${utcTime}`;
                const isHolidayBlocked = holidayBlockedSlots.has(holidayKey);

                const slotKey = `${day}-${localTime}`;
                const occupiedRegularClass = regularClassOccupiedSlots.get(slotKey);

                if (occupiedRegularClass) {
                    const si = occupiedRegularClass.slot_info;
                    daySchedule.slots.push({
                        time: utcTime,
                        localTime,
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
                        is_main_slot: si.isMainSlot,
                        is_continuation: si.isContinuation,
                        slot_index: si.slotIndex,
                        total_slots: si.totalSlots,
                        remaining_slots: si.remainingSlots,
                        main_slot_time: occupiedRegularClass.local_start_time,
                        spans_minutes: occupiedRegularClass.duration,
                        day_of_week: occupiedRegularClass.day_of_week,
                        weekly_schedule: occupiedRegularClass.weekly_schedule,
                        original_duration: occupiedRegularClass.original_duration,
                        display_info: {
                            show_duration_badge: si.isMainSlot && occupiedRegularClass.duration > 30,
                            show_continuation_indicator: si.isContinuation,
                            continuation_text: si.isContinuation ? `Continues... (${si.remainingSlots + 1}/${si.totalSlots})` : null,
                            main_slot_display: si.isMainSlot ? `${occupiedRegularClass.student.name} (${occupiedRegularClass.duration}min)` : `${occupiedRegularClass.student.name} - Continuing`,
                            slot_color_class: si.isMainSlot ? 'main-regular-class' : 'continuation-regular-class'
                        }
                    });
                } else if (isHolidayBlocked) {
                    daySchedule.slots.push({ time: utcTime, localTime, witTime: referenceTime, status: 'closed', available: false });
                } else {
                    daySchedule.slots.push({ time: utcTime, localTime, witTime: referenceTime, status: isAvailable ? 'open' : 'closed', available: isAvailable });
                }
            }
            return daySchedule;
        });

        const displayDate = req.query.date ? moment.utc(req.query.date) : (req.query.start_date ? moment.utc(req.query.start_date) : moment.utc());

        const subscriptionStats = {
            regular_classes_with_subscriptions: regularClasses.filter(c => c.Student?.UserSubscriptions && c.Student.UserSubscriptions.length > 0).length,
            regular_classes_without_subscriptions: regularClasses.filter(c => !c.Student?.UserSubscriptions || c.Student.UserSubscriptions.length === 0).length,
            subscription_duration_breakdown: regularClasses.reduce((acc, cls) => { const dur = getLessonDurationFromSubscription(cls.Student); acc[`${dur}min`] = (acc[`${dur}min`] || 0) + 1; return acc; }, {}),
            normal_classes_with_subscriptions: classes.filter(c => !c.is_trial && c.Student?.UserSubscriptions && c.Student.UserSubscriptions.length > 0).length,
            trial_classes: classes.filter(c => c.is_trial).length
        };

        return res.status(200).json({
            status: 'success',
            data: {
                selectedDate: displayDate.format('YYYY-MM-DD'),
                currentMonth: displayDate.format('MMMM YYYY'),
                weekDates,
                timeSlots,
                regularClasses: regularClassDays,
                calendarType,
                timezone: teacherTimezone,
                isDST: isDSTActive(teacherTimezone),
                spanning_info: {
                    slot_duration_minutes: 30,
                    supports_spanning: true,
                    duration_source: 'user_subscription_details'
                }
            }
        });
    } catch (error) {
        console.error('Error in getWeeklyCalendarForTeacher:', error);
        return res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    }
};

/**
 * Check teacher availability for a recurring 4-week schedule
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const checkRecurringAvailability = async (req, res) => {
    try {
        const {
            teacher_id,
            student_id,
            start_date,
            weekday,
            time
        } = req.body;

        if (!teacher_id || !weekday || !time) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: teacher_id, weekday, and time are required'
            });
        }

        // Get teacher info
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'timezone']
        });

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        // Get teacher availability settings
        const teacherAvailability = await TeacherAvailability.findOne({
            where: { user_id: teacher_id }
        });

        if (!teacherAvailability) {
            return res.status(400).json({
                status: 'error',
                message: 'Teacher availability settings not found'
            });
        }

        // Check if the teacher is available on the requested weekday and time
        const dayKey = weekday.toLowerCase().substring(0, 3); // e.g., 'monday' -> 'mon'

        // Make sure the day column exists in the availability table
        if (!teacherAvailability[dayKey]) {
            return res.status(400).json({
                status: 'error',
                message: `Teacher availability for ${weekday} is not set`
            });
        }

        // Parse the availability JSON for this day
        let dayAvailability;
        let isTeacherAvailableForTimeSlot = true;
        try {
            dayAvailability = JSON.parse(teacherAvailability[dayKey]);
        } catch (error) {
            console.error(`Error parsing availability for day ${dayKey}:`, error);
            return res.status(500).json({
                status: 'error',
                message: `Could not parse teacher availability for ${weekday}`
            });
        }

        // Check if the requested time is available
        if (!dayAvailability || !dayAvailability[time]) {
            isTeacherAvailableForTimeSlot = false;
        }

        // Get teacher holidays
        const teacherHolidays = await TeacherHoliday.findAll({
            where: { user_id: teacher_id ,status:'approved'}
        });
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: student_id,
                status: 'active'
            }
        });

        // Default class duration
        const classDuration = subscription.lesson_min || 60; // 60 minutes

        // Determine the starting date
        let startDate;
        if (start_date) {
            // If start_date is provided, use it
            startDate = moment.utc(start_date);
            if (!startDate.isValid()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid start_date format, please use YYYY-MM-DD'
                });
            }
        } else {
            // If start_date is not provided, calculate it based on the weekday
            const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === weekday.toLowerCase());

            if (dayIndex === -1) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid weekday provided'
                });
            }

            // Get the current date in UTC
            const now = moment.utc();
            const currentDayIndex = now.day(); // 0 = Sunday, 1 = Monday, etc.

            // Check if today is the requested day and time has already passed
            const isPastDay = currentDayIndex > dayIndex;
            const isSameDay = currentDayIndex === dayIndex;
            const [hours, minutes] = time.split(':').map(Number);
            const isPastTime = isSameDay && (now.hour() > hours || (now.hour() === hours && now.minute() >= minutes));

            // Calculate the next occurrence of the specified day
            let daysToAdd = (dayIndex - currentDayIndex + 7) % 7;
            if (isPastDay || isPastTime) {
                if (daysToAdd === 0) {
                    daysToAdd = 7;
                }
            }

            startDate = now.clone().add(daysToAdd, 'days');
        }

        // Set the time for the start date
        const [hours, minutes] = time.split(':').map(Number);
        startDate.set({
            hour: hours,
            minute: minutes,
            second: 0,
            millisecond: 0
        });

        // Generate all 4 dates in the series
        const allDates = [];
        const startDateFormatted = startDate.format();

        allDates.push({
            date: startDate.format('YYYY-MM-DD'),
            day: startDate.format('dddd'),
            time: time,
            iso_datetime: startDateFormatted,
            end_datetime: startDate.clone().add(classDuration, 'minutes').format()
        });

        // Generate the next 3 occurrences (total 4 including the start date)
        for (let i = 1; i < 4; i++) {
            const nextDate = startDate.clone().add(i * 7, 'days');
            allDates.push({
                date: nextDate.format('YYYY-MM-DD'),
                day: nextDate.format('dddd'),
                time: time,
                iso_datetime: nextDate.format(),
                end_datetime: nextDate.clone().add(classDuration, 'minutes').format()
            });
        }

        // NEW: Check subscription renewal date and lesson count if subscription exists
        let renewalDate = null;
        let leftLessons = 0;
        let totalLessonsInPlan = 0;
        let classesBeyondRenewal = [];
        let insufficientLessonsWarning = null;

        if (subscription && student_id) {
            // Use renew_date for renewal boundary; fallback to lesson_reset_at for backward compatibility
            if (subscription.renew_date) {
                renewalDate = moment(subscription.renew_date).endOf('day');
            } else if (subscription.lesson_reset_at) {
                renewalDate = moment(subscription.lesson_reset_at).endOf('day');
            }
            leftLessons = subscription.left_lessons || 0;
            totalLessonsInPlan = subscription.regularClasses || subscription.weekly_lesson || 0;

            // Check which classes are beyond renewal date
            allDates.forEach(dateInfo => {
                const classDate = moment.utc(dateInfo.iso_datetime);
                if (classDate.isAfter(renewalDate)) {
                    classesBeyondRenewal.push({
                        date: dateInfo.date,
                        time: dateInfo.time
                    });
                }
            });

            // Check if there are enough lessons for all 4 classes
            const totalLessonsNeeded = 4; // 4 weeks = 4 lessons
            const availableBonusClasses = subscription.bonus_class > 0 && 
                subscription.bonus_class !== subscription.bonus_completed_class 
                ? subscription.bonus_class - (subscription.bonus_completed_class || 0)
                : 0;
            const totalAvailableLessons = leftLessons + availableBonusClasses;

            // Only set insufficient lessons warning if there are 0 lessons available
            // If there are any lessons available (even if less than 4), allow booking with a warning
            if (totalAvailableLessons === 0) {
                insufficientLessonsWarning = {
                    requested: totalLessonsNeeded,
                    available_regular: leftLessons,
                    available_bonus: availableBonusClasses,
                    total_available: totalAvailableLessons,
                    renewal_date: renewalDate.format('YYYY-MM-DD')
                };
            } else if (totalLessonsNeeded > totalAvailableLessons) {
                // Show warning but allow booking - user can book available classes
                insufficientLessonsWarning = {
                    requested: totalLessonsNeeded,
                    available_regular: leftLessons,
                    available_bonus: availableBonusClasses,
                    total_available: totalAvailableLessons,
                    renewal_date: renewalDate.format('YYYY-MM-DD'),
                    can_book_partial: true // Flag to indicate partial booking is allowed
                };
            }
        }

        // Check availability for each date
        const availableDates = [];
        const unavailableDates = [];

        for (const dateInfo of allDates) {
            const startDateTime = moment.utc(dateInfo.iso_datetime);
            const endDateTime = moment.utc(dateInfo.end_datetime);

            let unavailabilityReason = null;
            let isSlotSelectable = true;

            // NEW: Check if class is beyond renewal date
            if (renewalDate && startDateTime.isAfter(renewalDate)) {
                unavailabilityReason = `Class is scheduled after subscription renewal date (${renewalDate.format('YYYY-MM-DD')})`;
                isSlotSelectable = false;
            }

            // FIXED: Check teacher availability for this specific time slot first
            if (!unavailabilityReason && !isTeacherAvailableForTimeSlot) {
                unavailabilityReason = `Teacher is not available on ${weekday} at ${time}`;
            }

            // Check for holiday conflicts (only if teacher is available for the time slot)
            if (!unavailabilityReason) {
                const isHoliday = teacherHolidays.some(holiday => {
                    const holidayStart = moment.utc(holiday.form_date);
                    const holidayEnd = moment.utc(holiday.to_date);
                    return startDateTime.isBetween(holidayStart, holidayEnd, null, '[]');
                });

                if (isHoliday) {
                    unavailabilityReason = 'Teacher on holiday';
                }
            }

            // Check for existing class conflicts (only if no other issues)
            if (!unavailabilityReason) {
                const conflictingClass = await Class.findOne({
                    where: {
                        teacher_id,
                        [Op.or]: [
                            {
                                meeting_start: {
                                    [Op.between]: [startDateTime.format(), endDateTime.format()]
                                }
                            },
                            {
                                meeting_end: {
                                    [Op.between]: [startDateTime.format(), endDateTime.format()]
                                }
                            }
                        ],
                        status: {
                            [Op.notIn]: ['canceled', 'rejected']
                        }
                    }
                });

                if (conflictingClass) {
                    unavailabilityReason = 'Teacher has another class scheduled';
                }
            }

            // Update selectable flag
            dateInfo.selectable = isSlotSelectable && !unavailabilityReason;

            // Categorize the date based on availability
            if (unavailabilityReason) {
                unavailableDates.push({
                    ...dateInfo,
                    reason: unavailabilityReason,
                    available: false
                });
            } else {
                availableDates.push({
                    ...dateInfo,
                    available: true
                });
            }
        }

        // FIXED: Determine overall status and availability
        const totalClasses = 4;
        const availableCount = availableDates.length;
        const unavailableCount = unavailableDates.length;
        
        let status = 'success';
        let message = '';
        let isAvailable = true;

        if (unavailableCount === 0) {
            status = 'success';
            message = 'Teacher is available for all 4 classes.';
            isAvailable = true;
        } else if (unavailableCount === totalClasses) {
            status = 'error';
            message = 'Teacher is fully unavailable for the selected period.';
            isAvailable = false;
        } else {
            status = 'partial';
            message = `Teacher is available for ${availableCount} out of ${totalClasses} classes.`;
            isAvailable = false; // FIXED: Set to false when there are unavailable dates
        }

        // NEW: Build response with validation warnings
        const responseData = {
            teacher: {
                id: teacher.id,
                name: teacher.full_name,
                timezone: teacher.timezone
            },
            recurrence_info: {
                weekday: weekday,
                time: time,
                total_classes: totalClasses,
                available_count: availableCount,
                unavailable_count: unavailableCount
            },
            available_dates: availableDates,
            unavailable_dates: unavailableDates,
            is_available: isAvailable
        };

        // NEW: Add validation warnings if subscription exists
        if (subscription && student_id) {
            const totalAvailableLessons = leftLessons + (subscription.bonus_class > 0 && 
                subscription.bonus_class !== subscription.bonus_completed_class 
                ? subscription.bonus_class - (subscription.bonus_completed_class || 0)
                : 0);
            
            responseData.subscription_validation = {
                renewal_date: renewalDate ? renewalDate.format('YYYY-MM-DD') : null,
                left_lessons: leftLessons,
                total_lessons_in_plan: totalLessonsInPlan,
                classes_beyond_renewal: classesBeyondRenewal,
                insufficient_lessons: insufficientLessonsWarning,
                can_book_all_classes: classesBeyondRenewal.length === 0 && !insufficientLessonsWarning,
                // Can book available classes if: (1) there are available dates AND (2) there are lessons available (> 0)
                can_book_available_classes: availableCount > 0 && totalAvailableLessons > 0
            };

            // Update status and message if there are validation issues
            if (classesBeyondRenewal.length > 0 || insufficientLessonsWarning) {
                // Only change status to error if there are 0 lessons available
                // Otherwise, keep it as partial/success to allow booking
                if (insufficientLessonsWarning && insufficientLessonsWarning.total_available === 0) {
                    status = 'error';
                    message = 'Cannot book classes: No lessons available. Please wait for subscription renewal.';
                    isAvailable = false;
                } else {
                    if (status === 'success') {
                        status = 'partial';
                    }
                    
                    let warningMessages = [];
                    if (classesBeyondRenewal.length > 0) {
                        warningMessages.push(`${classesBeyondRenewal.length} class(es) are scheduled after renewal date`);
                    }
                    if (insufficientLessonsWarning) {
                        if (insufficientLessonsWarning.total_available > 0) {
                            warningMessages.push(`Only ${insufficientLessonsWarning.total_available} lesson(s) available, but ${insufficientLessonsWarning.requested} needed. You can book ${insufficientLessonsWarning.total_available} class(es) now.`);
                        } else {
                            warningMessages.push(`No lessons available. ${insufficientLessonsWarning.requested} needed.`);
                        }
                    }
                    
                    if (warningMessages.length > 0) {
                        message += ` Warning: ${warningMessages.join('. ')}.`;
                    }
                }
            }
        }

        return res.status(200).json({
            status: status,
            message: message,
            data: responseData
        });
    } catch (error) {
        console.error('Error in checkRecurringAvailability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all regular classes with filtering, sorting and pagination - INTEGRATED FROM ADMIN SIDE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllRegularClasses = async (req, res) => {
    try {
        const {
            student_id,
            teacher_id,
            day,
            page = 1,
            limit = 10,
            sort_by = 'created_at',
            sort_order = 'desc',
            search
        } = req.query;

        // Parse + clamp paging
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

        // Allowlisted sorting (match table columns)
        const allowedSortBy = new Set(['created_at', 'day', 'start_time', 'end_time', 'id']);
        const safeSortBy = allowedSortBy.has(String(sort_by)) ? String(sort_by) : 'created_at';
        const safeSortOrder = String(sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // Build where
        const where = {};
        if (student_id) where.student_id = parseInt(student_id, 10);
        if (teacher_id) where.teacher_id = parseInt(teacher_id, 10);
        if (day) where.day = String(day);

        // Server-side search on joined Student/Teacher
        const trimmedSearch = typeof search === 'string' ? search.trim() : '';
        if (trimmedSearch) {
            where[Op.or] = [
                { ['$Student.full_name$']: { [Op.like]: `%${trimmedSearch}%` } },
                { ['$Student.email$']: { [Op.like]: `%${trimmedSearch}%` } },
                { ['$Teacher.full_name$']: { [Op.like]: `%${trimmedSearch}%` } },
                { ['$Teacher.email$']: { [Op.like]: `%${trimmedSearch}%` } },
            ];
        }

        // Joins — keep required:false so OR over associations works
        const include = [
            {
                model: User,
                as: 'Student',
                required: false,
                // attributes: ['id', 'full_name', 'email'],
            },
            {
                model: User,
                as: 'Teacher',
                required: false,
                // attributes: ['id', 'full_name', 'email'],
            },
        ];

        const offset = (pageNum - 1) * limitNum;
        const order = [[safeSortBy, safeSortOrder]];

        const { count, rows } = await RegularClass.findAndCountAll({
            where,
            include,
            limit: limitNum,
            offset,
            order,
            distinct: true,   // correct count with joins
            subQuery: false,  // enables $alias$ in where
        });

        const data = rows.map((cls) => {
            let phoneNumber = '';
            if (cls.Student && cls.Student.mobile) {
                const cleanMobile = String(cls.Student.mobile).split('+')[0].trim();

                if (cls.Student.country_code) {
                    const cleanCode = cls.Student.country_code.replace(/\+/g, '').trim();
                    phoneNumber = `+${cleanCode}${cleanMobile}`;
                } else {
                    phoneNumber = cleanMobile;
                }
            }

            // Clean the email
            const rawEmail = cls.Student ? cls.Student.email : 'Unknown';
            const cleanedEmail = cleanEmail(rawEmail);

            return {
                id: cls.id,
                student: {
                    id: cls.student_id,
                    name: cls.Student ? cls.Student.full_name : 'Unknown',
                    email: cleanedEmail, // ← CLEANED EMAIL
                    phone: phoneNumber // ← PHONE NUMBER
                },
                teacher: {
                    id: cls.teacher_id,
                    name: cls.Teacher ? cls.Teacher.full_name : 'Unknown',
                    email: cls.Teacher ? cls.Teacher.email : 'Unknown'
                },
                day: cls.day,
                start_time: cls.start_time,
                end_time: cls.end_time,
                timezone: cls.timezone,
                batch_id: cls.batch_id,
                created_at: cls.created_at,
                student_lesson_reset_at: cls.student_lesson_reset_at,
                updated_at: cls.updated_at
            };
        });

        const totalPages = Math.ceil(count / limitNum);

        return res.status(200).json({
            status: 'success',
            data,
            meta: {
                total: count,
                page: pageNum,
                limit: limitNum,
                total_pages: totalPages,
                has_next_page: pageNum < totalPages,
                has_prev_page: pageNum > 1,
            },
        });
    } catch (error) {
        console.error('Error in getAllRegularClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get a single regular class by ID - INTEGRATED FROM ADMIN SIDE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRegularClass = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Regular class ID is required'
            });
        }

        // Find the regular class with includes for student and teacher
        const regularClass = await RegularClass.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone'],
                    required: false
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone'],
                    required: false
                }
            ]
        });

        if (!regularClass) {
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        // Find any related classes by batch_id (if available)
        let relatedClasses = [];
        if (regularClass.batch_id) {
            const classes = await Class.findAll({
                where: {
                    student_id: regularClass.student_id,
                    teacher_id: regularClass.teacher_id
                    // Filter by batch_id if it's in your Class model
                    // batch_id: regularClass.batch_id
                },
                order: [['meeting_start', 'ASC']],
                limit: 10 // Limit to avoid too much data
            });

            relatedClasses = classes.map(cls => ({
                id: cls.id,
                meeting_start: cls.meeting_start,
                meeting_end: cls.meeting_end,
                status: cls.status
            }));
        }

        // Format the response
        const formattedClass = {
            id: regularClass.id,
            student: {
                id: regularClass.student_id,
                name: regularClass.Student ? regularClass.Student.full_name : 'Unknown',
                email: regularClass.Student ? regularClass.Student.email : 'Unknown',
                timezone: regularClass.Student ? regularClass.Student.timezone : null
            },
            teacher: {
                id: regularClass.teacher_id,
                name: regularClass.Teacher ? regularClass.Teacher.full_name : 'Unknown',
                email: regularClass.Teacher ? regularClass.Teacher.email : 'Unknown',
                timezone: regularClass.Teacher ? regularClass.Teacher.timezone : null
            },
            day: regularClass.day,
            start_time: regularClass.start_time,
            end_time: regularClass.end_time,
            timezone: regularClass.timezone,
            batch_id: regularClass.batch_id,
            student_lesson_reset_at: regularClass.student_lesson_reset_at,
            created_at: regularClass.created_at,
            updated_at: regularClass.updated_at,
            related_classes: relatedClasses
        };

        return res.status(200).json({
            status: 'success',
            data: formattedClass
        });
    } catch (error) {
        console.error('Error in getRegularClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete a regular class by ID - INTEGRATED FROM ADMIN SIDE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteRegularClass = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { cancel_future_classes = false } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Regular class ID is required'
            });
        }

        // Start a transaction
        transaction = await sequelize.transaction();

        // Find the regular class
        const regularClass = await RegularClass.findByPk(id, { transaction });

        if (!regularClass) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        let canceledClassesCount = 0;
        let bonusClassesCanceled = 0;
        let regularClassesCanceled = 0;

        // If requested, cancel any future classes associated with this regular class
        if (cancel_future_classes) {
            const now = moment.utc();
            
            // Build where clause (do NOT rely on batch_id in classes table)
            const whereClause = {
                student_id: regularClass.student_id,
                teacher_id: regularClass.teacher_id,
                meeting_start: {
                    [Op.gt]: now.format()
                },
                status: {
                    [Op.notIn]: ['canceled', 'rejected']
                }
            };
            
            // Find all future classes for this student, teacher, and optionally batch_id
            const futureDayClasses = await Class.findAll({
                where: whereClause,
                transaction
            });

            // Filter classes that match the day of week AND time (pattern match)
            const classesToCancel = futureDayClasses.filter(cls => {
                const classDay = moment.utc(cls.meeting_start).format('dddd');
                const dayMatches = classDay.toLowerCase() === regularClass.day.toLowerCase();

                // Always match by time to uniquely identify the pattern (handles classes without batch_id)
                if (dayMatches && regularClass.start_time) {
                    const classTime = moment.utc(cls.meeting_start);
                    const classTimeStr = classTime.format('HH:mm');
                    
                    // Convert regular class time from student timezone to UTC for comparison
                    const studentTimezone = regularClass.timezone || 'UTC';
                    const regularClassTimeInUTC = momentTz.tz(
                        `${classTime.format('YYYY-MM-DD')} ${regularClass.start_time}`,
                        'YYYY-MM-DD HH:mm',
                        studentTimezone
                    ).utc().format('HH:mm');
                    
                    // Match if times are the same (within same hour:minute)
                    return classTimeStr === regularClassTimeInUTC;
                }
                
                return false;
            });

            // Cancel each future class
            for (const cls of classesToCancel) {
                const wasBonusClass = cls.bonus_class === true || cls.bonus_class === 1;
                const isRegularHidden = cls.is_regular_hide === true || cls.is_regular_hide === 1;

                await cls.update({
                    status: 'canceled',
                    cancelled_by: req.user?.id,
                    cancelled_at: moment.utc().format(),
                    cancellation_reason: 'Regular class pattern deleted by sales team'
                }, { transaction });

                canceledClassesCount++;

                // If the class is marked as hidden regular, do not add lessons back
                if (!isRegularHidden) {
                    if (wasBonusClass) {
                        bonusClassesCanceled++;
                    } else {
                        regularClassesCanceled++;
                    }
                }
            }
        }

        // Get student info for logging
        const student = await User.findByPk(regularClass.student_id, {
            attributes: ['id', 'full_name'],
            transaction
        });

        // Store regular class data for logging before deletion
        const regularClassDataSnapshot = {
            id: regularClass.id,
            student_id: regularClass.student_id,
            teacher_id: regularClass.teacher_id,
            day: regularClass.day,
            start_time: regularClass.start_time,
            timezone: regularClass.timezone,
            batch_id: regularClass.batch_id
        };

        // Delete the regular class
        await regularClass.destroy({ transaction });

        // Calculate total lessons refunded
        const totalLessonsRefunded = regularClassesCanceled + bonusClassesCanceled;

        // Log regular class pattern deletion
        classDeletionLogger.logRegularClassPatternDeletion({
            regular_class_id: regularClassDataSnapshot.id,
            student_id: regularClassDataSnapshot.student_id,
            student_name: student?.full_name || 'Unknown',
            teacher_id: regularClassDataSnapshot.teacher_id,
            day: regularClassDataSnapshot.day,
            start_time: regularClassDataSnapshot.start_time,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'sales',
            deletion_source: 'sales_panel',
            cancel_future_classes: cancel_future_classes,
            future_classes_canceled: canceledClassesCount,
            bonus_classes_canceled: bonusClassesCanceled,
            regular_classes_canceled: regularClassesCanceled,
            lessons_refunded: totalLessonsRefunded
        });

        // **REFUND LOGIC WITH BONUS CLASS HANDLING**
        if (canceledClassesCount > 0) {
            // Find the subscription for the student
            const subscription = await UserSubscriptionDetails.findOne({
                where: {
                    user_id: regularClass.student_id,
                    status: 'active'
                },
                order: [['created_at', 'DESC']],
                transaction
            });

            if (subscription) {
                const updateData = { updated_at: new Date() };

                // Refund regular lessons
                if (regularClassesCanceled > 0) {
                    updateData.left_lessons = (subscription.left_lessons || 0) + regularClassesCanceled;
                }

                // Refund bonus classes
                if (bonusClassesCanceled > 0) {
                    updateData.bonus_completed_class = Math.max((subscription.bonus_completed_class || bonusClassesCanceled) - bonusClassesCanceled, 0);
                    updateData.left_lessons = (updateData.left_lessons || subscription.left_lessons || 0) + bonusClassesCanceled;
                }

                await UserSubscriptionDetails.update(updateData, {
                    where: { id: subscription.id },
                    transaction
                });

                console.log(`Refunded lessons for student ${regularClass.student_id}:`, {
                    regular_classes_refunded: regularClassesCanceled,
                    bonus_classes_refunded: bonusClassesCanceled,
                    total_lessons_added: regularClassesCanceled + bonusClassesCanceled,
                    bonus_completed_before: subscription.bonus_completed_class,
                    bonus_completed_after: updateData.bonus_completed_class
                });
            }
        }

        // **SALES SPECIFIC LOGIC** - Update salesperson activities for cancellations
        if (req.user && req.user.role_name && req.user.role_name.includes('sales') && canceledClassesCount > 0) {
            // Create a cancellation record for sales tracking.
            // NOTE: Use existing short action_type value to avoid DB truncation issues.
            await Salesperson.create({
                user_id: req.user.id,
                role_type: req.user.role_type || 'sales_role',
                action_type: 'regular_class',
                student_id: regularClass.student_id,
                subscription_id: null, // No specific subscription for cancellation
                meeting_type: 'online',
                appointment_time: moment.utc().format(),
                appointment_duration: 0,
                success_status: 'cancelled',
                total_classes_cancelled: canceledClassesCount,
                bonus_classes_cancelled: bonusClassesCanceled,
                regular_classes_cancelled: regularClassesCanceled,
                cancellation_reason: 'Regular class pattern deleted',
                refund_processed: true,
                commission_adjustment: -(regularClassesCanceled + bonusClassesCanceled) // Negative for commission reduction
            }, { transaction });
        }

        // Commit the transaction
        await transaction.commit();

        // Prepare response message with sales context
        let refundMessage = '';
        if (canceledClassesCount > 0) {
            if (bonusClassesCanceled > 0 && regularClassesCanceled > 0) {
                refundMessage = ` ${regularClassesCanceled} regular lesson${regularClassesCanceled !== 1 ? 's' : ''} and ${bonusClassesCanceled} bonus class${bonusClassesCanceled !== 1 ? 'es' : ''} have been refunded.`;
            } else if (bonusClassesCanceled > 0) {
                refundMessage = ` ${bonusClassesCanceled} bonus class${bonusClassesCanceled !== 1 ? 'es' : ''} have been refunded.`;
            } else if (regularClassesCanceled > 0) {
                refundMessage = ` ${regularClassesCanceled} lesson${regularClassesCanceled !== 1 ? 's' : ''} have been refunded.`;
            }
        }

        return res.status(200).json({
            status: 'success',
            message: 'Regular class deleted successfully.' + refundMessage,
            data: {
                id: parseInt(id),
                batch_id: regularClass.batch_id,
                canceled_classes_count: canceledClassesCount,
                regular_classes_canceled: regularClassesCanceled,
                bonus_classes_canceled: bonusClassesCanceled,
                lessons_added_to_subscription: (regularClassesCanceled + bonusClassesCanceled) > 0,
                // SALES SPECIFIC METRICS
                sales_impact: {
                    sales_person_id: req.user?.id,
                    commission_affected_classes: canceledClassesCount,
                    bonus_commission_lost: bonusClassesCanceled,
                    regular_commission_lost: regularClassesCanceled,
                    refund_amount: canceledClassesCount * (0), // Would need lesson price calculation
                    cancellation_recorded: req.user?.role_name?.includes('sales') || false
                }
            }
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error in deleteRegularClass:', error);
        
        // Log deletion error
        classDeletionLogger.logRegularClassPatternDeletion({
            regular_class_id: req.params.id ? parseInt(req.params.id) : null,
            student_id: null,
            student_name: 'Unknown',
            teacher_id: null,
            day: null,
            start_time: null,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'sales',
            deletion_source: 'sales_panel',
            error_details: {
                error_type: 'deletion_exception',
                error_message: error.message,
                error_stack: error.stack
            }
        });
        
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Export regular classes to CSV format - INTEGRATED FROM ADMIN SIDE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const exportRegularClasses = async (req, res) => {
    try {
    const { student_id, teacher_id, day } = req.query;

        // Build the query conditions
        const where = {};
        if (student_id) where.student_id = student_id;
        if (teacher_id) where.teacher_id = teacher_id;
        if (day) where.day = day;

        // Fetch regular classes with includes for student and teacher
        const regularClasses = await RegularClass.findAll({
            where,
            include: [
                {
                    model: User,
          as: "Student",
          attributes: ["id", "full_name", "email", "mobile", "country_code", "timezone"],
                },
                {
                    model: User,
          as: "Teacher",
          attributes: ["id", "full_name", "email", "timezone"],
          required: false,
        },
            ],
      order: [["created_at", "DESC"]],
        });

        // If no classes found, return empty CSV
        if (!regularClasses || regularClasses.length === 0) {
            return res.status(404).json({
        status: "error",
        message: "No regular classes found with the specified criteria",
            });
        }

        // Helper function to escape CSV values
        const escapeCSVValue = (value) => {
      if (value === null || value === undefined) return "";
            const stringValue = String(value);
      if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        };

    // Format data for CSV
    const csvData = regularClasses.map((cls) => {
    let phoneNumber = '';
    if (cls.Student && cls.Student.mobile) {
        const cleanMobile = String(cls.Student.mobile).split('+')[0].trim();
        const code = String(cls.Student.country_code || '')
            .replace(/\+/g, '')
            .trim();
        const formatted = code ? `+${code}${cleanMobile}` : cleanMobile;
        phoneNumber = `${formatted}`; 
    }


      return {
        ID: cls.id,
        "Student Name": cls.Student ? cls.Student.full_name : "Unknown",
        "Student Email": cls.Student ? cleanEmail(cls.Student.email) : "Unknown",
        "Phone Number": phoneNumber,
        "Teacher Name": cls.Teacher ? cls.Teacher.full_name : "Unknown",
        "Teacher Email": cls.Teacher ? cls.Teacher.email : "Unknown",
        Day: cls.day,
        "Start Time": cls.start_time,
        "End Time": cls.end_time,
        Timezone: cls.timezone || "UTC",
        "Batch ID": cls.batch_id || "",
        "Created At": cls.created_at ? new Date(cls.created_at).toISOString() : "",
        "Updated At": cls.updated_at ? new Date(cls.updated_at).toISOString() : "",
        "Lesson Reset At": cls.student_lesson_reset_at
          ? new Date(cls.student_lesson_reset_at).toISOString()
          : "",
      };
    });

        // CSV headers
    const headers = Object.keys(csvData[0]);
    let csv = headers.map(escapeCSVValue).join(",") + "\n";
        
    // Add each row
    csvData.forEach((row) => {
      const values = headers.map((h) => escapeCSVValue(row[h]));
      csv += values.join(",") + "\n";
        });

        // Set response headers for file download
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `regular-classes-${timestamp}.csv`;
        
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "text/csv");
        
        // Send the CSV data
        return res.status(200).send(csv);
    } catch (error) {
    console.error("Error in exportRegularClasses:", error);
        return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: error.message,
        });
    }
};

/**
 * Helper function to check if a time slot is available
 * @param {number} teacherId - Teacher ID
 * @param {moment} startTime - Start time (moment object)
 * @param {moment} endTime - End time (moment object) 
 * @param {Object} transaction - Sequelize transaction
 * @returns {boolean} True if available, false if not
 */
async function isTimeSlotAvailable(teacherId, startTime, endTime, transaction) {
    // Check for existing classes
    const conflictingClass = await Class.findOne({
        where: {
            teacher_id: teacherId,
            [Op.or]: [
                {
                    meeting_start: {
                        [Op.between]: [startTime.format(), endTime.format()]
                    }
                },
                {
                    meeting_end: {
                        [Op.between]: [startTime.format(), endTime.format()]
                    }
                }
            ],
            status: {
                [Op.notIn]: ['canceled', 'rejected']
            }
        },
        transaction
    });

    if (conflictingClass) {
        return false;
    }

    // Check teacher availability
    const dayName = startTime.format('dddd');
    const dayKey = dayName.toLowerCase().substring(0, 3);
    const timeStr = startTime.format('HH:mm');

    const teacherAvailability = await TeacherAvailability.findOne({
        where: { user_id: teacherId },
        transaction
    });

    if (!teacherAvailability || !teacherAvailability[dayKey]) {
        return false;
    }

    try {
        const dayAvailability = JSON.parse(teacherAvailability[dayKey]);
        if (!dayAvailability || !dayAvailability[timeStr]) {
            return false;
        }
    } catch (error) {
        console.error(`Error parsing availability for day ${dayKey}:`, error);
        return false;
    }

    // Check for holidays
    const teacherHolidays = await TeacherHoliday.findAll({
        where: { user_id: teacherId,status:'approved' },
        transaction
    });

    const isHoliday = teacherHolidays.some(holiday => {
        const holidayStart = moment.utc(holiday.form_date);
        const holidayEnd = moment.utc(holiday.to_date);
        return startTime.isBetween(holidayStart, holidayEnd, null, '[]');
    });

    if (isHoliday) {
        return false;
    }

    return true;
}

/**
 * Helper function to get the next N occurrences of a day and time
 * @param {string} day - Day of the week (e.g., 'Monday')
 * @param {string} time - Time in HH:MM format
 * @param {number} count - Number of occurrences to generate
 * @returns {Array} Array of ISO datetime strings
 */
function getNextOccurrences(day, time, count) {
    const occurrences = [];
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === day.toLowerCase());

    if (dayIndex === -1) {
        throw new Error(`Invalid day: ${day}`);
    }

    // Parse the time
    const [hours, minutes] = time.split(':').map(Number);

    // Start from today
    let currentDate = moment.utc();
    const todayIndex = currentDate.day();

    // Check if today's day has already passed for this week
    const isSameDay = todayIndex === dayIndex;
    const isPastDay = todayIndex > dayIndex;

    // If today is the requested day, check if the time has already passed
    const isSameDayButPastTime = isSameDay &&
        (currentDate.hour() > hours ||
            (currentDate.hour() === hours && currentDate.minute() > minutes));

    if (isPastDay || isSameDayButPastTime) {
        // This week's occurrence has passed, start from next week
        const daysToAdd = (dayIndex - todayIndex + 7) % 7;
        currentDate.add(daysToAdd, 'days');
    } else {
        // Today is before or equal to the target day (and time hasn't passed)
        const daysToAdd = (dayIndex - todayIndex + 7) % 7;
        currentDate.add(daysToAdd, 'days');
    }

    // Set the time for the first occurrence
    currentDate.set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
    });

    // Add the first occurrence
    occurrences.push(currentDate.format());

    // Generate the remaining occurrences (always 4 weeks total)
    for (let i = 1; i < count; i++) {
        currentDate.add(7, 'days');
        occurrences.push(currentDate.format());
    }

    return occurrences;
}

/**
 * Helper function to get the next occurrence of a specific day and time
 * @param {string} day - Day of the week (e.g., 'Monday')
 * @param {string} time - Time in HH:MM format
 * @returns {string} ISO datetime string
 */
function getNextDayTime(day, time) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === day.toLowerCase());

    if (dayIndex === -1) {
        throw new Error(`Invalid day: ${day}`);
    }

    // Parse the time
    const [hours, minutes] = time.split(':').map(Number);

    // Start from today
    let currentDate = moment.utc();

    // Calculate days until the next occurrence of the specified day
    let daysUntilNext = (dayIndex - currentDate.day() + 7) % 7;
    if (daysUntilNext === 0) {
        // If it's the same day, check if the time has passed
        const currentHour = currentDate.hour();
        const currentMinute = currentDate.minute();

        if (currentHour > hours || (currentHour === hours && currentMinute >= minutes)) {
            // Time has passed, so move to next week
            daysUntilNext = 7;
        }
    }

    // Add the calculated days
    currentDate.add(daysUntilNext, 'days');

    // Set the time
    currentDate.set({
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
    });

    return currentDate.format();
}

/**
 * Helper function to check if a time is within the selected time range
 * @param {number} timeValue - Time in minutes from midnight
 * @param {string} timeOfDay - Selected time of day (morning, noon, peak, evening)
 * @returns {boolean} True if within range, false otherwise
 */
function isTimeInSelectedRange(minutes, timeOfDay) {
    const ranges = {
        morning: [6 * 60, 11 * 60],
        noon: [11 * 60, 14 * 60 + 30],
        peak: [15 * 60, 19 * 60],
        evening: [19 * 60, 24 * 60]
    };
    if (!ranges[timeOfDay]) return true;
    const [start, end] = ranges[timeOfDay];
    return minutes >= start && minutes < end;
}


/**
 * Helper function to get teacher initials
 */
function getInitials(name) {
    return name.split(' ').map(part => part[0]).join('');
}

/**
 * Helper function to generate a random rating for demonstration
 */
function generateRandomRating() {
    return (Math.random() * 2 + 3).toFixed(1); // Random rating between 3.0 and 5.0
}

/**
 * Helper function to simulate teacher occupancy rate
 */
function getTeacherOccupancyRate(teacherId) {
    // In a real implementation, calculate based on actual booked slots
    // For this example, we're just generating a random value
    return Math.floor(Math.random() * 100);
}

const validateBookingEligibility = (subscription, selectedSlots) => {
    const totalLessonsInPlan = subscription.regularClasses || subscription.weekly_lesson || 0;
    const leftLessons = subscription.left_lessons || 0;
    const totalLessonsNeeded = selectedSlots.length * 4; // Each recurring class = 4 weeks

    // Check if subscription plan supports the requested recurring classes
    const maxRecurringClasses = Math.floor(totalLessonsInPlan / 4);
    if (selectedSlots.length > maxRecurringClasses) {
        return {
            isValid: false,
            bookingType: 'invalid',
            error: `Cannot book ${selectedSlots.length} recurring classes. Student's ${totalLessonsInPlan}-lesson plan allows maximum ${maxRecurringClasses} recurring classes.`
        };
    }

    // Determine booking type based on remaining lessons
    if (leftLessons >= totalLessonsNeeded) {
        return {
            isValid: true,
            bookingType: 'full',
            immediateClasses: totalLessonsNeeded,
            pendingClasses: 0,
            message: `All ${totalLessonsNeeded} lessons will be booked immediately.`
        };
    } else if (leftLessons > 0) {
        return {
            isValid: true,
            bookingType: 'partial',
            immediateClasses: leftLessons,
            pendingClasses: totalLessonsNeeded - leftLessons,
            message: `${leftLessons} lessons will be booked now. ${totalLessonsNeeded - leftLessons} lesson(s) cannot be booked due to insufficient remaining lessons.`
        };
    } else {
        return {
            isValid: false,
            bookingType: 'invalid',
            error: 'No lessons remaining in subscription. Please renew or add lessons before booking new classes.'
        };
    }
};

module.exports = {
    createMonthlyClasses,
    getAvailableTeachers,
    getWeeklyTeacherAvailability,
    checkClassAvailability,
    findAlternativeClasses,
    bookClasses,
    checkRecurringAvailability,
    getTeacher,
    getAllTeachers,
    getAllRegularClasses,
    getRegularClass,
    deleteRegularClass,
    exportRegularClasses,
    getWeeklyCalendarForTeacher
};