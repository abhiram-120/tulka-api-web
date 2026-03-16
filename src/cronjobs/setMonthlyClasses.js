// cron/setMonthlyClasses.js
const { sequelize } = require('../connection/connection');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import models
const RegularClass = require('../models/regularClass');
const User = require('../models/users');
const Class = require('../models/classes');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const TeacherAvailability = require('../models/teacherAvailability');
const TeacherHoliday = require('../models/teacherHoliday');
const ClassBookingFailure = require('../models/classBookingFailures');
const ClassReminder = require('../models/classReminder'); // Add this for notification tracking

// Import notification helper
const { whatsappReminderAddClass } = require('./reminder');

// Setup logging
const logsDir = path.join(__dirname, '../logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `regular-classes-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry);

    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

// Helper function for detailed cancellation logging
function logClassCancellation(cancellationType, details, additionalData = {}) {
    const timestamp = new Date().toISOString();
    const logMessage = `
=== CLASS CANCELLATION DETAILS ===
Timestamp: ${timestamp}
Cancellation Type: ${cancellationType}
Regular Class ID: ${details.regularClassId}
Student ID: ${details.studentId} (${details.studentName})
Teacher ID: ${details.teacherId} (${details.teacherName})
Attempted Class Time: ${details.attemptedStartTime} - ${details.attemptedEndTime}
Class Day: ${details.classDay}
Batch ID: ${details.batchId}
Phase: ${details.phase || 'CURRENT_CYCLE'}

--- REASON FOR CANCELLATION ---
${details.cancellationReason}

--- DETAILED ANALYSIS ---
${details.detailedAnalysis}

--- SYSTEM STATE AT TIME OF CANCELLATION ---
${details.systemState}

--- RECOMMENDATIONS ---
${details.recommendations || 'No specific recommendations available'}

--- ADDITIONAL DATA ---
${JSON.stringify(additionalData, null, 2)}
=====================================`;
    
    logToFile(logMessage, 'warn');
}

// Helper function for next month booking logging
function logNextMonthBooking(bookingType, details, additionalData = {}) {
    const timestamp = new Date().toISOString();
    const logMessage = `
=== NEXT MONTH CLASS BOOKING ===
Timestamp: ${timestamp}
Booking Type: ${bookingType}
Regular Class ID: ${details.regularClassId}
Student ID: ${details.studentId} (${details.studentName})
Teacher ID: ${details.teacherId} (${details.teacherName})
Class Time: ${details.classStartTime} - ${details.classEndTime}
Class Day: ${details.classDay}
Batch ID: ${details.batchId}
Hidden Status: ${details.isHidden ? 'YES (is_regular_hide: 1)' : 'NO (is_regular_hide: 0)'}

--- BOOKING DETAILS ---
${details.bookingDetails}

--- TEACHER AVAILABILITY ---
${details.teacherAvailabilityInfo}

--- NEXT MONTH CYCLE INFO ---
${details.nextMonthInfo}

--- ADDITIONAL DATA ---
${JSON.stringify(additionalData, null, 2)}
=====================================`;

    logToFile(logMessage, bookingType === 'SUCCESS' ? 'info' : 'warn');
}

// Helper function to ensure all values are strings (for notification parameters)
function ensureStringValues(obj) {
    const result = {};
    for (const key in obj) {
        if (obj[key] === null || obj[key] === undefined) {
            result[key] = ''; // Convert null/undefined to empty string
        } else {
            result[key] = String(obj[key]); // Convert all values to string
        }
    }
    return result;
}

// Helper function to check if a notification has been sent
async function hasDeliveredNotification(regularClassId, notifKey, transaction = null) {
    try {
        const reminders = await ClassReminder.findAll({
            where: {
                lesson_id: regularClassId,
                notif_key: notifKey,
                status: "delivered"
            },
            transaction
        });

        return reminders.length > 0;
    } catch (error) {
        logToFile(`Error checking for delivered notifications: ${error.message}`, 'error');
        return false;
    }
}

// Helper function to log a notification attempt
async function logNotificationAttempt(regularClassId, userId, notifKey, status, transaction = null) {
    try {
        await ClassReminder.create({
            lesson_id: regularClassId,
            user_id: userId,
            notif_key: notifKey,
            status: status ? "delivered" : "failed",
            type: "renewal",
            related: "subscription"
        }, { transaction });

        logToFile(`Logged notification ${notifKey} for user ${userId}, status: ${status ? 'delivered' : 'failed'}`);
    } catch (error) {
        logToFile(`Error logging notification attempt: ${error.message}`, 'error');
    }
}

// Helper function to send notifications
async function sendClassNotification(notifTemplate, options, userId, regularClassId, transaction = null) {
    // Make sure all notification params are strings
    const stringOptions = ensureStringValues(options);

    logToFile(`Sending ${notifTemplate} notification with params: ${JSON.stringify(stringOptions)}`);

    try {
        // Check if notification has already been sent
        // const alreadySent = await hasDeliveredNotification(regularClassId, notifTemplate, transaction);

        // if (alreadySent) {
        //     logToFile(`Notification ${notifTemplate} already sent to user ${userId}, skipping`);
        //     return true;
        // }

        // Send the notification
        const sent = await whatsappReminderAddClass(notifTemplate, stringOptions, userId);

        // Log the attempt
        await logNotificationAttempt(regularClassId, userId, notifTemplate, sent, transaction);

        return sent;
    } catch (error) {
        logToFile(`Error sending notification ${notifTemplate} to user ${userId}: ${error.message}`, 'error');
        return false;
    }
}

// Helper function to log booking failure to database - only one entry per regular class
async function logBookingFailure(data, transaction) {
    try {
        // Check if there's already a failure logged for this regular class
        const existingFailure = await ClassBookingFailure.findOne({
            where: {
                regular_class_id: data.regular_class_id
            },
            transaction
        });

        // If there's already a failure logged, don't create another one
        if (existingFailure) {
            logToFile(`A booking failure is already logged for regular class ID: ${data.regular_class_id}. Skipping.`);
            return;
        }

        // Create a new failure record
        await ClassBookingFailure.create({
            regular_class_id: data.regular_class_id,
            student_id: data.student_id,
            teacher_id: data.teacher_id,
            attempted_meeting_start: data.attempted_meeting_start,
            attempted_meeting_end: data.attempted_meeting_end,
            failure_reason: data.failure_reason,
            detailed_reason: data.detailed_reason,
            batch_id: data.batch_id,
            data_json: data.data_json || null
        }, { transaction });

        logToFile(`Logged booking failure: ${data.failure_reason} for regular class ${data.regular_class_id}`);
    } catch (error) {
        logToFile(`Error logging booking failure to database: ${error.message}`, 'error');
    }
}

// Flag to prevent concurrent executions
let isJobRunning = false;

/**
 * Convert day name to its index in the week (0-6, where 0 is Sunday)
 * @param {string} dayName - Day of the week (e.g., 'monday', 'tuesday', etc.)
 * @returns {number} Day index (0-6)
 */
function getDayIndex(dayName) {
    const weekdayMap = {
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
        'thursday': 4, 'friday': 5, 'saturday': 6
    };
    return weekdayMap[dayName.toLowerCase()];
}

/**
 * Sort days chronologically based on the current date
 * @param {Array} days - Array of day names to sort
 * @returns {Array} Sorted array of day names
 */
function sortDaysChronologically(days) {
    const today = moment().day(); // Current day of week (0-6)

    // Convert day names to indices and sort them
    return days
        .map(day => ({ name: day, index: getDayIndex(day) }))
        .sort((a, b) => {
            // Calculate days from today (wrapping around to next week if needed)
            let daysFromTodayA = (a.index - today + 7) % 7;
            let daysFromTodayB = (b.index - today + 7) % 7;

            // If the day is today but time has passed, move it to next week
            if (daysFromTodayA === 0) daysFromTodayA = 7;
            if (daysFromTodayB === 0) daysFromTodayB = 7;

            return daysFromTodayA - daysFromTodayB;
        })
        .map(day => day.name);
}

/**
 * Create hidden classes for next month cycle
 */
async function createNextMonthClasses(regularClass, student, teacher, subscription, sortedDays, batchId, transaction) {
    logToFile(`Starting next month hidden classes creation for regular class ID: ${regularClass.id}`);

    try {
        // Calculate next month dates
        const currentDateNextMonth = moment.utc().add(1, 'month').startOf('day');
        const renewDateNextMonth = moment.utc(subscription.lesson_reset_at).add(1, 'month');

        logToFile(`Next month period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}`);

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

        logToFile(`Found ${existingLessons.length} existing lessons to check against`);

        // Get teacher availability
        const teacherAvailability = await TeacherAvailability.findOne({
            where: { user_id: teacher.id },
            transaction
        });

        const dayIndices = sortedDays.map(day => getDayIndex(day));
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

                // Check if lesson already exists
                if (existingLessonTimes.includes(classTimeKey)) {
                    logToFile(`Skipping next month class at ${classTimeKey} - already exists`);
                    nextMonthClassesSkipped++;
                    iterationDate.add(1, 'day');
                    continue;
                }

                // Check for teacher holidays
                const isTeacherOnHoliday = await TeacherHoliday.findOne({
                    where: {
                        user_id: teacher.id,
                        status:'approved',
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
                        status:'approved',
                        [Op.and]: [
                            { form_date: { [Op.lte]: endMeetingUTC.format() } },
                            { to_date: { [Op.gte]: endMeetingUTC.format() } }
                        ]
                    },
                    transaction
                });

                if (isTeacherOnHoliday || isTeacherOnHolidayEndTime) {
                    logClassCancellation('TEACHER_HOLIDAY', {
                        regularClassId: regularClass.id,
                        studentId: student.id,
                        studentName: student.full_name,
                        teacherId: teacher.id,
                        teacherName: teacher.full_name,
                        attemptedStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                        attemptedEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                        classDay: sortedDays[dayIndices.indexOf(dayOfWeek)],
                        batchId: batchId,
                        phase: 'NEXT_MONTH_PLANNING',
                        cancellationReason: 'Teacher is on holiday during next month scheduled class time',
                        detailedAnalysis: `
• Holiday Period: ${(isTeacherOnHoliday || isTeacherOnHolidayEndTime).form_date} to ${(isTeacherOnHoliday || isTeacherOnHolidayEndTime).to_date}
• Next Month Class Start: ${startMeetingUTC.format()}
• Next Month Class End: ${endMeetingUTC.format()}
• Holiday overlaps with: ${isTeacherOnHoliday ? 'class start time' : 'class end time'}`,
                        systemState: `
• Next Month Period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}
• Classes Created So Far: ${nextMonthClassesCreated}
• Classes Skipped: ${nextMonthClassesSkipped}`,
                        recommendations: `
• Teacher should update holiday schedule
• Consider alternative scheduling for affected dates
• This will not affect current month classes`
                    });

                    nextMonthClassesSkipped++;
                    iterationDate.add(1, 'day');
                    continue;
                }

                // Check teacher availability
                let isTeacherAvailable = false;
                let availabilityAnalysis = '';

                if (teacherAvailability) {
                    const dayKey = startMeetingUTC.format('ddd').toLowerCase();
                    const startTimeSlot = startMeetingUTC.format('HH:mm');

                    try {
                        const availabilityData = JSON.parse(teacherAvailability[dayKey] || '{}');

                        if (subscription.lesson_min > 30) {
                            const nextTimeSlot = startMeetingUTC.clone().add(30, 'minutes').format('HH:mm');
                            isTeacherAvailable = availabilityData[startTimeSlot] === true &&
                                availabilityData[nextTimeSlot] === true;
                            availabilityAnalysis = `
• Day: ${dayKey} (${startMeetingUTC.format('dddd')})
• Required Slots: ${startTimeSlot} and ${nextTimeSlot}
• First Slot Available: ${availabilityData[startTimeSlot] === true ? 'YES' : 'NO'}
• Second Slot Available: ${availabilityData[nextTimeSlot] === true ? 'YES' : 'NO'}
• Lesson Duration: ${subscription.lesson_min} minutes (requires 2 slots)`;
                        } else {
                            isTeacherAvailable = availabilityData[startTimeSlot] === true;
                            availabilityAnalysis = `
• Day: ${dayKey} (${startMeetingUTC.format('dddd')})
• Required Slot: ${startTimeSlot}
• Slot Available: ${availabilityData[startTimeSlot] === true ? 'YES' : 'NO'}
• Lesson Duration: ${subscription.lesson_min} minutes`;
                        }

                        availabilityAnalysis += `
• Available Slots for ${dayKey}: ${Object.keys(availabilityData).filter(slot => availabilityData[slot] === true).join(', ') || 'None'}`;

                    } catch (error) {
                        logToFile(`Error parsing teacher availability for next month booking: ${error.message}`, 'error');
                        isTeacherAvailable = false;
                        availabilityAnalysis = 'Error parsing teacher availability data';
                    }
                } else {
                    availabilityAnalysis = 'No teacher availability schedule found';
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
                        // DETAILED LOGGING BEFORE NEXT MONTH HIDDEN CLASS CREATION
                        logToFile(`
=== NEXT MONTH HIDDEN CLASS CREATION ===
Timestamp: ${new Date().toISOString()}
Regular Class ID: ${regularClass.id}
Student: ${student.full_name} (ID: ${student.id})
Teacher: ${teacher.full_name} (ID: ${teacher.id})
Class Time: ${startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')} - ${endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')}
Student Local Time: ${classDateUserTimezone.format('YYYY-MM-DD HH:mm:ss')} (${student.timezone || 'UTC'})
Day: ${sortedDays[dayIndices.indexOf(dayOfWeek)]}
Duration: ${subscription.lesson_min} minutes
Batch ID: ${batchId}
Phase: NEXT_MONTH_PLANNING

--- VERIFICATION CHECKS PASSED ---
✅ Teacher not on holiday next month
✅ Teacher available at this time
✅ No overlapping classes found (${overlappingClasses})
✅ No existing lesson at this time
✅ Valid future time slot

--- NEXT MONTH PLANNING DETAILS ---
• Purpose: Pre-booking for next billing cycle
• Hidden status: YES (is_regular_hide: 1)
• Will be activated when subscription renews
• No subscription lessons deducted yet
• Next month period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}

--- TEACHER AVAILABILITY ---
${availabilityAnalysis}

--- CLASS CONFIGURATION ---
• Class type: Hidden (next month pre-booking)
• Zoom link enabled: ${teacher.enable_zoom_link ? 'YES' : 'NO'}
• Status: Pending (will activate on renewal)

--- NEXT STEPS ---
• Class created but hidden from student/teacher
• Will become visible when subscription renews
• Ensures seamless transition between billing cycles
================================`, 'info');

                        // Create hidden class for next month
                        const meetingData = {
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
                        };

                        const newHiddenClass = await Class.create(meetingData, { transaction });
                        nextMonthClassesCreated++;

                        logNextMonthBooking('SUCCESS', {
                            regularClassId: regularClass.id,
                            studentId: student.id,
                            studentName: student.full_name,
                            teacherId: teacher.id,
                            teacherName: teacher.full_name,
                            classStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                            classEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                            classDay: sortedDays[dayIndices.indexOf(dayOfWeek)],
                            batchId: batchId,
                            isHidden: true,
                            bookingDetails: `
• Class ID: ${newHiddenClass.id}
• Purpose: Next month pre-booking (hidden)
• Will be activated when subscription renews
• No subscription lessons deducted yet`,
                            teacherAvailabilityInfo: availabilityAnalysis,
                            nextMonthInfo: `
• Next Month Period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}
• Classes Created: ${nextMonthClassesCreated}
• Classes Skipped: ${nextMonthClassesSkipped}
• Total Existing Lessons: ${existingLessons.length}`
                        });

                        logToFile(`✅ Successfully created hidden class ID: ${newHiddenClass.id} for next month at ${startMeetingUTC.format()}`);
                    } else {
                        logNextMonthBooking('OVERLAP_CONFLICT', {
                            regularClassId: regularClass.id,
                            studentId: student.id,
                            studentName: student.full_name,
                            teacherId: teacher.id,
                            teacherName: teacher.full_name,
                            classStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                            classEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                            classDay: sortedDays[dayIndices.indexOf(dayOfWeek)],
                            batchId: batchId,
                            isHidden: false,
                            bookingDetails: `
• Overlapping Classes Found: ${overlappingClasses}
• Cannot create hidden class due to teacher conflict
• Teacher already has ${overlappingClasses} class(es) at this time`,
                            teacherAvailabilityInfo: availabilityAnalysis,
                            nextMonthInfo: `
• Next Month Period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}
• Classes Created: ${nextMonthClassesCreated}
• Classes Skipped: ${nextMonthClassesSkipped + 1}`
                        });

                        nextMonthClassesSkipped++;
                    }
                } else {
                    logClassCancellation('TEACHER_UNAVAILABLE', {
                        regularClassId: regularClass.id,
                        studentId: student.id,
                        studentName: student.full_name,
                        teacherId: teacher.id,
                        teacherName: teacher.full_name,
                        attemptedStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                        attemptedEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                        classDay: sortedDays[dayIndices.indexOf(dayOfWeek)],
                        batchId: batchId,
                        phase: 'NEXT_MONTH_PLANNING',
                        cancellationReason: 'Teacher is not available during next month scheduled class time',
                        detailedAnalysis: availabilityAnalysis,
                        systemState: `
• Teacher Availability Record: ${teacherAvailability ? 'EXISTS' : 'MISSING'}
• Next Month Planning Phase: YES
• Classes Created So Far: ${nextMonthClassesCreated}
• Classes Skipped: ${nextMonthClassesSkipped}`,
                        recommendations: `
• Update teacher availability for next month planning
• This affects future month scheduling only
• Current month classes are not impacted`
                    });

                    nextMonthClassesSkipped++;
                }
            }

            iterationDate.add(1, 'day');
        }

        logToFile(`
=== NEXT MONTH HIDDEN CLASSES SUMMARY ===
Regular Class ID: ${regularClass.id}
Student: ${student.full_name} (ID: ${student.id})
Teacher: ${teacher.full_name} (ID: ${teacher.id})
Next Month Period: ${currentDateNextMonth.format()} to ${renewDateNextMonth.format()}

--- RESULTS ---
Hidden Classes Created: ${nextMonthClassesCreated}
Classes Skipped: ${nextMonthClassesSkipped}
Total Existing Lessons: ${existingLessons.length}

--- PURPOSE ---
These hidden classes will be activated when the subscription renews next month.
No subscription lessons have been deducted yet.
Students will see these classes when their next billing cycle begins.
=====================================`);

    } catch (error) {
        logToFile(`Error creating next month hidden classes for regular class ${regularClass.id}: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    }
}

/**
 * Process regular classes and create lessons for the next billing cycle
 */
async function processRegularClasses() {
    logToFile('Starting regular classes processing');
    console.log('Starting regular classes processing');


    let transaction;

    try {
        // Get all regular classes without using associations
        const regularClasses = await RegularClass.findAll();
        logToFile(`Found ${regularClasses.length} regular classes to process`);

        // Process each regular class
        for (const regularClass of regularClasses) {
            try {
                // Fetch the teacher and student separately
                const teacher = await User.findByPk(regularClass.teacher_id, {
                    attributes: ['id', 'full_name', 'email', 'timezone', 'enable_zoom_link', 'add_zoom_link']
                });

                const student = await User.findByPk(regularClass.student_id, {
                    attributes: ['id', 'full_name', 'email', 'timezone']
                });

                // Attach them to the regularClass object
                regularClass.Teacher = teacher;
                regularClass.Student = student;

                if (!teacher || !student) {
                    logToFile(`Missing teacher or student for regular class ID: ${regularClass.id}`, 'warn');
                    continue;
                }

                transaction = await sequelize.transaction();

                // Find the active subscription for this student
                const subscription = await UserSubscriptionDetails.findOne({
                    where: {
                        user_id: regularClass.student_id,
                        status: 'active'
                    },
                    transaction
                });

                // Skip if no active subscription found
                if (!subscription) {
                    logToFile(`No active subscription found for student ID: ${regularClass.student_id}`, 'warn');

                    // Log to database
                    await logBookingFailure({
                        regular_class_id: regularClass.id,
                        student_id: regularClass.student_id,
                        teacher_id: regularClass.teacher_id,
                        attempted_meeting_start: moment.utc().format(),
                        attempted_meeting_end: moment.utc().add(60, 'minutes').format(),
                        failure_reason: 'no_active_subscription',
                        detailed_reason: 'No active subscription found for the student',
                        data_json: {
                            regularClass: {
                                id: regularClass.id,
                                day: regularClass.day
                            },
                            student: {
                                id: student.id,
                                name: student.full_name
                            },
                            teacher: {
                                id: teacher.id,
                                name: teacher.full_name
                            }
                        }
                    }, transaction);

                    await transaction.commit();
                    transaction = null;
                    continue;
                }
                const subscriptionResetAt = moment.utc(subscription.lesson_reset_at);
                const regularClassResetAt = moment.utc(regularClass.student_lesson_reset_at);
                const areDatesEqual = subscriptionResetAt.isSame(regularClassResetAt);

                // This is the main trigger to create new lessons
                if (!areDatesEqual) {

                    // Calculate dates for the billing cycle
                    const renewDate = moment.utc(subscription.lesson_reset_at);
                    const currentDate = moment.utc().startOf('day');
                    const firstDayOfMonth = moment.utc(currentDate);

                    // Parse the days from regularClass
                    // Support multiple days in comma-separated format (e.g., "monday,friday")
                    const classDays = regularClass.day.split(',').map(day => day.trim().toLowerCase());

                    // Sort days chronologically based on the current date
                    const sortedDays = sortDaysChronologically(classDays);

                    logToFile(`Regular class ID: ${regularClass.id} has days: ${sortedDays.join(', ')}`);

                    // Time and date tracking
                    let createLessonCount = 0;
                    let lessonNotCreatedCount = 0;
                    const lessonDates = [];
                    const existingLessonCount = await Class.count({
                        where: {
                            student_id: student.id,
                            teacher_id: teacher.id,
                            status: {
                                [Op.ne]: 'canceled'
                            },
                            is_regular_hide: 0
                        },
                        transaction
                    });

                    // Generate a batch ID for this set of created classes
                    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                    // Create a list of potential class dates in chronological order
                    const potentialClassDates = [];

                    // Get the day indices for each day in sortedDays
                    const dayIndices = sortedDays.map(day => getDayIndex(day));

                    // Calculate and add all potential class dates between now and renewal date
                    let iterationDate = currentDate.clone();

                    while (iterationDate.isBefore(renewDate)) {
                        const dayOfWeek = iterationDate.day(); // 0-6 (Sunday-Saturday)

                        // Check if this day is in our selected day list
                        if (dayIndices.includes(dayOfWeek)) {
                            // Use the time from regularClass for this day
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

                            const classDateUTC = classDateUserTimezone.clone().tz('UTC');

                            // Only add future dates (excluding past dates of today)
                            if (classDateUTC.isAfter(moment.utc())) {
                                potentialClassDates.push({
                                    date: classDateUTC,
                                    day: sortedDays[dayIndices.indexOf(dayOfWeek)]
                                });
                            }
                        }

                        // Move to next day
                        iterationDate.add(1, 'day');
                    }

                    // Sort potential class dates chronologically
                    potentialClassDates.sort((a, b) => a.date.diff(b.date));

                    logToFile(`Found ${potentialClassDates.length} potential class dates for regular class ID: ${regularClass.id}`);

                    // Limit to the number of lessons allowed by subscription
                    const maxLessons = subscription.left_lessons;
                    const limitedClassDates = potentialClassDates.slice(0, maxLessons);

                    logToFile(`Creating ${limitedClassDates.length} classes for regular class ID: ${regularClass.id} (limited by subscription)`);

                    // Arrays to track various booking outcomes for notification purposes
                    const successfulBookings = [];
                    const teacherUnavailableDates = [];
                    const teacherHolidayDates = [];
                    const conflictingClassDates = [];
                    const excessBookingDates = [];

                    // Check teacher availability and create classes for each potential date
                    for (const classInfo of limitedClassDates) {
                        const startMeetingUTC = classInfo.date;
                        const endMeetingUTC = startMeetingUTC.clone().add(subscription.lesson_min || 60, 'minutes');

                        // Check for teacher holidays
                        const isTeacherOnHoliday = await TeacherHoliday.findOne({
                            where: {
                                user_id: teacher.id,
                                status:'approved',
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
                                status:'approved',
                                [Op.and]: [
                                    { form_date: { [Op.lte]: endMeetingUTC.format() } },
                                    { to_date: { [Op.gte]: endMeetingUTC.format() } }
                                ]
                            },
                            transaction
                        });

                        // Check teacher availability
                        const teacherAvailability = await TeacherAvailability.findOne({
                            where: { user_id: teacher.id },
                            transaction
                        });

                        let isTeacherAvailable = false;
                        if (teacherAvailability) {
                            const dayKey = startMeetingUTC.format('ddd').toLowerCase();
                            const startTimeSlot = startMeetingUTC.format('HH:mm');

                            try {
                                const availabilityData = JSON.parse(teacherAvailability[dayKey] || '{}');

                                // For classes longer than 30 minutes, check both start time and next slot
                                if (subscription.lesson_min > 30) {
                                    const nextTimeSlot = startMeetingUTC.clone().add(30, 'minutes').format('HH:mm');
                                    isTeacherAvailable = availabilityData[startTimeSlot] === true &&
                                        availabilityData[nextTimeSlot] === true;
                                } else {
                                    isTeacherAvailable = availabilityData[startTimeSlot] === true;
                                }
                            } catch (error) {
                                logToFile(`Error parsing teacher availability for teacher ${teacher.id}: ${error.message}`, 'error');
                                isTeacherAvailable = false;
                            }
                        }

                        // Convert back to student's timezone for display
                        const meetingUserTimezone = startMeetingUTC.clone().tz(student.timezone || 'UTC');

                        // Determine if we should create a class
                        if (subscription.left_lessons > 0) {
                            // Check for teacher availability
                            if (!isTeacherOnHoliday && !isTeacherOnHolidayEndTime) {
                                if (isTeacherAvailable) {
                                    // Check for conflicts with other classes
                                    const existingClass = await Class.findOne({
                                        where: {
                                            [Op.or]: [
                                                {
                                                    [Op.and]: [
                                                        { meeting_start: { [Op.lt]: endMeetingUTC.format() } },
                                                        { meeting_end: { [Op.gt]: startMeetingUTC.format() } }
                                                    ]
                                                },
                                                {
                                                    [Op.and]: [
                                                        { meeting_start: { [Op.gte]: startMeetingUTC.format() } },
                                                        { meeting_start: { [Op.lt]: endMeetingUTC.format() } }
                                                    ]
                                                },
                                                {
                                                    [Op.and]: [
                                                        { meeting_end: { [Op.gt]: startMeetingUTC.format() } },
                                                        { meeting_end: { [Op.lte]: endMeetingUTC.format() } }
                                                    ]
                                                }
                                            ],
                                            teacher_id: teacher.id,
                                            status: { [Op.ne]: 'canceled' }
                                        },
                                        transaction
                                    });

                                    // Check for any overlapping classes (excluding the existing one if found)
                                    const overlappingClasses = await Class.count({
                                        where: {
                                            teacher_id: teacher.id,
                                            status: { [Op.ne]: 'canceled' },
                                            [Op.and]: [
                                                { meeting_start: { [Op.lt]: endMeetingUTC.format() } },
                                                { meeting_end: { [Op.gt]: startMeetingUTC.format() } }
                                            ],
                                            // Exclude the existing class from overlap count
                                            ...(existingClass ? { id: { [Op.ne]: existingClass.id } } : {})
                                        },
                                        transaction
                                    });

                                    if (!existingClass && overlappingClasses === 0) {
                                        // Create or update the class
                                        createLessonCount++;

                                        // Store for notification tracking
                                        successfulBookings.push({
                                            date: meetingUserTimezone,
                                            day: classInfo.day,
                                            formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                                        });

                                        // ENHANCED LOGGING FOR SUCCESSFUL CLASS CREATION
                                        logToFile(`
                                            === CLASS SUCCESSFULLY CREATED ===
                                            Timestamp: ${new Date().toISOString()}
                                            Regular Class ID: ${regularClass.id}
                                            Student: ${student.full_name} (ID: ${student.id})
                                            Teacher: ${teacher.full_name} (ID: ${teacher.id})
                                            Class Time: ${startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')} - ${endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')}
                                            Student Local Time: ${meetingUserTimezone.format('YYYY-MM-DD HH:mm:ss')} (${student.timezone})
                                            Day: ${classInfo.day}
                                            Duration: ${subscription.lesson_min} minutes
                                            Batch ID: ${batchId}

                                            --- VERIFICATION CHECKS PASSED ---
                                            ✅ Teacher not on holiday
                                            ✅ Teacher available at this time
                                            ✅ No conflicting classes (existing: ${!!existingClass}, overlapping: ${overlappingClasses})
                                            ✅ Subscription has lessons remaining (${subscription.left_lessons} lessons left)
                                            ✅ Valid time slot

                                            --- SUBSCRIPTION DETAILS ---
                                            • Subscription ID: ${subscription.id}
                                            • Lessons before creation: ${subscription.left_lessons}
                                            • Lessons after creation: ${subscription.left_lessons - 1}
                                            • Weekly lesson limit: ${subscription.weekly_lesson || 'N/A'}
                                            • Subscription status: ${subscription.status}

                                            --- CLASS DETAILS ---
                                            • Class type: Regular (visible)
                                            • Zoom link enabled: ${teacher.enable_zoom_link ? 'YES' : 'NO'}
                                            • Join URL: ${teacher.enable_zoom_link ? teacher.add_zoom_link : 'N/A'}

                                            --- NEXT STEPS ---
                                            • Lesson will be visible to student and teacher
                                            • Notifications will be sent according to reminder schedule
                                            • Subscription lesson count decremented
                                            ================================`, 'info');

                                        // Create a new class
                                        const newClass = await Class.create({
                                            meeting_start: startMeetingUTC.format(),
                                            meeting_end: endMeetingUTC.format(),
                                            teacher_id: teacher.id,
                                            student_id: student.id,
                                            booked_by: 'System',
                                            status: 'pending',
                                            batch_id: batchId,
                                            is_regular_hide: 0,
                                            is_trial: false,
                                            class_type: 'website',
                                            next_month_class_term: false,
                                            bonus_class: false,
                                            join_url: teacher.enable_zoom_link ? teacher.add_zoom_link : null,
                                            admin_url: teacher.enable_zoom_link ? teacher.add_zoom_link : null,
                                            subscription_id: subscription.id
                                        }, { transaction });

                                        // Decrement subscription lessons
                                        await subscription.update({
                                            left_lessons: subscription.left_lessons - 1
                                        }, { transaction });

                                        logToFile(`✅ Successfully created new class ID: ${newClass.id} at ${startMeetingUTC.format()} (${classInfo.day})`);
                                    }
                                    else if (existingClass && existingClass.student_id === student.id) {
                                        // Same student has existing class - handle appropriately
                                        createLessonCount++;

                                        successfulBookings.push({
                                            date: meetingUserTimezone,
                                            day: classInfo.day,
                                            formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                                        });

                                        if (existingClass.is_regular_hide == 1) {
                                            // DETAILED LOGGING BEFORE CONVERTING HIDDEN CLASS TO VISIBLE
                                            logToFile(`
                                            === CONVERTING HIDDEN CLASS TO VISIBLE ===
                                            Timestamp: ${new Date().toISOString()}
                                            Regular Class ID: ${regularClass.id}
                                            Existing Class ID: ${existingClass.id}
                                            Student: ${student.full_name} (ID: ${student.id})
                                            Teacher: ${teacher.full_name} (ID: ${teacher.id})
                                            Class Time: ${startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')} - ${endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')}
                                            Student Local Time: ${meetingUserTimezone.format('YYYY-MM-DD HH:mm:ss')} (${student.timezone || 'UTC'})
                                            Day: ${classInfo.day}
                                            Duration: ${subscription.lesson_min} minutes
                                            Batch ID: ${batchId}

                                            --- CONVERSION DETAILS ---
                                            • Original status: Hidden (is_regular_hide: 1)
                                            • New status: Visible (is_regular_hide: 0)
                                            • Purpose: Activating pre-booked class for current billing cycle
                                            • Previous batch ID: ${existingClass.batch_id}
                                            • New batch ID: ${batchId}

                                            --- VERIFICATION CHECKS PASSED ---
                                            ✅ Same student owns the existing class
                                            ✅ Teacher not on holiday
                                            ✅ Teacher available at this time
                                            ✅ Subscription has lessons remaining (${subscription.left_lessons} lessons left)
                                            ✅ No overlapping conflicts

                                            --- SUBSCRIPTION DETAILS ---
                                            • Subscription ID: ${subscription.id}
                                            • Lessons before activation: ${subscription.left_lessons}
                                            • Lessons after activation: ${subscription.left_lessons - 1}
                                            • Weekly lesson limit: ${subscription.weekly_lesson || 'N/A'}
                                            • Subscription status: ${subscription.status}

                                            --- CLASS ACTIVATION PROCESS ---
                                            • Converting from hidden to visible
                                            • Updating end time to match subscription duration
                                            • Assigning new batch ID for tracking
                                            • Student and teacher will now see this class

                                            --- NEXT STEPS ---
                                            • Class is now bookable and visible
                                            • Notifications will be sent according to schedule
                                            • Subscription lesson count decremented
                                            ================================`, 'info');

                                            // Update hidden class to visible
                                            await existingClass.update({
                                                meeting_end: endMeetingUTC.format(),
                                                batch_id: batchId,
                                                is_regular_hide: 0,
                                                booked_by: 'System',
                                                booked_by_admin_id: null
                                            }, { transaction });

                                            // Decrement subscription lessons
                                            await subscription.update({
                                                left_lessons: subscription.left_lessons - 1
                                            }, { transaction });

                                            logToFile(`✅ Successfully activated hidden class ID: ${existingClass.id} to visible`);
                                        } else {
                                            // DETAILED LOGGING FOR EXISTING VISIBLE CLASS
                                            logToFile(`
                                            === EXISTING VISIBLE CLASS FOUND ===
                                            Timestamp: ${new Date().toISOString()}
                                            Regular Class ID: ${regularClass.id}
                                            Existing Class ID: ${existingClass.id}
                                            Student: ${student.full_name} (ID: ${student.id})
                                            Teacher: ${teacher.full_name} (ID: ${teacher.id})
                                            Class Time: ${startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')} - ${endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC')}
                                            Student Local Time: ${meetingUserTimezone.format('YYYY-MM-DD HH:mm:ss')} (${student.timezone || 'UTC'})
                                            Day: ${classInfo.day}

                                            --- CLASS STATUS ---
                                            • Class already exists and is visible (is_regular_hide: 0)
                                            • No action needed - class is already properly scheduled
                                            • Same student owns this class
                                            • Class status: ${existingClass.status}
                                            • Batch ID: ${existingClass.batch_id}

                                            --- VERIFICATION ---
                                            ✅ Same student owns the existing class
                                            ✅ Class is already visible to student and teacher
                                            ✅ No duplicate booking created

                                            --- RESULT ---
                                            • No changes made to existing class
                                            • Counted as successful booking
                                            • Subscription lessons not double-deducted
                                            ================================`, 'info');
                                        }
                                        // If not hidden, class already exists - no action needed
                                    }
                                    else {
                                        // Conflict exists with different student or overlapping classes

                                        // Cancel any hidden classes at this conflicting time
                                        await Class.update(
                                            {
                                                status: 'canceled',
                                                canceled_by: 'booking',
                                                cancellation_reason: 'Regular class time slot not available (step two Cancel any hidden classes at this conflicting time)',
                                                cancelled_at: new Date(),
                                            },
                                            {
                                                where: {
                                                    meeting_start: startMeetingUTC.format(),
                                                    is_regular_hide: 1,
                                                    student_id: student.id,
                                                    status: 'pending',
                                                    teacher_id: teacher.id
                                                },
                                                transaction
                                            }
                                        );

                                        // Store for notification tracking
                                        conflictingClassDates.push({
                                            date: meetingUserTimezone,
                                            day: classInfo.day,
                                            formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                                        });

                                        lessonNotCreatedCount++;

                                        // Log failure to database
                                        await logBookingFailure({
                                            regular_class_id: regularClass.id,
                                            student_id: student.id,
                                            teacher_id: teacher.id,
                                            attempted_meeting_start: startMeetingUTC.format(),
                                            attempted_meeting_end: endMeetingUTC.format(),
                                            failure_reason: 'time_conflict',
                                            detailed_reason: existingClass ?
                                                'Teacher has another class scheduled at this time' :
                                                'Teacher has overlapping classes at this time',
                                            batch_id: batchId,
                                            data_json: {
                                                conflicting_class_id: existingClass?.id,
                                                overlapping_count: overlappingClasses,
                                                regularClass: {
                                                    id: regularClass.id,
                                                    day: classInfo.day
                                                },
                                                student: {
                                                    id: student.id,
                                                    name: student.full_name
                                                },
                                                teacher: {
                                                    id: teacher.id,
                                                    name: teacher.full_name
                                                },
                                                time_slot: {
                                                    start: startMeetingUTC.format(),
                                                    end: endMeetingUTC.format()
                                                }
                                            }
                                        }, transaction);

                                        logToFile(`Class conflict detected at ${startMeetingUTC.format()} - existing: ${!!existingClass}, overlapping: ${overlappingClasses}`);
                                    }
                                } else {
                                    // ENHANCED LOGGING FOR TEACHER AVAILABILITY CANCELLATION
                                    const dayKey = startMeetingUTC.format('ddd').toLowerCase();
                                    const startTimeSlot = startMeetingUTC.format('HH:mm');
                                    const availabilityData = teacherAvailability ?
                                        JSON.parse(teacherAvailability[dayKey] || '{}') : {};

                                    let availabilityAnalysis = '';
                                    if (!teacherAvailability) {
                                        availabilityAnalysis = '• No availability schedule found for this teacher';
                                    } else {
                                        const nextTimeSlot = startMeetingUTC.clone().add(30, 'minutes').format('HH:mm');
                                        availabilityAnalysis = `
