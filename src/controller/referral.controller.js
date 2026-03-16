const User = require('../models/users');
const ReferralLink = require('../models/ReferralLink');
const ReferralTier = require('../models/ReferralTier');
const Referral = require('../models/Referral');
const ReferralReward = require('../models/ReferralReward');
const FreeClass = require('../models/FreeClass');
const UserReferralSettings = require('../models/UserReferralSettings');
const ReferralNotification = require('../models/ReferralNotification');
const ReferralFraudLog = require('../models/ReferralFraudLog');
const ReferralRetentionTracking = require('../models/ReferralRetentionTracking');
const {ReferralTierClaim} = require('../models/ReferralTierClaim');
const crypto = require('crypto');
const { Op } = require('sequelize');
const config = require('../config/config');

// Helper function to generate unique invite code
const generateInviteCode = () => {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Helper function to get current tier based on referral count
const getCurrentTier = async (referralCount) => {
    const tier = await ReferralTier.findOne({
        where: {
            min_referrals: { [Op.lte]: referralCount },
            max_referrals: { [Op.gte]: referralCount },
            is_active: true
        },
        order: [['tier_level', 'ASC']]
    });
    return tier;
};

// Helper function to get free classes count from FreeClasses table
const getFreeClassesCount = async (userId) => {
    try {
        const freeClassRecord = await FreeClass.findOne({
            where: { user_id: userId }
        });
        return freeClassRecord ? freeClassRecord.count_free_class : 0;
    } catch (error) {
        console.error('Error getting free classes count:', error);
        return 0;
    }
};

// 1. Get user's invite link
exports.getMyInviteLink = async (req, res) => {
    try {
        const userId = req.userId;

        let referralLink = await ReferralLink.findOne({
            where: { user_id: userId, is_active: true }
        });

        // If no link exists, create one
        if (!referralLink) {
            const inviteCode = generateInviteCode();
            const inviteUrl = `${config.APP_URL}/invite/${inviteCode}`;
            console.log('inviteUrl :',inviteUrl);
            referralLink = await ReferralLink.create({
                user_id: userId,
                invite_code: inviteCode,
                invite_url: inviteUrl,
                created_at: Math.floor(Date.now() / 1000)
            });
        }

        // Check if can refresh (24h cooldown)
        const now = Math.floor(Date.now() / 1000);
        const cooldownHours = 24;
        const canRefresh = !referralLink.last_refreshed_at || 
            (now - referralLink.last_refreshed_at) >= (cooldownHours * 3600);

        return res.status(200).json({
            status: 'success',
            data: {
                invite_code: referralLink.invite_code,
                invite_url: referralLink.invite_url,
                can_refresh: canRefresh,
                last_refreshed_at: referralLink.last_refreshed_at,
                next_refresh_available: referralLink.last_refreshed_at 
                    ? referralLink.last_refreshed_at + (cooldownHours * 3600)
                    : now
            }
        });
    } catch (error) {
        console.error('Error getting invite link:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get invite link'
        });
    }
};

// 2. Refresh invite link
exports.refreshInviteLink = async (req, res) => {
    const transaction = await ReferralLink.sequelize.transaction();
    try {
        const userId = req.userId;

        const referralLink = await ReferralLink.findOne({
            where: { user_id: userId, is_active: true },
            transaction: transaction
        });

        if (!referralLink) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'No invite link found'
            });
        }

        // Check cooldown
        const now = Math.floor(Date.now() / 1000);
        const cooldownHours = 24;
        if (referralLink.last_refreshed_at && 
            (now - referralLink.last_refreshed_at) < (cooldownHours * 3600)) {
            await transaction.rollback();
            const timeRemaining = (cooldownHours * 3600) - (now - referralLink.last_refreshed_at);
            return res.status(429).json({
                status: 'error',
                message: 'Link refresh cooldown active',
                time_remaining_seconds: timeRemaining
            });
        }

        // Store old invite code
        const oldInviteCode = referralLink.invite_code;

        // Create new link
        const newInviteCode = generateInviteCode();
        const newInviteUrl = `${config.APP_URL}/invite/${newInviteCode}`;

        // IMPORTANT: Temporarily disable foreign key checks to allow updating the parent table first
        // Then update child table, then re-enable checks
        await ReferralLink.sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: transaction });

        try {
            // Step 1: Update referral_links first (create the new invite_code reference)
            await referralLink.update({
                invite_code: newInviteCode,
                invite_url: newInviteUrl,
                last_refreshed_at: now,
                refresh_count: referralLink.refresh_count + 1
            }, { transaction: transaction });

            // Step 2: Update all referrals that reference the old invite_code
            await Referral.update(
                { invite_code: newInviteCode },
                {
                    where: { invite_code: oldInviteCode },
                    transaction: transaction
                }
            );

            // Re-enable foreign key checks
            await ReferralLink.sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: transaction });
        } catch (updateError) {
            // Re-enable foreign key checks even if update fails
            await ReferralLink.sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: transaction });
            throw updateError;
        }

        // Commit the transaction
        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Invite link refreshed successfully',
            data: {
                invite_code: newInviteCode,
                invite_url: newInviteUrl,
                can_refresh: false,
                next_refresh_available: now + (cooldownHours * 3600)
            }
        });
    } catch (error) {
        // Rollback transaction on error
        await transaction.rollback();
        console.error('Error refreshing invite link:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to refresh invite link'
        });
    }
};

