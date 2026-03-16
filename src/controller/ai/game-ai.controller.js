// connection
const { sequelize } = require('../../connection/connection');

// models
// const GameOption = require('../../models/game-option');
// const GameOptionItem = require('../../models/gameOptionItem');
const Game = require('../../models/game');
const GameSession = require('../../models/game-session');
const StudentProgress = require('../../models/student_progress');
const PointsLedger = require('../../models/points_ledger');

/**
 * API 1: Get Game Options
 * Returns available practice options for a game type
 */
// const getGameOptions = async (req, res) => {
//     try {
//         const { game_type } = req.params;
//         const userId = req.userId;

//         const validGameTypes = ['flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder','fill_blank'];
//         if (!validGameTypes.includes(game_type)) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'INVALID_GAME_TYPE',
//                 message: `Game type must be one of: ${validGameTypes.join(', ')}`
//             });
//         }

//         const options = await GameOption.findAll({
//             where: {
//                 game_type: game_type,
//                 is_active: true
//             },
//             attributes: ['id', 'game_type', 'option_key', 'option_label', 'option_description', 'icon_url', 'sort_order'],
//             order: [['sort_order', 'ASC']]
//         });

//         return res.status(200).json({
//             success: true,
//             game_type: game_type,
//             user_id: userId,
//             count: options.length,
//             options: options
//         });

//     } catch (error) {
//         console.error('Error fetching game options:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching game options',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/**
 * API 2: Get Option Items
 * Returns items for a specific option (topics, lessons, word lists)
 * Updated to include item_id in response
 */
// const getOptionItems = async (req, res) => {
//     try {
//         const { option_key , game_type } = req.params;
//         const userId = req.userId;

//         // Find active game option by key
//         const gameOption = await GameOption.findOne({
//             where: {
//                 option_key: option_key,
//                 game_type: game_type,
//                 is_active: true
//             },
//             attributes: ['id', 'game_type', 'option_key', 'option_label', 'option_description']
//         });

//         if (!gameOption) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'OPTION_NOT_FOUND',
//                 message: `Game option with key '${option_key}' not found or inactive`
//             });
//         }

//         // Fetch all items for this option
//         const optionItems = await GameOptionItem.findAll({
//             where: {
//                 game_option_id: gameOption.id
//             },
//             attributes: ['id', 'option_item'],
//             order: [['id', 'ASC']]
//         });

//         // Include item_id with option_item JSON
//         const items = optionItems.map(item => {
//             const itemData = typeof item.option_item === 'string' 
//                 ? JSON.parse(item.option_item) 
//                 : item.option_item;
            
//             return {
//                 item_id: item.id,
//                 ...itemData
//             };
//         });

//         return res.status(200).json({
//             success: true,
//             option_key: gameOption.option_key,
//             option_label: gameOption.option_label,
//             game_type: gameOption.game_type,
//             total_items: items.length,
//             items: items
//         });

//     } catch (error) {
//         console.error('Error fetching option items:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching option items',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/**
 * API 3: Start Game Session and Get Exercises
 * Creates session and returns 8 exercises based on selected item
 * Updated to accept item_id parameter
 */
// const getGamesByOption = async (req, res) => {
//     const transaction = await sequelize.transaction();

//     try {
//         const { game_type, option_key, item_id } = req.params;
//         const userId = req.userId;

//         const validGameTypes = ['flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder'];
//         if (!validGameTypes.includes(game_type)) {
//             await transaction.rollback();
//             return res.status(400).json({
//                 success: false,
//                 error: 'INVALID_GAME_TYPE',
//                 message: `Game type must be one of: ${validGameTypes.join(', ')}`
//             });
//         }

//         // Base filter (always)
//         let whereConditions = {
//             exercise_type: game_type,
//             status: 'approved'
//         };

//         // Student based modes
//         if (['by_lesson', 'custom_words', 'mistakes_only'].includes(option_key)) {
//             whereConditions.student_id = userId;
//         }

//         // Item logic
//         if (item_id) {
//             whereConditions.game_option_item_id = item_id;
//         } else {
//             whereConditions.game_option_item_id = null; // only default records
//         }

//         // Fetch exercises (MAX 8, ASC)
//         const exercises = await Game.findAll({
//             where: whereConditions,
//             attributes: [
//                 'id',
//                 'exercise_data',
//                 'class_id',
//                 'exercise_type',
//                 'difficulty',
//                 'hint',
//                 'explanation',
//                 'created_at'
//             ],
//             order: [['id', 'ASC']],
//             limit: 8,
//             transaction
//         });

//         if (!exercises.length) {
//             await transaction.rollback();
//             return res.status(404).json({
//                 success: false,
//                 error: 'NO_EXERCISES_FOUND',
//                 message: 'No exercises found for this selection'
//             });
//         }

