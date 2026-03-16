const express = require('express');
const router = express.Router();
const adminProfileController = require('../../controller/admin/admin-profile.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Sales profile routes
router.get('/', AuthValidator, adminProfileController.getAdminProfile);  // Get profile
router.put('/', AuthValidator, adminProfileController.updateAdminProfile);  // Update profile
router.put('/change-password', AuthValidator, adminProfileController.changeAdminPassword);  // Change password

router.post('/avatar', AuthValidator, adminProfileController.upload.single('avatar'), adminProfileController.uploadAdminAvatar);

module.exports = router;