// 3. Get my referral stats
exports.getMyReferralStats = async (req, res) => {
    try {
        const userId = req.userId;

        // Get total referrals count
        const totalReferrals = await Referral.count({
            where: { 
                referrer_id: userId,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // Get current tier
        const currentTier = await getCurrentTier(totalReferrals);

        // Get all referrals with details
        const referrals = await Referral.findAll({
            where: { referrer_id: userId },
            include: [
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'created_at']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Get rewards earned
        const rewards = await ReferralReward.findAll({
            where: { 
                user_id: userId,
                user_type: 'referrer'
            },
            order: [['created_at', 'DESC']]
        });

        // Calculate total subscription value
        const totalSubscriptionValue = referrals.reduce((sum, ref) => 
            sum + parseFloat(ref.subscription_value || 0), 0
        );

        // Calculate ARPU
        const payingUsers = referrals.filter(ref => ref.is_paying_user).length;
        const arpu = payingUsers > 0 ? totalSubscriptionValue / payingUsers : 0;

        return res.status(200).json({
            status: 'success',
            data: {
                total_referrals: totalReferrals,
                current_tier: currentTier,
                total_subscription_value: totalSubscriptionValue.toFixed(2),
                average_subscription_value: arpu.toFixed(2),
                referrals: referrals,
                rewards_earned: rewards
            }
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get referral stats'
        });
    }
};

// 4. Validate invite code (before signup)
exports.validateInviteCode = async (req, res) => {
    try {
        const { invite_code } = req.params;

        const referralLink = await ReferralLink.findOne({
            where: { 
                invite_code: invite_code,
                is_active: true
            },
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'full_name']
            }]
        });

        if (!referralLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid invite code'
            });
        }

        // Get referrer's current referral count
        const referrerReferrals = await Referral.count({
            where: { 
                referrer_id: referralLink.user_id,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // Get applicable tier
        const tier = await getCurrentTier(referrerReferrals);

        return res.status(200).json({
            status: 'success',
            message: 'Valid invite code',
            data: {
                invite_code: invite_code,
                referrer_name: referralLink.user.full_name,
                reward: {
                    type: tier.referee_reward_type,
                    value: tier.referee_reward_value
                }
            }
        });
    } catch (error) {
        console.error('Error validating invite code:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to validate invite code'
        });
    }
};

// 5. Register with invite code (called AFTER signup)
exports.registerWithInvite = async (req, res) => {
    try {
        const { invite_code, user_id } = req.body;

        // Validate inputs
        if (!invite_code || !user_id) {
            return res.status(400).json({
                status: 'error',
                message: 'invite_code and user_id are required'
            });
        }

        // Validate invite code
        const referralLink = await ReferralLink.findOne({
            where: {
                invite_code: invite_code,
                is_active: true
            }
        });

        if (!referralLink) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid invite code'
            });
        }

        // Check if user exists
        const newUser = await User.findByPk(user_id);
        if (!newUser) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found. Please create user first before registering referral.'
            });
        }

        // Check if user is trying to refer themselves
        if (referralLink.user_id === user_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot use your own referral link'
            });
        }

        // Check if this user already has a referral
        const existingReferral = await Referral.findOne({
            where: { referee_id: user_id }
        });

        if (existingReferral) {
            return res.status(400).json({
                status: 'error',
                message: 'User already registered with a referral code'
            });
        }

        // Check for fraud
        const fraudChecks = await checkForFraud(newUser, referralLink.user_id);

        if (fraudChecks.isFraud) {
            // Log fraud
            await ReferralFraudLog.create({
                referee_id: user_id,
                referrer_id: referralLink.user_id,
                fraud_type: fraudChecks.type,
                fraud_score: fraudChecks.score,
                details: fraudChecks.details,
                is_blocked: fraudChecks.score > 70,
                created_at: Math.floor(Date.now() / 1000)
            });

            if (fraudChecks.score > 70) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Signup flagged as suspicious'
                });
            }
        }

        // Get referrer's current referral count
        const referrerReferrals = await Referral.count({
            where: {
                referrer_id: referralLink.user_id,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // REQUIRED: Get count BEFORE this referral (exclude pending)
        const referrerReferralsBeforeThis = await Referral.count({
            where: {
                referrer_id: referralLink.user_id,
                status: { [Op.in]: ['validated', 'rewarded'] }
                // EXCLUDE current pending referral
            }
        });

        // Get applicable tier
        const tier = await getCurrentTier(referrerReferralsBeforeThis);

        if (!tier) {
            return res.status(500).json({
                status: 'error',
                message: 'No active tier found. Please contact administrator.'
            });
        }

        // Create referral record
        const referral = await Referral.create({
            referrer_id: referralLink.user_id,
            referee_id: user_id,
            invite_code: invite_code,
            status: 'pending',
            tier_at_signup: tier.tier_level,
            created_at: Math.floor(Date.now() / 1000)
        });

        // Free Classes reward to referee -- TESTING PURPOSES ONLY
        // await ReferralReward.create({
        //     referral_id: referral.id,
        //     user_id: user_id,
        //     user_type: 'referee',
        //     reward_type: tier.referee_reward_type,
        //     reward_value: tier.referee_reward_value,
        //     tier_level: tier.tier_level,
        //     status: 'pending',
        //     created_at: Math.floor(Date.now() / 1000)
        // });

        // Free Classes reward to referrer
        await ReferralReward.create({
            referral_id: referral.id,
            user_id: referralLink.user_id,
            user_type: 'referrer',
            reward_type: tier.referrer_reward_type,
            reward_value: tier.referrer_reward_value,
            tier_level: tier.tier_level,
            status: 'pending',
            created_at: Math.floor(Date.now() / 1000)
        });

        // Queue notifications
        await queueNotifications(referral.id, user_id, referralLink.user_id, 'friend_joined');

        return res.status(201).json({
            status: 'success',
            message: 'Referral registered successfully',
            data: {
                referral_id: referral.id,
                reward: {
                    type: tier.referee_reward_type,
                    value: tier.referee_reward_value
                }
            }
        });
    } catch (error) {
        console.error('Error registering with invite:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to register referral',
            error: error.message
        });
    }
};

