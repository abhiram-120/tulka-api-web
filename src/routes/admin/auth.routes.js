// Import required dependencies
const express = require('express');
const authController = require('../../controller/admin/auth.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const router = express.Router();

// Login route - POST request to /admin-login
router.post('/admin-login', authController.loginAdmin);

// Logout route - POST request to /admin-logout
// AuthValidator middleware checks for valid authentication token before allowing logout
router.post('/admin-logout', AuthValidator, authController.logoutAdmin);
router.get('/auth-check', AuthValidator, authController.authCheck);

// Export the router for use in main application
module.exports = router;
