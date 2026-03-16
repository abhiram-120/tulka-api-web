const express=require('express');
const router=express.Router();
const RiskThreshold=require('../../controller/admin/riskThreshold.controller');

router.get('/get-threshold-values',RiskThreshold.getThresholds);
router.put('/update-threshold-values/:id',RiskThreshold.updateThresholds);
router.post('/create-threshold-values', RiskThreshold.createThresholds);
router.delete('/delete-threshold-values',RiskThreshold.deleteThresholds);

module.exports=router;