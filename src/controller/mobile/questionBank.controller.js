// Complete questionBank.controller.js with FIXED teacher distribution

const bcrypt = require('bcrypt');
const Joi = require('joi');
const axios = require('axios');

const Users = require('../../models/users');
const QuestionBank = require('../../models/questionBank');
const UserQuestionResponse = require('../../models/userQuestionResponse');
const UserTeacherRecommendation = require('../../models/userTeacherRecommendation');
const e = require('cors');
const { DataTypes, Op } = require('sequelize');
const UserOccupation = require('../../models/usersOccupation');
const UserReview = require('../../models/userReviews');

// AI API Configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Get all active questions ordered by question_order
async function getAllActiveQuestions(req, res) {
    try {
        // Get language from query parameter, default to 'en'
        const language = req.query.language || 'en';
        
        // Fetch all active questions ordered by question_order then created_at
        const questions = await QuestionBank.findAll({
            where: { 
                is_active: 1 
            },
            attributes: ['id', 'question', 'type', 'options', 'question_order', 'created_at'],
            order: [['question_order', 'ASC'], ['created_at', 'ASC']]
        });

        if (!questions || questions.length === 0) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'No active questions found' 
            });
        }

        // Format questions for mobile response with localization
        const formattedQuestions = questions.map(question => {
            return {
                id: question.id,
                question: question.getLocalizedQuestion(language),
                type: question.type,
                options: question.getLocalizedOptions(language),
                order: question.question_order,
                created_at: question.created_at
            };
        });

        return res.status(200).json({ 
            status: 'success', 
            message: 'Questions retrieved successfully',
            count: formattedQuestions.length,
            data: formattedQuestions 
        });

    } catch (err) {
        console.error('Error fetching questions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching questions'
        });
    }
}

// Get questions by type ordered by question_order
async function getQuestionsByType(req, res) {
    try {
        const { type } = req.params;
        const language = req.query.language || 'en';
        
        // Validate question type
        const validTypes = ['single-choice', 'multiple-choice', 'checkbox', 'yes-no', 'text'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                status: 'error',
                message: `Invalid question type. Valid types are: ${validTypes.join(', ')}`
            });
        }

        // Fetch questions by type ordered by question_order then created_at
        const questions = await QuestionBank.findAll({
            where: { 
                is_active: 1,
                type: type
            },
            attributes: ['id', 'question', 'type', 'options', 'question_order', 'created_at'],
            order: [['question_order', 'ASC'], ['created_at', 'ASC']]
        });

        if (!questions || questions.length === 0) {
            return res.status(404).json({ 
                status: 'error', 
                message: `No active questions found for type: ${type}` 
            });
        }

        // Format questions for mobile response with localization
        const formattedQuestions = questions.map(question => {
            return {
                id: question.id,
                question: question.getLocalizedQuestion(language),
                type: question.type,
                options: question.getLocalizedOptions(language),
                order: question.question_order,
                created_at: question.created_at
            };
        });

        return res.status(200).json({ 
            status: 'success', 
            message: `Questions of type '${type}' retrieved successfully`,
            count: formattedQuestions.length,
            data: formattedQuestions 
        });

    } catch (err) {
        console.error('Error fetching questions by type:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching questions'
        });
    }
}

// Helper function to validate if selected options exist in question options
function validateSelectedOptions(selectedOptions, questionOptions, questionType) {
    if (questionType === 'text') {
        return { isValid: true };
    }
    
    if (!selectedOptions || !Array.isArray(selectedOptions)) {
        return { isValid: false, message: 'Selected options must be an array' };
    }
    
    if (!questionOptions || !Array.isArray(questionOptions)) {
        return { isValid: false, message: 'Question options not found' };
    }
    
    // Check if all selected options exist in question options
    for (const selectedOption of selectedOptions) {
        if (!questionOptions.includes(selectedOption)) {
            return { 
                isValid: false, 
                message: `Selected option "${selectedOption}" is not valid for this question` 
            };
        }
    }
    
    return { isValid: true };
}

// Store user response to a question - UPDATED TO ACCEPT ACTUAL VALUES
async function storeQuestionResponse(req, res) {
    try {
        const { questionId, responseText, selectedOptions } = req.body;
        const userId = req.userId; // From auth middleware
        const language = req.query.language || 'en';
        
        // Validate required fields
        if (!questionId) {
            return res.status(400).json({
                status: 'error',
                message: 'Question ID is required'
            });
        }
        
        // Check if question exists and is active
        const question = await QuestionBank.findOne({
            where: {
                id: questionId,
                is_active: 1
            }
        });
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found or inactive'
            });
        }
        
        // Validate response based on question type
        const validationResult = validateResponse(question.type, responseText, selectedOptions);
        if (!validationResult.isValid) {
            return res.status(400).json({
                status: 'error',
                message: validationResult.message
            });
        }
        
        // For choice questions, validate that selected options exist in question options
        if (question.type !== 'text' && selectedOptions && Array.isArray(selectedOptions)) {
            const questionOptions = question.getLocalizedOptions(language);
            const optionValidation = validateSelectedOptions(selectedOptions, questionOptions, question.type);
            if (!optionValidation.isValid) {
                return res.status(400).json({
                    status: 'error',
                    message: optionValidation.message
                });
            }
        }
        
        // Check if user already responded to this question
        const existingResponse = await UserQuestionResponse.findOne({
            where: {
                user_id: userId,
                question_id: questionId
            }
        });
        
        let userResponse;
        
        if (existingResponse) {
            // Update existing response
            userResponse = await existingResponse.update({
                response_text: responseText || null,
                selected_options: selectedOptions || null, // Store actual values directly
                question_type: question.type,
                updated_at: new Date()
            });
        } else {
            // Create new response
            userResponse = await UserQuestionResponse.create({
                user_id: userId,
                question_id: questionId,
                response_text: responseText || null,
                selected_options: selectedOptions || null, // Store actual values directly
                question_type: question.type
            });
        }
        
        // Format response for mobile
        const formattedResponse = {
            id: userResponse.id,
            questionId: userResponse.question_id,
            responseText: userResponse.response_text,
            selectedOptions: userResponse.selected_options,
            questionType: userResponse.question_type,
            createdAt: userResponse.created_at,
            updatedAt: userResponse.updated_at
        };
        
        return res.status(200).json({
            status: 'success',
            message: existingResponse ? 'Response updated successfully' : 'Response stored successfully',
            data: formattedResponse
        });
        
    } catch (err) {
        console.error('Error storing question response:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while storing response'
        });
    }
}

