const Users = require('../../models/users');
const Class = require('../../models/classes');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const Game = require('../../models/game');
const GameApproval = require('../../models/gameApprovals');
const { Op } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const axios = require('axios');
const http = require('http');
const https = require('https');
const moment = require('moment-timezone');

/**
 * Get all ended classes for a teacher, sorted by end date/time (descending)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getEndedClasses(req, res) {
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
        const DEFAULT_PAGE_SIZE = 10;
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || DEFAULT_PAGE_SIZE);
        const offset = (page - 1) * limit;

        // Search filter
        const searchQuery = req.query.search || '';

        // 2. Build where clause - Only get regular classes (exclude trial classes)
        const whereClause = {
            teacher_id: teacherId,
            status: 'ended',
            is_regular_hide: 0,
            is_trial: 0  // Only regular classes
        };

        // Get student IDs matching search if provided
        if (searchQuery) {
            // Search in regular students only
            const matchingStudents = await Users.findAll({
                attributes: ['id'],
                where: {
                    full_name: {
                        [Op.like]: `%${searchQuery}%`
                    }
                }
            });
            const filteredStudentIds = matchingStudents.map(s => s.id);

            // Apply search filter
            if (filteredStudentIds.length > 0) {
                whereClause.student_id = { [Op.in]: filteredStudentIds };
            } else {
                // No matches found
                return res.status(200).json({
                    status: 'success',
                    message: 'No classes found matching search criteria',
                    data: [],
                    currentPage: page,
                    totalPages: 0,
                    totalClasses: 0,
                    approvedCount: 0,
                    notApprovedCount: 0
                });
            }
        }

        // Get total count and class data in parallel
        const [classData, totalCount] = await Promise.all([
            Class.findAll({
                attributes: [
                    'id', 'student_id', 'is_trial', 'meeting_start', 'meeting_end',
                    'status', 'class_type', 'demo_class_id', 'student_goal', 'is_game_approved'
                ],
                where: whereClause,
                order: [['meeting_end', 'DESC']], // Sort by end date/time descending (most recent first)
                limit: limit,
                offset: offset
            }),
            Class.count({ where: whereClause })
        ]);

        const totalPages = Math.ceil(totalCount / limit);

        // Get total approved and not approved counts (from all pages, not just current page)
        const [approvedCount, notApprovedCount] = await Promise.all([
            Class.count({
                where: {
                    ...whereClause,
                    is_game_approved: 1
                }
            }),
            Class.count({
                where: {
                    ...whereClause,
                    is_game_approved: 0
                }
            })
        ]);

        if (!classData || classData.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'No ended classes found',
                data: [],
                currentPage: page,
                totalPages: totalPages,
                totalClasses: totalCount,
                approvedCount: approvedCount,
                notApprovedCount: notApprovedCount
            });
        }

        // 3. Get all student IDs (only regular students since we're only getting regular classes)
        const studentIds = [...new Set(classData.filter(item => item.student_id).map(item => item.student_id))];

        // 4. Fetch students
        const students = await Users.findAll({
            attributes: ['id', 'full_name', 'avatar'],
            where: { id: studentIds }
        });

        // Create lookup map for faster access
        const studentMap = students.reduce((acc, student) => {
            acc[student.id] = student;
            return acc;
        }, {});

        // 5. Format data for response
        const formattedClasses = classData.map((classItem) => {
            const student = studentMap[classItem.student_id];

            // Determine student details (only regular students)
            let studentName = "Unknown Student";
            let studentId = null;
            let studentAvatar = null;
            let studentInitial = "U";
            
            if (student) {
                studentName = student.full_name;
                studentId = student.id.toString();
                studentAvatar = student.avatar 
                    ? `${process.env.API_BASE_URL || 'http://tlknodeapi.tulkka.com'}/storage/avatar/${student.avatar}`
                    : null;
                // Generate initial from full name
                const names = student.full_name.split(" ");
                if (names.length === 1) {
                    studentInitial = names[0].charAt(0).toUpperCase();
                } else {
                    studentInitial = (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
                }
            }

            // Calculate duration in minutes
            const durationMinutes = moment(classItem.meeting_end).diff(moment(classItem.meeting_start), 'minutes');

            return {
                id: classItem.id.toString(),
                studentId: studentId || '',
                studentName: studentName,
                studentInitial: studentInitial,
                studentAvatar: studentAvatar,
                classType: 'regular', // Always regular since we're filtering out trial classes
                duration: `${durationMinutes} min`,
                topic: classItem.student_goal || '',
                status: classItem.status.toLowerCase(),
                meetingStart: classItem.meeting_start,
                meetingEnd: classItem.meeting_end,
                class_type: classItem.class_type,
                timezone: teacher.timezone || 'UTC', // Get teacher timezone if available
                isGameApproved: classItem.is_game_approved === 1 || classItem.is_game_approved === true
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Ended classes retrieved successfully',
            data: formattedClasses,
            currentPage: page,
            totalPages: totalPages,
            totalClasses: totalCount,
            approvedCount: approvedCount,
            notApprovedCount: notApprovedCount
        });

    } catch (error) {
        console.error('Error fetching ended classes:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching ended classes',
            error: error.message
        });
    }
}

/**
 * Get class details by ID for game approval
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getClassDetailsForApproval(req, res) {
    try {
        const teacherId = req.user.id;
        const classId = req.params.id;

        // Verify teacher has access to this class
        const classItem = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId,
                status: 'ended',
                is_regular_hide: 0
            }
        });

        if (!classItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found or you do not have permission to access it.'
            });
        }

        // Get student ID and name
        let studentId = null;
        let studentName = 'Unknown Student';
        
        if (classItem.student_id) {
            studentId = classItem.student_id.toString();
            const student = await Users.findOne({
                where: { id: classItem.student_id },
                attributes: ['id', 'full_name']
            });
            if (student) {
                studentName = student.full_name;
            }
        } else if (classItem.demo_class_id) {
            // For trial classes, get student name from trial registration
            const trialClass = await TrialClassRegistration.findOne({
                where: { id: classItem.demo_class_id },
                attributes: ['student_name']
            });
            if (trialClass) {
                studentName = trialClass.student_name;
            }
            // Note: Trial classes might not have a user_id in the users table
            // For now, we'll use the demo_class_id or handle it differently
        }

        return res.status(200).json({
            status: 'success',
            message: 'Class details retrieved successfully',
            data: {
                classId: classItem.id.toString(),
                studentId: studentId,
                studentName: studentName
            }
        });

    } catch (error) {
        console.error('Error fetching class details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching class details',
            error: error.message
        });
    }
}

/**
 * Get game approval data from external API
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getGameApprovalData(req, res) {
    try {
        const teacherId = req.user.id;
        const { class_id, user_id } = req.query;

        // Validate required parameters
        if (!class_id || !user_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required parameters: class_id and user_id are required'
            });
        }

        // Verify teacher has access to this class
        const classItem = await Class.findOne({
            where: {
                id: class_id,
                teacher_id: teacherId,
                status: 'ended',
                is_regular_hide: 0
            }
        });

        if (!classItem) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Class not found or you do not have permission to access it.'
            });
        }

        // Fetch pending games for this class & student from the games table
        const games = await Game.findAll({
            where: {
                class_id: class_id,
                student_id: user_id,
                status: 'pending'
            },
            order: [['created_at', 'ASC']]
        });

        // Group exercises by type to match the frontend structure
        const exercises = {
            cloze: [],              // maps to fill_in_blank on the frontend (for fill_blank type)
            flashcards: [],
            spelling: [],
            grammar_challenge: [],
            sentence_builder: [],
            advanced_cloze: []      // separate from fill_blank
        };

        games.forEach((game) => {
            let exerciseData = game.exercise_data;

            if (typeof exerciseData === 'string') {
                try {
                    exerciseData = JSON.parse(exerciseData);
                } catch (e) {
                    console.error('Error parsing exercise_data JSON for game:', game.id, e);
                    exerciseData = null;
                }
            }

            if (!exerciseData || typeof exerciseData !== 'object') {
                return;
            }

            // Attach game_id so we can update the correct record on submit
            const enrichedData = {
                ...exerciseData,
                game_id: game.id
            };

            // Ensure exercise_id exists
            if (!enrichedData.exercise_id) {
                enrichedData.exercise_id = game.id;
            }

            switch (game.exercise_type) {
                case 'fill_blank':
                    exercises.cloze.push(enrichedData);
                    break;
                case 'advanced_cloze':
                    exercises.advanced_cloze.push(enrichedData);
                    break;
                case 'flashcards':
                case 'flashcard':
                    exercises.flashcards.push(enrichedData);
                    break;
                case 'spelling_bee':
                    exercises.spelling.push(enrichedData);
                    break;
                case 'grammar_challenge':
                    exercises.grammar_challenge.push(enrichedData);
                    break;
                case 'sentence_builder':
                    exercises.sentence_builder.push(enrichedData);
                    break;
                default:
                    break;
            }
        });

        const gameData = {
            data: [
                {
                    id: class_id,
                    zoom_summary_id: null,
                    user_id: user_id.toString(),
                    teacher_id: teacherId.toString(),
                    class_id: class_id.toString(),
                    lesson_number: null,
                    exercises,
                    quality_score: null,
                    generated_at: new Date().toISOString(),
                    created_at: new Date().toISOString()
                }
            ]
        };

        return res.status(200).json({
            status: 'success',
            message: 'Game approval data retrieved successfully',
            data: {
                class_id: class_id,
                user_id: user_id,
                gameData
            }
        });

    } catch (error) {
        console.error('Error in getGameApprovalData:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching game approval data',
            error: error.message
        });
    }
}

/**
 * Submit approved game approval data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function submitGameApproval(req, res) {
    try {
        const teacherId = req.user.id;
        const { classId } = req.params;
        const { 
            exerciseData, 
            approvalStatus 
        } = req.body;

        // Validate required fields
        if (!exerciseData) {
            return res.status(400).json({
                status: 'error',
                message: 'Exercise data is required'
            });
        }

        if (!approvalStatus) {
            return res.status(400).json({
                status: 'error',
                message: 'Approval status is required'
            });
        }

        // Verify teacher access to the class
        const classRecord = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId,
                status: 'ended'
            }
        });

        if (!classRecord) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Class not found or you do not have permission to access it.'
            });
        }

        // Get student ID (same logic as getClassDetailsForApproval)
        let studentId = null;
        let studentName = null;

        if (classRecord.is_trial === 1 && classRecord.demo_class_id) {
            // Trial class
            const trialRegistration = await TrialClassRegistration.findOne({
                where: { id: classRecord.demo_class_id }
            });
            if (trialRegistration) {
                studentId = `trial_${trialRegistration.id}`;
                studentName = trialRegistration.student_name;
            }
        } else if (classRecord.student_id) {
            // Regular class
            const student = await Users.findOne({
                where: { id: classRecord.student_id },
                attributes: ['id', 'full_name']
            });
            if (student) {
                studentId = student.id.toString();
                studentName = student.full_name;
            }
        }

        if (!studentId) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found for this class'
            });
        }

        // Process approval status and update Game records
        let approvedCount = 0;
        let rejectedCount = 0;

        // Track which game records to update
        const gamesToApprove = new Set();
        const gamesToReject = new Set();

        // Process fill-in-the-blank exercises
        if (exerciseData.fill_in_blank && Array.isArray(exerciseData.fill_in_blank)) {
            exerciseData.fill_in_blank.forEach((exercise, index) => {
                const exerciseId = exercise.exercise_id || `fill_${index}`;
                const status = approvalStatus.fillInBlank?.[exerciseId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (exercise.game_id) {
                        gamesToApprove.add(exercise.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (exercise.game_id) {
                        gamesToReject.add(exercise.game_id);
                    }
                }
            });
        }

        // Process flashcards
        if (exerciseData.flashcards && Array.isArray(exerciseData.flashcards)) {
            exerciseData.flashcards.forEach((flashcard, index) => {
                const flashcardId = `flashcard_${index}`;
                const status = approvalStatus.flashcards?.[flashcardId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (flashcard.game_id) {
                        gamesToApprove.add(flashcard.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (flashcard.game_id) {
                        gamesToReject.add(flashcard.game_id);
                    }
                }
            });
        }

        // Process spelling exercises
        if (exerciseData.spelling && Array.isArray(exerciseData.spelling)) {
            exerciseData.spelling.forEach((spelling, index) => {
                const spellingId = `spelling_${index}`;
                const status = approvalStatus.spelling?.[spellingId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (spelling.game_id) {
                        gamesToApprove.add(spelling.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (spelling.game_id) {
                        gamesToReject.add(spelling.game_id);
                    }
                }
            });
        }

        // Process grammar challenge exercises
        if (exerciseData.grammar_challenge && Array.isArray(exerciseData.grammar_challenge)) {
            exerciseData.grammar_challenge.forEach((grammar, index) => {
                const grammarId = grammar.exercise_id || `grammar_${index}`;
                const status = approvalStatus.grammarChallenge?.[grammarId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (grammar.game_id) {
                        gamesToApprove.add(grammar.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (grammar.game_id) {
                        gamesToReject.add(grammar.game_id);
                    }
                }
            });
        }

        // Process sentence builder exercises
        if (exerciseData.sentence_builder && Array.isArray(exerciseData.sentence_builder)) {
            exerciseData.sentence_builder.forEach((sentence, index) => {
                const sentenceId = sentence.exercise_id || `sentence_${index}`;
                const status = approvalStatus.sentenceBuilder?.[sentenceId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (sentence.game_id) {
                        gamesToApprove.add(sentence.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (sentence.game_id) {
                        gamesToReject.add(sentence.game_id);
                    }
                }
            });
        }

        // Process advanced cloze exercises
        if (exerciseData.advanced_cloze && Array.isArray(exerciseData.advanced_cloze)) {
            exerciseData.advanced_cloze.forEach((cloze, index) => {
                const clozeId = cloze.exercise_id || `cloze_${index}`;
                const status = approvalStatus.advancedCloze?.[clozeId];
                
                if (status === 'approved') {
                    approvedCount++;
                    if (cloze.game_id) {
                        gamesToApprove.add(cloze.game_id);
                    }
                } else if (status === 'rejected') {
                    rejectedCount++;
                    if (cloze.game_id) {
                        gamesToReject.add(cloze.game_id);
                    }
                }
            });
        }

        // Update game records statuses based on teacher approval
        if (gamesToApprove.size > 0) {
            await Game.update(
                { status: 'approved' },
                {
                    where: {
                        id: { [Op.in]: Array.from(gamesToApprove) }
                    }
                }
            );
        }

        if (gamesToReject.size > 0) {
            await Game.update(
                { status: 'rejected' },
                {
                    where: {
                        id: { [Op.in]: Array.from(gamesToReject) }
                    }
                }
            );
        }

        // Update the class to mark it as approved
        await classRecord.update({
            is_game_approved: 1
        });

        return res.status(200).json({
            status: 'success',
            message: 'Game approval submitted successfully',
            data: {
                id: parseInt(classId),
                class_id: parseInt(classId),
                approved_count: approvedCount,
                rejected_count: rejectedCount,
                created_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error in submitGameApproval:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while submitting game approval',
            error: error.message
        });
    }
}

/**
 * Get approved game approval data for a class
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getApprovedGameApproval(req, res) {
    try {
        const teacherId = req.user.id;
        const { classId } = req.params;

        // Verify teacher access to the class
        const classRecord = await Class.findOne({
            where: {
                id: classId,
                teacher_id: teacherId,
                status: 'ended'
            }
        });

        if (!classRecord) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Class not found or you do not have permission to access it.'
            });
        }

        // Get approved game data for this class from the games table
        const approvedGames = await Game.findAll({
            where: {
                class_id: classId,
                status: 'approved'
            },
            order: [['created_at', 'ASC']]
        });

        if (!approvedGames || approvedGames.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No approved game data found for this class'
            });
        }

        let fillInBlank = [];
        let flashcards = [];
        let spelling = [];
        let grammarChallenge = [];
        let sentenceBuilder = [];
        let advancedCloze = [];

        approvedGames.forEach((game) => {
            let exerciseData = game.exercise_data;

            if (typeof exerciseData === 'string') {
                try {
                    exerciseData = JSON.parse(exerciseData);
                } catch (e) {
                    console.error('Error parsing exercise_data JSON for approved game:', game.id, e);
                    exerciseData = null;
                }
            }

            if (!exerciseData || typeof exerciseData !== 'object') {
                return;
            }

            const enrichedData = {
                ...exerciseData,
                approval_status: 'approved',
                approved_at: game.updated_at || game.created_at
            };

            if (!enrichedData.exercise_id) {
                enrichedData.exercise_id = game.id;
            }

            switch (game.exercise_type) {
                case 'fill_blank':
                    fillInBlank.push(enrichedData);
                    break;
                case 'advanced_cloze':
                    advancedCloze.push(enrichedData);
                    break;
                case 'flashcards':
                case 'flashcard':
                    flashcards.push(enrichedData);
                    break;
                case 'spelling_bee':
                    spelling.push(enrichedData);
                    break;
                case 'grammar_challenge':
                    grammarChallenge.push(enrichedData);
                    break;
                case 'sentence_builder':
                    sentenceBuilder.push(enrichedData);
                    break;
                default:
                    break;
            }
        });

        // Also count rejected items for summary
        const rejectedCount = await Game.count({
            where: {
                class_id: classId,
                status: 'rejected'
            }
        });

        const approvedCount = fillInBlank.length + flashcards.length + spelling.length + 
                            grammarChallenge.length + sentenceBuilder.length + advancedCloze.length;

        console.log('Approved data being sent:', {
            fillInBlankCount: fillInBlank.length,
            flashcardsCount: flashcards.length,
            spellingCount: spelling.length,
            grammarChallengeCount: grammarChallenge.length,
            sentenceBuilderCount: sentenceBuilder.length,
            advancedClozeCount: advancedCloze.length,
            approved_count: approvedCount
        });

        return res.status(200).json({
            status: 'success',
            message: 'Approved game approval data retrieved successfully',
            data: {
                id: parseInt(classId),
                class_id: parseInt(classId),
                teacher_id: teacherId.toString(),
                student_id: classRecord.student_id ? classRecord.student_id.toString() : '',
                zoom_summary_id: null,
                lesson_number: null,
                fill_in_blank: fillInBlank,
                flashcards: flashcards,
                spelling: spelling,
                grammar_challenge: grammarChallenge,
                sentence_builder: sentenceBuilder,
                advanced_cloze: advancedCloze,
                quality_score: null,
                approved_count: approvedCount,
                rejected_count: rejectedCount,
                created_at: approvedGames[0].created_at,
                updated_at: approvedGames[approvedGames.length - 1].updated_at || approvedGames[approvedGames.length - 1].created_at
            }
        });

    } catch (error) {
        console.error('Error in getApprovedGameApproval:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching approved game approval data',
            error: error.message
        });
    }
}

module.exports = {
    getEndedClasses,
    getClassDetailsForApproval,
    getGameApprovalData,
    submitGameApproval,
    getApprovedGameApproval
};

