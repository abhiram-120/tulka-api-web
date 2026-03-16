const express = require('express');
const router = express.Router();
const tranzilaNotificationController = require('../../controller/admin/tranzila-notifications.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Get notification list with optional filtering
router.get('/list', AuthValidator, tranzilaNotificationController.getTranzilaNotifications);

// Get notification statistics
router.get('/statistics', AuthValidator, tranzilaNotificationController.getNotificationStatistics);

// Get notification filters options
router.get('/filters', AuthValidator, tranzilaNotificationController.getNotificationFilters);

// Get specific notification by ID
router.get('/:id', AuthValidator, tranzilaNotificationController.getTranzilaNotificationById);

// Retry processing a notification
router.post('/:id/retry', AuthValidator, tranzilaNotificationController.retryNotificationProcessing);

// Update notification status manually
router.put('/:id/status', AuthValidator, tranzilaNotificationController.updateNotificationStatus);

module.exports = router;