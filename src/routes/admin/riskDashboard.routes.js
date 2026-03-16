const express = require('express');
const router = express.Router();
const RiskDashboardController=require('../../controller/admin/riskDashboard.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureStudentAtRiskAccess = checkPermission('student-at-risk', 'read');

router.get('/get-risk-dashboard', AuthValidator, ensureStudentAtRiskAccess, RiskDashboardController.getRiskDashboard);

module.exports=router;