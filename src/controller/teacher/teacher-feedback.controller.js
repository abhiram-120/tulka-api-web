const Users = require('../../models/users');
const Class = require('../../models/classes');
const LessonFeedback = require('../../models/lessonFeedback');
const { Op } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const { getLocalDateTime } = require('../../utils/date.utils');
const moment = require('moment-timezone');

/**
 * Get teacher's feedback with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getTeacherFeedback(req, res) {
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
        const startDate = req.query.start_date;
        const endDate = req.query.end_date;
        const studentName = req.query.student_name;
        const lessonId = req.query.lesson_id;
        const minRating = req.query.min_rating;

        // Building where clause for feedback
        const whereClause = {
            teacher_id: teacherId
        };

        // Date range filter (assuming feedback has created_at or timestamp)
        if (startDate && endDate) {
            // Since lessonFeedback doesn't have timestamps, we'll join with classes to filter by class date
            whereClause.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Lesson ID filter
        if (lessonId) {
            whereClause.lesson_id = lessonId;
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
                    message: 'No feedback found matching student name',
                    currentPage: page,
                    totalPages: 0,
                    totalFeedback: 0,
                    data: []
                });
            }
        }

        // Get feedback counts for statistics
        const [totalCount] = await Promise.all([
            LessonFeedback.count({ where: { teacher_id: teacherId } })
        ]);

        // Get feedback data with pagination
        const [feedbackData, totalFilteredCount] = await Promise.all([
            LessonFeedback.findAll({
                attributes: [
                    'id', 'teacher_id', 'student_id', 'lesson_id', 'pronunciation',
                    'speaking', 'comment', 'grammar_rate', 'pronunciation_rate',
                    'speaking_rate', 'grammar'
                ],
                where: whereClause,
                order: [['id', 'DESC']], // Order by ID since no timestamps
                limit: limit,
                offset: offset
            }),
            LessonFeedback.count({ where: whereClause })
        ]);

        if (!feedbackData || feedbackData.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No feedback found',
                currentPage: page,
                totalPages: 0,
                totalFeedback: totalCount,
                data: []
            });
        }

        // Get student and class data
        const studentIds = [...new Set(feedbackData.map(fb => fb.student_id))];
        const lessonIds = [...new Set(feedbackData.filter(fb => fb.lesson_id).map(fb => fb.lesson_id))];

        const [students, classes] = await Promise.all([
            Users.findAll({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: studentIds }
            }),
            Class.findAll({
                attributes: ['id', 'meeting_start', 'meeting_end', 'student_goal'],
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

        // Format feedback data
        const formattedFeedback = feedbackData.map((feedback) => {
            const student = studentMap[feedback.student_id];
            const classInfo = feedback.lesson_id ? classMap[feedback.lesson_id] : null;

            // Calculate average rating
            const ratings = [feedback.grammar_rate, feedback.pronunciation_rate, feedback.speaking_rate].filter(r => r !== null);
            const averageRating = ratings.length > 0 ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1) : null;

            return {
                id: feedback.id.toString(),
                studentName: student ? student.full_name : 'Unknown Student',
                studentId: feedback.student_id,
                studentAvatar: student?.avatar || null,
                studentInitial: student ? student.full_name.charAt(0).toUpperCase() : 'U',
                lessonId: feedback.lesson_id,
                lessonDate: classInfo?.meeting_start ? moment(classInfo.meeting_start).format('YYYY-MM-DD') : null,
                comment: feedback.comment,
                grammarFeedback: feedback.grammar,
                pronunciationFeedback: feedback.pronunciation,
                speakingFeedback: feedback.speaking,
                grammarRate: feedback.grammar_rate,
                pronunciationRate: feedback.pronunciation_rate,
                speakingRate: feedback.speaking_rate,
                averageRating: averageRating,
                createdAt: classInfo?.meeting_start || null, // Use class date as proxy
                timezone: teacher.timezone || 'UTC'
            };
        });

        // Apply rating filter if specified (after formatting since we calculate average here)
        let filteredFeedback = formattedFeedback;
        if (minRating) {
            filteredFeedback = formattedFeedback.filter(fb => 
                fb.averageRating && parseFloat(fb.averageRating) >= parseFloat(minRating)
            );
        }

        const totalPages = Math.ceil(totalFilteredCount / limit);

        res.status(200).json({
            status: 'success',
            message: 'Teacher feedback retrieved successfully',
            currentPage: page,
            totalPages: totalPages,
            totalFeedback: totalCount,
            data: filteredFeedback
        });

    } catch (error) {
        console.error('Error in getTeacherFeedback:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get feedback statistics for dashboard
 */
