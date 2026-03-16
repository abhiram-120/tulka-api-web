// routes/admin/teacher.routes.js (Updated with regular class activity routes)
const express = require('express');
const teacherController = require('../../controller/admin/teacher.controller');
const teacherActivityController = require('../../controller/admin/teacher-activity.controller');
const regularClassActivityController = require('../../controller/admin/regular-class-activity.controller'); // NEW
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const ensureTeachersAccess = checkPermission('teachers', 'read');
const ensureTeachersUpdate = checkPermission('teachers', 'update');

// Teacher management routes
router.get('/teachers', AuthValidator, ensureTeachersAccess, teacherController.getTeachers);
router.get('/details/:id', AuthValidator, ensureTeachersAccess, teacherController.getTeacherDetails);
router.put('/update/:id', AuthValidator, ensureTeachersUpdate, teacherController.updateTeacher);
router.put('/update-password/:id', AuthValidator, ensureTeachersUpdate, teacherController.updatePassword);
router.post('/inactivate/:id', AuthValidator, ensureTeachersUpdate, teacherController.inactivateTeacher);
router.post('/activate/:id', AuthValidator, ensureTeachersUpdate, teacherController.activateTeacher);

// Teacher availability routes
router.get('/availability/:id', AuthValidator, ensureTeachersAccess, teacherController.getTeacherAvailability);
router.put('/availability/:id', AuthValidator, ensureTeachersUpdate, teacherController.updateTeacherAvailability);

// Teacher holiday routes
router.get('/holidays/:id', AuthValidator, ensureTeachersAccess, teacherController.getTeacherHolidays);
router.post('/holidays/:id', AuthValidator, ensureTeachersUpdate, teacherController.createHoliday);
router.put('/holidays/:id/:holidayId', AuthValidator, ensureTeachersUpdate, teacherController.updateHolidayStatus);

// Teacher students routes
router.get('/students/:id/:studentId', AuthValidator, ensureTeachersAccess, teacherController.getTeacherStudentDetails);
router.get('/students/:id', AuthValidator, ensureTeachersAccess, teacherController.getTeacherStudents);

// Teacher metrics routes
router.get('/metrics/:id', AuthValidator, ensureTeachersAccess, teacherController.getTeacherMetrics);

// Admin dashboard metrics routes
router.get('/on-holiday', AuthValidator, ensureTeachersAccess, teacherController.getTeachersOnHoliday);
router.get('/absent-late', AuthValidator, ensureTeachersAccess, teacherController.getAbsentLateTeachers);

// Teacher reviews routes
router.get('/dashboard-analytics', AuthValidator, ensureTeachersAccess, teacherController.getTeacherDashboardAnalytics);
router.get('/top-performers', AuthValidator, ensureTeachersAccess, teacherController.getTopPerformingTeachers);

//Analysis period routes
router.get('/dashboard-kpis', AuthValidator, ensureTeachersAccess, teacherActivityController.getTeacherDashboardKPIs);

//Monthly Performance trends
router.get('/monthly-performance-trends', AuthValidator, ensureTeachersAccess, teacherActivityController.getMonthlyPerformanceTrends);

// NEW: Teacher Activity routes
router.get('/teacher-activity', AuthValidator, ensureTeachersAccess, teacherActivityController.getTeacherActivity);
router.get('/teacher-activity/export', AuthValidator, ensureTeachersAccess, teacherActivityController.exportTeacherActivity);
router.get('/teacher-activity/details', AuthValidator, ensureTeachersAccess, teacherActivityController.getTeacherActivityDetails);

// NEW: Regular Class Activity routes
router.get('/regular-class-activity', AuthValidator, ensureTeachersAccess, regularClassActivityController.getRegularClassActivity);
router.get('/regular-class-activity/export', AuthValidator, ensureTeachersAccess, regularClassActivityController.exportRegularClassActivity);
router.get('/regular-class-dashboard-kpis', AuthValidator, ensureTeachersAccess, regularClassActivityController.getRegularClassDashboardKPIs);
router.get('/regular-class-activity/details', AuthValidator, ensureTeachersAccess, regularClassActivityController.getRegularClassActivityDetails);

module.exports = router;