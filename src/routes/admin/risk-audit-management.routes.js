const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const RiskRuleAuditController=require('../../controller/admin/risk-audit-management.controller');

router.get('/get-all-risk-audit',AuthValidator,RiskRuleAuditController.getAllAuditRules);
router.get('/get-Indv-risk-audit/:id',AuthValidator,RiskRuleAuditController.getIndvAuditRule);

module.exports=router;