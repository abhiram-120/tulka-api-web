const Users = require('../../models/users');
const Class = require('../../models/classes');
const Homework = require('../../models/homework');
const { Op } = require('sequelize');
const multer = require('multer');
const { sequelize } = require('../../connection/connection');
const { uploadHomeworkFile, deleteHomeworkFile } = require('../../services/profile/image-service');
const { getLocalDateTime } = require('../../utils/date.utils');
const moment = require('moment-timezone');

/**
 * Get teacher's homework assignments with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherHomework(req, res) {
    try {
        const teacherId = req.user.id;

        // Get teacher data
        const teacher = await Users.findOne({
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
        const DEFAULT_PAGE_SIZE = 10;
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || DEFAULT_PAGE_SIZE);
        const offset = (page - 1) * limit;

        // Filters
        const status = req.query.status;
        const startDate = req.query.start_date;
        const endDate = req.query.end_date;
        const studentName = req.query.student_name;

        // Building where clause for homework
        const whereClause = {
            teacher_id: teacherId
        };

        // Status filter
        if (status && status !== 'all') {
            whereClause.status = status;
        }

        // Date range filter
        if (startDate && endDate) {
            whereClause.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

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

            if (filteredStudentIds.length > 0) {
                whereClause.student_id = {
                    [Op.in]: filteredStudentIds
                };
            } else {
                // If no matches, return empty result
                return res.status(200).json({
                    status: 'success',
                    message: 'No homework found matching student name',
                    currentPage: page,
                    totalPages: 0,
                    totalHomework: 0,
                    pendingHomework: 0,
                    completedHomework: 0,
                    data: []
                });
            }
        }

        // Get homework counts for statistics
        const [pendingCount, completedCount, totalCount] = await Promise.all([
            Homework.count({
                where: {
                    teacher_id: teacherId,
                    status: 'pending'
                }
            }),
            Homework.count({
                where: {
                    teacher_id: teacherId,
                    status: 'completed'
                }
            }),
            Homework.count({ where: { teacher_id: teacherId } })
        ]);

        // Get homework data with pagination
        const [homeworkData, totalFilteredCount] = await Promise.all([
            Homework.findAll({
                attributes: [
                    'id',
                    'lesson_id',
                    'student_id',
                    'title',
                    'description',
                    'status',
                    'created_at',
                    'attachment',
                    'teacher_notes',
                    'student_answers',
                    'result',
                    'toggle_attachment_for_student',
                    'toggle_description_for_student'
                ],
                where: whereClause,
                order: [
                    ['created_at', 'DESC']
                ],
                limit: limit,
                offset: offset
            }),
            Homework.count({ where: whereClause })
        ]);

        if (!homeworkData || homeworkData.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No homework found',
                currentPage: page,
                totalPages: 0,
                totalHomework: totalCount,
                pendingHomework: pendingCount,
                completedHomework: completedCount,
                data: []
            });
        }

        // Get student and class data
        const studentIds = [...new Set(homeworkData.map(hw => hw.student_id))];
        const lessonIds = [...new Set(homeworkData.filter(hw => hw.lesson_id).map(hw => hw.lesson_id))];

        const [students, classes] = await Promise.all([
            Users.findAll({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: studentIds }
            }),
            Class.findAll({
                attributes: ['id', 'meeting_start', 'meeting_end'],
                where: { id: lessonIds }
            })
        ]);

        // Create lookup maps
        const studentMap = students.reduce((acc, student) => {
            acc[student.id] = student;
            return acc;
        }, {});

        const classMap = classes.reduce((acc, cls) => {
            acc[cls.id] = cls;
            return acc;
        }, {});

        // Format homework data
        const formattedHomework = await Promise.all(
            homeworkData.map(async (homework) => {
                const student = studentMap[homework.student_id];
                const classInfo = homework.lesson_id ? classMap[homework.lesson_id] : null;

                // Format dates using teacher's timezone
                const createdAtLocal = await getLocalDateTime(homework.created_at, teacher.timezone || 'UTC');

                return {
                    id: homework.id.toString(),
                    title: homework.title || 'Homework Assignment',
                    description: homework.description,
                    status: homework.status,
                    studentName: student ? student.full_name : 'Unknown Student',
                    studentId: homework.student_id,
                    studentAvatar: student?.avatar || null,
                    studentInitial: student ? student.full_name.charAt(0).toUpperCase() : 'U',
                    lessonId: homework.lesson_id,
                    lessonDate: classInfo?.meeting_start ? moment(classInfo.meeting_start).format('YYYY-MM-DD') : null,
                    createdAt: createdAtLocal,
                    attachment: homework.attachment,
                    teacherNotes: homework.teacher_notes,
                    toggleAttachmentForStudent: !!homework.toggle_attachment_for_student,
                    toggleDescriptionForStudent: !!homework.toggle_description_for_student,
                    hasSubmission: !!homework.student_answers,
                    submissionText: homework.student_answers,
                    grade: homework.result,
                    timezone: teacher.timezone || 'UTC'
                };
            })
        );

        const totalPages = Math.ceil(totalFilteredCount / limit);

        res.status(200).json({
            status: 'success',
            message: 'Teacher homework assignments',
            currentPage: page,
            totalPages: totalPages,
            totalHomework: totalCount,
            pendingHomework: pendingCount,
            completedHomework: completedCount,
            submittedHomework: await Homework.count({
                where: {
                    teacher_id: teacherId,
                    status: 'submitted'
                }
            }),
            data: formattedHomework
        });

    } catch (error) {
        console.error('Error in getTeacherHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get homework statistics for dashboard
 */