// 🆕 NEW FUNCTION: Check user's questionnaire completion status
async function getUserQuestionnaireStatus(req, res) {
    try {
        const userId = req.userId; // From auth middleware
        const language = req.query.language || 'en';
        
        // Get all active questions count
        const totalActiveQuestions = await QuestionBank.count({
            where: { 
                is_active: 1 
            }
        });
        
        if (totalActiveQuestions === 0) {
            return res.status(200).json({
                success: true,
                message: 'No active questions available',
                data: {
                    status: 'no_questions',
                    shouldShowQuestionnaire: false,
                    hasCompletedQuestionnaire: false,
                    hasCachedRecommendations: false,
                    completionPercentage: 0,
                    totalQuestions: 0,
                    answeredQuestions: 0,
                    action: 'no_action',
                    lastAnsweredAt: null
                }
            });
        }
        
        // Get user's responses (only for active questions)
        const userResponses = await UserQuestionResponse.findAll({
            where: {
                user_id: userId
            },
            attributes: ['question_id', 'created_at'],
            include: [
                {
                    model: QuestionBank,
                    as: 'question', // This requires the association to be set up
                    where: { is_active: 1 },
                    required: true,
                    attributes: ['id']
                }
            ]
        });
        
        const answeredQuestions = userResponses.length;
        const completionPercentage = Math.round((answeredQuestions / totalActiveQuestions) * 100);
        
        // Check if user has cached recommendations
        let hasCachedRecommendations = false;
        try {
            const cachedRecommendation = await UserTeacherRecommendation.findOne({
                where: {
                    user_id: userId,
                    is_active: true,
                    deleted_at: null
                },
                order: [['created_at', 'DESC']]
            });
            
            hasCachedRecommendations = cachedRecommendation && cachedRecommendation.isValid();
        } catch (cacheError) {
            console.log('Cache check failed:', cacheError);
            hasCachedRecommendations = false;
        }
        
        // Determine user status and required action
        let status, shouldShowQuestionnaire, hasCompletedQuestionnaire, action, message;
        
        if (answeredQuestions === 0) {
            // User hasn't answered any questions
            status = 'not_started';
            shouldShowQuestionnaire = true;
            hasCompletedQuestionnaire = false;
            action = 'show_questionnaire';
            message = 'User needs to complete the questionnaire';
            
        } else if (answeredQuestions < totalActiveQuestions) {
            // 🎯 YOUR USE CASE: User has partially completed questionnaire
            status = 'partially_completed';
            shouldShowQuestionnaire = true;
            hasCompletedQuestionnaire = false;
            action = 'continue_questionnaire';
            message = `User has answered ${answeredQuestions} out of ${totalActiveQuestions} questions`;
            
        } else if (answeredQuestions === totalActiveQuestions) {
            // User has completed all questions
            hasCompletedQuestionnaire = true;
            
            if (hasCachedRecommendations) {
                // User has completed questionnaire and has cached recommendations
                status = 'completed_with_cache';
                shouldShowQuestionnaire = false;
                action = 'show_recommendations';
                message = 'User has completed questionnaire and has cached recommendations';
            } else {
                // User completed questionnaire but no cached recommendations
                status = 'completed_no_cache';
                shouldShowQuestionnaire = false;
                action = 'generate_recommendations';
                message = 'User completed questionnaire but needs to generate recommendations';
            }
        } else {
            // Edge case: user has more responses than active questions (old responses)
            status = 'over_completed';
            shouldShowQuestionnaire = false;
            hasCompletedQuestionnaire = true;
            action = hasCachedRecommendations ? 'show_recommendations' : 'generate_recommendations';
            message = 'User has responses but may need to update questionnaire';
        }
        
        return res.status(200).json({
            success: true,
            message: message,
            data: {
                status: status, // 'not_started', 'partially_completed', 'completed_with_cache', 'completed_no_cache', 'over_completed'
                shouldShowQuestionnaire: shouldShowQuestionnaire, // 🎯 YOUR MAIN BOOLEAN CHECK
                hasCompletedQuestionnaire: hasCompletedQuestionnaire,
                hasCachedRecommendations: hasCachedRecommendations,
                completionPercentage: completionPercentage, // 0-100: percentage of questions completed
                totalQuestions: totalActiveQuestions,
                answeredQuestions: answeredQuestions,
                action: action, // 'show_questionnaire', 'continue_questionnaire', 'show_recommendations', 'generate_recommendations'
                lastAnsweredAt: userResponses.length > 0 ? 
                    Math.max(...userResponses.map(r => new Date(r.created_at).getTime())) : null
            }
        });
        
    } catch (err) {
        console.error('Error checking user questionnaire status:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while checking questionnaire status',
            data: {
                status: 'error',
                shouldShowQuestionnaire: true, // Default to showing questionnaire on error
                hasCompletedQuestionnaire: false,
                hasCachedRecommendations: false,
                completionPercentage: 0,
                totalQuestions: 0,
                answeredQuestions: 0,
                action: 'show_questionnaire',
                lastAnsweredAt: null
            }
        });
    }
}

// SMART TEACHER PRE-FILTERING FUNCTIONS
function extractStudentPreferences(studentResponses) {
    const preferences = {
        languages: [],
        subjects: [],
        level: 'intermediate',
        goals: [],
        preferredTeachingStyle: [],
        schedulePreferences: []
    };
    
    studentResponses.forEach(response => {
        const questionText = response.questionText.toLowerCase();
        
        // Extract language preferences
        if (questionText.includes('language') || questionText.includes('speak')) {
            if (response.selectedOptions && response.selectedOptions.length > 0) {
                preferences.languages.push(...response.selectedOptions);
            }
        }
        
        // Extract subject interests
        if (questionText.includes('subject') || questionText.includes('topic') || questionText.includes('focus')) {
            if (response.selectedOptions && response.selectedOptions.length > 0) {
                preferences.subjects.push(...response.selectedOptions);
            }
        }
        
        // Extract proficiency level - FIXED: Now expects actual text values
        if (questionText.includes('level') || questionText.includes('proficiency')) {
            if (response.selectedOptions && response.selectedOptions.length > 0) {
                console.log('response :', response);
                
                // Now we expect actual text values, not indices
                const levelOption = String(response.selectedOptions[0]).toLowerCase();
                
                if (levelOption.includes('beginner') || levelOption.includes('a1') || levelOption.includes('a2')) {
                    preferences.level = 'beginner';
                } else if (levelOption.includes('advanced') || levelOption.includes('c1') || levelOption.includes('c2')) {
                    preferences.level = 'advanced';
                } else {
                    preferences.level = 'intermediate';
                }
            }
        }
        
        // Extract learning goals
        if (questionText.includes('goal') || questionText.includes('purpose') || questionText.includes('why')) {
            if (response.selectedOptions && response.selectedOptions.length > 0) {
                preferences.goals.push(...response.selectedOptions);
            }
        }
    });
    
    return preferences;
}

