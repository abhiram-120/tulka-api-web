const PracticeSession = require('../models/practiceSession');
const PracticeResult = require('../models/practiceResult');
const WordPracticed = require('../models/wordPracticed');
const TranslationWord = require('../models/translationWord');
const TranslationFile = require('../models/translationFile');
const MemoryGameProgress = require('../models/memoryGameProgress');
const Class = require('../models/classes');
const User = require('../models/users');
const PracticeMode = require('../models/practiceMode');
const { Op, Sequelize } = require('sequelize');

// Get lessons by date with filtering options
async function getLessonsByDate(req, res) {
    try {
        const { status, successRate, teacher } = req.query;
        
        let whereClause = { 
            student_id: req.userId,
            status: 'ended'
        };
        
        // Add teacher filter if provided
        if (teacher && teacher !== 'all') {
            whereClause.teacher_id = teacher;
        }
        
        const lessons = await Class.findAll({
            where: whereClause,
            attributes: [
                'id', 
                'student_id', 
                'teacher_id', 
                'meeting_start', 
                'meeting_end', 
                'created_at',
                'updated_at'
            ],
            order: [['meeting_start', 'DESC']],
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                }
            ]
        });
        
        // Get word counts and practice stats for each lesson
        const lessonData = await Promise.all(lessons.map(async (lesson) => {
            const lessonData = lesson.toJSON();
            
            // Count words associated with this lesson
            const wordCount = await TranslationWord.count({
                where: { 
                    file_id: lesson.id  // Assuming you're using file_id to track lesson association
                }
            });
            
            // Calculate practice metrics
            const practiceSessions = await PracticeSession.findAll({
                where: {
                    source_type: 'lesson',
                    source_id: lesson.id,
                    user_id: req.userId
                },
                order: [['created_at', 'DESC']]
            });
            
            let masteredPercentage = 0;
            let practiceCount = practiceSessions.length;
            let lastPractice = null;
            
            if (practiceCount > 0) {
                const latestSession = practiceSessions[0];
                lastPractice = latestSession.start_time;
                
                // Manually query the practice result
                const practiceResult = await PracticeResult.findOne({
                    where: { session_id: latestSession.id }
                });
                
                if (practiceResult) {
                    masteredPercentage = practiceResult.success_rate;
                }
            }
            
            // Determine completion status
            let completionStatus = 'not-started';
            if (practiceCount > 0) {
                completionStatus = masteredPercentage === 100 ? 'completed' : 'in-progress';
            }
            
            return {
                id: lesson.id,
                title: lesson.student_goal || `Lesson on ${new Date(lesson.meeting_start).toLocaleDateString()}`,
                teacher: {
                    id: lesson.Teacher.id,
                    name: lesson.Teacher.full_name,
                    about: lesson.Teacher.about,
                    language: lesson.Teacher.language,
                    avatar: lesson.Teacher.avatar,
                    video_demo: lesson.Teacher.video_demo,
                    video_demo_thumb: lesson.Teacher.video_demo_thumb,
                    enable_zoom_link: lesson.Teacher.enable_zoom_link,
                    add_zoom_link: lesson.Teacher.add_zoom_link,
                    add_zoom_link_meeting_id: lesson.Teacher.add_zoom_link_meeting_id,
                    add_zoom_link_access_code: lesson.Teacher.add_zoom_link_access_code
                },
                date: lesson.meeting_start ? new Date(lesson.meeting_start).toISOString().split('T')[0] : null,
                words: wordCount,
                practicedTimes: practiceCount,
                completionStatus: completionStatus,
                masteredPercentage: Math.round(masteredPercentage),
                last_practice: lastPractice
            };
        }));
        
        // Apply status filter
        let filteredLessons = lessonData;
        if (status) {
            switch(status) {
                case 'unpracticed':
                    filteredLessons = lessonData.filter(lesson => lesson.practicedTimes === 0);
                    break;
                case 'incomplete':
                    filteredLessons = lessonData.filter(lesson => 
                        lesson.practicedTimes > 0 && lesson.completionStatus !== 'completed'
                    );
                    break;
            }
        }
        
        // Apply success rate filter
        if (successRate) {
            switch(successRate) {
                case 'high':
                    filteredLessons = filteredLessons.filter(lesson => lesson.masteredPercentage >= 80);
                    break;
                case 'medium':
                    filteredLessons = filteredLessons.filter(lesson => 
                        lesson.masteredPercentage >= 50 && lesson.masteredPercentage < 80
                    );
                    break;
                case 'low':
                    filteredLessons = filteredLessons.filter(lesson => 
                        lesson.masteredPercentage < 50 && lesson.practicedTimes > 0
                    );
                    break;
                case 'notPracticed':
                    filteredLessons = filteredLessons.filter(lesson => lesson.practicedTimes === 0);
                    break;
            }
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Lessons retrieved successfully',
            data: { lessons: filteredLessons }
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get lesson details including words
async function getLessonDetails(req, res) {
    try {
        const { lessonId } = req.params;
        
        const lesson = await Class.findOne({
            where: { 
                id: lessonId,
                student_id: req.userId,
                status: "ended"
            },
            attributes: [
                'id', 
                'student_id', 
                'teacher_id', 
                'meeting_start', 
                'meeting_end', 
                'student_goal',
                'created_at',
                'updated_at'
            ],
            include: [
                {
                    model: User,
                    as: 'Teacher',
                    attributes: ['id', 'full_name', 'about', 'language', 'avatar', 'video_demo', 'video_demo_thumb', 'enable_zoom_link', 'add_zoom_link', 'add_zoom_link_meeting_id', 'add_zoom_link_access_code']
                }
            ]
        });
        
        if (!lesson) {
            return res.status(404).json({
                status: 'error',
                message: 'Lesson not found or not authorized'
            });
        }
        
        // Count words associated with this lesson
        const wordCount = await TranslationWord.count({
            where: { 
                file_id: lessonId  // Using file_id as in getLessonsByDate
            }
        });
        
        // Get all words associated with this lesson
        const words = await TranslationWord.findAll({
            where: { 
                file_id: lessonId
            }
        });
        
        // Calculate practice metrics
        const practiceSessions = await PracticeSession.findAll({
            where: {
                source_type: 'lesson',
                source_id: lessonId,
                user_id: req.userId
            },
            order: [['created_at', 'DESC']]
        });
        
        let masteredPercentage = 0;
        let practiceCount = practiceSessions.length;
        let lastPractice = null;
        
        if (practiceCount > 0) {
            const latestSession = practiceSessions[0];
            lastPractice = latestSession.start_time;
            
            // Manually query the practice result
            const practiceResult = await PracticeResult.findOne({
                where: { session_id: latestSession.id }
            });
            
            if (practiceResult) {
                masteredPercentage = practiceResult.success_rate;
            }
        }
        
        // Determine completion status
        let completionStatus = 'not-started';
        if (practiceCount > 0) {
            completionStatus = masteredPercentage === 100 ? 'completed' : 'in-progress';
        }
        
        const lessonData = {
            id: lesson.id,
            title: lesson.student_goal || `Lesson on ${new Date(lesson.meeting_start).toLocaleDateString()}`,
            teacher: {
                id: lesson.Teacher.id,
                name: lesson.Teacher.full_name,
                about: lesson.Teacher.about,
                language: lesson.Teacher.language,
                avatar: lesson.Teacher.avatar,
                video_demo: lesson.Teacher.video_demo,
                video_demo_thumb: lesson.Teacher.video_demo_thumb,
                enable_zoom_link: lesson.Teacher.enable_zoom_link,
                add_zoom_link: lesson.Teacher.add_zoom_link,
                add_zoom_link_meeting_id: lesson.Teacher.add_zoom_link_meeting_id,
                add_zoom_link_access_code: lesson.Teacher.add_zoom_link_access_code
            },
            date: lesson.meeting_start ? new Date(lesson.meeting_start).toISOString().split('T')[0] : null,
            meeting_start: lesson.meeting_start,
            meeting_end: lesson.meeting_end,
            words: words.map(word => ({
                id: word.id,
                word: word.original,
                translation: word.translation,
                remembered: word.remembered,
                favorite: word.is_favorite
            })),
            wordCount: wordCount,
            practicedTimes: practiceCount,
            completionStatus: completionStatus,
            masteredPercentage: Math.round(masteredPercentage),
            last_practice: lastPractice
        };
        
        return res.status(200).json({
            status: 'success',
            message: 'Lesson details retrieved successfully',
            data: lessonData
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Create new practice session
async function createPracticeSession(req, res) {
    try {
        const { sourceType, sourceId, practiceMode, wordIds } = req.body;
        
        if (!sourceType || !sourceId || !practiceMode || !wordIds || !Array.isArray(wordIds)) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }
        
        // Create new practice session
        const session = await PracticeSession.create({
            user_id: req.userId,
            practice_mode: practiceMode,
            source_type: sourceType,
            source_id: sourceId,
            start_time: new Date(),
            completed: false,
            hints_count:3
        });
        
        // Get words for practice
        const words = await TranslationWord.findAll({
            where: {
                id: { [Op.in]: wordIds },
                user_id: req.userId
            }
        });
        
        // Create words practiced entries
        await Promise.all(words.map(word => 
            WordPracticed.create({
                session_id: session.id,
                word_id: word.id,
                remembered: false
            })
        ));
        
        // Format response
        const wordsData = words.map(word => ({
            id: word.id,
            word: word.original,
            translation: word.translation
        }));
        
        return res.status(201).json({
            status: 'success',
            message: 'Practice session created successfully',
            data: {
                practiceSessionId: session.id,
                totalWords: wordIds.length,
                words: wordsData
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

// Record practice response for a word
async function recordWordResponse(req, res) {
    try {
        const { sessionId } = req.params;
        const { wordId, remembered } = req.body;
        
        if (typeof remembered !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'remembered field must be a boolean'
            });
        }
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Update word practiced record
        const wordPracticed = await WordPracticed.findOne({
            where: {
                session_id: sessionId,
                word_id: wordId
            }
        });
        
        if (!wordPracticed) {
            return res.status(404).json({
                status: 'error',
                message: 'Word not found in this practice session'
            });
        }
        
        await wordPracticed.update({
            remembered
        });
        
        // Update the translation word's remembered status and success rate
        const word = await TranslationWord.findByPk(wordId);
        
        if (word) {
            // Calculate new success rate based on history
            const practicedRecords = await WordPracticed.findAll({
                where: { word_id: wordId }
            });
            
            const totalPractices = practicedRecords.length;
            const rememberedCount = practicedRecords.filter(record => record.remembered).length;
            const successRate = totalPractices > 0 ? (rememberedCount / totalPractices) * 100 : 0;
            
            await word.update({
                remembered,
                success_rate: successRate,
                last_practiced: new Date()
            });
        }
        
        // Calculate progress
        const allWords = await WordPracticed.findAll({
            where: { session_id: sessionId }
        });
        
        const totalWords = allWords.length;
        const answeredWords = allWords.filter(w => w.remembered !== null).length;
        const rememberedWords = allWords.filter(w => w.remembered === true).length;
        
        // Find next word that hasn't been answered yet
        const remainingWords = allWords.filter(w => w.remembered === null);
        const nextWordIndex = answeredWords < totalWords ? answeredWords : null;
        
        return res.status(200).json({
            status: 'success',
            message: 'Response recorded successfully',
            data: {
                nextWordIndex,
                progress: {
                    remembered: rememberedWords,
                    totalWords,
                    remainingWords: totalWords - answeredWords
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

// Complete practice session and get results
async function completePracticeSession(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Calculate results
        const wordsPracticed = await WordPracticed.findAll({
            where: { session_id: sessionId }
        });
        
        const totalWords = wordsPracticed.length;
        const rememberedWords = wordsPracticed.filter(w => w.remembered === true).length;
        const needPracticeWords = totalWords - rememberedWords;
        const successRate = totalWords > 0 ? (rememberedWords / totalWords) * 100 : 0;
        
        // Mark session as completed
        await session.update({
            completed: true,
            end_time: new Date()
        });
        
        // Create or update practice result
        let result = await PracticeResult.findOne({
            where: { session_id: sessionId }
        });
        
        if (result) {
            await result.update({
                total_words: totalWords,
                remembered: rememberedWords,
                need_practice: needPracticeWords,
                success_rate: successRate,
                time_elapsed: Math.floor((new Date() - new Date(session.start_time)) / 1000)
            });
        } else {
            result = await PracticeResult.create({
                session_id: sessionId,
                total_words: totalWords,
                remembered: rememberedWords,
                need_practice: needPracticeWords,
                success_rate: successRate,
                time_elapsed: Math.floor((new Date() - new Date(session.start_time)) / 1000)
            });
        }
        
        // Update source (lesson or file) with practice count
        if (session.source_type === 'lesson') {
            // Update lesson practice metrics
            // This would be custom logic for your application
        } else if (session.source_type === 'wordFile') {
            const file = await TranslationFile.findByPk(session.source_id);
            if (file) {
                await file.update({
                    practice_session_count: file.practice_session_count + 1,
                    last_practice: new Date()
                });
            }
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Practice session completed successfully',
            data: {
                totalWords,
                remembered: rememberedWords,
                needPractice: needPracticeWords,
                successRate,
                achievements: [] // You can implement achievement logic later
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

// Get words by memory status
async function getWordsByMemoryStatus(req, res) {
    try {
        const { status } = req.query;
        
        let whereClause = { user_id: req.userId };
        
        // Apply status filters
        switch(status) {
            case 'remembered':
                whereClause.remembered = true;
                break;
            case 'notRemembered':
                whereClause.remembered = false;
                break;
            case 'highSuccess':
                whereClause.success_rate = {[Op.gte]: 75};
                break;
            case 'lowSuccess':
                whereClause.success_rate = {[Op.lt]: 40};
                break;
            // Default is all words
        }
        
        const words = await TranslationWord.findAll({
            where: whereClause,
            order: status === 'recent' ? 
                [['last_practiced', 'DESC']] : 
                [['created_at', 'DESC']]
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Words retrieved successfully',
            data: {
                totalWords: words.length,
                words: words.map(word => ({
                    id: word.id,
                    word: word.original,
                    translation: word.translation,
                    remembered: word.remembered,
                    lastPracticed: word.last_practiced
                }))
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

// Get Memory Game cards for a session
async function getMemoryGameCards(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'memory_game'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get words being practiced without using the association
        const wordsPracticed = await WordPracticed.findAll({
            where: { session_id: sessionId }
        });
        
        if (wordsPracticed.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No words found for this practice session'
            });
        }
        
        // Get the word IDs
        const wordIds = wordsPracticed.map(wp => wp.word_id);
        
        // Fetch the translation words separately
        const translationWords = await TranslationWord.findAll({
            where: {
                id: { [Op.in]: wordIds }
            }
        });
        
        // Create a map for quick lookup
        const wordMap = {};
        translationWords.forEach(word => {
            wordMap[word.id] = word;
        });
        
        // Create cards array (both words and translations)
        let cards = [];
        wordsPracticed.forEach((wp, index) => {
            const word = wordMap[wp.word_id];
            if (!word) return; // Skip if word not found
            
            // Add original word card
            cards.push({
                id: `word_${word.id}`,
                word: word.original,
                type: 'word',
                pair_id: index
            });
            
            // Add translation card
            cards.push({
                id: `translation_${word.id}`,
                word: word.translation,
                type: 'translation',
                pair_id: index
            });
        });
        
        // Shuffle cards
        cards = shuffleArray(cards);
        
        // Number of hints available (arbitrary rule: 3 for every 8 cards)
        // const hintCount = Math.floor(wordsPracticed.length / 3) + 1;
        
        return res.status(200).json({
            status: 'success',
            message: 'Memory game cards retrieved successfully',
            data: {
                sessionId,
                totalPairs: wordsPracticed.length,
                timeLimit: 120, // 2 minutes in seconds
                hintCount : session.hints_count,
                cards
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

// Record a move in the memory game
async function recordMemoryGameMove(req, res) {
    try {
        const { sessionId } = req.params;
        const { firstCardId, secondCardId, matchFound, timeElapsed } = req.body;
        
        if (!firstCardId || !secondCardId) {
            return res.status(400).json({
                status: 'error',
                message: 'Both card IDs are required'
            });
        }
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'memory_game'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get or create game progress
        let memoryGameProgress = await MemoryGameProgress.findOne({
            where: { session_id: sessionId }
        });
        
        if (!memoryGameProgress) {
            memoryGameProgress = await MemoryGameProgress.create({
                session_id: sessionId,
                pairs_found: 0,
                total_moves: 0,
                time_elapsed: 0,
                hints_used: 0
            });
        }
        
        // Update progress
        const pairsFound = matchFound ? memoryGameProgress.pairs_found + 1 : memoryGameProgress.pairs_found;
        
        await memoryGameProgress.update({
            pairs_found: pairsFound,
            total_moves: memoryGameProgress.total_moves + 1,
            time_elapsed: timeElapsed
        });
        
        // If a match was found, update the relevant words as "remembered"
        if (matchFound) {
            // Extract word ID from the card IDs
            const wordId1 = firstCardId.split('_')[1];
            const wordId2 = secondCardId.split('_')[1];
            
            if (wordId1 === wordId2) {
                // Find the word practiced record
                const wordPracticed = await WordPracticed.findOne({
                    where: {
                        session_id: sessionId,
                        word_id: wordId1
                    }
                });
                
                if (wordPracticed) {
                    await wordPracticed.update({ remembered: true });
                    
                    // Also update the translation word's overall performance
                    await updateWordPerformance(wordId1);
                }
            }
        }
        
        // Calculate score (basic scoring: 100 - (moves - totalPairs) * 5)
        const totalPairs = await WordPracticed.count({ where: { session_id: sessionId } });
        const moves = memoryGameProgress.total_moves;
        const score = Math.max(0, 100 - (moves - totalPairs) * 5);
        
        return res.status(200).json({
            status: 'success',
            message: 'Move recorded successfully',
            data: {
                pairsFound,
                remainingPairs: totalPairs - pairsFound,
                totalMoves: memoryGameProgress.total_moves,
                score
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

// Use a hint in the memory game
async function useMemoryGameHint(req, res) {
    try {
        const { sessionId } = req.params;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'memory_game'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Get game progress
        let memoryGameProgress = await MemoryGameProgress.findOne({
            where: { session_id: sessionId }
        });
        
        if (!memoryGameProgress) {
            memoryGameProgress = await MemoryGameProgress.create({
                session_id: sessionId,
                pairs_found: 0,
                total_moves: 0,
                time_elapsed: 0,
                hints_used: 0
            });
        }
        
        // Calculate total hints available
        const totalWords = await WordPracticed.count({ where: { session_id: sessionId } });
        const maxHints = Math.floor(totalWords / 3) + 1;
        
        // Check if hints are available
        if (memoryGameProgress.hints_used >= maxHints) {
            return res.status(400).json({
                status: 'error',
                message: 'No hints remaining'
            });
        }
        
        // Get a word that hasn't been found yet
        const unrememberedWord = await WordPracticed.findOne({
            where: {
                session_id: sessionId,
                remembered: false
            },
            include: [
                {
                    model: TranslationWord,
                    as: 'Word',
                    attributes: ['id', 'original', 'translation']
                }
            ],
            order: Sequelize.literal('RAND()') // Random selection
        });
        
        if (!unrememberedWord) {
            return res.status(404).json({
                status: 'error',
                message: 'No pairs remaining to hint'
            });
        }
        
        // Increment hints used
        await memoryGameProgress.update({
            hints_used: memoryGameProgress.hints_used + 1
        });
        
        // Return the pair to reveal
        return res.status(200).json({
            status: 'success',
            message: 'Hint provided successfully',
            data: {
                word: {
                    id: `word_${unrememberedWord.Word.id}`,
                    text: unrememberedWord.Word.original
                },
                translation: {
                    id: `translation_${unrememberedWord.Word.id}`,
                    text: unrememberedWord.Word.translation
                },
                hintsRemaining: maxHints - memoryGameProgress.hints_used - 1
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

// Complete the memory game
async function completeMemoryGame(req, res) {
    try {
        const { sessionId } = req.params;
        const { pairsFound, totalMoves, timeElapsed, hintCount } = req.body;
        
        // Check session ownership
        const session = await PracticeSession.findOne({
            where: {
                id: sessionId,
                user_id: req.userId,
                practice_mode: 'memory_game'
            }
        });
        
        if (!session) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice session not found or not authorized'
            });
        }
        
        // Mark session as completed
        await session.update({
            completed: true,
            hints_count:hintCount,
            end_time: new Date()
        });
        
        // Calculate final score
        const totalPairs = await WordPracticed.count({ where: { session_id: sessionId } });
        const baseScore = Math.max(0, 100 - (totalMoves - totalPairs) * 5);
        const timeBonus = timeElapsed < 60 ? 20 : timeElapsed < 90 ? 10 : 0;
        const finalScore = Math.min(100, baseScore + timeBonus);
        
        // Check if all pairs were found (perfect match)
        const perfectMatch = pairsFound === totalPairs;
        
        // Update practice result
        let practiceResult = await PracticeResult.findOne({
            where: { session_id: sessionId }
        });
        
        const rememberedWords = await WordPracticed.count({
            where: {
                session_id: sessionId,
                remembered: true
            }
        });
        
        if (practiceResult) {
            await practiceResult.update({
                total_words: totalPairs,
                remembered: rememberedWords,
                need_practice: totalPairs - rememberedWords,
                success_rate: (rememberedWords / totalPairs) * 100,
                time_elapsed: timeElapsed
            });
        } else {
            practiceResult = await PracticeResult.create({
                session_id: sessionId,
                total_words: totalPairs,
                remembered: rememberedWords,
                need_practice: totalPairs - rememberedWords,
                success_rate: (rememberedWords / totalPairs) * 100,
                time_elapsed: timeElapsed
            });
        }
        
        // Get achievements
        const achievements = [];
        
        if (perfectMatch) {
            achievements.push({
                id: 'perfect_match',
                name: 'Perfect Match',
                description: 'Found all pairs successfully'
            });
        }
        
        if (finalScore >= 90) {
            achievements.push({
                id: 'master_matcher',
                name: 'Vocabulary Master',
                description: 'Achieved an excellent score in the memory game'
            });
        }
        
        if (timeElapsed < 60 && totalPairs >= 5) {
            achievements.push({
                id: 'speed_demon',
                name: 'Speed Demon',
                description: 'Completed the game in under a minute'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Memory game completed successfully',
            data: {
                result: {
                    pairsFound,
                    totalPairs,
                    totalMoves,
                    timeElapsed,
                    score: finalScore,
                    perfectMatch,
                    successRate: (rememberedWords / totalPairs) * 100
                },
                achievements
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

// Get words by memory status with pagination
async function getWordsByMemoryStatusPaginated(req, res) {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        
        // Calculate offset for pagination
        const offset = (page - 1) * limit;
        
        // Base where clause for authenticated user
        let whereClause = { user_id: req.userId };
        
        // Apply status filters
        switch(status) {
            case 'remembered':
                whereClause.remembered = true;
                break;
            case 'notRemembered':
                whereClause.remembered = false;
                break;
            case 'highSuccess':
                whereClause.success_rate = {[Op.gte]: 75};
                break;
            case 'lowSuccess':
                whereClause.success_rate = {[Op.lt]: 40};
                break;
            // Default is all words
        }
        
        // Get total count for pagination metadata
        const totalCount = await TranslationWord.count({
            where: whereClause
        });
        
        // Get total words count (regardless of filter)
        const totalWordsCount = await TranslationWord.count({
            where: { user_id: req.userId }
        });
        
        // Get remembered words count
        const totalRememberedCount = await TranslationWord.count({
            where: { 
                user_id: req.userId,
                remembered: true
            }
        });
        
        // Get all memory game practice sessions for the user
        const allPracticeSessions = await PracticeSession.findAll({
            where: { 
                user_id: req.userId,
                practice_mode: 'memory_game'
            },
            raw: true
        });

        // Total practice count is simply the length of the array
        const totalPracticeCount = allPracticeSessions.length;
                
        // Order by options
        const orderOption = status === 'recent' ? 
            [['last_practiced', 'DESC'], ['id', 'DESC']] : 
            [['created_at', 'DESC'], ['id', 'DESC']];
        
        // Get paginated words
        const words = await TranslationWord.findAll({
            where: whereClause,
            order: orderOption,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        
        return res.status(200).json({
            status: 'success',
            message: 'Words retrieved successfully',
            data: {
                words: words.map(word => ({
                    id: word.id,
                    word: word.original,
                    translation: word.translation,
                    remembered: word.remembered,
                    favorite: word.is_favorite,
                    lastPracticed: word.last_practiced,
                    successRate: word.success_rate,
                    created_at: word.created_at
                })),
                stats: {
                    totalWords: totalWordsCount,
                    totalRemembered: totalRememberedCount,
                    totalPracticeCount: totalPracticeCount
                },
                pagination: {
                    total: totalCount,
                    perPage: parseInt(limit),
                    currentPage: parseInt(page),
                    lastPage: totalPages,
                    from: offset + 1,
                    to: Math.min(offset + parseInt(limit), totalCount),
                    hasNextPage,
                    hasPrevPage
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

async function getPracticeStatistics(req, res) {
    try {
        // Get total categories (using translation files as categories)
        const categoriesCount = await TranslationFile.count({
            where: { user_id: req.userId }
        });

        // Get total words
        const totalWords = await TranslationWord.count({
            where: { user_id: req.userId }
        });

        // Get available practice modes count
        const practiceModesCount = await PracticeMode.count({
            where: { is_active: true }
        });

        // Optional: Get more detailed statistics
        // Words remembered vs not remembered
        const rememberedWords = await TranslationWord.count({
            where: { 
                user_id: req.userId,
                remembered: true
            }
        });

        // Words with high success rate
        const highSuccessWords = await TranslationWord.count({
            where: { 
                user_id: req.userId,
                success_rate: { [Op.gte]: 75 }
            }
        });

        // Recently practiced words (in the last 7 days)
        const recentlyPracticedWords = await TranslationWord.count({
            where: { 
                user_id: req.userId,
                last_practiced: {
                    [Op.gte]: new Date(new Date() - 7 * 24 * 60 * 60 * 1000)
                }
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Practice statistics retrieved successfully',
            data: {
                categories: 3,
                totalWords: totalWords,
                practiceModes: practiceModesCount,
                // detailed: {
                //     remembered: rememberedWords,
                //     needPractice: totalWords - rememberedWords,
                //     highSuccess: highSuccessWords,
                //     recentlyPracticed: recentlyPracticedWords
                // }
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

// Helper function to update a word's performance metrics
async function updateWordPerformance(wordId) {
    try {
        const word = await TranslationWord.findByPk(wordId);
        if (!word) return;
        
        // Get all practice records for this word
        const practiceRecords = await WordPracticed.findAll({
            where: { word_id: wordId }
        });
        
        const totalPractices = practiceRecords.length;
        const rememberedCount = practiceRecords.filter(record => record.remembered).length;
        const successRate = totalPractices > 0 ? (rememberedCount / totalPractices) * 100 : 0;
        
        // Update word performance
        await word.update({
            remembered: successRate >= 75, // Consider the word "remembered" if success rate is at least 75%
            success_rate: successRate,
            last_practiced: new Date()
        });
    } catch (error) {
        console.error('Error updating word performance:', error);
    }
}

// Helper function to shuffle an array (Fisher-Yates algorithm)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

module.exports = {
    getLessonsByDate,
    getLessonDetails,
    createPracticeSession,
    recordWordResponse,
    completePracticeSession,
    getWordsByMemoryStatus,
    getMemoryGameCards,
    recordMemoryGameMove,
    useMemoryGameHint,
    completeMemoryGame,
    getWordsByMemoryStatusPaginated,
    getPracticeStatistics
};