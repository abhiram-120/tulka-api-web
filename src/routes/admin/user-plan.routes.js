const express = require('express');
const router = express.Router();
const userPlanController = require('../../controller/admin/user-plan.controller');
const churnAnalysisController = require('../../controller/admin/churn-analysis.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureUserPlanAccess = checkPermission('user-plan', 'read');
const ensureUserPlanCreate = checkPermission('user-plan', 'create');
const ensureUserPlanUpdate = checkPermission('user-plan', 'update');
const ensureUserPlanDelete = checkPermission('user-plan', 'delete');


// Analytics endpoint
router.get('/churn-analysis/analytics', 
    AuthValidator, 
    ensureUserPlanAccess, 
    churnAnalysisController.getChurnAnalytics
);

router.get('/churn-analysis/teacher-churn-summary', 
    AuthValidator, 
    ensureUserPlanAccess, 
    churnAnalysisController.getTeacherChurnSummary
);

// Student non-renewals endpoint
router.get('/churn-analysis/student-non-renewals', 
    AuthValidator, 
    ensureUserPlanAccess, 
    churnAnalysisController.getStudentNonRenewals
);

// Export student non-renewals to CSV (with filters, no pagination)
router.get('/churn-analysis/student-non-renewals/export', 
    AuthValidator, 
    ensureUserPlanAccess, 
    churnAnalysisController.exportStudentNonRenewalsCSV
);

// Teacher churn details
router.get('/churn-analysis/teacher/:teacherId', 
    AuthValidator, 
    ensureUserPlanAccess, 
    churnAnalysisController.getTeacherChurnDetails
);


router.get('/analytics/data', AuthValidator, ensureUserPlanAccess, userPlanController.getUserPlanAnalytics);

// Get users for dropdown
router.get('/users/dropdown', AuthValidator, ensureUserPlanAccess, userPlanController.getUsersForDropdown);

// Get user plans overview stats
router.get('/overview/stats', AuthValidator, ensureUserPlanAccess, userPlanController.getOverviewStats);

// User plan list with filtering and pagination
router.get('/list', AuthValidator, ensureUserPlanAccess, userPlanController.getUserPlans);

// User plan list CSV Export with filtering and pagination
router.get('/export',AuthValidator, ensureUserPlanAccess, userPlanController.exportUserPlansCSV);

// Get specific user plan details
router.get('/:id', AuthValidator, ensureUserPlanAccess, userPlanController.getUserPlanById);

// Check recurring payment status for a user plan
router.get('/:id/recurring-status', AuthValidator, ensureUserPlanAccess, userPlanController.checkRecurringPaymentStatus);

// Create new user plan
router.post('/', AuthValidator, ensureUserPlanCreate, userPlanController.createUserPlan);

// Update user plan (regular update without PayPlus)
router.put('/:id', AuthValidator, ensureUserPlanUpdate, userPlanController.updateUserPlan);

// Update user plan with PayPlus integration
router.put('/:id/update-with-payplus', AuthValidator, ensureUserPlanUpdate, userPlanController.updateUserPlanWithPayPlus);

// Update PayPlus recurring payment amount directly
router.post('/:id/payplus-recurring', AuthValidator, ensureUserPlanUpdate, userPlanController.updatePayPlusRecurringPayment);


// Delete user plan
router.delete('/:id', AuthValidator, ensureUserPlanDelete, userPlanController.deleteUserPlan);

// Download invoice
router.get('/:id/invoice', AuthValidator, ensureUserPlanAccess, userPlanController.downloadUserPlanInvoice);

// Bonus class specific routes
router.post('/:id/refresh-bonus', AuthValidator, ensureUserPlanUpdate, userPlanController.refreshBonusClasses);
router.get('/:id/bonus-history', AuthValidator, ensureUserPlanAccess, userPlanController.getBonusClassHistory);

// Calculate price from database
router.post('/calculate-price', AuthValidator, ensureUserPlanAccess, userPlanController.calculatePriceFromDatabase);

// Maintenance (March 2026 plan mismatch) - NO AUTHENTICATION:
// GET  - dry-run, list affected subscriptions
// POST - apply changes (update weekly_lesson, lesson_min, left_lessons)
router.get(
    '/maintenance/march-2026-plan-mismatch',
    userPlanController.getMarch2026OnlineSubscriptionsPlanMismatch
);

router.post(
    '/maintenance/march-2026-plan-mismatch/fix',
    userPlanController.fixMarch2026OnlineSubscriptionsPlanMismatch
);

module.exports = router;