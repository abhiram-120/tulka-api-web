const express = require('express');
const salesAuthController = require('../../controller/sales/auth.controller');
const AuthValidator = require('../../middleware/sales-verify-token');
const router = express.Router();

router.post('/sales-login', salesAuthController.loginSales);
router.post('/sales-logout', AuthValidator, salesAuthController.logoutSales);
router.get('/auth-check', AuthValidator, salesAuthController.authCheck);

module.exports = router;