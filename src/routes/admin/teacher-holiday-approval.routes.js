const express = require('express');
const router = express.Router();
const { getAllTeacherHolidays, updateTeacherHolidayStatus, deleteTeacherHoliday } = require('../../controller/admin/teacher-holiday-approval.controller');
const authMiddleware = require('../../middleware/admin-verify-token');

router.get('/holidays', authMiddleware ,getAllTeacherHolidays);
router.put('/holidays/:id/status', authMiddleware ,updateTeacherHolidayStatus);
router.delete('/holidays/:id', authMiddleware ,deleteTeacherHoliday);

module.exports=router;