async function convertIndicesToOptionValues(responses, language = 'en') {
    try {
        const questionIds = [...new Set(responses.map(r => r.questionId))];
        
        // Fetch question data including options
        const questions = await QuestionBank.findAll({
            where: {
                id: { [Op.in]: questionIds },
                is_active: 1
            },
            attributes: ['id', 'question', 'type', 'options', 'question_order']
        });
        
        const questionMap = {};
        questions.forEach(q => {
            questionMap[q.id] = {
                text: q.getLocalizedQuestion(language),
                type: q.type,
                options: q.getLocalizedOptions(language), // Get actual option text array
                order: q.question_order
            };
        });
        
        // Convert responses with indices to actual option values
        const convertedResponses = responses.map(response => {
            const questionInfo = questionMap[response.questionId];
            
            if (!questionInfo) {
                console.log(`⚠️ Question ${response.questionId} not found`);
                return {
                    questionId: response.questionId,
                    questionText: `Question ${response.questionId}`,
                    questionType: response.responseText ? 'text' : 'choice',
                    responseText: response.responseText,
                    selectedOptions: response.selectedOptions,
                    order: response.questionId
                };
            }
            
            let convertedSelectedOptions = null;
            
            // Convert indices to actual option text if needed
            if (response.selectedOptions && Array.isArray(response.selectedOptions) && questionInfo.options) {
                convertedSelectedOptions = response.selectedOptions.map(optionValue => {
                    // Check if it's an index (number) that needs conversion
                    if (typeof optionValue === 'number' && questionInfo.options[optionValue] !== undefined) {
                        const actualValue = questionInfo.options[optionValue];
                        console.log(`🔧 Question ${response.questionId}: Converted index ${optionValue} to "${actualValue}"`);
                        return actualValue;
                    }
                    // If it's already a string or invalid index, return as-is
                    return String(optionValue);
                });
            } else {
                convertedSelectedOptions = response.selectedOptions;
            }
            
            return {
                questionId: response.questionId,
                questionText: questionInfo.text,
                questionType: questionInfo.type,
                responseText: response.responseText,
                selectedOptions: convertedSelectedOptions,
                order: questionInfo.order
            };
        }).sort((a, b) => a.order - b.order);
        
        return convertedResponses;
        
    } catch (error) {
        console.error('❌ Error converting indices to option values:', error);
        
        // Fallback: return responses as-is with basic formatting
        return responses.map(response => ({
            questionId: response.questionId,
            questionText: `Question ${response.questionId}`,
            questionType: response.responseText ? 'text' : 'choice',
            responseText: response.responseText,
            selectedOptions: response.selectedOptions,
            order: response.questionId
        }));
    }
}

