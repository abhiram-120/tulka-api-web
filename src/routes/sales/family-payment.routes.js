// routes/sales/family-payment.routes.js
const express = require('express');
const router = express.Router();
const familyPaymentController = require('../../controller/sales/family-payment.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Generate family payment link
router.post('/generate-link', AuthValidator, familyPaymentController.generateFamilyPaymentLink);

// Get family payment data by link token (for payment page)
router.get('/:linkToken', familyPaymentController.getFamilyPaymentData);

// Send family payment link via email
router.post('/send-email', AuthValidator, familyPaymentController.sendFamilyPaymentLinkEmail);

// Send family payment link via WhatsApp
router.post('/send-whatsapp', AuthValidator, familyPaymentController.sendFamilyPaymentLinkWhatsApp);

// Modify family payment transaction (refund, cancel, etc.)
router.put('/transaction/modify', AuthValidator, familyPaymentController.modifyFamilyTransaction);

// Get family payment status and transaction history
router.get('/status/:familyPaymentLinkId', AuthValidator, familyPaymentController.getFamilyPaymentStatus);

// Download invoice for a family payment transaction
router.get('/invoice/:id', AuthValidator, familyPaymentController.downloadFamilyInvoice);


module.exports = router;