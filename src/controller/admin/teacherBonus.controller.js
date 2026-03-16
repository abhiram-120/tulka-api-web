const ActivityLog = require("../../models/activityLogs");
const Bonus = require("../../models/teacherBonus");

const createBonus = async (req, res) => {
  try {
    const { bonus_type, amount, description } = req.body;

    if (!bonus_type || amount == null) {
      return res.status(400).json({
        status: 'error',
        message: 'bonus_type and amount are required'
      });
    }

    const bonus = await Bonus.create({
      bonus_type: bonus_type.trim(),
      amount: Number(amount),
      description: description || null
    });

    // 🔹 ACTIVITY LOG
    await ActivityLog.create({
      entity_type: 'bonus',
      entity_id: bonus.id,
      action_type: 'bonus_created',
      performed_by: req.userId ?? null,

      before_value: null,

      after_value: {
        bonus_type: bonus.bonus_type,
        amount: bonus.amount,
        description: bonus.description
      },

      action: {
        message: 'Bonus created'
      }
    });

    return res.status(201).json({
      status: 'success',
      data: bonus
    });
  } catch (error) {
    console.error('Create Bonus Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to create bonus'
    });
  }
};

const getBonuses = async (req, res) => {
  try {
    const { page = 1, limit = 10, bonus_type } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const where = {};
    if (bonus_type) where.bonus_type = bonus_type;

    const { rows, count } = await Bonus.findAndCountAll({
      where,
      limit: Number(limit),
      offset,
      order: [['created_at', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: rows,
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(count / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get Bonuses Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch bonuses'
    });
  }
};

const getBonusById = async (req, res) => {
  try {
    const { id } = req.params;

    const bonus = await Bonus.findByPk(id);

    if (!bonus) {
      return res.status(404).json({
        status: 'error',
        message: 'Bonus not found'
      });
    }

    return res.status(200).json({
      status: 'success',
      data: bonus
    });
  } catch (error) {
    console.error('Get Bonus Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch bonus'
    });
  }
};

const updateBonus = async (req, res) => {
  try {
    const { id } = req.params;
    const { bonus_type, amount, description } = req.body;

    const bonus = await Bonus.findByPk(id);

    if (!bonus) {
      return res.status(404).json({
        status: 'error',
        message: 'Bonus not found'
      });
    }

    const beforeSnapshot = {
      bonus_type: bonus.bonus_type,
      amount: bonus.amount,
      description: bonus.description
    };

    await bonus.update({
      bonus_type: bonus_type ?? bonus.bonus_type,
      amount: amount != null ? Number(amount) : bonus.amount,
      description: description ?? bonus.description
    });

    // 🔹 ACTIVITY LOG
    await ActivityLog.create({
      entity_type: 'bonus',
      entity_id: bonus.id,
      action_type: 'bonus_updated',
      performed_by: req.userId ?? null,

      before_value: beforeSnapshot,

      after_value: {
        bonus_type: bonus.bonus_type,
        amount: bonus.amount,
        description: bonus.description
      },

      action: {
        message: 'Bonus updated'
      }
    });

    return res.status(200).json({
      status: 'success',
      data: bonus
    });
  } catch (error) {
    console.error('Update Bonus Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update bonus'
    });
  }
};

const deleteBonus = async (req, res) => {
  try {
    const { id } = req.params;

    const bonus = await Bonus.findByPk(id);

    if (!bonus) {
      return res.status(404).json({
        status: 'error',
        message: 'Bonus not found'
      });
    }

    const beforeSnapshot = {
      bonus_type: bonus.bonus_type,
      amount: bonus.amount,
      description: bonus.description
    };

    await bonus.destroy();

    // 🔹 ACTIVITY LOG
    await ActivityLog.create({
      entity_type: 'bonus',
      entity_id: id,
      action_type: 'bonus_deleted',
      performed_by: req.userId ?? null,

      before_value: beforeSnapshot,
      after_value: null,

      action: {
        message: 'Bonus deleted'
      }
    });

    return res.status(200).json({
      status: 'success',
      message: 'Bonus deleted successfully'
    });
  } catch (error) {
    console.error('Delete Bonus Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to delete bonus'
    });
  }
};

module.exports = {
  createBonus,
  getBonuses,
  getBonusById,
  updateBonus,
  deleteBonus
};
