const  SavedView  = require('../../models/SavedView');

const getSavedViews = async (req, res) => {
    try {
        const { user_id } = req.query; // you can also get from JWT
        const views = await SavedView.findAll({ where: { user_id } });
        res.json({ success: true, data: views });
    } catch (err) {
        console.error('Error fetching saved views:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch saved views' });
    }
};

const createSavedView = async (req, res) => {
    try {
        const { user_id, name, config, is_default } = req.body;

        if (is_default) {
            await SavedView.update({ is_default: false }, { where: { user_id } });
        }

        const view = await SavedView.create({ user_id, name, config, is_default });
        res.json({ success: true, data: view });
    } catch (err) {
        console.error('Error saving view:', err);
        res.status(500).json({ success: false, message: 'Failed to save view' });
    }
};

const deleteSavedView = async (req, res) => {
    try {
        const { id } = req.params;
        await SavedView.destroy({ where: { id } });
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting view:', err);
        res.status(500).json({ success: false, message: 'Failed to delete view' });
    }
};

module.exports = { getSavedViews, createSavedView, deleteSavedView };