• Day: ${dayKey} (${startMeetingUTC.format('dddd')})
• Required Time Slot: ${startTimeSlot}
• Slot Available: ${availabilityData[startTimeSlot] === true ? 'YES' : 'NO'}
• Lesson Duration: ${subscription.lesson_min} minutes
${subscription.lesson_min > 30 ? `• Next Time Slot (${nextTimeSlot}): ${availabilityData[nextTimeSlot] === true ? 'AVAILABLE' : 'NOT AVAILABLE'}` : ''}
• Available Slots for ${dayKey}: ${Object.keys(availabilityData).filter(slot => availabilityData[slot] === true).join(', ') || 'None'}
• All Slots for ${dayKey}: ${JSON.stringify(availabilityData)}`;
                                    }

                                    logClassCancellation('TEACHER_UNAVAILABLE', {
                                        regularClassId: regularClass.id,
                                        studentId: student.id,
                                        studentName: student.full_name,
                                        teacherId: teacher.id,
                                        teacherName: teacher.full_name,
                                        attemptedStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                        attemptedEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                        classDay: classInfo.day,
                                        batchId: batchId,
                                        phase: 'CURRENT_CYCLE',
                                        cancellationReason: 'Teacher is not available during the scheduled class time',
                                        detailedAnalysis: availabilityAnalysis,
                                        systemState: `
