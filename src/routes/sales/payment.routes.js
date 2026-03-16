const express = require('express');
const router = express.Router();
const paymentController = require('../../controller/sales/payment.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

router.post('/create-student-subscription',AuthValidator,paymentController.saveManualPayment)

// Get data for payment link generator (subscription plans, durations, etc.)
router.get('/generator-data', AuthValidator, paymentController.getPaymentGeneratorData);

// Generate a payment link
router.post('/generate-link', AuthValidator, paymentController.generatePaymentLink);

// Get payment link details by ID
router.get('/search-students', AuthValidator, paymentController.searchStudents);

// Search existing users for payment link generation
router.get('/search-existing-users', AuthValidator, paymentController.searchExistingUsers);

// Send payment link via email
router.post('/send-email', AuthValidator, paymentController.sendPaymentLinkEmail);

// Send payment link via WhatsApp
router.post('/send-whatsapp', AuthValidator, paymentController.sendPaymentLinkWhatsApp);

// Store payment data and return short ID
router.post('/store-payment-data', AuthValidator, paymentController.storePaymentData);

// Get payment data by short ID
router.get('/get-payment-data/:shortId', paymentController.getPaymentData);

router.put('/update-email/:shortId', paymentController.updatePaymentEmail);

module.exports = router;