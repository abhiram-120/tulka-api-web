// routes/sales/payment-callback.routes.js
const express = require('express');
const router = express.Router();
const paymentCallbackController = require('../../controller/sales/family-payment-callback.controller');
const paymentSuccessController = require('../../controller/sales/family-payment-success.controller');
const paymentFailedController = require('../../controller/sales/family-payment-failed.controller');

const AuthValidator = require('../../middleware/sales-verify-token');

// const legacyCallbackController = require('../../controller/sales/payplus-legacy-callback.controller');
// const webhookController = require('../../controller/sales/payplus-webhook.controller');
// const adminController = require('../../controller/sales/payment-admin.controller');

// PayPlus webhook endpoint for real-time payment notifications
router.post('/payplus-webhook', paymentCallbackController.processPayPlusWebhook);

// These endpoints don't use AuthValidator because they are called by PayPlus
router.post('/payplus-success', paymentSuccessController.processFamilyPaymentSuccess);
router.post('/payplus-failed', paymentFailedController.processFamilyPaymentFailed);

router.get('/payplus-failed-details', paymentFailedController.handleFamilyPaymentFailedPage);

// Admin endpoints to view payment transactions (requires authentication)
router.get('/transactions', AuthValidator, paymentCallbackController.getPaymentTransactions);

// Student details endpoint (requires authentication)
router.get('/student/:id', AuthValidator, paymentCallbackController.getStudentDetails);

router.post('/cancel-subscription', AuthValidator, paymentCallbackController.cancelUserRecurringPaymentsManually);
router.get('/invoice/:transaction_uid', AuthValidator, paymentCallbackController.downloadInvoice);

module.exports = router;