• Teacher Availability Record Exists: ${teacherAvailability ? 'YES' : 'NO'}
• Subscription Lesson Duration: ${subscription.lesson_min} minutes
• Requires Multiple Slots: ${subscription.lesson_min > 30 ? 'YES' : 'NO'}`,
                                        recommendations: `
• Update teacher availability to include ${startTimeSlot} on ${dayKey}
• Check if teacher can modify their schedule
• Consider moving class to an available time slot: ${teacherAvailability ? 
    Object.keys(availabilityData).filter(slot => availabilityData[slot] === true).slice(0, 3).join(', ') || 'No alternatives on this day' : 'Update teacher availability first'}`
                                    });

                                    // Teacher is not available at this time
                                    await Class.update(
                                        {
                                            status: 'canceled',
                                            canceled_by: 'booking',
                                            cancellation_reason: 'Teacher not available at this time slot (step three Teacher is not available at this time)',
                                            cancelled_at: new Date(),
                                        },
                                        {
                                            where: {
                                                meeting_start: startMeetingUTC.format(),
                                                student_id: student.id,
                                                status: 'pending',
                                                teacher_id: teacher.id
                                            },
                                            transaction
                                        }
                                    );

                                    // Store for notification tracking
                                    teacherUnavailableDates.push({
                                        date: meetingUserTimezone,
                                        day: classInfo.day,
                                        formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                                    });

                                    lessonDates.push({
                                        isTeacherAvailable: 'availability',
                                        date: meetingUserTimezone.format('DD/MM HH:mm'),
                                        day: classInfo.day
                                    });
                                    lessonNotCreatedCount++;

                                    // Log failure to database
                                    await logBookingFailure({
                                        regular_class_id: regularClass.id,
                                        student_id: student.id,
                                        teacher_id: teacher.id,
                                        attempted_meeting_start: startMeetingUTC.format(),
                                        attempted_meeting_end: endMeetingUTC.format(),
                                        failure_reason: 'teacher_unavailable',
                                        detailed_reason: 'Teacher is not available at this time slot',
                                        batch_id: batchId,
                                        data_json: {
                                            day_key: startMeetingUTC.format('ddd').toLowerCase(),
                                            time_slot: startMeetingUTC.format('HH:mm'),
                                            regularClass: {
                                                id: regularClass.id,
                                                day: classInfo.day
                                            },
                                            student: {
                                                id: student.id,
                                                name: student.full_name
                                            },
                                            teacher: {
                                                id: teacher.id,
                                                name: teacher.full_name
                                            }
                                        }
                                    }, transaction);

                                    logToFile(`Teacher ${teacher.id} not available at ${startMeetingUTC.format()}`, 'warn');
                                }
                            } else {
                                // ENHANCED LOGGING FOR TEACHER HOLIDAY CANCELLATION
                                const holidayDetails = isTeacherOnHoliday || isTeacherOnHolidayEndTime;

                                logClassCancellation('TEACHER_HOLIDAY', {
                                    regularClassId: regularClass.id,
                                    studentId: student.id,
                                    studentName: student.full_name,
                                    teacherId: teacher.id,
                                    teacherName: teacher.full_name,
                                    attemptedStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                    attemptedEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                    classDay: classInfo.day,
                                    batchId: batchId,
                                    phase: 'CURRENT_CYCLE',
                                    cancellationReason: 'Teacher is on holiday during the scheduled class time',
                                    detailedAnalysis: `
