// routes/admin/trial-management.routes.js
const express = require('express');
const router = express.Router();
const adminTrialController = require('../../controller/admin/trial-management.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureTrialManagementAccess = checkPermission('trial-management', 'read');
const ensureTrialManagementUpdate = checkPermission('trial-management', 'update');
const ensureTrialManagementDelete = checkPermission('trial-management', 'delete');

// Dashboard metrics routes
router.get('/dashboard-metrics', AuthValidator, ensureTrialManagementAccess, adminTrialController.getDashboardMetrics);
router.get('/daily-metrics', AuthValidator, ensureTrialManagementAccess, adminTrialController.getDailyTrialMetrics);

// Trial class management routes
router.get('/trial-lessons', AuthValidator, ensureTrialManagementAccess, adminTrialController.getTrialLessons);
router.get('/trial-completion', AuthValidator, ensureTrialManagementAccess, adminTrialController.getTrialCompletion);
router.get('/trial-classes', AuthValidator, ensureTrialManagementAccess, adminTrialController.getTrialClasses);
router.get('/trial-classes/:id', AuthValidator, ensureTrialManagementAccess, adminTrialController.getTrialClassById);
router.put('/trial-classes/:id', AuthValidator, ensureTrialManagementUpdate, adminTrialController.updateTrialClass);
router.delete('/trial-classes/:id', AuthValidator, ensureTrialManagementDelete, adminTrialController.deleteTrialClass);
router.put('/trial-classes/:id/status', AuthValidator, ensureTrialManagementUpdate, adminTrialController.updateTrialClassStatus);
router.put('/trial-classes/:id/cancel', AuthValidator, ensureTrialManagementUpdate, adminTrialController.cancelTrialClass);
router.get('/get-all-sales-agent',AuthValidator, ensureTrialManagementAccess, adminTrialController.getAllSalesAgent);
router.get('/get-all-trial-setter',AuthValidator, ensureTrialManagementAccess, adminTrialController.getAllTrialSetters);

module.exports = router;