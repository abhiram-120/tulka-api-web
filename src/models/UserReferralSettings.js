const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserReferralSettings = sequelize.define(
    'UserReferralSettings',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true
        },
        user_tag: {
            type: DataTypes.ENUM('regular', 'partnership', 'custom'),
            defaultValue: 'regular'
        },
        custom_rules: {
            type: DataTypes.JSON,
            allowNull: true
        },
        reward_multiplier: {
            type: DataTypes.DECIMAL(5, 2),
            defaultValue: 1.00
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
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
        tableName: 'user_referral_settings',
        timestamps: false,
        underscored: true
    }
);

module.exports = UserReferralSettings;