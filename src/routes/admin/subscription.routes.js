// routes/admin/subscription.routes.js
const express = require('express');
const subscriptionController = require('../../controller/admin/subscription.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const ensureSubscriptionsAccess = checkPermission('subscriptions', 'read');
const ensureSubscriptionsCreate = checkPermission('subscriptions', 'create');
const ensureSubscriptionsUpdate = checkPermission('subscriptions', 'update');
const ensureSubscriptionsDelete = checkPermission('subscriptions', 'delete');

// Duration routes
router.get('/durations', AuthValidator, ensureSubscriptionsAccess, subscriptionController.getDurations);
router.post('/durations', AuthValidator, ensureSubscriptionsCreate, subscriptionController.createDuration);
router.put('/durations/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.updateDuration);
router.delete('/durations/:id', AuthValidator, ensureSubscriptionsDelete, subscriptionController.deleteDuration);

// Lesson Length routes
router.get('/lesson-lengths', AuthValidator, ensureSubscriptionsAccess, subscriptionController.getLessonLengths);
router.post('/lesson-lengths', AuthValidator, ensureSubscriptionsCreate, subscriptionController.createLessonLength);
router.put('/lesson-lengths/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.updateLessonLength);
router.delete('/lesson-lengths/:id', AuthValidator, ensureSubscriptionsDelete, subscriptionController.deleteLessonLength);

// Lessons Per Month routes
router.get('/lessons-per-month', AuthValidator, ensureSubscriptionsAccess, subscriptionController.getLessonsPerMonth);
router.post('/lessons-per-month', AuthValidator, ensureSubscriptionsCreate, subscriptionController.createLessonsPerMonth);
router.put('/lessons-per-month/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.updateLessonsPerMonth);
router.delete('/lessons-per-month/:id', AuthValidator, ensureSubscriptionsDelete, subscriptionController.deleteLessonsPerMonth);

// Subscription Plan routes
router.get('/plans', AuthValidator, ensureSubscriptionsAccess, subscriptionController.getSubscriptionPlans);
router.get('/plans/:id', AuthValidator, ensureSubscriptionsAccess, subscriptionController.getSubscriptionPlan);
router.post('/plans', AuthValidator, ensureSubscriptionsCreate, subscriptionController.createSubscriptionPlan);
router.put('/plans/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.updateSubscriptionPlan);
router.delete('/plans/:id', AuthValidator, ensureSubscriptionsDelete, subscriptionController.deleteSubscriptionPlan);

// User Subscription routes
router.post('/assign', AuthValidator, ensureSubscriptionsCreate, subscriptionController.assignSubscription);
router.put('/user-subscription/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.updateUserSubscription);
router.post('/cancel-subscription/:id', AuthValidator, ensureSubscriptionsUpdate, subscriptionController.cancelUserSubscription);

module.exports = router;