async function getHomeworkStats(req, res) {
    try {
        const teacherId = req.user.id;

        const [totalHomework, pendingHomework, submittedHomework, completedHomework, overdueHomework] = await Promise.all([
            Homework.count({ where: { teacher_id: teacherId } }),
            Homework.count({ where: { teacher_id: teacherId, status: 'pending' } }),
            Homework.count({ where: { teacher_id: teacherId, status: 'submitted' } }),
            Homework.count({ where: { teacher_id: teacherId, status: 'completed' } }),
            Homework.count({ where: { teacher_id: teacherId, status: 'overdue' } })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                totalHomework,
                pendingHomework,
                submittedHomework,
                completedHomework,
                overdueHomework
            }
        });

    } catch (error) {
        console.error('Error in getHomeworkStats:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get specific homework details
 */
async function getHomeworkDetails(req, res) {
    try {
        const teacherId = req.user.id;
        const homeworkId = req.params.id;

        const homework = await Homework.findOne({
            where: {
                id: homeworkId,
                teacher_id: teacherId
            }
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found or access denied'
            });
        }

        // Get student and class information
        const [student, classInfo] = await Promise.all([
            Users.findOne({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: homework.student_id }
            }),
            homework.lesson_id ? Class.findOne({
                attributes: ['id', 'meeting_start', 'meeting_end'],
                where: { id: homework.lesson_id }
            }) : null
        ]);

        const response = {
            id: homework.id.toString(),
            title: homework.title,
            description: homework.description,
            status: homework.status,
            studentName: student?.full_name || 'Unknown Student',
            studentAvatar: student?.avatar || null,
            lessonDate: classInfo?.meeting_start || null,
            createdAt: homework.created_at,
            attachment: homework.attachment,
            image: homework.image,
            teacherNotes: homework.teacher_notes,
            studentAnswers: homework.student_answers,
            answerAttachment: homework.answer_attachment,
            grade: homework.result,
            toggleAttachmentForStudent: !!homework.toggle_attachment_for_student,
            toggleDescriptionForStudent: !!homework.toggle_description_for_student
        };

        res.status(200).json({
            status: 'success',
            data: response
        });

    } catch (error) {
        console.error('Error in getHomeworkDetails:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Update homework
 */
async function updateHomework(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const homeworkId = req.params.id;
        const { title, description, teacher_notes, status } = req.body;

        // Verify homework exists and belongs to teacher
        const homework = await Homework.findOne({
            where: {
                id: homeworkId,
                teacher_id: teacherId
            }
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found or access denied'
            });
        }

        // Handle file upload if present
        let attachmentUrl = homework.attachment;
        if (req.file) {
            // Delete old file if exists
            if (homework.attachment) {
                await deleteHomeworkFile(homework.attachment);
            }
            
            const fileUploadResult = await uploadHomeworkFile(teacherId, req.file);
            if (!fileUploadResult.success) {
                return res.status(400).json({
                    status: 'error',
                    message: fileUploadResult.error
                });
            }
            attachmentUrl = fileUploadResult.data.file_url;
        }

        transaction = await sequelize.transaction();

        await Homework.update({
            title: title || homework.title,
            description: description || homework.description,
            teacher_notes: teacher_notes || homework.teacher_notes,
            attachment: attachmentUrl,
            status: status || homework.status,
            toggle_attachment_for_student: 1,
            toggle_description_for_student: 1
        }, {
            where: { id: homeworkId },
            transaction
        });

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Homework updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Delete homework
 */
async function deleteHomework(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const homeworkId = req.params.id;

        const homework = await Homework.findOne({
            where: {
                id: homeworkId,
                teacher_id: teacherId
            }
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found or access denied'
            });
        }

        transaction = await sequelize.transaction();

        // Delete associated files
        if (homework.attachment) {
            await deleteHomeworkFile(homework.attachment);
        }
        if (homework.answer_attachment) {
            await deleteHomeworkFile(homework.answer_attachment);
        }

        await Homework.destroy({
            where: { id: homeworkId },
            transaction
        });

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Homework deleted successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in deleteHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Review submitted homework
 */
async function reviewHomework(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const homeworkId = req.params.id;
        const { grade, feedback, status } = req.body;

        const homework = await Homework.findOne({
            where: {
                id: homeworkId,
                teacher_id: teacherId
            }
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found or access denied'
            });
        }

        transaction = await sequelize.transaction();

        await Homework.update({
            result: grade || homework.result,
            teacher_notes: feedback || homework.teacher_notes,
            status: status || 'completed'
        }, {
            where: { id: homeworkId },
            transaction
        });

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Homework reviewed successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in reviewHomework:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get homework submissions
 */
async function getHomeworkSubmissions(req, res) {
    try {
        const teacherId = req.user.id;
        const homeworkId = req.params.id;

        const homework = await Homework.findOne({
            where: {
                id: homeworkId,
                teacher_id: teacherId
            },
            include: [
                {
                    model: Users,
                    as: 'student',
                    attributes: ['id', 'full_name', 'avatar']
                }
            ]
        });

        if (!homework) {
            return res.status(404).json({
                status: 'error',
                message: 'Homework not found or access denied'
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                id: homework.id,
                studentAnswers: homework.student_answers,
                answerAttachment: homework.answer_attachment,
                submittedAt: homework.updated_at,
                grade: homework.result,
                teacherFeedback: homework.teacher_notes
            }
        });

    } catch (error) {
        console.error('Error in getHomeworkSubmissions:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Multer configuration for file uploads
const homeworkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    }
});

module.exports = {
    getTeacherHomework,
    getHomeworkStats,
    getHomeworkDetails,
    updateHomework,
    deleteHomework,
    reviewHomework,
    getHomeworkSubmissions,
    homeworkUpload
};