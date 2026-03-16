const express = require('express');
const subscriptionChurnController = require('../../controller/admin/subscription-churn.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const router = express.Router();

// GET /api/adminSubscriptionChurn/month1-dropoffs
router.get('/month1-dropoffs', AuthValidator, subscriptionChurnController.getMonth1Dropoffs);

// GET /api/adminSubscriptionChurn/daily-renewals
router.get('/daily-renewals', AuthValidator, subscriptionChurnController.getDailyRenewals);

// GET /api/adminSubscriptionChurn/non-renewals
router.get('/non-renewals', AuthValidator, subscriptionChurnController.getNonRenewals);

// GET /api/adminSubscriptionChurn/forecast
router.get('/forecast', AuthValidator, subscriptionChurnController.getRenewalForecast);

// GET /api/adminSubscriptionChurn/filters
router.get('/filters', AuthValidator, subscriptionChurnController.getChurnFilterOptions);

module.exports = router;
