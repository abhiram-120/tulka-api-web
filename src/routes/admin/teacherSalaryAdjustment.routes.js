const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');

const teacherAdjustcontroller = require('../../controller/admin/teacherSalaryAdjustment.controller');

router.get('/teacher/:teacher_id/salary-adjustments', AuthValidator,teacherAdjustcontroller.getTeacherSalaryAdjustments);

module.exports = router;