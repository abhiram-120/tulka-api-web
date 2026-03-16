// routes/sales/regular-class.routes.js
const express = require('express');
const router = express.Router();
const regularClassController = require('../../controller/sales/regular-class.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Regular class routes
router.post('/regular-classes', AuthValidator, regularClassController.createRegularClass);
router.get('/regular-classes', AuthValidator, regularClassController.getRegularClasses);
router.get('/regular-classes/:id', AuthValidator, regularClassController.getRegularClassById);
router.put('/regular-classes/:id', AuthValidator, regularClassController.updateRegularClass);
router.post('/regular-classes/:id/cancel', AuthValidator, regularClassController.cancelRegularClass);
router.get('/regular-classes/student/stats', AuthValidator, regularClassController.getStudentClassStats);
router.get('/regular-classes/teacher/schedule', AuthValidator, regularClassController.getTeacherSchedule);

module.exports = router;