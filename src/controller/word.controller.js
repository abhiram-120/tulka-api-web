const TranslationWord = require('../models/translationWord');
const TranslationFile = require('../models/translationFile');
const { Op } = require('sequelize');

// Get all words for a specific file
async function getWordsByFile(req, res) {
    try {
        const { fileId } = req.params;

        // Verify file ownership
        const file = await TranslationFile.findOne({
            where: {
                id: fileId,
                user_id: req.userId
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        const words = await TranslationWord.findAll({
            where: {
                file_id: fileId,
                user_id: req.userId
            },
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Words retrieved successfully',
            data: words,
            count: words.length
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Add a new word
async function addWord(req, res) {
    try {
        const { original, translation, description, file_id } = req.body;

        if (!original || !translation || !file_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Original word, translation, and file_id are required'
            });
        }

        // Verify file ownership
        const file = await TranslationFile.findOne({
            where: {
                id: file_id,
                user_id: req.userId
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        const newWord = await TranslationWord.create({
            original,
            translation,
            description: description || null,
            file_id,
            user_id: req.userId,
            is_favorite: false
        });

        return res.status(201).json({
            status: 'success',
            message: 'Word added successfully',
            data: newWord
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update an existing word
async function updateWord(req, res) {
    try {
        const { id } = req.params;
        const { original, translation, description } = req.body;

        // Validate input
        if (!original && !translation && description === undefined) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one field (original, translation, or description) is required'
            });
        }

        // Check word ownership
        const word = await TranslationWord.findOne({
            where: {
                id,
                user_id: req.userId
            }
        });

        if (!word) {
            return res.status(404).json({
                status: 'error',
                message: 'Word not found or not authorized'
            });
        }

        // Update fields
        const updateData = {};
        if (original) updateData.original = original;
        if (translation) updateData.translation = translation;
        if (description !== undefined) updateData.description = description;
        updateData.updated_at = new Date();

        await word.update(updateData);

        return res.status(200).json({
            status: 'success',
            message: 'Word updated successfully',
            data: word
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Delete a word
async function deleteWord(req, res) {
    try {
        const { id } = req.params;

        // Check word ownership
        const word = await TranslationWord.findOne({
            where: {
                id,
                user_id: req.userId
            }
        });

        if (!word) {
            return res.status(404).json({
                status: 'error',
                message: 'Word not found or not authorized'
            });
        }

        await word.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Word deleted successfully'
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Toggle favorite status
async function toggleFavorite(req, res) {
    try {
        const { id } = req.params;

        // Check word ownership
        const word = await TranslationWord.findOne({
            where: {
                id,
                user_id: req.userId
            }
        });

        if (!word) {
            return res.status(404).json({
                status: 'error',
                message: 'Word not found or not authorized'
            });
        }

        // Toggle favorite status
        await word.update({
            is_favorite: !word.is_favorite,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Favorite status toggled successfully',
            data: word
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get all favorite words
async function getFavorites(req, res) {
    try {
        const favorites = await TranslationWord.findAll({
            where: {
                user_id: req.userId,
                is_favorite: true
            },
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Favorite words retrieved successfully',
            data: favorites,
            count: favorites.length
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Filter words by search term
async function filterWords(req, res) {
    try {
        const { search, file_id } = req.query;
        
        let whereClause = { user_id: req.userId };
        
        if (file_id) {
            // Verify file ownership
            const file = await TranslationFile.findOne({
                where: {
                    id: file_id,
                    user_id: req.userId
                }
            });

            if (!file) {
                return res.status(404).json({
                    status: 'error',
                    message: 'File not found or not authorized'
                });
            }
            
            whereClause.file_id = file_id;
        }
        
        if (search) {
            whereClause[Op.or] = [
                { original: { [Op.like]: `%${search}%` } },
                { translation: { [Op.like]: `%${search}%` } },
                { description: { [Op.like]: `%${search}%` } }
            ];
        }

        const words = await TranslationWord.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Words filtered successfully',
            data: words,
            count: words.length
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update word performance
async function updateWordPerformance(req, res) {
    try {
        const { id } = req.params;
        const { remembered, success_rate } = req.body;

        // Check word ownership
        const word = await TranslationWord.findOne({
            where: {
                id,
                user_id: req.userId
            }
        });

        if (!word) {
            return res.status(404).json({
                status: 'error',
                message: 'Word not found or not authorized'
            });
        }

        // Update performance fields
        const updateData = {};
        if (typeof remembered === 'boolean') updateData.remembered = remembered;
        if (success_rate !== undefined) updateData.success_rate = success_rate;
        updateData.last_practiced = new Date();
        updateData.updated_at = new Date();

        await word.update(updateData);

        return res.status(200).json({
            status: 'success',
            message: 'Word performance updated successfully',
            data: word
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Filter words by memory status
async function filterByMemoryStatus(req, res) {
    try {
        const { status, file_id } = req.query;
        
        let whereClause = { user_id: req.userId };
        
        if (file_id) {
            // Verify file ownership
            const file = await TranslationFile.findOne({
                where: {
                    id: file_id,
                    user_id: req.userId
                }
            });

            if (!file) {
                return res.status(404).json({
                    status: 'error',
                    message: 'File not found or not authorized'
                });
            }
            
            whereClause.file_id = file_id;
        }
        
        // Apply memory status filters
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
            case 'needsPractice':
                whereClause.success_rate = {[Op.lt]: 60};
                whereClause.remembered = false;
                break;
            case 'recent':
                // Get words practiced in the last 7 days
                whereClause.last_practiced = {
                    [Op.gte]: new Date(new Date() - 7 * 24 * 60 * 60 * 1000)
                };
                break;
            // 'all' or default doesn't need additional filters
        }

        const words = await TranslationWord.findAll({
            where: whereClause,
            order: status === 'recent' ? [['last_practiced', 'DESC']] : [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Words filtered by memory status successfully',
            data: words,
            count: words.length
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
    getWordsByFile,
    addWord,
    updateWord,
    deleteWord,
    toggleFavorite,
    getFavorites,
    filterWords,
    updateWordPerformance,
    filterByMemoryStatus
};