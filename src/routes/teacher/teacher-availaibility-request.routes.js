const express = require('express');
const router = express.Router();
const teacherChangeRequest = require('../../controller/teacher/teacher_availaibility_request.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

router.post('/request-change', AuthValidator, teacherChangeRequest.requestScheduleChange);
router.get('/get-teacher-request', AuthValidator, teacherChangeRequest.getTeacherScheduleRequests);
router.post('/preview-schedule-change-impact', AuthValidator, teacherChangeRequest.previewScheduleChangeImpact);

module.exports=router;