// 6. Get my rewards
exports.getMyRewards = async (req, res) => {
    try {
        const userId = req.userId;
        const { status } = req.query;

        const where = { user_id: userId };
        if (status) {
            where.status = status;
        }

        const rewards = await ReferralReward.findAll({
            where: where,
            include: [{
                model: Referral,
                as: 'referral',
                include: [
                    {
                        model: User,
                        as: 'referrer',
                        attributes: ['id', 'full_name']
                    },
                    {
                        model: User,
                        as: 'referee',
                        attributes: ['id', 'full_name']
                    }
                ]
            }],
            order: [['created_at', 'DESC']]
        });

        return res.status(200).json({
            status: 'success',
            data: rewards
        });
    } catch (error) {
        console.error('Error getting rewards:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get rewards'
        });
    }
};

// Helper: Check for fraud
const checkForFraud = async (newUser, referrerId) => {
    const fraudChecks = {
        isFraud: false,
        type: null,
        score: 0,
        details: {}
    };

    // Check duplicate email
    const duplicateEmail = await User.count({
        where: { 
            email: newUser.email,
            id: { [Op.ne]: newUser.id }
        }
    });

    if (duplicateEmail > 0) {
        fraudChecks.isFraud = true;
        fraudChecks.type = 'duplicate_email';
        fraudChecks.score += 50;
        fraudChecks.details.duplicate_email = true;
    }

    // Check duplicate phone
    if (newUser.mobile) {
        const duplicatePhone = await User.count({
            where: { 
                mobile: newUser.mobile,
                id: { [Op.ne]: newUser.id }
            }
        });

        if (duplicatePhone > 0) {
            fraudChecks.isFraud = true;
            fraudChecks.type = 'duplicate_phone';
            fraudChecks.score += 50;
            fraudChecks.details.duplicate_phone = true;
        }
    }

    return fraudChecks;
};

// Helper: Queue notifications
const queueNotifications = async (referralId, refereeId, referrerId, event) => {
    const now = Math.floor(Date.now() / 1000);
    
    const notificationTypes = ['whatsapp', 'in_app', 'popup'];
    
    for (const type of notificationTypes) {
        // Notification for referee
        await ReferralNotification.create({
            referral_id: referralId,
            user_id: refereeId,
            notification_type: type,
            notification_event: event,
            status: 'pending',
            created_at: now
        });

        // Notification for referrer
        await ReferralNotification.create({
            referral_id: referralId,
            user_id: referrerId,
            notification_type: type,
            notification_event: event,
            status: 'pending',
            created_at: now
        });
    }
};

