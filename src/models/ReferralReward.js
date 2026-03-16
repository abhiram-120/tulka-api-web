const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ReferralReward = sequelize.define(
    'ReferralReward',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        referral_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        user_type: {
            type: DataTypes.ENUM('referrer', 'referee'),
            allowNull: false
        },
        
        reward_type: {
            type: DataTypes.ENUM('free_lessons', 'free_months', 'discount', 'cash'),
            allowNull: false
        },
        reward_value: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        tier_level: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'granted', 'expired'),
            defaultValue: 'pending'
        },
        granted_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        expires_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        }
    },
    {
        tableName: 'referral_rewards',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralReward;