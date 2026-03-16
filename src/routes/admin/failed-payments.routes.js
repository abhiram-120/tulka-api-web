const express = require('express');
const router = express.Router();
const failedPaymentsController = require('../../controller/admin/failed-payments.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureFailedPaymentsAccess = checkPermission('failed-payments', 'read');
const ensureFailedPaymentsUpdate = checkPermission('failed-payments', 'update');

// Get failed payments overview/dashboard
router.get('/overview', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getFailedPaymentsOverview);

// Get failed payments list with filtering and pagination
router.get('/list', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getFailedPaymentsList);

// Get collections list (canceled after grace period)
router.get('/collections', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getCollectionsList);

// Get specific failed payment details by ID
router.get('/:id', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getFailedPaymentDetails);

// Dunning schedule management
router.get('/:id/dunning', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getDunningSchedule);
router.put('/:id/dunning/pause', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.pauseDunningReminders);
router.put('/:id/dunning/resume', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.resumeDunningReminders);
router.put('/:id/dunning/disable', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.disableDunningReminders);
router.post('/:id/dunning/send-now', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.sendReminderNow);

// Charge skip management
router.post('/:id/skip-charges', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.setChargeSkip);
router.get('/:id/skip-charges', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getChargeSkips);
router.delete('/skip-charges/:skipId', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.removeChargeSkip);

// Manual payment resolution
router.post('/:id/mark-paid', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.markAsPaidManually);
router.post('/:id/cancel-immediately', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.cancelImmediately);

// Copy payment recovery link
router.get('/:id/recovery-link', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getRecoveryLink);

// Send WhatsApp message with recovery link (single)
router.post('/:id/send-whatsapp', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.sendWhatsAppRecoveryLink);

// Bulk send WhatsApp reminders to multiple payments
router.post('/bulk-send-whatsapp', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.bulkSendWhatsAppReminders);

// Export failed payments data
router.get('/export/csv', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.exportFailedPayments);

// Statistics and metrics
router.get('/stats/dunning', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getDunningStats);
router.get('/stats/recovery-rates', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getRecoveryRates);
router.get('/stats/whatsapp', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getWhatsAppStats);
router.get('/stats/collections-insights', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getCollectionsInsights);

// Global dunning settings (admin level)
router.get('/settings/global', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getGlobalDunningSettings);
router.put('/settings/global', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.updateGlobalDunningSettings);

router.post('/:id/generate-recovery-link', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.generateNewRecoveryLink);

// Reactivate subscription after late payment
router.post('/:id/reactivate-subscription', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.reactivateSubscription);

// Card update for recovery (admin endpoint)
router.post('/:id/update-card', AuthValidator, ensureFailedPaymentsUpdate, failedPaymentsController.updateCardForRecovery);
router.get('/:id/recovery-page-data', AuthValidator, ensureFailedPaymentsAccess, failedPaymentsController.getRecoveryPageData);

module.exports = router;