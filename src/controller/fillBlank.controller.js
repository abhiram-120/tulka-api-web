const FillBlankQuestion = require('../models/fillBlankQuestion');
const FillBlankOption = require('../models/fillBlankOption');
const PracticeSession = require('../models/practiceSession');
const PracticeResult = require('../models/practiceResult');
const PracticeQuestion = require('../models/practiceQuestion');
const { Op, Sequelize } = require('sequelize');

// Get fill in the blank questions for a practice session
async function getFillBlankQuestions(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'fill_blank'
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
                question_type: 'fill_blank'
            }
        });
        
        let questions = [];
        
        // If we already have questions assigned to this session, use them
        if (sessionQuestions.length > 0) {
            const questionIds = sessionQuestions.map(q => q.question_id);
            
            // Fetch the fill blank questions with their options
            questions = await FillBlankQuestion.findAll({
                where: {
                    id: { [Op.in]: questionIds }
                },
                include: [
                    {
                        model: FillBlankOption,
                        as: 'Options'
                    }
                ],
                order: [['id', 'ASC']]
            });
        } else {
            // Otherwise, select new questions based on the session source
            // For example, if source_type is 'wordFile', we would select questions relevant to that file
            
            // For this example, we'll just get random questions from the database
            questions = await FillBlankQuestion.findAll({
                limit: 5,  // Default to 5 questions per exercise
                include: [
                    {
                        model: FillBlankOption,
                        as: 'Options'
                    }
                ],
                order: Sequelize.literal('RAND()') // Random selection
            });
            
            // Associate these questions with the session
            await Promise.all(questions.map(question => 
                PracticeQuestion.create({
                    session_id: sessionId,
                    question_type: 'fill_blank',
                    question_id: question.id,
                    is_correct: null
                })
            ));
        }
        
        // Transform questions for the response
        const formattedQuestions = questions.map(question => {
            // Create a sentence with a blank space
            const sentenceParts = question.sentence.split('_____');
            
            // Get options for multiple choice
            const options = question.Options.map(option => ({
                id: option.id,
                text: option.option_text
            }));
            
            // Determine if this question has been answered
            const answeredQuestion = sessionQuestions.find(sq => 
                sq.question_id === question.id && sq.user_answer !== null
            );
            
            // Only include correct answer if the question has been answered
            return {
                id: question.id,
                sentence: question.sentence,
                translation: question.translation,
                hint: question.hint,
                example: question.example,
                options,
                // Add correct answer and user's answer if question was already answered
                correctAnswer: answeredQuestion ? question.missing_word : undefined,
                userAnswer: answeredQuestion ? answeredQuestion.user_answer : undefined,
                isCorrect: answeredQuestion ? answeredQuestion.is_correct : undefined
            };
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Fill in the blank questions retrieved successfully',
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

// Submit an answer to a fill in the blank question
async function submitFillBlankAnswer(req, res) {
    try {
        const { sessionId } = req.params;
        const { questionId, answer, answerType } = req.body;
        
        if (!questionId || !answer) {
            return res.status(400).json({
                status: 'error',
                message: 'Question ID and answer are required'
            });
        }
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'fill_blank'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get the question
        const question = await FillBlankQuestion.findByPk(questionId, {
            include: [
                {
                    model: FillBlankOption,
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
        
        // Check if the answer is correct
        let isCorrect = false;
        
        if (answerType === 'option') {
            // If answer is an option ID
            const selectedOption = question.Options.find(option => option.id == answer);
            if (selectedOption) {
                isCorrect = selectedOption.is_correct;
            }
        } else {
            // If it's free text
            isCorrect = answer.trim().toLowerCase() === question.missing_word.trim().toLowerCase();
        }
        
        // Find the practice question record
        let practiceQuestion = await PracticeQuestion.findOne({
            where: {
                session_id: sessionId,
                question_type: 'fill_blank',
                question_id: questionId
            }
        });
        
        // Update practice question record
        if (practiceQuestion) {
            await practiceQuestion.update({
                user_answer: answer,
                is_correct: isCorrect,
                time_taken: req.body.timeTaken || null
            });
        } else {
            // Create practice question record if it doesn't exist
            practiceQuestion = await PracticeQuestion.create({
                session_id: sessionId,
                question_type: 'fill_blank',
                question_id: questionId,
                user_answer: answer,
                is_correct: isCorrect,
                time_taken: req.body.timeTaken || null
            });
        }
        
        // Calculate progress
        const totalQuestions = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'fill_blank'
            }
        });
        
        const answeredQuestions = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'fill_blank',
                user_answer: { [Op.ne]: null }
            }
        });
        
        const correctAnswers = await PracticeQuestion.count({
            where: {
                session_id: sessionId,
                question_type: 'fill_blank',
                is_correct: true
            }
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Answer submitted successfully',
            data: {
                correct: isCorrect,
                correctAnswer: question.missing_word,
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

// Get hint for a fill in the blank question
async function getQuestionHint(req, res) {
    try {
        const { questionId } = req.params;
        
        // Get the question
        const question = await FillBlankQuestion.findByPk(questionId);
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Hint retrieved successfully',
            data: {
                hint: question.hint,
                example: question.example
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

// Get translation for a fill in the blank question
async function getQuestionTranslation(req, res) {
    try {
        const { questionId } = req.params;
        
        // Get the question
        const question = await FillBlankQuestion.findByPk(questionId);
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        if (!question.translation) {
            return res.status(404).json({
                status: 'error',
                message: 'Translation not available for this question'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Translation retrieved successfully',
            data: {
                translation: question.translation
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

// Get fill in the blank results
async function getFillBlankResults(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'fill_blank'
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
                question_type: 'fill_blank'
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
        
        // Generate list of questions that need more practice
        const questionIdsNeedingPractice = practiceQuestions
            .filter(q => q.is_correct === false)
            .map(q => q.question_id);
        
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
        
        return res.status(200).json({
            status: 'success',
            message: 'Fill in the blank results retrieved successfully',
            data: {
                totalQuestions,
                correctAnswers,
                scorePercentage,
                needMorePractice: questionIdsNeedingPractice
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
    getFillBlankQuestions,
    submitFillBlankAnswer,
    getQuestionHint,
    getQuestionTranslation,
    getFillBlankResults
};