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
const PaymentTransaction = require('../../models/PaymentTransaction');
const SalesAgentReview = require('../../models/salesAgentReview');
const { whatsappReminderAddClass, whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { getTimezoneForCountry } = require('../../utils/countryTimezones');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const { classDeletionLogger } = require('../../utils/classDeletionLogger');
const UserOccupation = require('../../models/usersOccupation');

/**
 * Get trial lessons aggregated by day and language within a date range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllSalesAgent = async (req, res) => {
    try {
        const salesAgent = await User.findAll({
            where: {
                [Op.or]: [{ role_name: 'sales_appointment_setter' }, { role_name: 'sales_role' }]
            }
        });
        return res.status(200).json({
            success: true,
            data: salesAgent
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get trial lessons aggregated by day and language within a date range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getAllTrialSetters = async (req, res) => {
    try {
        const trialSetters = await Salesperson.findAll({
            where: { role_type: 'sales_appointment_setter' } // adjust based on your DB role name
        });

        return res.status(200).json({
            success: true,
            data: trialSetters
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
};
/**
 * Get trial lessons aggregated by day and language within a date range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getTrialLessons = async (req, res) => {
    try {
        const { timeRange, customStartDate, customEndDate } = req.query;

        // Validate timeRange
        const validRanges = ['all_time', 'today', 'week', 'month', 'custom'];
        if (timeRange && !validRanges.includes(timeRange)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeRange',
                details: `Allowed values are: ${validRanges.join(', ')}`
            });
        }

        // Validate custom dates
        if (timeRange === 'custom') {
            if (!customStartDate || !customEndDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing custom date range',
                    details: 'Both customStartDate and customEndDate are required when timeRange = custom'
                });
            }
            if (!moment(customStartDate, 'YYYY-MM-DD', true).isValid() || !moment(customEndDate, 'YYYY-MM-DD', true).isValid()) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date format',
                    details: 'Use YYYY-MM-DD format for customStartDate and customEndDate'
                });
            }
        }

        // Build date range
        let startDate, endDate;
        if (timeRange === 'all_time') {
            startDate = null;
            endDate = null;
        } else if (timeRange === 'today') {
            startDate = moment().startOf('day');
            endDate = moment().endOf('day');
        } else if (timeRange === 'week') {
            startDate = moment().startOf('week');
            endDate = moment().endOf('week');
        } else if (timeRange === 'month') {
            startDate = moment().startOf('month');
            endDate = moment().endOf('month');
        } else if (timeRange === 'custom') {
            startDate = moment(customStartDate).startOf('day');
            endDate = moment(customEndDate).endOf('day');
        } else {
            startDate = moment().startOf('week');
            endDate = moment().endOf('week');
        }

        if (timeRange !== 'all_time' && startDate.isAfter(endDate)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date range',
                details: 'customStartDate cannot be after customEndDate'
            });
        }

        // Date filter
        const whereClause = {};
        if (timeRange !== 'all_time') {
            whereClause.meeting_start = {
                [Op.between]: [startDate.toDate(), endDate.toDate()]
            };
        }

        // Fetch trial class registrations and their ended demo classes
        const trialClasses = await TrialClassRegistration.findAll({
            where: whereClause,
            attributes: ['id', 'teacher_id', 'language'],
            include: [
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'demo_class_id', 'is_present', 'status', 'meeting_start'],
                    required: true,
                    where: { status: 'ended' } // ✅ only count finished demo classes
                }
            ]
        });

        // Aggregate by date & language
        const dailyData = {};
        const seen = new Set();

        // Fetch all teacher language skills in bulk
        const teacherIds = trialClasses.map((tc) => tc.teacher_id).filter(Boolean);

        const allTeacherSkills = await UserOccupation.findAll({
            where: {
                user_id: { [Op.in]: teacherIds },
                type: 'also_speaks'
            }
        });

        // Group skills by teacher ID
        const skillsMap = {};
        allTeacherSkills.forEach((skill) => {
            if (!skillsMap[skill.user_id]) skillsMap[skill.user_id] = [];
            skillsMap[skill.user_id].push((skill.value || '').toLowerCase());
        });

        // Fill missing days for non-all_time
        trialClasses.forEach((tc) => {
            const cls = tc.trialClass;
            if (!cls || !cls.demo_class_id) return;
            if (seen.has(cls.id)) return;
            seen.add(cls.id);

            const dateKey = moment(cls.meeting_start).format('YYYY-MM-DD');
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { date: dateKey, multiLanguage: 0, englishOnly: 0 };
            }

            // -------------------------
            // NEW TEACHER LANGUAGE LOGIC
            // -------------------------
            const teacherId = tc.teacher_id;
            const langs = skillsMap[teacherId] || [];

            const uniqueLangs = [...new Set(langs)];

            // const isEnglishOnly = uniqueLangs.length === 1 && uniqueLangs[0] === 'english';
            const isEnglishOnly =
            uniqueLangs.length === 0 || (uniqueLangs.length === 1 && uniqueLangs[0] === "english");

            if (isEnglishOnly) {
                dailyData[dateKey].englishOnly += 1;
            } else {
                dailyData[dateKey].multiLanguage += 1;
            }
        });

        const formattedData = [];
        if (timeRange === 'all_time') {
            Object.keys(dailyData)
                .sort()
                .forEach((key) => formattedData.push(dailyData[key]));
        } else {
            let current = startDate.clone();
            while (current.isSameOrBefore(endDate, 'day')) {
                const key = current.format('YYYY-MM-DD');
                formattedData.push(dailyData[key] || { date: key, multiLanguage: 0, englishOnly: 0 });
                current.add(1, 'day');
            }
        }

        return res.json({
            success: true,
            data: formattedData
        });
    } catch (error) {
        console.error('Error in getTrialLessons:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
};

/** * Get trial class completion stats aggregated by day within a date range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getTrialCompletion = async (req, res) => {
    try {
        const { timeRange, customStartDate, customEndDate } = req.query;

        // Validate timeRange
        const validRanges = ['today', 'week', 'month', 'custom', 'all_time'];
        if (timeRange && !validRanges.includes(timeRange)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeRange',
                details: `Allowed values are: ${validRanges.join(', ')}`
            });
        }

        // Validate custom dates if provided
        if (timeRange === 'custom') {
            if (!customStartDate || !customEndDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing custom date range',
                    details: 'Both customStartDate and customEndDate are required when timeRange = custom'
                });
            }
            if (!moment(customStartDate, 'YYYY-MM-DD', true).isValid() || !moment(customEndDate, 'YYYY-MM-DD', true).isValid()) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date format',
                    details: 'Use YYYY-MM-DD format for customStartDate and customEndDate'
                });
            }
        }

        // Build date filter
        let startDate, endDate;
        if (timeRange === 'all_time') {
            // No date restriction
            startDate = null;
            endDate = null;
        } else if (timeRange === 'today') {
            startDate = moment().startOf('day');
            endDate = moment().endOf('day');
        } else if (timeRange === 'week') {
            startDate = moment().startOf('week');
            endDate = moment().endOf('week');
        } else if (timeRange === 'month') {
            startDate = moment().startOf('month');
            endDate = moment().endOf('month');
        } else if (timeRange === 'custom') {
            startDate = moment(customStartDate).startOf('day');
            endDate = moment(customEndDate).endOf('day');
        } else {
            // Default = this week
            startDate = moment().startOf('week');
            endDate = moment().endOf('week');
        }

        if (timeRange !== 'all_time' && startDate.isAfter(endDate)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date range',
                details: 'customStartDate cannot be after customEndDate'
            });
        }

        // 4️⃣ Build query filter
        const whereClause = {};
        if (timeRange !== 'all_time') {
            whereClause.meeting_start = {
                [Op.between]: [startDate.toDate(), endDate.toDate()]
            };
        }

        const trialClasses = await TrialClassRegistration.findAll({
            include: [
                {
                    model: Class,
                    as: 'classInfo',
                    attributes: ['id', 'demo_class_id', 'is_present', 'meeting_start', 'status'],
                    required: true, // only demo-linked classes
                    where: {
                        status: 'ended', // ✅ only finished classes
                        meeting_start: {
                            [Op.between]: [startDate.toDate(), endDate.toDate()]
                        }
                    }
                }
            ]
        });

        // 6️⃣ Aggregate by date
        const dailyData = {};
        const seen = new Set();

        trialClasses.forEach((tc) => {
            const cls = tc.classInfo;
            if (!cls || !cls.demo_class_id) return; // skip non-trial classes
            if (cls.status !== 'ended') return; // ✅ ignore ongoing/future classes

            const dateKey = moment(cls.meeting_start).format('YYYY-MM-DD');
            if (!dailyData[dateKey]) dailyData[dateKey] = { date: dateKey, completed: 0, missed: 0 };

            // normalize attendance
            const present = cls.is_present === 1 || cls.is_present === '1' || cls.is_present === true;

            // prevent duplicates
            if (seen.has(cls.id)) return;
            seen.add(cls.id);

            if (present) dailyData[dateKey].completed += 1;
            else dailyData[dateKey].missed += 1;
        });

        // 7️⃣ Format output
        const formattedData = [];

        if (timeRange === 'all_time') {
            // 🆕 Return only actual data points (no fake zero days)
            Object.keys(dailyData)
                .sort()
                .forEach((key) => formattedData.push(dailyData[key]));
        } else {
            // Fill missing days for limited ranges
            let current = startDate.clone();
            while (current.isSameOrBefore(endDate, 'day')) {
                const key = current.format('YYYY-MM-DD');
                formattedData.push(dailyData[key] || { date: key, completed: 0, missed: 0 });
                current.add(1, 'day');
            }
        }

        // 8️⃣ Respond
        return res.json({
            success: true,
            data: formattedData
        });
    } catch (error) {
        console.error('Error in getTrialCompletion:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get all trial classes for admin management with all filters
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
            agent_type,
            evaluation_status,
            sales_agent_id,
            booked_by_role,
            booked_by,
            transfer_status,
            sort_by,
            all_time,
            sort_direction = 'desc',
            booked_by_agent, // NEW: Filter by original booker
            current_agent // NEW: Filter by current assigned agent
        } = req.query;

        console.log('quuery', req.query);

        const whereClause = {};
        let classWhereClause = {};
        let evaluationWhereClause = {};
        let needsPostQueryFiltering = false;

        // Handle both regular status and trial_class_status filters
        if (status) {
            // Check if the status matches any trial_class_status enum values
            const trialClassStatuses = [
                'trial_1',
                'trial_2',
                'trial_2_paid',
                'trial_3',
                'trial_3_paid',
                'waiting_for_answer',
                'payment_sent',
                'new_enroll',
                'follow_up',
                'not_relevant',
                'waiting_for_payment'
            ];

            if (trialClassStatuses.includes(status)) {
                whereClause.trial_class_status = status;
            } else if (status === 'missed') {
                // Handle "Didn't Attend" status
                classWhereClause.is_present = false;
            } else {
                whereClause.status = status;
            }
        }

        // Teacher filter
        if (teacher_id && teacher_id !== 'all') {
            whereClause.teacher_id = teacher_id;
        }

        // ===============================
        // 🧩 Unified Date Filter (aligned with getDashboardMetrics)
        // ===============================
        if (all_time === 'true' || all_time === true) {
            console.log('All-time mode active — skipping meeting_start filter');
        } else if (start_date && end_date) {
            whereClause.meeting_start = {
                [Op.between]: [moment.utc(start_date).startOf('day').toISOString(), moment.utc(end_date).endOf('day').toISOString()]
            };
        } else {
            // Default: current month (for alignment)
            const defaultStart = moment.utc().startOf('month');
            const defaultEnd = moment.utc().endOf('month');
            whereClause.meeting_start = {
                [Op.between]: [defaultStart.toISOString(), defaultEnd.toISOString()]
            };
        }

        if (added_start_date && added_end_date) {
            whereClause.created_at = {
                [Op.between]: [moment.utc(added_start_date).startOf('day').toISOString(), moment.utc(added_end_date).endOf('day').toISOString()]
            };
        }

        // Search filter
        if (search) {
            whereClause[Op.or] = [{ student_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }, { mobile: { [Op.like]: `%${search}%` } }];
        }

        // Handle attendance filter
        if (attendance) {
            if (attendance === 'attended') {
                classWhereClause.is_present = true;
            } else if (attendance === 'missed') {
                classWhereClause.is_present = false;
            } else if (attendance === 'late') {
                classWhereClause.is_present = 3;
            }
        }

        // Filter by sales agent if specified
        // if (sales_agent_id) {
        //     classWhereClause.booked_by_admin_id = sales_agent_id;
        // }
        // if (sales_agent_id && sales_agent_id !== 'all') {
        //     const agentIds = sales_agent_id.split(',').map((id) => parseInt(id.trim()));
        //     classWhereClause.booked_by_admin_id = {
        //         [Op.in]: agentIds
        //     };
        // }

        // // Filter by appointment setters (trial_setters = admin IDs)
        // if (req.query.trial_setters && req.query.trial_setters !== 'all') {
        //     const setterIds = req.query.trial_setters.split(',').map((id) => parseInt(id.trim()));

        //     classWhereClause.booked_by_admin_id = {
        //         [Op.in]: setterIds
        //     };
        // }

        // // Filter by agent type if specified
        // if (agent_type && agent_type !== 'all') {
        //     if (agent_type === 'agent') {
        //         classWhereClause.booked_by = 'sales_appointment_setter';
        //     } else if (agent_type === 'sales') {
        //         classWhereClause.booked_by = 'sales_role';
        //     }
        // }

        let bookedByAdminIds = [];

        // Sales agents
        if (sales_agent_id && sales_agent_id !== 'all') {
            bookedByAdminIds.push(...sales_agent_id.split(',').map((id) => parseInt(id.trim())));
        }

        // Trial setters
        if (req.query.trial_setters && req.query.trial_setters !== 'all') {
            bookedByAdminIds.push(...req.query.trial_setters.split(',').map((id) => parseInt(id.trim())));
        }

        // Current agent
        if (current_agent && current_agent !== 'all') {
            const agentObj = await User.findOne({
                where: { full_name: current_agent },
                attributes: ['id']
            });
            if (agentObj) bookedByAdminIds.push(agentObj.id);
        }

        // Apply combined filter
        if (bookedByAdminIds.length > 0) {
            classWhereClause.booked_by_admin_id = {
                [Op.in]: bookedByAdminIds
            };
        }

        // Filter by booking role if specified
        if (booked_by_role) {
            classWhereClause.booked_by = booked_by_role;
        }

        // Transfer status filter
        if (transfer_status && transfer_status !== 'all') {
            if (transfer_status === 'transferred') {
                whereClause[Op.or] = [{ transfer_status: 'transferred' }, { transfer_status: 'transfer_accepted' }, { transferred_to: { [Op.ne]: null } }];
            } else if (transfer_status === 'not_transferred') {
                whereClause[Op.and] = [
                    {
                        [Op.or]: [{ transfer_status: null }, { transfer_status: { [Op.notIn]: ['transferred', 'transfer_accepted'] } }]
                    },
                    {
                        [Op.or]: [{ transferred_to: null }, { transferred_to: { [Op.eq]: null } }]
                    }
                ];
            }
        }

        // NEW: Current agent filter
        if (current_agent && current_agent !== 'all') {
            // Filter by current sales agent assigned to the trial class
            // This checks the booked_by_admin_id in the Class table
            const currentAgentSubquery = await User.findOne({
                where: { full_name: current_agent },
                attributes: ['id']
            });

            if (currentAgentSubquery) {
                classWhereClause.booked_by_admin_id = currentAgentSubquery.id;
            } else {
                // If agent not found, return no results
                classWhereClause.booked_by_admin_id = -1;
            }
        }

        // Define include models for the query
        const includeModels = [
            {
                model: User,
                as: 'teacher',
                attributes: ['id', 'full_name', 'email', 'avatar']
            },
            {
                model: Class,
                as: 'trialClass',
                attributes: ['is_present', 'status', 'booked_by', 'booked_by_admin_id'],
                where: Object.keys(classWhereClause).length > 0 ? classWhereClause : null,
                required: Object.keys(classWhereClause).length > 0 ? true : false
            },
            {
                model: User,
                as: 'salesAgent',
                attributes: ['id', 'full_name', 'email', 'role_name', 'avatar']
            },
            {
                model: TrialClassStatusHistory,
                as: 'statusHistory',
                attributes: ['id', 'previous_status', 'new_status', 'changed_by_id', 'changed_by_type', 'notes', 'attendance_change', 'created_at'],
                include: [
                    {
                        model: User,
                        as: 'changedBy',
                        attributes: ['id', 'full_name', 'role_name']
                    }
                ],
                order: [['created_at', 'DESC']]
            },
            {
                model: TrialClassEvaluation,
                as: 'evaluation',
                attributes: ['id', 'plan_recommendation', 'send_evaluation', 'pdf_file', 'description', 'student_level', 'created_at', 'updated_at'],
                where: Object.keys(evaluationWhereClause).length > 0 ? evaluationWhereClause : null,
                required: false // Default to LEFT JOIN
            }
        ];


        if (booked_by && booked_by !== 'all') {
            const names = booked_by.split(',').map((n) => n.trim());

            // 1) Filter using root WHERE with $include.field$ syntax
            whereClause['$statusHistory.changedBy.full_name$'] = {
                [Op.in]: names
            };

            // 2) Find and update the include model
            const shInclude = includeModels.find((m) => m.as === 'statusHistory');

            // Only match the ORIGINAL booking entry
            shInclude.where = {
                previous_status: { [Op.or]: [null, ''] }
            };

            // Must be INNER JOIN for filtering to work
            shInclude.required = true;
        }

        // Handle evaluation status filter
        if (evaluation_status) {
            if (evaluation_status === 'sent') {
                const evaluationIndex = includeModels.findIndex((model) => model.as === 'evaluation');
                if (evaluationIndex !== -1) {
                    includeModels[evaluationIndex].required = true;
                }
            } else if (evaluation_status === 'pending') {
                needsPostQueryFiltering = true;
            }
        }

        // Prepare replacements for parameterized queries
        const replacements = {};
        if (booked_by_agent && booked_by_agent !== 'all') {
            replacements.bookedByAgent = booked_by_agent;
        }

        // STEP 1: Fetch ALL data without limit/offset to get correct ordering
        const allRows = await TrialClassRegistration.findAll({
            where: whereClause,
            include: includeModels,
            // Simple ordering by meeting_start for initial fetch
            attributes: {
                include: [[Sequelize.literal("DATE_FORMAT(TrialClassRegistration.meeting_start, '%Y-%m-%d %H:%i:%s')"), 'meeting_start_raw']]
            },
            order: [['meeting_start', 'DESC']],
            distinct: true,
            replacements
        });

        // Post-query filtering for 'pending' evaluations if needed
        let filteredRows = allRows;
        if (needsPostQueryFiltering && evaluation_status === 'pending') {
            filteredRows = allRows.filter((trial) => !trial.evaluation);
        }

        // STEP 2: Sort ALL data by class status priority (matching teacher classes)
        let sortedAllRows;

        // Check if custom sorting is requested
        if (sort_by && sort_direction && sort_by !== 'classStatus') {
            // Apply custom sorting but maintain status priority as secondary
            sortedAllRows = filteredRows.sort((a, b) => {
                // Custom sorting logic based on sort_by parameter
                let compareValue = 0;

                switch (sort_by) {
                    case 'studentName':
                        compareValue = a.student_name.localeCompare(b.student_name);
                        break;
                    case 'trialDateTime':
                        compareValue = new Date(a.meeting_start) - new Date(b.meeting_start);
                        break;
                    case 'teacher':
                        const teacherA = a.teacher?.full_name || 'Unassigned';
                        const teacherB = b.teacher?.full_name || 'Unassigned';
                        compareValue = teacherA.localeCompare(teacherB);
                        break;
                    case 'status':
                        compareValue = (a.trial_class_status || '').localeCompare(b.trial_class_status || '');
                        break;
                    case 'createdAt':
                        compareValue = new Date(a.created_at) - new Date(b.created_at);
                        break;
                    default:
                        compareValue = 0;
                }

                return sort_direction.toLowerCase() === 'asc' ? compareValue : -compareValue;
            });
        } else {
            // Default: Sort by class status priority (matching teacher classes exactly)
            sortedAllRows = filteredRows.sort((a, b) => {
                const statusA = a.trialClass?.status || 'unknown';
                const statusB = b.trialClass?.status || 'unknown';

                // Define status priority (matching teacher classes exactly)
                const getStatusPriority = (status) => {
                    switch (status) {
                        case 'started':
                            return 0;
                        case 'pending':
                            return 1;
                        case 'ended':
                            return 2;
                        case 'canceled':
                            return 3;
                        default:
                            return 4;
                    }
                };

                const priorityA = getStatusPriority(statusA);
                const priorityB = getStatusPriority(statusB);

                // First sort by status priority
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }

                // Then sort by meeting_start (most recent first) within same status
                return new Date(b.meeting_start) - new Date(a.meeting_start);
            });
        }

        // STEP 3: Apply pagination AFTER sorting all data
        const totalCount = sortedAllRows.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedRows = sortedAllRows.slice(startIndex, endIndex);

        // STEP 4: Format trial classes with complete data
        const formattedTrials = await Promise.all(
            paginatedRows.map(async (trial) => {
                const trialJson = trial.toJSON();
                // const trialMoment = moment.utc(trialJson.meeting_start);
                // const trialMoment = moment(trialJson.meeting_start).format("YYYY-MM-DD HH:mm:ss");
                const trialMoment = trialJson.meeting_start;
                // Extract attendance status
                let attendance = '1'; // Default: present
                if (trialJson.trialClass) {
                    if (trialJson.trialClass.is_present === true) {
                        attendance = '1'; // Present
                    } else if (trialJson.trialClass.is_present === false) {
                        attendance = '0'; // Absent
                    } else if (trialJson.trialClass.is_present === 3) {
                        attendance = '3'; // Late
                    }
                }

                // Format status history
                const statusHistory =
                    trialJson.statusHistory?.map((history) => ({
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

                // Get sales agent info from the Class booked_by_admin_id
                let salesAgentInfo = null;
                if (trialJson.trialClass && trialJson.trialClass.booked_by_admin_id) {
                    const salesAgent = await User.findByPk(trialJson.trialClass.booked_by_admin_id, {
                        attributes: ['id', 'full_name', 'email', 'role_name']
                    });
                    if (salesAgent) {
                        salesAgentInfo = {
                            id: salesAgent.id,
                            name: salesAgent.full_name,
                            email: salesAgent.email,
                            role: salesAgent.role_name
                        };
                    }
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
                    parentName: trialJson.parent_name,
                    email: trialJson.email,
                    phone: trialJson.mobile,
                    age: trialJson.age,
                    addedDate: moment(trialJson.created_at).format('YYYY-MM-DD'),
                    teacher: trialJson.teacher
                        ? {
                              id: trialJson.teacher.id,
                              name: trialJson.teacher.full_name,
                              avatar: trialJson.teacher.avatar || null
                          }
                        : {
                              id: null,
                              name: 'Unassigned',
                              avatar: null
                          },
                    // trialDateTime: trialMoment.format('YYYY-MM-DD HH:mm'),
                    trialDateTime: trialMoment,
                    // dayOfWeek: trialMoment.format('dddd'),
                    dayOfWeek: trialMoment,
                    teacherName: trialJson.teacher ? trialJson.teacher.full_name : 'Unassigned',
                    teacherId: trialJson.teacher_id,
                    status: trialJson.status === 'pending' ? 'Trial Class' : trialJson.status,
                    trial_class_status: trialJson.trial_class_status,
                    attendance,
                    evaluation: evaluationData ? evaluationData.studentLevel : 'No Eval',
                    statusHistory,
                    evaluationData,
                    salesAgent: salesAgentInfo,
                    bookedByRole: trialJson.trialClass?.booked_by || null,
                    language: trialJson.language,
                    description: trialJson.description,

                    // Add complete objects for detailed operations
                    trialClassRegistration: completeTrialRegistration,
                    class: completeClass
                };
            })
        );

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
        console.error('Error in admin getTrialClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific trial class by ID for admin
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
                    attributes: ['id', 'full_name', 'email', 'mobile', 'timezone']
                },
                {
                    model: Class,
                    as: 'trialClass',
                    attributes: ['id', 'status', 'join_url', 'zoom_id', 'is_present', 'booked_by', 'booked_by_admin_id']
                },
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email', 'role_name']
                },
                {
                    model: TrialClassStatusHistory,
                    as: 'statusHistory',
                    include: [
                        {
                            model: User,
                            as: 'changedBy',
                            attributes: ['id', 'full_name', 'role_name']
                        }
                    ],
                    order: [['created_at', 'DESC']]
                },
                {
                    model: TrialClassEvaluation,
                    as: 'evaluation'
                }
            ]
        });

        if (!trialClass) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found'
            });
        }

        // Get sales agent info if available
        let salesAgentInfo = null;
        if (trialClass.trialClass && trialClass.trialClass.booked_by_admin_id) {
            const salesAgent = await User.findByPk(trialClass.trialClass.booked_by_admin_id, {
                attributes: ['id', 'full_name', 'email', 'role_name']
            });
            if (salesAgent) {
                salesAgentInfo = {
                    id: salesAgent.id,
                    name: salesAgent.full_name,
                    email: salesAgent.email,
                    role: salesAgent.role_name
                };
            }
        }

        // Format the response
        const trialMoment = moment.utc(trialClass.meeting_start);

        let attendance = 'pending';
        if (trialClass.trialClass) {
            if (trialClass.trialClass.is_present === true) {
                attendance = 'attended';
            } else if (trialClass.trialClass.is_present === false) {
                attendance = 'missed';
            } else if (trialClass.trialClass.is_present === 3) {
                attendance = 'late';
            }
        }

        const formattedTrialClass = {
            id: trialClass.id,
            studentName: trialClass.student_name,
            parentName: trialClass.parent_name,
            email: trialClass.email,
            phone: trialClass.mobile,
            age: trialClass.age,
            addedDate: moment(trialClass.created_at).format('YYYY-MM-DD'),
            trialDateTime: trialMoment.format('YYYY-MM-DD HH:mm'),
            dayOfWeek: trialMoment.format('dddd'),
            teacher: trialClass.teacher
                ? {
                      id: trialClass.teacher.id,
                      name: trialClass.teacher.full_name,
                      email: trialClass.teacher.email,
                      phone: trialClass.teacher.mobile,
                      timezone: trialClass.teacher.timezone
                  }
                : null,
            status: trialClass.status,
            trial_class_status: trialClass.trial_class_status,
            language: trialClass.language,
            description: trialClass.description,
            joinUrl: trialClass.trialClass ? trialClass.trialClass.join_url : null,
            zoomId: trialClass.trialClass ? trialClass.trialClass.zoom_id : null,
            attendance,
            salesAgent: salesAgentInfo,
            bookedByRole: trialClass.trialClass?.booked_by || null,
            statusHistory:
                trialClass.statusHistory?.map((history) => ({
                    id: history.id,
                    timestamp: moment(history.created_at).format('YYYY-MM-DD HH:mm'),
                    previousStatus: history.previous_status,
                    newStatus: history.new_status,
                    changedBy: history.changedBy?.full_name || 'System',
                    changedByRole: history.changed_by_type,
                    notes: history.notes,
                    attendanceChange: history.attendance_change
                })) || [],
            evaluation: trialClass.evaluation
                ? {
                      id: trialClass.evaluation.id,
                      planRecommendation: trialClass.evaluation.plan_recommendation,
                      sendStatus: trialClass.evaluation.send_evaluation,
                      pdfFile: trialClass.evaluation.pdf_file,
                      description: trialClass.evaluation.description,
                      studentLevel: trialClass.evaluation.student_level,
                      createdAt: moment(trialClass.evaluation.created_at).format('YYYY-MM-DD HH:mm'),
                      updatedAt: moment(trialClass.evaluation.updated_at).format('YYYY-MM-DD HH:mm')
                  }
                : null
        };

        return res.status(200).json({
            status: 'success',
            data: formattedTrialClass
        });
    } catch (error) {
        console.error('Error in admin getTrialClassById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update trial class details (admin version)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTrialClass = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const updateData = req.body;

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
                attributes: ['id', 'full_name', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code', 'timezone', 'notification_channels'],
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

            if (duration !== 25) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Trial class must be exactly 25 minutes'
                });
            }

            // Check availability
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
                        [Op.notIn]: ['cancelled', 'rejected']
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
        if (updateData.lead_source || updateData.calls_made || updateData.call_duration || updateData.notes) {
            await Salesperson.update(
                {
                    lead_source: updateData.lead_source,
                    calls_made: updateData.calls_made,
                    call_duration: updateData.call_duration,
                    notes: updateData.notes
                },
                {
                    where: {
                        class_id: trialClass.class_id,
                        action_type: 'trial_class'
                    },
                    transaction
                }
            );
        }

        // Create status history if status changed
        if (updateData.trial_class_status && updateData.trial_class_status !== previousStatus) {
            await TrialClassStatusHistory.create(
                {
                    trial_class_id: trialClass.id,
                    previous_status: previousStatus,
                    new_status: updateData.trial_class_status,
                    changed_by_id: req.user.id,
                    changed_by_type: req.user.role_name,
                    notes: updateData.status_change_notes || 'Status updated by admin'
                },
                { transaction }
            );
        }

        await transaction.commit();

        // Fetch updated record with all associations
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
                    attributes: ['id', 'status', 'join_url', 'zoom_id', 'is_present']
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
            message: 'Trial class updated successfully',
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

        console.error('Error in admin updateTrialClass:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete trial class registration (admin version)
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
        const student = await User.findOne({
            where: {
                [Op.or]: [{ id: trialClass.student_id }, { email: trialClass.email }]
            },
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
            deleted_by_role: 'admin',
            deletion_source: 'admin_panel',
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
                        cancellation_reason: 'Trial class cancelled via admin panel',
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
                cancellation_reason: 'Trial class cancelled via admin panel',
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
                changed_by_type: req.user.role_name || 'admin',
                notes: 'Trial class cancelled via admin panel'
            },
            { transaction }
        );

        // Commit the transaction
        await transaction.commit();

        // Log the cancellation
        console.info(`Trial class ${id} cancelled successfully by admin user ${req.user.id}`);

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
                deleted_by_role: 'admin',
                deletion_reason: 'Cancelled as part of trial class cancellation',
                deletion_source: 'admin_panel',
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

        console.error('Error in admin deleteTrialClass:', error);

        // Log deletion error
        classDeletionLogger.logTrialClassDeletion({
            trial_class_id: req.params.id ? parseInt(req.params.id) : null,
            class_id: null,
            student_id: null,
            student_name: 'Unknown',
            teacher_id: null,
            deleted_by: req.user?.id || null,
            deleted_by_role: 'admin',
            deletion_source: 'admin_panel',
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
 * Update trial class status with notes (admin version)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTrialClassStatus = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { new_status, status_change_notes } = req.body;

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
        await trialClass.update(
            {
                trial_class_status: new_status,
                status_change_notes: status_change_notes || null,
                updated_at: new Date()
            },
            { transaction }
        );

        // Create status history entry
        await TrialClassStatusHistory.create(
            {
                trial_class_id: trialClass.id,
                previous_status: previousStatus,
                new_status: new_status,
                changed_by_id: req.user.id,
                changed_by_type: req.user.role_name,
                notes: status_change_notes || null,
                created_at: new Date()
            },
            { transaction }
        );

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
                    include: [
                        {
                            model: User,
                            as: 'changedBy',
                            attributes: ['id', 'full_name', 'role_name']
                        }
                    ]
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

        console.error('Error in admin updateTrialClassStatus:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Cancel a trial class (admin version)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const cancelTrialClass = async (req, res) => {
    let transaction;

    try {
        transaction = await sequelize.transaction();

        const { id } = req.params;
        const { cancellation_reason } = req.body;

        // FIX 1: Add safety check for req.user
        if (!req.user || !req.user.id) {
            if (transaction) await transaction.rollback();
            return res.status(401).json({
                status: 'error',
                message: 'User authentication required. Please ensure you are logged in.'
            });
        }

        const cancelledBy = req.user.id;
        const cancelledAt = moment.utc().toDate();

        // Input validation
        if (!id || isNaN(Number(id))) {
            if (transaction) await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid trial class ID'
            });
        }

        if (!cancellation_reason?.trim()) {
            if (transaction) await transaction.rollback();
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

        // Update trial class registration status
        await trialClass.update(
            {
                status: 'cancelled',
                cancelled_by: cancelledBy,
                cancelled_at: cancelledAt,
                cancellation_reason,
                updated_at: moment.utc().toDate()
            },
            { transaction }
        );

        // Update associated class if exists
        if (trialClass.class_id && trialClass.trialClass) {
            await Class.update(
                {
                    status: 'canceled',
                    cancelled_by: cancelledBy,
                    cancelled_at: cancelledAt,
                    cancellation_reason,
                    join_url: null, // Remove join URL
                    updated_at: moment.utc().toDate()
                },
                {
                    where: { id: trialClass.class_id },
                    transaction
                }
            );
        }

        // Update salesperson activity if exists
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

        // Create status history entry
        await TrialClassStatusHistory.create(
            {
                trial_class_id: trialClass.id,
                previous_status: trialClass.trial_class_status,
                new_status: 'cancelled',
                changed_by_id: req.user.id,
                changed_by_type: req.user.role_name || 'admin', // FIX 2: Add fallback for role_name
                notes: `Cancelled by admin: ${cancellation_reason}`
            },
            { transaction }
        );

        // Commit the transaction
        await transaction.commit();

        // Log the cancellation
        console.info(`Trial class ${id} cancelled by admin user ${cancelledBy}. Reason: ${cancellation_reason}`);

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
                    attributes: ['id', 'status', 'join_url', 'zoom_id', 'cancelled_by', 'cancelled_at', 'cancellation_reason']
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

        console.error('Error in admin cancelTrialClass:', error);

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get dashboard metrics for admin trial management
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getDashboardMetrics = async (req, res) => {
    try {
        const { start_date, end_date, trial_setters, sales_agents, all_time } = req.query;

        let startDate, endDate;

        console.log('dates', req.query);

        if (all_time === 'true' || all_time === true) {
            console.log('All-time mode active — skipping meeting_start filter');
        } else if (start_date && end_date) {
            startDate = moment.utc(start_date).startOf('day');
            endDate = moment.utc(end_date).endOf('day');
        } else {
            // Default = current month for consistency
            startDate = moment.utc().startOf('month');
            endDate = moment.utc().endOf('month');
        }

        const trialSetterIds = trial_setters && trial_setters !== 'all' ? trial_setters.split(',').map((id) => parseInt(id.trim())) : null;

        const salesAgentIds = sales_agents && sales_agents !== 'all' ? sales_agents.split(',').map((id) => parseInt(id.trim())) : null;

        const baseFilter = {
            status: { [Op.notIn]: ['cancelled'] }
        };

        // Apply date filter only if not all_time
        if (!(all_time === 'true' || all_time === true)) {
            baseFilter.meeting_start = {
                [Op.between]: [startDate.toISOString(), endDate.toISOString()]
            };
        }

        const agentFilter = {};

        // Combine trial setter and sales agent filters (both map to booked_by)
        if (trialSetterIds && salesAgentIds) {
            // Intersection
            baseFilter.booked_by = {
                [Op.in]: trialSetterIds.filter((id) => salesAgentIds.includes(id))
            };
            agentFilter.booked_by = {
                [Op.in]: trialSetterIds.filter((id) => salesAgentIds.includes(id))
            };
        } else if (trialSetterIds) {
            baseFilter.booked_by = { [Op.in]: trialSetterIds };
            agentFilter.booked_by = { [Op.in]: trialSetterIds };
        } else if (salesAgentIds) {
            baseFilter.booked_by = { [Op.in]: salesAgentIds };
            agentFilter.booked_by = { [Op.in]: salesAgentIds };
        }

        const convertedTrials = await TrialClassRegistration.findAll({
            attributes: ['id', 'email'],
            where: {
                ...baseFilter,
                status: 'converted',
                trial_class_status: 'new_enroll'
            },
            raw: true
        });

        const trialIds = convertedTrials.map((t) => t.id);
        const trialEmails = convertedTrials.map((t) => t.email).filter(Boolean);

        // ==============================
        // 5️⃣ Calculate Metrics
        // ==============================
        const now = moment.utc().toISOString();

        const buildDateFilter = (field) => {
            if (all_time === 'true') return {}; // No date filter if all_time
            return {
                [field]: {
                    [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                }
            };
        };

        console.log('completed base filter');

        // const completedTrials = await TrialClassRegistration.count({
        //     where: {
        //         ...baseFilter,
        //         status: { [Op.in]: ['completed', 'converted'] },
        //         ...buildDateFilter('meeting_start')
        //     }
        // });

        const completedTrials = await TrialClassRegistration.count({
            where: {
                ...agentFilter,
                status: { [Op.in]: ['completed', 'converted'] },
                meeting_start: {
                    [Op.lt]: moment.utc().toISOString(),
                    ...(all_time === 'true'
                        ? {}
                        : {
                              [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                          })
                }
            }
        });

        // ==============================
        // 🧩 Missed Trials Calculation (Based on Class Attendance)
        // ==============================
        const classFilter = {
            is_present: 0, // missed classes
            status: 'ended',
            demo_class_id: { [Op.not]: null }
        };

        // Apply date filter if not all_time
        if (!(all_time === 'true' || all_time === true)) {
            classFilter.meeting_start = {
                [Op.between]: [startDate.toISOString(), endDate.toISOString()]
            };
        }

        const missedClasses = await Class.findAll({
            attributes: ['demo_class_id'],
            where: classFilter,
            raw: true
        });

        // Extract unique demo_class_ids
        const missedDemoIds = [...new Set(missedClasses.map((c) => c.demo_class_id))];

        // Now count how many of those demo_class_ids exist in TrialClassRegistration
        // const missedTrials = missedDemoIds.length
        //     ? await TrialClassRegistration.count({
        //           where: {
        //               id: { [Op.in]: missedDemoIds },
        //               status: { [Op.in]: ['completed', 'converted', 'pending'] } // include valid trial types
        //           }
        //       })
        //     : 0;

        const missedTrials = missedDemoIds.length
            ? await TrialClassRegistration.count({
                  where: {
                      ...agentFilter,
                      id: { [Op.in]: missedDemoIds },
                      status: { [Op.in]: ['completed', 'converted', 'pending'] },
                      ...(all_time === 'true'
                          ? {}
                          : {
                                meeting_start: {
                                    [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                                }
                            })
                  }
              })
            : 0;

        const totalTrialClasses = await TrialClassRegistration.count({
            where: {
                ...baseFilter,
                status: { [Op.in]: ['pending', 'confirmed', 'completed', 'converted'] },
                ...buildDateFilter('meeting_start')
            }
        });

        console.log('basefilter', baseFilter);

        // const scheduledTrials = await TrialClassRegistration.count({
        //     where: {
        //         ...baseFilter,
        //         status: { [Op.in]: ['pending'] },
        //     }
        // });
        const nowUtc = moment.utc().toISOString();

        // const scheduledTrials = await TrialClassRegistration.count({
        //     where: {
        //         ...agentFilter,
        //         meeting_start: {
        //             [Op.gt]: nowUtc, // must be in future
        //             [Op.gte]: startDate.toISOString(), // and >= start
        //             [Op.lte]: endDate.toISOString() // and <= end
        //         }
        //     }
        // });

        const scheduledTrials = await TrialClassRegistration.count({
            where: {
                ...agentFilter,
                meeting_start: {
                    [Op.gt]: nowUtc,
                    ...(all_time === 'true'
                        ? {}
                        : {
                              [Op.gte]: startDate.toISOString(),
                              [Op.lte]: endDate.toISOString()
                          })
                }
            }
        });

        const registeredTotal = trialIds.length
            ? await TrialClassRegistration.count({
                  where: {
                      id: { [Op.in]: trialIds },
                      status: 'converted',
                      trial_class_status: 'new_enroll'
                  }
              })
            : 0;

        // 9️⃣ Monthly Sales + Total Revenue (Trial-based only)
        const [monthlySales, totalRevenueResult] = await Promise.all([
            // Count of converted trials
            TrialClassRegistration.count({
                where: {
                    id: { [Op.in]: trialIds },
                    status: 'converted',
                    trial_class_status: 'new_enroll',
                    ...(all_time === 'true'
                        ? {}
                        : {
                              updated_at: {
                                  [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                              }
                          })
                }
            }),

            // Sum of payments linked by trial emails
            PaymentTransaction.findOne({
                attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'totalRevenue']],
                where: {
                    status: 'success',
                    ...(trialEmails.length ? { student_email: { [Op.in]: trialEmails } } : { student_email: null }),
                    ...(all_time === 'true'
                        ? {}
                        : {
                              created_at: {
                                  [Op.between]: [startDate.toISOString(), endDate.toISOString()]
                              }
                          })
                },

                raw: true
            })
        ]);

        const totalRevenue = parseFloat(totalRevenueResult?.totalRevenue || 0);

        const revenueWhere = {
            status: 'success'
        };

        if (all_time !== 'true') {
            revenueWhere.created_at = {
                [Op.between]: [startDate.toISOString(), endDate.toISOString()]
            };
        }

        // Apply filters (generated_by)
        if (trialSetterIds && salesAgentIds) {
            revenueWhere.generated_by = {
                [Op.in]: trialSetterIds.filter((id) => salesAgentIds.includes(id))
            };
        } else if (trialSetterIds) {
            revenueWhere.generated_by = { [Op.in]: trialSetterIds };
        } else if (salesAgentIds) {
            revenueWhere.generated_by = { [Op.in]: salesAgentIds };
        }

        // const totalRevenueResult = await PaymentTransaction.findOne({
        //     attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'totalRevenue']],
        //     where: revenueWhere,
        //     raw: true
        // });

        const conversionRate = totalTrialClasses ? Math.min(Math.round((registeredTotal / totalTrialClasses) * 100), 100) : 0;
        const averageCompletionTime = 0; // Placeholder

        // ==============================
        // 6️⃣ Send Response
        // ==============================
        return res.status(200).json({
            success: true,
            data: {
                totalTrialClasses: { value: totalTrialClasses },
                scheduledTrials: { value: scheduledTrials },
                completedTrials: { value: completedTrials },
                missedTrials: { value: missedTrials },
                registeredTotal: { value: registeredTotal },
                conversionRate: { value: conversionRate },
                totalRevenue: { value: totalRevenue },
                monthlySales: { value: monthlySales },
                averageCompletionTime: { value: averageCompletionTime },
                period:
                    all_time === 'true'
                        ? { start: null, end: null }
                        : {
                              start: startDate.format('YYYY-MM-DD'),
                              end: endDate.format('YYYY-MM-DD')
                          }
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Get daily trial class metrics for admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getDailyTrialMetrics = async (req, res) => {
    try {
        const { date, sales_agent_id } = req.query;

        // Default to today if no date provided
        const targetDate = date ? moment.utc(date) : moment.utc();
        const startOfDay = targetDate.clone().startOf('day');
        const endOfDay = targetDate.clone().endOf('day');

        const whereClause = {
            meeting_start: {
                [Op.between]: [startOfDay.toISOString(), endOfDay.toISOString()]
            }
        };

        // Filter by sales agent if specified
        let classWhereClause = {};
        // if (sales_agent_id) {
        //     classWhereClause.booked_by_admin_id = sales_agent_id;
        // }

        // Get all trial classes for the specific date
        const trialClasses = await TrialClassRegistration.findAll({
            where: whereClause,
            include: [
                {
                    model: Class,
                    as: 'trialClass',
                    where: Object.keys(classWhereClause).length > 0 ? classWhereClause : undefined,
                    required: Object.keys(classWhereClause).length > 0 ? true : false,
                    attributes: ['id', 'is_present', 'status', 'booked_by_admin_id']
                },
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name']
                }
            ],
            attributes: ['id', 'student_name', 'meeting_start', 'meeting_end', 'trial_class_status'],
            order: [['meeting_start', 'ASC']]
        });

        // Calculate metrics
        const totalLessons = trialClasses.length;

        const completedLessons = trialClasses.filter((trial) => trial.trialClass && trial.trialClass.is_present === true).length;

        const missedLessons = trialClasses.filter((trial) => trial.trialClass && trial.trialClass.is_present === false).length;

        const lateLessons = trialClasses.filter((trial) => trial.trialClass && trial.trialClass.is_present === 3).length;

        const pendingLessons = trialClasses.filter((trial) => !trial.trialClass || trial.trialClass.is_present === null).length;

        // Get sales agent info for each lesson
        const lessonsWithDetails = await Promise.all(
            trialClasses.map(async (trial) => {
                let salesAgentInfo = null;
                if (trial.trialClass && trial.trialClass.booked_by_admin_id) {
                    const salesAgent = await User.findByPk(trial.trialClass.booked_by_admin_id, {
                        attributes: ['id', 'full_name', 'role_name']
                    });
                    if (salesAgent) {
                        salesAgentInfo = {
                            id: salesAgent.id,
                            name: salesAgent.full_name,
                            role: salesAgent.role_name
                        };
                    }
                }

                return {
                    id: trial.id,
                    studentName: trial.student_name,
                    startTime: moment.utc(trial.meeting_start).format('HH:mm'),
                    endTime: moment.utc(trial.meeting_end).format('HH:mm'),
                    teacher: trial.teacher ? trial.teacher.full_name : 'Unassigned',
                    status: trial.trialClass
                        ? trial.trialClass.is_present === true
                            ? 'completed'
                            : trial.trialClass.is_present === false
                            ? 'missed'
                            : trial.trialClass.is_present === 3
                            ? 'late'
                            : 'pending'
                        : 'pending',
                    trialStatus: trial.trial_class_status,
                    salesAgent: salesAgentInfo
                };
            })
        );

        return res.status(200).json({
            status: 'success',
            data: {
                date: targetDate.format('YYYY-MM-DD'),
                totalLessons,
                completedLessons,
                missedLessons,
                lateLessons,
                pendingLessons,
                lessons: lessonsWithDetails
            }
        });
    } catch (error) {
        console.error('Error in admin getDailyTrialMetrics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getTrialLessons,
    getTrialCompletion,
    getTrialClasses,
    getTrialClassById,
    updateTrialClass,
    deleteTrialClass,
    updateTrialClassStatus,
    cancelTrialClass,
    getDashboardMetrics,
    getDailyTrialMetrics,
    getAllSalesAgent,
    getAllTrialSetters
};