async function getFeedbackStats(req, res) {
    try {
        const teacherId = req.user.id;

        // Get all feedback for this teacher
        const allFeedback = await LessonFeedback.findAll({
            where: { teacher_id: teacherId },
            attributes: ['grammar_rate', 'pronunciation_rate', 'speaking_rate']
        });

        const totalFeedback = allFeedback.length;

        // Calculate average ratings
        let grammarSum = 0, pronunciationSum = 0, speakingSum = 0;
        let grammarCount = 0, pronunciationCount = 0, speakingCount = 0;

        allFeedback.forEach(feedback => {
            if (feedback.grammar_rate !== null) {
                grammarSum += feedback.grammar_rate;
                grammarCount++;
            }
            if (feedback.pronunciation_rate !== null) {
                pronunciationSum += feedback.pronunciation_rate;
                pronunciationCount++;
            }
            if (feedback.speaking_rate !== null) {
                speakingSum += feedback.speaking_rate;
                speakingCount++;
            }
        });

        const averageGrammarRating = grammarCount > 0 ? (grammarSum / grammarCount).toFixed(1) : 0;
        const averagePronunciationRating = pronunciationCount > 0 ? (pronunciationSum / pronunciationCount).toFixed(1) : 0;
        const averageSpeakingRating = speakingCount > 0 ? (speakingSum / speakingCount).toFixed(1) : 0;
        const overallAverageRating = totalFeedback > 0 ? ((grammarSum + pronunciationSum + speakingSum) / (grammarCount + pronunciationCount + speakingCount)).toFixed(1) : 0;

        // Get recent feedback count (last 30 days - approximation based on feedback ID)
        const recentFeedbackCount = await LessonFeedback.count({
            where: {
                teacher_id: teacherId,
                // Since no timestamps, we'll use a rough estimation based on recent IDs
                id: {
                    [Op.gte]: sequelize.literal('(SELECT MAX(id) - 100 FROM lesson_feedbacks WHERE teacher_id = ' + teacherId + ')')
                }
            }
        });

        res.status(200).json({
            status: 'success',
            data: {
                totalFeedback,
                averageGrammarRating: parseFloat(averageGrammarRating),
                averagePronunciationRating: parseFloat(averagePronunciationRating),
                averageSpeakingRating: parseFloat(averageSpeakingRating),
                overallAverageRating: parseFloat(overallAverageRating),
                recentFeedbackCount
            }
        });

    } catch (error) {
        console.error('Error in getFeedbackStats:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get specific feedback details
 */
async function getFeedbackDetails(req, res) {
    try {
        const teacherId = req.user.id;
        const feedbackId = req.params.id;

        const feedback = await LessonFeedback.findOne({
            where: {
                id: feedbackId,
                teacher_id: teacherId
            }
        });

        if (!feedback) {
            return res.status(404).json({
                status: 'error',
                message: 'Feedback not found or access denied'
            });
        }

        // Get student and class information
        const [student, classInfo] = await Promise.all([
            Users.findOne({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: feedback.student_id }
            }),
            feedback.lesson_id ? Class.findOne({
                attributes: ['id', 'meeting_start', 'meeting_end', 'student_goal'],
                where: { id: feedback.lesson_id }
            }) : null
        ]);

        const response = {
            id: feedback.id.toString(),
            studentName: student?.full_name || 'Unknown Student',
            studentAvatar: student?.avatar || null,
            lessonDate: classInfo?.meeting_start || null,
            comment: feedback.comment,
            grammarFeedback: feedback.grammar,
            pronunciationFeedback: feedback.pronunciation,
            speakingFeedback: feedback.speaking,
            grammarRate: feedback.grammar_rate,
            pronunciationRate: feedback.pronunciation_rate,
            speakingRate: feedback.speaking_rate
        };

        res.status(200).json({
            status: 'success',
            data: response
        });

    } catch (error) {
        console.error('Error in getFeedbackDetails:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Update feedback
 */
async function updateFeedback(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const feedbackId = req.params.id;
        const {
            comment,
            grammar,
            pronunciation,
            speaking,
            grammar_rate,
            pronunciation_rate,
            speaking_rate
        } = req.body;

        // Verify feedback exists and belongs to teacher
        const feedback = await LessonFeedback.findOne({
            where: {
                id: feedbackId,
                teacher_id: teacherId
            }
        });

        if (!feedback) {
            return res.status(404).json({
                status: 'error',
                message: 'Feedback not found or access denied'
            });
        }

        transaction = await sequelize.transaction();

        await LessonFeedback.update({
            comment: comment || feedback.comment,
            grammar: grammar || feedback.grammar,
            pronunciation: pronunciation || feedback.pronunciation,
            speaking: speaking || feedback.speaking,
            grammar_rate: grammar_rate !== undefined ? grammar_rate : feedback.grammar_rate,
            pronunciation_rate: pronunciation_rate !== undefined ? pronunciation_rate : feedback.pronunciation_rate,
            speaking_rate: speaking_rate !== undefined ? speaking_rate : feedback.speaking_rate
        }, {
            where: { id: feedbackId },
            transaction
        });

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Feedback updated successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateFeedback:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Delete feedback
 */
async function deleteFeedback(req, res) {
    let transaction;

    try {
        const teacherId = req.user.id;
        const feedbackId = req.params.id;

        const feedback = await LessonFeedback.findOne({
            where: {
                id: feedbackId,
                teacher_id: teacherId
            }
        });

        if (!feedback) {
            return res.status(404).json({
                status: 'error',
                message: 'Feedback not found or access denied'
            });
        }

        transaction = await sequelize.transaction();

        // Also need to update the class to remove feedback_id reference
        if (feedback.lesson_id) {
            await Class.update({
                feedback_id: null
            }, {
                where: { id: feedback.lesson_id },
                transaction
            });
        }

        await LessonFeedback.destroy({
            where: { id: feedbackId },
            transaction
        });

        await transaction.commit();

        res.status(200).json({
            status: 'success',
            message: 'Feedback deleted successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in deleteFeedback:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get feedback by lesson ID
 */
async function getFeedbackByLesson(req, res) {
    try {
        const teacherId = req.user.id;
        const lessonId = req.params.lessonId;

        const feedback = await LessonFeedback.findOne({
            where: {
                lesson_id: lessonId,
                teacher_id: teacherId
            }
        });

        if (!feedback) {
            return res.status(404).json({
                status: 'error',
                message: 'No feedback found for this lesson'
            });
        }

        // Get student and class information
        const [student, classInfo] = await Promise.all([
            Users.findOne({
                attributes: ['id', 'full_name', 'avatar'],
                where: { id: feedback.student_id }
            }),
            Class.findOne({
                attributes: ['id', 'meeting_start', 'meeting_end', 'student_goal'],
                where: { id: lessonId }
            })
        ]);

        const response = {
            id: feedback.id.toString(),
            studentName: student?.full_name || 'Unknown Student',
            studentAvatar: student?.avatar || null,
            lessonDate: classInfo?.meeting_start || null,
            comment: feedback.comment,
            grammarFeedback: feedback.grammar,
            pronunciationFeedback: feedback.pronunciation,
            speakingFeedback: feedback.speaking,
            grammarRate: feedback.grammar_rate,
            pronunciationRate: feedback.pronunciation_rate,
            speakingRate: feedback.speaking_rate
        };

        res.status(200).json({
            status: 'success',
            data: response
        });

    } catch (error) {
        console.error('Error in getFeedbackByLesson:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get feedback analytics
 */
async function getFeedbackAnalytics(req, res) {
    try {
        const teacherId = req.user.id;

        // Get all feedback with ratings
        const allFeedback = await LessonFeedback.findAll({
            where: { teacher_id: teacherId },
            attributes: ['grammar_rate', 'pronunciation_rate', 'speaking_rate', 'student_id']
        });

        // Calculate rating distribution
        const ratingDistribution = {
            grammar: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            pronunciation: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            speaking: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        };

        // Count unique students
        const uniqueStudents = new Set();

        allFeedback.forEach(feedback => {
            uniqueStudents.add(feedback.student_id);
            
            if (feedback.grammar_rate) {
                ratingDistribution.grammar[feedback.grammar_rate]++;
            }
            if (feedback.pronunciation_rate) {
                ratingDistribution.pronunciation[feedback.pronunciation_rate]++;
            }
            if (feedback.speaking_rate) {
                ratingDistribution.speaking[feedback.speaking_rate]++;
            }
        });

        res.status(200).json({
            status: 'success',
            data: {
                totalFeedback: allFeedback.length,
                uniqueStudentsFeedback: uniqueStudents.size,
                ratingDistribution
            }
        });

    } catch (error) {
        console.error('Error in getFeedbackAnalytics:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    getTeacherFeedback,
    getFeedbackStats,
    getFeedbackDetails,
    updateFeedback,
    deleteFeedback,
    getFeedbackByLesson,
    getFeedbackAnalytics
};