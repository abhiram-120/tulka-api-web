// routes/admin/webhook.routes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../../controller/admin/webhook.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { handlePayPlusWebhook } = require('../../controller/admin/payplus-webhook.controller');

// Execute zoom recording webhook
router.post('/zoom-recording', AuthValidator, webhookController.executeZoomRecordingWebhook);

// Theme management routes - ADD THESE NEW ROUTES
router.get('/theme-colors', AuthValidator, webhookController.getThemeColors);
router.put('/theme-colors', AuthValidator, webhookController.updateThemeColors);
router.post('/payplus', AuthValidator,handlePayPlusWebhook);


module.exports = router;