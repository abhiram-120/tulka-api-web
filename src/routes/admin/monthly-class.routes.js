// routes/sales/monthly-class.routes.js
const express = require('express');
const router = express.Router();
const monthlyClassController = require('../../controller/admin/monthly-class.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureMonthlyClassesAccess = checkPermission('monthly-classes', 'read');
const ensureMonthlyClassesCreate = checkPermission('monthly-classes', 'create');
const ensureMonthlyClassesUpdate = checkPermission('monthly-classes', 'update');
const ensureMonthlyClassesDelete = checkPermission('monthly-classes', 'delete');

// Monthly class routes
router.post('/monthly-classes', AuthValidator, ensureMonthlyClassesCreate, monthlyClassController.createMonthlyClasses);
router.get('/available-teachers', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getAvailableTeachers);
router.get('/weekly-availability', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getWeeklyTeacherAvailability);
router.get('/weekly-calendar', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getWeeklyCalendarForTeacher);

router.post('/check-availability', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.checkClassAvailability);
router.post('/find-alternatives', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.findAlternativeClasses);
router.post('/book-classes', AuthValidator, ensureMonthlyClassesCreate, monthlyClassController.bookClasses);

//checking recurring availability
router.post('/check-recurring-availability', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.checkRecurringAvailability);

router.get('/teacher/:id', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getTeacher);
router.get('/teachers', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getAllTeachers);

// Regular Class routes - NEW
router.get('/regular-classes/export', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.exportRegularClasses);
router.get('/regular-classes', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getAllRegularClasses);
router.get('/regular-classes/:id', AuthValidator, ensureMonthlyClassesAccess, monthlyClassController.getRegularClass);
router.delete('/regular-classes/:id', AuthValidator, ensureMonthlyClassesDelete, monthlyClassController.deleteRegularClass);

// PUBLIC (no-auth) API for subscriptions renewing within next month
router.get(
    '/regular-classes-next-month/upcoming-renewals/status',
    monthlyClassController.getUpcomingRenewalRegularClassesNextMonthStatusPublic
);
router.post(
    '/regular-classes-next-month/upcoming-renewals/create-missing',
    monthlyClassController.createNextMonthClassesForUpcomingRenewalsPublic
);

module.exports = router;