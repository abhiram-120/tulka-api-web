const express = require('express');
const router = express.Router();
const failedPaymentsController = require('../controller/admin/failed-payments.controller');
const paymentTransactionsController = require('../controller/admin/payment-transactions.controller');

// Public routes for payment recovery (accessible without admin auth)
// These routes should be protected with a token or payment ID validation

// Get duplicate past due payments (read-only, no deletion)
// Must be before /:id routes to avoid routing conflicts
router.get('/duplicates', failedPaymentsController.getDuplicatePastDuePayments);

// Delete duplicate past due payments (deletes all duplicates found)
router.post('/duplicates/delete', failedPaymentsController.deleteDuplicatePastDuePayments);

// Get past due payments that should be resolved (have successful payments after failure)
router.get('/should-resolve', failedPaymentsController.getPastDuePaymentsToResolve);

// Resolve past due payments that have successful payment transactions
router.post('/resolve-with-payments', failedPaymentsController.resolvePastDuePaymentsWithSuccessfulPayments);

// Get recovery page data (public access with payment ID)
router.get('/:id/data', failedPaymentsController.getRecoveryPageData);

// Update card for recovery (public access with payment ID)
router.post('/:id/update-card', failedPaymentsController.updateCardForRecovery);

// This allows PayPlus webhooks to update the payment link
router.post('/update-payment-link', failedPaymentsController.updatePaymentLinkFromPayPlus);

// Reconciliation preview (no auth) - fetch and review changes
router.get('/reconciliation/:userId/preview', paymentTransactionsController.previewPayplusReconciliation);

// Reconciliation apply (no auth) - apply updates
router.post('/reconciliation/:userId/apply', paymentTransactionsController.applyPayplusReconciliation);

module.exports = router;

