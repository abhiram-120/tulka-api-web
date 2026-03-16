const PracticeMode = require('../models/practiceMode');

// Get all active practice modes
async function getAllModes(req, res) {
    try {
        const modes = await PracticeMode.findAll({
            where: { is_active: true },
            order: [['id', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Practice modes retrieved successfully',
            data: modes
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get a specific practice mode by ID
async function getModeById(req, res) {
    try {
        const { id } = req.params;
        
        const mode = await PracticeMode.findByPk(id);
        
        if (!mode) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice mode not found'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Practice mode retrieved successfully',
            data: mode
        });
    } catch (err) {
        console.log('Error:', err.message || err);
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get a specific practice mode by mode_key
async function getModeByKey(req, res) {
    try {
        const { key } = req.params;
        
        const mode = await PracticeMode.findOne({
            where: { mode_key: key }
        });
        
        if (!mode) {
            return res.status(404).json({
                status: 'error',
                message: 'Practice mode not found'
            });
        }
        
        return res.status(200).json({
            status: 'success',
            message: 'Practice mode retrieved successfully',
            data: mode
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
    getAllModes,
    getModeById,
    getModeByKey
};