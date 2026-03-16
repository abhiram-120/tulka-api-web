const TeacherAvailability = require('../../models/teacherAvailability');
const ChangeRequest = require('../../models/TeacherAvailabilityChangeRequest');
const RegularClass = require('../../models/regularClass');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const User = require('../../models/users');

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize day format to lowercase 3-letter abbreviation
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
 * Get day of week from UTC moment object
 */
const getDayOfWeekUTC = (utcMoment) => {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[utcMoment.day()];
};

/**
 * Convert day + time from any timezone to UTC
 */
const convertDayTimeToUTC = (day, time, timezone) => {
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const dayNum = dayMap[day.toLowerCase()];
  
  const now = moment.tz(timezone);
  let targetDate = moment.tz(timezone).day(dayNum);
  
  // If we've already passed this day this week, move to next week
  if (targetDate.isBefore(now)) {
    targetDate.add(7, 'days');
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  targetDate.hours(hours).minutes(minutes).seconds(0);
  
  const utcMoment = targetDate.utc();
  
  return {
    day: getDayOfWeekUTC(utcMoment),
    time: utcMoment.format('HH:mm')
  };
};

/**
 * Convert UTC time to local timezone
 */
const convertUTCToLocal = (time, timezone) => {
  try {
    if (!timezone) return time;

    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setUTCHours(h, m, 0, 0);

    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    });
  } catch (e) {
    console.error("Time conversion error:", time, timezone, e);
    return time;
  }
};

/**
 * Resolve weekly slot to actual datetime for conflict checking
 */
function dayToIndex(dayKey) {
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[String(dayKey).toLowerCase()];
}

function resolveWeeklySlotToDatetime(anchorDate, dayKey, timeStr, timezone) {
  const base = moment.tz(anchorDate, timezone || "UTC").startOf("day");
  const baseDow = base.day();
  const targetDow = dayToIndex(dayKey);
  if (targetDow === undefined) return null;

  let diff = targetDow - baseDow;
  const dayMoment = base.clone().add(diff, "days");

  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  dayMoment.hour(hh).minute(mm).second(0).millisecond(0);
  return dayMoment.toDate();
}

// ============================================
// MAIN CONTROLLER FUNCTIONS
// ============================================

/**
 * Preview the impact of a schedule change request
 * Shows which students and classes will be affected
 */