• Holiday Period: ${holidayDetails.form_date} to ${holidayDetails.to_date}
• Class Start Time: ${startMeetingUTC.format()}
• Class End Time: ${endMeetingUTC.format()}
• Holiday overlaps with: ${isTeacherOnHoliday ? 'class start time' : 'class end time'}
• Holiday ID: ${holidayDetails.id}`,
                                    systemState: `
• Subscription Status: ${subscription.status}
• Left Lessons: ${subscription.left_lessons}
• Teacher Timezone: ${teacher.timezone}
• Student Timezone: ${student.timezone}`,
                                    recommendations: `
• Contact teacher to reschedule holiday dates
• Offer alternative teacher for this time slot
• Move class to different day within the same week
• Notify student about the scheduling conflict`
                                });

                                // Teacher is on holiday
                                await Class.update(
                                    {
                                        status: 'canceled',
                                        canceled_by: 'booking',
                                        cancellation_reason: 'Teacher on holiday (step four Teacher is on holiday during this time)',
                                        cancelled_at: new Date(),
                                    },
                                    {
                                        where: {
                                            meeting_start: startMeetingUTC.format(),
                                            student_id: student.id,
                                            status: 'pending',
                                            teacher_id: teacher.id
                                        },
                                        transaction
                                    }
                                );

                                // Store for notification tracking
                                teacherHolidayDates.push({
                                    date: meetingUserTimezone,
                                    day: classInfo.day,
                                    formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                                });

                                lessonDates.push({
                                    isTeacherAvailable: 'holiday',
                                    date: meetingUserTimezone.format('DD/MM HH:mm'),
                                    day: classInfo.day
                                });
                                lessonNotCreatedCount++;

                                // Log failure to database
                                await logBookingFailure({
                                    regular_class_id: regularClass.id,
                                    student_id: student.id,
                                    teacher_id: teacher.id,
                                    attempted_meeting_start: startMeetingUTC.format(),
                                    attempted_meeting_end: endMeetingUTC.format(),
                                    failure_reason: 'teacher_holiday',
                                    detailed_reason: 'Teacher is on holiday during this time',
                                    batch_id: batchId,
                                    data_json: {
                                        regularClass: {
                                            id: regularClass.id,
                                            day: classInfo.day
                                        },
                                        student: {
                                            id: student.id,
                                            name: student.full_name
                                        },
                                        teacher: {
                                            id: teacher.id,
                                            name: teacher.full_name
                                        }
                                    }
                                }, transaction);

                                logToFile(`Teacher ${teacher.id} on holiday at ${startMeetingUTC.format()}`, 'warn');
                            }
                        } else {
                            // ENHANCED LOGGING FOR SUBSCRIPTION LIMIT CANCELLATION
                            logClassCancellation('SUBSCRIPTION_LIMIT', {
                                regularClassId: regularClass.id,
                                studentId: student.id,
                                studentName: student.full_name,
                                teacherId: teacher.id,
                                teacherName: teacher.full_name,
                                attemptedStartTime: startMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                attemptedEndTime: endMeetingUTC.format('YYYY-MM-DD HH:mm:ss UTC'),
                                classDay: classInfo.day,
                                batchId: batchId,
                                phase: 'CURRENT_CYCLE',
                                cancellationReason: 'Student subscription has no lessons remaining',
                                detailedAnalysis: `
