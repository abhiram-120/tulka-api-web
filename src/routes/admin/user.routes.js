// D:\tulkka-App-V2\tulkka-api-v2\src\routes\admin\user.routes.js
const express = require('express');
const userController = require('../../controller/admin/user.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const { validateUserStore } = require('../../middleware/user-validation');
const ensureUsersAccess = checkPermission('users', 'read');
const ensureUsersCreate = checkPermission('users', 'create');

// These routes will now be under /api/admin/...
router.get('/roles', AuthValidator, ensureUsersAccess, userController.getRoles);
router.get('/roles/:id', AuthValidator, ensureUsersAccess, userController.getRoleById);
router.get('/groups', AuthValidator, ensureUsersAccess, userController.getGroups);
router.get('/groups/:id', AuthValidator, ensureUsersAccess, userController.getGroupById);
router.post('/users', AuthValidator, ensureUsersCreate, validateUserStore, userController.store);



module.exports = router;