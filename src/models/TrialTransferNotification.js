// models/TrialTransferNotification.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialTransferNotification = sequelize.define(
    'TrialTransferNotification',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        transfer_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            comment: 'Reference to trial_student_transfers table'
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'User receiving the notification'
        },
        user_role: {
            type: DataTypes.ENUM('appointment_setter', 'sales_user', 'admin'),
            allowNull: false
        },
        notification_type: {
            type: DataTypes.ENUM(
                'new_transfer',
                'transfer_accepted',
                'transfer_rejected',
                'payment_link_sent',
                'payment_received',
                'follow_up_reminder'
            ),
            allowNull: false
        },
        is_read: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        read_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'trial_transfer_notifications',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            {
                name: 'idx_user_id',
                fields: ['user_id']
            },
            {
                name: 'idx_is_read',
                fields: ['is_read']
            }
        ]
    }
);

module.exports = TrialTransferNotification;