• Subscription ID: ${subscription.id}
• Current Left Lessons: ${subscription.left_lessons}
• Original Weekly Lessons: ${subscription.weekly_lesson}
• Subscription Status: ${subscription.status}
• Last Reset Date: ${subscription.lesson_reset_at}
• Next Reset Date: ${moment(subscription.lesson_reset_at).add(1, subscription.billing_cycle || 'month').format()}
• Classes Already Created This Cycle: ${createLessonCount}
• Total Potential Classes: ${potentialClassDates.length}`,
                                systemState: `
• Subscription Type: ${subscription.billing_cycle || 'monthly'}
• Lesson Duration: ${subscription.lesson_min} minutes
• Current Billing Cycle: ${moment(subscription.lesson_reset_at).format('YYYY-MM-DD')}`,
                                recommendations: `
• Student needs to upgrade subscription or purchase additional lessons
• Send notification to student about subscription renewal
• Consider offering bonus lessons or trial extension
• Schedule remaining classes for next billing cycle`
                            });

                            // No lessons left in subscription
                            await Class.update(
                                {
                                    status: 'canceled',
                                    canceled_by: 'booking',
                                    cancellation_reason: 'No lessons left in subscription (step five No lessons left in student subscription)',
                                    cancelled_at: new Date(),
                                },
                                {
                                    where: {
                                        meeting_start: startMeetingUTC.format(),
                                        student_id: student.id,
                                        status: 'pending',
                                        teacher_id: teacher.id
                                    },
                                    transaction
                                }
                            );

                            // Store for notification tracking
                            excessBookingDates.push({
                                date: meetingUserTimezone,
                                day: classInfo.day,
                                formattedDate: meetingUserTimezone.format('DD/MM HH:mm')
                            });

                            lessonDates.push({
                                isTeacherAvailable: 'subscription',
                                date: meetingUserTimezone.format('DD/MM HH:mm'),
                                day: classInfo.day
                            });
                            lessonNotCreatedCount++;

                            // Log failure to database
                            await logBookingFailure({
                                regular_class_id: regularClass.id,
                                student_id: student.id,
                                teacher_id: teacher.id,
                                attempted_meeting_start: startMeetingUTC.format(),
                                attempted_meeting_end: endMeetingUTC.format(),
                                failure_reason: 'no_lessons_left',
                                detailed_reason: 'No lessons left in student subscription',
                                batch_id: batchId,
                                data_json: {
                                    subscription_id: subscription.id,
                                    left_lessons: subscription.left_lessons,
                                    regularClass: {
                                        id: regularClass.id,
                                        day: classInfo.day
                                    },
                                    student: {
                                        id: student.id,
                                        name: student.full_name
                                    },
                                    teacher: {
                                        id: teacher.id,
                                        name: teacher.full_name
                                    }
                                }
                            }, transaction);

                            logToFile(`No lessons left in subscription for student ${student.id}`, 'warn');
                            break; // Stop creating classes if no lessons are left
                        }
                    }

                    // This matches the PHP logic for creating hidden classes for the next month
                    try {
                        logToFile(`Starting next month hidden classes creation for regular class ID: ${regularClass.id}`);
                        await createNextMonthClasses(regularClass, student, teacher, subscription, sortedDays, batchId, transaction);
                    } catch (nextMonthError) {
                        logToFile(`Error creating next month hidden classes for regular class ID: ${regularClass.id}: ${nextMonthError.message}`, 'error');
                        // Don't stop the process if next month creation fails
                    }

                    // Update batch IDs for existing hidden classes from previous batch
                    try {
                        const updatedHiddenClasses = await Class.update(
                            { batch_id: batchId },
                            {
                                where: {
                                    student_id: regularClass.student_id,
                                    status: 'pending',
                                    batch_id: regularClass.batch_id,
                                    is_regular_hide: 1
                                },
                                transaction
                            }
                        );

                        if (updatedHiddenClasses[0] > 0) {
                            logToFile(`Updated ${updatedHiddenClasses[0]} hidden classes with new batch ID: ${batchId}`);
                        }
                    } catch (updateError) {
                        logToFile(`Error updating hidden class batch IDs: ${updateError.message}`, 'error');
                    }

                    // SUMMARY LOGGING FOR REGULAR CLASS PROCESSING
                    const successRate = limitedClassDates.length > 0 ? ((createLessonCount / limitedClassDates.length) * 100).toFixed(1) : 0;
                    
                    logToFile(`
