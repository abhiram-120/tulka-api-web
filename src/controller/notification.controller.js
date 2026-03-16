/**
 * Notification Controller — Mobile in-app notifications
 * 
 * Endpoints for students to fetch, read, and manage their in-app notifications.
 */
const { Op } = require('sequelize');
const UserNotification = require('../models/UserNotification');
const NotificationRule = require('../models/NotificationRule');

/**
 * GET /notifications
 * Get the current user's in-app notifications (paginated, newest first)
 */
const getNotifications = async (req, res) => {
    try {
        const userId = req.userId;
        const { page = 1, limit = 20, unread_only } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const where = { user_id: userId };
        if (unread_only === 'true') {
            where.is_read = false;
        }

        const { count, rows } = await UserNotification.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset,
            include: [{
                model: NotificationRule,
                as: 'rule',
                attributes: ['id', 'rule_name', 'display_name', 'trigger_type'],
                required: false
            }]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notifications fetched',
            data: {
                notifications: rows,
                total: count,
                page: parseInt(page),
                totalPages: Math.ceil(count / parseInt(limit)),
                unreadCount: await UserNotification.count({ where: { user_id: userId, is_read: false } })
            }
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /notifications/unread-count
 * Get the count of unread notifications for the current user
 */
const getUnreadCount = async (req, res) => {
    try {
        const userId = req.userId;
        const count = await UserNotification.count({
            where: { user_id: userId, is_read: false }
        });

        return res.status(200).json({
            status: 'success',
            data: { unreadCount: count }
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read
 */
const markAsRead = async (req, res) => {
    try {
        const userId = req.userId;
        const notification = await UserNotification.findOne({
            where: { id: req.params.id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ status: 'error', message: 'Notification not found' });
        }

        await notification.update({
            is_read: true,
            read_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification marked as read',
            data: notification
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read for the current user
 */
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.userId;
        const [updatedCount] = await UserNotification.update(
            { is_read: true, read_at: new Date() },
            { where: { user_id: userId, is_read: false } }
        );

        return res.status(200).json({
            status: 'success',
            message: `${updatedCount} notifications marked as read`,
            data: { updatedCount }
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * DELETE /notifications/:id
 * Delete a single notification
 */
const deleteNotification = async (req, res) => {
    try {
        const userId = req.userId;
        const notification = await UserNotification.findOne({
            where: { id: req.params.id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ status: 'error', message: 'Notification not found' });
        }

        await notification.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Notification deleted'
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification
};
