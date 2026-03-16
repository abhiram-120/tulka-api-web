const express = require('express');
const referralController = require('../controller/referral.controller');
const AuthValidator = require('../middleware/verify-token');

const router = express.Router();

// User-facing routes
router.get('/my-invite-link', AuthValidator, referralController.getMyInviteLink);
router.post('/refresh-invite-link', AuthValidator, referralController.refreshInviteLink);
router.get('/my-stats', AuthValidator, referralController.getMyReferralStats);
router.get('/validate-invite/:invite_code', referralController.validateInviteCode);
router.get('/my-rewards', AuthValidator, referralController.getMyRewards);


router.get('/total-points', AuthValidator, referralController.getTotalReferralPoints);
router.get('/dashboard', AuthValidator, referralController.getReferralDashboard);

router.get('/tiers', referralController.getTiers);
router.post('/rewards/claim', AuthValidator, referralController.claimReward);
router.get('/rewards/history', AuthValidator, referralController.getRewardsHistory);
router.get('/invitees', AuthValidator, referralController.getInvitees);

// Registration & reward routes
router.post('/register-with-invite', referralController.registerWithInvite);
router.post('/process-rewards', referralController.processRewardsAfterPayment);

module.exports = router;