const previewRequestImpact = async (req, res) => {
  console.log('🚀🚀🚀 NEW CODE IS RUNNING! Request ID:', req.params.id);
  
  try {
    const request_id = req.params.id;

    // 1. Get the change request
    const changeRequest = await ChangeRequest.findOne({
      where: { id: request_id },
      include: [{
        model: User,
        as: 'teacher',
        attributes: ['id', 'full_name', 'email', 'timezone']
      }]
    });

    if (!changeRequest) {
      return res.status(404).json({
        success: false,
        message: 'Change request not found'
      });
    }

    const teacherId = changeRequest.user_id;
    const teacherTz = changeRequest.teacher?.timezone || 'UTC';

    // 2. Parse dropped slots
    let droppedSlots = changeRequest.dropped;
    try {
      if (typeof droppedSlots === 'string' && droppedSlots.trim() !== '') {
        droppedSlots = JSON.parse(droppedSlots);
      }
    } catch (e) {
      console.error('Error parsing dropped slots:', e);
      droppedSlots = [];
    }

    if (!Array.isArray(droppedSlots)) {
      droppedSlots = [];
    }

    const affectedStudentsMap = new Map();
    let totalFutureOccurrences = 0;
    const effectiveFrom = moment(changeRequest.effective_from || new Date()).startOf('day');
    const endDate = moment(effectiveFrom).add(60, 'days').endOf('day');

    console.log('📅 Impact calculation period:', {
      effective_from: effectiveFrom.format('YYYY-MM-DD'),
      end_date: endDate.format('YYYY-MM-DD'),
      teacher_id: teacherId,
      teacher_tz: teacherTz
    });

    // 3. Fetch ALL regular classes for this teacher
    const allRegularClasses = await RegularClass.findAll({
      where: { teacher_id: teacherId },
      include: [{
        model: User,
        as: 'Student',
        attributes: ['id', 'full_name', 'email', 'timezone']
      }]
    });

    console.log(`📋 Found ${allRegularClasses.length} regular class patterns`);

    // 4. For each dropped slot, find affected students
    for (const droppedSlot of droppedSlots) {
      if (!droppedSlot.day || !droppedSlot.time) continue;

      // Dropped slots are ALREADY in UTC in database, just normalize day format
      const slotInUTC = {
        day: normalizeDayFormat(droppedSlot.day),
        time: droppedSlot.time
      };

      console.log(`🔍 Processing dropped slot (already UTC):`, {
        database_value: `${droppedSlot.day} ${droppedSlot.time}`,
        normalized: `${slotInUTC.day} ${slotInUTC.time}`
      });

      // Check each regular class by converting student's time to UTC
      for (const regClass of allRegularClasses) {
        const studentTz = regClass.timezone || 'UTC';
        const regDay = normalizeDayFormat(regClass.day);
        const regTime = regClass.start_time;

        // Convert student's regular class time to UTC
        const regClassInUTC = convertDayTimeToUTC(regDay, regTime, studentTz);

        const matches = regClassInUTC.day === slotInUTC.day && regClassInUTC.time === slotInUTC.time;

        if (matches) {
          console.log(`  ✅ MATCH - Regular class affected:`, {
            student_id: regClass.student_id,
            student_local: `${regDay} ${regTime} (${studentTz})`,
            utc: `${regClassInUTC.day} ${regClassInUTC.time}`,
            batch_id: regClass.batch_id
          });

          const studentId = regClass.student_id;

          if (!affectedStudentsMap.has(studentId)) {
            affectedStudentsMap.set(studentId, {
              student_id: studentId,
              student_name: regClass.Student?.full_name || 'Unknown',
              student_email: regClass.Student?.email || '',
              student_timezone: studentTz,
              regular_classes_affected: [],
              scheduled_classes_affected: [],
              total_future_occurrences: 0
            });
          }

          // Find future scheduled classes using batch_id
          const futureClasses = await Class.findAll({
            where: {
              teacher_id: teacherId,
              student_id: studentId,
              batch_id: regClass.batch_id,
              status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
              meeting_start: {
                [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
              },
              is_trial: false // Exclude trial classes
            },
            order: [['meeting_start', 'ASC']]
          });

          // Filter to only include classes matching this exact day/time pattern
          const matchingClasses = futureClasses.filter(cls => {
            const clsMoment = moment.utc(cls.meeting_start);
            const clsDay = getDayOfWeekUTC(clsMoment);
            const clsTime = clsMoment.format('HH:mm');
            return clsDay === slotInUTC.day && clsTime === slotInUTC.time;
          });

          console.log(`    📊 Found ${matchingClasses.length} future occurrences`);

          const futureOccurrenceDates = matchingClasses.map(cls => ({
            class_id: cls.id,
            date: moment.utc(cls.meeting_start).format('YYYY-MM-DD'),
            formatted: moment.utc(cls.meeting_start).tz(teacherTz).format('MMM DD, YYYY'),
            datetime: cls.meeting_start
          }));

          affectedStudentsMap.get(studentId).regular_classes_affected.push({
            regular_class_id: regClass.id,
            day: regDay,
            time: regTime,
            timezone: studentTz,
            utc_day: slotInUTC.day,
            utc_time: slotInUTC.time,
            batch_id: regClass.batch_id,
            future_occurrences_count: matchingClasses.length,
            future_occurrence_dates: futureOccurrenceDates
          });

          affectedStudentsMap.get(studentId).total_future_occurrences += matchingClasses.length;
          totalFutureOccurrences += matchingClasses.length;
        }
      }

      // 5. Check standalone scheduled classes (not part of recurring pattern)
      const futureClasses = await Class.findAll({
        where: {
          teacher_id: teacherId,
          status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
          meeting_start: {
            [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
          },
          is_trial: false // Exclude trial classes - shown separately
        },
        include: [{
          model: User,
          as: 'Student',
          attributes: ['id', 'full_name', 'email', 'timezone']
        }]
      });

      // Get IDs of classes already counted in regular classes
      const countedClassIds = new Set();
      affectedStudentsMap.forEach(student => {
        student.regular_classes_affected.forEach(regClass => {
          regClass.future_occurrence_dates.forEach(occ => {
            countedClassIds.add(occ.class_id);
          });
        });
      });

      // Process standalone classes that aren't already counted
      for (const futureClass of futureClasses) {
        if (countedClassIds.has(futureClass.id)) continue; // Skip already counted

        const classMoment = moment.utc(futureClass.meeting_start);
        const classDay = getDayOfWeekUTC(classMoment);
        const classTime = classMoment.format('HH:mm');

        if (classDay === slotInUTC.day && classTime === slotInUTC.time) {
          console.log(`  ⚠️ Standalone class affected:`, {
            class_id: futureClass.id,
            student_id: futureClass.student_id,
            meeting_start: futureClass.meeting_start
          });

          const studentId = futureClass.student_id;

          if (!affectedStudentsMap.has(studentId)) {
            affectedStudentsMap.set(studentId, {
              student_id: studentId,
              student_name: futureClass.Student?.full_name || 'Unknown',
              student_email: futureClass.Student?.email || '',
              student_timezone: futureClass.Student?.timezone || 'UTC',
              regular_classes_affected: [],
              scheduled_classes_affected: [],
              total_future_occurrences: 0
            });
          }

          affectedStudentsMap.get(studentId).scheduled_classes_affected.push({
            class_id: futureClass.id,
            meeting_start: futureClass.meeting_start,
            day: classDay,
            time: classTime,
            status: futureClass.status,
            formatted_date: classMoment.tz(teacherTz).format('MMM DD, YYYY HH:mm')
          });

          affectedStudentsMap.get(studentId).total_future_occurrences += 1;
          totalFutureOccurrences += 1;
        }
      }
    }

    // 5B. CHECK TRIAL CLASSES
    const affectedTrialClasses = [];
    
    for (const droppedSlot of droppedSlots) {
      if (!droppedSlot.day || !droppedSlot.time) continue;

      const slotInUTC = {
        day: normalizeDayFormat(droppedSlot.day),
        time: droppedSlot.time
      };

      const futureTrialClasses = await TrialClassRegistration.findAll({
        where: {
          teacher_id: teacherId,
          status: { [Op.in]: ['pending', 'confirmed'] },
          meeting_start: {
            [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
          }
        },
        order: [['meeting_start', 'ASC']]
      });

      for (const trialClass of futureTrialClasses) {
        const classMoment = moment.utc(trialClass.meeting_start);
        const classDay = getDayOfWeekUTC(classMoment);
        const classTime = classMoment.format('HH:mm');

        if (classDay === slotInUTC.day && classTime === slotInUTC.time) {
          console.log(`  📝 Trial class affected:`, {
            trial_class_id: trialClass.id,
            student_name: trialClass.student_name,
            meeting_start: trialClass.meeting_start
          });

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
    }

    // 6. Prepare response
    const affectedStudents = Array.from(affectedStudentsMap.values())
      .sort((a, b) => b.total_future_occurrences - a.total_future_occurrences);

    const breakdown = {
      regular_classes: affectedStudents.reduce((sum, s) => sum + s.regular_classes_affected.length, 0),
      scheduled_classes: affectedStudents.reduce((sum, s) => sum + s.scheduled_classes_affected.length, 0),
      trial_classes: affectedTrialClasses.length,
      future_occurrences: totalFutureOccurrences
    };

    console.log('📊 Impact summary:', {
      affected_students: affectedStudents.length,
      affected_trial_classes: affectedTrialClasses.length,
      total_future_occurrences: totalFutureOccurrences,
      breakdown
    });

    return res.json({
      success: true,
      request_id,
      teacher: {
        id: changeRequest.teacher?.id,
        name: changeRequest.teacher?.full_name,
        email: changeRequest.teacher?.email,
        timezone: teacherTz
      },
      dropped_slots: droppedSlots,
      affected_students: affectedStudents,
      affected_trial_classes: affectedTrialClasses,
      total_affected_students: affectedStudents.length,
      total_affected_trial_classes: affectedTrialClasses.length,
      total_future_occurrences: totalFutureOccurrences,
      breakdown,
      date_range: {
        effective_from: effectiveFrom.format('YYYY-MM-DD'),
        end_date: endDate.format('YYYY-MM-DD'),
        days: 60
      }
    });

  } catch (err) {
    console.error('❌ Preview Request Impact Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to preview request impact',
      error: err.message
    });
  }
};

/**
 * Handle approval or rejection of a schedule change request
 * UPDATED: Now supports separate cancellation for regular and scheduled classes
 */


const handleScheduleChangeAction = async (req, res) => {
  const admin_id = req.user.id;
  const request_id = req.params.id;
  const { 
    action, 
    admin_feedback_note, 
    cancel_regular_classes = false,
    cancel_scheduled_classes = false
  } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action' });
  }

  try {
    // 1. Fetch the change request
    const request = await ChangeRequest.findOne({ 
      where: { id: request_id },
      include: [{
        model: User,
        as: 'teacher',
        attributes: ['id', 'full_name', 'email', 'timezone']
      }]
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.admin_approval !== 'pending') {
      return res.status(400).json({
        message: 'This request has already been processed'
      });
    }

    // 2. REJECT
    if (action === 'reject') {
      request.admin_approval = 'rejected';
      request.admin_feedback_note = admin_feedback_note || null;
      await request.save();

      console.log(`❌ Request ${request_id} rejected by admin ${admin_id}`);

      return res.json({
        success: true,
        message: 'Schedule request rejected',
        request_id,
        status: 'rejected'
      });
    }

    // 3. APPROVE
    if (action === 'approve') {
      // ✅ REMOVED: Conflict check - let admin decide via checkboxes
      // The admin now has full control via cancel_regular_classes and cancel_scheduled_classes
      
      // If there are conflicts and admin wants to cancel them, it will be handled below
      if (request.has_conflicts) {
        console.log(`⚠️ Request has conflicts, but admin can handle via checkboxes`);
      }

      // 4. Get or CREATE availability record
      let availability = await TeacherAvailability.findOne({
        where: { user_id: request.user_id }
      });

      if (!availability) {
        availability = await TeacherAvailability.create({
          user_id: request.user_id,
          mon: '{}',
          tue: '{}',
          wed: '{}',
          thu: '{}',
          fri: '{}',
          sat: '{}',
          sun: '{}'
        });
        console.log(`✨ Created new availability record for teacher ${request.user_id}`);
      }

      // 5. Parse old grid
      const oldGrid = {
        mon: JSON.parse(availability.mon || '{}'),
        tue: JSON.parse(availability.tue || '{}'),
        wed: JSON.parse(availability.wed || '{}'),
        thu: JSON.parse(availability.thu || '{}'),
        fri: JSON.parse(availability.fri || '{}'),
        sat: JSON.parse(availability.sat || '{}'),
        sun: JSON.parse(availability.sun || '{}')
      };

      // 6. Apply changes
      const dropped = Array.isArray(request.dropped)
        ? request.dropped
        : request.dropped ? JSON.parse(request.dropped) : [];

      const added = Array.isArray(request.added)
        ? request.added
        : request.added ? JSON.parse(request.added) : [];

      const tz = request.teacher?.timezone || 'UTC';

      console.log(`🔄 Applying changes (saving in UTC format like old website):`, {
        teacher_id: request.user_id,
        timezone: tz,
        dropped_count: dropped.length,
        added_count: added.length,
        cancel_regular_classes,
        cancel_scheduled_classes,
        has_conflicts: request.has_conflicts
      });

      // Apply drops (remove slots - set to false)
      dropped.forEach(({ day, time }) => {
        const normalizedDay = normalizeDayFormat(day);
        if (!oldGrid[normalizedDay]) oldGrid[normalizedDay] = {};
        oldGrid[normalizedDay][time] = false;
        console.log(`  ➖ Removed: ${normalizedDay} ${time} UTC (set to false)`);
      });

      // Apply adds (add slots - set to true)
      // IMPORTANT: Save in UTC format (same as old website)
      added.forEach(({ day, time }) => {
        const normalizedDay = normalizeDayFormat(day);
        if (!oldGrid[normalizedDay]) oldGrid[normalizedDay] = {};
        oldGrid[normalizedDay][time] = true;
        console.log(`  ➕ Added: ${normalizedDay} ${time} UTC (set to true)`);
      });

      // 7. Save updated availability
      await availability.update({
        mon: JSON.stringify(oldGrid.mon),
        tue: JSON.stringify(oldGrid.tue),
        wed: JSON.stringify(oldGrid.wed),
        thu: JSON.stringify(oldGrid.thu),
        fri: JSON.stringify(oldGrid.fri),
        sat: JSON.stringify(oldGrid.sat),
        sun: JSON.stringify(oldGrid.sun)
      });

      // 8. Mark request as accepted
      request.admin_approval = 'accepted';
      request.admin_feedback_note = admin_feedback_note || null;
      await request.save();

      console.log(`✅ Request ${request_id} approved by admin ${admin_id}`);

      // 9. Handle cancellations and conflicts
      let regularCancelledCount = 0;
      let scheduledCancelledCount = 0;
      
      const teacherId = request.user_id;
      const teacherTz = request.teacher?.timezone || 'UTC';
      
      // Parse dropped slots (these are in UTC)
      let droppedSlots = request.dropped;
      try {
        if (typeof droppedSlots === 'string' && droppedSlots.trim() !== '') {
          droppedSlots = JSON.parse(droppedSlots);
        }
      } catch (e) {
        droppedSlots = [];
      }

      if (!Array.isArray(droppedSlots)) {
        droppedSlots = [];
      }

      // Parse added slots for conflict handling
      let addedSlots = request.added;
      try {
        if (typeof addedSlots === 'string' && addedSlots.trim() !== '') {
          addedSlots = JSON.parse(addedSlots);
        }
      } catch (e) {
        addedSlots = [];
      }

      if (!Array.isArray(addedSlots)) {
        addedSlots = [];
      }

      const effectiveFrom = moment.utc(request.effective_from || new Date()).startOf('day');
      const endDate = moment(effectiveFrom).add(60, 'days').endOf('day');

      console.log(`📅 Processing period:`, {
        effective_from: effectiveFrom.format('YYYY-MM-DD HH:mm'),
        end_date: endDate.format('YYYY-MM-DD HH:mm'),
        timezone: 'UTC'
      });

      // ============================================
      // 9A. HANDLE REGULAR CLASSES (if checkbox checked)
      // ============================================
      if (cancel_regular_classes && droppedSlots.length > 0) {
        console.log(`🗑️ DELETING regular classes (dropped slots)...`);
        
        for (const droppedSlot of droppedSlots) {
          if (!droppedSlot.day || !droppedSlot.time) continue;

          const slotInUTC = {
            day: normalizeDayFormat(droppedSlot.day),
            time: droppedSlot.time
          };

          console.log(`  Processing dropped slot (UTC): ${slotInUTC.day} ${slotInUTC.time}`);

          const allRegularClasses = await RegularClass.findAll({
            where: { teacher_id: teacherId }
          });

          for (const regClass of allRegularClasses) {
            const regularClassTz = regClass.timezone || 'UTC';
            const regDay = normalizeDayFormat(regClass.day);
            const regTime = regClass.start_time;

            if (!regDay || !regTime) continue;

            const regClassInUTC = convertDayTimeToUTC(regDay, regTime, regularClassTz);
            const matches = regClassInUTC.day === slotInUTC.day && regClassInUTC.time === slotInUTC.time;

            if (matches) {
              console.log(`  ✅ MATCH - Deleting regular class:`, {
                regular_class_id: regClass.id,
                student_id: regClass.student_id,
                local_time: `${regDay} ${regTime} (${regularClassTz})`,
                utc_time: `${regClassInUTC.day} ${regClassInUTC.time}`,
                batch_id: regClass.batch_id
              });

              const batchId = regClass.batch_id;
              const studentId = regClass.student_id;

              await regClass.destroy();
              regularCancelledCount++;

              const classesToCancel = await Class.findAll({
                where: {
                  teacher_id: teacherId,
                  student_id: studentId,
                  batch_id: batchId,
                  status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
                  meeting_start: {
                    [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
                  }
                }
              });

              const matchingClasses = classesToCancel.filter(cls => {
                const clsMoment = moment.utc(cls.meeting_start);
                const clsDay = getDayOfWeekUTC(clsMoment);
                const clsTime = clsMoment.format('HH:mm');
                return clsDay === slotInUTC.day && clsTime === slotInUTC.time;
              });

              for (const cls of matchingClasses) {
        await cls.update({ 
          status: 'canceled',
          cancellation_reason: `Regular class deleted - Teacher availability changed (Request #${request_id})`,
          cancelled_at: new Date(),
          cancelled_by: admin_id
        });
                console.log(`    ✂️ Cancelled class ${cls.id} (${moment.utc(cls.meeting_start).format('YYYY-MM-DD HH:mm')})`);
              }
            }
          }
        }

        console.log(`✅ Deleted ${regularCancelledCount} regular classes`);
      }

      // ============================================
      // 9B. HANDLE SCHEDULED CLASSES (if checkbox checked)
      // ============================================
      if (cancel_scheduled_classes && droppedSlots.length > 0) {
        console.log(`🗑️ CANCELLING scheduled classes (dropped slots)...`);
        
        for (const droppedSlot of droppedSlots) {
          if (!droppedSlot.day || !droppedSlot.time) continue;

          const slotInUTC = {
            day: normalizeDayFormat(droppedSlot.day),
            time: droppedSlot.time
          };

          console.log(`  Processing dropped slot (UTC): ${slotInUTC.day} ${slotInUTC.time}`);

          const futureClasses = await Class.findAll({
            where: {
              teacher_id: teacherId,
              status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
              meeting_start: {
                [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
              },
              is_trial: false // Exclude trial classes - handled separately in section 9C
            }
          });

          console.log(`  Found ${futureClasses.length} future classes to check`);

          for (const futureClass of futureClasses) {
            const classMoment = moment.utc(futureClass.meeting_start);
            const classDay = getDayOfWeekUTC(classMoment);
            const classTime = classMoment.format('HH:mm');

            if (classDay === slotInUTC.day && classTime === slotInUTC.time) {
            await futureClass.update({ 
              status: 'canceled',
              cancellation_reason: `Teacher availability changed - Request #${request_id}`,
              cancelled_at: new Date(),
              cancelled_by: admin_id
            });
              scheduledCancelledCount++;
              console.log(`  ✂️ Cancelled class ${futureClass.id} (${classMoment.format('YYYY-MM-DD HH:mm')} UTC)`);
            }
          }
        }

        console.log(`✅ Cancelled ${scheduledCancelledCount} scheduled classes`);
      }

      // ============================================
      // 9C. HANDLE TRIAL CLASSES (if checkbox checked)
      // ============================================
      let trialCancelledCount = 0;
      if (cancel_scheduled_classes && droppedSlots.length > 0) {
        console.log(`🗑️ CANCELLING trial classes (dropped slots)...`);
        
        for (const droppedSlot of droppedSlots) {
          if (!droppedSlot.day || !droppedSlot.time) continue;

          const slotInUTC = {
            day: normalizeDayFormat(droppedSlot.day),
            time: droppedSlot.time
          };

          console.log(`  Processing dropped slot (UTC): ${slotInUTC.day} ${slotInUTC.time}`);

          // Find trial classes that match this dropped slot
          const trialClasses = await TrialClassRegistration.findAll({
            where: {
              teacher_id: teacherId,
              status: { [Op.in]: ['pending', 'confirmed'] },
              meeting_start: {
                [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
              }
            }
          });

          console.log(`  Found ${trialClasses.length} trial classes to check`);

          for (const trialClass of trialClasses) {
            const trialMoment = moment.utc(trialClass.meeting_start);
            const trialDay = getDayOfWeekUTC(trialMoment);
            const trialTime = trialMoment.format('HH:mm');

            if (trialDay === slotInUTC.day && trialTime === slotInUTC.time) {
              await trialClass.update({
                status: 'cancelled',
                cancellation_reason: `Teacher availability changed - Request #${request_id}`,
                cancelled_by: admin_id,
                cancelled_at: new Date()
              });
              trialCancelledCount++;
              console.log(`  ✂️ Cancelled trial class ${trialClass.id} for ${trialClass.student_name} (${trialMoment.format('YYYY-MM-DD HH:mm')} UTC)`);
            }
          }
        }

        console.log(`✅ Cancelled ${trialCancelledCount} trial classes`);
      }

      // ============================================
      // 9D. REFUND LOGIC - ADD CANCELLED LESSONS BACK TO SUBSCRIPTION
      // ============================================
      // Track refunded lessons per student
      const refundedLessonsMap = new Map(); // student_id -> count
      
      if (cancel_regular_classes || cancel_scheduled_classes) {
        console.log(`💰 REFUND LOGIC - Adding cancelled lessons back to subscriptions...`);
        
        // Get all cancelled classes from the operations above
        const cancelledClasses = await Class.findAll({
          where: {
            teacher_id: teacherId,
            status: 'canceled',
            cancelled_at: {
              [Op.gte]: moment().subtract(1, 'minute').toDate() // Recently cancelled (within last minute)
            },
            is_trial: false // Exclude trial classes
          },
          attributes: ['id', 'student_id', 'batch_id', 'meeting_start']
        });

        console.log(`  Found ${cancelledClasses.length} recently cancelled classes to process for refund`);

        // Group by student_id and count
        for (const cls of cancelledClasses) {
          if (!cls.student_id) continue; // Skip if no student
          
          const studentId = cls.student_id;
          refundedLessonsMap.set(studentId, (refundedLessonsMap.get(studentId) || 0) + 1);
        }

        // Update each student's subscription
        for (const [studentId, lessonsToRefund] of refundedLessonsMap.entries()) {
          try {
            const subscription = await UserSubscriptionDetails.findOne({
              where: {
                user_id: studentId,
                status: { [Op.in]: ['active', 'inactive'] } // Active or recently inactive
              },
              order: [['id', 'DESC']] // Get most recent subscription
            });

            if (subscription) {
              const currentLeftLessons = parseInt(subscription.left_lessons) || 0;
              const newLeftLessons = currentLeftLessons + lessonsToRefund;
              
              await subscription.update({
                left_lessons: newLeftLessons
              });

              console.log(`  💰 Refunded ${lessonsToRefund} lesson(s) to student ${studentId}: ${currentLeftLessons} → ${newLeftLessons}`);
            } else {
              console.log(`  ⚠️ No active subscription found for student ${studentId}, skipping refund`);
            }
          } catch (refundError) {
            console.error(`  ❌ Error refunding lessons for student ${studentId}:`, refundError);
          }
        }

        console.log(`✅ Refunded lessons to ${refundedLessonsMap.size} student(s)`);
      }

      // ============================================
      // 9E. HANDLE CONFLICTING CLASSES (when ADDING slots)
      // ============================================
      // If there are conflicts from ADDED slots, cancel those conflicting classes
      if (request.has_conflicts && (cancel_regular_classes || cancel_scheduled_classes)) {
        console.log(`🔧 Handling conflicts from ADDED slots...`);
        
        let conflictDetails = request.conflict_details;
        try {
          if (typeof conflictDetails === 'string') {
            conflictDetails = JSON.parse(conflictDetails);
          }
        } catch (e) {
          conflictDetails = [];
        }

        if (Array.isArray(conflictDetails)) {
          for (const conflict of conflictDetails) {
            if (conflict.type === 'regular_class' && cancel_regular_classes) {
              // Delete the conflicting regular class
              const regClass = await RegularClass.findOne({
                where: { id: conflict.class_id }
              });

              if (regClass) {
                console.log(`  🗑️ Deleting conflicting regular class ${conflict.class_id}`);
                await regClass.destroy();
                regularCancelledCount++;

                // Also cancel its future classes
                if (conflict.batch_id) {
                  const relatedClasses = await Class.findAll({
                    where: {
                      batch_id: conflict.batch_id,
                      status: { [Op.notIn]: ['completed', 'cancelled', 'canceled'] },
                      meeting_start: {
                        [Op.between]: [effectiveFrom.toDate(), endDate.toDate()]
                      }
                    }
                  });

                  for (const cls of relatedClasses) {
                    await cls.update({
                      status: 'canceled',
                      cancellation_reason: `Conflicting with new teacher availability (Request #${request_id})`,
                      cancelled_at: new Date(),
                      cancelled_by: admin_id
                    });
                    console.log(`    ✂️ Cancelled related class ${cls.id}`);
                  }
                }
              }
            } else if (conflict.type === 'scheduled_class' && cancel_scheduled_classes) {
              // Cancel the conflicting scheduled class
              const cls = await Class.findOne({
                where: { id: conflict.class_id }
              });

              if (cls && cls.status !== 'cancelled' && cls.status !== 'canceled') {
                console.log(`  ✂️ Cancelling conflicting scheduled class ${conflict.class_id}`);
                await cls.update({
                  status: 'canceled',
                  cancellation_reason: `Conflicting with new teacher availability (Request #${request_id})`,
                  cancelled_at: new Date(),
                  cancelled_by: admin_id
                });
                scheduledCancelledCount++;
              }
            }
          }
        }

        console.log(`✅ Handled conflicts: ${conflictDetails.length} conflicts processed`);
      }

      // ============================================
      // 10. UPDATE TEACHER_AVAILABILITY FOR DROPPED SLOTS
      // ============================================
      console.log(`\n📅 UPDATING teacher_availability for dropped slots (UTC)...`);
      
      if (droppedSlots && droppedSlots.length > 0) {
        // Fetch teacher's availability record
        const teacherAvailability = await TeacherAvailability.findOne({
          where: { user_id: teacherId }
        });

        if (teacherAvailability) {
          console.log(`  Found availability record for teacher ${teacherId}`);
          
          // Update each dropped slot to false (unavailable) - all times in UTC
          for (const slot of droppedSlots) {
            const dayColumn = normalizeDayFormat(slot.day); // UTC day
            const time = slot.time; // UTC time
            
            // Get current availability for this day
            let dayAvailability = teacherAvailability[dayColumn];
            
            // Parse JSON if string
            if (typeof dayAvailability === 'string') {
              try {
                dayAvailability = JSON.parse(dayAvailability);
              } catch (e) {
                dayAvailability = {};
              }
            }
            
            // Set the time to false (unavailable) - teacher dropped this slot
            dayAvailability[time] = false;
            
            // Update the column
            teacherAvailability[dayColumn] = JSON.stringify(dayAvailability);
            
            console.log(`  ❌ Set ${dayColumn} ${time} UTC to unavailable (false)`);
          }
          
          // Save the updated availability
          await teacherAvailability.save();
          console.log(`✅ Teacher availability updated successfully`);
        } else {
          console.log(`  ⚠️ No availability record found for teacher ${teacherId}`);
        }
      } else {
        console.log(`  ℹ️ No dropped slots to update`);
      }

      // 11. Return response with separate counts
      return res.json({
        success: true,
        message: 'Schedule request approved successfully',
        request_id,
        status: 'accepted',
        classes_cancelled: cancel_regular_classes || cancel_scheduled_classes,
        cancelled_count: regularCancelledCount + scheduledCancelledCount + trialCancelledCount,
        regular_cancelled_count: regularCancelledCount,
        scheduled_cancelled_count: scheduledCancelledCount,
        trial_cancelled_count: trialCancelledCount,
        refunded_students_count: refundedLessonsMap.size
      });
    }
  } catch (err) {
    console.error('❌ Handle action error:', err);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: err.message
    });
  }
};

/**
 * Get all schedule change requests with filters
 */

const getScheduleChangeRequests = async (req, res) => {
  try {
    const {
      status = "pending",
      search = "",
      from_date,
      to_date,
      teacher_id,
      page = 1,
      limit = 10
    } = req.query;

    console.log('req query',req.query);

    const offset = (page - 1) * limit;

    // base where clause
    const whereClause = {};
    if (status && status !== "all") whereClause.admin_approval = status;
    if (from_date && to_date) {
      whereClause.effective_from = {
        [Op.between]: [new Date(from_date), new Date(to_date)]
      };
    }
    if(teacher_id && teacher_id!=='all') whereClause.user_id=teacher_id;

    // teacher search where
    const teacherSearchWhere = search
      ? {
          [Op.or]: [
            { full_name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } }
          ]
        }
      : undefined;

    const results = await ChangeRequest.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "teacher",
          attributes: ["id", "full_name", "email", "mobile", "timezone"],
          where: teacherSearchWhere,
          required: !!search
        }
      ],
      order: [["created_at", "DESC"]],
      offset,
      limit: parseInt(limit)
    });

    const processed = await Promise.all(
      results.rows.map(async (r) => {
        const teacherId = r.teacher_id || r.teacher?.id;
        const teacherTz = r.teacher?.timezone || null;

        // Parse added/dropped if stored as JSON string
        let addedSlots = r.added;
        let droppedSlots = r.dropped;
        try {
          if (typeof addedSlots === "string" && addedSlots.trim() !== "") {
            addedSlots = JSON.parse(addedSlots);
          }
        } catch (e) {
          addedSlots = [];
        }
        try {
          if (typeof droppedSlots === "string" && droppedSlots.trim() !== "") {
            droppedSlots = JSON.parse(droppedSlots);
          }
        } catch (e) {
          droppedSlots = [];
        }

        // anchor date – prefer effective_from, fallback to created_at
        const anchor = r.effective_from || r.created_at || new Date();

        const conflictList = [];

        // --------------------
        // CHECK ADDED weekly slots or explicit slots
        // --------------------
        if (Array.isArray(addedSlots)) {
          for (const slot of addedSlots) {
            let slotStart = null;
            let slotEnd = null;

            if (slot && slot.day && slot.time) {
              slotStart = resolveWeeklySlotToDatetime(anchor, slot.day, slot.time, teacherTz);
              slotEnd = new Date(slotStart.getTime() + (slot.duration_minutes ? slot.duration_minutes * 60000 : 30 * 60000));
            } else if (slot && slot.start) {
              slotStart = new Date(slot.start);
              slotEnd = slot.end ? new Date(slot.end) : new Date(slotStart.getTime() + 30 * 60000);
            } else {
              continue;
            }

            if (!slotStart || !slotEnd || isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) continue;

            const conflicts = await Class.findAll({
              where: {
                teacher_id: teacherId,
                meeting_start: { [Op.lt]: slotEnd },
                meeting_end: { [Op.gt]: slotStart },
                status: { [Op.notIn]: ["cancelled", "completed"] }
              }
            });

            if (conflicts.length > 0) {
              conflictList.push({
                type: "added",
                slot: { ...slot, resolved_start: slotStart, resolved_end: slotEnd },
                conflicts: conflicts.map(c => ({
                  id: c.id,
                  meeting_start: c.meeting_start,
                  meeting_end: c.meeting_end,
                  status: c.status
                }))
              });
            }
          }
        }

        // --------------------
        // CHECK DROPPED slots - Calculate IMPACT on students
        // --------------------
        const impactList = [];
        if (Array.isArray(droppedSlots) && droppedSlots.length > 0) {
          // Helper function
          const normalizeDayFormat = (dayStr) => {
            const lc = String(dayStr || '').toLowerCase();
            if (lc === 'sun' || lc === 'sunday') return 'sun';
            if (lc === 'mon' || lc === 'monday') return 'mon';
            if (lc === 'tue' || lc === 'tuesday') return 'tue';
            if (lc === 'wed' || lc === 'wednesday') return 'wed';
            if (lc === 'thu' || lc === 'thursday') return 'thu';
            if (lc === 'fri' || lc === 'friday') return 'fri';
            if (lc === 'sat' || lc === 'saturday') return 'sat';
            return lc;
          };

          // For each dropped slot, find affected students
          const affectedStudentsMap = new Map(); // student_id -> count

          for (const droppedSlot of droppedSlots) {
            if (!droppedSlot.day || !droppedSlot.time) continue;

            // Dropped slots are ALREADY in UTC
            const slotInUTC = {
              day: normalizeDayFormat(droppedSlot.day),
              time: droppedSlot.time
            };

            // 1. Check regular_class table
            const regularClasses = await RegularClass.findAll({
              where: {
                teacher_id: teacherId
                // No is_active column in schema
              },
              attributes: ['id', 'student_id', 'teacher_id', 'day', 'start_time', 'timezone', 'batch_id'],
              include: [{
                model: User,
                as: 'Student',
                attributes: ['id', 'full_name', 'timezone']
              }]
            });

            for (const rc of regularClasses) {
              // Use timezone from regular_class record (this is the timezone the class time is stored in)
              const studentTz = rc.timezone || rc.Student?.timezone || 'UTC';
              const rcDay = rc.day ? normalizeDayFormat(rc.day) : null;
              
              if (!rcDay || !rc.start_time) continue;  // ✅ Use start_time

              // Convert regular class time to UTC
              const rcMoment = moment.tz(`2025-01-01 ${rc.start_time}`, 'YYYY-MM-DD HH:mm', studentTz);  // ✅ Use start_time
              const rcDayIndex = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(rcDay);
              if (rcDayIndex >= 0) {
                rcMoment.day(rcDayIndex);
              }
              
              const rcUTC = rcMoment.clone().utc();
              const rcUTCDay = normalizeDayFormat(rcUTC.format('ddd'));
              const rcUTCTime = rcUTC.format('HH:mm');

              // Compare
              if (rcUTCDay === slotInUTC.day && rcUTCTime === slotInUTC.time) {
                const studentId = rc.student_id;
                affectedStudentsMap.set(studentId, (affectedStudentsMap.get(studentId) || 0) + 1);
              }
            }

            // 2. Check scheduled classes table
            const effectiveFrom = r.effective_from || new Date();
            const lookAheadDays = 60;
            const endDate = moment(effectiveFrom).add(lookAheadDays, 'days').toDate();

            const scheduledClasses = await Class.findAll({
              where: {
                teacher_id: teacherId,
                meeting_start: {
                  [Op.gte]: effectiveFrom,
                  [Op.lte]: endDate
                },
                status: { [Op.in]: ['pending', 'confirmed'] },
                is_trial: false // Exclude trial classes - counted separately
              },
              include: [{
                model: User,
                as: 'Student',  // ✅ Capital S
                attributes: ['id']
              }]
            });

            for (const cls of scheduledClasses) {
              const clsUTC = moment.utc(cls.meeting_start);
              const clsDay = normalizeDayFormat(clsUTC.format('ddd'));
              const clsTime = clsUTC.format('HH:mm');

              if (clsDay === slotInUTC.day && clsTime === slotInUTC.time) {
                const studentId = cls.student_id;
                affectedStudentsMap.set(studentId, (affectedStudentsMap.get(studentId) || 0) + 1);
              }
            }
          }

          // Convert map to array
          if (affectedStudentsMap.size > 0) {
            for (const [studentId, count] of affectedStudentsMap.entries()) {
              impactList.push({
                student_id: studentId,
                affected_classes: count
              });
            }
          }
        }

        return {
          id: r.id,
          teacher: r.teacher,
          added: addedSlots,
          dropped: droppedSlots,
          summary: r.changes_summary,
          note: r.teacher_note,
          admin_feedback: r.admin_feedback_note,
          effective_from: r.effective_from,
          status: r.admin_approval,
          has_conflicts: conflictList.length > 0, // TRUE scheduling conflicts (when adding)
          conflict_details: impactList, // Affected students (when dropping)
          created_at: r.created_at
        };
      })
    );

    return res.json({
      success: true,
      total: results.count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(results.count / limit),
      data: processed
    });
  } catch (err) {
    console.error("Schedule Request Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch schedule change requests",
      error: err.message
    });
  }
};

module.exports = {
  handleScheduleChangeAction,
  getScheduleChangeRequests,
  previewRequestImpact
};