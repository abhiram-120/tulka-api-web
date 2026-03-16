// routes/teacher/classes.routes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../../controller/teacher/dashboard.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Teacher dashboard and class routes
router.get('/dashboard', AuthValidator, dashboardController.getTeacherDashboard);
router.get('/upcoming', AuthValidator, dashboardController.getUpcomingClasses);
router.get('/completed', AuthValidator, dashboardController.getCompletedClasses);
router.get('/class/:id', AuthValidator, dashboardController.getClassDetails);
router.get('/today', AuthValidator, dashboardController.getTodayClasses);

router.get('/weekly-calendar', AuthValidator, dashboardController.getWeeklyCalendar);
router.get('/class/:id/queries', AuthValidator, dashboardController.getClassQueries);
router.get('/class-query-attachment/:id', AuthValidator, dashboardController.downloadClassQueryAttachment);
router.get('/pending-tasks', AuthValidator, dashboardController.getPendingTasks);

module.exports = router;