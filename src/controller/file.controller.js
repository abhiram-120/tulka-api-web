const TranslationFile = require('../models/translationFile');
const TranslationWord = require('../models/translationWord');
const { Op, Sequelize } = require('sequelize');

// Get all files for the authenticated user
async function getAllFiles(req, res) {
    try {
        const files = await TranslationFile.findAll({
            where: { user_id: req.userId },
            attributes: [
                'id', 
                'name', 
                'description',
                'is_favorite',
                'practice_session_count', 
                'last_practice',
                'created_at', 
                'updated_at'
            ]
        });

        // Get word counts for each file
        const fileIds = files.map(file => file.id);
        const wordCounts = await TranslationWord.findAll({
            attributes: [
                'file_id',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: {
                file_id: { [Op.in]: fileIds }
            },
            group: ['file_id']
        });

        // Create a map of file_id to count
        const countMap = {};
        wordCounts.forEach(count => {
            countMap[count.file_id] = count.getDataValue('count');
        });

        // Add word_count to each file
        const filesWithCounts = files.map(file => {
            const fileData = file.toJSON();
            fileData.word_count = countMap[file.id] || 0;
            return fileData;
        });

        return res.status(200).json({
            status: 'success',
            message: 'Files retrieved successfully',
            data: filesWithCounts
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get a specific file by ID
async function getFileById(req, res) {
    try {
        const file = await TranslationFile.findOne({
            where: { 
                id: req.params.id,
                user_id: req.userId 
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        // Get word count for this file
        const wordCount = await TranslationWord.count({
            where: { file_id: file.id }
        });

        const fileData = file.toJSON();
        fileData.word_count = wordCount;

        return res.status(200).json({
            status: 'success',
            message: 'File retrieved successfully',
            data: fileData
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Create a new file
async function createFile(req, res) {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({
                status: 'error',
                message: 'Name is required'
            });
        }

        const newFile = await TranslationFile.create({
            name,
            description: description || null,
            user_id: req.userId,
            practice_session_count: 0,
            is_favorite: false
        });

        return res.status(201).json({
            status: 'success',
            message: 'File created successfully',
            data: newFile
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update an existing file
async function updateFile(req, res) {
    try {
        const { name, description } = req.body;
        const { id } = req.params;

        if (!name && description === undefined) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one field (name or description) is required'
            });
        }

        // Find and check ownership of the file
        const file = await TranslationFile.findOne({
            where: { 
                id,
                user_id: req.userId 
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        // Update the file
        const updateData = {};
        if (name) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        updateData.updated_at = new Date();

        await file.update(updateData);

        return res.status(200).json({
            status: 'success',
            message: 'File updated successfully',
            data: file
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Delete a file
async function deleteFile(req, res) {
    try {
        const { id } = req.params;

        // Find and check ownership of the file
        const file = await TranslationFile.findOne({
            where: { 
                id,
                user_id: req.userId 
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        // Delete all associated words
        await TranslationWord.destroy({
            where: { file_id: id }
        });

        // Delete the file
        await file.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'File and all associated words deleted successfully'
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Update practice session count
async function updatePracticeSession(req, res) {
    try {
        const { id } = req.params;

        // Find and check ownership of the file
        const file = await TranslationFile.findOne({
            where: { 
                id,
                user_id: req.userId 
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        // Update practice session count and last_practice
        await file.update({
            practice_session_count: file.practice_session_count + 1,
            last_practice: new Date(),
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Practice session count updated successfully',
            data: file
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Toggle favorite status for files
async function toggleFileFavorite(req, res) {
    try {
        const { id } = req.params;

        // Check file ownership
        const file = await TranslationFile.findOne({
            where: {
                id,
                user_id: req.userId
            }
        });

        if (!file) {
            return res.status(404).json({
                status: 'error',
                message: 'File not found or not authorized'
            });
        }

        // Toggle favorite status
        await file.update({
            is_favorite: !file.is_favorite,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'File favorite status toggled successfully',
            data: file
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get all favorite files
async function getFavoriteFiles(req, res) {
    try {
        const favoriteFiles = await TranslationFile.findAll({
            where: {
                user_id: req.userId,
                is_favorite: true
            },
            attributes: [
                'id', 
                'name', 
                'description',
                'is_favorite',
                'practice_session_count', 
                'last_practice',
                'created_at', 
                'updated_at'
            ],
            order: [['created_at', 'DESC']]
        });

        // Get word counts for each file
        const fileIds = favoriteFiles.map(file => file.id);
        const wordCounts = await TranslationWord.findAll({
            attributes: [
                'file_id',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: {
                file_id: { [Op.in]: fileIds }
            },
            group: ['file_id']
        });

        // Create a map of file_id to count
        const countMap = {};
        wordCounts.forEach(count => {
            countMap[count.file_id] = count.getDataValue('count');
        });

        // Add word_count to each file
        const filesWithCounts = favoriteFiles.map(file => {
            const fileData = file.toJSON();
            fileData.word_count = countMap[file.id] || 0;
            return fileData;
        });

        return res.status(200).json({
            status: 'success',
            message: 'Favorite files retrieved successfully',
            data: filesWithCounts,
            count: filesWithCounts.length
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Filter files by name and other criteria
async function filterFiles(req, res) {
    try {
        const { search, favorites } = req.query;
        
        let whereClause = { user_id: req.userId };
        
        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { description: { [Op.like]: `%${search}%` } }
            ];
        }

        if (favorites === 'true') {
            whereClause.is_favorite = true;
        }

        const files = await TranslationFile.findAll({
            where: whereClause,
            attributes: [
                'id', 
                'name', 
                'description',
                'is_favorite',
                'practice_session_count', 
                'last_practice',
                'created_at', 
                'updated_at'
            ],
            order: [['created_at', 'DESC']]
        });

        // Get word counts for each file
        const fileIds = files.map(file => file.id);
        const wordCounts = await TranslationWord.findAll({
            attributes: [
                'file_id',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: {
                file_id: { [Op.in]: fileIds }
            },
            group: ['file_id']
        });

        // Create a map of file_id to count
        const countMap = {};
        wordCounts.forEach(count => {
            countMap[count.file_id] = count.getDataValue('count');
        });

        // Add word_count to each file
        const filesWithCounts = files.map(file => {
            const fileData = file.toJSON();
            fileData.word_count = countMap[file.id] || 0;
            return fileData;
        });

        return res.status(200).json({
            status: 'success',
            message: 'Files filtered successfully',
            data: filesWithCounts
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
    getAllFiles,
    getFileById,
    createFile,
    updateFile,
    deleteFile,
    updatePracticeSession,
    toggleFileFavorite,
    getFavoriteFiles,
    filterFiles
};