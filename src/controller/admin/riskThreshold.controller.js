const RiskTable = require('../../models/riskTable.model');
const RiskThresholds = require('../../models/riskThresholds.model');

// 🧠 Get current thresholds
const getThresholds = async (req, res) => {
  try {
    const thresholds = await RiskThresholds.findOne({ order: [['id', 'DESC']] });
    if (!thresholds) {
      return res.status(200).json({
        success: true,
        message: "No custom thresholds found. Using defaults.",
        data: { critical: 100, high: 70, medium: 40, low : 20 },
      });
    }
    res.status(200).json({ success: true, data: thresholds });
  } catch (error) {
    console.error('❌ Error fetching thresholds:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🧱 Create new thresholds (admin)
const createThresholds = async (req, res) => {
  try {
    const { critical, high, medium, low } = req.body;
    const newThresholds = await RiskThresholds.create({ critical, high, medium,low });
    res.status(201).json({ success: true, data: newThresholds });
  } catch (error) {
    console.error('❌ Error creating thresholds:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🧩 Update existing thresholds
const updateThresholds = async (req, res) => {
    try {
        const { id } = req.params;
        const { critical, high, medium, low } = req.body;

        const record = await RiskThresholds.findByPk(id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Threshold record not found' });
        }

        await record.update({ critical, high, medium, low });
        // 🔥 Recalculate ALL risk_table rows after updating thresholds
        const allRisks = await RiskTable.findAll();

        for (const riskRow of allRisks) {
            const score = riskRow.risk_score;

            let newLevel = 'low';
            if (score >= critical) newLevel = 'critical';
            else if (score >= high) newLevel = 'high';
            else if (score >= medium) newLevel = 'medium';

            if (newLevel !== riskRow.risk_level) {
                await riskRow.update({ risk_level: newLevel });
            }
        }
        res.status(200).json({ success: true, data: record });
    } catch (error) {
        console.error('❌ Error updating thresholds:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🗑️ Delete thresholds
const deleteThresholds = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await RiskThresholds.findByPk(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    await record.destroy();
    res.status(200).json({ success: true, message: 'Threshold deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting thresholds:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getThresholds,
  createThresholds,
  updateThresholds,
  deleteThresholds,
};
