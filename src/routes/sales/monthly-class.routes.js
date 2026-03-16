// routes/sales/monthly-class.routes.js
const express = require('express');
const router = express.Router();
const monthlyClassController = require('../../controller/sales/monthly-class.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Monthly class routes
router.post('/monthly-classes', AuthValidator, monthlyClassController.createMonthlyClasses);
router.get('/available-teachers', AuthValidator, monthlyClassController.getAvailableTeachers);
router.get('/weekly-availability', AuthValidator, monthlyClassController.getWeeklyTeacherAvailability);
router.get('/weekly-calendar', AuthValidator, monthlyClassController.getWeeklyCalendarForTeacher);

router.post('/check-availability', AuthValidator, monthlyClassController.checkClassAvailability);
router.post('/find-alternatives', AuthValidator, monthlyClassController.findAlternativeClasses);
router.post('/book-classes', AuthValidator, monthlyClassController.bookClasses);

//checking recurring availability
router.post('/check-recurring-availability', AuthValidator, monthlyClassController.checkRecurringAvailability);

router.get('/teacher/:id', AuthValidator, monthlyClassController.getTeacher);
router.get('/teachers', AuthValidator, monthlyClassController.getAllTeachers);

// Regular Class routes - CORRECT ORDER: specific routes BEFORE parameterized routes
router.get('/regular-classes/export', AuthValidator, monthlyClassController.exportRegularClasses); // SPECIFIC ROUTE FIRST
router.get('/regular-classes', AuthValidator, monthlyClassController.getAllRegularClasses);
router.get('/regular-classes/:id', AuthValidator, monthlyClassController.getRegularClass); // PARAMETERIZED ROUTE LAST
router.delete('/regular-classes/:id', AuthValidator, monthlyClassController.deleteRegularClass);

module.exports = router;