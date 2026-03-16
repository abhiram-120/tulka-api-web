const express = require('express');
const router = express.Router();
const referralController = require('../../controller/admin/referral.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureReferralsAccess = checkPermission('referrals', 'read');
const ensureReferralsCreate = checkPermission('referrals', 'create');
const ensureReferralsUpdate = checkPermission('referrals', 'update');
const ensureReferralsDelete = checkPermission('referrals', 'delete');

// ============================================
// Overview/Analytics Routes
// ============================================
router.get('/overview', AuthValidator, ensureReferralsAccess, referralController.getReferralOverview);

// ============================================
// Referral Management Routes
// ============================================
router.get('/referrals/list', AuthValidator, ensureReferralsAccess, referralController.getAllReferrals);
router.get('/referrals/:id', AuthValidator, ensureReferralsAccess, referralController.getReferralById);
router.patch('/referrals/:id/status', AuthValidator, ensureReferralsUpdate, referralController.updateReferralStatus);


// ============================================
// Tier Management Routes
// ============================================
router.get('/tiers/list', AuthValidator, ensureReferralsAccess, referralController.getAllTiers);
router.get('/tiers/:id', AuthValidator, ensureReferralsAccess, referralController.getTierById);
router.post('/tiers', AuthValidator, ensureReferralsCreate, referralController.createTier);
router.put('/tiers/:id', AuthValidator, ensureReferralsUpdate, referralController.updateTier);
router.delete('/tiers/:id', AuthValidator, ensureReferralsDelete, referralController.deleteTier);

// ============================================
// Reward Management Routes
// ============================================
router.get('/rewards/list', AuthValidator, ensureReferralsAccess, referralController.getAllRewards);

// ============================================
// Claim Management Routes
// ============================================
router.get('/claims/list', AuthValidator, ensureReferralsAccess, referralController.getAllClaims);

// ============================================
// Link Management Routes
// ============================================
router.get('/links/list', AuthValidator, ensureReferralsAccess, referralController.getAllLinks);

// ============================================
// Fraud Detection Routes
// ============================================
router.get('/fraud-logs/list', AuthValidator, ensureReferralsAccess, referralController.getAllFraudLogs);
router.patch('/fraud-logs/:id/review', AuthValidator, ensureReferralsUpdate, referralController.reviewFraudCase);

// ============================================
// Retention Tracking Routes
// ============================================
router.get('/retention/list', AuthValidator, ensureReferralsAccess, referralController.getRetentionTracking);

module.exports = router;