const express = require('express');
const subscriptionChurnController = require('../../controller/admin/subscription-churn.controller');
const router = express.Router();

// GET /api/adminSubscriptionChurn/month1-dropoffs
router.get('/month1-dropoffs', subscriptionChurnController.getMonth1Dropoffs);

// GET /api/adminSubscriptionChurn/daily-renewals
router.get('/daily-renewals', subscriptionChurnController.getDailyRenewals);

// GET /api/adminSubscriptionChurn/non-renewals
router.get('/non-renewals', subscriptionChurnController.getNonRenewals);

// GET /api/adminSubscriptionChurn/forecast
router.get('/forecast', subscriptionChurnController.getRenewalForecast);

// GET /api/adminSubscriptionChurn/filters
router.get('/filters', subscriptionChurnController.getChurnFilterOptions);

module.exports = router;
