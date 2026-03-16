// routes/sales/trial-class.routes.js
const express = require('express');
const router = express.Router();
const trialClassController = require('../../controller/sales/trial-class.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

router.post('/create-student', AuthValidator, trialClassController.createStudentOnly);
router.get('/dashboard/metrics', AuthValidator, trialClassController.getDashboardMetrics);
router.get('/dashboard/daily-metrics', AuthValidator, trialClassController.getDailyTrialMetrics);
router.post('/trial-classes', AuthValidator, trialClassController.createTrialClass);
router.get('/trial-classes', AuthValidator, trialClassController.getTrialClasses);
router.get('/trial-classes/:id', AuthValidator, trialClassController.getTrialClassById);
router.put('/trial-classes/:id', AuthValidator, trialClassController.updateTrialClass);
router.delete('/trial-classes/:id', AuthValidator, trialClassController.deleteTrialClass);
router.put('/trial-classes/:id/cancel', AuthValidator, trialClassController.cancelTrialClass);
router.put('/trial-classes/:id/status', AuthValidator, trialClassController.updateTrialClassStatus);
router.post('/trial-classes/check-existing-user', AuthValidator, trialClassController.checkExistingUser);

// Get sales agents for the Move to New Enrollments popup
router.get('/sales-agents', AuthValidator, trialClassController.getSalesAgentsForEnrollment);

// Move a trial class to new enrollment with selected sales agent
router.put('/trial-classes/:id/move-to-enrollment', AuthValidator, trialClassController.moveToNewEnrollment);

module.exports = router;
