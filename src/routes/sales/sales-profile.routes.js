const express = require('express');
const router = express.Router();
const salesProfileController = require('../../controller/sales/sales-profile.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Sales profile routes
router.get('/', AuthValidator, salesProfileController.getSalesProfile);  // Get profile
router.put('/', AuthValidator, salesProfileController.updateSalesProfile);  // Update profile
router.put('/change-password', AuthValidator, salesProfileController.changeSalesPassword);  // Change password

router.post('/avatar', AuthValidator, salesProfileController.upload.single('avatar'), salesProfileController.uploadSalesAvatar);

module.exports = router;