const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const fs = require('fs');
const path = require('path');
const AssessmentQuestion = require('../../models/assessmentQuestion');
const AssessmentSession = require('../../models/assessmentSession');

const normalizeValue = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim().toLowerCase();
    return value;
};

const coerceJsonValue = (value) => {
    let current = value;
    for (let i = 0; i < 3; i += 1) {
        if (typeof current !== 'string') return current;
        const trimmed = current.trim();
        if (!trimmed) return current;
        try {
            const parsed = JSON.parse(trimmed);
            // Stop if parsing doesn't change the value
            if (parsed === current) return parsed;
            current = parsed;
        } catch (e) {
            return current;
        }
    }
    return current;
};

const isAnswerCorrect = (answer, correctAnswer) => {
    if (correctAnswer === null || correctAnswer === undefined) return false;

    const normalizedCorrect = coerceJsonValue(correctAnswer);
    const normalizedAnswer = coerceJsonValue(answer);

    if (Array.isArray(normalizedCorrect)) {
        if (Array.isArray(normalizedAnswer)) {
            const normalizedAnswerList = normalizedAnswer.map(normalizeValue).sort();
            const normalizedCorrectList = normalizedCorrect.map(normalizeValue).sort();
            return JSON.stringify(normalizedAnswer) === JSON.stringify(normalizedCorrect);
        }
        return normalizedCorrect.map(normalizeValue).includes(normalizeValue(normalizedAnswer));
    }

    if (Array.isArray(normalizedAnswer)) {
        return normalizedAnswer.map(normalizeValue).includes(normalizeValue(normalizedCorrect));
    }

    return normalizeValue(normalizedAnswer) === normalizeValue(normalizedCorrect);
};

const parseLimit = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), 100);
};

const ASSESSMENT_MEDIA_BASE_URL = 'https://tulkka-backend.s3.eu-central-1.amazonaws.com/assessments';

const buildMediaUrl = (value, folder) => {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const normalized = trimmed.replace(/^\/+/, '');
    if (normalized.startsWith('images/') || normalized.startsWith('audio/')) {
        return `${ASSESSMENT_MEDIA_BASE_URL}/${normalized}`;
    }
    return `${ASSESSMENT_MEDIA_BASE_URL}/${folder}/${normalized}`;
};

// POST: import assessment questions from JSON file using model
const importAssessmentQuestions = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const defaultPath = path.join(process.cwd(), 'public', 'assessment_questions.json');
        const filePath = req.body?.file_path || defaultPath;

        if (!fs.existsSync(filePath)) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'FILE_NOT_FOUND',
                message: `SQL file not found at ${filePath}`
            });
        }

        const jsonText = fs.readFileSync(filePath, 'utf8');
        let questions;
        try {
            questions = JSON.parse(jsonText);
        } catch (parseError) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_JSON',
                message: 'Failed to parse JSON file'
            });
        }

        if (!Array.isArray(questions) || questions.length === 0) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'NO_DATA',
                message: 'JSON file does not contain an array of questions'
            });
        }

        await AssessmentQuestion.bulkCreate(questions, {
            ignoreDuplicates: true,
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: 'Assessment questions imported successfully',
            source_file: filePath
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error importing assessment questions:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while importing assessment questions'
        });
    }
};

// POST: start assessment and return questions
const startAssessment = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const userId = req.userId;
        const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const limit = parseLimit(req.body?.limit, 12);
        const perLevel = Math.max(1, Math.floor(limit / levels.length));

        const questions = [];
        const usedIds = new Set();

        for (const level of levels) {
            // Try to get 1 media + 1 non-media per level (if possible)
            const media = await AssessmentQuestion.findAll({
                where: {
                    difficulty_level: level,
                    id: { [Op.notIn]: Array.from(usedIds) },
                    disabled: { [Op.ne]: true },
                    [Op.or]: [
                        { image_url: { [Op.ne]: null } },
                        { audio_url: { [Op.ne]: null } }
                    ]
                },
                limit: 1,
                order: Sequelize.literal('RAND()'),
                transaction
            });

            media.forEach(q => {
                usedIds.add(q.id);
                questions.push(q);
            });

            const nonMediaNeeded = Math.max(perLevel - media.length, 0);
            if (nonMediaNeeded > 0) {
                const nonMedia = await AssessmentQuestion.findAll({
                    where: {
                        difficulty_level: level,
                        id: { [Op.notIn]: Array.from(usedIds) },
                        disabled: { [Op.ne]: true },
                        [Op.and]: [
                            { image_url: { [Op.is]: null } },
                            { audio_url: { [Op.is]: null } }
                        ]
                    },
                    limit: nonMediaNeeded,
                    order: Sequelize.literal('RAND()'),
                    transaction
                });

                nonMedia.forEach(q => {
                    usedIds.add(q.id);
                    questions.push(q);
                });
            }
        }

        // If we still need more questions (e.g., insufficient per level), fill randomly
        if (questions.length < limit) {
            const remaining = limit - questions.length;
            const filler = await AssessmentQuestion.findAll({
                where: {
                    id: { [Op.notIn]: Array.from(usedIds) },
                    disabled: { [Op.ne]: true }
                },
                limit: remaining,
                order: Sequelize.literal('RAND()'),
                transaction
            });
            filler.forEach(q => {
                usedIds.add(q.id);
                questions.push(q);
            });
        }

        if (!questions.length) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'NO_QUESTIONS_FOUND',
                message: 'No assessment questions found'
            });
        }

        const questionIds = questions.map(q => q.id);

        const session = await AssessmentSession.create({
            user_id: userId,
            status: 'started',
            question_ids: questionIds,
            total_questions: questions.length,
            started_at: new Date(),
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            success: true,
            session_id: session.id,
            total_questions: questions.length,
            questions: questions.map(q => ({
                id: q.id,
                question: q.question,
                question_type: q.question_type,
                difficulty_level: q.difficulty_level,
                skill_focus: q.skill_focus,
                options: q.options,
                correct_answer: q.correct_answer,
                image_url: buildMediaUrl(q.image_url, 'images'),
                audio_url: buildMediaUrl(q.audio_url, 'audio'),
                explanation: q.explanation
            }))
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error starting assessment:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while starting the assessment'
        });
    }
};

