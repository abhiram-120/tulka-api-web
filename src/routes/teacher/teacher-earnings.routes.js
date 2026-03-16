const express = require('express');
const router = express.Router();
const teacherEarningController = require('../../controller/teacher/teacher-earnings.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

router.get('/kpis', AuthValidator,teacherEarningController.getTeacherKpis);
router.get('/earning-overview', AuthValidator,teacherEarningController.getTeacherEarningsOverview);
router.get('/earning-history', AuthValidator,teacherEarningController.getTeacherEarningHistory);
router.get('/earning-weekly', AuthValidator,teacherEarningController.getWeeklyEarningSummary);
router.get('/earning-history-export', AuthValidator,teacherEarningController.exportTeacherEarningHistory);
router.get('/bonus-target', AuthValidator,teacherEarningController.getTeacherBonusTarget);

module.exports = router;
