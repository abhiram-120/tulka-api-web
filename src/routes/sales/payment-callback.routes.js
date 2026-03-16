// routes/sales/payment-callback.routes.js
const express = require('express');
const router = express.Router();
const paymentCallbackController = require('../../controller/sales/payment-callback.controller');
const paymentSuccessController = require('../../controller/sales/payment-success.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// const legacyCallbackController = require('../../controller/sales/payplus-legacy-callback.controller');
// const webhookController = require('../../controller/sales/payplus-webhook.controller');
// const adminController = require('../../controller/sales/payment-admin.controller');

// PayPlus webhook endpoint for real-time payment notifications
router.post('/payplus-webhook', paymentCallbackController.processPayPlusWebhook);

// These endpoints don't use AuthValidator because they are called by PayPlus
router.post('/payplus-success', paymentSuccessController.processPayPlusSuccessfulPayment);
router.post('/payplus-failed', paymentCallbackController.processPayPlusFailedPayment);

// Admin endpoints to view payment transactions (requires authentication)
router.get('/transactions', AuthValidator, paymentCallbackController.getPaymentTransactions);
router.get('/export-transaction',AuthValidator,paymentCallbackController.exportPaymentTransactionsCSV)

// Student details endpoint (requires authentication)
router.get('/student/:id', AuthValidator, paymentCallbackController.getStudentDetails);

router.post('/cancel-subscription', AuthValidator, paymentCallbackController.cancelUserRecurringPaymentsManually);
router.get('/invoice/:transaction_uid', AuthValidator, paymentCallbackController.downloadInvoice);

module.exports = router;