// 7. Process rewards after first payment (webhook/internal)
exports.processRewardsAfterPayment = async (req, res) => {
    try {
        const { user_id, subscription_value } = req.body;

        // Find pending referral
        const referral = await Referral.findOne({
            where: { 
                referee_id: user_id,
                status: 'pending'
            }
        });

         if (!referral) {
             return res.status(404).json({
                 status: 'error',
                 message: 'No pending referral found'
             });
         }

         // Get tier that was active at signup time
         const tierAtSignup = await ReferralTier.findOne({
             where: {
                 tier_level: referral.tier_at_signup,
                 is_active: true
             }
         });

         if (!tierAtSignup) {
             return res.status(500).json({
                 status: 'error',
                 message: 'Tier not found for this referral'
             });
         }

       

        // Update referral
        const now = Math.floor(Date.now() / 1000);
        await referral.update({
            status: 'validated',
            subscription_value: subscription_value,
            first_payment_at: now,
            is_paying_user: true,
            updated_at: now
        });

        //IMPORTANT: Delete existing pending rewards and create new ones based on tierAtSignup
        // Delete any existing pending rewards (in case they were created with wrong tier)
        await ReferralReward.destroy({
            where: {
                referral_id: referral.id,
                status: 'pending'
            }
        });

        //CREATE NEW REWARDS BASED ON SIGNUP TIME TIER
        // Free Classes reward to referrer ONLY (based on management requirement)
        await ReferralReward.create({
            referral_id: referral.id,
            user_id: referral.referrer_id, // referrer
            user_type: 'referrer',
            reward_type: tierAtSignup.referrer_reward_type,
            reward_value: tierAtSignup.referrer_reward_value,
            tier_level: tierAtSignup.tier_level,
            status: 'pending',
            created_at: now
        });

        // Grant the newly created rewards
        const pendingRewards = await ReferralReward.findAll({
            where: {
                referral_id: referral.id,
                status: 'pending'
            }
        });

        for (const reward of pendingRewards) {
            await reward.update({
                status: 'granted',
                granted_at: now
            });

            // Apply reward to user account based on reward_type
            // This would integrate with your existing subscription/lesson system
            await applyRewardToUser(reward);
        }

        // Update referral status to rewarded
        await referral.update({ status: 'rewarded' });

        // Create retention tracking
        await ReferralRetentionTracking.create({
            referee_id: user_id,
            referrer_id: referral.referrer_id,
            subscription_start_date: now,
            total_revenue_generated: subscription_value,
            is_currently_active: true,
            updated_at: now
        });

        // Queue reward notifications
        await queueNotifications(referral.id, user_id, referral.referrer_id, 'reward_received');

        return res.status(200).json({
            status: 'success',
            message: 'Rewards processed successfully'
        });
    } catch (error) {
        console.error('Error processing rewards:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to process rewards'
        });
    }
};

