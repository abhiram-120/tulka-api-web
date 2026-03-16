const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');


const Referral = sequelize.define(
    'Referral',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        referrer_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        referee_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        invite_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'validated', 'rewarded', 'fraud'),
            defaultValue: 'pending'
        },
        tier_at_signup: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        subscription_value: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00
        },
        first_payment_at: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        is_paying_user: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        fraud_flags: {
            type: DataTypes.JSON,
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
        tableName: 'referrals',
        timestamps: false,
        underscored: true
    }
);


module.exports = Referral;
