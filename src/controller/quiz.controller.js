const QuizQuestion = require('../models/quizQuestion');
const QuizOption = require('../models/quizOption');
const PracticeSession = require('../models/practiceSession');
const PracticeResult = require('../models/practiceResult');
const PracticeQuestion = require('../models/practiceQuestion');
const { Op, Sequelize } = require('sequelize');

// Get quiz questions for a practice session
async function getQuizQuestions(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'quiz'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get questions for this session
        const sessionQuestions = await PracticeQuestion.findAll({
            where: {
                session_id: sessionId,
                question_type: 'quiz'
            }
        });
        
        let questions = [];
        
        // If we already have questions assigned to this session, use them
        if (sessionQuestions.length > 0) {
            const questionIds = sessionQuestions.map(q => q.question_id);
            
            // Fetch the quiz questions with their options
            questions = await QuizQuestion.findAll({
                where: {
                    id: { [Op.in]: questionIds }
                },
                include: [
                    {
                        model: QuizOption,
                        as: 'Options'
                    }
                ],
                order: [['id', 'ASC']]
            });
        } else {
            // Otherwise, select new questions based on the session source
            // For example, if source_type is 'wordFile', we would select questions relevant to that file
            
            // For this example, we'll just get random questions from the database
            questions = await QuizQuestion.findAll({
                limit: 5,  // Default to 5 questions per quiz
                include: [
                    {
                        model: QuizOption,
                        as: 'Options'
                    }
                ],
                order: Sequelize.literal('RAND()') // Random selection
            });
            
            // Associate these questions with the session
            await Promise.all(questions.map(question => 
                PracticeQuestion.create({
                    session_id: sessionId,
                    question_type: 'quiz',
                    question_id: question.id,
                    is_correct: null
                })
            ));
        }
        
        // Transform questions for the response
        const formattedQuestions = questions.map(question => {
            const options = question.Options.map(option => ({
                id: option.id,
                text: option.text
            }));
            
            // Find the correct option
            const correctOption = question.Options.find(option => option.is_correct);
            
            return {
                id: question.id,
                prompt: question.prompt,
                options,
                // Only include the correct answer if the question has been answered
                correctOptionId: sessionQuestions.find(sq => sq.question_id === question.id && sq.is_correct !== null) 
                    ? correctOption.id 
                    : undefined,
                explanation: sessionQuestions.find(sq => sq.question_id === question.id && sq.is_correct !== null)
                    ? question.explanation
                    : undefined
            };
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Quiz questions retrieved successfully',
            data: {
                sessionId,
                totalQuestions: formattedQuestions.length,
                questions: formattedQuestions
            }
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Submit an answer to a quiz question
async function submitQuizAnswer(req, res) {
    try {
        const { sessionId } = req.params;
        const { questionId, selectedOptionId } = req.body;
        
        if (!questionId || !selectedOptionId) {
            return res.status(400).json({
                status: 'error',
                message: 'Question ID and selected option ID are required'
            });
        }
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'quiz'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get the question and check if the answer is correct
        const question = await QuizQuestion.findByPk(questionId, {
            include: [
                {
                    model: QuizOption,
                    as: 'Options'
                }
            ]
        });
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        // Find the selected option
        const selectedOption = question.Options.find(option => option.id == selectedOptionId);
        
        if (!selectedOption) {
            return res.status(404).json({
                status: 'error',
                message: 'Selected option not found'
            });
        }
        
        // Check if the answer is correct
        const isCorrect = selectedOption.is_correct;
        
        // Find the practice question record
        let practiceQuestion = await PracticeQuestion.findOne({
            where: {
                session_id: sessionId,
                question_type: 'quiz',
                question_id: questionId
            }
        });
        
        // Update practice question record
        if (practiceQuestion) {
            await practiceQuestion.update({
                user_answer: selectedOptionId,
                is_correct: isCorrect,
                time_taken: req.body.timeTaken || null
            });
        } else {
            // Create practice question record if it doesn't exist
            practiceQuestion = await PracticeQuestion.create({
                session_id: sessionId,
                question_type: 'quiz',
                question_id: questionId,
                user_answer: selectedOptionId,
                is_correct: isCorrect,
                time_taken: req.body.timeTaken || null
            });
        }
        
        // Calculate progress
        const totalQuestions = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'quiz'
            }
        });
        
        const answeredQuestions = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'quiz',
                user_answer: { [Op.ne]: null }
            }
        });
        
        const correctAnswers = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'quiz',
                is_correct: true
            }
        });
        
        // Find correct option for explanation
        const correctOption = question.Options.find(option => option.is_correct);
        
        return res.status(200).json({
            status: 'success',
            message: 'Answer submitted successfully',
            data: {
                correct: isCorrect,
                correctOptionId: correctOption.id,
                explanation: question.explanation,
                progress: {
                    answered: answeredQuestions,
                    correct: correctAnswers,
                    total: totalQuestions,
                    remainingQuestions: totalQuestions - answeredQuestions
                }
            }
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get quiz results
async function getQuizResults(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'quiz'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get practice questions
        const practiceQuestions = await PracticeQuestion.findAll({
            where: {
                session_id: sessionId,
                question_type: 'quiz'
            }
        });
        
        const totalQuestions = practiceQuestions.length;
        const answeredQuestions = practiceQuestions.filter(q => q.user_answer !== null).length;
        const correctAnswers = practiceQuestions.filter(q => q.is_correct === true).length;
        
        // Calculate score percentage
        const scorePercentage = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
        
        // Get time elapsed (if available)
        const timeElapsed = session.end_time ? 
            Math.floor((new Date(session.end_time) - new Date(session.start_time)) / 1000) : 
            null;
        
        // Generate review with question-by-question analysis
        const review = practiceQuestions.map(pq => ({
            questionId: pq.question_id,
            correct: pq.is_correct
        }));
        
        // Update or create practice result
        let result = await PracticeResult.findOne({
            where: { session_id: sessionId }
        });
        
        if (result) {
            await result.update({
                total_words: totalQuestions,
                remembered: correctAnswers,
                need_practice: totalQuestions - correctAnswers,
                success_rate: scorePercentage,
                time_elapsed: timeElapsed
            });
        } else if (answeredQuestions === totalQuestions) {
            // Only create a result if all questions have been answered
            result = await PracticeResult.create({
                session_id: sessionId,
                total_words: totalQuestions,
                remembered: correctAnswers,
                need_practice: totalQuestions - correctAnswers,
                success_rate: scorePercentage,
                time_elapsed: timeElapsed
            });
        }
        
        // If all questions are answered, mark the session as completed
        if (answeredQuestions === totalQuestions && !session.completed) {
            await session.update({
                completed: true,
                end_time: new Date()
            });
        }
        
        // Prepare feedback message based on score
        let feedbackMessage = '';
        if (scorePercentage >= 80) {
            feedbackMessage = 'Great job! You have a strong understanding of these concepts.';
        } else if (scorePercentage >= 60) {
            feedbackMessage = 'Nice effort! You\'re making good progress.';
        } else if (scorePercentage >= 40) {
            feedbackMessage = 'Keep practicing! You\'re on the right track.';
        } else {
            feedbackMessage = 'This is challenging, but keep at it! Practice makes perfect.';
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Quiz results retrieved successfully',
            data: {
                totalQuestions,
                correctAnswers,
                scorePercentage,
                timeElapsed,
                review,
                feedbackMessage,
                completed: answeredQuestions === totalQuestions
            }
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

module.exports = {
    getQuizQuestions,
    submitQuizAnswer,
    getQuizResults
};