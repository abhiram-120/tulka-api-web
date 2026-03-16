const express = require('express');
const router = express.Router();
const paymentController = require('../../controller/admin/payment-transactions.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensurePaymentsAccess = checkPermission('payments', 'read');
const ensurePaymentsUpdate = checkPermission('payments', 'update');

// Get payment transaction list with optional filtering
router.get('/list', AuthValidator, ensurePaymentsAccess, paymentController.getPaymentTransactions);

// Get payment statistics
router.get('/statistics', AuthValidator, ensurePaymentsAccess, paymentController.getPaymentStatistics);

// Get payment filters options
router.get('/filters', AuthValidator, ensurePaymentsAccess, paymentController.getPaymentFilters);

// Export payment transactions to Excel/CSV   
router.get('/export', AuthValidator, ensurePaymentsAccess, paymentController.exportPaymentTransactions);

// Get specific payment transaction by ID
router.get('/:id', AuthValidator, ensurePaymentsAccess, paymentController.getPaymentTransactionById);

// Update payment transaction status
router.put('/:id/status', AuthValidator, ensurePaymentsUpdate, paymentController.updatePaymentStatus);

// Process refund for payment transaction
router.post('/:id/refund', AuthValidator, ensurePaymentsUpdate, paymentController.processRefund);

// Download invoice for a specific payment transaction
router.get('/:id/download-invoice', AuthValidator, ensurePaymentsAccess, paymentController.downloadInvoice);

// Download credit invoice for a refunded payment transaction
router.get('/:id/download-credit-invoice', AuthValidator, ensurePaymentsAccess, paymentController.downloadCreditInvoice);

// Get payment history for a specific student
router.get('/student/:studentId/history', AuthValidator, ensurePaymentsAccess, paymentController.getStudentPaymentHistory);

router.post('/:id/enhanced-refund', AuthValidator, ensurePaymentsUpdate, paymentController.processEnhancedRefund);

router.get('/student/:studentId/lesson-data', AuthValidator, ensurePaymentsAccess, paymentController.getStudentLessonData);

// Maintenance (March 2026 payment lesson config fix) - NO AUTH:
// GET  - dry-run, list affected payments
// POST - apply changes (update PaymentTransaction.lessons_per_month, lesson_minutes)
router.get(
    '/maintenance/march-2026-payment-lessons',
    paymentController.getMarch2026PaymentLessonFix
);

router.post(
    '/maintenance/march-2026-payment-lessons/fix',
    paymentController.fixMarch2026PaymentLessonConfig
);

// Maintenance (upcoming month subscription fix from payments) - NO AUTH:
// GET  - dry-run, list subscriptions where subscription config != payment config
// POST - apply changes (update subscription.weekly_lesson, subscription.lesson_min)
router.get(
    '/maintenance/upcoming-subscription-from-payments',
    paymentController.getUpcomingMonthSubscriptionFixFromPayments
);

router.post(
    '/maintenance/upcoming-subscription-from-payments/fix',
    paymentController.fixUpcomingMonthSubscriptionFromPayments
);

module.exports = router;