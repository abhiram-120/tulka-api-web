const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ReferralNotification = sequelize.define(
    'ReferralNotification',
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
        notification_type: {
            type: DataTypes.ENUM('whatsapp', 'in_app', 'popup'),
            allowNull: false
        },
        notification_event: {
            type: DataTypes.ENUM('friend_joined', 'reward_received', 'tier_upgraded'),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'sent', 'failed'),
            defaultValue: 'pending'
        },
        sent_at: {
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
        tableName: 'referral_notifications',
        timestamps: false,
        underscored: true
    }
);

module.exports = ReferralNotification;