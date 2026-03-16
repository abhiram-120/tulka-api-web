const QuestionBank = require('../../models/questionBank');
const { Op } = require('sequelize');
const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const config = require('../../config/config');

const hasS3Config = Boolean(config.AWS_BUCKET && config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);

// Configure AWS S3
if (hasS3Config) {
    AWS.config.update({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: 'eu-central-1'
    });
}

const s3 = hasS3Config ? new AWS.S3() : null;

// Configure multer for option images
const uploadImages = multer({
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit for images
    },
    storage: hasS3Config
        ? multerS3({
            s3: s3,
            bucket: config.AWS_BUCKET,
            acl: 'public-read',
            contentType: multerS3.AUTO_CONTENT_TYPE,
            metadata: function (req, file, cb) {
                cb(null, { fieldName: file.fieldname });
            },
            key: function (req, file, cb) {
                const timestamp = Date.now();
                cb(null, `questions/option-images/${timestamp}-${file.originalname}`);
            }
        })
        : multer.memoryStorage(),
    fileFilter: function (req, file, cb) {
        // Only allow image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

/**
 * Get all questions with optional filtering
 */
const getQuestions = async (req, res) => {
    try {
        const { 
            search, 
            type,
            status = 'all', 
            page = 1, 
            limit = 20,
            language = 'en'
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        const whereConditions = {};
        
        if (search) {
            whereConditions.question = { [Op.like]: `%${search}%` };
        }
        
        if (type) {
            whereConditions.type = type;
        }
        
        if (status !== 'all') {
            whereConditions.is_active = status === 'active' ? 1 : 0;
        }
        
        const questions = await QuestionBank.findAndCountAll({
            where: whereConditions,
            limit: parseInt(limit),
            offset: offset,
            order: [['question_order', 'ASC'], ['created_at', 'DESC']]
        });
        
        const formattedQuestions = questions.rows.map(question => {
            return formatQuestionResponse(question);
        });
        
        return res.status(200).json({
            status: 'success',
            data: formattedQuestions,
            pagination: {
                total: questions.count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(questions.count / parseInt(limit))
            },
            message: 'Questions retrieved successfully'
        });
        
    } catch (error) {
        console.error('Error fetching questions:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get question by ID
 */
const getQuestionById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const question = await QuestionBank.findByPk(id);
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        const formattedQuestion = formatQuestionResponse(question);
        
        return res.status(200).json({
            status: 'success',
            data: formattedQuestion
        });
        
    } catch (error) {
        console.error('Error fetching question details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Helper functions for normalization
 */
function normalizeMultilingualData(data) {
    if (!data) {
        return { en: '', he: '', ar: '' };
    }
    
    if (typeof data === 'string') {
        return { en: data, he: '', ar: '' };
    }
    
    if (typeof data === 'object' && !Array.isArray(data)) {
        if (data.en && typeof data.en === 'object' && !Array.isArray(data.en)) {
            return {
                en: data.en.en || '',
                he: data.en.he || data.he || '',
                ar: data.en.ar || data.ar || ''
            };
        }
        
        return {
            en: data.en || '',
            he: data.he || '',
            ar: data.ar || ''
        };
    }
    
    return { en: String(data || ''), he: '', ar: '' };
}

function normalizeMultilingualOptions(options) {
    if (!options) {
        return { en: [], he: [], ar: [] };
    }
    
    if (Array.isArray(options)) {
        return { en: options, he: [], ar: [] };
    }
    
    if (typeof options === 'object') {
        if (options.en && typeof options.en === 'object' && !Array.isArray(options.en)) {
            return {
                en: Array.isArray(options.en.en) ? options.en.en : [],
                he: Array.isArray(options.en.he) ? options.en.he : Array.isArray(options.he) ? options.he : [],
                ar: Array.isArray(options.en.ar) ? options.en.ar : Array.isArray(options.ar) ? options.ar : []
            };
        }
        
        return {
            en: Array.isArray(options.en) ? options.en : [],
            he: Array.isArray(options.he) ? options.he : [],
            ar: Array.isArray(options.ar) ? options.ar : []
        };
    }
    
    return { en: [], he: [], ar: [] };
}

/**
 * Helper function to combine option texts with their image URLs
 * Converts from: { en: ["text1", "text2"], he: [], ar: [] }
 * To: { en: [["text1", "url1"], ["text2", "url2"]], he: [], ar: [] }
 */
function combineOptionsWithImages(options, imageUrls) {
    return {
        en: options.en.map((text, index) => [text, imageUrls[index] || null]),
        he: options.he.map((text, index) => [text, imageUrls[index] || null]),
        ar: options.ar.map((text, index) => [text, imageUrls[index] || null])
    };
}

/**
 * Create a new question
 */
const createQuestion = async (req, res) => {
    try {
        const { question, type, options, isActive, questionOrder } = req.body;
        
        let parsedQuestion = question;
        let parsedOptions = options;
        
        if (typeof question === 'string') {
            try {
                parsedQuestion = JSON.parse(question);
            } catch (e) {
                console.error('Error parsing question JSON:', e);
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid question format'
                });
            }
        }
        
        if (typeof options === 'string') {
            try {
                parsedOptions = JSON.parse(options);
            } catch (e) {
                console.error('Error parsing options JSON:', e);
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid options format'
                });
            }
        }
        
        if (!parsedQuestion || !type) {
            return res.status(400).json({
                status: 'error',
                message: 'Question text and type are required'
            });
        }
        
        const normalizedQuestion = normalizeMultilingualData(parsedQuestion);
        
        if (!normalizedQuestion.en) {
            return res.status(400).json({
                status: 'error',
                message: 'Question text in English is required'
            });
        }
        
        let normalizedOptions = null;
        if (type !== 'text') {
            normalizedOptions = normalizeMultilingualOptions(parsedOptions);
            
            if (!normalizedOptions.en || normalizedOptions.en.length < 2) {
                return res.status(400).json({
                    status: 'error',
                    message: 'At least 2 options in English are required for this question type'
                });
            }
        }
        
        // Handle question order
        let orderValue = questionOrder;
        if (!orderValue || orderValue <= 0) {
            const maxOrder = await QuestionBank.max('question_order');
            orderValue = (maxOrder || 0) + 1;
        }
        
        // Handle uploaded option images with index mapping
        // Frontend sends imageIndices array to map files to their correct positions
        let optionImageUrls = [];
        
        if (req.files && req.files.optionImages && req.files.optionImages.length > 0) {
            // Get the indices from the request body
            let imageIndices = [];
            if (req.body.imageIndices) {
                try {
                    imageIndices = JSON.parse(req.body.imageIndices);
                } catch (e) {
                    console.error('Error parsing imageIndices:', e);
                }
            }
            
            // If we have indices, use them to map files to positions
            if (imageIndices.length === req.files.optionImages.length) {
                // Create array with nulls for all option positions
                const maxIndex = Math.max(...imageIndices);
                optionImageUrls = Array(maxIndex + 1).fill(null);
                
                // Place each file at its correct index
                req.files.optionImages.forEach((file, fileIndex) => {
                    const optionIndex = imageIndices[fileIndex];
                    optionImageUrls[optionIndex] = file.location;
                });
            } else {
                // Fallback: assume sequential order (backward compatibility)
                optionImageUrls = req.files.optionImages.map(file => file.location);
            }
        }
        
        // Combine options with their image URLs into [text, imageUrl] format
        if (normalizedOptions && optionImageUrls.length > 0) {
            normalizedOptions = combineOptionsWithImages(normalizedOptions, optionImageUrls);
        } else if (normalizedOptions) {
            // No images, convert to [text, null] format
            normalizedOptions = {
                en: normalizedOptions.en.map(text => [text, null]),
                he: normalizedOptions.he.map(text => [text, null]),
                ar: normalizedOptions.ar.map(text => [text, null])
            };
        }
        
        const newQuestion = await QuestionBank.create({
            question: JSON.stringify(normalizedQuestion),
            type,
            question_order: orderValue,
            options: normalizedOptions ? JSON.stringify(normalizedOptions) : null,
            is_active: isActive !== undefined ? (isActive === true || isActive === 'true') : true
        });
        
        const formattedQuestion = {
            id: newQuestion.id,
            question: normalizedQuestion,
            type: newQuestion.type,
            questionOrder: newQuestion.question_order,
            options: normalizedOptions || { en: [], he: [], ar: [] },
            isActive: !!newQuestion.is_active,
            createdAt: newQuestion.created_at
        };
        
        return res.status(201).json({
            status: 'success',
            data: formattedQuestion,
            message: 'Question created successfully'
        });
        
    } catch (error) {
        console.error('Error creating question:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update a question
 */
const updateQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        const { question, type, options, isActive, questionOrder } = req.body;
        
        let parsedQuestion = question;
        let parsedOptions = options;
        
        if (typeof question === 'string') {
            try {
                parsedQuestion = JSON.parse(question);
            } catch (e) {
                console.error('Error parsing question JSON:', e);
            }
        }
        
        if (typeof options === 'string') {
            try {
                parsedOptions = JSON.parse(options);
            } catch (e) {
                console.error('Error parsing options JSON:', e);
            }
        }
        
        const existingQuestion = await QuestionBank.findByPk(id);
        
        if (!existingQuestion) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        let updatedQuestion = existingQuestion.question;
        let updatedType = type || existingQuestion.type;
        let updatedOptions = existingQuestion.options;
        let updatedActive = isActive !== undefined 
            ? (isActive === true || isActive === 'true') 
            : existingQuestion.is_active;
        let updatedOrder = questionOrder !== undefined ? questionOrder : existingQuestion.question_order;
        
        if (parsedQuestion) {
            const normalizedQuestion = normalizeMultilingualData(parsedQuestion);
            
            if (!normalizedQuestion.en) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Question text in English is required'
                });
            }
            
            updatedQuestion = JSON.stringify(normalizedQuestion);
        }
        
        if (parsedOptions) {
            const normalizedOptions = normalizeMultilingualOptions(parsedOptions);
            
            if (updatedType !== 'text') {
                if (!normalizedOptions.en || normalizedOptions.en.length < 2) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'At least 2 options in English are required for this question type'
                    });
                }
            }

            let existingImageUrls = [];
            try {
                const existingOptions = JSON.parse(existingQuestion.options || '{"en":[],"he":[],"ar":[]}');
                if (existingOptions.en && Array.isArray(existingOptions.en)) {
                    existingImageUrls = existingOptions.en.map(opt => {
                        if (Array.isArray(opt) && opt.length >= 2) {
                            return opt[1] || null; 
                        }
                        return null;
                    });
                }
            } catch (e) {
                console.error('Error parsing existing options:', e);
            }
            
            let explicitImageUrls = [];
            if (req.body.existingOptionImages) {
                try {
                    explicitImageUrls = typeof req.body.existingOptionImages === 'string' 
                        ? JSON.parse(req.body.existingOptionImages)
                        : req.body.existingOptionImages;
                } catch (e) {
                    console.error('Error parsing existingOptionImages from body:', e);
                }
            }
            
            // Handle newly uploaded option images with index mapping
            // Frontend sends imageIndices array to map files to their correct positions
            let newImageUrls = [];
            if (req.files && req.files.optionImages && req.files.optionImages.length > 0) {
                // Get the indices from the request body
                let imageIndices = [];
                if (req.body.imageIndices) {
                    try {
                        imageIndices = JSON.parse(req.body.imageIndices);
                    } catch (e) {
                        console.error('Error parsing imageIndices:', e);
                    }
                }
                
                // If we have indices, use them to map files to positions
                if (imageIndices.length === req.files.optionImages.length) {
                    // Create array with nulls for all option positions
                    const maxIndex = Math.max(...imageIndices);
                    newImageUrls = Array(maxIndex + 1).fill(null);
                    
                    // Place each file at its correct index
                    req.files.optionImages.forEach((file, fileIndex) => {
                        const optionIndex = imageIndices[fileIndex];
                        newImageUrls[optionIndex] = file.location;
                    });
                } else {
                    // Fallback: assume sequential order (backward compatibility)
                    newImageUrls = req.files.optionImages.map(file => file.location);
                }
            }
            
            // Merge with priority: New uploads > Explicit URLs > Existing URLs
            let finalImageUrls = normalizedOptions.en.map((text, index) => {
                // Priority 1: New uploaded file at this index
                if (newImageUrls[index]) {
                    return newImageUrls[index];
                }
                
                // Priority 2: Explicitly provided URL from frontend
                // Empty string means "remove this image"
                if (explicitImageUrls.length > 0 && index < explicitImageUrls.length) {
                    const explicitUrl = explicitImageUrls[index];
                    if (explicitUrl === '' || explicitUrl === null) {
                        return null;  // User removed this image
                    }
                    if (explicitUrl) {
                        return explicitUrl;  // User kept this image
                    }
                }
                
                // Priority 3: Keep existing image from database
                return existingImageUrls[index] || null;
            });
            
            // Combine options with their image URLs (new or existing)
            const finalOptions = {
                en: normalizedOptions.en.map((text, index) => [text, finalImageUrls[index]]),
                he: normalizedOptions.he.map((text, index) => [text, finalImageUrls[index]]),
                ar: normalizedOptions.ar.map((text, index) => [text, finalImageUrls[index]])
            };
            
            updatedOptions = JSON.stringify(finalOptions);
        }
        
        await existingQuestion.update({
            question: updatedQuestion,
            type: updatedType,
            options: updatedOptions,
            question_order: updatedOrder,
            is_active: updatedActive
        });
        
        const formattedQuestion = formatQuestionResponse(existingQuestion);
        
        return res.status(200).json({
            status: 'success',
            data: formattedQuestion,
            message: 'Question updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating question:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * UPDATE QUESTION ORDER
 */
const updateQuestionOrder = async (req, res) => {
    try {
        const { questionOrders } = req.body;
        
        // Validate input
        if (!Array.isArray(questionOrders)) {
            return res.status(400).json({
                status: 'error',
                message: 'questionOrders must be an array of objects with id and order properties'
            });
        }
        
        // Validate each item in the array
        for (const item of questionOrders) {
            if (!item.id || typeof item.order !== 'number') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Each item must have id and order (number) properties'
                });
            }
        }
        
        // Update each question's order in a transaction for data consistency
        const { sequelize } = require('../../connection/connection');
        
        await sequelize.transaction(async (t) => {
            const updatePromises = questionOrders.map(async ({ id, order }) => {
                const question = await QuestionBank.findByPk(id, { transaction: t });
                
                if (!question) {
                    throw new Error(`Question with id ${id} not found`);
                }
                
                await question.update(
                    { question_order: order },
                    { transaction: t }
                );
                
                return { id, order };
            });
            
            await Promise.all(updatePromises);
        });
        
        return res.status(200).json({
            status: 'success',
            message: 'Question orders updated successfully',
            data: {
                updated: questionOrders.length,
                items: questionOrders
            }
        });
        
    } catch (error) {
        console.error('Error updating question orders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Delete a question
 */
const deleteQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        
        const question = await QuestionBank.findByPk(id);
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        await question.destroy();
        
        return res.status(200).json({
            status: 'success',
            message: 'Question deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting question:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Toggle question status
 */
const toggleQuestionStatus = async (req, res) => {
    try {
        const { id } = req.params;
        
        const question = await QuestionBank.findByPk(id);
        
        if (!question) {
            return res.status(404).json({
                status: 'error',
                message: 'Question not found'
            });
        }
        
        await question.update({
            is_active: !question.is_active
        });
        
        return res.status(200).json({
            status: 'success',
            data: {
                id: question.id,
                isActive: !!question.is_active
            },
            message: `Question ${question.is_active ? 'activated' : 'deactivated'} successfully`
        });
        
    } catch (error) {
        console.error('Error toggling question status:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Helper function to format question response
 */
function formatQuestionResponse(question) {
    let questionText;
    try {
        questionText = parseQuestion(question.question);
    } catch (e) {
        questionText = question.question;
    }
    
    let parsedOptions = parseOptions(question.options);
    
    return {
        id: question.id,
        question: questionText,
        type: question.type,
        questionOrder: question.question_order,
        options: parsedOptions,
        isActive: !!question.is_active,
        createdAt: question.created_at,
        updatedAt: question.updated_at
    };
}

function parseQuestion(questionData) {
    if (!questionData) return '';
    
    if (isJsonString(questionData)) {
        const parsed = JSON.parse(questionData);
        
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                en: parsed.en || '',
                he: parsed.he || '',
                ar: parsed.ar || ''
            };
        }
        return parsed;
    }
    
    return {
        en: questionData,
        he: '',
        ar: ''
    };
}

function parseOptions(optionsData) {
    if (!optionsData) {
        return { en: [], he: [], ar: [] };
    }
    
    // Handle if optionsData is already an object (Sequelize auto-parses JSON fields)
    if (typeof optionsData === 'object' && !Array.isArray(optionsData) && optionsData !== null) {
        // Check if already in [text, imageUrl] format
        if (optionsData.en && Array.isArray(optionsData.en)) {
            // Check if first item is already an array [text, imageUrl]
            if (optionsData.en.length > 0 && Array.isArray(optionsData.en[0])) {
                // Already in correct format
                return {
                    en: optionsData.en,
                    he: Array.isArray(optionsData.he) ? optionsData.he : [],
                    ar: Array.isArray(optionsData.ar) ? optionsData.ar : []
                };
            } else {
                // Legacy format: simple strings, convert to [text, null]
                return {
                    en: optionsData.en.map(text => [text, null]),
                    he: Array.isArray(optionsData.he) ? optionsData.he.map(text => [text, null]) : [],
                    ar: Array.isArray(optionsData.ar) ? optionsData.ar.map(text => [text, null]) : []
                };
            }
        } else {
            return { en: [], he: [], ar: [] };
        }
    }
    
    // Handle JSON string
    if (isJsonString(optionsData)) {
        const parsed = JSON.parse(optionsData);
        
        if (Array.isArray(parsed)) {
            return {
                en: parsed.map(text => [text, null]),
                he: [],
                ar: []
            };
        } else if (typeof parsed === 'object' && parsed !== null) {
            // Check if already in [text, imageUrl] format
            if (parsed.en && Array.isArray(parsed.en)) {
                // Check if first item is already an array [text, imageUrl]
                if (parsed.en.length > 0 && Array.isArray(parsed.en[0])) {
                    // Already in correct format
                    return {
                        en: parsed.en,
                        he: Array.isArray(parsed.he) ? parsed.he : [],
                        ar: Array.isArray(parsed.ar) ? parsed.ar : []
                    };
                } else {
                    // Legacy format: simple strings, convert to [text, null]
                    return {
                        en: parsed.en.map(text => [text, null]),
                        he: Array.isArray(parsed.he) ? parsed.he.map(text => [text, null]) : [],
                        ar: Array.isArray(parsed.ar) ? parsed.ar.map(text => [text, null]) : []
                    };
                }
            }
        }
        
        return { en: [], he: [], ar: [] };
    }
    
    if (typeof optionsData === 'string') {
        return {
            en: [[optionsData, null]],
            he: [],
            ar: []
        };
    }
    
    if (Array.isArray(optionsData)) {
        return {
            en: optionsData.map(text => [text, null]),
            he: [],
            ar: []
        };
    }
    
    return { en: [], he: [], ar: [] };
}

function isJsonString(str) {
    if (typeof str !== 'string') return false;
    try {
        const result = JSON.parse(str);
        return (typeof result === 'object' || Array.isArray(result)) && result !== null;
    } catch (e) {
        return false;
    }
}

module.exports = {
    getQuestions,
    getQuestionById,
    createQuestion,
    updateQuestion,
    updateQuestionOrder,
    deleteQuestion,
    toggleQuestionStatus,
    uploadImages
};