// routes/sales/family.routes.js - FIXED VERSION
const express = require('express');
const router = express.Router();
const familyController = require('../../controller/sales/family.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Family Management Routes
router.get('/stats', AuthValidator, familyController.getFamilyStats);
router.get('/list', AuthValidator, familyController.getFamilyList);
router.post('/create', AuthValidator, familyController.createFamily);

// Cart Management Routes - MOVE THESE BEFORE PARAMETERIZED ROUTES
router.get('/cart/items', AuthValidator, familyController.getCartItems);
router.post('/cart/families', AuthValidator, familyController.addFamilyToCart);
router.post('/cart/children', AuthValidator, familyController.addChildrenToCart);
router.patch('/cart/families/:familyId/children/:childId/toggle', AuthValidator, familyController.toggleChildSelection);
router.patch('/cart/families/:familyId/toggle-all', AuthValidator, familyController.toggleFamilySelection);
router.delete('/cart/families/:familyId/children/:childId', AuthValidator, familyController.removeChildFromCart);
router.delete('/cart/families/:familyId', AuthValidator, familyController.removeFamilyFromCart);
router.delete('/cart/clear', AuthValidator, familyController.clearCart);
router.get('/cart/selected-summary', AuthValidator, familyController.getSelectedChildrenSummary);
router.patch('/cart/families/:familyId/children/:childId/subscription', AuthValidator, familyController.updateCartItemSubscription);
router.get('/cart/subscription-summary', AuthValidator, familyController.getCartSubscriptionSummary);
router.post('/cart/bulk-configure-subscriptions', AuthValidator, familyController.bulkConfigureCartSubscriptions);

// Payment Management Routes - ALSO MOVE THESE BEFORE PARAMETERIZED ROUTES  
router.post('/payment/prepare-children', AuthValidator, familyController.prepareChildrenPayment);
router.post('/payment/generate-link', AuthValidator, familyController.generateFamilyPaymentLink);
router.get('/payment/links', AuthValidator, familyController.getPaymentLinks);
router.get('/payment/links/:linkId', AuthValidator, familyController.getPaymentLinkDetails);
router.post('/payment/webhook/payplus', AuthValidator, familyController.handlePayPlusWebhook);

// Subscription Management Routes
router.post('/subscription/modify', AuthValidator, familyController.modifySubscription);
router.get('/subscription/modifications', AuthValidator, familyController.getSubscriptionModifications);
router.patch('/subscription/modifications/:modificationId', AuthValidator, familyController.processSubscriptionModification);

// Reports Routes  
router.get('/reports/revenue', AuthValidator, familyController.getFamilyRevenueReport);
router.get('/reports/conversion', AuthValidator, familyController.getFamilyConversionReport);

// Bulk Operations
router.post('/bulk-actions', AuthValidator, familyController.bulkFamilyActions);
router.get('/export', AuthValidator, familyController.exportFamilies);
router.post('/import', AuthValidator, familyController.importFamilies);

// PARAMETERIZED ROUTES - MUST COME LAST
router.get('/:id', AuthValidator, familyController.getFamilyById);
router.put('/:id', AuthValidator, familyController.updateFamily);
router.delete('/:id', AuthValidator, familyController.deleteFamily);
router.patch('/:id/status', AuthValidator, familyController.updateFamilyStatus);

// Children Management Routes - THESE MUST COME AFTER CART ROUTES
router.post('/:familyId/children', AuthValidator, familyController.addChildToFamily);
router.put('/:familyId/children/:childId', AuthValidator, familyController.updateChild);
router.patch('/:familyId/children/:childId/status', AuthValidator, familyController.updateChildStatus);
router.delete('/:familyId/children/:childId', AuthValidator, familyController.removeChild);

// These can stay at the end since they're specific enough
router.get('/:familyId/payments', AuthValidator, familyController.getFamilyPaymentHistory);
router.get('/:familyId/activity-log', AuthValidator, familyController.getFamilyActivityLog);

module.exports = router;