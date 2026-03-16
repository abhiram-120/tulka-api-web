const Class = require('../../models/classes');
const User = require('../../models/users');
const UserSubscription = require('../../models/UserSubscriptionDetails');
const TeacherAvailability = require('../../models/teacherAvailability');
const TeacherHoliday = require('../../models/teacherHoliday');
const CancelReason = require('../../models/cancelReason');
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const moment = require('moment');
const { whatsappReminderAddClass } = require('../../cronjobs/reminder');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');

/**
 * Helper: Log a class cancellation into cancel_reasons table
 * @param {Object} options
 * @param {Number} options.student_id - Student ID
 * @param {String} options.reason - Short category (technical, no_time, etc.)
 * @param {String} options.note - Full reason or note
 */
async function logCancelReason({ student_id, reason, note }) {
    try {
        await CancelReason.create({
            student_id,
            cancellation_type: 'lesson',
            reason: reason || 'unspecified',
            note: note || null,
            created_at: new Date(),
        });
        console.log(`🧾 Logged lesson cancel reason → ${reason}`);
    } catch (err) {
        console.error('❌ Failed to log lesson cancel reason:', err.message);
    }
}

/**
 * Helper function to clean phone number (remove everything after + including +)
 */
function cleanPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return phone;
    }
    // Remove everything after + (including the + sign itself)
    const plusIndex = phone.indexOf('+');
    if (plusIndex !== -1) {
        return phone.substring(0, plusIndex).trim();
    }
    return phone.trim();
}


/**
 * Get all classes with optional filtering and pagination
 * Handles both regular classes and demo/trial classes
 */
