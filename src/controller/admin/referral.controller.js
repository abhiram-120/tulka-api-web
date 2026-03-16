const { Op } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const Referral = require('../../models/Referral');
const ReferralTier = require('../../models/ReferralTier');
const ReferralReward = require('../../models/ReferralReward');
const { ReferralTierClaim } = require('../../models/ReferralTierClaim');
const ReferralLink = require('../../models/ReferralLink');
const ReferralFraudLog = require('../../models/ReferralFraudLog');
const ReferralRetentionTracking = require('../../models/ReferralRetentionTracking');
const User = require('../../models/users');


/**
 * Get referral overview/analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getReferralOverview = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Build date filter
        const dateFilter = {};
        if (start_date) {
            dateFilter.created_at = { [Op.gte]: parseInt(start_date) };
        }
        if (end_date) {
            dateFilter.created_at = { 
                ...dateFilter.created_at,
                [Op.lte]: parseInt(end_date) 
            };
        }

        // Get total referrals count
        const totalReferrals = await Referral.count({
            where: dateFilter
        });

        // Get referrals by status
        const referralsByStatus = await Referral.findAll({
            where: dateFilter,
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['status'],
            raw: true
        });

        // Get conversion metrics
        const conversionMetrics = await Referral.findAll({
            where: dateFilter,
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
                [sequelize.fn('SUM', sequelize.literal('CASE WHEN is_paying_user = 1 THEN 1 ELSE 0 END')), 'paying_users'],
                [sequelize.fn('SUM', sequelize.col('subscription_value')), 'total_revenue']
            ],
            raw: true
        });

        // Get tier distribution
        const tierDistribution = await Referral.findAll({
            where: {
                ...dateFilter,
                tier_at_signup: { [Op.not]: null }
            },
            attributes: [
                'tier_at_signup',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['tier_at_signup'],
            order: [['tier_at_signup', 'ASC']],
            raw: true
        });

        // Get top referrers
        const topReferrers = await Referral.findAll({
            where: dateFilter,
            attributes: [
                'referrer_id',
                [sequelize.fn('COUNT', sequelize.col('id')), 'referral_count'],
                [sequelize.fn('SUM', sequelize.col('subscription_value')), 'total_value']
            ],
            group: ['referrer_id'],
            order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
            limit: 10,
            raw: true
        });

        // Get user details for top referrers
        const referrerIds = topReferrers.map(r => r.referrer_id);
        const referrerUsers = await User.findAll({
            where: { id: { [Op.in]: referrerIds } },
            attributes: ['id', 'full_name', 'email', 'avatar']
        });

        const referrerMap = {};
        referrerUsers.forEach(user => {
            referrerMap[user.id] = user;
        });

        const topReferrersWithDetails = topReferrers.map(ref => ({
            ...ref,
            user: referrerMap[ref.referrer_id] || null
        }));

        // Calculate conversion rate
        const conversionRate = conversionMetrics[0].total > 0
            ? ((conversionMetrics[0].paying_users / conversionMetrics[0].total) * 100).toFixed(2)
            : 0;

        // Format response
        const overview = {
            total_referrals: totalReferrals,
            referrals_by_status: referralsByStatus.reduce((acc, item) => {
                acc[item.status] = parseInt(item.count);
                return acc;
            }, {}),
            conversion_metrics: {
                total_signups: parseInt(conversionMetrics[0].total) || 0,
                paying_users: parseInt(conversionMetrics[0].paying_users) || 0,
                conversion_rate: parseFloat(conversionRate),
                total_revenue: parseFloat(conversionMetrics[0].total_revenue) || 0
            },
            tier_distribution: tierDistribution.map(tier => ({
                tier_level: tier.tier_at_signup,
                count: parseInt(tier.count)
            })),
            top_referrers: topReferrersWithDetails
        };

        return res.status(200).json({
            status: 'success',
            data: overview
        });

    } catch (error) {
        console.error('Error in getReferralOverview:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


/**
 * Get all referrals with filters and pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllReferrals = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            search,
            tier_level,
            is_paying_user,
            start_date,
            end_date,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        // Build where clause
        const whereClause = {};

        if (status) {
            whereClause.status = status;
        }

        if (tier_level) {
            whereClause.tier_at_signup = parseInt(tier_level);
        }

        if (is_paying_user !== undefined) {
            whereClause.is_paying_user = is_paying_user === 'true';
        }

        if (start_date) {
            whereClause.created_at = { [Op.gte]: parseInt(start_date) };
        }

        if (end_date) {
            whereClause.created_at = {
                ...whereClause.created_at,
                [Op.lte]: parseInt(end_date)
            };
        }

        // Build search clause for users
        let userWhereClause = {};
        if (search) {
            userWhereClause = {
                [Op.or]: [
                    { full_name: { [Op.like]: `%${search}%` } },
                    { email: { [Op.like]: `%${search}%` } },
                    { mobile: { [Op.like]: `%${search}%` } }
                ]
            };
        }

        // Calculate offset
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get referrals with user details
        const { count, rows: referrals } = await Referral.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'referrer',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar'],
                    where: search ? userWhereClause : undefined,
                    required: false
                },
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar'],
                    where: search ? userWhereClause : undefined,
                    required: false
                }
            ],
            order: [[sort_by, sort_order.toUpperCase()]],
            limit: parseInt(limit),
            offset: offset,
            distinct: true
        });

        return res.status(200).json({
            status: 'success',
            data: {
                referrals,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getAllReferrals:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get single referral details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getReferralById = async (req, res) => {
    try {
        const { id } = req.params;

        const referral = await Referral.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'referrer',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar', 'created_at']
                },
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar', 'created_at']
                },
                {
                    model: ReferralReward,
                    as: 'rewards'
                },
                {
                    model: ReferralFraudLog,
                    as: 'fraud_logs'
                }
            ]
        });

        if (!referral) {
            return res.status(404).json({
                status: 'error',
                message: 'Referral not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: referral
        });

    } catch (error) {
        console.error('Error in getReferralById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update referral status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateReferralStatus = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { status } = req.body;

        // Validate status
        const validStatuses = ['pending', 'validated', 'rewarded', 'fraud'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status value'
            });
        }

        transaction = await sequelize.transaction();

        const referral = await Referral.findByPk(id, { transaction });

        if (!referral) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Referral not found'
            });
        }

        await referral.update({
            status,
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Referral status updated successfully',
            data: referral
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in updateReferralStatus:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get all referral tiers
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllTiers = async (req, res) => {
    try {
        const { is_active } = req.query;

        const whereClause = {};
        if (is_active !== undefined) {
            whereClause.is_active = is_active === 'true';
        }

        const tiers = await ReferralTier.findAll({
            where: whereClause,
            order: [['tier_level', 'ASC']]
        });

        return res.status(200).json({
            status: 'success',
            data: tiers
        });

    } catch (error) {
        console.error('Error in getAllTiers:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get single tier details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTierById = async (req, res) => {
    try {
        const { id } = req.params;

        const tier = await ReferralTier.findByPk(id);

        if (!tier) {
            return res.status(404).json({
                status: 'error',
                message: 'Tier not found'
            });
        }

        // Get statistics for this tier
        const tierStats = await Referral.count({
            where: { tier_at_signup: tier.tier_level }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                ...tier.toJSON(),
                total_referrals: tierStats
            }
        });

    } catch (error) {
        console.error('Error in getTierById:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Create new referral tier
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createTier = async (req, res) => {
    let transaction;

    try {
        const {
            tier_name,
            tier_level,
            min_referrals,
            max_referrals,
            referee_reward_type,
            referee_reward_value,
            referrer_reward_type,
            referrer_reward_value,
            is_active = true
        } = req.body;

        // Validation
        if (!tier_name || !tier_level || min_referrals === undefined || max_referrals === undefined) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields'
            });
        }

        if (min_referrals < 0 || max_referrals < 0 || min_referrals > max_referrals) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid referral range'
            });
        }

        transaction = await sequelize.transaction();

        // Check if tier level already exists
        const existingTier = await ReferralTier.findOne({
            where: { tier_level },
            transaction
        });

        if (existingTier) {
            await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Tier level already exists'
            });
        }

        const tier = await ReferralTier.create({
            tier_name,
            tier_level,
            min_referrals,
            max_referrals,
            referee_reward_type,
            referee_reward_value,
            referrer_reward_type,
            referrer_reward_value,
            is_active,
            created_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            message: 'Tier created successfully',
            data: tier
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in createTier:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update referral tier
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTier = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const {
            tier_name,
            min_referrals,
            max_referrals,
            referee_reward_type,
            referee_reward_value,
            referrer_reward_type,
            referrer_reward_value,
            is_active
        } = req.body;

        transaction = await sequelize.transaction();

        const tier = await ReferralTier.findByPk(id, { transaction });

        if (!tier) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Tier not found'
            });
        }

        // Validate referral range if provided
        if (min_referrals !== undefined && max_referrals !== undefined) {
            if (min_referrals < 0 || max_referrals < 0 || min_referrals > max_referrals) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid referral range'
                });
            }
        }

        await tier.update({
            tier_name: tier_name || tier.tier_name,
            min_referrals: min_referrals !== undefined ? min_referrals : tier.min_referrals,
            max_referrals: max_referrals !== undefined ? max_referrals : tier.max_referrals,
            referee_reward_type: referee_reward_type || tier.referee_reward_type,
            referee_reward_value: referee_reward_value !== undefined ? referee_reward_value : tier.referee_reward_value,
            referrer_reward_type: referrer_reward_type || tier.referrer_reward_type,
            referrer_reward_value: referrer_reward_value !== undefined ? referrer_reward_value : tier.referrer_reward_value,
            is_active: is_active !== undefined ? is_active : tier.is_active,
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Tier updated successfully',
            data: tier
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in updateTier:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete referral tier
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteTier = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;

        transaction = await sequelize.transaction();

        const tier = await ReferralTier.findByPk(id, { transaction });

        if (!tier) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Tier not found'
            });
        }

        // Check if tier is being used
        const tierUsage = await Referral.count({
            where: { tier_at_signup: tier.tier_level },
            transaction
        });

        if (tierUsage > 0) {
            await transaction.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Cannot delete tier that is currently in use'
            });
        }

        await tier.destroy({ transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Tier deleted successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in deleteTier:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get all referral rewards
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllRewards = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            user_type,
            reward_type,
            status,
            tier_level,
            user_id
        } = req.query;

        const whereClause = {};

        if (user_type) whereClause.user_type = user_type;
        if (reward_type) whereClause.reward_type = reward_type;
        if (status) whereClause.status = status;
        if (tier_level) whereClause.tier_level = parseInt(tier_level);
        if (user_id) whereClause.user_id = parseInt(user_id);

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: rewards } = await ReferralReward.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: Referral,
                    as: 'referral'
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                rewards,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getAllRewards:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get all tier claims
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllClaims = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            user_id,
            tier_level,
            reward_type,
            start_date,
            end_date
        } = req.query;

        const whereClause = {};

        if (user_id) whereClause.user_id = parseInt(user_id);
        if (tier_level) whereClause.tier_level = parseInt(tier_level);
        if (reward_type) whereClause.reward_type = reward_type;

        if (start_date) {
            whereClause.claimed_at = { [Op.gte]: parseInt(start_date) };
        }
        if (end_date) {
            whereClause.claimed_at = {
                ...whereClause.claimed_at,
                [Op.lte]: parseInt(end_date)
            };
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: claims } = await ReferralTierClaim.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'email', 'mobile', 'avatar']
                }
            ],
            order: [['claimed_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                claims,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getAllClaims:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get all referral links
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllLinks = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            is_active,
            search
        } = req.query;

        const whereClause = {};

        if (is_active !== undefined) {
            whereClause.is_active = is_active === 'true';
        }

        if (search) {
            whereClause.invite_code = { [Op.like]: `%${search}%` };
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: links } = await ReferralLink.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                links,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getAllLinks:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get all fraud logs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllFraudLogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            fraud_type,
            is_blocked,
            min_score,
            reviewed
        } = req.query;

        const whereClause = {};

        if (fraud_type) whereClause.fraud_type = fraud_type;
        if (is_blocked !== undefined) whereClause.is_blocked = is_blocked === 'true';
        if (min_score) whereClause.fraud_score = { [Op.gte]: parseInt(min_score) };
        if (reviewed === 'true') {
            whereClause.reviewed_at = { [Op.not]: null };
        } else if (reviewed === 'false') {
            whereClause.reviewed_at = null;
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: fraudLogs } = await ReferralFraudLog.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'mobile']
                },
                {
                    model: User,
                    as: 'referrer',
                    attributes: ['id', 'full_name', 'email', 'mobile']
                },
                {
                    model: User,
                    as: 'reviewer',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            order: [['fraud_score', 'DESC'], ['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        return res.status(200).json({
            status: 'success',
            data: {
                fraud_logs: fraudLogs,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getAllFraudLogs:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Review fraud case
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const reviewFraudCase = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { is_blocked, notes } = req.body;
        const reviewerId = req.user.id;

        transaction = await sequelize.transaction();

        const fraudLog = await ReferralFraudLog.findByPk(id, { transaction });

        if (!fraudLog) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Fraud log not found'
            });
        }

        await fraudLog.update({
            is_blocked: is_blocked !== undefined ? is_blocked : fraudLog.is_blocked,
            reviewed_by: reviewerId,
            reviewed_at: Math.floor(Date.now() / 1000),
            details: {
                ...fraudLog.details,
                review_notes: notes
            }
        }, { transaction });

        // If blocked, update related referral status
        if (is_blocked) {
            await Referral.update(
                { status: 'fraud' },
                {
                    where: {
                        referee_id: fraudLog.referee_id,
                        referrer_id: fraudLog.referrer_id
                    },
                    transaction
                }
            );
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Fraud case reviewed successfully',
            data: fraudLog
        });

    } catch (error) {
        if (transaction) await transaction.rollback();

        console.error('Error in reviewFraudCase:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get retention tracking data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getRetentionTracking = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            is_currently_active,
            min_months,
            referrer_id
        } = req.query;

        const whereClause = {};

        if (is_currently_active !== undefined) {
            whereClause.is_currently_active = is_currently_active === 'true';
        }

        if (min_months) {
            whereClause.total_months_active = { [Op.gte]: parseInt(min_months) };
        }

        if (referrer_id) {
            whereClause.referrer_id = parseInt(referrer_id);
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows: tracking } = await ReferralRetentionTracking.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'referee',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'referrer',
                    attributes: ['id', 'full_name', 'email', 'avatar']
                }
            ],
            order: [['total_revenue_generated', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        // Calculate aggregate statistics
        const aggregateStats = await ReferralRetentionTracking.findAll({
            where: whereClause,
            attributes: [
                [sequelize.fn('AVG', sequelize.col('total_months_active')), 'avg_months'],
                [sequelize.fn('SUM', sequelize.col('total_revenue_generated')), 'total_revenue'],
                [sequelize.fn('COUNT', sequelize.literal('CASE WHEN is_currently_active = 1 THEN 1 END')), 'active_count'],
                [sequelize.fn('COUNT', sequelize.literal('CASE WHEN churn_date IS NOT NULL THEN 1 END')), 'churned_count']
            ],
            raw: true
        });

        return res.status(200).json({
            status: 'success',
            data: {
                tracking,
                statistics: {
                    average_retention_months: parseFloat(aggregateStats[0].avg_months).toFixed(2),
                    total_revenue: parseFloat(aggregateStats[0].total_revenue),
                    active_users: parseInt(aggregateStats[0].active_count),
                    churned_users: parseInt(aggregateStats[0].churned_count)
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Error in getRetentionTracking:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    getReferralOverview,
    getAllReferrals,
    getReferralById,
    updateReferralStatus,
    getAllTiers,
    getTierById,
    createTier,
    updateTier,
    deleteTier,
    getAllRewards,
    getAllClaims,
    getAllLinks,
    getAllFraudLogs,
    reviewFraudCase,
    getRetentionTracking
};