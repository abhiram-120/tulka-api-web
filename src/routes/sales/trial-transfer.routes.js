// routes/sales/trial-transfer.routes.js
const express = require('express');
const router = express.Router();
const trialTransferController = require('../../controller/sales/trial-transfer.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// For Appointment Setters
router.post('/transfers', AuthValidator, trialTransferController.transferTrialStudent);
router.get('/transfers/initiated', AuthValidator, trialTransferController.getInitiatedTransfers);
router.put('/transfers/:id/reassign', AuthValidator, trialTransferController.reassignTransfer);

// For Sales Users
router.get('/transfers/received', AuthValidator, trialTransferController.getReceivedTransfers);
router.put('/transfers/:id/accept', AuthValidator, trialTransferController.acceptTransfer);
router.put('/transfers/:id/reject', AuthValidator, trialTransferController.rejectTransfer);
router.post('/transfers/:id/payment', AuthValidator, trialTransferController.createPaymentLink);

// For Sales Management (Transferred to Sales)
router.get('/transfers/to-sell', AuthValidator, trialTransferController.getTransfertoSell);

// For both roles
router.get('/transfers/:id', AuthValidator, trialTransferController.getTransferById);
router.get('/transfers/notifications', AuthValidator, trialTransferController.getNotifications);
router.put('/transfers/notifications/:id/read', AuthValidator, trialTransferController.markNotificationRead);

module.exports = router;