// 8. Get total referral points/rewards summary
exports.getTotalReferralPoints = async (req, res) => {
    try {
        const userId = req.userId;

        // Get all granted rewards
        const grantedRewards = await ReferralReward.findAll({
            where: { 
                user_id: userId,
                status: 'granted'
            }
        });

        // Calculate totals by reward type
        const rewardSummary = {
            total_free_lessons: 0,
            total_free_months: 0,
            total_discount: 0,
            total_cash: 0,
            total_points: 0, // Convert everything to points for a unified score
            breakdown: []
        };

        grantedRewards.forEach(reward => {
            const rewardInfo = {
                reward_type: reward.reward_type,
                reward_value: reward.reward_value,
                user_type: reward.user_type,
                tier_level: reward.tier_level,
                granted_at: reward.granted_at
            };

            switch(reward.reward_type) {
                case 'free_lessons':
                    rewardSummary.total_free_lessons += reward.reward_value;
                    rewardSummary.total_points += reward.reward_value * 100; // 1 lesson = 100 points
                    break;
                case 'free_months':
                    rewardSummary.total_free_months += reward.reward_value;
                    rewardSummary.total_points += reward.reward_value * 500; // 1 month = 500 points
                    break;
                case 'discount':
                    rewardSummary.total_discount += reward.reward_value;
                    rewardSummary.total_points += reward.reward_value * 10; // 1 discount unit = 10 points
                    break;
                case 'cash':
                    rewardSummary.total_cash += reward.reward_value;
                    rewardSummary.total_points += reward.reward_value; // 1 cash = 1 point
                    break;
            }

            rewardSummary.breakdown.push(rewardInfo);
        });

        // Get pending rewards
        const pendingRewards = await ReferralReward.findAll({
            where: { 
                user_id: userId,
                status: 'pending'
            }
        });

        // Get referral stats as referrer
        const totalReferrals = await Referral.count({
            where: { 
                referrer_id: userId,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // Get current tier
        const currentTier = await getCurrentTier(totalReferrals);

        return res.status(200).json({
            status: 'success',
            data: {
                user_id: userId,
                total_referrals: totalReferrals,
                current_tier: currentTier ? {
                    name: currentTier.tier_name,
                    level: currentTier.tier_level
                } : null,
                rewards_summary: rewardSummary,
                pending_rewards_count: pendingRewards.length,
                pending_rewards: pendingRewards
            }
        });
    } catch (error) {
        console.error('Error getting total referral points:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get referral points'
        });
    }
};

// 9. Get referral dashboard (comprehensive overview)
exports.getReferralDashboard = async (req, res) => {
    try {
        const userId = req.userId;

        // Get invite link
        let inviteLink = await ReferralLink.findOne({
            where: { user_id: userId, is_active: true }
        });

        if (!inviteLink) {
            const inviteCode = generateInviteCode();
            const inviteUrl = `${config.APP_URL}/invite/${inviteCode}`;
            console.log('inviteUrl :',inviteUrl);
            inviteLink = await ReferralLink.create({
                user_id: userId,
                invite_code: inviteCode,
                invite_url: inviteUrl,
                created_at: Math.floor(Date.now() / 1000)
            });
        }

        // Get total referrals as referrer
        const totalReferrals = await Referral.count({
            where: { 
                referrer_id: userId,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // Get pending referrals
        const pendingReferrals = await Referral.count({
            where: { 
                referrer_id: userId,
                status: 'pending'
            }
        });

        // Get current tier
        const currentTier = await getCurrentTier(totalReferrals);

        // Calculate progress to next tier
        let nextTier = null;
        let progressToNextTier = 0;
        if (currentTier) {
            nextTier = await ReferralTier.findOne({
                where: {
                    tier_level: currentTier.tier_level + 1,
                    is_active: true
                }
            });

            if (nextTier) {
                const referralsNeeded = nextTier.min_referrals - totalReferrals;
                const totalNeeded = nextTier.min_referrals - currentTier.min_referrals;
                progressToNextTier = Math.min(100, Math.max(0, 
                    ((totalReferrals - currentTier.min_referrals) / totalNeeded) * 100
                ));
            }
        }

        // Get rewards summary
        const grantedRewards = await ReferralReward.findAll({
            where: { 
                user_id: userId,
                status: 'granted'
            }
        });

        const rewardsSummary = {
            total_free_lessons: 0,
            total_free_months: 0,
            total_discount: 0,
            total_cash: 0,
            RewardfreeClass: 0
        };

        grantedRewards.forEach(reward => {
            switch(reward.reward_type) {
                case 'free_lessons':
                    rewardsSummary.total_free_lessons += reward.reward_value;
                    rewardsSummary.RewardfreeClass += reward.reward_value;
                    break;
                case 'free_months':
                    rewardsSummary.total_free_months += reward.reward_value;
                    break;
                case 'discount':
                    rewardsSummary.total_discount += reward.reward_value;
                    break;
                case 'cash':
                    rewardsSummary.total_cash += reward.reward_value;
                    break;
            }
        });

        // Get recent referrals
        const recentReferrals = await Referral.findAll({
            where: { referrer_id: userId },
            include: [
                {
                    model: User,
                    as: 'referrer',
                    attributes: ['id', 'full_name', 'email', 'created_at', 'total_hours']
                },
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'created_at','total_hours']
                },
            ],
            order: [['created_at', 'DESC']],
            limit: 10
        });

         // Format recent referrals with complete user objects including free classes
        const formattedRecentReferrals = await Promise.all(
            recentReferrals.map(async (ref) => {
                if (!ref.referrer || !ref.referee) {
                    console.warn(`Skipping referral ${ref.id} - referrer or referee is null`);
                    return null;
                }

                const referrerFreeClasses = await getFreeClassesCount(ref.referrer_id);
                const refereeFreeClasses = await getFreeClassesCount(ref.referee_id);

                return {
                    id: ref.id,
                    invite_code: ref.invite_code,
                    status: ref.status,
                    tier_at_signup: ref.tier_at_signup,
                    subscription_value: ref.subscription_value,
                    is_paying_user: ref.is_paying_user,
                    first_payment_at: ref.first_payment_at,
                    created_at: ref.created_at,
                    // COMPLETE referrer object with free classes
                    referral_user: {
                        id: ref.referrer.id,
                        full_name: ref.referrer.full_name,
                        email: ref.referrer.email,
                        created_at: ref.referrer.created_at,
                        total_hours: ref.referrer.total_hours,
                        free_classes: referrerFreeClasses // From FreeClass table
                    },
                    // COMPLETE referee object with free classes
                    refree_user: {
                        id: ref.referee.id,
                        full_name: ref.referee.full_name,
                        email: ref.referee.email,
                        created_at: ref.referee.created_at,
                        total_hours: ref.referee.total_hours,
                        free_classes: refereeFreeClasses // From FreeClass table
                    }
                };
            })
        );

         // Filter out null values
        const filteredRecentReferrals = formattedRecentReferrals.filter(ref => ref !== null);


        // Get total subscription value
        const allReferrals = await Referral.findAll({
            where: { referrer_id: userId }
        });

        const totalSubscriptionValue = allReferrals.reduce((sum, ref) => 
            sum + parseFloat(ref.subscription_value || 0), 0
        );

        // Get current user's free classes count - ADD THIS VARIABLE
        const currentUserFreeClasses = await getFreeClassesCount(userId);

        return res.status(200).json({
            status: 'success',
            data: {
                invite_link: inviteLink ? {
                    code: inviteLink.invite_code,
                    url: inviteLink.invite_url,
                    created_at: inviteLink.created_at
                } : null,
                stats: {
                    total_referrals: totalReferrals,
                    pending_referrals: pendingReferrals,
                    total_subscription_value: parseFloat(totalSubscriptionValue).toFixed(2),
                    RewardfreeClass: rewardsSummary.RewardfreeClass,
                    user_free_classes: currentUserFreeClasses
                },
                current_tier: currentTier ? {
                    name: currentTier.tier_name,
                    level: currentTier.tier_level,
                    min_referrals: currentTier.min_referrals,
                    max_referrals: currentTier.max_referrals,
                    referee_reward: {
                        type: currentTier.referee_reward_type,
                        value: currentTier.referee_reward_value
                    },
                    referrer_reward: {
                        type: currentTier.referrer_reward_type,
                        value: currentTier.referrer_reward_value
                    }
                } : null,
                next_tier: nextTier ? {
                    name: nextTier.tier_name,
                    level: nextTier.tier_level,
                    min_referrals: nextTier.min_referrals,
                    referrals_needed: nextTier.min_referrals - totalReferrals,
                    progress_percentage: parseFloat(progressToNextTier).toFixed(2)
                } : null,
                rewards_earned: rewardsSummary,
                recent_referrals: filteredRecentReferrals, // Updated with complete objects
            }
        });
    } catch (error) {
        console.error('Error getting referral dashboard:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get referral dashboard'
        });
    }
};

// Helper: Apply reward to user
const applyRewardToUser = async (reward) => {
    // TODO: Implement based on your business logic
    // For free_lessons: Add lessons to user's account
    // For free_months: Extend subscription
    // For discount: Create discount code
    // For cash: Add to wallet/credits
    
    console.log(`Applying reward: ${reward.reward_type} - ${reward.reward_value} to user ${reward.user_id}`);
    
    // Example: If you have a field like total_hours in users table
    if (reward.reward_type === 'free_lessons') {
        await User.increment('total_hours', {
            by: reward.reward_value,
            where: { id: reward.user_id }
        });
    }
};

const generateClaimReceiptId = () => {
    return 'CLM-' + crypto.randomBytes(3).toString('hex').toUpperCase();
};

// Helper function to format reward text
const formatRewardText = (rewardType, rewardValue) => {
    switch(rewardType) {
        case 'free_lessons':
            return `+${rewardValue.count} Free Lesson${rewardValue.count > 1 ? 's' : ''}`;
        case 'free_months':
            return `+${rewardValue.duration} Free Subscription`;
        case 'discount':
            return `${rewardValue.value}% Discount`;
        case 'cash':
            return `₪${rewardValue.amount} Cash Reward`;
        case 'cash_and_subscription':
            return `₪${rewardValue.amount} + ${rewardValue.duration} Free Subscription`;
        default:
            return 'Reward';
    }
};

// 1. GET /api/referral/tiers
exports.getTiers = async (req, res) => {
    try {
        // Get all active tiers
        const tiers = await ReferralTier.findAll({
            where: { is_active: true },
            order: [['tier_level', 'ASC']]
        });

        // Format tiers for mobile app
        const formattedTiers = tiers.map(tier => {
            let reward = {};
            
            // Format referrer reward (the one who invites)
            if (tier.referrer_reward_type === 'free_lessons') {
                reward = { type: 'lessons', count: tier.referrer_reward_value };
            } else if (tier.referrer_reward_type === 'free_months') {
                reward = { type: 'subscription', duration: `${tier.referrer_reward_value}_month${tier.referrer_reward_value > 1 ? 's' : ''}` };
            } else if (tier.referrer_reward_type === 'cash') {
                reward = { type: 'cash', amount: tier.referrer_reward_value };
            } else if (tier.referrer_reward_type === 'discount') {
                reward = { type: 'discount', value: tier.referrer_reward_value };
            }

            // Special handling for combined rewards
            if (tier.tier_level >= 5 && tier.referrer_reward_type === 'cash') {
                reward = {
                    type: 'cash_and_subscription',
                    amount: tier.referrer_reward_value,
                    duration: '3_months'
                };
            }

            return {
                name: tier.tier_name.toLowerCase(),
                tier_level: tier.tier_level,
                threshold: tier.min_referrals,
                max_threshold: tier.max_referrals,
                reward: reward
            };
        });

        return res.status(200).json({
            status: 'success',
            tiers: formattedTiers
        });
    } catch (error) {
        console.error('Error getting tiers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get tiers'
        });
    }
};

// 2. POST /api/referral/rewards/claim
exports.claimReward = async (req, res) => {
    try {
        const userId = req.userId;
        const { tier } = req.body;

        if (!tier) {
            return res.status(400).json({
                status: 'error',
                message: 'tier is required'
            });
        }

        // Find the tier by name
        const tierData = await ReferralTier.findOne({
            where: {
                tier_name: tier,
                is_active: true
            }
        });

        if (!tierData) {
            return res.status(400).json({
                status: 'error',
                message: 'Unknown tier'
            });
        }

        // Check if already claimed (idempotency)
        const existingClaim = await ReferralTierClaim.findOne({
            where: {
                user_id: userId,
                tier_level: tierData.tier_level
            }
        });

        if (existingClaim) {
            return res.status(409).json({
                status: 'error',
                message: 'Reward already claimed for this tier',
                claimed_at: new Date(existingClaim.claimed_at * 1000).toISOString()
            });
        }

        // Get user's total qualified referrals
        const qualifiedReferrals = await Referral.count({
            where: {
                referrer_id: userId,
                status: { [Op.in]: ['validated', 'rewarded'] }
            }
        });

        // Check if user is eligible
        if (qualifiedReferrals < tierData.min_referrals) {
            return res.status(409).json({
                status: 'error',
                message: 'Not eligible for this tier yet',
                current_referrals: qualifiedReferrals,
                required_referrals: tierData.min_referrals
            });
        }

        // Generate receipt ID
        const receiptId = generateClaimReceiptId();

        // Prepare reward value
        let rewardValue = {};
        if (tierData.referrer_reward_type === 'free_lessons') {
            rewardValue = { count: tierData.referrer_reward_value };
        } else if (tierData.referrer_reward_type === 'free_months') {
            rewardValue = { duration: `${tierData.referrer_reward_value}_month${tierData.referrer_reward_value > 1 ? 's' : ''}` };
        } else if (tierData.referrer_reward_type === 'cash') {
            rewardValue = { amount: tierData.referrer_reward_value };
        } else if (tierData.referrer_reward_type === 'discount') {
            rewardValue = { value: tierData.referrer_reward_value };
        }

        // Special handling for highest tier
        if (tierData.tier_level >= 5 && tierData.referrer_reward_type === 'cash') {
            rewardValue = {
                amount: tierData.referrer_reward_value,
                duration: '3_months'
            };
        }

        const now = Math.floor(Date.now() / 1000);

        // Create claim record
        const claim = await ReferralTierClaim.create({
            user_id: userId,
            tier_level: tierData.tier_level,
            tier_name: tierData.tier_name,
            reward_type: tierData.referrer_reward_type === 'cash' && tierData.tier_level >= 5 
                ? 'cash_and_subscription' 
                : tierData.referrer_reward_type,
            reward_value: rewardValue,
            claim_receipt_id: receiptId,
            notes: 'Wallet credit posted',
            claimed_at: now,
            created_at: now
        });

        // Apply reward to user account
        await applyTierRewardToUser(userId, tierData.referrer_reward_type, rewardValue);

        // Format response reward
        let responseReward = {};
        if (claim.reward_type === 'free_lessons') {
            responseReward = { type: 'lessons', count: rewardValue.count };
        } else if (claim.reward_type === 'free_months') {
            responseReward = { type: 'subscription', duration: rewardValue.duration };
        } else if (claim.reward_type === 'cash') {
            responseReward = { type: 'cash', amount: rewardValue.amount };
        } else if (claim.reward_type === 'cash_and_subscription') {
            responseReward = {
                type: 'cash_and_subscription',
                amount: rewardValue.amount,
                duration: rewardValue.duration
            };
        }

        return res.status(200).json({
            status: 'success',
            tier: tierData.tier_name,
            claimed_at: new Date(claim.claimed_at * 1000).toISOString(),
            reward: responseReward,
            receipt: {
                id: receiptId,
                notes: claim.notes
            }
        });
    } catch (error) {
        console.error('Error claiming reward:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to claim reward',
            error: error.message
        });
    }
};


        // 3. GET /api/referral/rewards/history - COMBINED HISTORY (Referrals + Tier Claims)