const getClasses = async (req, res) => {
    try {
        const {
            student_search,
            teacher_search,
            student_name,
            teacher_name,
            student_phone,
            student_email,
            date_from,
            booked_by = 'all',
            booked_from = 'all',
            date_to,
            is_present = 'all',
            duration = 'all',
            status = 'all',
            sort_by = 'upcoming',
            page = 1,
            limit = 10
        } = req.query;

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
        const offset = (pageNum - 1) * pageSize;
        const now = new Date();

        // ✅ OPTIMIZED: Build where conditions more efficiently
        const classWhere = { is_regular_hide: 0 };
        const andConditions = [];

        // Attendance filter
        if (is_present && is_present !== 'all') {
            classWhere.is_present = is_present === 'present' ? 1 : 0;
        }
        // Booked By Filter (admin / sales_role / system)
        if (booked_by && booked_by !== 'all') {
            const map = {
                admin: 'Admin',
                sales_role: 'Sales_Role',
                system: 'System',
                student: 'Student'
            };

            if (map[booked_by]) {
                classWhere.booked_by = map[booked_by];
            }
        }

        // Booked from Filter
        if (booked_from && booked_from !== 'all') {
            const bookedFromMap = { website: 'website', app: 'app' };
            if (bookedFromMap[booked_from]) {
                classWhere.class_type = bookedFromMap[booked_from];
            }
        }

        // Duration Filter
        if (duration && duration !== 'all') {
            andConditions.push(
                Sequelize.where(
                    Sequelize.fn('TIMESTAMPDIFF', Sequelize.literal('MINUTE'),
                        Sequelize.col('Class.meeting_start'),
                        Sequelize.col('Class.meeting_end')
                    ),
                    Number(duration)
                )
            );
        }

        // Date filters - build once
        if (date_from || date_to) {
            const dateConditions = {};
            if (date_from) dateConditions[Op.gte] = moment(date_from).startOf('day').toDate();
            if (date_to) dateConditions[Op.lte] = moment(date_to).endOf('day').toDate();
            andConditions.push({ meeting_start: dateConditions });
        }

        // Status filter - optimized to work with date filters
        if (status && status !== 'all') {
            switch (status) {
                case 'started':
                    andConditions.push(
                        { meeting_start: { [Op.lte]: now } },
                        { meeting_end: { [Op.gte]: now } },
                        { status: { [Op.notIn]: ['canceled', 'cancelled'] } }
                    );
                    break;

                case 'pending':
                    andConditions.push(
                        { meeting_start: { [Op.gt]: now } },
                        { status: { [Op.in]: ['pending', 'scheduled'] } }
                    );
                    break;

                case 'ended':
                    andConditions.push(
                        {
                            [Op.or]: [
                                { meeting_end: { [Op.lt]: now } },
                                { status: 'completed' }
                            ]
                        },
                        { status: { [Op.notIn]: ['canceled', 'cancelled'] } }
                    );
                    break;

                case 'canceled':
                    classWhere.status = { [Op.in]: ['canceled'] };
                    break;
            }
        }

        // Combine all AND conditions
        if (andConditions.length > 0) {
            classWhere[Op.and] = andConditions;
        }

        // ✅ OPTIMIZED: Build includes with search conditions efficiently
        const teacherWhere = {};
        const studentWhere = {};

        // Helper function to decode and clean search terms
        const cleanSearchTerm = (term) => {
            if (!term) return null;
            // Decode URL encoding (Express usually does this, but be safe)
            let cleaned = decodeURIComponent(String(term));
            // Replace + with space (URL encoding)
            cleaned = cleaned.replace(/\+/g, ' ').trim();
            return cleaned || null;
        };

        // Smart searches - prioritize unified search
        if (student_search) {
            const term = cleanSearchTerm(student_search);
            if (term) {
                // Escape special characters for LIKE query
                const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                const searchPattern = `%${escapedTerm}%`;
                studentWhere[Op.or] = [
                    { full_name: { [Op.like]: searchPattern } },
                    { email: { [Op.like]: searchPattern } },
                    { mobile: { [Op.like]: searchPattern } }
                ];
            }
        } else {
            // Legacy individual field searches (only if unified search not used)
            if (student_name) {
                const term = cleanSearchTerm(student_name);
                if (term) {
                    const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                    studentWhere.full_name = { [Op.like]: `%${escapedTerm}%` };
                }
            }
            if (student_email) {
                const term = cleanSearchTerm(student_email);
                if (term) {
                    const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                    studentWhere.email = { [Op.like]: `%${escapedTerm}%` };
                }
            }
            if (student_phone) {
                const term = cleanSearchTerm(student_phone);
                if (term) {
                    const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                    studentWhere.mobile = { [Op.like]: `%${escapedTerm}%` };
                }
            }
        }

        if (teacher_search) {
            const term = cleanSearchTerm(teacher_search);
            if (term) {
                const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                const searchPattern = `%${escapedTerm}%`;
                teacherWhere[Op.or] = [
                    { full_name: { [Op.like]: searchPattern } },
                    { email: { [Op.like]: searchPattern } }
                ];
            }
        } else if (teacher_name) {
            // Legacy fallback
            const term = cleanSearchTerm(teacher_name);
            if (term) {
                const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
                teacherWhere.full_name = { [Op.like]: `%${escapedTerm}%` };
            }
        }

        // Helper to check if where object has any conditions
        const hasWhereConditions = (whereObj) => {
            if (!whereObj) return false;
            // Check for Symbol keys (like Op.or) and string keys
            return Object.keys(whereObj).length > 0 || Object.getOwnPropertySymbols(whereObj).length > 0;
        };

        // Includes
        const include = [
            {
                model: User,
                as: 'Teacher',
                attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                where: hasWhereConditions(teacherWhere) ? teacherWhere : undefined,
                required: true
            },
            {
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                where: hasWhereConditions(studentWhere) ? studentWhere : undefined,
                required: true
            }
        ];

        // ✅ OPTIMIZED: Simplified ORDER BY - only use complex CASE when needed
        let order;
        if (sort_by === 'recently_booked') {
            // Simple ordering for recently booked
            order = [[Sequelize.col('Class.created_at'), 'DESC']];
        } else if (status === 'all' || !status) {
            // Only use complex CASE when status filter is not applied (need to prioritize active classes)
            const priorityCase = Sequelize.literal(`
                CASE
                    WHEN \`Class\`.\`status\` NOT IN ('canceled','cancelled')
                         AND \`Class\`.\`meeting_start\` <= NOW()
                         AND \`Class\`.\`meeting_end\` >= NOW() THEN 1
                    WHEN \`Class\`.\`status\` = 'pending' THEN 2
                    WHEN \`Class\`.\`status\` = 'ended' OR \`Class\`.\`meeting_end\` < NOW() THEN 3
                    WHEN \`Class\`.\`status\` IN ('canceled','cancelled') THEN 4
                    ELSE 2
                END
            `);
            order = [[priorityCase, 'ASC'], [Sequelize.col('Class.meeting_start'), 'ASC']];
        } else {
            // When status filter is applied, simpler ordering is sufficient
            order = [[Sequelize.col('Class.meeting_start'), 'ASC']];
        }

        // ✅ OPTIMIZED: Always use database-level filtering and pagination
        // The WHERE clauses in includes handle the search filtering at database level
        // This is much more efficient than fetching all rows and filtering in JavaScript
        // Performance improvement: O(n) -> O(log n) for large datasets
        const result = await Class.findAndCountAll({
            where: classWhere,
            include,
            order,
            limit: pageSize,
            offset,
            subQuery: false, // Better for joins - prevents subquery wrapping
            distinct: true // Required for accurate count with joins
        });

        const rows = result.rows;
        const count = result.count;

        // ✅ OPTIMIZED: Format data efficiently (formatClassResponse already calculates effectiveStatus)
        const data = rows.map((row) => formatClassResponse(row));

        return res.status(200).json({
            status: 'success',
            data,
            pagination: {
                total: count,
                page: pageNum,
                limit: pageSize,
                pages: Math.ceil(count / pageSize)
            },
            message: 'Classes retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get class by ID
 */
const getClassById = async (req, res) => {
    try {
        const { id } = req.params;

        const classItem = await Class.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                    required: true
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                    required: true
                }
            ]
        });

        if (!classItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found'
            });
        }

        // Format response
        const formattedClass = formatClassResponse(classItem);

        return res.status(200).json({
            status: 'success',
            data: formattedClass,
            message: 'Class retrieved successfully'
        });

    } catch (error) {
        console.error('Error fetching class details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Create a new class
 */
const createClass = async (req, res) => {
    try {
        const {
            student_id,
            teacher_id,
            start_date
        } = req.body;

        // Validation - only check required fields
        if (!student_id || !teacher_id || !start_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID, Teacher ID, and start date are required'
            });
        }

        // Check if student and teacher exist
        const [student, teacher] = await Promise.all([
            User.findByPk(student_id),
            User.findByPk(teacher_id)
        ]);

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        if (!teacher) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }

        // Ensure student is active
        if (student.status !== 'active') {
            return res.status(400).json({
                status: 'error',
                message: 'Student account is not active'
            });
        }

        // Parse and validate date
        const meetingStart = moment.utc(start_date);
        if (!meetingStart.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid start date format'
            });
        }

        // Get student's active subscription
        let subscription = await UserSubscription.findOne({
            where: {
                user_id: student_id,
                status: 'active'
            },
            order: [['created_at', 'DESC']]
        });

        // Handle trial users (similar to PHP logic)
        if (student.trial_expired == 0 && !subscription) {
            subscription = {
                lesson_min: 25,
                renew_date: moment().add(1, 'month').toDate(),
                weekly_lesson: 1,
                lesson_reset_at: moment().add(1, 'month').toDate(),
                left_lessons: 1,
                bonus_class: 0,
                bonus_completed_class: 0,
                bonus_expire_date: null,
                type: 'trial'
            };
        }

        if (!subscription) {
            return res.status(400).json({
                status: 'error',
                message: 'No active subscription found for this student. Please purchase a subscription first.'
            });
        }

        // Check if student has pending classes (used as OR condition with left lessons)
        const pendingClassCount = await Class.count({
            where: {
                student_id: student_id,
                status: { [Op.in]: ['pending', 'scheduled'] }
            }
        });

        // Require: at least one pending class OR left lessons > 0
        if (pendingClassCount <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Student must have at least one pending class or remaining lessons to book a new class.'
            });
        }

        // Check if student has remaining lessons
        if (subscription.left_lessons <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Your remaining lessons are completed. Please take a new subscription to continue booking classes.'
            });
        }

        const classDuration = parseInt(subscription.lesson_min) || 25;
        const meetingEnd = meetingStart.clone().add(classDuration, 'minutes');

        // Convert meeting time to user timezone for validation
        const studentTimezone = student.timezone || 'UTC';
        let meetingUserTimezone;

        try {
            // Ensure we have a proper moment object in the student's timezone
            meetingUserTimezone = meetingStart.clone().tz(studentTimezone);
        } catch (timezoneError) {
            console.error('Timezone conversion error:', timezoneError);
            // Fallback to UTC if timezone conversion fails
            meetingUserTimezone = meetingStart.clone().utc();
        }

        // Check subscription validity based on type - FIX HERE
        let lessonResetDate;
        try {
            lessonResetDate = moment(subscription.lesson_reset_at).tz(studentTimezone).startOf('day');
        } catch (resetDateError) {
            console.error('Reset date conversion error:', resetDateError);
            lessonResetDate = moment(subscription.lesson_reset_at).utc().startOf('day');
        }

        // Use isAfter/isSameOrAfter instead of gte for better compatibility
        if (subscription.type === 'Monthly' && meetingUserTimezone.isSameOrAfter(lessonResetDate)) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot book class beyond subscription period for monthly subscription'
            });
        }

        if (subscription.type !== 'Monthly' && meetingUserTimezone.isSameOrAfter(lessonResetDate)) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot book class beyond subscription period'
            });
        }

        // Check if meeting is in the future
        if (!meetingStart.isAfter(moment.utc())) {
            return res.status(400).json({
                status: 'error',
                message: 'Meeting start time must be in the future'
            });
        }

        // Check for conflicts
        const conflictCheck = await checkClassConflicts(student_id, teacher_id, meetingStart.toDate(), meetingEnd.toDate());
        if (!conflictCheck.available) {
            return res.status(409).json({
                status: 'error',
                message: 'Time slot conflicts detected',
                conflicts: conflictCheck.conflicts
            });
        }

        // Check teacher availability
        const availabilityCheck = await checkTeacherAvailabilityForAdmin(teacher_id, meetingStart.toDate(), classDuration);
        if (!availabilityCheck.available) {
            return res.status(409).json({
                status: 'error',
                message: 'Teacher not available at this time',
                details: availabilityCheck.reason
            });
        }

        // **BONUS CLASS LOGIC START** (Converted from PHP)

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
            }
        });

        // Check bonus class expiry if applicable
        if (subscription.bonus_class > 0 &&
            subscription.left_lessons <= subscription.bonus_class &&
            subscription.bonus_class != subscription.bonus_completed_class) {

            const bonusExpireDate = moment(subscription.bonus_expire_date).endOf('day');
            if (bonusExpireDate.isBefore(meetingStart)) {
                return res.status(400).json({
                    status: 'error',
                    message: "You can't book a Bonus Class after the expiry date shown on your plan."
                });
            }
        }

        // Prepare class data
        const classData = {
            student_id,
            teacher_id,
            status: 'pending',
            meeting_start: meetingStart.toDate(),
            meeting_end: meetingEnd.toDate(),
            is_trial: false,
            booked_by: 'admin',
            booked_by_admin_id: req.user?.id || null,
            duration: classDuration,
            class_type: 'website',
            bonus_class: 0, // Default to regular class
            created_at: new Date(),
            updated_at: new Date()
        };

        // Check if this should be a bonus class
        let shouldUseBonusClass = false;
        if (lessonCount >= subscription.weekly_lesson) {
            // Weekly lessons completed, check if bonus class is available
            if (subscription.bonus_class > 0 &&
                subscription.left_lessons <= subscription.bonus_class &&
                subscription.bonus_class != subscription.bonus_completed_class) {

                const bonusExpireDate = moment(subscription.bonus_expire_date).endOf('day');
                if (!bonusExpireDate.isBefore(meetingStart)) {
                    shouldUseBonusClass = true;
                    classData.bonus_class = 1;
                }
            }
        }

        // Add Zoom link if teacher has it enabled
        if (teacher.enable_zoom_link == 1 && teacher.add_zoom_link) {
            classData.join_url = teacher.add_zoom_link;
            classData.admin_url = teacher.add_zoom_link;
        }

        // Use transaction to ensure data consistency
        const result = await sequelize.transaction(async (t) => {
            // Create the class
            const newClass = await Class.create(classData, { transaction: t });

            // Update subscription based on class type
            const updateData = {
                left_lessons: subscription.left_lessons - 1,
                updated_at: new Date()
            };

            // If using bonus class, increment bonus completed count
            if (shouldUseBonusClass) {
                updateData.bonus_completed_class = (subscription.bonus_completed_class || 0) + 1;
            }

            // Update subscription (if it's not a trial user)
            if (subscription.id) {
                await UserSubscription.update(
                    updateData,
                    {
                        where: { id: subscription.id },
                        transaction: t
                    }
                );
            }

            return newClass;
        });

        // **BONUS CLASS LOGIC END**

        // Reload class with associations
        const createdClass = await Class.findByPk(result.id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                }
            ]
        });

        // Prepare response message
        const remainingLessons = subscription.left_lessons - 1;
        let responseMessage = 'Class created successfully';

        if (shouldUseBonusClass) {
            responseMessage = 'Bonus class created successfully';
        } else if (remainingLessons === 0) {
            responseMessage = 'Class created successfully. This was your last lesson. Please purchase a new subscription to continue booking classes.';
        } else if (remainingLessons <= 3) {
            responseMessage = `Class created successfully. You have ${remainingLessons} lesson${remainingLessons > 1 ? 's' : ''} remaining. Consider purchasing a new subscription soon.`;
        }

        // Send notifications using whatsappReminderAddClass
        try {
            const studentNotifyOptions = {
                'student.name': student.full_name,
                'instructor.name': teacher.full_name,
                'time.date': meetingUserTimezone.format('DD/MM/YYYY HH:mm'),
                'link': `${process.env.FRONTEND_URL}/panel/meetings/reservation` // need to chnage after student panel is ready
            };

            // Send notification to student
            await whatsappReminderAddClass('booking_done', studentNotifyOptions, student_id);

            // Send notification to teacher (if class is within next 24 hours)
            const tomorrow = moment().add(1, 'day');
            if (meetingUserTimezone.isBefore(tomorrow)) {
                const teacherNotifyOptions = {
                    'instructor.name': teacher.full_name,
                    'student.name': student.full_name,
                    'time.date': meetingUserTimezone.format('DD/MM/YYYY'),
                    'time.time': meetingUserTimezone.format('HH:mm'),
                    'time.duration': classDuration.toString()
                };
                await whatsappReminderAddClass('regular_class_book_for_teacher', teacherNotifyOptions, teacher_id);
            }
        } catch (notificationError) {
            console.error('Notification sending failed:', notificationError);
            // Don't fail the request if notifications fail
        }

        return res.status(201).json({
            status: 'success',
            data: {
                ...formatClassResponse(createdClass),
                remaining_lessons: remainingLessons,
                is_bonus_class: shouldUseBonusClass,
                bonus_classes_remaining: subscription.bonus_class - (subscription.bonus_completed_class || 0) - (shouldUseBonusClass ? 1 : 0)
            },
            message: responseMessage
        });

    } catch (error) {
        console.error('Error creating class:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update an existing class
 */
const updateClass = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            start_date,
            teacher_id,
            status,
            cancellation_reason
        } = req.body;

        const classItem = await Class.findByPk(id);

        if (!classItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found'
            });
        }

        const updateData = { updated_at: new Date() };

        // Handle date/time change
        if (start_date) {
            const newStartDate = moment.utc(start_date);
            if (!newStartDate.isValid()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid start date format'
                });
            }

            const duration = moment(classItem.meeting_end).diff(moment(classItem.meeting_start), 'minutes');
            const newEndDate = newStartDate.clone().add(duration, 'minutes');

            // Check for conflicts with new time
            const conflictCheck = await checkClassConflicts(
                classItem.student_id,
                teacher_id || classItem.teacher_id,
                newStartDate.toDate(),
                newEndDate.toDate(),
                classItem.id // Exclude current class from conflict check
            );

            if (!conflictCheck.available) {
                return res.status(409).json({
                    status: 'error',
                    message: 'Time slot conflicts detected',
                    conflicts: conflictCheck.conflicts
                });
            }

            updateData.meeting_start = newStartDate.toDate();
            updateData.meeting_end = newEndDate.toDate();
        }

        // Handle teacher change
        if (teacher_id && teacher_id !== classItem.teacher_id) {
            const teacher = await User.findByPk(teacher_id);
            if (!teacher) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Teacher not found'
                });
            }

            updateData.teacher_id = teacher_id;

            // Update Zoom link if new teacher has it
            if (teacher.enable_zoom_link == 1 && teacher.add_zoom_link) {
                updateData.join_url = teacher.add_zoom_link;
                updateData.admin_url = teacher.add_zoom_link;
            }
        }

        // Handle status change
        if (status && status !== classItem.status) {
            updateData.status = status;

            if (status === 'canceled') {
                updateData.cancelled_by = req.user?.id || null;
                updateData.cancelled_at = new Date();
                updateData.cancellation_reason = cancellation_reason || 'Cancelled by admin';

                // Return lesson to student subscription if was scheduled
                if (classItem.status === 'scheduled') {
                    await updateStudentSubscription(classItem.student_id, 1);
                }
            } else if (status === 'scheduled' && classItem.status !== 'scheduled') {
                // Deduct lesson from student subscription
                await updateStudentSubscription(classItem.student_id, -1);
            }
        }

        // Update the class
        await classItem.update(updateData);

        // Reload class with associations
        const updatedClass = await Class.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                }
            ]
        });

        return res.status(200).json({
            status: 'success',
            data: formatClassResponse(updatedClass),
            message: 'Class updated successfully'
        });

    } catch (error) {
        console.error('Error updating class:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Cancel a class
 */
const cancelClass = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const { id } = req.params;
        const { cancellation_reason } = req.body;
        const cancelledBy = req.user?.id || null;
        const cancelledAt = moment.utc().toDate();

        if (!id || isNaN(Number(id))) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({ status: 'error', message: 'Invalid class ID' });
        }

        if (!cancellation_reason?.trim()) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({ status: 'error', message: 'Cancellation reason is required' });
        }

        const classItem = await Class.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                    required: true
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
                    required: true
                }
            ],
            transaction
        });

        if (!classItem) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({ status: 'error', message: 'Class not found' });
        }

        if (classItem.status === 'canceled') {
            if (transaction) await transaction.rollback();
            return res.status(400).json({ status: 'error', message: 'Class is already cancelled' });
        }

        const originalStatus = classItem.status;

        // Update the class
        await classItem.update({
            status: 'canceled',
            cancelled_by: cancelledBy,
            cancelled_at: cancelledAt,
            cancellation_reason: cancellation_reason.trim(),
            join_url: null,
            admin_url: null,
            updated_at: moment.utc().toDate()
        }, { transaction });

        // ✅ OPTIMIZED: Log to cancel_reasons table asynchronously (non-blocking)
        // Move this outside transaction and make it async

        // Return lesson to student subscription if was scheduled/pending
        if ((originalStatus === 'pending' || originalStatus === 'scheduled') && classItem.student_id) {
            const subscription = await UserSubscription.findOne({
                where: { user_id: classItem.student_id },
                order: [['created_at', 'DESC']],
                transaction
            });

            if (subscription) {
                const updateData = { updated_at: new Date() };

                // Check if this was a bonus class
                if (classItem.bonus_class === true || classItem.bonus_class === 1) {
                    // Refund bonus class
                    updateData.bonus_completed_class = Math.max((subscription.bonus_completed_class || 1) - 1, 0);
                }

                updateData.left_lessons = (subscription.left_lessons || 0) + 1;

                await UserSubscription.update(updateData, {
                    where: { id: subscription.id },
                    transaction
                });
            }
        }

        // **BONUS CLASS REFUND LOGIC END**

        await transaction.commit();

        // ✅ OPTIMIZED: Prepare response message based on what was refunded (before async operations)
        let refundMessage = '';
        if (classItem.bonus_class === true || classItem.bonus_class === 1) {
            refundMessage = ' Bonus class has been refunded to your account.';
        } else if (originalStatus === 'pending' || originalStatus === 'scheduled') {
            refundMessage = ' Lesson has been refunded to your account.';
        }

        // ✅ OPTIMIZED: Send response immediately (don't wait for notifications or logging)
        res.status(200).json({
            status: 'success',
            message: 'Class cancelled successfully.' + refundMessage,
            data: {
                class: {
                    id: classItem.id,
                    status: 'canceled', // We know it's canceled since we just updated it
                    cancelled_by: cancelledBy,
                    cancelled_at: cancelledAt,
                    cancellation_reason: cancellation_reason.trim(),
                    meeting_start: classItem.meeting_start,
                    meeting_end: classItem.meeting_end,
                    was_bonus_class: classItem.bonus_class === true || classItem.bonus_class === 1,
                    student: {
                        id: classItem.Student.id,
                        full_name: classItem.Student.full_name,
                        email: classItem.Student.email,
                        mobile: classItem.Student.mobile,
                        timezone: classItem.Student.timezone
                    },
                    teacher: {
                        id: classItem.Teacher.id,
                        full_name: classItem.Teacher.full_name,
                        email: classItem.Teacher.email,
                        mobile: classItem.Teacher.mobile,
                        timezone: classItem.Teacher.timezone
                    }
                }
            }
        });

        // ✅ OPTIMIZED: Send notifications and logging asynchronously (non-blocking)
        setImmediate(async () => {
            try {
                // Log to cancel_reasons table
                await logCancelReason({
                    student_id: classItem.student_id,
                    reason: cancellation_reason.trim(),
                    note: `Class cancelled by user ID: ${cancelledBy || 'system'}`,
                });

                // Send cancellation notification to teacher
                const teacherTimezone = classItem.Teacher.timezone || 'UTC';
                const meetingTeacherTimezone = moment(classItem.meeting_start).tz(teacherTimezone);

                const notifyOptionsTeacher = {
                    'instructor.name': classItem.Teacher.full_name,
                    'student.name': classItem.Student.full_name,
                    'class.date': meetingTeacherTimezone.format('DD/MM/YYYY'),
                    'class.time': meetingTeacherTimezone.format('HH:mm')
                };

                await whatsappReminderAddClass('regular_class_cancelled', notifyOptionsTeacher, classItem.teacher_id);

            } catch (error) {
                console.error('Error in async operations (logging/notifications):', error);
                // Don't fail the request if these fail
            }
        });

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error in cancelClass:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete a class
 * ✅ PERFORMANCE OPTIMIZED: Uses transaction, parallel queries, and async logging
 */
