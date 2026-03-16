const RiskRulesAudit = require('../../models/RiskRulesAudit');

const getAllAuditRules = async (req, res) => {
    try {
        const history = await RiskRulesAudit.findAll({
            order: [['created_at', 'DESC']]
        });
        return res.status(200).json({
            success: true,
            data: history
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

const getIndvAuditRule = async (req, res) => {
    try {
        const { id } = req.params;
        const rule = await RiskRulesAudit.findAll({ where: { id } });
        if (!rule) {
            return res.status(401).json({ success: false, data: 'Rule Not Found' });
        }
        return res.status(200).json({
            success: true,
            data: rule
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

module.exports = { getAllAuditRules, getIndvAuditRule };
