const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ReferralTier = sequelize.define(
    'ReferralTier',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        tier_name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        tier_level: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        min_referrals: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        max_referrals: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        
        referee_reward_type: {
            type: DataTypes.ENUM('free_lessons', 'free_months', 'discount', 'cash'),
            allowNull: false
        },
        referee_reward_value: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        referrer_reward_type: {
            type: DataTypes.ENUM('free_lessons', 'free_months', 'discount', 'cash'),
            allowNull: false
        },
        referrer_reward_value: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        },
        updated_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        }
    },
    {
        tableName: 'referral_tiers',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralTier;