const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const RiskRuleController = require('../../controller/admin/risk-management.controller');
const ensureStudentAtRiskAccess = checkPermission('student-at-risk', 'read');
const ensureStudentAtRiskCreate = checkPermission('student-at-risk', 'create');
const ensureStudentAtRiskUpdate = checkPermission('student-at-risk', 'update');
const ensureStudentAtRiskDelete = checkPermission('student-at-risk', 'delete');

//? Risk Rule Controllers

router.post('/createRule', AuthValidator, ensureStudentAtRiskCreate, RiskRuleController.setRiskRules);
router.put('/updateRule/:id', AuthValidator, ensureStudentAtRiskUpdate, RiskRuleController.updateRiskRules);
router.get('/getAllRules', AuthValidator, ensureStudentAtRiskAccess, RiskRuleController.getRiskRules);
router.delete('/deleteRule/:id', AuthValidator, ensureStudentAtRiskDelete, RiskRuleController.deleteRule);

module.exports = router;