//         const firstExercise = exercises[0];

//         // Create session
//         const gameSession = await GameSession.create({
//             user_id: userId,
//             game_type,
//             mode: option_key,
//             selected_item_id: item_id || null,
//             class_id: firstExercise.class_id,
//             topic_id: firstExercise.topic_id,
//             difficulty: firstExercise.difficulty,
//             progress_current: 0,
//             progress_total: exercises.length,
//             correct_count: 0,
//             incorrect_count: 0,
//             status: 'active',
//             started_at: new Date(),
//             created_at: new Date()
//         }, { transaction });

//         // Format exercises
//         const formattedExercises = exercises.map(ex => ({
//             id: ex.id,
//             exercise_data: typeof ex.exercise_data === 'string'
//                 ? JSON.parse(ex.exercise_data)
//                 : ex.exercise_data
//         }));

//         await transaction.commit();

//         return res.status(200).json({
//             success: true,
//             session_id: gameSession.id,
//             game_type,
//             mode: option_key,
//             selected_item_id: item_id || null,
//             exercises_count: formattedExercises.length,
//             exercises: formattedExercises
//         });

//     } catch (error) {
//         await transaction.rollback();
//         console.error('Error fetching games:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching games',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/* API 4 */
const startGameByClass = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { exercise_type, class_id } = req.params;
        const userId = req.userId;

        const validGameTypes = ['flashcard', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder' ,'fill_blank'];
        if (!validGameTypes.includes(exercise_type)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_GAME_TYPE',
                message: `Game type must be one of: ${validGameTypes.join(', ')}`
            });
        }

        // Base filter (main query)
        let whereConditions = {
            exercise_type: exercise_type,
            class_id: class_id,
            status: 'approved',
            student_id: userId
        };

        // Fetch exercises (MAX 8, ASC)
        const exercises = await Game.findAll({
            where: whereConditions,
            attributes: [
                'id',
                'exercise_data',
                'class_id',
                'exercise_type',
                'difficulty',
                'hint',
                'explanation',
                'created_at'
            ],
            order: [['id', 'ASC']],
            limit: 8,
            transaction
        });

        // NO DATA HANDLING (OLD USER / NO GAMES CASES)
        if (!exercises.length) {
            await transaction.rollback();

            //  Student never onboarded into games
            const anyStudentGame = await Game.findOne({
                where: { student_id: userId },
                attributes: ['id']
            });

            if (!anyStudentGame) {
                return res.status(404).json({
                    success: false,
                    error: 'STUDENT_NOT_ONBOARDED',
                    message: 'Practice games are not available for your account yet.'
                });
            }

            //  Student has games, but not for this class/type
            const anyClassGame = await Game.findOne({
                where: {
                    student_id: userId,
                    class_id: class_id,
                    exercise_type: exercise_type
                },
                attributes: ['id']
            });

            if (!anyClassGame) {
                return res.status(404).json({
                    success: false,
                    error: 'NO_GAMES_FOR_CLASS',
                    message: 'No practice exercises are available for this class.'
                });
            }

            // Games exist but none approved
            return res.status(404).json({
                success: false,
                error: 'NO_APPROVED_EXERCISES',
                message: 'Your practice content is not ready yet.'
            });
        }

        const firstExercise = exercises[0];

        // Create session
        const gameSession = await GameSession.create({
            user_id: userId,
            game_type: exercise_type,
            mode: 'by_class',
            selected_item_id: null,
            class_id: class_id,
            topic_id: firstExercise.topic_id,
            difficulty: firstExercise.difficulty,
            progress_current: 0,
            progress_total: exercises.length,
            correct_count: 0,
            incorrect_count: 0,
            status: 'active',
            started_at: new Date(),
            created_at: new Date()
        }, { transaction });

        // Format response
        const formattedExercises = exercises.map(ex => ({
            id: ex.id,
            exercise_data: typeof ex.exercise_data === 'string'
                ? JSON.parse(exercises.exercise_data)
                : ex.exercise_data
        }));

        await transaction.commit();

        return res.status(200).json({
            success: true,
            session_id: gameSession.id,
            game_type: exercise_type,
            mode: 'by_class',
            class_id: class_id,
            exercises_count: formattedExercises.length,
            exercises: formattedExercises
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error starting game by class:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while starting the game',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * API 5: Submit Game Session Results
 * Processes answers and updates student progress
 */
const submitGameSession = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { session_id, answers } = req.body;
        const userId = req.userId;

        if (!session_id || !answers || !Array.isArray(answers)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: 'session_id and answers array are required'
            });
        }

        const correctCount = answers.filter(a => a.is_correct === true).length;
        const incorrectCount = answers.filter(a => a.is_correct === false).length;
        const totalAnswered = correctCount + incorrectCount;
        const accuracy = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;

        const [affectedRows] = await GameSession.update(
            {
                progress_current: totalAnswered,
                correct_count: correctCount,
                incorrect_count: incorrectCount,
                status: 'completed',
                completed_at: new Date(),
                updated_at: new Date()
            },
            {
                where: {
                    id: session_id,
                    user_id: userId,
                    status: 'active'
                },
                transaction
            }
        );

        if (affectedRows === 0) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'SESSION_NOT_FOUND',
                message: 'Session not found or already completed'
            });
        }

        const session = await GameSession.findOne({
            where: { id: session_id },
            attributes: ['id', 'user_id', 'game_type', 'mode', 'progress_total', 'correct_count', 'incorrect_count'],
            transaction
        });

        const basePoints = correctCount * 10;
        const accuracyBonus = accuracy >= 80 ? 20 : 0;
        const perfectBonus = accuracy === 100 ? 50 : 0;
        const totalPoints = basePoints + accuracyBonus + perfectBonus;

        await PointsLedger.create({
            student_id: userId,
            points: totalPoints,
            source_type: 'game',
            source_id: session_id,
            description: `Completed ${session.game_type} game (${session.mode}): ${correctCount}/${totalAnswered} correct (${accuracy.toFixed(1)}%)`
        }, { transaction });

        let studentProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            transaction
        });

        if (!studentProgress) {
            await StudentProgress.create({
                student_id: userId,
                current_level: 'A1',
                total_points: totalPoints,
                total_classes: 0,
                vocabulary_mastered: correctCount,
                grammar_concepts_learned: 0,
                games_played: 1,
                last_updated: new Date()
            }, { transaction });
        } else {
            await StudentProgress.update(
                {
                    total_points: sequelize.literal(`total_points + ${totalPoints}`),
                    games_played: sequelize.literal('games_played + 1'),
                    vocabulary_mastered: sequelize.literal(`vocabulary_mastered + ${correctCount}`),
                    last_updated: new Date()
                },
                {
                    where: { student_id: userId },
                    transaction
                }
            );
        }

        const achievements = [];
        
        const updatedProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            transaction
        });

        if (updatedProgress.games_played === 1) {
            achievements.push({
                type: 'first_game',
                title: 'First Steps',
                description: 'Completed your first game!',
                bonus_points: 50
            });
            
            await PointsLedger.create({
                student_id: userId,
                points: 50,
                source_type: 'achievement',
                source_id: 'first_game',
                description: 'Achievement unlocked: First Steps'
            }, { transaction });
            
            await StudentProgress.update(
                { total_points: sequelize.literal('total_points + 50') },
                { where: { student_id: userId }, transaction }
            );
        }

        if (updatedProgress.games_played === 10) {
            achievements.push({
                type: 'ten_games',
                title: 'Game Master',
                description: 'Played 10 games!',
                bonus_points: 100
            });
            
            await PointsLedger.create({
                student_id: userId,
                points: 100,
                source_type: 'achievement',
                source_id: 'ten_games',
                description: 'Achievement unlocked: Game Master'
            }, { transaction });
            
            await StudentProgress.update(
                { total_points: sequelize.literal('total_points + 100') },
                { where: { student_id: userId }, transaction }
            );
        }

        if (accuracy === 100) {
            achievements.push({
                type: 'perfect_score',
                title: 'Perfect!',
                description: 'Got 100% on a game!',
                bonus_points: perfectBonus
            });
        }

        await transaction.commit();

        const finalProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            attributes: ['total_points', 'games_played', 'vocabulary_mastered', 'current_level']
        });

        return res.status(200).json({
            success: true,
            message: 'Game session completed successfully',
            session: {
                id: session_id,
                user_id: userId,
                game_type: session.game_type,
                mode: session.mode,
                correct_count: correctCount,
                incorrect_count: incorrectCount,
                total_questions: totalAnswered,
                accuracy: accuracy.toFixed(1),
                status: 'completed'
            },
            points: {
                earned: totalPoints,
                breakdown: {
                    base_points: basePoints,
                    accuracy_bonus: accuracyBonus,
                    perfect_bonus: perfectBonus
                }
            },
            achievements: achievements.length > 0 ? achievements : undefined,
            progress: {
                total_points: finalProgress.total_points,
                games_played: finalProgress.games_played,
                vocabulary_mastered: finalProgress.vocabulary_mastered,
                current_level: finalProgress.current_level
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error submitting game session:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while submitting game session',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    // getGameOptions,
    // getOptionItems,
    // getGamesByOption,
    startGameByClass,
    submitGameSession
};