// 3. GET /api/referral/rewards/history
exports.getRewardsHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Get both referrals and tier claims
        const [referrals, tierClaims] = await Promise.all([
            // Get referrals - people who registered using your invite
            Referral.findAll({
                where: { referrer_id: userId },
                include: [
                    {
                        model: User,
                        as: 'referee',
                        attributes: ['id', 'full_name', 'email', 'mobile', 'created_at']
                    }
                ],
                order: [['created_at', 'DESC']]
            }),
            
            // Get tier claims - rewards you claimed
            ReferralTierClaim.findAll({
                where: { user_id: userId },
                order: [['claimed_at', 'DESC']]
            })
        ]);

        // Combine and format both types of history
        const allHistory = [];

        // Add referrals to history
        referrals.forEach(ref => {
            allHistory.push({
                type: 'referral',
                id: `ref_${ref.id}`,
                date: new Date(ref.created_at * 1000).toISOString().split('T')[0],
                timestamp: ref.created_at,
                title: 'New Referral',
                description: `${ref.referee?.full_name || 'User'} registered using your invite code`,
                status: ref.status,
                details: {
                    referred_user: ref.referee ? {
                        id: ref.referee.id,
                        full_name: ref.referee.full_name,
                        email: ref.referee.email,
                        registered_date: new Date(ref.referee.created_at * 1000).toISOString().split('T')[0]
                    } : null,
                    invite_code: ref.invite_code,
                    is_paying_user: ref.is_paying_user,
                    subscription_value: ref.subscription_value
                }
            });
        });

        // Add tier claims to history
        tierClaims.forEach(claim => {
            allHistory.push({
                type: 'reward_claim',
                id: `claim_${claim.id}`,
                date: new Date(claim.claimed_at * 1000).toISOString().split('T')[0],
                timestamp: claim.claimed_at,
                title: 'Tier Reward Claimed',
                description: `Claimed ${claim.tier_name} reward`,
                status: 'claimed',
                details: {
                    tier: claim.tier_name,
                    reward_type: claim.reward_type,
                    reward_value: claim.reward_value,
                    receipt_id: claim.claim_receipt_id,
                    notes: claim.notes
                }
            });
        });

        // Sort combined history by timestamp (newest first)
        allHistory.sort((a, b) => b.timestamp - a.timestamp);

        // Apply pagination
        const totalCount = allHistory.length;
        const paginatedHistory = allHistory.slice(offset, offset + limit);

        return res.status(200).json({
            status: 'success',
            items: paginatedHistory,
            pagination: {
                page: page,
                limit: limit,
                total: totalCount,
                total_pages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('Error getting rewards history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get rewards history'
        });
    }
};

