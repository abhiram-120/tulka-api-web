const express = require('express');
const payplusCustomerController = require('../controller/payplus/payplus-customer.controller');

const router = express.Router();

// Public route (no auth): fetch PayPlus transactions that used the placeholder
// name "PayPlus Customer" along with extracted customer_uid/email when present.
router.get('/placeholder-customers', payplusCustomerController.getPayPlusPlaceholderCustomers);
// Public route (no auth): attempt to fix placeholder customers by updating PayPlus
router.post('/placeholder-customers/fix', payplusCustomerController.fixPayPlusPlaceholderCustomers);

// Public route (no auth): find users with recurring payments in PayPlus but not in our system
router.get('/orphaned-recurring-payments', payplusCustomerController.getOrphanedRecurringPayments);
// Public route (no auth): update customer email in PayPlus
router.post('/update-customer-email', payplusCustomerController.updateCustomerEmail);

// Public route (no auth): find users who exist in our system but have mismatched emails in PayPlus
router.get('/mismatched-emails', payplusCustomerController.getMismatchedEmailUsers);
// Public route (no auth): bulk update emails in PayPlus with current system emails
router.post('/mismatched-emails/fix', payplusCustomerController.fixMismatchedEmails);

// Public route (no auth): list failed PayPlus webhooks (status_code = '1') and related transactions
router.get('/failed-webhooks', payplusCustomerController.getFailedWebhookFailures);
// Public route (no auth): reconcile failed webhooks for a specific user (create PastDuePayment + mark tx failed)
router.post('/failed-webhooks/:userId/fix', payplusCustomerController.fixFailedWebhookFailuresForUser);

module.exports = router;