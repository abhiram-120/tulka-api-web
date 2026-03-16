const express = require('express');
const dashboardController = require('../../controller/admin/dashboard.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const ensureDashboardAccess = checkPermission('dashboard', 'read');

// Dashboard metrics routes
router.get('/get-all-teacher', AuthValidator, ensureDashboardAccess, dashboardController.getAllTeachers);
router.get('/get-all-payment-source', AuthValidator, ensureDashboardAccess, dashboardController.getPaymentSources);
router.get('/metrics', AuthValidator, ensureDashboardAccess, dashboardController.getDashboardMetrics);
router.get('/revenue-chart', AuthValidator, ensureDashboardAccess, dashboardController.getRevenueChart);
router.get('/activity-chart', AuthValidator, ensureDashboardAccess, dashboardController.getActivityChart);
router.get('/recent-activity', AuthValidator, ensureDashboardAccess, dashboardController.getRecentActivity);
router.get('/get-lifetime-distribution', AuthValidator, ensureDashboardAccess, dashboardController.getCustomerLifetimeDistribution);
router.get('/get-ltv', AuthValidator, ensureDashboardAccess, dashboardController.getLtvOverTime);
router.get('/get-ltv-by-planType', AuthValidator, ensureDashboardAccess, dashboardController.getLtvByPlanType);
router.get('/get-cohort-retention', AuthValidator, ensureDashboardAccess, dashboardController.refreshCohortRetention);

module.exports = router;