// 4. GET /api/referral/invitees
exports.getInvitees = async (req, res) => {
    try {
        const userId = req.userId;
        const status = req.query.status || 'all';

        // Build where clause
        const where = { referrer_id: userId };
        
        if (status === 'pending') {
            where.status = 'pending';
        } else if (status === 'qualified') {
            where.status = { [Op.in]: ['validated', 'rewarded'] };
        }
        // 'all' means no status filter

        // Get referrals with user details
        const referrals = await Referral.findAll({
            where: where,
            include: [{
                model: User,
                as: 'referee',
                attributes: ['email', 'mobile', 'created_at']
            }],
            order: [['created_at', 'DESC']]
        });

        // Format items with masked data
        const items = referrals.map(ref => {
            let inviteeMask = '';
            
            if (ref.referee.email) {
                // Mask email: jo***@example.com
                const emailParts = ref.referee.email.split('@');
                const localPart = emailParts[0];
                const domain = emailParts[1];
                inviteeMask = localPart.substring(0, 2) + '***@' + domain;
            } else if (ref.referee.mobile) {
                // Mask phone: +972****4567
                const phone = ref.referee.mobile;
                inviteeMask = phone.substring(0, 4) + '****' + phone.substring(phone.length - 4);
            } else {
                inviteeMask = 'User***';
            }

            return {
                invitee_mask: inviteeMask,
                status: ref.status === 'pending' ? 'pending' : 'qualified',
                date: new Date(ref.created_at * 1000).toISOString().split('T')[0],
                is_paying_user: ref.is_paying_user,
                subscription_value: ref.subscription_value ? parseFloat(ref.subscription_value).toFixed(2) : null
            };
        });

        return res.status(200).json({
            status: 'success',
            items: items,
            total: items.length
        });
    } catch (error) {
        console.error('Error getting invitees:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to get invitees'
        });
    }
};

// Helper: Apply tier reward to user account
const applyTierRewardToUser = async (userId, rewardType, rewardValue) => {
    try {
        if (rewardType === 'free_lessons') {
            // Add free lessons to user's account
            await User.increment('total_hours', {
                by: rewardValue.count,
                where: { id: userId }
            });
            console.log(`Applied ${rewardValue.count} free lessons to user ${userId}`);
        } else if (rewardType === 'free_months') {
            // Extend subscription
            // TODO: Implement subscription extension logic
            console.log(`Applied ${rewardValue.duration} free subscription to user ${userId}`);
        } else if (rewardType === 'cash') {
            // Add to wallet/credits
            // TODO: Implement wallet credit logic
            console.log(`Applied ₪${rewardValue.amount} cash reward to user ${userId}`);
        } else if (rewardType === 'cash_and_subscription') {
            // Apply both cash and subscription
            // TODO: Implement both logics
            console.log(`Applied ₪${rewardValue.amount} + ${rewardValue.duration} subscription to user ${userId}`);
        }
    } catch (error) {
        console.error('Error applying tier reward:', error);
        throw error;
    }
};