function calculateTeacherScore(teacher, studentPreferences) {
    let score = 0;
    let maxScore = 0;
    
    // 1. Language compatibility (25 points)
    maxScore += 25;
    if (teacher.speakingLanguages && teacher.speakingLanguages.length > 0) {
        const languageMatch = studentPreferences.languages.some(lang => 
            teacher.speakingLanguages.some(teacherLang => 
                teacherLang.toLowerCase().includes(lang.toLowerCase()) ||
                lang.toLowerCase().includes(teacherLang.toLowerCase())
            )
        );
        if (languageMatch) score += 25;
        else if (teacher.speakingLanguages.includes('English')) score += 15; // English as fallback
    }
    
    // 2. Subject/Specialty match (20 points)
    maxScore += 20;
    if (teacher.specialties && teacher.specialties.length > 0) {
        const subjectMatch = studentPreferences.subjects.some(subject =>
            teacher.specialties.some(specialty =>
                specialty.toLowerCase().includes(subject.toLowerCase()) ||
                subject.toLowerCase().includes(specialty.toLowerCase())
            )
        );
        if (subjectMatch) score += 20;
        
        // Also check teachings
        if (teacher.teachings && teacher.teachings.length > 0) {
            const teachingMatch = studentPreferences.subjects.some(subject =>
                teacher.teachings.some(teaching =>
                    teaching.toLowerCase().includes(subject.toLowerCase()) ||
                    subject.toLowerCase().includes(teaching.toLowerCase())
                )
            );
            if (teachingMatch) score += 10; // Bonus for teaching match
        }
    }
    
    // 3. Teaching level appropriateness (15 points)
    maxScore += 15;
    if (teacher.levels && teacher.levels.length > 0) {
        const levelMap = {
            'beginner': ['a1', 'a2', 'beginner', 'basic'],
            'intermediate': ['b1', 'b2', 'intermediate', 'general'],
            'advanced': ['c1', 'c2', 'advanced', 'business', 'academic']
        };
        
        const appropriateLevels = levelMap[studentPreferences.level] || [];
        const levelMatch = teacher.levels.some(level =>
            appropriateLevels.some(appLevel =>
                level.toLowerCase().includes(appLevel)
            )
        );
        if (levelMatch) score += 15;
    }
    
    // 4. Review quality (20 points)
    maxScore += 20;
    if (teacher.reviews && teacher.reviews.totalReviews > 0) {
        const rating = parseFloat(teacher.reviews.averageRating);
        if (rating >= 4.5) score += 20;
        else if (rating >= 4.0) score += 15;
        else if (rating >= 3.5) score += 10;
        else if (rating >= 3.0) score += 5;
        
        // Bonus for having multiple reviews
        if (teacher.reviews.totalReviews >= 10) score += 5;
        else if (teacher.reviews.totalReviews >= 5) score += 3;
    }
    
    // 5. Profile completeness (10 points)
    maxScore += 10;
    let completenessScore = 0;
    if (teacher.headline && teacher.headline.length > 10) completenessScore += 2;
    if (teacher.bio && teacher.bio.length > 50) completenessScore += 2;
    if (teacher.videoDemo) completenessScore += 3;
    if (teacher.education && teacher.education.length > 5) completenessScore += 1;
    if (teacher.experience && teacher.experience.length > 5) completenessScore += 1;
    if (teacher.about && teacher.about.length > 20) completenessScore += 1;
    score += completenessScore;
    
    // 6. Teaching variety (10 points)
    maxScore += 10;
    const totalTeachingAreas = (teacher.teachings ? teacher.teachings.length : 0) +
                             (teacher.specialties ? teacher.specialties.length : 0);
    if (totalTeachingAreas >= 5) score += 10;
    else if (totalTeachingAreas >= 3) score += 7;
    else if (totalTeachingAreas >= 1) score += 4;
    
    // Return percentage score
    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function filterBestTeachers(allTeachers, studentResponses, limit = 6) {
    console.log(`🎯 Starting smart filtering from ${allTeachers.length} teachers...`);
    
    // Extract student preferences
    const studentPreferences = extractStudentPreferences(studentResponses);
    console.log('📊 Student preferences:', studentPreferences);
    
    // Score all teachers
    const scoredTeachers = allTeachers.map(teacher => {
        const score = calculateTeacherScore(teacher, studentPreferences);
        return {
            ...teacher,
            compatibilityScore: score
        };
    });
    
    // Sort by score and take top teachers
    const sortedTeachers = scoredTeachers.sort((a, b) => {
        // Primary sort by compatibility score
        if (b.compatibilityScore !== a.compatibilityScore) {
            return b.compatibilityScore - a.compatibilityScore;
        }
        
        // Secondary sort by review rating
        const aRating = a.reviews?.averageRating || 0;
        const bRating = b.reviews?.averageRating || 0;
        if (bRating !== aRating) {
            return bRating - aRating;
        }
        
        // Tertiary sort by number of reviews
        const aReviews = a.reviews?.totalReviews || 0;
        const bReviews = b.reviews?.totalReviews || 0;
        return bReviews - aReviews;
    });
    
    const selectedTeachers = sortedTeachers.slice(0, limit);
    const remainingTeachers = sortedTeachers.slice(limit);
    
    console.log(`✅ Selected top ${selectedTeachers.length} teachers with scores:`,
        selectedTeachers.map(t => `${t.name} (${t.compatibilityScore}%)`).join(', ')
    );
    
    return {
        selectedTeachers,
        remainingTeachers,
        studentPreferences
    };
}

// AI RECOMMENDATION FUNCTIONS (Modified for 6 teachers only)
async function callDeepSeekAPI(prompt) {
    try {
        console.log('🤖 Calling DeepSeek API...');
        
        const response = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                {
                    role: "system",
                    content: "You are an expert teacher matching system. Analyze student responses and pre-selected teacher profiles to provide final ranking. Always respond with valid JSON format."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 1500,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        console.log('✅ DeepSeek API response received');
        return {
            success: true,
            data: response.data.choices[0].message.content,
            provider: 'DeepSeek'
        };
        
    } catch (error) {
        console.error('❌ DeepSeek API Error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error?.message || error.message,
            provider: 'DeepSeek'
        };
    }
}

async function callOpenAI(prompt) {
    try {
        console.log('🤖 Calling OpenAI API (fallback)...');
        
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are an expert teacher matching system. Analyze student responses and pre-selected teacher profiles to provide final ranking. Always respond with valid JSON format."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 1500,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        console.log('✅ OpenAI API response received');
        return {
            success: true,
            data: response.data.choices[0].message.content,
            provider: 'OpenAI'
        };
        
    } catch (error) {
        console.error('❌ OpenAI API Error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error?.message || error.message,
            provider: 'OpenAI'
        };
    }
}

// 🔧 UPDATED: getFinalTeacherRanking with fallback for missing nextThreeTeachers
async function getFinalTeacherRanking(studentResponses, selectedTeachers) {
    const prompt = `
Analyze this student's learning profile and provide final ranking for these ${selectedTeachers.length} PRE-SELECTED teachers:

STUDENT PROFILE:
${studentResponses.map(response => {
    if (response.selectedOptions) {
        return `Question: ${response.questionText}
Answer: ${JSON.stringify(response.selectedOptions)}`;
    } else {
        return `Question: ${response.questionText}
Answer: "${response.responseText}"`;
    }
}).join('\n\n')}

${selectedTeachers.length} PRE-SELECTED TEACHERS (already filtered for basic compatibility):
${selectedTeachers.map((teacher, index) => {
    const teachingsText = teacher.teachings && teacher.teachings.length > 0 
        ? teacher.teachings.join(', ') 
        : 'General English';
    
    const languagesText = teacher.speakingLanguages && teacher.speakingLanguages.length > 0 
        ? teacher.speakingLanguages.join(', ') 
        : teacher.language || 'English';
    
    const specialtiesText = teacher.specialties && teacher.specialties.length > 0 
        ? teacher.specialties.join(', ') 
        : 'General Teaching';
    
    const levelsText = teacher.levels && teacher.levels.length > 0 
        ? teacher.levels.join(', ') 
        : 'All levels';
    
    const reviewSummary = teacher.reviews && teacher.reviews.totalReviews > 0
        ? `${teacher.reviews.totalReviews} reviews (${teacher.reviews.averageRating}/5.0)`
        : 'No reviews yet';
    
    const recentReviewsText = teacher.reviews && teacher.reviews.recentReviews.length > 0
        ? teacher.reviews.recentReviews.map(review => 
            `"${review.description}" (${review.overallRating}/5)`
          ).join('; ')
        : 'No detailed feedback';

            return `Teacher ${index + 1}:
            - ID: ${teacher.id}
            - Name: ${teacher.name}
            - Headline: ${teacher.headline || 'Experienced Teacher'}
            - Bio: ${teacher.bio || 'Dedicated to helping students achieve their goals'}
            - Experience: ${teacher.experience || 'Professional teaching experience'}
            - Compatibility Score: ${teacher.compatibilityScore}%
            
            TEACHING PROFILE:
            - Teaches: ${teachingsText}
            - Languages: ${languagesText}
            - Specializations: ${specialtiesText}
            - Levels: ${levelsText}
            
            STUDENT FEEDBACK:
            - Reviews: ${reviewSummary}
            - Recent Comments: ${recentReviewsText}
            
            EXTRAS:
            - Video Demo: ${teacher.videoDemo ? 'Available' : 'Not available'}
            - Timezone: ${teacher.timezone || 'Flexible'}`;
        }).join('\n\n')}

        RANKING INSTRUCTIONS:
        These ${selectedTeachers.length} teachers are already pre-filtered for basic compatibility. Your job is to provide nuanced final ranking based on:

        1. **Deep Teaching Match**: How well does their teaching style/approach fit student's specific learning goals?
        2. **Communication Fit**: Language comfort level and teaching personality match
        3. **Experience Relevance**: Specific experience in areas student wants to improve
        4. **Student Success Track**: Quality of student feedback and teaching effectiveness
        5. **Learning Style Alignment**: Teaching methods that match student's preferred learning approach

        RESPONSE REQUIREMENTS:
        - You MUST rank all ${selectedTeachers.length} teachers
        - Top 3 = Best matches (topThreeTeachers) - positions 1-3
        - Next 3 = Good alternatives (nextThreeTeachers) - positions 4-6  
        - Provide detailed, specific match reasons (2-3 per teacher)
        - Include match scores (85-99 for top 3, 70-84 for next 3)

        Return ONLY valid JSON (no extra text) in this UPDATED format:
        {
            "topThreeTeachers": [
                {
                    "teacherId": 123,
                    "name": "Teacher Name",
                    "matchScore": 95,
                    "matchReasons": [
                        "Specializes in exactly what student needs (Business English)",
                        "Excellent student feedback with 4.8/5 rating from 25+ students",
                        "Teaching style matches student's preference for interactive learning"
                    ]
                }
            ],
            "nextThreeTeachers": [
                {
                    "teacherId": 456,
                    "name": "Teacher Name", 
                    "matchScore": 78,
                    "matchReasons": [
                        "Good general English experience with solid 4.2/5 rating",
                        "Available for student's preferred schedule",
                        "Professional approach with video demo"
                    ]
                }
            ],
            "analysis": {
                "studentLevel": "Intermediate",
                "primaryGoals": ["Business English", "Speaking Confidence"],
                "keyPreferences": ["Interactive lessons", "Native speaker", "Evening availability"],
                "rankingSummary": "Prioritized teachers with business English expertise and interactive teaching methods based on student's professional goals"
            }
        }`;

    // Try DeepSeek first, then OpenAI as fallback
    let aiResponse = await callDeepSeekAPI(prompt);
    
    if (!aiResponse.success) {
        console.log('🔄 DeepSeek failed, trying OpenAI...');
        aiResponse = await callOpenAI(prompt);
    }
    
    if (!aiResponse.success) {
        console.error('❌ Both AI APIs failed');
        return {
            success: false,
            error: 'Both DeepSeek and OpenAI APIs failed',
            fallbackRecommendation: createSimpleFallback(selectedTeachers)
        };
    }
    
    try {
        // Clean up and parse JSON response
        let responseText = aiResponse.data.trim();
        
        console.log('📝 Raw AI Response:', responseText.substring(0, 200) + '...');
        
        // Remove markdown code block markers if present
        if (responseText.startsWith('```json')) {
            responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        }
        
        // Find the actual JSON content
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;
        
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
            responseText = responseText.substring(jsonStart, jsonEnd);
        }
        
        const parsedResponse = JSON.parse(responseText);
        
        // Validate response structure
        if (!parsedResponse.topThreeTeachers) {
            throw new Error('Invalid response structure - missing topThreeTeachers');
        }
        
        // 🆕 NEW: Handle missing or incomplete nextThreeTeachers
        if (!parsedResponse.nextThreeTeachers || parsedResponse.nextThreeTeachers.length === 0) {
            console.log('⚠️ AI did not return nextThreeTeachers, creating fallback...');
            
            // Get teacher IDs that are already in topThreeTeachers
            const topThreeIds = parsedResponse.topThreeTeachers.map(t => t.teacherId);
            
            // Find remaining teachers from the selected teachers
            const remainingFromSelected = selectedTeachers.filter(teacher => 
                !topThreeIds.includes(teacher.id)
            );
            
            // Create nextThreeTeachers from remaining teachers
            parsedResponse.nextThreeTeachers = remainingFromSelected.slice(0, 3).map((teacher, index) => ({
                teacherId: teacher.id,
                name: teacher.name,
                matchScore: 75 - (index * 3), // Decreasing scores: 75, 72, 69
                matchReasons: [
                    'Good compatibility with student profile',
                    teacher.reviews?.totalReviews > 0 
                        ? `Rated ${teacher.reviews.averageRating}/5 by ${teacher.reviews.totalReviews} students`
                        : 'Professional teaching experience',
                    'Available for lessons'
                ]
            }));
            
            console.log('✅ Created fallback nextThreeTeachers:', 
                parsedResponse.nextThreeTeachers.map(t => `${t.name} (${t.matchScore}%)`).join(', ')
            );
        }
        
        console.log('✅ Successfully parsed AI ranking');
        console.log('🥇 Top teachers:', parsedResponse.topThreeTeachers?.map(t => `${t.name} (${t.matchScore}%)`).join(', '));
        console.log('🥈 Next teachers:', parsedResponse.nextThreeTeachers?.map(t => `${t.name} (${t.matchScore}%)`).join(', '));
        
        return {
            success: true,
            data: parsedResponse,
            provider: aiResponse.provider
        };
        
    } catch (parseError) {
        console.error('❌ Failed to parse AI response:', parseError);
        
        return {
            success: false,
            error: 'Failed to parse AI response',
            fallbackRecommendation: createSimpleFallback(selectedTeachers),
            provider: aiResponse.provider
        };
    }
}

// 🔧 UPDATED: createSimpleFallback to ensure proper distribution
function createSimpleFallback(selectedTeachers) {
    // Simple fallback: split based on compatibility scores and reviews
    const sorted = [...selectedTeachers].sort((a, b) => {
        const aScore = (a.compatibilityScore || 0) + (a.reviews?.averageRating || 0) * 10;
        const bScore = (b.compatibilityScore || 0) + (b.reviews?.averageRating || 0) * 10;
        return bScore - aScore;
    });
    
    const top3 = sorted.slice(0, 3);
    const next3 = sorted.slice(3, 6); // 🆕 NEW: Next 3 teachers
    
    return {
        // Top 3 teachers (positions 1-3)
        topThreeTeachers: top3.map((teacher, index) => ({
            teacherId: teacher.id,
            name: teacher.name,
            matchScore: Math.max(80, teacher.compatibilityScore || 80) + (3 - index) * 3,
            matchReasons: [
                `High compatibility score (${teacher.compatibilityScore}%)`,
                teacher.reviews?.totalReviews > 0 
                    ? `Rated ${teacher.reviews.averageRating}/5 by ${teacher.reviews.totalReviews} students`
                    : 'Experienced professional teacher',
                teacher.videoDemo ? 'Professional video demo available' : 'Comprehensive teaching profile'
            ]
        })),
        
        // 🆕 NEW: Next 3 teachers (positions 4-6)
        nextThreeTeachers: next3.map((teacher, index) => ({
            teacherId: teacher.id,
            name: teacher.name,
            matchScore: Math.max(60, (teacher.compatibilityScore || 60) - 5) + (3 - index) * 2,
            matchReasons: [
                'Good teaching qualifications',
                teacher.reviews?.totalReviews > 0 
                    ? `${teacher.reviews.totalReviews} student reviews`
                    : 'Professional teaching experience',
                'Available for lessons'
            ]
        })),
        
        // Analysis remains the same
        analysis: {
            studentLevel: "Not determined",
            primaryGoals: ["General English improvement"],
            keyPreferences: ["Not specified"],
            rankingSummary: "Fallback ranking based on teacher profiles and ratings"
        }
    };
}

// 🔧 ENHANCED MAIN FUNCTION WITH FIXED TEACHER DISTRIBUTION
async function storeMultipleResponses(req, res) {
    try {
        const { responses, forceRefresh = false } = req.body;
        console.log('req :',req.userId);
        const userId = req.userId;
        const language = req.query.language || 'en';
        
        // Validate input
        if (!Array.isArray(responses) || responses.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Responses must be a non-empty array',
                data: null
            });
        }
        
        const results = [];
        const errors = [];
        
        // Process and store responses (keeping existing logic)
        for (let i = 0; i < responses.length; i++) {
            const { questionId, responseText, selectedOptions } = responses[i];
            
            try {
                if (!questionId) {
                    errors.push({ questionId, error: 'Question ID is required' });
                    continue;
                }
                
                const question = await QuestionBank.findOne({
                    where: { id: questionId, is_active: 1 }
                });
                
                if (!question) {
                    errors.push({ questionId, error: 'Question not found or inactive' });
                    continue;
                }
                
                if (!responseText && (!selectedOptions || selectedOptions.length === 0)) {
                    errors.push({ questionId, error: 'Response is required' });
                    continue;
                }
                
                const existingResponse = await UserQuestionResponse.findOne({
                    where: { user_id: userId, question_id: questionId }
                });
                
                let userResponse;
                
                if (existingResponse) {
                    userResponse = await existingResponse.update({
                        response_text: responseText || null,
                        selected_options: selectedOptions || null,
                        question_type: question.type,
                        updated_at: new Date()
                    });
                } else {
                    userResponse = await UserQuestionResponse.create({
                        user_id: userId,
                        question_id: questionId,
                        response_text: responseText || null,
                        selected_options: selectedOptions || null,
                        question_type: question.type
                    });
                }
                
                results.push({ questionId: userResponse.question_id });
                
            } catch (error) {
                console.error(`Error processing response ${i}:`, error);
                errors.push({ questionId, error: 'Failed to process response' });
            }
        }
        
        // If too many errors, return early
        if (errors.length >= responses.length) {
            return res.status(400).json({
                success: false,
                message: 'Failed to process responses',
                data: null,
                errors: errors
            });
        }
        
        // 🚀 NEW: Convert indices to actual option values for analysis
        console.log('🔧 Converting option indices to actual values...');
        const studentResponseData = await convertIndicesToOptionValues(responses, language);
        console.log('forceRefresh :',forceRefresh);
        // 🚀 NEW: CHECK CACHE FIRST (unless forceRefresh is true)
        if (!forceRefresh) {
            try {
                console.log('🔍 Checking for existing recommendation cache...');
                
                const cachedRecommendation = await UserTeacherRecommendation.findValidRecommendation(
                    userId, 
                    studentResponseData
                );
                
                if (cachedRecommendation && cachedRecommendation.isValid()) {
                    console.log('✅ Found valid cached recommendation, returning cached data');
                    
                    // FIXED: Properly parse cached data if it's a string
                    let cachedData = cachedRecommendation.recommendation_data;
                    
                    if (typeof cachedData === 'string') {
                        try {
                            cachedData = JSON.parse(cachedData);
                        } catch (parseError) {
                            console.error('Error parsing cached data:', parseError);
                            // Continue with fresh generation if cache is corrupted
                        }
                    }
                    
                    // Convert timestamps for response
                    const cacheInfo = {
                        generatedAt: new Date(cachedRecommendation.created_at * 1000).toISOString(),
                        expiresAt: cachedRecommendation.expires_at ? new Date(cachedRecommendation.expires_at * 1000).toISOString() : null,
                        aiProvider: cachedRecommendation.ai_provider,
                        aiStatus: cachedRecommendation.ai_status,
                        totalTeachers: cachedRecommendation.total_teachers_count
                    };
                    
                    return res.status(200).json({
                        success: true,
                        message: 'Cached teacher recommendations retrieved successfully',
                        data: cachedData,
                        cached: true,
                        cacheInfo: cacheInfo
                    });
                }
                
                console.log('❌ No valid cache found, generating new recommendations...');
                
            } catch (cacheError) {
                console.error('⚠️ Cache check failed, proceeding with generation:', cacheError);
            }
        } else {
            console.log('🔄 Force refresh requested, skipping cache...');
        }
        
        // Get ALL active teachers with comprehensive data (keeping your existing logic)
        let allTeachers = [];
        try {
            const basicTeachers = await Users.findAll({
                where: {
                    role_name: 'teacher',
                    status: 'active',
                    ban: false,
                    deleted_at: null
                },
                attributes: [
                    'id', 'full_name', 'email', 'bio', 'subject',
                    'education', 'experience', 'about', 'language', 'meeting_type',
                    'video_demo', 'video_demo_thumb', 'video_demo_source', 
                    'headline', 'timezone', 'avatar'
                ],
                order: [['full_name', 'ASC']]
            });

            if (basicTeachers.length === 0) {
                return res.status(200).json({
                    success: false,
                    message: 'No active teachers available',
                    data: null
                });
            }

            const teacherIds = basicTeachers.map(teacher => teacher.id);

            // Get ALL occupation data for teachers
            const teacherOccupations = await UserOccupation.findAll({
                where: {
                    user_id: { [Op.in]: teacherIds },
                    type: { [Op.in]: ['teachings', 'also_speaking', 'specialties', 'levels'] }
                },
                attributes: ['user_id', 'type', 'category_id', 'value'],
                order: [['user_id', 'ASC'], ['type', 'ASC']]
            });

            // Get teacher reviews
            const teacherReviews = await UserReview.findAll({
                where: {
                    instructor_id: { [Op.in]: teacherIds }
                },
                attributes: ['instructor_id', 'rates', 'description']
            });

            // Organize data
            const occupationsByTeacher = {};
            teacherOccupations.forEach(occ => {
                if (!occupationsByTeacher[occ.user_id]) {
                    occupationsByTeacher[occ.user_id] = {
                        teachings: [],
                        also_speaking: [],
                        specialties: [],
                        levels: []
                    };
                }
                occupationsByTeacher[occ.user_id][occ.type].push(occ.value);
            });

            // Combine all teacher data
            allTeachers = basicTeachers.map(teacher => {
                const occupations = occupationsByTeacher[teacher.id] || {
                    teachings: [],
                    also_speaking: [],
                    specialties: [],
                    levels: []
                };

                const reviews = teacherReviews.filter(review => review.instructor_id === teacher.id);
                
                let averageRating = 0;
                let totalReviews = reviews.length;
                
                if (totalReviews > 0) {
                    const ratesArray = reviews.map(review => parseFloat(review.rates));
                    const totalRates = ratesArray.reduce((acc, rate) => acc + rate, 0);
                    averageRating = (totalRates / totalReviews).toFixed(1);
                }

                return {
                    id: teacher.id,
                    name: teacher.full_name,
                    email: teacher.email,
                    avatar: teacher.avatar,
                    bio: teacher.bio,
                    subject: teacher.subject,
                    education: teacher.education,
                    experience: teacher.experience,
                    about: teacher.about,
                    language: teacher.language,
                    meetingType: teacher.meeting_type,
                    headline: teacher.headline,
                    timezone: teacher.timezone,
                    videoDemo: teacher.video_demo,
                    videoDemoThumb: teacher.video_demo_thumb,
                    videoDemoSource: teacher.video_demo_source,
                    teachings: occupations.teachings,
                    speakingLanguages: occupations.also_speaking,
                    specialties: occupations.specialties,
                    levels: occupations.levels,
                    reviews: {
                        totalReviews: totalReviews,
                        averageRating: parseFloat(averageRating),
                        recentReviews: reviews.slice(0, 3).map(review => ({
                            overallRating: parseFloat(review.rates),
                            description: review.description
                        }))
                    }
                };
            });

            console.log(`✅ Fetched ${allTeachers.length} total teachers`);

        } catch (error) {
            console.error('❌ Error fetching teacher data:', error);
            return res.status(500).json({
                success: false,
                message: 'Unable to fetch teacher information',
                data: null
            });
        }
        
        // 🔍 DEBUG: Track teacher flow
        console.log('🔍 TEACHER FLOW DEBUG:');
        console.log('1. Total teachers found:', allTeachers.length);
        console.log('   Teacher IDs:', allTeachers.map(t => t.id).join(', '));
        
        // SMART FILTERING: Get best teachers for AI processing
        const filterResult = filterBestTeachers(allTeachers, studentResponseData, 6);
        const { selectedTeachers, remainingTeachers, studentPreferences } = filterResult;
        
        console.log('2. After smart filtering:');
        console.log('   Selected for AI (top 6):', selectedTeachers.length);
        console.log('   Selected IDs:', selectedTeachers.map(t => t.id).join(', '));
        console.log('   Remaining teachers:', remainingTeachers.length);
        console.log('   Remaining IDs:', remainingTeachers.map(t => t.id).join(', '));
        
        if (selectedTeachers.length === 0) {
            return res.status(200).json({
                success: false,
                message: 'No suitable teachers found',
                data: null
            });
        }
        
        // AI FINAL RANKING: Get top 3 + next 3 from the selected teachers
        let aiRecommendation = null;
        let aiStatus = 'success';
        let aiMessage = 'Teacher recommendations generated successfully';
        let aiProvider = null;
        
        try {
            console.log('🤖 Starting AI final ranking for selected teachers...');
            
            const aiResult = await getFinalTeacherRanking(studentResponseData, selectedTeachers);
            
            if (aiResult.success) {
                aiRecommendation = aiResult.data;
                aiProvider = aiResult.provider;
                console.log(`✅ AI final ranking completed using ${aiResult.provider}`);
            } else {
                aiRecommendation = aiResult.fallbackRecommendation;
                aiStatus = 'fallback';
                aiMessage = 'Using fallback recommendations (AI temporarily unavailable)';
                aiProvider = 'Fallback';
                console.log('⚠️ Using fallback recommendation');
            }
        } catch (error) {
            console.error('❌ AI processing error:', error);
            aiRecommendation = createSimpleFallback(selectedTeachers);
            aiStatus = 'error';
            aiMessage = 'AI processing failed, using basic recommendations';
            aiProvider = 'Fallback';
        }
        
        if (!aiRecommendation) {
            return res.status(200).json({
                success: false,
                message: aiMessage,
                data: null
            });
        }

        console.log('3. After AI processing:');
        console.log('   AI returned topThreeTeachers:', aiRecommendation.topThreeTeachers?.length || 0);
        console.log('   AI returned nextThreeTeachers:', aiRecommendation.nextThreeTeachers?.length || 0);

        if (aiRecommendation.topThreeTeachers) {
            console.log('   Top 3 IDs:', aiRecommendation.topThreeTeachers.map(t => t.teacherId).join(', '));
        }
        if (aiRecommendation.nextThreeTeachers) {
            console.log('   Next 3 IDs:', aiRecommendation.nextThreeTeachers.map(t => t.teacherId).join(', '));
        }

        // Helper function to get full teacher data by ID
        const getFullTeacherData = (teacherId) => {
            const teacher = allTeachers.find(t => t.id === teacherId);
            if (!teacher) return null;
            
            return {
                teacherId: teacher.id,
                name: teacher.name,
                about: teacher.about,
                avatar: teacher.avatar,
                language: teacher.language,
                headline: teacher.headline,
                timezone: teacher.timezone,
                videoDemo: teacher.videoDemo,
                videoDemoThumb: teacher.videoDemoThumb,
                videoDemoSource: teacher.videoDemoSource,
                bio: teacher.bio,
                subject: teacher.subject,
                education: teacher.education,
                experience: teacher.experience,
                meetingType: teacher.meetingType,
                teachings: teacher.teachings,
                speakingLanguages: teacher.speakingLanguages,
                specialties: teacher.specialties,
                levels: teacher.levels,
                reviews: teacher.reviews,
                compatibilityScore: teacher.compatibilityScore || null
            };
        };
        
        // 🔧 BUILD FINAL RESPONSE WITH GUARANTEED ALL TEACHERS
        const responseData = {
            // Top 3 teachers (AI ranked)
            topThreeTeachers: aiRecommendation.topThreeTeachers?.map(teacher => {
                const fullTeacherData = getFullTeacherData(teacher.teacherId);
                return {
                    ...fullTeacherData,
                    matchScore: teacher.matchScore,
                    matchReasons: teacher.matchReasons || []
                };
            }).filter(Boolean) || [],
            
            // Next 3 teachers (AI ranked or fallback)
            nextThreeTeachers: aiRecommendation.nextThreeTeachers?.map(teacher => {
                const fullTeacherData = getFullTeacherData(teacher.teacherId);
                return {
                    ...fullTeacherData,
                    matchScore: teacher.matchScore,
                    matchReasons: teacher.matchReasons || []
                };
            }).filter(Boolean) || [],
            
            // 🆕 ALL REMAINING TEACHERS (ensures all teachers are included)
            otherMatchedTeachers: []
        };
        
        // Get teacher IDs that are already included in the response
        const topThreeIds = responseData.topThreeTeachers.map(t => t.teacherId);
        const nextThreeIds = responseData.nextThreeTeachers.map(t => t.teacherId);
        const includedIds = [...topThreeIds, ...nextThreeIds];
        
        // Find any teachers from the selected teachers that are missing
        const missingFromSelected = selectedTeachers.filter(teacher => 
            !includedIds.includes(teacher.id)
        );
        
        // Combine missing teachers with remaining teachers for otherMatchedTeachers
        const allOtherTeachers = [...missingFromSelected, ...remainingTeachers];
        
        // Add all other teachers to the response
        responseData.otherMatchedTeachers = allOtherTeachers.map(teacher => ({
            teacherId: teacher.id,
            name: teacher.name,
            about: teacher.about,
            avatar: teacher.avatar,
            language: teacher.language,
            headline: teacher.headline,
            timezone: teacher.timezone,
            videoDemo: teacher.videoDemo,
            videoDemoThumb: teacher.videoDemoThumb,
            videoDemoSource: teacher.videoDemoSource,
            bio: teacher.bio,
            subject: teacher.subject,
            education: teacher.education,
            experience: teacher.experience,
            meetingType: teacher.meetingType,
            teachings: teacher.teachings,
            speakingLanguages: teacher.speakingLanguages,
            specialties: teacher.specialties,
            levels: teacher.levels,
            reviews: teacher.reviews,
            compatibilityScore: teacher.compatibilityScore || null,
            matchScore: 0,
            matchReasons: []
        }));
        
        // 📊 Calculate final summary
        const summary = {
            topThreeCount: responseData.topThreeTeachers.length,
            nextThreeCount: responseData.nextThreeTeachers.length,
            otherMatchedCount: responseData.otherMatchedTeachers.length,
            totalTeachersProcessed: allTeachers.length,
            totalTeachersReturned: responseData.topThreeTeachers.length + 
                                  responseData.nextThreeTeachers.length + 
                                  responseData.otherMatchedTeachers.length,
            aiProvider: aiProvider,
            aiStatus: aiStatus
        };
        
        console.log('4. Final response breakdown:');
        console.log('   topThreeTeachers:', summary.topThreeCount);
        console.log('   nextThreeTeachers:', summary.nextThreeCount);
        console.log('   otherMatchedTeachers:', summary.otherMatchedCount);
        console.log('   TOTAL RETURNED:', summary.totalTeachersReturned, '/', summary.totalTeachersProcessed);
        
        // Ensure we're returning all teachers
        if (summary.totalTeachersReturned !== summary.totalTeachersProcessed) {
            console.error(`⚠️ MISMATCH: Expected ${summary.totalTeachersProcessed} teachers, but returning ${summary.totalTeachersReturned}`);
        } else {
            console.log('✅ SUCCESS: All teachers included in response');
        }
        
        // 💾 NEW: SAVE TO CACHE
        try {
            console.log('💾 Saving recommendation to cache...');
            
            await UserTeacherRecommendation.createRecommendation(
                userId,
                studentResponseData,
                responseData,
                {
                    totalTeachers: allTeachers.length,
                    selectedTeachers: selectedTeachers.length,
                    provider: aiProvider,
                    status: aiStatus
                }
            );
            
            console.log('✅ Recommendation cached successfully');
            
        } catch (cacheError) {
            console.error('⚠️ Failed to cache recommendation:', cacheError);
            // Don't fail the request if caching fails
        }
        
        // API RESPONSE AS REQUESTED
        return res.status(200).json({
            success: true,
            message: aiMessage,
            data: responseData,
            cached: false,
            generated: true,
            summary: summary
        });
        
    } catch (err) {
        console.error('❌ Critical error in storeMultipleResponses:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error occurred',
            data: null
        });
    }
}

