const express = require('express');
const router = express.Router();
const AuthValidator = require('../middleware/verify-token');
const notificationController = require('../controller/notification.controller');

// GET all notifications for current user (paginated)
router.get('/', AuthValidator, notificationController.getNotifications);

// GET unread count
router.get('/unread-count', AuthValidator, notificationController.getUnreadCount);

// PATCH mark single notification as read
router.patch('/:id/read', AuthValidator, notificationController.markAsRead);

// PATCH mark all notifications as read
router.patch('/read-all', AuthValidator, notificationController.markAllAsRead);

// DELETE a notification
router.delete('/:id', AuthValidator, notificationController.deleteNotification);

module.exports = router;