// POST: submit assessment answers
const submitAssessment = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { session_id, answers } = req.body;
        const userId = req.userId;

        if (!session_id || !Array.isArray(answers)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: 'session_id and answers array are required'
            });
        }

        const session = await AssessmentSession.findOne({
            where: {
                id: session_id,
                user_id: userId,
                status: 'started'
            },
            transaction
        });

        if (!session) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'SESSION_NOT_FOUND',
                message: 'Assessment session not found or already submitted'
            });
        }

        let sessionQuestionIds = [];
        if (Array.isArray(session.question_ids)) {
            sessionQuestionIds = session.question_ids;
        } else if (typeof session.question_ids === 'string') {
            try {
                const parsed = JSON.parse(session.question_ids);
                if (Array.isArray(parsed)) sessionQuestionIds = parsed;
            } catch (e) {
                sessionQuestionIds = [];
            }
        }

        const normalizedSessionIds = sessionQuestionIds.map(id => Number(id)).filter(id => Number.isFinite(id));
        const answerQuestionIds = answers
            .map(a => Number(a.question_id))
            .filter(id => Number.isFinite(id));
        const validQuestionIds = answerQuestionIds.filter(id => normalizedSessionIds.includes(id));

        if (!validQuestionIds.length) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_QUESTIONS',
                message: 'No valid question_id found for this session'
            });
        }

        const questions = await AssessmentQuestion.findAll({
            where: { id: { [Op.in]: validQuestionIds } },
            transaction
        });

        const questionMap = new Map(questions.map(q => [q.id, q]));
        const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const levelStats = levels.reduce((acc, level) => {
            acc[level] = { total: 0, correct: 0 };
            return acc;
        }, {});

        let correctCount = 0;
        const gradedAnswers = answers.map(a => {
            const question = questionMap.get(a.question_id);
            const isCorrect = question ? isAnswerCorrect(a.answer, question.correct_answer) : false;
            if (isCorrect) correctCount += 1;
            if (question?.difficulty_level && levelStats[question.difficulty_level]) {
                levelStats[question.difficulty_level].total += 1;
                if (isCorrect) levelStats[question.difficulty_level].correct += 1;
            }
            return {
                question_id: a.question_id,
                answer: a.answer,
                is_correct: isCorrect
            };
        });

        const totalQuestions = session.total_questions || sessionQuestionIds.length || questions.length;
        const scorePercent = totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 100).toFixed(2)) : 0;

        await AssessmentSession.update({
            status: 'submitted',
            answers: gradedAnswers,
            correct_count: correctCount,
            score_percent: scorePercent,
            submitted_at: new Date(),
            updated_at: new Date()
        }, {
            where: { id: session_id },
            transaction
        });

        await transaction.commit();

        const levelAccuracy = levels.map(level => {
            const stats = levelStats[level];
            const accuracy = stats.total > 0
                ? Number(((stats.correct / stats.total) * 100).toFixed(2))
                : null;
            return { level, total: stats.total, correct: stats.correct, accuracy };
        });

        // Determine level by per-level accuracy (independent of lower levels)
        // Rule: highest level with >= 50% correct at that level
        const minAccuracy = 50;
        let assessedLevel = 'A1';
        for (const level of levels) {
            const stats = levelStats[level];
            if (stats.total === 0) continue;
            const accuracy = (stats.correct / stats.total) * 100;
            if (accuracy >= minAccuracy) {
                assessedLevel = level;
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Assessment submitted successfully',
            result: {
                session_id: session_id,
                total_questions: totalQuestions,
                correct_count: correctCount,
                score_percent: scorePercent,
                user_level: assessedLevel,
                level_breakdown: levelAccuracy
            }
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error submitting assessment:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while submitting the assessment'
        });
    }
};

module.exports = {
    importAssessmentQuestions,
    startAssessment,
    submitAssessment
};
