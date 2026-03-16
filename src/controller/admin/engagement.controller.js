/**
 * Engagement Controller — Admin CRUD for Notification Rules + Stats
 */
const { Op } = require('sequelize');
const moment = require('moment');
const NotificationRule = require('../../models/NotificationRule');
const NotificationLog = require('../../models/NotificationLog');
const StudentActivity = require('../../models/StudentActivity');
const EngagementNotificationService = require('../../services/engagementNotificationService');

const engagementService = new EngagementNotificationService();

// ============================================================
// NOTIFICATION RULES - CRUD
// ============================================================

/**
 * GET /engagement/rules
 * List all notification rules with optional filters
 */
const getRules = async (req, res) => {
    try {
        const { trigger_type, is_active, page = 1, limit = 50 } = req.query;
        const where = {};

        if (trigger_type) where.trigger_type = trigger_type;
        if (is_active !== undefined) where.is_active = is_active === 'true';

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await NotificationRule.findAndCountAll({
            where,
            order: [['priority', 'ASC'], ['created_at', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification rules fetched successfully',
            data: {
                rules: rows,
                total: count,
                page: parseInt(page),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching notification rules:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /engagement/rules/:id
 * Get a single notification rule by ID
 */
const getRuleById = async (req, res) => {
    try {
        const rule = await NotificationRule.findByPk(req.params.id);

        if (!rule) {
            return res.status(404).json({ status: 'error', message: 'Rule not found' });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Notification rule fetched',
            data: rule
        });
    } catch (error) {
        console.error('Error fetching notification rule:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * POST /engagement/rules
 * Create a new notification rule
 */
const createRule = async (req, res) => {
    try {
        const {
            rule_name, display_name, description, trigger_type,
            is_active, delay_hours, delay_days, channels,
            title_he, title_en, body_he, body_en,
            max_per_day, max_per_week, quiet_start, quiet_end, priority
        } = req.body;

        // Validate required fields
        if (!rule_name || !display_name || !trigger_type) {
            return res.status(400).json({
                status: 'error',
                message: 'rule_name, display_name, and trigger_type are required'
            });
        }

        // Check for duplicate rule_name
        const existing = await NotificationRule.findOne({ where: { rule_name } });
        if (existing) {
            return res.status(409).json({
                status: 'error',
                message: `Rule with name "${rule_name}" already exists`
            });
        }

        const rule = await NotificationRule.create({
            rule_name,
            display_name,
            description: description || '',
            trigger_type,
            is_active: is_active !== undefined ? is_active : true,
            delay_hours: delay_hours || 0,
            delay_days: delay_days || 0,
            channels: channels || ['push'],
            title_he: title_he || '',
            title_en: title_en || '',
            body_he: body_he || '',
            body_en: body_en || '',
            max_per_day: max_per_day || 3,
            max_per_week: max_per_week || 10,
            quiet_start: quiet_start || '22:00:00',
            quiet_end: quiet_end || '08:00:00',
            priority: priority || 5,
            created_at: new Date(),
            updated_at: new Date()
        });

        return res.status(201).json({
            status: 'success',
            message: 'Notification rule created successfully',
            data: rule
        });
    } catch (error) {
        console.error('Error creating notification rule:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PUT /engagement/rules/:id
 * Update a notification rule
 */
const updateRule = async (req, res) => {
    try {
        const rule = await NotificationRule.findByPk(req.params.id);

        if (!rule) {
            return res.status(404).json({ status: 'error', message: 'Rule not found' });
        }

        const allowedFields = [
            'display_name', 'description', 'trigger_type',
            'is_active', 'delay_hours', 'delay_days', 'channels',
            'title_he', 'title_en', 'body_he', 'body_en',
            'max_per_day', 'max_per_week', 'quiet_start', 'quiet_end', 'priority'
        ];

        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        }
        updateData.updated_at = new Date();

        await rule.update(updateData);

        return res.status(200).json({
            status: 'success',
            message: 'Notification rule updated successfully',
            data: rule
        });
    } catch (error) {
        console.error('Error updating notification rule:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * DELETE /engagement/rules/:id
 * Delete a notification rule
 */
const deleteRule = async (req, res) => {
    try {
        const rule = await NotificationRule.findByPk(req.params.id);

        if (!rule) {
            return res.status(404).json({ status: 'error', message: 'Rule not found' });
        }

        await rule.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Notification rule deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting notification rule:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PATCH /engagement/rules/:id/toggle
 * Toggle a rule active/inactive
 */
const toggleRule = async (req, res) => {
    try {
        const rule = await NotificationRule.findByPk(req.params.id);

        if (!rule) {
            return res.status(404).json({ status: 'error', message: 'Rule not found' });
        }

        await rule.update({
            is_active: !rule.is_active,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: `Rule ${rule.is_active ? 'activated' : 'deactivated'} successfully`,
            data: rule
        });
    } catch (error) {
        console.error('Error toggling notification rule:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

// ============================================================
// NOTIFICATION LOGS & STATS
// ============================================================

/**
 * GET /engagement/stats
 * Get notification statistics for admin dashboard
 */
const getStats = async (req, res) => {
    try {
        const stats = await engagementService.getStats();

        return res.status(200).json({
            status: 'success',
            message: 'Engagement stats fetched',
            data: stats
        });
    } catch (error) {
        console.error('Error fetching engagement stats:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /engagement/logs
 * Get notification logs with filters
 */
const getLogs = async (req, res) => {
    try {
        const {
            student_id, rule_id, channel, status,
            from_date, to_date,
            page = 1, limit = 50
        } = req.query;

        const where = {};
        if (student_id) where.student_id = student_id;
        if (rule_id) where.rule_id = rule_id;
        if (channel) where.channel = channel;
        if (status) where.status = status;
        if (from_date || to_date) {
            where.sent_at = {};
            if (from_date) where.sent_at[Op.gte] = new Date(from_date);
            if (to_date) where.sent_at[Op.lte] = new Date(to_date);
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await NotificationLog.findAndCountAll({
            where,
            order: [['sent_at', 'DESC']],
            limit: parseInt(limit),
            offset,
            include: [{
                model: NotificationRule,
                as: 'rule',
                attributes: ['id', 'rule_name', 'display_name', 'trigger_type']
            }]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification logs fetched',
            data: {
                logs: rows,
                total: count,
                page: parseInt(page),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching notification logs:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /engagement/activity
 * Get student activity data for admin
 */
const getStudentActivity = async (req, res) => {
    try {
        const { days_inactive, page = 1, limit = 50 } = req.query;
        const where = {};

        if (days_inactive) {
            const cutoff = moment().subtract(parseInt(days_inactive), 'days').toDate();
            where.last_app_open = { [Op.lte]: cutoff };
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await StudentActivity.findAndCountAll({
            where,
            order: [['last_app_open', 'ASC']],
            limit: parseInt(limit),
            offset
        });

        return res.status(200).json({
            status: 'success',
            message: 'Student activity data fetched',
            data: {
                activities: rows,
                total: count,
                page: parseInt(page),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching student activity:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /engagement/trigger-types
 * Get available trigger types for dropdowns
 */
const getTriggerTypes = async (req, res) => {
    return res.status(200).json({
        status: 'success',
        data: [
            { value: 'post_lesson_feedback', label: 'Post-Lesson: Review Feedback' },
            { value: 'post_lesson_practice', label: 'Post-Lesson: Practice Games' },
            { value: 'inactivity', label: 'Student Inactivity' },
            { value: 'unpracticed_vocab', label: 'Unpracticed Vocabulary' },
            { value: 'unviewed_feedback', label: 'Unviewed Feedback' },
            { value: 'new_practice_available', label: 'New Practice Available' },
        ]
    });
};

module.exports = {
    getRules,
    getRuleById,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    getStats,
    getLogs,
    getStudentActivity,
    getTriggerTypes
};
