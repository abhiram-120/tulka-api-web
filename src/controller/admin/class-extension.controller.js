const Users = require('../../models/users');
const Class = require('../../models/classes');
const TeacherAvailability = require('../../models/teacherAvailability');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');

/**
 * GET API - Retrieve classes that meet the extension criteria (Admin)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getClassesForExtension(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // Extract query parameters for pagination and filtering
        const {
            page = 1,
            limit = 10,
            student_name,
            teacher_name,
            student_email,
            teacher_email,
            date_from,
            date_to,
            sort_by = 'meeting_start',
            sort_order = 'ASC'
        } = req.query;

        // Pagination
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
        const offset = (pageNum - 1) * pageSize;

        // Base query to find all classes that meet the criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'not_updated'
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Add date range filters if provided
        if (date_from || date_to) {
            whereClause.meeting_start = {
                [Op.gte]: targetDate
            };
            
            if (date_from) {
                const fromDate = new Date(date_from);
                whereClause.meeting_start[Op.gte] = fromDate > targetDate ? fromDate : targetDate;
            }
            
            if (date_to) {
                whereClause.meeting_start[Op.lte] = new Date(date_to);
            }
        }

        // Build include conditions for filtering
        const includeConditions = [
            {
                model: Users,
                as: 'Teacher',
                attributes: ['id', 'full_name', 'email', 'timezone'],
                where: {}
            },
            {
                model: Users,
                as: 'Student',
                attributes: ['id', 'full_name', 'email', 'timezone'],
                where: {}
            }
        ];

        // Add teacher filters
        if (teacher_name) {
            includeConditions[0].where.full_name = {
                [Op.like]: `%${teacher_name}%`
            };
        }
        if (teacher_email) {
            includeConditions[0].where.email = {
                [Op.like]: `%${teacher_email}%`
            };
        }

        // Add student filters
        if (student_name) {
            includeConditions[1].where.full_name = {
                [Op.like]: `%${student_name}%`
            };
        }
        if (student_email) {
            includeConditions[1].where.email = {
                [Op.like]: `%${student_email}%`
            };
        }

        // Sort options
        const validSortFields = ['meeting_start', 'created_at', 'id'];
        const sortField = validSortFields.includes(sort_by) ? sort_by : 'meeting_start';
        const sortDirection = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        // Get total count for pagination
        const totalCount = await Class.count({
            where: whereClause,
            include: includeConditions
        });

        // Find qualifying classes with pagination and filtering
        const classes = await Class.findAll({
            where: whereClause,
            include: includeConditions,
            order: [[sortField, sortDirection]],
            limit: pageSize,
            offset: offset
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                },
                pagination: {
                    current_page: pageNum,
                    total_pages: 0,
                    total_records: 0,
                    records_per_page: pageSize
                }
            });
        }

        // Process each class to show what would be changed
        const classesForExtension = [];

        for (const classItem of classes) {
            // Get current meeting times
            const currentMeetingStart = new Date(classItem.meeting_start);
            const currentMeetingEnd = new Date(classItem.meeting_end);
            
            // Calculate what the new times would be (shift by 1 hour)
            const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000)); // Add 1 hour
            const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000)); // Add 1 hour

            classesForExtension.push({
                id: classItem.id,
                student_id: classItem.student_id,
                teacher_id: classItem.teacher_id,
                student_name: classItem.Student?.full_name || 'N/A',
                teacher_name: classItem.Teacher?.full_name || 'N/A',
                student_email: classItem.Student?.email || 'N/A',
                teacher_email: classItem.Teacher?.email || 'N/A',
                student_timezone: classItem.Student?.timezone || 'N/A',
                teacher_timezone: classItem.Teacher?.timezone || 'N/A',
                current_meeting_start: currentMeetingStart,
                current_meeting_end: currentMeetingEnd,
                proposed_meeting_start: newMeetingStart,
                proposed_meeting_end: newMeetingEnd,
                time_shift: '60 minutes forward',
                date_maintained: true,
                status: classItem.status,
                created_at: classItem.created_at
            });
        }

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / pageSize);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Prepare response
        const response = {
            status: 'success',
            message: `Found ${classesForExtension.length} classes eligible for time extension`,
            summary: {
                total_qualifying_classes: totalCount,
                current_page_records: classesForExtension.length,
                time_shift: '1 hour forward',
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                },
                filters_applied: {
                    student_name: student_name || null,
                    teacher_name: teacher_name || null,
                    student_email: student_email || null,
                    teacher_email: teacher_email || null,
                    date_from: date_from || null,
                    date_to: date_to || null
                }
            },
            pagination: {
                current_page: pageNum,
                total_pages: totalPages,
                total_records: totalCount,
                records_per_page: pageSize,
                has_next_page: hasNextPage,
                has_prev_page: hasPrevPage,
                next_page: hasNextPage ? pageNum + 1 : null,
                prev_page: hasPrevPage ? pageNum - 1 : null
            },
            classes_for_extension: classesForExtension
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in getClassesForExtension (Admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while retrieving classes for extension',
            error: error.message
        });
    }
}

/**
 * POST API - Actually extend/update the classes by shifting time slots (Admin)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function extendClassesAfterDate(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');
        const currentTime = new Date();

        // Query to find all classes that meet the criteria:
        // 1. Booked (meeting_start) after 26-10-2025
        // 2. Status is 'pending'
        // 3. Created before 26-10-2025
        // 4. get_classes_for_extension is 'not_updated'
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Find all qualifying classes with correct association aliases
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',  // Capital T - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',  // Capital S - matches association definition
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found to extend',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            });
        }

        // Process each class to shift time by one hour
        const updatedClasses = [];
        const errors = [];

        for (const classItem of classes) {
            try {
                // Get current meeting times
                const currentMeetingStart = new Date(classItem.meeting_start);
                const currentMeetingEnd = new Date(classItem.meeting_end);
                
                // Shift both start and end times by 1 hour (60 minutes)
                // This maintains the same date but shifts the time slot
                // Example: 21:30 - 21:55 becomes 22:30 - 22:55 on the same date
                const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000)); // Add 1 hour
                const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000)); // Add 1 hour

                // Update the class with shifted time slots
                // Note: Teacher availability is not checked as per requirements
                await Class.update(
                    {
                        meeting_start: newMeetingStart,
                        meeting_end: newMeetingEnd,
                        updated_at: currentTime,
                        get_classes_for_extension: 'updated'
                        // Note: duration_extended and extension_reason fields will be added only if they exist in your schema
                        // If these fields don't exist in your database, remove the lines below
                        // duration_extended: true,
                        // extension_reason: 'Time slot shifted by 1 hour for classes after 26-10-2025'
                    },
                    {
                        where: { id: classItem.id }
                    }
                );

                updatedClasses.push({
                    id: classItem.id,
                    student_id: classItem.student_id,
                    teacher_id: classItem.teacher_id,
                    student_name: classItem.Student?.full_name || 'N/A',  // Capital S
                    teacher_name: classItem.Teacher?.full_name || 'N/A',  // Capital T
                    original_meeting_start: currentMeetingStart,
                    original_meeting_end: currentMeetingEnd,
                    new_meeting_start: newMeetingStart,
                    new_meeting_end: newMeetingEnd,
                    time_shifted_by: '60 minutes',
                    date_maintained: true,
                    updated_at: currentTime
                });

            } catch (error) {
                errors.push({
                    class_id: classItem.id,
                    error: error.message
                });
            }
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Successfully extended time slots for ${updatedClasses.length} classes`,
            summary: {
                total_qualifying_classes: classes.length,
                successfully_updated: updatedClasses.length,
                errors_encountered: errors.length,
                time_shift: '1 hour forward',
                teacher_availability_checked: false,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            updated_classes: updatedClasses
        };

        // Include errors if any
        if (errors.length > 0) {
            response.errors = errors;
        }

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in extendClassesAfterDate (Admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while extending class time slots',
            error: error.message
        });
    }
}

/**
 * GET API - Check teacher availability for extended classes (Admin)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherAvailabilityForExtension(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // First, find all classes that meet the extension criteria (same as class extension)
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: 'not_updated'
        };

        // Find all qualifying classes
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found for availability check',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            });
        }

        // Get unique teacher IDs from the classes
        const teacherIds = [...new Set(classes.map(cls => cls.teacher_id))];
        console.log(teacherIds);

        // Find teacher availability records for these teachers
        const availabilityRecords = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                }
            },
            include: [
                {
                    model: Users,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ]
        });
        console.log(availabilityRecords);

        // Process each class to check availability needs
        const availabilityNeeds = [];

        for (const classItem of classes) {
            const teacher = classItem.Teacher;
            if (!teacher) continue;

            // Find the teacher's availability record
            const teacherAvailability = availabilityRecords.find(record => record.user_id === teacher.id);
            if (!teacherAvailability) continue;

            // Calculate new meeting times (shifted by 1 hour)
            const currentMeetingStart = new Date(classItem.meeting_start);
            const currentMeetingEnd = new Date(classItem.meeting_end);
            const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000));
            const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000));

            // Get day of week for the new meeting time
            const newMeetingDate = new Date(newMeetingStart);
            const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const dayOfWeek = dayNames[newMeetingDate.getDay()];

            // Get time in HH:mm format
            const timeString = newMeetingStart.toISOString().split('T')[1];
            const timeSlot = timeString.substring(0, 5);

            // Check current availability for this time slot
            const currentDayData = JSON.parse(teacherAvailability[dayOfWeek] || '{}');
            const isCurrentlyAvailable = currentDayData[timeSlot] === true;

            if (!isCurrentlyAvailable) {
                availabilityNeeds.push({
                    class_id: classItem.id,
                    teacher_id: teacher.id,
                    teacher_name: teacher.full_name,
                    teacher_email: teacher.email,
                    student_name: classItem.Student?.full_name || 'N/A',
                    original_meeting_start: currentMeetingStart,
                    original_meeting_end: currentMeetingEnd,
                    new_meeting_start: newMeetingStart,
                    new_meeting_end: newMeetingEnd,
                    day_of_week: dayOfWeek,
                    time_slot: timeSlot,
                    current_availability: isCurrentlyAvailable,
                    needs_availability_update: true
                });
            }
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Found ${availabilityNeeds.length} classes that need teacher availability updates`,
            summary: {
                total_qualifying_classes: classes.length,
                classes_needing_availability_update: availabilityNeeds.length,
                unique_teachers_affected: teacherIds.length,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: 'not_updated'
                }
            },
            availability_needs: availabilityNeeds
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in getTeacherAvailabilityForExtension (Admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while checking teacher availability for extension',
            error: error.message
        });
    }
}

/**
 * POST API - Update teacher availability for extended classes (Admin)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function extendTeacherAvailability(req, res) {
    try {
        // Target date: 26-10-2025
        const targetDate = new Date('2025-10-26T00:00:00.000Z');

        // Find all classes that need availability updates (both updated and not_updated)
        const whereClause = {
            meeting_start: {
                [Op.gte]: targetDate
            },
            status: 'pending',
            created_at: {
                [Op.lt]: targetDate
            },
            get_classes_for_extension: {
                [Op.in]: ['updated', 'not_updated']
            }
        };

        // Find all qualifying classes
        const classes = await Class.findAll({
            where: whereClause,
            include: [
                {
                    model: Users,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: Users,
                    as: 'Student',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ],
            order: [['meeting_start', 'ASC']]
        });

        if (!classes || classes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No qualifying classes found for availability update',
                criteria: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: ['updated', 'not_updated']
                }
            });
        }

        // Get unique teacher IDs from the classes
        const teacherIds = [...new Set(classes.map(cls => cls.teacher_id))];

        // Find teacher availability records for these teachers
        const availabilityRecords = await TeacherAvailability.findAll({
            where: {
                user_id: {
                    [Op.in]: teacherIds
                }
            },
            include: [
                {
                    model: Users,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                }
            ]
        });

        // Process each class to update availability
        const updatedAvailability = [];
        const errors = [];

        for (const classItem of classes) {
            try {
                const teacher = classItem.Teacher;
                if (!teacher) continue;

                // Find the teacher's availability record
                const teacherAvailability = availabilityRecords.find(record => record.user_id === teacher.id);
                if (!teacherAvailability) continue;

                const currentMeetingStart = new Date(classItem.meeting_start);
                const currentMeetingEnd = new Date(classItem.meeting_end);
                
                // Calculate duration in minutes
                const durationMinutes = (currentMeetingEnd - currentMeetingStart) / (1000 * 60);
                
                // Determine time slots based on class status and duration
                let timeSlotsToUpdate = [];
                
                if (classItem.get_classes_for_extension === 'not_updated') {
                    // For not_updated classes: add 1 hour to current time
                    const newMeetingStart = new Date(currentMeetingStart.getTime() + (60 * 60 * 1000));
                    const newMeetingEnd = new Date(currentMeetingEnd.getTime() + (60 * 60 * 1000));
                    
                    // Get day of week for the new meeting time
                    const newMeetingDate = new Date(newMeetingStart);
                    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                    const dayOfWeek = dayNames[newMeetingDate.getDay()];
                    
                    // Get time in HH:mm format
                    const timeString = newMeetingStart.toISOString().split('T')[1];
                    const timeSlot = timeString.substring(0, 5);
                    
                    // Determine number of slots based on duration
                    if (durationMinutes <= 30) {
                        // Duration <= 30 minutes: use only one slot
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot,
                            newMeetingStart,
                            newMeetingEnd
                        });
                    } else {
                        // Duration > 30 minutes: use two consecutive slots
                        const nextTimeSlot = new Date(newMeetingStart.getTime() + (30 * 60 * 1000));
                        const nextTimeString = nextTimeSlot.toISOString().split('T')[1];
                        const nextTimeSlotStr = nextTimeString.substring(0, 5);
                        
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot,
                            newMeetingStart,
                            newMeetingEnd: new Date(newMeetingStart.getTime() + (30 * 60 * 1000))
                        });
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot: nextTimeSlotStr,
                            newMeetingStart: new Date(newMeetingStart.getTime() + (30 * 60 * 1000)),
                            newMeetingEnd
                        });
                    }
                } else if (classItem.get_classes_for_extension === 'updated') {
                    // For updated classes: use current time (already extended)
                    const newMeetingDate = new Date(currentMeetingStart);
                    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                    const dayOfWeek = dayNames[newMeetingDate.getDay()];
                    
                    // Get time in HH:mm format
                    const timeString = currentMeetingStart.toISOString().split('T')[1];
                    const timeSlot = timeString.substring(0, 5);
                    
                    // Determine number of slots based on duration
                    if (durationMinutes <= 30) {
                        // Duration <= 30 minutes: use only one slot
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot,
                            newMeetingStart: currentMeetingStart,
                            newMeetingEnd: currentMeetingEnd
                        });
                    } else {
                        // Duration > 30 minutes: use two consecutive slots
                        const nextTimeSlot = new Date(currentMeetingStart.getTime() + (30 * 60 * 1000));
                        const nextTimeString = nextTimeSlot.toISOString().split('T')[1];
                        const nextTimeSlotStr = nextTimeString.substring(0, 5);
                        
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot,
                            newMeetingStart: currentMeetingStart,
                            newMeetingEnd: new Date(currentMeetingStart.getTime() + (30 * 60 * 1000))
                        });
                        timeSlotsToUpdate.push({
                            dayOfWeek,
                            timeSlot: nextTimeSlotStr,
                            newMeetingStart: new Date(currentMeetingStart.getTime() + (30 * 60 * 1000)),
                            newMeetingEnd: currentMeetingEnd
                        });
                    }
                }

                // Update availability for each time slot
                const currentDayData = JSON.parse(teacherAvailability[timeSlotsToUpdate[0].dayOfWeek] || '{}');
                let slotsUpdated = 0;
                
                for (const slot of timeSlotsToUpdate) {
                    if (currentDayData[slot.timeSlot] !== true) {
                        currentDayData[slot.timeSlot] = true;
                        slotsUpdated++;
                    }
                }
                
                if (slotsUpdated > 0) {
                    // Update the availability record
                    await TeacherAvailability.update(
                        {
                            [timeSlotsToUpdate[0].dayOfWeek]: JSON.stringify(currentDayData)
                        },
                        {
                            where: { id: teacherAvailability.id }
                        }
                    );

                    updatedAvailability.push({
                        class_id: classItem.id,
                        teacher_id: teacher.id,
                        teacher_name: teacher.full_name,
                        teacher_email: teacher.email,
                        student_name: classItem.Student?.full_name || 'N/A',
                        class_status: classItem.get_classes_for_extension,
                        duration_minutes: durationMinutes,
                        day_of_week: timeSlotsToUpdate[0].dayOfWeek,
                        time_slots_updated: timeSlotsToUpdate.map(slot => slot.timeSlot),
                        slots_count: timeSlotsToUpdate.length,
                        new_meeting_start: timeSlotsToUpdate[0].newMeetingStart,
                        new_meeting_end: timeSlotsToUpdate[timeSlotsToUpdate.length - 1].newMeetingEnd,
                        availability_updated: true
                    });
                }

            } catch (error) {
                errors.push({
                    class_id: classItem.id,
                    teacher_id: classItem.teacher_id,
                    error: error.message
                });
            }
        }

        // Prepare response
        const response = {
            status: 'success',
            message: `Successfully updated teacher availability for ${updatedAvailability.length} classes`,
            summary: {
                total_qualifying_classes: classes.length,
                availability_updated: updatedAvailability.length,
                errors_encountered: errors.length,
                unique_teachers_affected: teacherIds.length,
                criteria_applied: {
                    meeting_start_after: targetDate,
                    status: 'pending',
                    created_before: targetDate,
                    get_classes_for_extension: ['updated', 'not_updated']
                }
            },
            updated_availability: updatedAvailability
        };

        // Include errors if any
        if (errors.length > 0) {
            response.errors = errors;
        }

        res.status(200).json(response);

    } catch (error) {
        console.error('Error in extendTeacherAvailability (Admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating teacher availability for extended classes',
            error: error.message
        });
    }
}

module.exports = {
    getClassesForExtension,
    extendClassesAfterDate,
    getTeacherAvailabilityForExtension,
    extendTeacherAvailability
};