// FIXED: Get cached recommendations only (with proper JSON parsing)
async function getCachedRecommendations(req, res) {
    try {
        const userId = req.userId;
        
        const cachedRecommendation = await UserTeacherRecommendation.findOne({
            where: {
                user_id: userId,
                is_active: true,
                deleted_at: null
            },
            order: [['created_at', 'DESC']]
        });
        
        if (!cachedRecommendation || !cachedRecommendation.isValid()) {
            return res.status(404).json({
                success: false,
                message: 'No valid cached recommendations found',
                data: null
            });
        }
        
        // FIXED: Properly parse the recommendation_data if it's a string
        let recommendationData = cachedRecommendation.recommendation_data;
        
        // If the data is still a string, parse it
        if (typeof recommendationData === 'string') {
            try {
                recommendationData = JSON.parse(recommendationData);
            } catch (parseError) {
                console.error('Error parsing cached recommendation data:', parseError);
                return res.status(500).json({
                    success: false,
                    message: 'Cached data format error',
                    data: null
                });
            }
        }
        
        // Convert timestamps for response
        const cacheInfo = {
            generatedAt: new Date(cachedRecommendation.created_at * 1000).toISOString(),
            expiresAt: cachedRecommendation.expires_at ? new Date(cachedRecommendation.expires_at * 1000).toISOString() : null,
            aiProvider: cachedRecommendation.ai_provider,
            aiStatus: cachedRecommendation.ai_status,
            totalTeachers: cachedRecommendation.total_teachers_count
        };
        
        return res.status(200).json({
            success: true,
            message: 'Cached recommendations retrieved successfully',
            data: recommendationData, // NOW RETURNS PROPER JSON OBJECT
            cached: true,
            cacheInfo: cacheInfo
        });
        
    } catch (err) {
        console.error('Error fetching cached recommendations:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while fetching cached recommendations',
            data: null
        });
    }
}

