const express = require('express');
const groupUserController = require('../../controller/admin/group-user.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { validateGroupUserStore } = require('../../middleware/group-user-validation');
const router = express.Router();

// These routes will be under /api/admin/group-users/...
router.get('/', AuthValidator, groupUserController.getGroupUsers);
router.get('/group/:groupId', AuthValidator, groupUserController.getGroupUsersByGroupId);
router.post('/', AuthValidator, validateGroupUserStore, groupUserController.store);
router.delete('/:group_id/:user_id', AuthValidator, groupUserController.destroy);

module.exports = router;