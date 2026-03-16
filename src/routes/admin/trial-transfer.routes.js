const express = require('express');
const router = express.Router();
const adminTrialTransferController = require('../../controller/admin/trial-transfer.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Admin routes for managing trial transfers
router.get('/transfers', AuthValidator, adminTrialTransferController.getAllTransfers);
router.get('/transfers/:id', AuthValidator, adminTrialTransferController.getTransferById);
router.put('/transfers/:id/accept', AuthValidator, adminTrialTransferController.acceptTransfer);
router.put('/transfers/:id/reject', AuthValidator, adminTrialTransferController.rejectTransfer);
router.put('/transfers/:id/reassign', AuthValidator, adminTrialTransferController.reassignTransfer);
router.get('/transfers/stats', AuthValidator, adminTrialTransferController.getTransferStats);
router.get('/transfers/activity-logs', AuthValidator, adminTrialTransferController.getActivityLogs);
router.get('/transfers/:trial_class_id/status-history', AuthValidator, adminTrialTransferController.getTrialClassStatusHistory);

module.exports = router;