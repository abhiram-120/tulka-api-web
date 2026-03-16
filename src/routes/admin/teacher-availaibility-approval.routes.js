const express = require('express');
const router = express.Router();
const teacherChangeRequest = require('../../controller/admin/teacher-availaibility-approval.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

router.get('/get-request-grid', AuthValidator, teacherChangeRequest.getScheduleChangeRequests);
router.patch('/update-request-change/:id', AuthValidator, teacherChangeRequest.handleScheduleChangeAction);
router.get('/preview-impact/:id', AuthValidator, teacherChangeRequest.previewRequestImpact); // NEW ROUTE

module.exports=router;