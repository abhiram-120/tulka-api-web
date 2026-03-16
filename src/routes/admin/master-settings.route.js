const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const masterSettingsController = require('../../controller/admin/master-settings.controller');
const ensureMasterSettingsAccess = checkPermission('master-settings', 'read');
const ensureMasterSettingsUpdate = checkPermission('master-settings', 'update');

// GET current settings
router.get('/master-settings', AuthValidator, ensureMasterSettingsAccess, masterSettingsController.getThemeColors);

// POST update settings
router.post('/master-settings', AuthValidator, ensureMasterSettingsUpdate, masterSettingsController.updateThemeColors);

// POST immediate file upload to S3
router.post('/upload-file', AuthValidator, ensureMasterSettingsUpdate, masterSettingsController.uploadFileToS3);

module.exports = router;
