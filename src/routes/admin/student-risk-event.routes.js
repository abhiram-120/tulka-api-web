const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/admin-verify-token');
const StudentRiskEvent=require('../../controller/admin/risk-events.controller');

router.post('/create-student-risk-event',authMiddleware,StudentRiskEvent.createManualEvent);

module.exports=router;