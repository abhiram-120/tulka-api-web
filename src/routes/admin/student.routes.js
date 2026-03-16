const express = require('express');
const userController = require('../../controller/admin/student.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const ensureStudentsAccess = checkPermission('students', 'read');
const ensureStudentsCreate = checkPermission('students', 'create');
const ensureStudentsUpdate = checkPermission('students', 'update');
const ensureStudentsDelete = checkPermission('students', 'delete');

// These routes will now be under /api/admin/...
router.get('/students', AuthValidator, ensureStudentsAccess, userController.getStudents);
router.get('/details/:id', AuthValidator, ensureStudentsAccess, userController.getStudentDetails);
router.put('/update/:id', AuthValidator, ensureStudentsUpdate, userController.updateStudent); 
router.put('/update-password/:id', AuthValidator, ensureStudentsUpdate, userController.updatePassword);
router.post('/inactivate/:id', AuthValidator, ensureStudentsUpdate, userController.inactivateStudent);
router.post('/activate/:id', AuthValidator, ensureStudentsUpdate, userController.activateStudent);
router.get('/teacher-feedback/:id', AuthValidator, ensureStudentsAccess, userController.getStudentTeacherFeedback);
router.post('/inactivate-subscription/:id', AuthValidator, ensureStudentsUpdate, userController.inactivateSubscription);
router.get('/attendance-statistics', AuthValidator, ensureStudentsAccess, userController.getAttendanceStatistics);
router.get('/progress-statistics', AuthValidator, ensureStudentsAccess, userController.getProgressStatistics);

router.get('/lesson-overview/:id', AuthValidator, ensureStudentsAccess, userController.getLessonOverview);
router.post('/lessons-return/:id', AuthValidator, ensureStudentsUpdate, userController.returnLessons);
router.post('/bonus-lessons/:id', AuthValidator, ensureStudentsUpdate, userController.addBonusLessons);
router.post('/bonus-lessons/:id/expire', AuthValidator, ensureStudentsUpdate, userController.expireBonusLessons);
router.get('/bonus-lessons/:id/history', AuthValidator, ensureStudentsAccess, userController.getBonusLessonHistory);
router.post('/regular-lessons/:id', AuthValidator, ensureStudentsUpdate, userController.addRegularLessons);
router.post('/rollover-lessons/:id', AuthValidator, ensureStudentsUpdate, userController.rolloverLessons);
router.post('/clear-unused-lessons/:id', AuthValidator, ensureStudentsUpdate, userController.clearUnusedLessons);
router.get('/monthly-lesson-stats/:id', AuthValidator, ensureStudentsAccess, userController.getMonthlyLessonStats);
router.put('/rollover-settings/:id', AuthValidator, ensureStudentsUpdate, userController.updateRolloverSettings);
router.get('/get-student-kpi/:id',AuthValidator,ensureStudentsAccess,userController.getStudentKPI);

router.get('/payment-history/:id', AuthValidator, ensureStudentsAccess, userController.getStudentPaymentHistory);
router.get('/payment-stats/:id', AuthValidator, ensureStudentsAccess, userController.getStudentPaymentStats);
router.get('/download-invoice/:id/:transaction_id', AuthValidator, ensureStudentsAccess, userController.downloadStudentInvoice);
router.get('/refund-details/:id/:transaction_id', AuthValidator, ensureStudentsAccess, userController.getRefundDetails);
router.get('/student-graph-trends',AuthValidator, ensureStudentsAccess, userController.getStudentGraphsAndTrends);
router.get('/lesson-activity/export/:id',AuthValidator, ensureStudentsAccess, userController.exportLessonActivityCSV);
router.get('/get-all-teacher',AuthValidator, ensureStudentsAccess, userController.getAllTeachers)
router.patch('/add-prev-lesson/:id',AuthValidator, ensureStudentsAccess, userController.addPrevUnusedLessons)


module.exports = router;