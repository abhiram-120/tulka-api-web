const express=require('express');
const router=express.Router();
const RiskTableController=require('../../controller/admin/riskTable.controller');

router.get('/get-risk-table',RiskTableController.getRiskTable);
router.post('/update-contact-status',RiskTableController.updateContactStatus);
router.get('/export', RiskTableController.exportRiskTableCSV);
router.put('/update-assigned-rep',RiskTableController.updateAssignedRep);

module.exports=router;