// NEW: Clear user's recommendation cache
async function clearRecommendationCache(req, res) {
    try {
        const userId = req.userId;
        
        const affectedRows = await UserTeacherRecommendation.softDeleteUserRecommendations(userId);
        
        return res.status(200).json({
            success: true,
            message: `Cleared ${affectedRows} cached recommendations`,
            data: { clearedCount: affectedRows }
        });
        
    } catch (err) {
        console.error('Error clearing recommendation cache:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while clearing cache',
            data: null
        });
    }
}

// Get user's responses to questions
async function getUserResponses(req, res) {
    try {
        const userId = req.userId;
        const { questionId } = req.query;
        
        const whereCondition = { user_id: userId };
        
        // If specific question ID is provided
        if (questionId) {
            whereCondition.question_id = questionId;
        }
        
        const responses = await UserQuestionResponse.findAll({
            where: whereCondition,
            include: [
                {
                    model: QuestionBank,
                    as: 'question',
                    attributes: ['id', 'question', 'type', 'options', 'question_order']
                }
            ],
            order: [['created_at', 'DESC']]
        });
        
        if (!responses || responses.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No responses found'
            });
        }
        
        // Format responses for mobile
        const formattedResponses = responses.map(response => ({
            id: response.id,
            questionId: response.question_id,
            responseText: response.response_text,
            selectedOptions: response.selected_options,
            questionType: response.question_type,
            createdAt: response.created_at,
            updatedAt: response.updated_at,
            question: response.question ? {
                id: response.question.id,
                text: response.question.question,
                type: response.question.type,
                order: response.question.question_order
            } : null
        }));
        
        return res.status(200).json({
            status: 'success',
            message: 'User responses retrieved successfully',
            count: formattedResponses.length,
            data: formattedResponses
        });
        
    } catch (err) {
        console.error('Error fetching user responses:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching responses'
        });
    }
}