const deleteClass = async (req, res) => {
    let transaction;
    
    try {
        const { id } = req.params;

        // ✅ OPTIMIZED: Start transaction for data consistency and better performance
        transaction = await sequelize.transaction();

        // ✅ OPTIMIZED: Fetch class within transaction
        const classItem = await Class.findByPk(id, { transaction });

        if (!classItem) {
            if (transaction) await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Class not found'
            });
        }

        // ✅ OPTIMIZED: Get student info for logging (non-blocking, fetch after transaction)
        // We'll fetch this asynchronously after response is sent
        const studentId = classItem.student_id;

        // Store class data for logging before deletion
        const classDataSnapshot = {
            id: classItem.id,
            student_id: classItem.student_id,
            teacher_id: classItem.teacher_id,
            meeting_start: classItem.meeting_start,
            meeting_end: classItem.meeting_end,
            status: classItem.status,
            bonus_class: classItem.bonus_class,
            is_trial: classItem.is_trial,
            is_regular_hide: classItem.is_regular_hide,
            subscription_id: classItem.subscription_id
        };

        // ✅ OPTIMIZED: Return lesson to student subscription if was scheduled (within transaction)
        let lessonsRefunded = 0;
        if (classItem.status === 'scheduled' && classItem.student_id) {
            await updateStudentSubscription(classItem.student_id, 1, transaction);
            lessonsRefunded = 1;
        }

        // Get student info for logging before cancellation
        const student = studentId 
            ? await User.findByPk(studentId, {
                attributes: ['id', 'full_name'],
                transaction
            })
            : null;

        // Log class deletion before cancellation
        classDeletionLogger.logClassDeletion({
            class_id: classDataSnapshot.id,
            class_type: classDataSnapshot.is_trial ? 'trial' : 'regular',
            student_id: classDataSnapshot.student_id,
            student_name: student?.full_name || 'Unknown',
            teacher_id: classDataSnapshot.teacher_id,
            meeting_start: classDataSnapshot.meeting_start,
            meeting_end: classDataSnapshot.meeting_end,
            status: classDataSnapshot.status,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'admin',
            deletion_reason: 'Class cancelled via admin panel',
            deletion_source: 'admin_panel',
            subscription_updated: lessonsRefunded > 0,
            lessons_refunded: lessonsRefunded,
            class_data: classDataSnapshot
        });

        // ✅ OPTIMIZED: Cancel the class instead of deleting (within transaction)
        await classItem.update(
            {
                status: 'canceled',
                cancelled_by: req.user?.id || null,
                cancelled_at: moment.utc().toDate(),
                cancellation_reason: 'Class cancelled via admin panel',
                join_url: null,
                updated_at: moment.utc().toDate()
            },
            { transaction }
        );

        // ✅ OPTIMIZED: Commit transaction immediately (critical operations done)
        await transaction.commit();

        // ✅ OPTIMIZED: Send response immediately (don't wait for logging)
        res.status(200).json({
            status: 'success',
            message: 'Class cancelled successfully'
        });

        // ✅ OPTIMIZED: Log cancel reason asynchronously (non-blocking) - don't await
        setImmediate(async () => {
            try {
                // Log cancel reason for cancellation
                await logCancelReason({
                    student_id: classDataSnapshot.student_id,
                    reason: 'cancelled_by_admin',
                    note: 'Class cancelled by admin',
                });
            } catch (logError) {
                console.error('Error in async logging for class cancellation:', logError);
                // Don't fail the request if logging fails
            }
        });

    } catch (error) {
        // ✅ OPTIMIZED: Rollback transaction on error
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        console.error('Error deleting class:', error);

        // ✅ OPTIMIZED: Log deletion error asynchronously (non-blocking)
        setImmediate(() => {
            try {
                if (req.params.id) {
                    classDeletionLogger.logClassDeletion({
                        class_id: req.params.id,
                        class_type: 'regular',
                        student_id: null,
                        student_name: 'Unknown',
                        teacher_id: null,
                        deleted_by: req.user?.id || null,
                        deleted_by_role: 'admin',
                        deletion_reason: 'Error during deletion',
                        deletion_source: 'admin_panel',
                        error_details: {
                            error_type: 'deletion_exception',
                            error_message: error.message,
                            error_stack: error.stack
                        }
                    });
                }
            } catch (logError) {
                console.error('Error in async error logging:', logError);
            }
        });

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get duplicate pending classes for the same teacher (exact same time)
 * Admin version replaces the old conflicts endpoint per request
 */
const getClassConflicts = async (req, res) => {
    try {
        const duplicateGroups = await Class.findAll({
            attributes: [
                'teacher_id',
                'meeting_start',
                'meeting_end',
                [Sequelize.fn('COUNT', Sequelize.col('*')), 'count']
            ],
            where: { status: 'pending' },
            group: ['teacher_id', 'meeting_start', 'meeting_end'],
            having: Sequelize.literal('COUNT(*) > 1'),
            raw: true
        });

        const conflicts = [];
        for (const grp of duplicateGroups) {
            const classes = await Class.findAll({
                where: {
                    teacher_id: grp.teacher_id,
                    meeting_start: grp.meeting_start,
                    meeting_end: grp.meeting_end,
                    status: { [Op.ne]: 'canceled' }
                },
                include: [
                    {
                        model: User,
                        as: 'Student',
                        attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                    },
                    {
                        model: User,
                        as: 'Teacher',
                        attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                    }
                ]
            });

            if (classes.length > 1) {
                conflicts.push({
                    id: `teacher_${grp.teacher_id}_${moment(grp.meeting_start).unix()}`,
                    type: 'duplicate_pending',
                    description: `Teacher has duplicate pending classes at the same time`,
                    classes: classes.map(formatClassResponse),
                    resolved: false
                });
            }
        }

        return res.status(200).json({
            status: 'success',
            data: conflicts,
            message: 'Conflicts retrieved successfully'
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Resolve a conflict (mark as resolved)
 */
const resolveConflict = async (req, res) => {
    try {
        const { conflictId } = req.params;

        return res.status(200).json({
            status: 'success',
            message: 'Conflict marked as resolved'
        });

    } catch (error) {
        console.error('Error resolving conflict:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get class statistics
 */
const getClassStats = async (req, res) => {
    try {
        const todayStart = moment.utc().startOf("day").toDate();
        const todayEnd = moment.utc().endOf("day").toDate();

        const weekStart = moment.utc().startOf("isoWeek").toDate();
        const weekEnd = moment.utc().endOf("isoWeek").toDate();

        const dateFrom = req.query.date_from;
        const dateTo = req.query.date_to;

        let dateFilter = {};
        if (dateFrom && dateTo) {
            dateFilter = {
                meeting_start: {
                    [Op.between]: [
                        new Date(`${dateFrom}T00:00:00Z`),
                        new Date(`${dateTo}T23:59:59Z`)
                    ]
                }
            };
        }

        console.log("📅 Date Range:", dateFrom, dateTo, new Date(`${dateFrom}T00:00:00Z`), new Date(`${dateTo}T23:59:59Z`));

        // ✅ OPTIMIZATION: Run all count queries in parallel using Promise.all
        // Add is_regular_hide filter to match getClasses behavior
        const baseWhere = { is_regular_hide: 0, ...dateFilter };

        const [
            totalClasses,
            scheduledClasses,
            completedClasses,
            cancelledClasses,
            activeToday,
            classesThisWeek,
            conflictsResult
        ] = await Promise.all([
            // Base stats with date filter
            Class.count({
                where: baseWhere
            }),
            Class.count({
                where: { status: 'pending', ...baseWhere }
            }),
            Class.count({
                where: { status: 'ended', ...baseWhere }
            }),
            Class.count({
                where: { status: 'canceled', ...baseWhere }
            }),
            // Active Today (ignore date filter for today's stats, but include is_regular_hide)
            Class.count({
                where: {
                    is_regular_hide: 0,
                    meeting_start: { [Op.between]: [todayStart, todayEnd] }
                }
            }),
            // This Week (ignore date filter for week stats, but include is_regular_hide)
            Class.count({
                where: {
                    is_regular_hide: 0,
                    meeting_start: { [Op.between]: [weekStart, weekEnd] }
                }
            }),
            // Get conflicts count (old approach)
            Class.findAll({
                attributes: [
                    'teacher_id',
                    'meeting_start',
                    [Sequelize.fn('COUNT', Sequelize.col('*')), 'count']
                ],
                where: {
                    is_regular_hide: 0,
                    status: { [Op.in]: ['scheduled', 'pending'] }
                },
                group: ['teacher_id', 'meeting_start'],
                having: Sequelize.literal('COUNT(*) > 1'),
                raw: true
            })
        ]);

        const conflictsCount = Array.isArray(conflictsResult) ? conflictsResult.length : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                totalClasses,
                scheduledClasses,
                completedClasses,
                cancelledClasses,
                activeToday,
                classesThisWeek,
                conflictsCount
            },
            message: 'Statistics retrieved successfully'
        });
    } catch (error) {
        console.error('Error fetching class stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};


/**
 * Get students for dropdown
 */
const getStudentsForDropdown = async (req, res) => {
    try {
        const students = await User.findAll({
            where: {
                role_name: 'user',
                status: 'active'
            },
            attributes: ['id', 'full_name', 'email', 'mobile', 'timezone'],
            order: [['full_name', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            data: students.map(student => ({
                id: student.id,
                full_name: student.full_name,
                email: student.email,
                mobile: student.mobile,
                timezone: student.timezone
            })),
            message: 'Students retrieved successfully'
        });

    } catch (error) {
        console.error('Error fetching students:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get teachers for dropdown
 */
const getTeachersForDropdown = async (req, res) => {
    try {
        const teachers = await User.findAll({
            where: {
                role_name: 'teacher',
                status: { [Op.like]: '%active%' }
            },
            attributes: ['id', 'full_name', 'email', 'mobile', 'avatar', 'timezone'],
            order: [['full_name', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            data: teachers.map(teacher => ({
                id: teacher.id,
                full_name: teacher.full_name,
                email: teacher.email,
                mobile: teacher.mobile,
                timezone: teacher.timezone,
                imageUrl: teacher.avatar
            })),
            message: 'Teachers retrieved successfully'
        });

    } catch (error) {
        console.error('Error fetching teachers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Check availability for class booking
 */
const checkAvailability = async (req, res) => {
    try {
        const { student_id, teacher_id, start_date } = req.body;

        if (!student_id || !teacher_id || !start_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Student ID, Teacher ID, and start date are required'
            });
        }

        const startMoment = moment.utc(start_date);
        if (!startMoment.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid start date format'
            });
        }

        // Get student subscription to determine lesson duration
        const subscription = await UserSubscription.findOne({
            where: {
                user_id: student_id,
                status: 'active'
            },
            order: [['created_at', 'DESC']]
        });

        const duration = subscription ? parseInt(subscription.lesson_min) : 60;
        const endMoment = startMoment.clone().add(duration, 'minutes');

        // Check for conflicts
        const conflictCheck = await checkClassConflicts(student_id, teacher_id, startMoment.toDate(), endMoment.toDate());

        // Check teacher availability
        const availabilityCheck = await checkTeacherAvailabilityForAdmin(teacher_id, startMoment.toDate(), duration);

        const available = conflictCheck.available && availabilityCheck.available;
        const conflicts = [];

        if (!conflictCheck.available) {
            conflicts.push(...conflictCheck.conflicts);
        }

        if (!availabilityCheck.available) {
            conflicts.push(availabilityCheck.reason);
        }

        // Add warnings for admin
        if (availabilityCheck.warning) {
            conflicts.push(availabilityCheck.warning);
        }

        return res.status(200).json({
            status: 'success',
            data: {
                available,
                conflicts: conflicts.length > 0 ? conflicts : undefined
            },
            message: 'Availability checked successfully'
        });

    } catch (error) {
        console.error('Error checking availability:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const exportClasses = async (req, res) => {
    try {
        const {
            student_search,
            teacher_search,
            student_name,
            teacher_name,
            student_phone,
            student_email,
            date_from,
            date_to,
            is_present = "all",
            status = "all",
            sort_by = "upcoming",
            booked_by = "all",
            booked_from = "all",
            duration = "all",
        } = req.query;

        const classWhere = { is_regular_hide: 0 };

        // Attendance Filter
        if (is_present !== "all") {
            classWhere.is_present = is_present === "present" ? 1 : 0;
        }

        // 🔹 Booked By Filter
        if (booked_by !== "all") {
            const map = {
                admin: "Admin",
                sales_role: "Sales_Role",
                system: "System",
            };
            if (map[booked_by]) classWhere.booked_by = map[booked_by];
        }

        // 🔹 Booked From Filter
        if (booked_from !== "all") {
            classWhere.class_type = booked_from;
        }

        // 🔹 Duration Filter
        // Duration filter (derived from meeting_start & meeting_end)
        if (duration && duration !== "all") {
            classWhere[Op.and] = [
                ...(classWhere[Op.and] || []),
                Sequelize.where(
                    Sequelize.fn(
                        "TIMESTAMPDIFF",
                        Sequelize.literal("MINUTE"),
                        Sequelize.col("Class.meeting_start"),
                        Sequelize.col("Class.meeting_end")
                    ),
                    Number(duration)
                )
            ];
        }


        // Status Filter
        if (status !== "all") {
            const now = new Date();

            switch (status) {
                case "started":
                    classWhere.meeting_start = { [Op.lte]: now };
                    classWhere.meeting_end = { [Op.gte]: now };
                    classWhere.status = { [Op.notIn]: ["canceled"] };
                    break;

                case "pending":
                    classWhere.meeting_start = { [Op.gt]: now };
                    classWhere.status = { [Op.in]: ["pending", "scheduled"] };
                    break;

                case "ended":
                    classWhere[Op.and] = [
                        {
                            [Op.or]: [
                                { meeting_end: { [Op.lt]: now } },
                                { status: "completed" },
                            ],
                        },
                        { status: { [Op.notIn]: ["canceled"] } },
                    ];
                    break;

                case "canceled":
                    classWhere.status = "canceled";
                    break;
            }
        }

        // Date Filter
        if (date_from || date_to) {
            const dateCond = {};
            if (date_from) dateCond[Op.gte] = moment(date_from).startOf("day").toDate();
            if (date_to) dateCond[Op.lte] = moment(date_to).endOf("day").toDate();

            classWhere.meeting_start = dateCond;
        }

        // Includes
        const include = [
            {
                model: User,
                as: "Teacher",
                attributes: ["id", "full_name", "email", "mobile", "timezone"],
                where: {},
                required: true,
            },
            {
                model: User,
                as: "Student",
                attributes: ["id", "full_name", "email", "mobile", "timezone"],
                where: {},
                required: true,
            },
        ];

        // Smart searches
        if (student_search) {
            const t = student_search.trim();
            include[1].where = {
                [Op.or]: [
                    { full_name: { [Op.like]: `%${t}%` } },
                    { email: { [Op.like]: `%${t}%` } },
                    { mobile: { [Op.like]: `%${t}%` } },
                ],
            };
        }

        if (teacher_search) {
            const t = teacher_search.trim();
            include[0].where = {
                [Op.or]: [
                    { full_name: { [Op.like]: `%${t}%` } },
                    { email: { [Op.like]: `%${t}%` } },
                ],
            };
        }

        // ORDER
        const priorityCase = Sequelize.literal(`
            CASE
                WHEN Class.status != 'canceled'
                     AND Class.meeting_start <= NOW()
                     AND Class.meeting_end >= NOW()
                THEN 1
                WHEN Class.status = 'pending'
                    OR (Class.status = 'scheduled' AND Class.meeting_end > NOW())
                THEN 2
                WHEN Class.status = 'ended' OR Class.meeting_end < NOW()
                THEN 3
                WHEN Class.status = 'canceled'
                THEN 4
                ELSE 2
            END
        `);

        // const secondaryOrder =
        //     sort_by === "recently_booked"
        //         ? [["Class.created_at", "DESC"]]
        //         : [["Class.meeting_start", "ASC"]];

        const secondaryOrder =
            sort_by === "recently_booked"
                ? [[Sequelize.col("Class.created_at"), "DESC"]]
                : [[Sequelize.col("Class.meeting_start"), "ASC"]];


        const order = [[priorityCase, "ASC"], ...secondaryOrder];

        // MAIN QUERY
        const classes = await Class.findAll({
            where: classWhere,
            include,
            order,
            subQuery: false,
            distinct: true,
        });

        // ---------------------------
        // 🔥 Learning Duration (X)
        // ---------------------------
        async function getLearningDuration(studentId) {
            const first = await UserSubscriptionDetails.findOne({
                where: { user_id: studentId },
                order: [["created_at", "ASC"]],
                raw: true,
            });

            if (!first) return "N/A";

            const start = new Date(first.created_at);
            const now = new Date();
            const diffMonths = Math.ceil((now - start) / (1000 * 60 * 60 * 24 * 30));

            return `${diffMonths}`;
        }

        const csvData = [];

        for (const c of classes) {
            const learningDuration = await getLearningDuration(c.Student?.id);

            csvData.push([
                c.Student?.full_name || "",
                cleanPhoneNumber(c.Student?.mobile || ""),
                c.Teacher?.full_name || "",
                moment(c.meeting_start).format("YYYY-MM-DD"),
                moment(c.meeting_start).format("HH:mm"),
                moment(c.meeting_end).diff(moment(c.meeting_start), "minutes"),
                c.status,
                c.is_present ? "Present" : "Absent",
                c.booked_by || "",
                c.cancelled_by || "",
                learningDuration, // ⭐ NEW COLUMN
            ]);
        }

        const csvContent = [
            [
                "Student Name",
                "Student Phone",
                "Teacher Name",
                "Date",
                "Time",
                "Duration",
                "Status",
                "Attendance",
                "Booked By",
                "Cancelled By",
                "Learning Duration",
            ],
            ...csvData,
        ]
            .map((row) => row.join(","))
            .join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=classes-export.csv"
        );

        return res.send(csvContent);
    } catch (error) {
        console.error("Error exporting classes:", error);
        return res.status(500).json({
            status: "error",
            message: error.message,
        });
    }
};


/**
 * Check for class conflicts
 */
async function checkClassConflicts(studentId, teacherId, startDate, endDate, excludeClassId = null) {
    const whereCondition = {
        [Op.or]: [
            { student_id: studentId },
            { teacher_id: teacherId }
        ],
        status: { [Op.in]: ['scheduled', 'pending'] },
        [Op.or]: [
            {
                meeting_start: { [Op.between]: [startDate, endDate] }
            },
            {
                meeting_end: { [Op.between]: [startDate, endDate] }
            },
            {
                [Op.and]: [
                    { meeting_start: { [Op.lte]: startDate } },
                    { meeting_end: { [Op.gte]: endDate } }
                ]
            }
        ]
    };

    if (excludeClassId) {
        whereCondition.id = { [Op.ne]: excludeClassId };
    }

    const conflicts = await Class.findAll({
        where: whereCondition,
        include: [
            {
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name']
            },
            {
                model: User,
                as: 'Teacher',
                attributes: ['id', 'full_name']
            }
        ]
    });

    if (conflicts.length === 0) {
        return {
            available: true,
            conflicts: []
        };
    }

    // Process conflicts with auto-cancellation logic
    const remainingConflicts = [];
    const cancelledClasses = [];
    const deletedClasses = [];

    for (const conflict of conflicts) {
        // Student conflicts - always report, no auto-cancellation
        if (conflict.student_id === studentId) {
            remainingConflicts.push(
                `Student already has a class at ${moment(conflict.meeting_start).format('YYYY-MM-DD HH:mm')}`
            );
        }
        // Teacher conflicts - apply auto-cancellation logic
        else if (conflict.teacher_id === teacherId) {
            try {
                const conflictingStudentId = conflict.student_id;
                // Verify the conflicting student exists before checking subscription
                const studentExists = await User.findByPk(conflictingStudentId);

                if (!studentExists) {
                    // Get classes before cancellation for logging
                    const classesToCancel = await Class.findAll({
                        where: {
                            student_id: conflictingStudentId,
                            status: { [Op.in]: ['scheduled', 'pending'] }
                        },
                        attributes: ['id', 'student_id', 'teacher_id', 'meeting_start', 'meeting_end', 'status']
                    });

                    // Log bulk class deletion before cancellation
                    if (classesToCancel.length > 0) {
                        const classesDeleted = classesToCancel.map(cls => ({
                            class_id: cls.id,
                            class_type: 'regular',
                            student_id: cls.student_id,
                            teacher_id: cls.teacher_id,
                            meeting_start: cls.meeting_start,
                            meeting_end: cls.meeting_end,
                            status: cls.status
                        }));

                        classDeletionLogger.logBulkClassDeletion({
                            deletion_source: 'admin_panel',
                            deleted_by: req.user?.id || null,
                            deleted_by_role: 'admin',
                            deletion_reason: 'User not found in database - classes cancelled',
                            total_deleted: classesToCancel.length,
                            classes_deleted: classesDeleted,
                            subscription_updates: [],
                            lessons_refunded_total: 0
                        });
                    }

                    // Student doesn't exist, cancel their classes
                    const cancelledCount = await Class.update(
                        {
                            status: 'canceled',
                            cancelled_by: req.user?.id || null,
                            cancelled_at: moment.utc().toDate(),
                            cancellation_reason: 'User not found in database - classes cancelled',
                            join_url: null,
                            updated_at: moment.utc().toDate()
                        },
                        {
                            where: {
                                student_id: conflictingStudentId,
                                status: { [Op.in]: ['scheduled', 'pending'] }
                            }
                        }
                    );

                    deletedClasses.push({
                        student_id: conflictingStudentId,
                        deleted_count: cancelledCount[0] || 0,
                        reason: 'User not found in database - all pending classes cancelled'
                    });

                    console.log(`Cancelled ${cancelledCount[0] || 0} pending classes for non-existent student ${conflictingStudentId}`);
                    continue;
                }

                // Get the conflicting student's subscription details
                const subscription = await UserSubscription.findOne({
                    where: {
                        user_id: conflictingStudentId,
                        // status: 'active'
                    },
                    order: [['created_at', 'DESC']]
                });

                // If there is no subscription or the last subscription is not marked
                // as inactive_after_renew, we should not auto-cancel classes based
                // on the renewal date logic. Just report a normal conflict.
                // if (!subscription || subscription.inactive_after_renew != 1) {
                //     remainingConflicts.push(
                //         `Teacher already has a class at ${moment(conflict.meeting_start).format('YYYY-MM-DD HH:mm')}`
                //     );
                //     continue;
                // }

                // Check if the conflicting class meets auto-cancellation criteria
                const isRegularHide =
                    conflict.is_regular_hide === 1 || conflict.is_regular_hide === true;

                let shouldAutoCancel = false;

                if (subscription.inactive_after_renew == 1) {
                    shouldAutoCancel = isRegularHide;
                } else {
                    if (subscription.renew_date) {
                        const isBeforeRenewal = moment(startDate).isBefore(
                            moment(subscription.renew_date)
                        );
                        shouldAutoCancel = isRegularHide && isBeforeRenewal;
                    } else {
                        // No renew_date configured – fall back to regular hide check only
                        shouldAutoCancel = isRegularHide;
                    }
                }

                if (shouldAutoCancel) {
                    // Auto-cancel the old class
                    await sequelize.transaction(async (t) => {
                        // Cancel the conflicting class
                        await conflict.update({
                            status: 'canceled',
                            cancelled_at: new Date(),
                            cancellation_reason: 'Automatically cancelled due to teacher schedule conflict with renewal date',
                            updated_at: new Date()
                        }, { transaction: t });

                    });

                    cancelledClasses.push({
                        id: conflict.id,
                        student_id: conflictingStudentId,
                        meeting_start: conflict.meeting_start,
                        reason: 'Auto-cancelled due to teacher conflict and renewal date policy'
                    });

                    console.log(`Auto-cancelled class ID ${conflict.id} for student ${conflictingStudentId} due to teacher conflict and renewal date`);
                } else {
                    // Cannot auto-cancel, add to conflicts
                    remainingConflicts.push(
                        `Teacher already has a class at ${moment(conflict.meeting_start).format('YYYY-MM-DD HH:mm')}`
                    );
                }
            } catch (error) {
                console.error(`Error processing teacher conflict for class ${conflict.id}:`, error);
                remainingConflicts.push(
                    `Teacher already has a class at ${moment(conflict.meeting_start).format('YYYY-MM-DD HH:mm')}`
                );
            }
        }
    }

    return {
        available: remainingConflicts.length === 0,
        conflicts: remainingConflicts,
        autoCancelledClasses: cancelledClasses.length > 0 ? cancelledClasses : undefined,
        deletedClasses: deletedClasses.length > 0 ? deletedClasses : undefined
    };
}

/**
 * Check teacher availability - Admin-friendly version
 * Admins can override teacher availability but still get warnings about holidays
 */
async function checkTeacherAvailabilityForAdmin(teacherId, startDate, duration) {
    const startMoment = moment(startDate);

    // Check if teacher is on holiday (still block these)
    const holiday = await TeacherHoliday.findOne({
        where: {
            user_id: teacherId,
            form_date: { [Op.lte]: startDate },
            to_date: { [Op.gte]: startDate },
            status:'approved'
        }
    });

    if (holiday) {
        return {
            available: false,
            reason: `Teacher is on holiday from ${moment(holiday.form_date).format('YYYY-MM-DD')} to ${moment(holiday.to_date).format('YYYY-MM-DD')}`
        };
    }

    // Check teacher availability schedule but only warn (don't block for admin)
    const availability = await TeacherAvailability.findOne({
        where: { user_id: teacherId }
    });

    if (!availability) {
        return {
            available: true, // Allow but with warning
            warning: 'Teacher availability not configured - please confirm with teacher'
        };
    }

    const dayOfWeek = startMoment.format('ddd').toLowerCase();
    const timeSlot = startMoment.format('HH:mm');

    let dayAvailability = {};
    try {
        if (availability[dayOfWeek]) {
            dayAvailability = JSON.parse(availability[dayOfWeek]);
        }
    } catch (error) {
        console.error(`Error parsing availability for day ${dayOfWeek}:`, error);
        return {
            available: true,
            warning: 'Teacher availability data is invalid - please confirm with teacher'
        };
    }

    if (!dayAvailability || !dayAvailability[timeSlot]) {
        return {
            available: true, // Allow but with warning
            warning: `Teacher not normally available on ${startMoment.format('dddd')} at ${timeSlot} - please confirm with teacher`
        };
    }

    // Check if duration requires multiple slots (for longer lessons)
    if (duration > 30) {
        const endMoment = startMoment.clone().add(duration, 'minutes');
        const endTimeSlot = endMoment.format('HH:mm');

        if (!dayAvailability[endTimeSlot]) {
            return {
                available: true,
                warning: `Teacher not normally available for the full duration until ${endTimeSlot} - please confirm with teacher`
            };
        }
    }

    return { available: true };
}

/**
 * Update student subscription lesson count
 */
async function updateStudentSubscription(studentId, lessonDelta, transaction = null) {
    try {
        const subscription = await UserSubscription.findOne({
            where: {
                user_id: studentId,
                status: 'active'
            },
            order: [['created_at', 'DESC']],
            transaction
        });

        if (subscription) {
            await subscription.update({
                left_lessons: Math.max(0, subscription.left_lessons + lessonDelta)
            }, { transaction });
        }
    } catch (error) {
        console.error('Error updating student subscription:', error);
    }
}

/**
 * Format class response for API
 */
function formatClassResponse(classItem) {
    const duration = moment(classItem.meeting_end).diff(moment(classItem.meeting_start), 'minutes');
    const statusInfo = getClassStatusPriority(classItem);

    return {
        id: classItem.id,
        student_id: classItem.student_id,
        teacher_id: classItem.teacher_id,
        meeting_start: classItem.meeting_start,
        meeting_end: classItem.meeting_end,
        status: classItem.status,
        effectiveStatus: statusInfo.effectiveStatus,
        booked_by: classItem.booked_by,
        booked_at: classItem.created_at,
        cancelled_by: classItem.cancelled_by,
        cancelled_at: classItem.cancelled_at,
        cancellation_reason: classItem.cancellation_reason,
        join_url: classItem.join_url,
        admin_url: classItem.admin_url,
        class_type: classItem.class_type,
        is_trial: classItem.is_trial,
        is_present: classItem.is_present,
        duration,

        // Student info
        student: classItem.Student ? {
            id: classItem.Student.id,
            full_name: classItem.Student.full_name,
            email: classItem.Student.email,
            mobile: classItem.Student.mobile,
            timezone: classItem.Student.timezone
        } : null,

        // Teacher info
        teacher: classItem.Teacher ? {
            id: classItem.Teacher.id,
            full_name: classItem.Teacher.full_name,
            email: classItem.Teacher.email,
            mobile: classItem.Teacher.mobile,
            timezone: classItem.Teacher.timezone
        } : null,

        // Computed fields
        date: moment(classItem.meeting_start).format('YYYY-MM-DD'),
        time: moment(classItem.meeting_start).format('HH:mm'),
        studentName: classItem.Student?.full_name,
        studentPhone: classItem.Student?.mobile,
        studentEmail: classItem.Student?.email,
        teacherName: classItem.Teacher?.full_name
    };
}

/**
 * Get class status priority for sorting
 */
function getClassStatusPriority(classItem) {
    const now = new Date();
    const meetingStart = new Date(classItem.meeting_start);
    const meetingEnd = new Date(classItem.meeting_end);

    // IMPORTANT: Check canceled status FIRST - canceled classes stay canceled regardless of time
    if (classItem.status === 'canceled' || classItem.status === 'cancelled') {
        return { priority: 4, effectiveStatus: 'canceled' };
    }

    // Check if class has started (between start and end time)
    const hasStarted = now >= meetingStart && now <= meetingEnd;

    // Check if class has ended
    const hasEnded = now > meetingEnd;

    // Status priority: started (1), pending (2), ended (3), cancelled (4)
    if (hasStarted) {
        return { priority: 1, effectiveStatus: 'started' };
    } else if (classItem.status === 'pending' || (classItem.status === 'scheduled' && !hasEnded)) {
        return { priority: 2, effectiveStatus: 'pending' };
    } else if (hasEnded || classItem.status === 'completed') {
        return { priority: 3, effectiveStatus: 'ended' };
    } else {
        // Default case
        return { priority: 2, effectiveStatus: 'pending' };
    }
}

const getClassSummary = async (req, res) => {
    try {
        let { date_from, date_to, is_present, sort_by, sort_order = "desc", page, limit, exportAll, student_search, teacher_search } = req.query;

        const pageNum = Math.max(parseInt(page));
        const pageSize = Math.min(Math.max(parseInt(limit)), 100);
        const offset = (pageNum - 1) * pageSize;

        if (date_from) date_from = date_from.trim();
        if (date_to) date_to = date_to.trim();
        if (is_present) is_present = is_present.trim();

        const whereClause = {};
        const studentWhere = {};
        const teacherWhere = {};

        if (date_from || date_to) {
            whereClause.meeting_start = {};

            if (date_from) {
                const parsedDateFrom = moment(date_from, 'YYYY-MM-DD', true);
                whereClause.meeting_start[Op.gte] = parsedDateFrom.startOf('day').toDate();
            }

            if (date_to) {
                const parsedDateTo = moment(date_to, 'YYYY-MM-DD', true);
                whereClause.meeting_start[Op.lte] = parsedDateTo.endOf('day').toDate();
            }
        }

        if (is_present !== undefined && is_present !== 'all') {
            whereClause.is_present = is_present === 'present' ? 1 : 0;
        }

        // Smart search on student (name/email/mobile) if provided
        if (student_search && String(student_search).trim()) {
            const term = String(student_search).trim();
            studentWhere[Op.or] = [
                { full_name: { [Op.like]: `%${term}%` } },
                { email: { [Op.like]: `%${term}%` } },
                { mobile: { [Op.like]: `%${term}%` } }
            ];
        }

        // Smart search on teacher (name/email) if provided
        if (teacher_search && String(teacher_search).trim()) {
            const term = String(teacher_search).trim();
            teacherWhere[Op.or] = [
                { full_name: { [Op.like]: `%${term}%` } },
                { email: { [Op.like]: `%${term}%` } }
            ];
        }

        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'country_code'],
                    where: Object.keys(studentWhere).length > 0 ? studentWhere : undefined,
                    required: false
                },
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name'],
                    where: Object.keys(teacherWhere).length > 0 ? teacherWhere : undefined,
                    required: false
                }
            ]
        });

        const summaryMap = {};

        for (const cls of classes) {
            const student = cls.Student;
            const teacher = cls.Teacher;

            if (!student) {
                continue;
            }

            const key = student.id;

            if (!summaryMap[key]) {
                summaryMap[key] = {
                    studentName_and_email: [student.full_name, student.email],
                    studentMobile: student.country_code
                        ? `${student.country_code}${student.mobile || ''}`
                        : student.mobile,
                    count: 0,
                    teacherNames: new Set()
                };
            }

            summaryMap[key].count += 1;

            if (teacher) {
                summaryMap[key].teacherNames.add(teacher.full_name);
            }
        }

        // Fetch earliest subscription for each student
        const studentIds = Object.keys(summaryMap);

        const subs = await UserSubscriptionDetails.findAll({
            where: { user_id: studentIds },
            attributes: ['user_id', 'created_at'],
            order: [['created_at', 'ASC']],
            raw: true
        });

        // Group earliest sub by user_id
        const earliestSubByUser = {};
        subs.forEach((s) => {
            if (!earliestSubByUser[s.user_id]) {
                earliestSubByUser[s.user_id] = s.created_at;
            }
        });


        // const data = Object.values(summaryMap).map((item) => {
        //     const result = {
        //         studentName_and_email: item.studentName_and_email,
        //         studentMobile:item.studentMobile,
        //         teacherNames: Array.from(item.teacherNames)
        //     };

        //     if (is_present === '1') {
        //         result.attendedClasses = item.count;
        //     } else if (is_present === '0') {
        //         result.missedClasses = item.count;
        //     } else {
        //         result.missedClasses = item.count;
        //     }

        //     return result;
        // });

        const data = Object.entries(summaryMap).map(([userId, item]) => {

            // ⭐ Compute Learning Duration using subscription table
            let learningDuration = "1";
            const subStart = earliestSubByUser[userId];

            if (subStart) {
                const months = Math.max(
                    1,
                    Math.ceil(moment().diff(moment(subStart), "months", true))
                );
                learningDuration = `${months}`;
            }

            const result = {
                studentName_and_email: item.studentName_and_email,
                studentMobile: item.studentMobile,
                teacherNames: Array.from(item.teacherNames),
                learningDuration // ⭐ new column
            };

            if (is_present === 1) {
                result.attendedClasses = item.count;
            } else if (is_present === 0) {
                result.missedClasses = item.count;
            } else {
                result.missedClasses = item.count;
            }

            return result;
        });

        if (sort_by === "count") {
            data.sort((a, b) => {
                const valA = a.attendedClasses ?? a.missedClasses ?? 0;
                const valB = b.attendedClasses ?? b.missedClasses ?? 0;
                return sort_order === "asc" ? valA - valB : valB - valA;
            });
        }

        const total = data.length;
        const paginatedData = data.slice(offset, offset + pageSize);
        if (exportAll == 'true') {
            return res.status(200).json({
                status: 'success',
                message:
                    is_present === '1' ? 'Summary for present classes fetched successfully' : is_present === '0' ? 'Summary for absent classes fetched successfully' : 'Class summary fetched successfully',
                data
            });
        } else {
            return res.status(200).json({
                status: 'success',
                message:
                    is_present === '1' ? 'Summary for present classes fetched successfully' : is_present === '0' ? 'Summary for absent classes fetched successfully' : 'Class summary fetched successfully',
                data: paginatedData,
                pagination: {
                    total,
                    page: pageNum,
                    limit: pageSize,
                    pages: Math.ceil(total / pageSize)
                }
            });
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: 'error',
            message: "Internal server error"
        });
    }
};

module.exports = {
    getClasses,
    getClassById,
    createClass,
    updateClass,
    cancelClass,
    deleteClass,
    getClassConflicts,
    resolveConflict,
    getClassStats,
    getStudentsForDropdown,
    getTeachersForDropdown,
    checkAvailability,
    exportClasses,
    getClassSummary,
};
