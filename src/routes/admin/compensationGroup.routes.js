const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const compensationGroupController = require('../../controller/admin/compensationGroup.controller');

router.post('/create-compensation-group',AuthValidator, compensationGroupController.createCompensationGroup);
router.get('/get-compensation-group',AuthValidator, compensationGroupController.getCompensationGroups);
router.put('/update-compensation-group/:id',AuthValidator, compensationGroupController.updateCompensationGroup);
router.delete('/delete-compensation-group/:id',AuthValidator, compensationGroupController.deleteCompensationGroup);

module.exports = router;