// Helper function to validate response based on question type
function validateResponse(questionType, responseText, selectedOptions) {
    switch (questionType) {
        case 'text':
            if (!responseText || responseText.trim() === '') {
                return { isValid: false, message: 'Response text is required for text questions' };
            }
            return { isValid: true };
            
        case 'single-choice':
        case 'yes-no':
            if (!selectedOptions || !Array.isArray(selectedOptions) || selectedOptions.length !== 1) {
                return { isValid: false, message: `Exactly one option must be selected for ${questionType} questions` };
            }
            return { isValid: true };
            
        case 'multiple-choice':
        case 'checkbox':
            if (!selectedOptions || !Array.isArray(selectedOptions) || selectedOptions.length === 0) {
                return { isValid: false, message: `At least one option must be selected for ${questionType} questions` };
            }
            return { isValid: true };
            
        default:
            return { isValid: false, message: 'Invalid question type' };
    }
}

// MODULE EXPORTS - COMPLETE LIST INCLUDING NEW FUNCTION
module.exports = {
    getAllActiveQuestions,
    getQuestionsByType,
    storeQuestionResponse,
    storeMultipleResponses, // Enhanced with caching and fixed teacher distribution
    getUserResponses,
    getCachedRecommendations,
    clearRecommendationCache,
    getUserQuestionnaireStatus // 🆕 NEW: Your main function for checking status
};