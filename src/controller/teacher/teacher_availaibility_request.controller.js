const TeacherAvailability = require('../../models/teacherAvailability');
const ChangeRequest = require('../../models/TeacherAvailabilityChangeRequest');
const RegularClass = require('../../models/regularClass');
const Class = require('../../models/classes');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const User = require('../../models/users');
const TrialClassRegistration = require('../../models/trialClassRegistration');

/**
 * Helper function to normalize day format
 * Converts "Mon", "MON", "monday" → "mon"
 */
const normalizeDayFormat = (day) => {
    const dayMap = {
        'sun': 'sun', 'sunday': 'sun',
        'mon': 'mon', 'monday': 'mon',
        'tue': 'tue', 'tuesday': 'tue',
        'wed': 'wed', 'wednesday': 'wed',
        'thu': 'thu', 'thursday': 'thu',
        'fri': 'fri', 'friday': 'fri',
        'sat': 'sat', 'saturday': 'sat'
    };
    
    const normalized = day.toLowerCase();
    return dayMap[normalized] || normalized.substring(0, 3);
};

/**
 * Helper function to get day of week from UTC datetime
 * Returns lowercase day abbreviation (mon, tue, etc.)
 */
const getDayOfWeekUTC = (utcDatetime) => {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[moment.utc(utcDatetime).day()];
};

/**
 * Convert a time + day from student timezone to UTC
 * @param {string} day - Day of week (e.g., "mon", "tue")
 * @param {string} time - Time in HH:mm format
 * @param {string} studentTimezone - Student's timezone (e.g., "Asia/Jerusalem")
 * @returns {object} { day: string, time: string } in UTC
 */
const convertDayTimeToUTC = (day, time, studentTimezone) => {
    // Map day abbreviations to day numbers (0=Sunday, 1=Monday, etc.)
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const dayNum = dayMap[day.toLowerCase()];
    
    // Find the next occurrence of this day in student's timezone
    const now = moment.tz(studentTimezone);
    let targetDate = moment.tz(studentTimezone).day(dayNum);
    
    // If we've already passed that day this week, move to next week
    if (targetDate.isBefore(now)) {
        targetDate.add(7, 'days');
    }
    
    // Set the time
    const [hours, minutes] = time.split(':').map(Number);
    targetDate.hours(hours).minutes(minutes).seconds(0);
    
    // Convert to UTC
    const utcMoment = targetDate.utc();
    
    return {
        day: getDayOfWeekUTC(utcMoment),
        time: utcMoment.format('HH:mm')
    };
};

/**
 * Request a schedule change with proper conflict detection
 * 
 * DATA ARCHITECTURE:
 * - Teacher removes slots in UTC format
 * - Classes.meeting_start is stored in UTC
 * - RegularClass stores times in STUDENT's timezone (needs conversion!)
 */
