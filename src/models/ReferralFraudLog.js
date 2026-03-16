const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ReferralFraudLog = sequelize.define(
    'ReferralFraudLog',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        referee_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        referral_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        referrer_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        fraud_type: {
            type: DataTypes.ENUM('duplicate_email', 'duplicate_phone', 'duplicate_card', 'suspicious_pattern'),
            allowNull: false
        },
        fraud_score: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        details: {
            type: DataTypes.JSON,
            allowNull: true
        },
        is_blocked: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        reviewed_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        reviewed_at: {
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
        tableName: 'referral_fraud_logs',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralFraudLog;