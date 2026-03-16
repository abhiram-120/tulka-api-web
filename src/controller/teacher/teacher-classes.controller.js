const Users = require('../../models/users');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const TrialClassEvaluation = require('../../models/TrialClassEvaluation');
const Homework = require('../../models/homework');
const Feedback = require('../../models/lessonFeedback');
const { Op } = require('sequelize');
const multer = require('multer');
const { sequelize } = require('../../connection/connection');
const { whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const { uploadHomeworkFile, deleteHomeworkFile, uploadEvaluationFile, deleteEvaluationFile } = require('../../services/profile/image-service');

const moment = require('moment-timezone');

/**
 * View classes for a teacher with pagination, filters and trial class data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function viewTeacherClasses(req, res) {
    try {
        const teacherId = req.user.id;

        // 1. Get teacher data
        let teacher = await Users.findOne({
            where: { id: teacherId }
        });

        if (!teacher) {
            return res.status(404).json({ status: 'error', message: 'Teacher not found' });
        }

        // Check if the user is a teacher
        if (!teacher.role_name.includes('teacher')) {
            return res.status(403).json({ status: 'error', message: 'Access denied. Teacher role required.' });
        }

        // Pagination setup
        const DEFAULT_PAGE_SIZE = 10; // Match frontend page size
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || DEFAULT_PAGE_SIZE);
        const offset = (page - 1) * limit;

        // Filters
        const status = req.query.status;
        const startDate = req.query.start_date;
        const endDate = req.query.end_date;
        const studentName = req.query.student_name;
        const classType = req.query.class_type;

        // Building where clause based on filters
        const whereClause = {
            teacher_id: teacherId
        };

        // Status filter matching frontend terminology
        if (status && status !== 'all') {
            if (status === 'ended') {
                whereClause.status = 'ended';
            } else if (status === 'pending') {
                whereClause.status = 'pending';
                whereClause.meeting_start = {
                    [Op.gt]: new Date()
                };
            } else if (status === 'canceled') {
                whereClause.status = 'canceled';
            }
        }

        // Date range filter
        if (startDate && endDate) {
            whereClause.meeting_start = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Class type filter
        if (classType && classType !== 'all') {
            if (classType === 'trial') {
                whereClause.is_trial = 1;
            } else if (classType === 'regular') {
                whereClause.is_trial = 0;
            }
        }
        whereClause.is_regular_hide = 0;

        // Calculate start and end of current month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get counts for badge display
        const [upcomingCount, completedCount, canceledCount, classesThisMonth] = await Promise.all([
            Class.count({
                where: {
                    teacher_id: teacherId,
                    status: 'pending',
                    is_regular_hide: 0,
                    meeting_start: { [Op.gt]: new Date() }
                }
            }),
            Class.count({
                where: {
                    teacher_id: teacherId,
                    is_regular_hide: 0,
                    status: 'ended'
                }
            }),
            Class.count({
                where: {
                    teacher_id: teacherId,
                    is_regular_hide: 0,
                    status: 'canceled'
                }
            }),
            // NEW: Count classes completed this month
            Class.count({
                where: {
                    teacher_id: teacherId,
                    is_regular_hide: 0,
                    status: 'ended',
                    meeting_end: {
                        [Op.gte]: startOfMonth,
                        [Op.lte]: endOfMonth
                    }
                }
            })
        ]);

        // Get student IDs matching name filter if provided
        let filteredStudentIds = [];
        if (studentName) {
            const matchingStudents = await Users.findAll({
                attributes: ['id'],
                where: {
                    full_name: {
                        [Op.like]: `%${studentName}%`
                    }
                }
            });
            filteredStudentIds = matchingStudents.map(s => s.id);

            // Also search in trial class registrations
            const matchingTrialStudents = await TrialClassRegistration.findAll({
                attributes: ['id'],
                where: {
                    student_name: {
                        [Op.like]: `%${studentName}%`
                    }
                }
            });

            // If we have matching students, filter by them
            if (filteredStudentIds.length > 0) {
                whereClause.student_id = {
                    [Op.in]: filteredStudentIds
                };
            } else if (matchingTrialStudents.length > 0) {
                // If we have matching trial students, filter by demo_class_id
                whereClause.demo_class_id = {
                    [Op.in]: matchingTrialStudents.map(t => t.id)
                };
            } else {
                // If no matches, return empty result
                return res.status(200).json({
                    status: 'success',
                    message: 'No classes found matching student name',
                    currentPage: page,
                    totalPages: 0,
                    totalClasses: 0,
                    upcomingClasses: upcomingCount,
                    completedClasses: completedCount,
                    canceledClasses: canceledCount,
                    classesThisMonth: classesThisMonth,
                    data: []
                });
            }
        }

        // 2. Get class data and total count in parallel
        // Modified to order by status (started, pending, ended, canceled) then by meeting_start DESC
        const [classData, totalCount] = await Promise.all([
            Class.findAll({
                attributes: [
                    'id', 'student_id', 'is_trial', 'meeting_start', 'meeting_end',
                    'status', 'join_url', 'admin_url', 'feedback_id',
                    'class_type', 'demo_class_id', 'student_goal', 'is_present', 'is_regular_hide',
                    'cancelled_at'
                ],
                where: whereClause,
                order: [
                    [
                        sequelize.literal(`
                    CASE 
                        WHEN status = 'started' THEN 0
                        WHEN status = 'pending' THEN 1
                        WHEN status = 'ended' THEN 2
                        WHEN status = 'canceled' THEN 3
                        ELSE 4
                    END
                `),
                        'ASC'
                    ],
                    ['meeting_start', 'DESC']
                ],
                limit: limit,
                offset: offset
            }),
            Class.count({ where: whereClause })
        ]);

        if (!classData || classData.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No classes found',
                currentPage: page,
                totalPages: 0,
                totalClasses: 0,
                upcomingClasses: upcomingCount,
                completedClasses: completedCount,
                canceledClasses: canceledCount,
                classesThisMonth: classesThisMonth,
                data: []
            });
        }

        // 3. Get all student IDs
        const studentIds = [...new Set(classData.filter(item => item.student_id).map(item => item.student_id))];

        // 4. Get all class IDs and demo class IDs
        const classIds = classData.map(item => item.id);
        const demoClassIds = classData
            .filter(item => item.demo_class_id)
            .map(item => item.demo_class_id)
            .filter(Boolean);

        // 5. Fetch students, homework, feedback, trial class data, and evaluations in parallel
        const [students, allHomework, allFeedback, trialClassData, evaluationData] = await Promise.all([
            Users.findAll({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: studentIds }
            }),
            Homework.findAll({
                attributes: ['id', 'lesson_id'],
                where: {
                    teacher_id: teacherId,
                    lesson_id: classIds
                }
            }),
            Feedback.findAll({
                attributes: ['id', 'lesson_id'],
                where: { lesson_id: classIds }
            }),
            TrialClassRegistration.findAll({
                attributes: [
                    'id', 'student_name'
                ],
                where: { id: demoClassIds }
            }),
            // Find evaluations for the trial classes
            TrialClassEvaluation.findAll({
                attributes: ['id', 'trial_class_registrations_id'],
                where: {
                    trial_class_registrations_id: {
                        [Op.in]: demoClassIds
                    }
                }
            })
        ]);

        // Create lookup maps for faster access
        const studentMap = students.reduce((acc, student) => {
            acc[student.id] = student;
            return acc;
        }, {});

        const homeworkMap = allHomework.reduce((acc, hw) => {
            acc[hw.lesson_id] = hw;
            return acc;
        }, {});

        const feedbackMap = allFeedback.reduce((acc, feedback) => {
            acc[feedback.lesson_id] = feedback;
            return acc;
        }, {});

        const trialClassMap = trialClassData.reduce((acc, trial) => {
            acc[trial.id] = trial;
            return acc;
        }, {});

        // Create a map for evaluations based on trial_class_registrations_id
        const evaluationMap = evaluationData.reduce((acc, evaluation) => {
            acc[evaluation.trial_class_registrations_id] = evaluation;
            return acc;
        }, {});

        // 6. Format data to match the UI
        const response = classData.map((classItem) => {
            const student = studentMap[classItem.student_id];
            const homework = homeworkMap[classItem.id];
            const feedback = feedbackMap[classItem.id];
            const trialClass = classItem.demo_class_id ? trialClassMap[classItem.demo_class_id] : null;
            // Check if this class has an evaluation
            const hasEvaluation = classItem.demo_class_id &&
                evaluationMap[classItem.demo_class_id];

            // Format the times for display (12:40 format)
            const startTime = moment(classItem.meeting_start).format('HH:mm');
            const endTime = moment(classItem.meeting_end).format('HH:mm');

            // Calculate duration in minutes
            const durationMinutes = moment(classItem.meeting_end).diff(moment(classItem.meeting_start), 'minutes');

            // Determine student details
            let studentName = "Unknown Student";
            let studentInitial = "U";
            let studentAvatar = null;

            if (student) {
                studentName = student.full_name;
                studentInitial = student.full_name.charAt(0).toUpperCase();
                studentAvatar = student.avatar;
            } else if (trialClass) {
                studentName = trialClass.student_name;
                studentInitial = trialClass.student_name.charAt(0).toUpperCase();
            }

            // Get topic / content of the class
            let topic = classItem.student_goal || "";
            if (!topic && classItem.is_trial) {
                topic = "Introduction and Level Assessment";
            }

            // Basic class information formatted for UI
            const cancellationDiffMinutes =
                classItem.cancelled_at && classItem.meeting_start
                    ? moment(classItem.meeting_start).diff(moment(classItem.cancelled_at), 'minutes')
                    : null;

            const isPaidClass =
                classItem.status === 'ended' ||
                ((classItem.status === 'canceled' || classItem.status === 'cancelled') &&
                    cancellationDiffMinutes !== null &&
                    cancellationDiffMinutes >= 0 &&
                    cancellationDiffMinutes <= 30);

            const paymentStatus =
                classItem.status === 'pending'
                    ? 'pending'
                    : (isPaidClass ? 'paid' : 'not paid');

            return {
                id: classItem.id.toString(),
                studentInitial,
                studentName,
                studentId: classItem.student_id,
                studentAvatar,
                type: classItem.is_trial == 1 ? "trial" : "regular",
                is_trial: classItem.is_trial,
                period: `${durationMinutes} min`,
                startTime,
                endTime,
                topic,
                status: classItem.status,
                timezone : teacher.timezone || 'UTC',
                meetingStart: classItem.meeting_start,
                meetingEnd: classItem.meeting_end,
                canceledAt: classItem.cancelled_at,
                cancellation_time_diff_minutes: cancellationDiffMinutes,
                joinUrl: classItem.join_url,
                adminUrl: classItem.admin_url,
                feedbackId: classItem.feedback_id,
                hasFeedback: !!feedback,
                hasHomework: !!homework,
                hasEvaluation: !!hasEvaluation, // Add the hasEvaluation property
                is_present: classItem.is_present,
                isAbsent: classItem.is_present, // Will be managed by frontend
                payment_status: paymentStatus
            };
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
            status: 'success',
            message: 'Teacher Classes and Details',
            currentPage: page,
            totalPages: totalPages,
            totalClasses: totalCount,
            upcomingClasses: upcomingCount,
            completedClasses: completedCount,
            canceledClasses: canceledCount,
            classesThisMonth: classesThisMonth, 
            data: response
        });

    } catch (error) {
        console.error('Error in viewTeacherClasses:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}


/**
 * Get class counts for the teacher dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getClassCounts(req, res) {
    try {
        const teacherId = req.user.id;
        const currentDate = new Date();

        // Get counts of different class types
        const [upcomingClasses, completedClasses, canceledClasses] = await Promise.all([
            Class.count({
                where: {
                    teacher_id: teacherId,
                    status: 'pending',
                    meeting_start: { [Op.gt]: currentDate }
                }
            }),
            Class.count({
                where: {
                    teacher_id: teacherId,
                    status: 'ended'
                }
            }),
            Class.count({
                where: {
                    teacher_id: teacherId,
                    status: 'canceled'
                }
            })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                upcomingClasses,
                completedClasses,
                canceledClasses
            }
        });

    } catch (error) {
        console.error('Error in getClassCounts:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
/**
 * Submit feedback for a class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function submitFeedback(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        const {
            grammar,
            pronunciation,
            speaking,
            comment,
            grammar_rate,
            pronunciation_rate,
            speaking_rate
        } = req.body;

        // Validate required fields
        if (!comment || !grammar_rate || !pronunciation_rate || !speaking_rate) {
            return res.status(400).json({
                status: 'error',
                message: 'Comment and all ratings are required'
            });
        }

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you are not authorized to add feedback for this class'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if feedback already exists
        let feedback = await Feedback.findOne({
            where: { lesson_id: classId },
            transaction
        });

        if (feedback) {
            // Update existing feedback
            await Feedback.update({
                grammar: grammar || feedback.grammar,
                pronunciation: pronunciation || feedback.pronunciation,
                speaking: speaking || feedback.speaking,
                comment: comment,
                grammar_rate: grammar_rate,
                pronunciation_rate: pronunciation_rate,
                speaking_rate: speaking_rate
            }, {
                where: { id: feedback.id },
                transaction
            });
        } else {
            // Create new feedback
            feedback = await Feedback.create({
                lesson_id: classId,
                teacher_id: teacherId,
                student_id: classData.student_id,
                grammar: grammar || null,
                pronunciation: pronunciation || null,
                speaking: speaking || null,
                comment: comment,
                grammar_rate: grammar_rate,
                pronunciation_rate: pronunciation_rate,
                speaking_rate: speaking_rate
            }, { transaction });

            // Update class with feedback_id if needed
            if (classData.feedback_id === null) {
                await Class.update({
                    feedback_id: feedback.id
                }, {
                    where: { id: classId },
                    transaction
                });
            }
        }

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Feedback submitted successfully',
            data: {
                feedback_id: feedback.id
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in submitFeedback:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Assign homework for a class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function assignHomework(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        const {
            title,
            description,
            teacher_notes,
            status
        } = req.body;

        // Validate required fields
        if (!description) {
            return res.status(400).json({
                status: 'error',
                message: 'Homework description is required'
            });
        }

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you are not authorized to assign homework for this class'
            });
        }

        // Handle file upload if present
        let attachmentUrl = null;
        let imageUrl = null;
        if (req.files) {
            // Handle attachment
            if (req.files.attachment && req.files.attachment[0]) {
                const fileUploadResult = await uploadHomeworkFile(teacherId, req.files.attachment[0]);
                if (!fileUploadResult.success) {
                    return res.status(400).json({
                        status: 'error',
                        message: fileUploadResult.error
                    });
                }
                attachmentUrl = fileUploadResult.data.file_url;
            }

            // Handle image
            if (req.files.image && req.files.image[0]) {
                const imageUploadResult = await uploadHomeworkFile(teacherId, req.files.image[0]);
                if (!imageUploadResult.success) {
                    return res.status(400).json({
                        status: 'error',
                        message: imageUploadResult.error
                    });
                }
                imageUrl = imageUploadResult.data.file_url;
            }
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if homework already exists
        let homework = await Homework.findOne({
            where: {
                lesson_id: classId,
                teacher_id: teacherId
            },
            transaction
        });

        if (homework) {
            // If there's a new attachment and an old one exists, delete the old one
            if (attachmentUrl && homework.attachment) {
                await deleteHomeworkFile(homework.attachment);
            }

            // Update existing homework
            await Homework.update({
                title: title || homework.title,
                description: description,
                attachment: attachmentUrl || homework.attachment,
                image: imageUrl || homework.image,
                teacher_notes: teacher_notes || homework.teacher_notes,
                status: status || homework.status,
                toggle_attachment_for_student: 1,
                toggle_description_for_student: 1,
                updated_at: new Date()
            }, {
                where: { id: homework.id },
                transaction
            });
        } else {
            // Create new homework
            homework = await Homework.create({
                lesson_id: classId,
                teacher_id: teacherId,
                student_id: classData.student_id,
                title: title || 'Homework',
                description: description,
                attachment: attachmentUrl,
                image: imageUrl,
                teacher_notes: teacher_notes || null,
                status: status || 'pending',
                toggle_attachment_for_student: 1,
                toggle_description_for_student: 1,
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction });
        }

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Homework assigned successfully',
            data: {
                homework_id: homework.id,
                attachment: attachmentUrl,
                image: imageUrl
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in assignHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Submit evaluation for a trial class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
// Modified submitEvaluation function
async function submitEvaluation(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        const {
            student_level,
            plan_recommendation,
            description,
            send_evaluation
        } = req.body;

        // Validate required fields
        if (!student_level) {
            return res.status(400).json({
                status: 'error',
                message: 'Student level is required'
            });
        }

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists, is a trial class, and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId,
                is_trial: 1
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found or you are not authorized to add evaluation for this class'
            });
        }

        // Check if the class has a demo class ID
        if (!classData.demo_class_id) {
            return res.status(400).json({
                status: 'error',
                message: 'This class is not associated with a trial class'
            });
        }

        // Get the trial registration data to verify it exists
        const trialClassRegistrationData = await TrialClassRegistration.findOne({
            where: { id: classData.demo_class_id }
        });

        if (!trialClassRegistrationData) {
            return res.status(400).json({
                status: 'error',
                message: 'The associated trial class registration does not exist'
            });
        }

        // Handle file upload if present
        let evaluationFileUrl = null;
        if (req.file) {
            const fileUploadResult = await uploadEvaluationFile(teacherId, req.file);
            if (!fileUploadResult.success) {
                return res.status(400).json({
                    status: 'error',
                    message: fileUploadResult.error
                });
            }
            evaluationFileUrl = fileUploadResult.data.file_url;
        }

        console.log('evaluationFileUrl:', evaluationFileUrl);

        // Start transaction
        transaction = await sequelize.transaction();

        // First, check if our demo_class_id (from Class table) exists directly in the democlasses table
        let demoClassId = classData.demo_class_id;

        // Check if evaluation already exists
        let evaluation = await TrialClassEvaluation.findOne({
            where: { trial_class_registrations_id: demoClassId },
            transaction
        });

        if (evaluation) {
            // If there's a new file and an old one exists, delete the old one
            if (evaluationFileUrl && evaluation.attachment_file) {
                await deleteEvaluationFile(evaluation.attachment_file);
            }

            // Update existing evaluation
            await TrialClassEvaluation.update({
                student_level: student_level,
                plan_recommendation: plan_recommendation || evaluation.plan_recommendation,
                description: description || evaluation.description,
                send_evaluation: send_evaluation || evaluation.send_evaluation,
                pdf_file: evaluationFileUrl || evaluation.attachment_file,
                updated_at: new Date()
            }, {
                where: { id: evaluation.id },
                transaction
            });
        } else {
            // Create new evaluation
            try {
                evaluation = await TrialClassEvaluation.create({
                    trial_class_registrations_id: demoClassId,
                    student_level: student_level,
                    plan_recommendation: plan_recommendation || null,
                    description: description || null,
                    send_evaluation: send_evaluation || 'pending',
                    pdf_file: evaluationFileUrl || null,
                    created_at: new Date(),
                    updated_at: new Date()
                }, { transaction });
            } catch (insertError) {
                await transaction.rollback();
                console.error('Error inserting evaluation:', insertError);
                return res.status(500).json({
                    status: 'error',
                    message: 'Foreign key constraint error - The demo_class_id does not exist in democlasses table',
                    details: process.env.NODE_ENV === 'development' ? insertError.message : undefined
                });
            }
        }

        // Now let's fetch relevant data for the WhatsApp notification
        // We'll use the trial class registration data directly for student information
        
        // Extract lesson recommendations from plan_recommendation
        let lessonNumbers = [];
        if (plan_recommendation) {
            // Extract numbers from the plan recommendation string
            const matches = plan_recommendation.match(/\d+/g);
            if (matches && matches.length >= 2) {
                lessonNumbers = [matches[0], matches[1]]; // [numberOfLessons, minutes]
            }
        }

        // Get base URL for PDF file
        const baseUrl = process.env.API_BASE_URL || 'https://tulkka-dev-api.tulkka.com';
        const pdfUrl = evaluationFileUrl ? `${baseUrl}${evaluationFileUrl}` : '';

        // Only send WhatsApp if send_evaluation includes whatsapp
        if (send_evaluation) {
            
            // Prepare notification data
            const notifyOptions = {
                'student.name': trialClassRegistrationData.student_name,
                'student.level': student_level,
                'student.recommendation': lessonNumbers.length === 2 ? 
                    `${lessonNumbers[0]} lessons / ${lessonNumbers[1]} minutes` : 
                    plan_recommendation || 'Custom plan',
                'pdf': pdfUrl
            };

            // Send WhatsApp notification
            try {
                // Get full student details for WhatsApp notification directly from trialClassRegistrationData
                const studentDetails = {
                    mobile: trialClassRegistrationData.mobile,
                    email: trialClassRegistrationData.email,
                    full_name: trialClassRegistrationData.student_name,
                    country_code: trialClassRegistrationData.country_code,
                    language: trialClassRegistrationData.language || 'EN'
                };
                
                console.log('notifyOptions:', notifyOptions);
                
                await whatsappReminderTrailClass('trial_class_student_evaluation', notifyOptions, studentDetails);
                console.log('WhatsApp notification sent successfully');
            } catch (notificationError) {
                console.error('Error sending WhatsApp notification:', notificationError);
                // Don't fail the entire request if notification fails
            }
        }

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Trial class evaluation submitted successfully',
            data: {
                evaluation_id: evaluation.id,
                attachment: evaluationFileUrl
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in submitEvaluation:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Mark a student as absent for a class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function markAbsent(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const classId = req.params.id;
        const { isAbsent } = req.body;

        // Calculate the is_present value (0 means absent, 1 means present)
        const isPresent = isAbsent;

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you are not authorized to mark attendance for this class'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();
        // Update class with is_present status (0 means absent)
        await Class.update({
            is_present: isPresent,
            updated_at: new Date()
        }, {
            where: { id: classId },
            transaction
        });

        // If student was marked as completed or absent and class is pending, update it
        if (isPresent === 0 && classData.status === 'pending') {
            await Class.update({
                status: 'ended',
                updated_at: new Date()
            }, {
                where: { id: classId },
                transaction
            });
        }

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: isAbsent ? 'Student marked as absent' : 'Student marked as present',
            data: {
                class_id: classId,
                is_present: isPresent
            }
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in markAbsent:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get trial class evaluation data for a class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTrialEvaluation(req, res) {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists, is a trial class, and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId,
                is_trial: 1
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class not found or you are not authorized to access this evaluation'
            });
        }

        // Check if the class has a trial class registration record
        if (!classData.demo_class_id) {
            return res.status(400).json({
                status: 'error',
                message: 'This class is not associated with a trial class registration'
            });
        }

        // Get the trial class registration data
        const trialClassRegistration = await TrialClassRegistration.findOne({
            where: { id: classData.demo_class_id }
        });

        if (!trialClassRegistration) {
            return res.status(400).json({
                status: 'error',
                message: 'The associated demo class ID does not exist in the database'
            });
        }

        // Get the evaluation data if it exists
        const evaluation = await TrialClassEvaluation.findOne({
            where: { trial_class_registrations_id: classData.demo_class_id }
        });

        // Format response data
        const responseData = {
            // Student data from trial registration
            student: {
                name: trialClassRegistration.student_name || '',
                age: trialClassRegistration.age?.toString() || '',
                parentName: trialClassRegistration.parent_name || '',
                dateTime: trialClassRegistration.meeting_start || '',
                email: trialClassRegistration.email || '',
                phone: trialClassRegistration.mobile || '',
                country_code: trialClassRegistration.country_code || ''
            },
            // Teacher data
            teacher: {
                name: teacher.full_name || '',
                id: teacher.id
            },
            // Evaluation data if exists
            evaluation: evaluation ? {
                id: evaluation.id,
                student_level: evaluation.student_level || '',
                plan_recommendation: evaluation.plan_recommendation || '',
                description: evaluation.description || '',
                send_evaluation: evaluation.send_evaluation || 'pending',
                attachment_file: evaluation.attachment_file || null,
                created_at: evaluation.created_at,
                updated_at: evaluation.updated_at
            } : null
        };

        res.status(200).json({
            status: 'success',
            message: 'Trial class evaluation data',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getTrialEvaluation:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

const homeworkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    }
});

// For evaluation file uploads
const evaluationUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

/**
 * Get submitted feedback details for a class (Fixed version)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSubmittedFeedback(req, res) {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you are not authorized to view feedback for this class'
            });
        }

        // Get the feedback data without associations
        const feedback = await Feedback.findOne({
            where: { lesson_id: classId }
        });

        if (!feedback) {
            return res.status(404).json({
                status: 'error',
                message: 'Feedback not found for this class'
            });
        }

        // Get student and class information separately
        const [student, classInfo] = await Promise.all([
            Users.findOne({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: feedback.student_id }
            }),
            Class.findOne({
                attributes: ['id', 'student_goal', 'meeting_start'],
                where: { id: feedback.lesson_id }
            })
        ]);

        // Calculate average rating
        const ratings = [feedback.grammar_rate, feedback.pronunciation_rate, feedback.speaking_rate];
        const validRatings = ratings.filter(rating => rating !== null && rating !== undefined);
        const averageRating = validRatings.length > 0 
            ? (validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length).toFixed(1)
            : null;

        // Format response
        const responseData = {
            id: feedback.id,
            lesson_id: feedback.lesson_id,
            student_id: feedback.student_id,
            teacher_id: feedback.teacher_id,
            grammar: feedback.grammar,
            pronunciation: feedback.pronunciation,
            speaking: feedback.speaking,
            comment: feedback.comment,
            grammar_rate: feedback.grammar_rate,
            pronunciation_rate: feedback.pronunciation_rate,
            speaking_rate: feedback.speaking_rate,
            average_rating: averageRating,
            created_at: feedback.created_at,
            updated_at: feedback.updated_at,
            // Add student and lesson data separately
            student: student ? {
                id: student.id,
                full_name: student.full_name,
                avatar: student.avatar
            } : null,
            lesson: classInfo ? {
                id: classInfo.id,
                student_goal: classInfo.student_goal,
                meeting_start: classInfo.meeting_start
            } : null
        };

        res.status(200).json({
            status: 'success',
            message: 'Feedback details retrieved successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getSubmittedFeedback:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get submitted homework details for a class (Fixed version)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSubmittedHomework(req, res) {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;

        // Verify teacher exists
        const teacher = await Users.findOne({
            where: {
                id: teacherId,
                role_name: {
                    [Op.like]: '%teacher%'
                }
            }
        });

        if (!teacher) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Teacher role required.'
            });
        }

        // Verify class exists and belongs to this teacher
        const classData = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId
            }
        });

        if (!classData) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you are not authorized to view homework for this class'
            });
        }

        // Get the homework data without associations
        const homework = await Homework.findOne({
            where: {
                lesson_id: classId,
                teacher_id: teacherId
            }
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found for this class'
            });
        }

        // Get student and class information separately
        const [student, classInfo] = await Promise.all([
            Users.findOne({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: homework.student_id }
            }),
            Class.findOne({
                attributes: ['id', 'student_goal', 'meeting_start'],
                where: { id: homework.lesson_id }
            })
        ]);

        // Check if there's a submission - adjust this based on your homework submission structure
        // If you have homework.student_answers or homework.answer_attachment, use those
        const hasSubmission = !!(homework.student_answers || homework.answer_attachment);

        // Format response
        const responseData = {
            id: homework.id,
            lesson_id: homework.lesson_id,
            student_id: homework.student_id,
            teacher_id: homework.teacher_id,
            title: homework.title,
            description: homework.description,
            attachment: homework.attachment,
            image: homework.image,
            teacher_notes: homework.teacher_notes,
            status: homework.status,
            grade: homework.result || homework.grade || null,
            student_answers: homework.student_answers,
            answer_attachment: homework.answer_attachment,
            created_at: homework.created_at,
            updated_at: homework.updated_at,
            // Add student and lesson data separately
            student: student ? {
                id: student.id,
                full_name: student.full_name,
                avatar: student.avatar
            } : null,
            lesson: classInfo ? {
                id: classInfo.id,
                student_goal: classInfo.student_goal,
                meeting_start: classInfo.meeting_start
            } : null,
            // Add submission info
            submission: hasSubmission ? {
                answer: homework.student_answers,
                attachment: homework.answer_attachment
            } : null
        };

        res.status(200).json({
            status: 'success',
            message: 'Homework details retrieved successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getSubmittedHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    viewTeacherClasses,
    getClassCounts,
    submitFeedback,
    assignHomework,
    submitEvaluation,
    markAbsent,
    getTrialEvaluation,
    getSubmittedFeedback,
    getSubmittedHomework,
    homeworkUpload,
    evaluationUpload
};
