const Salesperson = require('../../models/Salesperson');
const User = require('../../models/users');
const Class = require('../../models/classes');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment');
const { validateTrialClassData } = require('../../validators/sales/trial-class.validator');
const { sequelize } = require('../../connection/connection');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialClassStatusHistory = require('../../models/TrialClassStatusHistory');
const TrialClassEvaluation = require('../../models/TrialClassEvaluation');
const SalesAgentReview = require('../../models/salesAgentReview');
const { whatsappReminderAddClass, whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { getTimezoneForCountry } = require('../../utils/countryTimezones');
const { Family, FamilyChild } = require('../../models/Family');
const { UserSubscriptionDetails } = require('../../models/UserSubscriptionDetails');
const jwt = require('jsonwebtoken');
const config = require('../../config/config');
const bcrypt = require('bcrypt');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');
const fs = require('fs');
const path = require('path');

// Setup logging for trial management
const logsDir = path.join(__dirname, '../../logs/trial-management');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function for trial management
function logTrialManagement(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logsDir, `trial-class-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    
    // Also log to console for immediate feedback
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

// Helper function for detailed trial class creation logging
function logTrialClassCreation(creationType, details, additionalData = {}) {
    const timestamp = new Date().toISOString();
    const logMessage = `
=== TRIAL CLASS CREATION DETAILS ===
Timestamp: ${timestamp}
Creation Type: ${creationType}
Trial Class ID: ${details.trialClassId}
Class ID: ${details.classId}
Student: ${details.studentName} (${details.studentEmail || details.studentMobile})
Parent: ${details.parentName || 'N/A'}
Age: ${details.studentAge}
Teacher: ${details.teacherName} (ID: ${details.teacherId})
Booked By: ${details.bookedByName} (ID: ${details.bookedById}, Role: ${details.bookedByRole})
Meeting Time: ${details.meetingStart} - ${details.meetingEnd}
Language: ${details.language}
Country Code: ${details.countryCode}
Mobile: ${details.mobile}

--- BOOKING INFORMATION ---
Booking Type: ${details.bookingType || 'N/A'}
Family ID: ${details.familyId || 'N/A'}
Child ID: ${details.childId || 'N/A'}
Lead Source: ${details.leadSource || 'N/A'}
Calls Made: ${details.callsMade || 0}
Call Duration: ${details.callDuration || 0} minutes

--- CLASS DETAILS ---
Description/Goal: ${details.description || 'N/A'}
Status: ${details.status || 'pending'}
Trial Class Status: ${details.trialClassStatus || 'trial_1'}
Zoom Link: ${details.zoomLink ? 'YES' : 'NO'}
Zoom Meeting ID: ${details.zoomMeetingId || 'N/A'}
Zoom Access Code: ${details.zoomAccessCode || 'N/A'}

--- NOTIFICATION PREFERENCES ---
WhatsApp: ${details.notificationPreferences?.whatsapp ? 'YES' : 'NO'}
Email: ${details.notificationPreferences?.email ? 'YES' : 'NO'}
WhatsApp Times: ${details.notificationPreferences?.whatsapp_times?.join(', ') || 'N/A'}

--- NOTIFICATION STATUS ---
Teacher Notification: ${details.teacherNotificationSent ? 'SENT' : 'FAILED'}
Student Notification: ${details.studentNotificationSent ? 'SENT' : 'FAILED'}

--- TIMEZONE INFORMATION ---
Teacher Timezone: ${details.teacherTimezone || 'UTC'}
Student Timezone: ${details.studentTimezone || 'UTC'}
Teacher Local Time: ${details.teacherLocalTime || 'N/A'}
Student Local Time: ${details.studentLocalTime || 'N/A'}

--- VERIFICATION CHECKS ---
${details.verificationChecks || 'N/A'}

--- ADDITIONAL DATA ---
${JSON.stringify(additionalData, null, 2)}
=====================================`;
    
    logTrialManagement(logMessage, creationType === 'SUCCESS' ? 'info' : 'warn');
}




async function createStudentOnly(req, res) {
  try {
    const { full_name, email, phone_number, password, timezone, preferred_language, age, user_type, referral_source, countryCode } = req.body;
    console.log('body',req.body);

    // ✅ Sales rep is auto-attached from token
    const salesRep = req.user;
    console.log('user',req.user);

    // Check if user already exists
    const existing = await User.findOne({
      where: { email }
    });
    
    if (existing) {
        return res.status(400).json({
            status: 'error',
            message: 'User with this email already exists'
        });
    }

    const existingUser = await User.findOne({
      where: { mobile:phone_number }
    });
    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User with this Mobile already exists'
      });
    }

    const hashpassword=await bcrypt.hash(password,10);

    // ✅ Minimal student-only creation
    const newStudent = await User.create({
      full_name,
      email,
      mobile: phone_number,
      role_name: 'user',
      role_id: 1,
      country_code: countryCode,
      password:hashpassword,
      timezone,
      language: preferred_language,
      age,
      is_parent: user_type === 'parent',
      verified: true,
      status: 'active',
      created_at: Math.floor(Date.now() / 1000),
    });

    return res.status(201).json({
      status: 'success',
      message: 'Student created successfully',
      data: newStudent,
    });

  } catch (err) {
    console.error('Error creating student:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to create student',
      err
    });
  }
}

/**
 * Create a new trial class registration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createTrialClass = async (req, res) => {
    let transaction;

    try {
        logTrialManagement('=== Starting trial class creation ===');
        logTrialManagement(`Request from user ID: ${req.user?.id}, Role: ${req.user?.role_name}`);
        logTrialManagement(`Request body: ${JSON.stringify(req.body)}`);

        // Input validation before starting transaction
        const validationError = validateTrialClassData(req.body);
        if (validationError) {
            logTrialManagement(`Validation error: ${validationError}`, 'error');
            return res.status(400).json({
                status: 'error',
                message: validationError
            });
        }

        const {
            // Basic information
            student_name,
            parent_name,
            country_code,
            mobile,
            email,
            age,
            teacher_id,
            meeting_start,    // In UTC
            meeting_end,      // In UTC
            description,
            language,
            notification_preferences,

            // Sales information
            lead_source,
            calls_made,
            call_duration,
            notes,

            // Booking information
            booked_by_role,      // sales_role, or sales_appointment_setter
            booked_by_admin_id,   // ID of the admin who booked
            booking_type,
            family_id,
            child_id
        } = req.body;

        // Start transaction
        transaction = await sequelize.transaction();
        logTrialManagement('Transaction started');

        // Check if teacher exists and is active, and get their Zoom details
        logTrialManagement(`Checking teacher ID: ${teacher_id}`);
        const teacher = await User.findOne({
            where: {
                id: teacher_id,
                role_name: 'teacher',
                status: 'active'
            },
            attributes: [
                'id',
                'full_name',
                'country_code',
                'mobile',
                'enable_zoom_link',
                'add_zoom_link',
                'add_zoom_link_meeting_id',
                'add_zoom_link_access_code',
                'timezone',
                'notification_channels'
            ],
            transaction
        });

        if (!teacher) {
            if (transaction) await transaction.rollback();
            logTrialManagement(`Teacher not found or inactive: ${teacher_id}`, 'error');
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found or inactive'
            });
        }

        logTrialManagement(`Teacher found: ${teacher.full_name} (ID: ${teacher.id})`);

        // Validate teacher's Zoom setup
        if (!teacher.enable_zoom_link || !teacher.add_zoom_link) {
            if (transaction) await transaction.rollback();
            logTrialManagement(`Teacher ${teacher.id} does not have Zoom integration enabled`, 'error');
            return res.status(400).json({
                status: 'error',
                message: 'Teacher does not have Zoom integration enabled'
            });
        }

        logTrialManagement(`Teacher Zoom setup validated for teacher ID: ${teacher.id}`);

        // Parse UTC times
        const startTime = moment.utc(meeting_start);
        const endTime = moment.utc(meeting_end);
        logTrialManagement(`Meeting time: ${startTime.format()} to ${endTime.format()}`);

        // Validate class duration (must be 25 minutes)
        const duration = moment.duration(endTime.diff(startTime)).asMinutes();
        logTrialManagement(`Class duration: ${duration} minutes`);
        if (duration !== 25) {
            if (transaction) await transaction.rollback();
            logTrialManagement(`Invalid duration: ${duration} minutes (expected 25)`, 'error');
            return res.status(400).json({
                status: 'error',
                message: 'Trial class must be exactly 25 minutes'
            });
        }

        // Check for existing classes
        logTrialManagement(`Checking for existing classes for teacher ${teacher_id} during time slot`);
        const existingClass = await Class.findOne({
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

        if (existingClass) {
            if (transaction) await transaction.rollback();
            logTrialManagement(`Conflict: Teacher ${teacher_id} already has class ID ${existingClass.id} scheduled during this time`, 'error');
            return res.status(409).json({
                status: 'error',
                message: 'Teacher already has a class scheduled during this time slot'
            });
        }

        logTrialManagement(`Checking for duplicate trial booking`);
        const duplicate = await TrialClassRegistration.findOne({
            where: {
                booked_by: req.user.id,
                student_name,
                teacher_id,
                meeting_start: startTime.format(),
                meeting_end: endTime.format(),
                status: 'pending'
            }
        });

        if (duplicate) {
            logTrialManagement(`Duplicate trial booking detected: ID ${duplicate.id}`, 'error');
            return res.status(409).json({
                status: 'error',
                message: 'Duplicate trial booking detected'
            });
        }

        logTrialManagement(`No conflicts found, proceeding with trial class creation`);
        // Create trial class registration first to get the ID
        logTrialManagement(`Creating trial class registration for student: ${student_name}`);
        const trialClass = await TrialClassRegistration.create({
            student_name,
            parent_name,
            country_code,
            mobile,
            email,
            age,
            teacher_id,
            booking_type,
            booked_by: req.user.id,
            family_id:family_id,
            child_id:child_id,
            notification_preferences: notification_preferences || {
                whatsapp: true,
                email: true,
                whatsapp_times: ["24", "1"]  // Default notification times
            },
            meeting_start: startTime.format(),
            meeting_end: endTime.format(),
            description,
            language: language || 'EN',
            status: 'pending'
        }, { transaction });

        logTrialManagement(`Trial class registration created: ID ${trialClass.id}`);

        // Create class entry with new fields
        logTrialManagement(`Creating class entry linked to trial class ${trialClass.id}`);
        const classEntry = await Class.create({
            student_name,
            teacher_id,
            status: 'pending',
            meeting_start: startTime.format(),
            meeting_end: endTime.format(),
            is_trial: true,
            student_goal: description,
            class_type: 'website',
            join_url: teacher.add_zoom_link,
            admin_url: teacher?.enable_zoom_link ? teacher?.add_zoom_link : null,
            zoom_id: teacher.add_zoom_link_meeting_id,
            // New booking fields
            booked_by: booked_by_role,
            booked_by_admin_id: booked_by_admin_id,
            demo_class_id: trialClass.id  // Link to the trial registration
        }, { transaction });

        logTrialManagement(`Class entry created: ID ${classEntry.id}`);

        // Update trial class with the class ID
        await trialClass.update({
            class_id: classEntry.id
        }, { transaction });

        logTrialManagement(`Trial class ${trialClass.id} linked to class ${classEntry.id}`);

        // Create salesperson activity
        logTrialManagement(`Creating salesperson activity for user ${req.user.id}`);
        await Salesperson.create({
            user_id: req.user.id,
            role_type: booked_by_role || 'sales_role',
            action_type: 'trial_class',
            class_id: classEntry.id,
            lead_source,
            calls_made: calls_made || 0,
            call_duration: call_duration || 0,
            notes,
            meeting_type: 'online',
            appointment_time: startTime.format(),
            appointment_duration: 30,
            success_status: 'successful'
        }, { transaction });

        logTrialManagement(`Salesperson activity created`);

        logTrialManagement(`Creating trial class status history`);
        await TrialClassStatusHistory.create({
            trial_class_id: trialClass.id,
            previous_status: null,
            new_status: 'trial_1',
            changed_by_id: req.user.id,
            changed_by_type: booked_by_role,
            notes: 'Initial trial class creation',
        }, { transaction });

        logTrialManagement(`Status history created`);

        // Commit transaction
        logTrialManagement(`Committing transaction`);
        await transaction.commit();
        logTrialManagement(`Transaction committed successfully`);

        // Fetch complete data after successful commit
        logTrialManagement(`Fetching complete trial class data for ID ${trialClass.id}`);
        const completeTrialClass = await TrialClassRegistration.findByPk(trialClass.id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: [
                        'id',
                        'status',
                        'join_url',
                        'zoom_id',
                        'booked_by',
                        'booked_by_admin_id',
                        'demo_class_id'
                    ]
                },
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        // Format response dates
        const responseData = {
            ...completeTrialClass.toJSON(),
            meeting_start_formatted: moment.utc(completeTrialClass.meeting_start).format(),
            meeting_end_formatted: moment.utc(completeTrialClass.meeting_end).format(),
            created_at_formatted: moment(completeTrialClass.created_at).format(),
            teacher_timezone: teacher.timezone
        };

        // Send notifications after successful commit
        logTrialManagement(`Starting notification process`);
        let teacherMessageSent = false;
        let studentMessageSent = false;
        let teacherLocalDate = '';
        let teacherLocalTime = '';
        let studentLocalDate = '';
        let studentLocalTime = '';
        
        try {
            // Get base UTC date and time
            const utcMeetingTime = moment.utc(completeTrialClass.meeting_start);
            
            // 1. Teacher notification - we need the teacher's timezone from their user record
            let teacherTz = 'UTC';
            if (teacher.timezone && moment.tz.zone(teacher.timezone)) {
                teacherTz = teacher.timezone;
            }
            
            teacherLocalDate = utcMeetingTime.clone()
                .tz(teacherTz)
                .format('YYYY-MM-DD');
                
            teacherLocalTime = utcMeetingTime.clone()
                .tz(teacherTz)
                .format('HH:mm');
                
            logTrialManagement(`Teacher timezone: ${teacherTz}, Local time: ${teacherLocalDate} ${teacherLocalTime}`);
            
            // Format teacher message with required template parameters
            const notifyOptionsTeacher = {
                'instructor.name': teacher.full_name,
                'student.parentName': parent_name || '-',
                'student.name': student_name,
                'student.age': age.toString(),
                'lesson.date': teacherLocalDate,
                'lesson.time': teacherLocalTime,
                'student.description': description !== undefined ? description : ""
            };

            // Send notification to teacher
            logTrialManagement(`Sending notification to teacher ID: ${teacher.id}`);
            teacherMessageSent = await whatsappReminderAddClass(
                'trial_class_booking_for_teacher',
                notifyOptionsTeacher,
                teacher.id
            );
            logTrialManagement(`Teacher notification ${teacherMessageSent ? 'sent successfully' : 'failed'}`);

            // 2. Student notification - using ONLY the trial class registration data
            
            // Get student timezone from country code
            const studentTz = getTimezoneForCountry(country_code);
            
            studentLocalDate = utcMeetingTime.clone()
                .tz(studentTz)
                .format('YYYY-MM-DD');
            
            studentLocalTime = utcMeetingTime.clone()
                .tz(studentTz)
                .format('HH:mm');
            
            // Create student details directly from trial class data
            const studentDetails = {
                country_code: country_code,
                mobile: mobile.replace(/[+\s]/g, ''),  // Remove + and spaces from mobile
                full_name: student_name,
                language: language || 'EN',
                email: email  // Add email to student details for email notifications
            };
            logTrialManagement(`Student details: ${JSON.stringify(studentDetails)}`);
            

            const notifyOptionsStudent = {
                'student.name': student_name,
                'time.date': `${studentLocalDate} ${studentLocalTime}`,
                'link.link': teacher.add_zoom_link,
                'meet.id': teacher.add_zoom_link_meeting_id,
                'access.code': teacher.add_zoom_link_access_code
            };

            // Send direct WhatsApp notification using trial data
            logTrialManagement(`Sending notification to student: ${student_name} (${email})`);
            studentMessageSent = await whatsappReminderTrailClass(
                'trial_class_booking',
                notifyOptionsStudent,
                studentDetails
            );
            logTrialManagement(`Student notification ${studentMessageSent ? 'sent successfully' : 'failed'}`);
        } catch (notificationError) {
            // Don't fail the whole request if notifications fail
            logTrialManagement(`Error sending notifications: ${notificationError.message}`, 'error');
            logTrialManagement(notificationError.stack, 'error');
        }

        // Detailed logging for successful trial class creation
        logTrialClassCreation('SUCCESS', {
            trialClassId: trialClass.id,
            classId: classEntry.id,
            studentName: student_name,
            studentEmail: email,
            studentMobile: mobile,
            parentName: parent_name || 'N/A',
            studentAge: age,
            teacherName: teacher.full_name,
            teacherId: teacher.id,
            bookedByName: req.user.full_name || 'System',
            bookedById: req.user.id,
            bookedByRole: booked_by_role || req.user.role_name || 'sales_role',
            meetingStart: startTime.format('YYYY-MM-DD HH:mm:ss UTC'),
            meetingEnd: endTime.format('YYYY-MM-DD HH:mm:ss UTC'),
            language: language || 'EN',
            countryCode: country_code,
            mobile: mobile,
            bookingType: booking_type,
            familyId: family_id || null,
            childId: child_id || null,
            leadSource: lead_source || 'N/A',
            callsMade: calls_made || 0,
            callDuration: call_duration || 0,
            description: description || 'N/A',
            status: 'pending',
            trialClassStatus: 'trial_1',
            zoomLink: teacher.add_zoom_link || null,
            zoomMeetingId: teacher.add_zoom_link_meeting_id || 'N/A',
            zoomAccessCode: teacher.add_zoom_link_access_code || 'N/A',
            notificationPreferences: notification_preferences || {
                whatsapp: true,
                email: true,
                whatsapp_times: ["24", "1"]
            },
            teacherNotificationSent: teacherMessageSent,
            studentNotificationSent: studentMessageSent,
            teacherTimezone: teacher.timezone || 'UTC',
            studentTimezone: getTimezoneForCountry(country_code),
            teacherLocalTime: teacherLocalDate && teacherLocalTime ? `${teacherLocalDate} ${teacherLocalTime}` : 'N/A',
            studentLocalTime: studentLocalDate && studentLocalTime ? `${studentLocalDate} ${studentLocalTime}` : 'N/A',
            verificationChecks: `
✅ Teacher exists and is active
✅ Teacher has Zoom integration enabled
✅ Class duration is exactly 25 minutes
✅ No existing class conflicts found
✅ No duplicate booking detected
✅ Trial class registration created
✅ Class entry created and linked
✅ Salesperson activity recorded
✅ Status history created
✅ Transaction committed successfully`
        }, {
            requestBody: {
                student_name,
                parent_name,
                email,
                mobile,
                age,
                teacher_id,
                meeting_start,
                meeting_end,
                description,
                language,
                booking_type,
                family_id,
                child_id
            },
            responseData: {
                trial_class_id: trialClass.id,
                class_id: classEntry.id,
                status: 'pending',
                trial_class_status: 'trial_1'
            }
        });

        logTrialManagement(`=== Trial class creation completed successfully ===`);

        return res.status(201).json({
            status: 'success',
            data: responseData
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
                logTrialManagement(`Transaction rolled back due to error`, 'error');
            } catch (rollbackError) {
                logTrialManagement(`Error rolling back transaction: ${rollbackError.message}`, 'error');
                logTrialManagement(rollbackError.stack, 'error');
            }
        }

        // Detailed error logging
        const errorLogMessage = `
=== TRIAL CLASS CREATION FAILED ===
Timestamp: ${new Date().toISOString()}
Error Type: ${error.name || 'Unknown'}
Error Message: ${error.message}

--- REQUEST DETAILS ---
Requested By: ${req.user?.full_name || 'Unknown'} (ID: ${req.user?.id || 'N/A'}, Role: ${req.user?.role_name || 'N/A'})
Request Body: ${JSON.stringify(req.body, null, 2)}

--- ERROR DETAILS ---
Stack Trace:
${error.stack || 'No stack trace available'}

--- TRANSACTION STATUS ---
Transaction Status: ${transaction ? (transaction.finished ? 'COMMITTED' : 'ROLLED BACK') : 'NOT STARTED'}

--- SYSTEM STATE ---
${error.message.includes('validation') ? 'Validation Error' : ''}
${error.message.includes('teacher') ? 'Teacher Related Error' : ''}
${error.message.includes('duplicate') ? 'Duplicate Booking Error' : ''}
${error.message.includes('conflict') ? 'Time Conflict Error' : ''}
${error.message.includes('transaction') ? 'Transaction Error' : ''}

=====================================`;

        logTrialManagement(errorLogMessage, 'error');
        logTrialManagement(`=== Trial class creation failed ===`);

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get trial classes with detailed management information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTrialClasses = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            teacher_id,
            start_date,
            end_date,
            search,
            added_start_date,
            added_end_date,
            attendance,
            evaluation_status,
            class_status,
            transfer_status = 'not_transferred'
        } = req.query;

        const whereClause = {};
        let classWhereClause = {};
        let evaluationWhereClause = {};
        let needsPostQueryFiltering = false;

        // IMPORTANT: Exclude transfer_accepted records from trial management
        // These should only appear in transferred-to-sales
        if (transfer_status === 'not_transferred') {
            whereClause[Op.or] = [
                { transfer_status: { [Op.is]: null } },
                { transfer_status: { [Op.ne]: 'transfer_accepted' } },
                { transfer_status: 'transferred' } // Include pending transfers
            ];
        }

        // Handle both regular status and trial_class_status filters
        if (status) {
            // Check if the status matches any trial_class_status enum values
            const trialClassStatuses = [
                'trial_1', 'trial_2', 'trial_2_paid', 'trial_3',
                'trial_3_paid', 'waiting_for_answer', 'payment_sent',
                'new_enroll', 'follow_up', 'not_relevant',
                'waiting_for_payment', 'missed'
            ];

            if (trialClassStatuses.includes(status)) {
                whereClause.trial_class_status = status;
            } else {
                whereClause.status = status;
            }
        }

        if (teacher_id) {
            whereClause.teacher_id = teacher_id;
        }

        // Handle trial class date filtering
        if (start_date && end_date) {
            const startMoment = moment.utc(start_date).startOf('day');
            const endMoment = moment.utc(end_date).endOf('day');
            
            whereClause.meeting_start = {
                [Op.between]: [startMoment.toISOString(), endMoment.toISOString()]
            };
        }

        // Handle added date filtering
        if (added_start_date && added_end_date) {
            const addedStartMoment = moment.utc(added_start_date).startOf('day');
            const addedEndMoment = moment.utc(added_end_date).endOf('day');
            
            whereClause.created_at = {
                [Op.between]: [addedStartMoment.toISOString(), addedEndMoment.toISOString()]
            };
        }

        // Handle search across multiple fields
        if (search) {
            const searchCondition = {
                [Op.or]: [
                    { student_name: { [Op.like]: `%${search}%` } },
                    { email: { [Op.like]: `%${search}%` } },
                    { mobile: { [Op.like]: `%${search}%` } },
                    { parent_name: { [Op.like]: `%${search}%` } }
                ]
            };
            
            // Combine with existing whereClause
            if (whereClause[Op.or]) {
                whereClause[Op.and] = [
                    { [Op.or]: whereClause[Op.or] },
                    searchCondition
                ];
                delete whereClause[Op.or];
            } else {
                Object.assign(whereClause, searchCondition);
            }
        }

        // Handle attendance filter with improved logic
        if (attendance) {
            switch (attendance) {
                case 'attended':
                    classWhereClause.is_present = true;
                    break;
                case 'missed':
                    // Include both is_present = false and trial_class_status = 'missed'
                    classWhereClause[Op.or] = [
                        { is_present: false },
                        { is_present: { [Op.is]: null } } // For trials marked as missed but not yet processed
                    ];
                    break;
                case 'late':
                    classWhereClause.is_present = 3;
                    break;
                case 'noMark':
                    classWhereClause.is_present = { [Op.is]: null };
                    break;
            }
        }

        // Handle class status filter
        if (class_status && class_status !== 'all') {
            classWhereClause.status = class_status;
        }

        // Check user role to determine if we should filter by booked_by_admin_id
        const currentUser = req.user;
        
        // Only filter by booked_by_admin_id for sales appointment setters
        classWhereClause.booked_by_admin_id = currentUser.id;

        // Handle evaluation status filter
        if (evaluation_status) {
            if (evaluation_status === 'sent') {
                // For 'sent' filter: Only include records WITH evaluations
                needsPostQueryFiltering = false;
                evaluationWhereClause.send_evaluation = 'sent';
            } else if (evaluation_status === 'pending') {
                // For 'pending' filter, we'll do post-query filtering
                needsPostQueryFiltering = true;
            }
        }

        // Define include models for the query
        const includeModels = [
            {
                model: User,
                as: 'teacher',
                attributes: ['id', 'full_name']
            },
            {
                model: Class,
                as: 'trialClass',
                attributes: ['is_present', 'status', 'cancellation_reason'],
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            },
            {
                model: TrialClassStatusHistory,
                as: 'statusHistory',
                attributes: [
                    'id',
                    'previous_status',
                    'new_status',
                    'changed_by_id',
                    'changed_by_type',
                    'notes',
                    'attendance_change',
                    'created_at'
                ],
                include: [{
                    model: User,
                    as: 'changedBy',
                    attributes: ['id', 'full_name', 'role_name']
                }],
                order: [['created_at', 'DESC']],
                required: false
            },
            {
                model: TrialClassEvaluation,
                as: 'evaluation',
                attributes: [
                    'id',
                    'plan_recommendation',
                    'send_evaluation',
                    'pdf_file',
                    'description',
                    'student_level',
                    'created_at',
                    'updated_at'
                ],
                where: Object.keys(evaluationWhereClause).length > 0 ? evaluationWhereClause : undefined,
                required: evaluation_status === 'sent'
            }
        ];

        // STEP 1: Fetch ALL data without limit/offset to get correct ordering
        const allRows = await TrialClassRegistration.findAll({
            where: whereClause,
            include: includeModels,
            order: [['meeting_start', 'DESC']],
            distinct: true
        });

        // If needed, perform post-query filtering for 'pending' evaluations
        let filteredRows = allRows;
        if (needsPostQueryFiltering && evaluation_status === 'pending') {
            filteredRows = allRows.filter(trial => !trial.evaluation);
        }

        // STEP 2: Sort ALL data by class status priority
        const sortedAllRows = filteredRows.sort((a, b) => {
            const statusA = a.trialClass?.status || 'unknown';
            const statusB = b.trialClass?.status || 'unknown';
            
            const getStatusPriority = (status) => {
                switch (status) {
                    case 'started': return 0;
                    case 'pending': return 1;
                    case 'ended': return 2;
                    case 'canceled': return 3;
                    default: return 4;
                }
            };
            
            const priorityA = getStatusPriority(statusA);
            const priorityB = getStatusPriority(statusB);
            
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            
            return new Date(b.meeting_start) - new Date(a.meeting_start);
        });

        // STEP 3: Apply pagination AFTER sorting all data
        const totalCount = sortedAllRows.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedRows = sortedAllRows.slice(startIndex, endIndex);

        // STEP 4: Format the paginated results
        const formattedTrials = await Promise.all(paginatedRows.map(async trial => {
            const trialJson = trial.toJSON();
            const trialMoment = moment.utc(trialJson.meeting_start);

            // Extract real attendance from `is_present`
            let attendance = '1';  // Default: present
            if (trialJson.trialClass) {
                if (trialJson.trialClass.is_present === true) {
                    attendance = '1'; // Present
                } else if (trialJson.trialClass.is_present === false) {
                    attendance = '0'; // Absent
                } else if (trialJson.trialClass.is_present === 3) {
                    attendance = '3'; // Late
                }
            }

            // Payment Status (optional placeholder - replace with real logic if available)
            let paymentStatus = null;
            if (trialMoment.isBefore(moment())) {
                paymentStatus = {
                    status: 'Pending Payment',
                    amount: '199 ILS',
                    sentDate: moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm')
                };
            }

            // Format status history
            const statusHistory = trialJson.statusHistory?.map(history => ({
                id: history.id,
                timestamp: history.created_at,
                previousStatus: history.previous_status,
                newStatus: history.new_status,
                changedBy: history.changedBy?.full_name || 'System',
                changedByRole: history.changed_by_type,
                notes: history.notes,
                attendanceChange: history.attendance_change
            })) || [];

            // Format evaluation data if available
            let evaluationData = null;
            if (trialJson.evaluation) {
                evaluationData = {
                    id: trialJson.evaluation.id,
                    planRecommendation: trialJson.evaluation.plan_recommendation,
                    sendStatus: trialJson.evaluation.send_evaluation,
                    pdfFile: trialJson.evaluation.pdf_file,
                    description: trialJson.evaluation.description,
                    studentLevel: trialJson.evaluation.student_level,
                    createdAt: moment(trialJson.evaluation.created_at).format('YYYY-MM-DD HH:mm'),
                    updatedAt: moment(trialJson.evaluation.updated_at).format('YYYY-MM-DD HH:mm')
                };
            }

            // Fetch complete trial class data
            const completeTrialRegistration = await TrialClassRegistration.findByPk(trial.id);

            // Fetch complete class data if available
            let completeClass = null;
            if (trial.class_id) {
                completeClass = await Class.findByPk(trial.class_id);
            }

            return {
                id: trialJson.id,
                studentName: trialJson.student_name,
                email: trialJson.email,
                phone: trialJson.mobile,
                addedDate: moment(trialJson.created_at).format('YYYY-MM-DD'),
                trialDateTime: trialMoment.format('YYYY-MM-DD HH:mm'),
                dayOfWeek: trialMoment.format('dddd'),
                teacherName: trialJson.teacher ? trialJson.teacher.full_name : 'Unassigned',
                status: trialJson.status === 'pending' ? 'Trial Class' : trialJson.status,
                trial_class_status: trialJson.trial_class_status,
                attendance,
                evaluation: evaluationData ? evaluationData.studentLevel : 'No Eval',
                paymentStatus,
                statusHistory,
                evaluationData,

                // Add complete objects
                trialClassRegistration: completeTrialRegistration,
                class: completeClass
            };
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                trials: formattedTrials,
                total: totalCount,
                pages: Math.ceil(totalCount / parseInt(limit)),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        console.error('Error in getTrialClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific trial class by ID with detailed information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTrialClassById = async (req, res) => {
    try {
        const { id } = req.params;

        const trialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'mobile']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['status', 'join_url']
                }
            ]
        });

        if (!trialClass) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Determine attendance and evaluation status
        const trialMoment = moment.utc(trialClass.meeting_start);
        let attendance = '⏳';
        let evaluation = 'No Eval';
        let paymentStatus = null;

        // Simulated logic for attendance and evaluation
        if (trialMoment.isBefore(moment())) {
            attendance = Math.random() > 0.5 ? '✔️' : '❌';
            evaluation = ['B2 Mid', 'A1 Low', 'Pre 1', 'A2 High'][Math.floor(Math.random() * 4)];
        }

        // Simulated payment status
        if (Math.random() > 0.7) {
            paymentStatus = {
                status: 'Waiting for Payment',
                amount: '199 ILS',
                sentDate: '2025/02/25 00:00'
            };
        }

        // Format trial class data
        const formattedTrialClass = {
            id: trialClass.id,
            studentName: trialClass.student_name,
            email: trialClass.email,
            phone: trialClass.mobile,
            parentName: trialClass.parent_name,
            age: trialClass.age,
            addedDate: moment(trialClass.created_at).format('YYYY-MM-DD'),
            trialDateTime: trialMoment.format('YYYY-MM-DD HH:mm'),
            dayOfWeek: trialMoment.format('dddd'),
            teacherName: trialClass.teacher ? trialClass.teacher.full_name : 'Unassigned',
            teacherEmail: trialClass.teacher ? trialClass.teacher.email : null,
            teacherPhone: trialClass.teacher ? trialClass.teacher.mobile : null,
            status: trialClass.status === 'pending' ? 'Trial Class' : trialClass.status,
            language: trialClass.language,
            description: trialClass.description,
            joinUrl: trialClass.trialClass ? trialClass.trialClass.join_url : null,
            attendance,
            evaluation,
            paymentStatus
        };

        return res.status(200).json({
            status: 'success',
            data: formattedTrialClass
        });

    } catch (error) {
        console.error('Error in getTrialClassById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update trial class details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTrialClass = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const updateData = req.body;

        // Clean up empty string values for ENUM fields
        if (updateData.trial_class_status === '') {
            delete updateData.trial_class_status; // Remove empty string to use existing value
        }

        if (updateData.status === '') {
            delete updateData.status;
        }

        if (updateData.language === '') {
            delete updateData.language;
        }

        // Validate trial_class_status if provided
        if (updateData.trial_class_status) {
            const validStatuses = [
                'trial_1', 'trial_2', 'trial_2_paid', 'trial_3', 'trial_3_paid',
                'waiting_for_answer', 'payment_sent', 'new_enroll', 'follow_up',
                'not_relevant', 'waiting_for_payment'
            ];
            
            if (!validStatuses.includes(updateData.trial_class_status)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid trial_class_status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
        }

        // Validate regular status if provided
        if (updateData.status) {
            const validRegularStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'converted'];
            
            if (!validRegularStatuses.includes(updateData.status)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid status. Must be one of: ${validRegularStatuses.join(', ')}`
                });
            }
        }

        // Validate language if provided
        if (updateData.language) {
            const validLanguages = ['HE', 'EN', 'AR'];
            
            if (!validLanguages.includes(updateData.language)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid language. Must be one of: ${validLanguages.join(', ')}`
                });
            }
        }

        // Start transaction
        transaction = await sequelize.transaction();

        const trialClass = await TrialClassRegistration.findByPk(id, { 
            transaction,
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                }
            ]
        });
        
        const previousStatus = trialClass.trial_class_status;

        if (!trialClass) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Prepare updates for the Class model
        const classUpdateData = {};

        // Handle name update
        if (updateData.student_name) {
            classUpdateData.student_name = updateData.student_name;
        }

        // Handle description/student_goal update
        if (updateData.description) {
            classUpdateData.student_goal = updateData.description;
        }

        // Handle teacher update
        let newTeacher = null;
        if (updateData.teacher_id) {
            // Check if teacher exists and is active
            newTeacher = await User.findOne({
                where: {
                    id: updateData.teacher_id,
                    role_name: 'teacher',
                    status: 'active'
                },
                attributes: [
                    'id',
                    'full_name',
                    'enable_zoom_link',
                    'add_zoom_link',
                    'add_zoom_link_meeting_id',
                    'add_zoom_link_access_code',
                    'timezone',
                    'notification_channels'
                ],
                transaction
            });

            if (!newTeacher) {
                await transaction.rollback();
                return res.status(404).json({
                    status: 'error',
                    message: 'Teacher not found or inactive'
                });
            }

            // Validate teacher's Zoom setup
            if (!newTeacher.enable_zoom_link || !newTeacher.add_zoom_link) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Teacher does not have Zoom integration enabled'
                });
            }

            // Update class with new teacher and zoom info
            classUpdateData.teacher_id = updateData.teacher_id;
            classUpdateData.join_url = newTeacher.add_zoom_link;
            classUpdateData.zoom_id = newTeacher.add_zoom_link_meeting_id;
        }

        // Handle attendance update
        if (updateData.is_present !== undefined) {
            classUpdateData.is_present = updateData.is_present;
        }

        // Handle time updates if provided
        let newStartTime, newEndTime;
        if (updateData.meeting_start || updateData.meeting_end) {
            newStartTime = moment.utc(updateData.meeting_start || trialClass.meeting_start);
            newEndTime = moment.utc(updateData.meeting_end || trialClass.meeting_end);

            // Validate duration
            const duration = moment.duration(newEndTime.diff(newStartTime)).asMinutes();
            console.log('duration:', duration);
            
            if (duration !== 25) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Trial class must be exactly 25 minutes'
                });
            }

            // Check availability (only if teacher_id isn't changing, otherwise we already checked above)
            const teacherIdToCheck = updateData.teacher_id || trialClass.teacher_id;
            const existingClass = await Class.findOne({
                where: {
                    teacher_id: teacherIdToCheck,
                    id: { [Op.ne]: trialClass.class_id },
                    [Op.or]: [
                        {
                            meeting_start: {
                                [Op.between]: [newStartTime.format(), newEndTime.format()]
                            }
                        },
                        {
                            meeting_end: {
                                [Op.between]: [newStartTime.format(), newEndTime.format()]
                            }
                        }
                    ],
                    status: {
                        [Op.notIn]: ['canceled', 'rejected']
                    }
                },
                transaction
            });

            if (existingClass) {
                await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'Teacher already has a class scheduled during this time slot'
                });
            }

            classUpdateData.meeting_start = newStartTime.format();
            classUpdateData.meeting_end = newEndTime.format();

            updateData.meeting_start = newStartTime.format();
            updateData.meeting_end = newEndTime.format();
        }

        // Update the class if we have changes
        if (Object.keys(classUpdateData).length > 0 && trialClass.class_id) {
            await Class.update(classUpdateData, {
                where: { id: trialClass.class_id },
                transaction
            });
        }

        // Update trial class
        await trialClass.update(updateData, { transaction });

        // Update salesperson activity if needed
        if (updateData.lead_source || updateData.calls_made ||
            updateData.call_duration || updateData.notes) {
            await Salesperson.update({
                lead_source: updateData.lead_source,
                calls_made: updateData.calls_made,
                call_duration: updateData.call_duration,
                notes: updateData.notes
            }, {
                where: {
                    class_id: trialClass.class_id,
                    action_type: 'trial_class'
                },
                transaction
            });
        }

        // Create status history if status changed
        if (updateData.trial_class_status && updateData.trial_class_status !== previousStatus) {
            await TrialClassStatusHistory.create({
                trial_class_id: trialClass.id,
                previous_status: previousStatus,
                new_status: updateData.trial_class_status,
                changed_by_id: req.user.id,
                changed_by_type: req.user.role_name,
                notes: updateData.status_change_notes || 'Status updated',
            }, { transaction });
        }

        await transaction.commit();

        // Fetch updated record with all associations
        const updatedTrialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'status', 'join_url', 'zoom_id', 'is_present']
                },
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        // Send notifications if time or teacher was changed
        if ((updateData.meeting_start || updateData.meeting_end || updateData.teacher_id) && 
            updatedTrialClass.trialClass.status !== 'cancelled') {
            try {
                const teacher = newTeacher || updatedTrialClass.teacher;
                const utcMeetingTime = moment.utc(updatedTrialClass.meeting_start);
                
                // 1. Teacher notification
                let teacherTz = 'UTC';
                if (teacher.timezone && moment.tz.zone(teacher.timezone)) {
                    teacherTz = teacher.timezone;
                }
                
                const teacherLocalDate = utcMeetingTime.clone()
                    .tz(teacherTz)
                    .format('YYYY-MM-DD');
                    
                const teacherLocalTime = utcMeetingTime.clone()
                    .tz(teacherTz)
                    .format('HH:mm');
                
                const notifyOptionsTeacher = {
                    'instructor.name': teacher.full_name,
                    'student.parentName': updatedTrialClass.parent_name || '-',
                    'student.name': updatedTrialClass.student_name,
                    'student.age': updatedTrialClass.age.toString(),
                    'lesson.date': teacherLocalDate,
                    'lesson.time': teacherLocalTime,
                    'student.description': updatedTrialClass.description || ""
                };

                // Send notification to teacher
                const teacherMessageSent = await whatsappReminderAddClass(
                    'trial_class_booking_for_teacher',
                    notifyOptionsTeacher,
                    teacher.id
                );

                // 2. Student notification
                const studentTz = getTimezoneForCountry(updatedTrialClass.country_code);
                
                const studentLocalDate = utcMeetingTime.clone()
                    .tz(studentTz)
                    .format('YYYY-MM-DD');
                
                const studentLocalTime = utcMeetingTime.clone()
                    .tz(studentTz)
                    .format('HH:mm');
                
                const studentDetails = {
                    country_code: updatedTrialClass.country_code,
                    mobile: updatedTrialClass.mobile.replace(/[+\s]/g, ''),
                    full_name: updatedTrialClass.student_name,
                    language: updatedTrialClass.language || 'EN',
                    email: updatedTrialClass.email
                };

                const notifyOptionsStudent = {
                    'student.name': updatedTrialClass.student_name,
                    'time.date': `${studentLocalDate} ${studentLocalTime}`,
                    'link.link': teacher.add_zoom_link,
                    'meet.id': teacher.add_zoom_link_meeting_id,
                    'access.code': teacher.add_zoom_link_access_code
                };

                // Send direct WhatsApp notification
                const studentMessageSent = await whatsappReminderTrailClass(
                    'trial_class_booking',
                    notifyOptionsStudent,
                    studentDetails
                );
            } catch (notificationError) {
                console.error('Error sending notifications:', notificationError);
            }
        }

        return res.status(200).json({
            status: 'success',
            data: updatedTrialClass
        });

    } catch (error) {
        // Handle transaction rollback
        if (transaction && !transaction.finished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in updateTrialClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete trial class registration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteTrialClass = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const { id } = req.params;

        // Input validation
        if (!id || isNaN(Number(id))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid trial class ID'
            });
        }

        const trialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: Class,
                    as: 'trialClass'
                }
            ],
            transaction
        });

        if (!trialClass) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Get student info for logging
        const student = await User.findByPk(trialClass.student_id || trialClass.email, {
            attributes: ['id', 'full_name', 'email'],
            transaction
        });

        // Store class data for logging before cancellation
        let classDataSnapshot = null;
        if (trialClass.class_id) {
            const classExists = await Class.findByPk(trialClass.class_id, { transaction });
            if (classExists) {
                classDataSnapshot = {
                    id: classExists.id,
                    student_id: classExists.student_id,
                    teacher_id: classExists.teacher_id,
                    meeting_start: classExists.meeting_start,
                    meeting_end: classExists.meeting_end,
                    status: classExists.status
                };
            }
        }

        // Log trial class deletion before cancellation
        classDeletionLogger.logTrialClassDeletion({
            trial_class_id: parseInt(id),
            class_id: trialClass.class_id,
            student_id: trialClass.student_id || student?.id,
            student_name: trialClass.student_name || student?.full_name || 'Unknown',
            teacher_id: trialClass.teacher_id || classDataSnapshot?.teacher_id,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'sales',
            deletion_source: 'sales_panel',
            associated_class_deleted: !!classDataSnapshot,
            associated_records_deleted: []
        });

        // Update associated class status to cancelled if exists
        let classCancelled = false;
        if (trialClass.class_id) {
            const classExists = await Class.findByPk(trialClass.class_id, { transaction });
            if (classExists) {
                await Class.update(
                    {
                        status: 'canceled',
                        cancelled_by: req.user?.id || null,
                        cancelled_at: moment.utc().toDate(),
                        cancellation_reason: 'Trial class cancelled via sales panel',
                        join_url: null,
                        updated_at: moment.utc().toDate()
                    },
                    {
                        where: { id: trialClass.class_id },
                        transaction
                    }
                );
                classCancelled = true;
            }
        }

        // Update salesperson activities status to cancelled
        await Salesperson.update(
            {
                success_status: 'cancelled',
                updated_at: moment.utc().toDate()
            },
            {
                where: {
                    class_id: trialClass.class_id,
                    action_type: 'trial_class'
                },
                transaction
            }
        );

        // Update trial class registration status to cancelled
        await trialClass.update(
            {
                status: 'cancelled',
                cancelled_by: req.user?.id || null,
                cancelled_at: moment.utc().toDate(),
                cancellation_reason: 'Trial class cancelled via sales panel',
                updated_at: moment.utc().toDate()
            },
            { transaction }
        );

        // Create status history entry
        await TrialClassStatusHistory.create(
            {
                trial_class_id: trialClass.id,
                previous_status: trialClass.status,
                new_status: 'cancelled',
                changed_by_id: req.user.id,
                changed_by_type: req.user.role_name || 'sales',
                notes: 'Trial class cancelled via sales panel'
            },
            { transaction }
        );

        // Commit the transaction
        await transaction.commit();

        // Log the cancellation
        console.info(`Trial class ${id} cancelled successfully by user ${req.user.id}`);

        // Log associated class cancellation if it was cancelled
        if (classCancelled && classDataSnapshot) {
            classDeletionLogger.logClassDeletion({
                class_id: classDataSnapshot.id,
                class_type: 'trial',
                student_id: classDataSnapshot.student_id,
                student_name: trialClass.student_name || student?.full_name || 'Unknown',
                teacher_id: classDataSnapshot.teacher_id,
                meeting_start: classDataSnapshot.meeting_start,
                meeting_end: classDataSnapshot.meeting_end,
                status: classDataSnapshot.status,
                deleted_by: req.user?.id || null,
                deleted_by_role: 'sales',
                deletion_reason: 'Cancelled as part of trial class cancellation',
                deletion_source: 'sales_panel',
                associated_records_deleted: ['trial_class_registration']
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Trial class and associated records cancelled successfully'
        });

    } catch (error) {
        // Rollback transaction on error
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in deleteTrialClass:', error);

        // Log deletion error
        classDeletionLogger.logTrialClassDeletion({
            trial_class_id: req.params.id ? parseInt(req.params.id) : null,
            class_id: null,
            student_id: null,
            student_name: 'Unknown',
            teacher_id: null,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'sales',
            deletion_source: 'sales_panel',
            error_details: {
                error_type: 'deletion_exception',
                error_message: error.message,
                error_stack: error.stack
            }
        });

        // Return appropriate error response
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Convert trial class to regular class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const convertTrialClass = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { id } = req.params;
        const { regular_class_id } = req.body;

        const trialClass = await TrialClassRegistration.findByPk(id, { transaction });

        if (!trialClass) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        if (trialClass.status === 'converted') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Trial class is already converted'
            });
        }

        // Verify regular class exists
        const regularClass = await Class.findByPk(regular_class_id, { transaction });
        if (!regularClass) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Regular class not found'
            });
        }

        // Update trial class status and link to regular class
        await trialClass.update({
            status: 'converted',
            regular_class_id
        }, { transaction });

        // Update salesperson activity
        await Salesperson.update({
            trial_converted: true,
            success_status: 'successful'
        }, {
            where: {
                class_id: trialClass.class_id,
                action_type: 'trial_class'
            },
            transaction
        });

        await transaction.commit();

        // Fetch updated record with associations
        const updatedTrialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'status', 'join_url', 'zoom_id']
                },
                {
                    model: Class,
                    as: 'regularClass',
                    attributes: ['id', 'status', 'join_url']
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Trial class successfully converted',
            data: updatedTrialClass
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error in convertTrialClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get trial class statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTrialClassStats = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        const whereClause = {};
        if (start_date && end_date) {
            whereClause.created_at = {
                [Op.between]: [
                    moment.utc(start_date).startOf('day').format(),
                    moment.utc(end_date).endOf('day').format()
                ]
            };
        }

        const stats = await TrialClassRegistration.findAll({
            where: whereClause,
            attributes: [
                'status',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            group: ['status']
        });

        const totalCount = await TrialClassRegistration.count({
            where: whereClause
        });

        const conversionRate = await TrialClassRegistration.findAll({
            where: {
                ...whereClause,
                status: 'converted'
            },
            attributes: [
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'converted_count']
            ]
        });

        const statsFormatted = stats.reduce((acc, stat) => {
            acc[stat.status] = parseInt(stat.getDataValue('count'));
            return acc;
        }, {});

        const convertedCount = conversionRate[0].getDataValue('converted_count');

        return res.status(200).json({
            status: 'success',
            data: {
                total: totalCount,
                status_breakdown: statsFormatted,
                conversion_rate: totalCount > 0 ?
                    ((convertedCount / totalCount) * 100).toFixed(2) : '0.00'
            }
        });

    } catch (error) {
        console.error('Error in getTrialClassStats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};


/**
 * Cancel a trial class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const cancelTrialClass = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const { id } = req.params;
        const { cancellation_reason } = req.body;
        const cancelledBy = req.user.id;
        const cancelledAt = moment.utc().toDate();

        // Input validation
        if (!id || isNaN(Number(id))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid trial class ID'
            });
        }

        if (!cancellation_reason?.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Cancellation reason is required'
            });
        }

        // Find the trial class with associated class record
        const trialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: Class,
                    as: 'trialClass'
                }
            ],
            transaction
        });

        if (!trialClass) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Check if trial class is already cancelled or completed
        if (['cancelled', 'completed', 'converted'].includes(trialClass.status)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: `Cannot cancel a trial class that is already ${trialClass.status}`
            });
        }

        // Check if the class is in the past
        const now = moment.utc();
        const classStart = moment.utc(trialClass.meeting_start);
        if (classStart.isBefore(now)) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot cancel a trial class that has already occurred'
            });
        }

        // Update trial class registration status
        await trialClass.update({
            status: 'cancelled',
            cancelled_by: cancelledBy,
            cancelled_at: cancelledAt,
            cancellation_reason,
            updated_at: now.toDate()
        }, { transaction });

        // Update associated class if exists
        if (trialClass.class_id && trialClass.trialClass) {
            await Class.update({
                status: 'canceled',
                cancelled_by: cancelledBy,
                cancelled_at: cancelledAt,
                cancellation_reason,
                join_url: null, // Remove join URL
                updated_at: now.toDate()
            }, {
                where: { id: trialClass.class_id },
                transaction
            });
        }

        // Update salesperson activity if exists
        await Salesperson.update({
            success_status: 'cancelled',
            updated_at: now.toDate()
        }, {
            where: {
                class_id: trialClass.class_id,
                action_type: 'trial_class'
            },
            transaction
        });

        // Commit the transaction
        await transaction.commit();

        // Log the cancellation
        console.info(`Trial class ${id} cancelled by user ${cancelledBy}. Reason: ${cancellation_reason}`);

        // Fetch updated record with associations
        const updatedTrialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: [
                        'id',
                        'status',
                        'join_url',
                        'zoom_id',
                        'cancelled_by',
                        'cancelled_at',
                        'cancellation_reason'
                    ]
                },
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Trial class cancelled successfully',
            data: updatedTrialClass
        });

    } catch (error) {
        // Rollback transaction on error
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in cancelTrialClass:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update trial class status with notes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTrialClassStatus = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { new_status, role_name, status_change_notes } = req.body;

        // Input validation
        if (!id || isNaN(Number(id))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid trial class ID'
            });
        }

        if (!new_status) {
            return res.status(400).json({
                status: 'error',
                message: 'New status is required'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Find the trial class
        const trialClass = await TrialClassRegistration.findByPk(id, { transaction });

        if (!trialClass) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Store the old status for response
        const previousStatus = trialClass.trial_class_status;

        // Update the trial class status and notes
        await trialClass.update({
            trial_class_status: new_status,
            status_change_notes: status_change_notes || null,
            updated_at: new Date()
        }, { transaction });

        // Create status history entry
        await TrialClassStatusHistory.create({
            trial_class_id: trialClass.id,
            previous_status: previousStatus,
            new_status: new_status,
            changed_by_id: req.user.id,
            changed_by_type: role_name, // Use role directly from user data
            notes: status_change_notes || null,
            created_at: new Date()
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Fetch updated record with associations
        const updatedTrialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'status', 'join_url', 'zoom_id']
                },
                {
                    model: TrialClassStatusHistory,
                    as: 'statusHistory',
                    include: [{
                        model: User,
                        as: 'changedBy',
                        attributes: ['id', 'full_name', 'role_name']
                    }]
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Trial class status updated successfully',
            data: {
                previous_status: previousStatus,
                new_status: new_status,
                trial_class: updatedTrialClass
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in updateTrialClassStatus:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get dashboard metrics for KeyMetricsOverview component - UPDATED with Show-up Rate
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDashboardMetrics = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const currentUser = req.user;

        // Default to current month if no dates provided
        const startDate = start_date ? moment.utc(start_date).startOf('day') : moment.utc().startOf('month');
        const endDate = end_date ? moment.utc(end_date).endOf('day') : moment.utc().endOf('month');

        const whereClause = {
            created_at: {
                [Op.between]: [startDate.toISOString(), endDate.toISOString()]
            }
        };

        // Filter by booked_by_admin_id for sales appointment setters
        const classWhereClause = {};
        // if (currentUser.role_name === 'sales_appointment_setter') {
        classWhereClause.booked_by_admin_id = currentUser.id;
        // }

        // 1. Students Before Trial (Total registered students in date range)
        const studentsBeforeTrialCount = await TrialClassRegistration.count({
            where: whereClause,
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        // 2. Trial Lessons Scheduled (all trials in the date range, regardless of status)
        const scheduledTrialsCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        // 3. FIXED: Past trials that have already occurred (for show-up rate calculation)
        const pastTrialsCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [startDate.toISOString(), endDate.toISOString()],
                    [Op.lte]: moment.utc().toISOString() // Only past trials
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        // 4. FIXED: Completed Trials (trials that occurred AND were attended)
        const completedTrialsCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [startDate.toISOString(), endDate.toISOString()],
                    [Op.lte]: moment.utc().toISOString() // Only past trials
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: {
                    ...classWhereClause,
                    is_present: true // Only attended trials
                },
                required: true
            }]
        });

        // Calculate show-up rate
        const showUpRate = pastTrialsCount > 0 
            ? Math.round((completedTrialsCount / pastTrialsCount) * 100)
            : 0;

        // 6. FIXED: Conversion Rate - Students who attended AND enrolled / Total attended
        const convertedStudentsCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                },
                trial_class_status: 'new_enroll'
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: {
                    ...classWhereClause,
                    is_present: true // Only count conversions from attended trials
                },
                required: true
            }]
        });

        // Calculate conversion rate based on attended trials only
        const conversionRate = completedTrialsCount > 0 
            ? Math.round((convertedStudentsCount / completedTrialsCount) * 100)
            : 0;

        // FIXED: Calculate trends with proper previous period
        const periodDuration = endDate.diff(startDate, 'days') + 1; // Include end date
        const previousStartDate = startDate.clone().subtract(periodDuration, 'days');
        const previousEndDate = startDate.clone().subtract(1, 'day');

        // Previous period metrics
        const previousStudentsCount = await TrialClassRegistration.count({
            where: {
                created_at: {
                    [Op.between]: [previousStartDate.toISOString(), previousEndDate.toISOString()]
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        const previousScheduledCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [previousStartDate.toISOString(), previousEndDate.toISOString()]
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        const previousPastTrialsCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [previousStartDate.toISOString(), previousEndDate.toISOString()],
                    [Op.lte]: previousEndDate.toISOString()
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                required: Object.keys(classWhereClause).length > 0
            }]
        });

        const previousCompletedCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [previousStartDate.toISOString(), previousEndDate.toISOString()],
                    [Op.lte]: previousEndDate.toISOString()
                }
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: {
                    ...classWhereClause,
                    is_present: true
                },
                required: true
            }]
        });

        const previousShowUpRate = previousPastTrialsCount > 0 
            ? Math.round((previousCompletedCount / previousPastTrialsCount) * 100)
            : 0;

        const previousConvertedCount = await TrialClassRegistration.count({
            where: {
                meeting_start: {
                    [Op.between]: [previousStartDate.toISOString(), previousEndDate.toISOString()]
                },
                trial_class_status: 'new_enroll'
            },
            include: [{
                model: Class,
                as: 'trialClass',
                where: {
                    ...classWhereClause,
                    is_present: true
                },
                required: true
            }]
        });

        const previousConversionRate = previousCompletedCount > 0 
            ? Math.round((previousConvertedCount / previousCompletedCount) * 100)
            : 0;

        // FIXED: Calculate trends with caps to prevent unrealistic values
        const calculateTrend = (current, previous) => {
            if (previous === 0) {
                return current > 0 ? Math.min(100, current) : 0; // Cap at 100% for new metrics
            }
            const trendValue = Math.round(((current - previous) / previous) * 100);
            return Math.min(Math.max(trendValue, -100), 1000); // Cap between -100% and 1000%
        };

        const trends = {
            studentsBeforeTrial: calculateTrend(studentsBeforeTrialCount, previousStudentsCount),
            scheduledTrials: calculateTrend(scheduledTrialsCount, previousScheduledCount),
            completedTrials: calculateTrend(completedTrialsCount, previousCompletedCount),
            showUpRate: calculateTrend(showUpRate, previousShowUpRate),
            conversionRate: calculateTrend(conversionRate, previousConversionRate)
        };

        // Debug logs for troubleshooting
        console.log('DEBUG METRICS:', {
            pastTrialsCount,
            completedTrialsCount,
            showUpRate,
            convertedStudentsCount,
            conversionRate,
            dateRange: `${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`
        });

        return res.status(200).json({
            status: 'success',
            data: {
                studentsBeforeTrial: {
                    value: studentsBeforeTrialCount,
                    trend: {
                        value: Math.abs(trends.studentsBeforeTrial),
                        isPositive: trends.studentsBeforeTrial >= 0
                    }
                },
                scheduledTrials: {
                    value: scheduledTrialsCount,
                    trend: {
                        value: Math.abs(trends.scheduledTrials),
                        isPositive: trends.scheduledTrials >= 0
                    }
                },
                completedTrials: {
                    value: completedTrialsCount,
                    trend: {
                        value: Math.abs(trends.completedTrials),
                        isPositive: trends.completedTrials >= 0
                    }
                },
                showUpRate: {
                    value: `${showUpRate}%`,
                    actualAttended: completedTrialsCount,
                    totalPastTrials: pastTrialsCount,
                    trend: {
                        value: Math.abs(trends.showUpRate),
                        isPositive: trends.showUpRate >= 0
                    }
                },
                conversionRate: {
                    value: `${conversionRate}%`,
                    actualConverted: convertedStudentsCount,
                    totalCompleted: completedTrialsCount,
                    trend: {
                        value: Math.abs(trends.conversionRate),
                        isPositive: trends.conversionRate >= 0
                    }
                },
                period: {
                    start: startDate.format('YYYY-MM-DD'),
                    end: endDate.format('YYYY-MM-DD')
                }
            }
        });

    } catch (error) {
        console.error('Error in getDashboardMetrics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get daily trial class metrics for TrialClassDay component
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDailyTrialMetrics = async (req, res) => {
    try {
        const { date } = req.query;
        const currentUser = req.user;

        // Default to today if no date provided
        const targetDate = date ? moment.utc(date) : moment.utc();
        const startOfDay = targetDate.clone().startOf('day');
        const endOfDay = targetDate.clone().endOf('day');

        const whereClause = {
            meeting_start: {
                [Op.between]: [startOfDay.toISOString(), endOfDay.toISOString()]
            }
        };

        // Filter by booked_by_admin_id for sales appointment setters
        const classWhereClause = {
            booked_by_admin_id: currentUser.id
        };

        // Get all trial classes for the specific date
        const trialClasses = await TrialClassRegistration.findAll({
            where: whereClause,
            include: [{
                model: Class,
                as: 'trialClass',
                where: classWhereClause,
                required: true,
                attributes: ['id', 'is_present', 'status']
            }],
            attributes: ['id', 'student_name', 'meeting_start', 'meeting_end']
        });

        // Calculate metrics
        const totalLessons = trialClasses.length;
        
        const completedLessons = trialClasses.filter(trial => 
            trial.trialClass && trial.trialClass.is_present === true
        ).length;
        
        const missedLessons = trialClasses.filter(trial => 
            trial.trialClass && trial.trialClass.is_present === false
        ).length;

        const lateLessons = trialClasses.filter(trial => 
            trial.trialClass && trial.trialClass.is_present === 3
        ).length;

        const pendingLessons = trialClasses.filter(trial => 
            !trial.trialClass || trial.trialClass.is_present === null
        ).length;

        return res.status(200).json({
            status: 'success',
            data: {
                date: targetDate.format('YYYY-MM-DD'),
                totalLessons,
                completedLessons,
                missedLessons,
                lateLessons,
                pendingLessons,
                // Additional details for the component
                lessons: trialClasses.map(trial => ({
                    id: trial.id,
                    studentName: trial.student_name,
                    startTime: moment.utc(trial.meeting_start).format('HH:mm'),
                    endTime: moment.utc(trial.meeting_end).format('HH:mm'),
                    status: trial.trialClass ? 
                        (trial.trialClass.is_present === true ? 'completed' :
                         trial.trialClass.is_present === false ? 'missed' :
                         trial.trialClass.is_present === 3 ? 'late' : 'pending') 
                        : 'pending'
                }))
            }
        });

    } catch (error) {
        console.error('Error in getDailyTrialMetrics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all sales agents with review statistics for Move to New Enrollments popup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getSalesAgentsForEnrollment = async (req, res) => {
    try {
        // Get query parameters for pagination and filtering
        const {
            page = 1,
            limit = 8,
            search = '',
            sort_by = 'bookings',
            sort_order = 'desc',
            min_bookings,
            max_bookings
        } = req.query;

        // Build the base query
        const where = {
            role_name: {
                [Op.in]: ['sales_role']
            },
            status: 'active'
        };

        // Add search filter if provided
        if (search) {
            where[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }

        // Prepare the include models
        const includeModels = [
            {
                model: Salesperson,
                as: 'regularClassBookings',
                attributes: [
                    [Sequelize.fn('COUNT', Sequelize.col('regularClassBookings.id')), 'total_bookings']
                ],
                // Add having clause for booking count filtering if needed
                ...((min_bookings !== undefined || max_bookings !== undefined) && {
                    having: {}
                })
            },
            {
                model: SalesAgentReview,
                as: 'salesAgentReviews',
                attributes: [
                    [Sequelize.fn('AVG', Sequelize.col('salesAgentReviews.overall_rating')), 'avg_rating'],
                    [Sequelize.fn('COUNT', Sequelize.col('salesAgentReviews.id')), 'total_reviews']
                ]
            }
        ];

        // Add booking filters if specified
        if (min_bookings !== undefined) {
            includeModels[0].having = {
                ...includeModels[0].having,
                [Sequelize.literal('COUNT(regularClassBookings.id)')]: {
                    [Op.gte]: parseInt(min_bookings)
                }
            };
        }

        if (max_bookings !== undefined) {
            includeModels[0].having = {
                ...includeModels[0].having,
                [Sequelize.literal('COUNT(regularClassBookings.id)')]: {
                    [Op.lte]: parseInt(max_bookings)
                }
            };
        }

        // Determine the order based on sort parameters
        let order = [];
        if (sort_by === 'bookings') {
            order = [[Sequelize.literal('COUNT(regularClassBookings.id)'), sort_order.toUpperCase()]];
        } else if (sort_by === 'rating') {
            order = [[Sequelize.literal('AVG(salesAgentReviews.overall_rating)'), sort_order.toUpperCase()]];
        } else if (sort_by === 'name') {
            order = [['full_name', sort_order.toUpperCase()]];
        }

        // Count total records (for pagination)
        const totalCount = await User.count({
            where,
            include: includeModels.map(model => ({
                ...model,
                attributes: []
            })),
            distinct: true
        });

        // Get the paginated records
        const salesAgents = await User.findAll({
            where,
            attributes: [
                ['id', 'id'],
                'full_name',
                'email',
                'avatar'
            ],
            include: includeModels,
            group: ['User.id'],
            order,
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
            subQuery: false
        });

        // Calculate total pages
        const totalPages = Math.ceil(totalCount / parseInt(limit));

        // Format the response data
        const formattedAgents = salesAgents.map(agent => {
            const agentData = agent.toJSON();

            // Calculate average rating and total reviews
            const avgRating = agentData.salesAgentReviews.length ?
                parseFloat(agentData.salesAgentReviews[0].avg_rating || 0).toFixed(1) :
                '0.0';

            const totalReviews = agentData.salesAgentReviews.length ?
                parseInt(agentData.salesAgentReviews[0].total_reviews || 0) :
                0;

            const totalBookings = agentData.regularClassBookings.length ?
                parseInt(agentData.regularClassBookings[0].total_bookings || 0) :
                0;

            return {
                id: agentData.id,
                name: agentData.full_name,
                email: agentData.email,
                avatar: agentData.avatar || '/placeholder.svg',
                avgRating,
                totalReviews,
                totalBookings
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                data: formattedAgents,
                total: totalCount,
                pages: totalPages,
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        console.error('Error in getSalesAgentsForEnrollment:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Move trial class to new enrollment with selected sales agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const moveToNewEnrollment = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { sales_agent_id } = req.body;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid trial class ID'
            });
        }

        if (!sales_agent_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Sales agent ID is required'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Find the trial class
        const trialClass = await TrialClassRegistration.findByPk(id, { transaction });

        if (!trialClass) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Store the old status for response
        const previousStatus = trialClass.trial_class_status;

        // Update the trial class status to "new_enroll"
        await trialClass.update({
            trial_class_status: 'new_enroll',
            status_change_notes: `Moved to New Enrollment by ${req.user.full_name}`,
            updated_at: new Date()
        }, { transaction });

        // Create status history entry
        await TrialClassStatusHistory.create({
            trial_class_id: trialClass.id,
            previous_status: previousStatus,
            new_status: 'new_enroll',
            changed_by_id: req.user.id,
            changed_by_type: req.user.role_name,
            notes: `Assigned to sales agent ID: ${sales_agent_id}`,
            created_at: new Date()
        }, { transaction });

        // Create a new salesperson entry for tracking this enrollment assignment
        await Salesperson.create({
            user_id: sales_agent_id,
            role_type: 'sales_role',
            action_type: 'regular_class',
            student_id: null, // Will be updated when actual student record is created
            class_id: trialClass.class_id,
            trial_converted: true,
            conversion_source: 'trial_class',
            lead_source: 'internal',
            meeting_type: 'online',
            notes: `Converted from trial class ID ${trialClass.id}`,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Fetch updated record with associations
        const updatedTrialClass = await TrialClassRegistration.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'status', 'join_url', 'zoom_id']
                },
                {
                    model: TrialClassStatusHistory,
                    as: 'statusHistory',
                    include: [{
                        model: User,
                        as: 'changedBy',
                        attributes: ['id', 'full_name', 'role_name']
                    }]
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Trial class moved to new enrollment successfully',
            data: {
                previous_status: previousStatus,
                new_status: 'new_enroll',
                trial_class: updatedTrialClass
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in moveToNewEnrollment:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Check if a user already exists in the system
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const checkExistingUser = async (req, res) => {
    try {
        const { email, mobile, student_name } = req.body;

        // Input validation
        if (!email && !mobile && !student_name) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one search parameter is required (email, mobile, or student_name)'
            });
        }

        // Build query conditions
        const conditions = [];

        if (email) {
            conditions.push({ email: { [Op.eq]: email } });
        }

        if (mobile) {
            conditions.push({ mobile: { [Op.eq]: mobile } });
        }

        // Check if user exists in trial class registrations
        const existingTrialClass = await TrialClassRegistration.findOne({
            where: {
                [Op.or]: conditions
            }
        });

        // Check if user exists in students
        const existingStudent = await User.findOne({
            where: {
                [Op.or]: conditions.map(condition => {
                    // Map the condition keys to match Student model
                    const newCondition = {};
                    if (condition.email) newCondition.email = condition.email;
                    if (condition.mobile) newCondition.mobile = condition.mobile;
                    return newCondition;
                })
            }
        });

        // Determine if user exists in any of the models
        const userExists = !!(existingTrialClass || existingStudent);

        // Prepare user data if exists
        let userData = null;
        if (userExists) {
            if (existingTrialClass) {
                userData = {
                    type: 'trial_class',
                    id: existingTrialClass.id,
                    name: existingTrialClass.student_name,
                    email: existingTrialClass.email,
                    mobile: existingTrialClass.mobile,
                    created_at: existingTrialClass.created_at
                };
            } else if (existingStudent) {
                userData = {
                    type: 'student',
                    id: existingStudent.id,
                    name: existingStudent.full_name,
                    email: existingStudent.email,
                    mobile: existingStudent.mobile,
                    created_at: existingStudent.created_at
                };
            }
        }

        return res.status(200).json({
            status: 'success',
            exists: userExists,
            data: userData,
            message: userExists 
                ? 'User already exists in the system' 
                : 'User does not exist in the system'
        });

    } catch (error) {
        console.error('Error checking existing user:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    createTrialClass,
    getTrialClasses,
    getTrialClassById,
    updateTrialClass,
    deleteTrialClass,
    convertTrialClass,
    getTrialClassStats,
    cancelTrialClass,
    updateTrialClassStatus,
    getSalesAgentsForEnrollment,
    moveToNewEnrollment,
    checkExistingUser,
    getDashboardMetrics,
    getDailyTrialMetrics,
    createStudentOnly,
};