=== REGULAR CLASS PROCESSING SUMMARY ===
Regular Class ID: ${regularClass.id}
Student: ${student.full_name} (ID: ${student.id})
Teacher: ${teacher.full_name} (ID: ${teacher.id})
Processing Time: ${new Date().toISOString()}
Batch ID: ${batchId}

--- CURRENT CYCLE STATISTICS ---
Total Potential Classes: ${limitedClassDates.length}
Successfully Created: ${createLessonCount}
Failed to Create: ${lessonNotCreatedCount}
Success Rate: ${successRate}%

--- FAILURE BREAKDOWN ---
Teacher Holidays: ${teacherHolidayDates.length}
Teacher Unavailable: ${teacherUnavailableDates.length}
Time Conflicts: ${conflictingClassDates.length}
Subscription Limits: ${excessBookingDates.length}

--- CLASS SCHEDULE ---
Days: ${regularClass.day}
Time: ${regularClass.start_time}
Duration: ${subscription.lesson_min} minutes

--- NEXT MONTH PREPARATION ---
Next month hidden classes have been processed
These will be activated when subscription renews

--- RECOMMENDATIONS ---
${createLessonCount === 0 ? '⚠️  NO CLASSES CREATED - Immediate attention required' : ''}
${teacherHolidayDates.length > 0 ? '📅 Review teacher holiday schedule' : ''}
${teacherUnavailableDates.length > 0 ? '⏰ Update teacher availability slots' : ''}
${conflictingClassDates.length > 0 ? '🔄 Consider rescheduling conflicting classes' : ''}
${excessBookingDates.length > 0 ? '💳 Student needs subscription renewal' : ''}
${createLessonCount === limitedClassDates.length ? '✅ All classes scheduled successfully!' : ''}
=====================================`, 
                        createLessonCount === 0 ? 'error' : (lessonNotCreatedCount > 0 ? 'warn' : 'info')
                    );

                    // Update the regular class record
                    await regularClass.update({
                        batch_id: batchId,
                        student_lesson_reset_at: subscription.lesson_reset_at
                    }, { transaction });

                    // Check if we have any potential classes left that couldn't be scheduled
                    const excessPotentialClasses = potentialClassDates.slice(maxLessons);

                    // Now send notifications based on booking results
                    try {
                        // Prepare translated day names for notifications
                        const translatedDaysWithTime = sortedDays.map(day => {
                            const startTime = regularClass.start_time;
                            // In PHP we used trans() function, here we just use the day name directly
                            // You may need to add a translation function if required
                            return `${day} at ${startTime}`;
                        });

                        const countDays = sortedDays.map(day => {
                            // Count occurrences of this day in the date range
                            const count = potentialClassDates.filter(date => date.day === day).length;
                            return `${count} ${day}`;
                        });

                        // CASE 1: Check if we have any scheduling issues to report
                        const hasTeacherAvailabilityIssues = teacherUnavailableDates.length > 0 || teacherHolidayDates.length > 0 || conflictingClassDates.length > 0;

                        if (hasTeacherAvailabilityIssues) {
                            // Combine all teacher unavailability issues into one list
                            const allTeacherIssues = [
                                ...teacherUnavailableDates.map(date => date.formattedDate || ''),
                                ...teacherHolidayDates.map(date => date.formattedDate || ''),
                                ...conflictingClassDates.map(date => date.formattedDate || '')
                            ].filter(date => date); // Remove empty strings

                            // Send notification for teacher unavailability
                            const notifyOptions = {
                                'student.name': student.full_name || '',
                                'time.day': translatedDaysWithTime.join(', ') || '',
                                'message': allTeacherIssues.join(' and ') || 'Schedule conflicts detected'
                            };

                            logToFile(`Sending renew_class_teacher_notavilableform_students notification for student ${student.id}`);

                            await sendClassNotification(
                                'renew_class_teacher_notavilableform_students',
                                notifyOptions,
                                student.id,
                                regularClass.id,
                                transaction
                            );
                        }

                        // CASE 2: Check if we have more potential classes than the subscription limit
                        if (excessPotentialClasses.length > 0 && successfulBookings.length > 0) {
                            // Format excess bookings list
                            const excessBookings = excessPotentialClasses.map(booking =>
                                booking.date ? booking.date.format('DD/MM HH:mm') : ''
                            ).filter(date => date); // Remove empty strings

                            // Send notification for excess classes
                            const notifyOptions = {
                                'student.name': student.full_name || '',
                                'time.day': translatedDaysWithTime.join(', ') || '',
                                'message': excessBookings.join(' and ') || 'Additional classes available',
                                'left.lesson': String(subscription.weekly_lesson || 0),
                                'day.count': countDays.join(', ') || ''
                            };

                            logToFile(`Sending renew_class_overclasses_form_students notification for student ${student.id}`);

                            await sendClassNotification(
                                'renew_class_overclasses_form_students',
                                notifyOptions,
                                student.id,
                                regularClass.id,
                                transaction
                            );
                        }
                        // CASE 3: All classes booked successfully (no issues)
                        else if (successfulBookings.length > 0 && !hasTeacherAvailabilityIssues) {
                            // Send notification for successful booking
                            const notifyOptions = {
                                'student.name': student.full_name || '',
                                'message': translatedDaysWithTime.join(' and ') || 'Classes scheduled successfully'
                            };

                            logToFile(`Sending renew_regular_class_booked_good notification for student ${student.id}`);

                            await sendClassNotification(
                                'renew_regular_class_booked_good',
                                notifyOptions,
                                student.id,
                                regularClass.id,
                                transaction
                            );
                        }

                    } catch (notifError) {
                        logToFile(`Error sending notifications for regular class ID: ${regularClass.id}: ${notifError.message}`, 'error');
                        // Don't stop the process if notifications fail
                    }

                    logToFile(`Processing complete for regular class ID: ${regularClass.id}`);
                    logToFile(`Created: ${createLessonCount}, Failed: ${lessonNotCreatedCount}`);
                }

                await transaction.commit();

            } catch (error) {
                if (transaction) await transaction.rollback();
                logToFile(`Error processing regular class ID: ${regularClass.id}: ${error.message}`, 'error');
                logToFile(error.stack, 'error'); // Log the full stack trace for debugging
            }
        }

        logToFile('Regular classes processing completed');

    } catch (error) {
        logToFile(`Error in processRegularClasses: ${error.message}`, 'error');
        logToFile(error.stack, 'error'); // Log the full stack trace for debugging
    }
}

// Schedule the cron job to run every minute with lock mechanism to prevent overlapping executions
cron.schedule('* * * * *', async () => {
    const startTime = new Date();
    logToFile(`Attempting to run regular classes cron job at ${startTime.toISOString()}`);

    if (isJobRunning) {
        logToFile('Previous job is still running, skipping this execution', 'warn');
        return;
    }

    isJobRunning = true;

    try {
        logToFile(`Running regular classes cron job at ${startTime.toISOString()}`);
        await processRegularClasses();
        const endTime = new Date();
        const executionTime = (endTime - startTime) / 1000; // in seconds
        logToFile(`Completed regular classes cron job at ${endTime.toISOString()}, execution time: ${executionTime.toFixed(2)}s`);
    } catch (error) {
        logToFile(`Unhandled error in cron job: ${error.message}`, 'error');
        logToFile(error.stack, 'error');
    } finally {
        isJobRunning = false;
    }
});

// Export for manual execution or testing
module.exports = {
    processRegularClasses
};