const requestScheduleChange = async (req, res) => {
    const user_id = req.user.id;
    const { 
        changes,           // Array of changes with UTC times
        effective_from, 
        teacher_note, 
        timezone           // Teacher's timezone for reference
    } = req.body;

    try {
        // ====================================
        // 1. VALIDATE INPUT
        // ====================================
        if (!effective_from) {
            return res.status(400).json({
                status: 'error',
                message: 'effective_from date is required'
            });
        }

        const effectiveDate = moment.utc(effective_from);
        if (!effectiveDate.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid effective_from date format'
            });
        }

        if (effectiveDate.isBefore(moment.utc().startOf('day'))) {
            return res.status(400).json({
                status: 'error',
                message: 'effective_from must be a future date'
            });
        }

        if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No changes provided'
            });
        }

        for (const change of changes) {
            if (!change.day || !change.time || 
                typeof change.previous !== 'boolean' || 
                typeof change.updated !== 'boolean') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid change format. Each change must have: day, time, previous, updated'
                });
            }
        }

        const teacherTimezone = timezone || 'UTC';

        // ====================================
        // 2. COMPUTE DIFFERENCES (times are in UTC)
        // ====================================
        const added = [];
        const dropped = [];
        const diffSummary = {};

        for (const change of changes) {
            const { day, time, previous, updated } = change;
            const normalizedDay = normalizeDayFormat(day);

            if (!diffSummary[normalizedDay]) {
                diffSummary[normalizedDay] = { added: [], removed: [] };
            }

            if (!previous && updated) {
                added.push({ day: normalizedDay, time });
                diffSummary[normalizedDay].added.push(time);
            }

            if (previous && !updated) {
                dropped.push({ day: normalizedDay, time });
                diffSummary[normalizedDay].removed.push(time);
            }
        }

        console.log('📊 Original Changes Summary:', {
            added: added.length,
            dropped: dropped.length,
            diffSummary
        });

        // ====================================
        // 2.5. CHECK FOR DUPLICATE PENDING REQUESTS
        // ====================================
        const existingPendingRequests = await ChangeRequest.findAll({
            where: {
                user_id,
                admin_approval: 'pending'
            }
        });

        let filteredAdded = [...added];
        let filteredDropped = [...dropped];
        const duplicateSlots = {
            added: [],
            dropped: []
        };

        if (existingPendingRequests.length > 0) {
            for (const pendingRequest of existingPendingRequests) {
                let pendingAdded = [];
                let pendingDropped = [];
                
                try {
                    pendingAdded = typeof pendingRequest.added === 'string' 
                        ? JSON.parse(pendingRequest.added) 
                        : (pendingRequest.added || []);
                } catch (e) {
                    console.error('Error parsing pending added:', e);
                    pendingAdded = [];
                }
                
                try {
                    pendingDropped = typeof pendingRequest.dropped === 'string' 
                        ? JSON.parse(pendingRequest.dropped) 
                        : (pendingRequest.dropped || []);
                } catch (e) {
                    console.error('Error parsing pending dropped:', e);
                    pendingDropped = [];
                }
                
                // Check for overlapping added slots
                added.forEach(slot => {
                    const isDuplicate = pendingAdded.some(pSlot => 
                        pSlot.day === slot.day && pSlot.time === slot.time
                    );
                    if (isDuplicate && !duplicateSlots.added.some(d => d.day === slot.day && d.time === slot.time)) {
                        duplicateSlots.added.push({
                            day: slot.day,
                            time: slot.time,
                            pending_request_id: pendingRequest.id
                        });
                    }
                });
                
                // Check for overlapping dropped slots
                dropped.forEach(slot => {
                    const isDuplicate = pendingDropped.some(pSlot => 
                        pSlot.day === slot.day && pSlot.time === slot.time
                    );
                    if (isDuplicate && !duplicateSlots.dropped.some(d => d.day === slot.day && d.time === slot.time)) {
                        duplicateSlots.dropped.push({
                            day: slot.day,
                            time: slot.time,
                            pending_request_id: pendingRequest.id
                        });
                    }
                });
            }

            // ✅ NEW: Filter out duplicate slots instead of rejecting entire request
            if (duplicateSlots.added.length > 0 || duplicateSlots.dropped.length > 0) {
                console.log('⚠️ Duplicate slots detected:', duplicateSlots);

                // Filter out duplicates from added slots
                filteredAdded = added.filter(slot => {
                    return !duplicateSlots.added.some(d => 
                        d.day === slot.day && d.time === slot.time
                    );
                });

                // Filter out duplicates from dropped slots
                filteredDropped = dropped.filter(slot => {
                    return !duplicateSlots.dropped.some(d => 
                        d.day === slot.day && d.time === slot.time
                    );
                });

                // ✅ NEW: If ALL slots are duplicates, reject the request
                if (filteredAdded.length === 0 && filteredDropped.length === 0) {
                    const formatSlots = (slots) => {
                        return slots.map(s => `${s.day} ${s.time}`).join(', ');
                    };

                    let message = 'Selected slots already have pending requests: ';
                    const parts = [];
                    
                    if (duplicateSlots.added.length > 0) {
                        parts.push(`adding: ${formatSlots(duplicateSlots.added)}`);
                    }
                    if (duplicateSlots.dropped.length > 0) {
                        parts.push(`removing: ${formatSlots(duplicateSlots.dropped)}`);
                    }
                    
                    message += parts.join(' and ');
                    message += '. Please wait for admin approval or cancel the existing requests first.';

                    return res.status(400).json({
                        status: 'error',
                        message: message,
                        duplicate_slots: duplicateSlots,
                        pending_request_ids: [
                            ...new Set([
                                ...duplicateSlots.added.map(s => s.pending_request_id),
                                ...duplicateSlots.dropped.map(s => s.pending_request_id)
                            ])
                        ]
                    });
                }

                console.log('✅ Filtered changes:', {
                    original_added: added.length,
                    filtered_added: filteredAdded.length,
                    original_dropped: dropped.length,
                    filtered_dropped: filteredDropped.length,
                    duplicates_removed: duplicateSlots.added.length + duplicateSlots.dropped.length
                });
            }
        }

        // ✅ NEW: Use filtered slots for the rest of the logic
        const finalAdded = filteredAdded;
        const finalDropped = filteredDropped;

        // ✅ NEW: Rebuild diffSummary with filtered slots
        const finalDiffSummary = {};
        finalAdded.forEach(slot => {
            if (!finalDiffSummary[slot.day]) {
                finalDiffSummary[slot.day] = { added: [], removed: [] };
            }
            finalDiffSummary[slot.day].added.push(slot.time);
        });
        finalDropped.forEach(slot => {
            if (!finalDiffSummary[slot.day]) {
                finalDiffSummary[slot.day] = { added: [], removed: [] };
            }
            finalDiffSummary[slot.day].removed.push(slot.time);
        });

        // ====================================
        // 3. CONFLICT DETECTION (with filtered slots)
        // ====================================
        const conflicts = [];
        let has_conflicts = false;

        if (finalDropped.length > 0) {
            // Check scheduled classes
            const startDate = moment.utc().startOf('day');
            const endDate = moment.utc().add(60, 'days').endOf('day');

            const futureClasses = await Class.findAll({
                where: {
                    teacher_id: user_id,
                    status: { 
                        [Op.notIn]: ['completed', 'cancelled', 'canceled'] 
                    },
                    meeting_start: {
                        [Op.between]: [startDate.toDate(), endDate.toDate()]
                    }
                },
                order: [['meeting_start', 'ASC']]
            });

            const droppedSlotsMap = new Map();
            finalDropped.forEach(slot => {
                const key = `${slot.day}_${slot.time}`;
                droppedSlotsMap.set(key, slot);
            });

            for (const futureClass of futureClasses) {
                const classMoment = moment.utc(futureClass.meeting_start);
                const classDay = getDayOfWeekUTC(classMoment);
                const classTimeUTC = classMoment.format('HH:mm');
                const lookupKey = `${classDay}_${classTimeUTC}`;

                if (droppedSlotsMap.has(lookupKey)) {
                    has_conflicts = true;
                    
                    const alreadyAdded = conflicts.some(
                        c => c.type === 'scheduled_class' && c.class_id === futureClass.id
                    );

                    if (!alreadyAdded) {
                        conflicts.push({
                            type: 'scheduled_class',
                            class_id: futureClass.id,
                            student_id: futureClass.student_id,
                            day: classDay,
                            time: classTimeUTC,
                            datetime: futureClass.meeting_start,
                            status: futureClass.status,
                            batch_id: futureClass.batch_id
                        });
                    }
                }
            }

            // Check regular classes
            const regularClasses = await RegularClass.findAll({
                where: {
                    teacher_id: user_id
                }
            });

            for (const regClass of regularClasses) {
                const regDay = normalizeDayFormat(regClass.day);
                const regTime = regClass.start_time;
                const studentTimezone = regClass.timezone || 'UTC';

                let utcDay = regDay;
                let utcTime = regTime;

                if (studentTimezone && studentTimezone !== 'UTC') {
                    const converted = convertDayTimeToUTC(regDay, regTime, studentTimezone);
                    utcDay = converted.day;
                    utcTime = converted.time;
                }

                const lookupKey = `${utcDay}_${utcTime}`;

                if (droppedSlotsMap.has(lookupKey)) {
                    has_conflicts = true;
                    
                    const alreadyAdded = conflicts.some(
                        c => c.type === 'regular_class' && c.class_id === regClass.id
                    );

                    if (!alreadyAdded) {
                        conflicts.push({
                            type: 'regular_class',
                            class_id: regClass.id,
                            student_id: regClass.student_id,
                            day: utcDay,
                            time: utcTime,
                            original_day: regDay,
                            original_time: regTime,
                            student_timezone: studentTimezone,
                            batch_id: regClass.batch_id
                        });
                    }
                }
            }
        }

        // ====================================
        // 4. SAVE CHANGE REQUEST
        // ====================================
        const request = await ChangeRequest.create({
            user_id,
            admin_approval: 'pending',
            added: finalAdded,
            dropped: finalDropped,
            changes_summary: finalDiffSummary,
            teacher_note: teacher_note || null,
            admin_feedback_note: null,
            effective_from: effectiveDate.toDate(),
            has_conflicts,
            conflict_details: conflicts
        });

        console.log(`✅ Change request created:`, {
            request_id: request.id,
            has_conflicts,
            conflict_count: conflicts.length,
            effective_from: effectiveDate.format('YYYY-MM-DD'),
            added_count: finalAdded.length,
            dropped_count: finalDropped.length,
            duplicates_skipped: (duplicateSlots.added.length + duplicateSlots.dropped.length)
        });

        // ====================================
        // 5. SEND RESPONSE
        // ====================================
        const hasDuplicates = duplicateSlots.added.length > 0 || duplicateSlots.dropped.length > 0;
        
        let responseMessage = has_conflicts 
            ? 'Schedule change request submitted with conflicts. Admin approval required.'
            : 'Schedule change request submitted successfully.';

        // ✅ NEW: Add duplicate warning to message
        if (hasDuplicates) {
            const formatSlots = (slots) => slots.map(s => `${s.day} ${s.time}`).join(', ');
            const duplicateParts = [];
            
            if (duplicateSlots.added.length > 0) {
                duplicateParts.push(`${formatSlots(duplicateSlots.added)}`);
            }
            if (duplicateSlots.dropped.length > 0) {
                duplicateParts.push(`${formatSlots(duplicateSlots.dropped)}`);
            }
            
            responseMessage += ` Note: ${duplicateParts.join(', ')} ${duplicateSlots.added.length + duplicateSlots.dropped.length === 1 ? 'was' : 'were'} skipped (already pending).`;
        }

        return res.status(200).json({
            status: 'success',
            message: responseMessage,
            data: {
                request_id: request.id,
                has_conflicts,
                conflict_count: conflicts.length,
                conflicts: conflicts,
                summary: finalDiffSummary,
                effective_from: effectiveDate.format('YYYY-MM-DD'),
                breakdown: {
                    scheduled_classes: conflicts.filter(c => c.type === 'scheduled_class').length,
                    regular_classes: conflicts.filter(c => c.type === 'regular_class').length
                },
                // ✅ NEW: Include duplicate information in response
                duplicates_skipped: hasDuplicates ? {
                    count: duplicateSlots.added.length + duplicateSlots.dropped.length,
                    slots: duplicateSlots,
                    pending_request_ids: [
                        ...new Set([
                            ...duplicateSlots.added.map(s => s.pending_request_id),
                            ...duplicateSlots.dropped.map(s => s.pending_request_id)
                        ])
                    ]
                } : null
            }
        });

    } catch (err) {
        console.error('❌ Error in requestScheduleChange:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Error submitting schedule change request',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
};
/**
 * Get teacher's schedule change requests
 */
const getTeacherScheduleRequests = async (req, res) => { 
    try {
        const teacher_id = req.user.id;

        const {
            status = 'all',
            page = 1,
            limit = 20
        } = req.query;

        const offset = (page - 1) * limit;
        const whereClause = { user_id: teacher_id };

        if (status !== 'all') {
            whereClause.admin_approval = status;
        }

        const results = await ChangeRequest.findAndCountAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            offset: parseInt(offset),
            limit: parseInt(limit)
        });

        // Parse JSON fields for response
        const formattedResults = results.rows.map((r) => {
            let added = [];
            let dropped = [];
            let summary = {};
            let conflictDetails = [];

            try {
                added = typeof r.added === 'string' ? JSON.parse(r.added) : (r.added || []);
            } catch (e) {
                console.error('Error parsing added:', e);
            }

            try {
                dropped = typeof r.dropped === 'string' ? JSON.parse(r.dropped) : (r.dropped || []);
            } catch (e) {
                console.error('Error parsing dropped:', e);
            }

            try {
                summary = typeof r.changes_summary === 'string' ? JSON.parse(r.changes_summary) : (r.changes_summary || {});
            } catch (e) {
                console.error('Error parsing changes_summary:', e);
            }

            try {
                conflictDetails = typeof r.conflict_details === 'string' ? JSON.parse(r.conflict_details) : (r.conflict_details || []);
            } catch (e) {
                console.error('Error parsing conflict_details:', e);
            }

            return {
                id: r.id,
                added: added,
                dropped: dropped,
                summary: summary,
                teacher_note: r.teacher_note,
                admin_feedback: r.admin_feedback_note,
                effective_from: r.effective_from,
                status: r.admin_approval,
                has_conflicts: r.has_conflicts,
                conflict_details: conflictDetails,
                created_at: r.created_at,
                updated_at: r.updated_at
            };
        });

        return res.status(200).json({
            status: 'success',
            total: results.count,
            page: Number(page),
            limit: Number(limit),
            data: formattedResults
        });

    } catch (err) {
        console.error('❌ Error in getTeacherScheduleRequests:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch schedule change requests',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
};

/**
 * Enhanced Preview Schedule Change Impact
 * 
 * Returns structured data showing:
 * - Affected students
 * - Regular classes with their scheduled class counts
 * - All scheduled classes grouped by pattern
 */

/**
 * Preview the impact of removing availability slots
 * Shows which students/classes would be affected
 * 
 * ENHANCED: Now includes trial classes in the impact analysis
 */
const previewScheduleChangeImpact = async (req, res) => {
    const user_id = req.user.id;
    const { changes, effective_from } = req.body;

    try {
        // Validate input
        if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No changes provided'
            });
        }

        // Validate and parse effective_from date
        if (!effective_from) {
            return res.status(400).json({
                status: 'error',
                message: 'effective_from date is required'
            });
        }

        const effectiveDate = moment.utc(effective_from).startOf('day');
        if (!effectiveDate.isValid()) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid effective_from date format'
            });
        }

        // Calculate end date (60 days from effective date)
        const endDate = moment.utc(effectiveDate).add(60, 'days').endOf('day');

        console.log('📅 Date range for impact calculation:', {
            effective_from: effectiveDate.format('YYYY-MM-DD'),
            end_date: endDate.format('YYYY-MM-DD'),
            days_span: 60
        });

        // Extract only REMOVED slots
        const removedSlots = [];
        changes.forEach(({ day, time, previous, updated }) => {
            if (previous && !updated) {
                const normalizedDay = normalizeDayFormat(day);
                removedSlots.push({ day: normalizedDay, time });
            }
        });

        if (removedSlots.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No slots removed - no impact',
                data: {
                    affected_students: [],
                    total_affected_students: 0,
                    total_affected_classes: 0,
                    total_future_occurrences: 0,
                    breakdown: {
                        regular_classes: 0,
                        scheduled_classes: 0,
                        future_occurrences: 0
                    }
                }
            });
        }

        // Create a map for faster lookup
        const removedSlotsMap = new Map();
        removedSlots.forEach(slot => {
            const key = `${slot.day}_${slot.time}`;
            removedSlotsMap.set(key, slot);
        });

        // ============================================
        // 1. CHECK REGULAR CLASSES (Recurring)
        // ============================================
        const regularClasses = await RegularClass.findAll({
            where: { teacher_id: user_id },
            include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'email']
            }]
        });

        const affectedRegularClasses = [];
        
        for (const regClass of regularClasses) {
            const studentTimezone = regClass.timezone || 'UTC';
            const regDay = normalizeDayFormat(regClass.day);
            const regTime = regClass.start_time;
            
            // Convert student's local time to UTC
            const utcTime = convertDayTimeToUTC(regDay, regTime, studentTimezone);
            const lookupKey = `${utcTime.day}_${utcTime.time}`;

            if (removedSlotsMap.has(lookupKey)) {
                // ✅ UPDATED: Query Classes table for actual scheduled classes
                const actualScheduledClasses = await Class.findAll({
                    where: {
                        teacher_id: user_id,
                        student_id: regClass.student_id,
                        batch_id: regClass.batch_id,
                        status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
                        meeting_start: {
                            [Op.between]: [effectiveDate.toDate(), endDate.toDate()]
                        },
                        demo_class_id: null  // Exclude demo/trial classes
                    },
                    order: [['meeting_start', 'ASC']]
                });

                // ✅ Filter to only include classes that match the day/time pattern
                const matchingClasses = actualScheduledClasses.filter(cls => {
                    const classMoment = moment.utc(cls.meeting_start);
                    const classDay = getDayOfWeekUTC(classMoment);
                    const classTime = classMoment.format('HH:mm');
                    return classDay === utcTime.day && classTime === utcTime.time;
                });

                // ✅ Format the matching classes
                const futureOccurrences = matchingClasses.map(cls => {
                    const classMoment = moment.utc(cls.meeting_start);
                    return {
                        class_id: cls.id,
                        date: classMoment.format('YYYY-MM-DD'),
                        datetime: cls.meeting_start,
                        day_of_week: classMoment.format('dddd'),
                        formatted: classMoment.format('MMM DD, YYYY'),
                        time: classMoment.format('HH:mm'),
                        status: cls.status
                    };
                });

                console.log(`📊 Regular class impact:`, {
                    student_id: regClass.student_id,
                    pattern: `${regDay} ${regTime}`,
                    timezone: studentTimezone,
                    utc_pattern: `${utcTime.day} ${utcTime.time}`,
                    actual_scheduled_count: matchingClasses.length,
                    dates: futureOccurrences.map(f => f.date)
                });

                affectedRegularClasses.push({
                    type: 'regular',
                    class_id: regClass.id,
                    student_id: regClass.student_id,
                    student_name: regClass.Student?.full_name || 'Unknown',
                    student_email: regClass.Student?.email || '',
                    day: regDay,
                    time: regTime,
                    timezone: regClass.timezone,
                    batch_id: regClass.batch_id,
                    utc_day: utcTime.day,
                    utc_time: utcTime.time,
                    // ✅ ACTUAL scheduled classes from database
                    future_occurrences_count: matchingClasses.length,
                    future_occurrence_dates: futureOccurrences
                });
            }
        }

        // ============================================
        // 2. CHECK OTHER SCHEDULED CLASSES (not part of recurring pattern)
        // ============================================
        const futureClasses = await Class.findAll({
            where: {
                teacher_id: user_id,
                status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
                meeting_start: {
                    [Op.between]: [effectiveDate.toDate(), endDate.toDate()]
                },
                demo_class_id: null  // Exclude demo/trial classes - they're shown separately in affected_trial_classes
            },
            include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'email']
            }],
            order: [['meeting_start', 'ASC']]
        });

        // ✅ Create a set of class_ids that are already counted in regular classes
        const alreadyCountedClassIds = new Set();
        affectedRegularClasses.forEach(regClass => {
            regClass.future_occurrence_dates.forEach(occ => {
                alreadyCountedClassIds.add(occ.class_id);
            });
        });

        const affectedScheduledClasses = [];

        for (const futureClass of futureClasses) {
            // Skip if already counted in regular classes
            if (alreadyCountedClassIds.has(futureClass.id)) {
                continue;
            }

            const classMoment = moment.utc(futureClass.meeting_start);
            const classDay = getDayOfWeekUTC(classMoment);
            const classTime = classMoment.format('HH:mm');
            const lookupKey = `${classDay}_${classTime}`;

            if (removedSlotsMap.has(lookupKey)) {
                affectedScheduledClasses.push({
                    type: 'scheduled',
                    class_id: futureClass.id,
                    student_id: futureClass.student_id,
                    student_name: futureClass.Student?.full_name || 'Unknown',
                    student_email: futureClass.Student?.email || '',
                    meeting_start: futureClass.meeting_start,
                    day: classDay,
                    time: classTime,
                    status: futureClass.status,
                    batch_id: futureClass.batch_id,
                    formatted_date: classMoment.format('YYYY-MM-DD')
                });
            }
        }

        // ============================================
        // 2B. CHECK TRIAL CLASSES
        // ============================================
        const futureTrialClasses = await TrialClassRegistration.findAll({
            where: {
                teacher_id: user_id,
                status: { [Op.in]: ['pending', 'confirmed'] },
                meeting_start: {
                    [Op.between]: [effectiveDate.toDate(), endDate.toDate()]
                }
            },
            order: [['meeting_start', 'ASC']]
        });

        const affectedTrialClasses = [];

        for (const trialClass of futureTrialClasses) {
            const classMoment = moment.utc(trialClass.meeting_start);
            const classDay = getDayOfWeekUTC(classMoment);
            const classTime = classMoment.format('HH:mm');
            const lookupKey = `${classDay}_${classTime}`;

            if (removedSlotsMap.has(lookupKey)) {
                affectedTrialClasses.push({
                    type: 'trial',
                    trial_class_id: trialClass.id,
                    student_name: trialClass.student_name,
                    parent_name: trialClass.parent_name,
                    student_email: trialClass.email,
                    student_mobile: trialClass.mobile,
                    country_code: trialClass.country_code,
                    age: trialClass.age,
                    meeting_start: trialClass.meeting_start,
                    day: classDay,
                    time: classTime,
                    status: trialClass.status,
                    trial_class_status: trialClass.trial_class_status,
                    formatted_date: classMoment.format('YYYY-MM-DD')
                });
            }
        }

        // ============================================
        // 3. AGGREGATE BY STUDENT
        // ============================================
        const studentImpactMap = new Map();

        // Process regular classes with their actual scheduled classes
        affectedRegularClasses.forEach(cls => {
            if (!studentImpactMap.has(cls.student_id)) {
                studentImpactMap.set(cls.student_id, {
                    student_id: cls.student_id,
                    student_name: cls.student_name,
                    student_email: cls.student_email,
                    regular_classes_affected: [],
                    scheduled_classes_affected: [],
                    total_affected: 0,
                    total_future_occurrences: 0
                });
            }

            const studentData = studentImpactMap.get(cls.student_id);
            studentData.regular_classes_affected.push({
                class_id: cls.class_id,
                day: cls.day,
                time: cls.time,
                timezone: cls.timezone,
                batch_id: cls.batch_id,
                utc_day: cls.utc_day,
                utc_time: cls.utc_time,
                // Actual scheduled classes from database
                future_occurrences_count: cls.future_occurrences_count,
                future_occurrence_dates: cls.future_occurrence_dates
            });
            studentData.total_affected++;
            studentData.total_future_occurrences += cls.future_occurrences_count;
        });

        // Process standalone scheduled classes (not part of recurring pattern)
        affectedScheduledClasses.forEach(cls => {
            if (!studentImpactMap.has(cls.student_id)) {
                studentImpactMap.set(cls.student_id, {
                    student_id: cls.student_id,
                    student_name: cls.student_name,
                    student_email: cls.student_email,
                    regular_classes_affected: [],
                    scheduled_classes_affected: [],
                    total_affected: 0,
                    total_future_occurrences: 0
                });
            }

            const studentData = studentImpactMap.get(cls.student_id);
            studentData.scheduled_classes_affected.push({
                class_id: cls.class_id,
                meeting_start: cls.meeting_start,
                day: cls.day,
                time: cls.time,
                status: cls.status,
                batch_id: cls.batch_id,
                formatted_date: cls.formatted_date
            });
            studentData.total_affected++;
            studentData.total_future_occurrences++; // Each standalone class counts as 1
        });

        // Group and enhance student data
        const affectedStudents = Array.from(studentImpactMap.values()).map(student => {
            const groupedScheduled = {};
            
            student.scheduled_classes_affected.forEach(scheduled => {
                const pattern = `${scheduled.day}_${scheduled.time}`;
                if (!groupedScheduled[pattern]) {
                    groupedScheduled[pattern] = {
                        day: scheduled.day,
                        time: scheduled.time,
                        count: 0,
                        classes: []
                    };
                }
                groupedScheduled[pattern].count++;
                groupedScheduled[pattern].classes.push({
                    class_id: scheduled.class_id,
                    meeting_start: scheduled.meeting_start,
                    formatted_date: scheduled.formatted_date,
                    status: scheduled.status
                });
            });

            // Add grouped scheduled classes to regular classes
            const regularWithCounts = student.regular_classes_affected.map(regular => {
                const pattern = `${regular.utc_day}_${regular.utc_time}`;
                const scheduledInfo = groupedScheduled[pattern] || { count: 0, classes: [] };
                
                return {
                    ...regular,
                    scheduled_count: scheduledInfo.count,
                    scheduled_classes: scheduledInfo.classes
                };
            });

            return {
                ...student,
                regular_classes_affected: regularWithCounts,
                grouped_scheduled: groupedScheduled
            };
        }).sort((a, b) => b.total_future_occurrences - a.total_future_occurrences);

        // Calculate totals
        const totalFutureOccurrences = affectedStudents.reduce(
            (sum, student) => sum + student.total_future_occurrences, 
            0
        );

        // ============================================
        // 4. SEND ENHANCED RESPONSE
        // ============================================
        return res.status(200).json({
            status: 'success',
            message: affectedStudents.length > 0 || affectedTrialClasses.length > 0
                ? `${affectedStudents.length} student(s) and ${affectedTrialClasses.length} trial class(es) will be affected`
                : 'No students will be affected',
            data: {
                affected_students: affectedStudents,
                affected_trial_classes: affectedTrialClasses,
                total_affected_students: affectedStudents.length,
                total_affected_trial_classes: affectedTrialClasses.length,
                total_affected_classes: affectedRegularClasses.length + affectedScheduledClasses.length,
                total_future_occurrences: totalFutureOccurrences,
                breakdown: {
                    regular_classes: affectedRegularClasses.length,
                    scheduled_classes: affectedScheduledClasses.length,
                    trial_classes: affectedTrialClasses.length,
                    future_occurrences: totalFutureOccurrences
                },
                date_range: {
                    effective_from: effectiveDate.format('YYYY-MM-DD'),
                    end_date: endDate.format('YYYY-MM-DD'),
                    days: 60
                },
                summary: {
                    removed_slots: removedSlots.map(slot => ({
                        day: slot.day,
                        time: slot.time,
                        affected_students: affectedStudents.filter(s => 
                            s.regular_classes_affected.some(r => 
                                r.utc_day === slot.day && r.utc_time === slot.time
                            ) ||
                            s.scheduled_classes_affected.some(sc => 
                                sc.day === slot.day && sc.time === slot.time
                            )
                        ).length,
                        affected_trial_classes: affectedTrialClasses.filter(t =>
                            t.day === slot.day && t.time === slot.time
                        ).length
                    }))
                }
            }
        });

    } catch (err) {
        console.error('❌ Error in previewScheduleChangeImpact:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Error previewing schedule change impact',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
};

module.exports = {
    requestScheduleChange,
    getTeacherScheduleRequests,
    previewScheduleChangeImpact,
};