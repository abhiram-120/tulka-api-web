const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');


const ReferralRetentionTracking = sequelize.define(
    
    'ReferralRetentionTracking',
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
        referrer_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        subscription_start_date: {
            type: DataTypes.BIGINT,
            allowNull: false
        },
        subscription_end_date: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        total_months_active: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        total_revenue_generated: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00
        },
        is_currently_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        churn_date: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        updated_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        }
    },
    {
        tableName: 'referral_retention_tracking',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralRetentionTracking;