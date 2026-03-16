const ActivityLog = require('../../models/activityLogs');
const Penalty = require('../../models/teacherPenalty');

const createPenalty = async (req, res) => {
    try {
        const { penalty_type, amount, description, penalty_month } = req.body;

        if (!penalty_type || !amount) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const resolvedPenaltyMonth = penalty_month || `${now.getFullYear()}-${month}-01`;

        const penalty = await Penalty.create({
            penalty_type: penalty_type.trim(),
            amount,
            description: description || null,
            penalty_month: resolvedPenaltyMonth
        });

        // 🔹 ACTIVITY LOG
        await ActivityLog.create({
            entity_type: 'penalty',
            entity_id: penalty.id,
            action_type: 'penalty_created',
            performed_by: req.userId ?? null,

            before_value: null,

            after_value: {
                penalty_type: penalty.penalty_type,
                amount: penalty.amount,
                penalty_month: penalty.penalty_month
            },

            action: {
                message: 'Penalty created'
            }
        });

        return res.status(201).json({
            status: 'success',
            data: penalty
        });
    } catch (error) {
        console.error('Create Penalty Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create penalty'
        });
    }
};

const getPenalties = async (req, res) => {
    try {
        const { penalty_month, penalty_type } = req.query;

        const where = {};

        if (penalty_month) where.penalty_month = penalty_month;
        if (penalty_type) where.penalty_type = penalty_type;

        const penalties = await Penalty.findAll({
            where,
            order: [
                ['penalty_month', 'DESC'],
                ['created_at', 'DESC']
            ]
        });

        return res.status(200).json({
            status: 'success',
            data: penalties
        });
    } catch (error) {
        console.error('Get Penalties Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch penalties'
        });
    }
};

const getPenaltyById = async (req, res) => {
    try {
        const { id } = req.params;

        const penalty = await Penalty.findByPk(id);

        if (!penalty) {
            return res.status(404).json({
                status: 'error',
                message: 'Penalty not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: penalty
        });
    } catch (error) {
        console.error('Get Penalty Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch penalty'
        });
    }
};

const updatePenalty = async (req, res) => {
    try {
        const { id } = req.params;

        const penalty = await Penalty.findByPk(id);
        if (!penalty) {
            return res.status(404).json({
                status: 'error',
                message: 'Penalty not found'
            });
        }

        const beforeSnapshot = {
            penalty_type: penalty.penalty_type,
            amount: penalty.amount,
            description: penalty.description,
            penalty_month: penalty.penalty_month
        };

        const { penalty_type, amount, description, penalty_month } = req.body;

        await penalty.update({
            penalty_type: penalty_type ?? penalty.penalty_type,
            amount: amount ?? penalty.amount,
            description: description ?? penalty.description,
            penalty_month: penalty_month ?? penalty.penalty_month
        });

        // 🔹 ACTIVITY LOG
        await ActivityLog.create({
            entity_type: 'penalty',
            entity_id: penalty.id,
            action_type: 'penalty_updated',
            performed_by: req.userId ?? null,

            before_value: beforeSnapshot,

            after_value: {
                penalty_type: penalty.penalty_type,
                amount: penalty.amount,
                description: penalty.description,
                penalty_month: penalty.penalty_month
            },

            action: {
                message: 'Penalty updated'
            }
        });

        return res.status(200).json({
            status: 'success',
            data: penalty
        });
    } catch (error) {
        console.error('Update Penalty Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update penalty'
        });
    }
};

const deletePenalty = async (req, res) => {
    try {
        const { id } = req.params;

        const penalty = await Penalty.findByPk(id);
        if (!penalty) {
            return res.status(404).json({
                status: 'error',
                message: 'Penalty not found'
            });
        }

        const beforeSnapshot = {
            penalty_type: penalty.penalty_type,
            amount: penalty.amount,
            description: penalty.description,
            penalty_month: penalty.penalty_month
        };

        await penalty.destroy();

        // 🔹 ACTIVITY LOG
        await ActivityLog.create({
            entity_type: 'penalty',
            entity_id: id,
            action_type: 'penalty_deleted',
            performed_by: req.userId ?? null,

            before_value: beforeSnapshot,

            after_value: null,

            action: {
                message: 'Penalty deleted'
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Penalty deleted successfully'
        });
    } catch (error) {
        console.error('Delete Penalty Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete penalty'
        });
    }
};

module.exports = {
    createPenalty,
    getPenalties,
    getPenaltyById,
    updatePenalty,
    deletePenalty
};
