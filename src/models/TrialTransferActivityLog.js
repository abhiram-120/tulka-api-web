const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialTransferActivityLog = sequelize.define(
    'TrialTransferActivityLog',
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
            comment: 'User who performed the action'
        },
        user_role: {
            type: DataTypes.ENUM('appointment_setter', 'sales_user', 'admin'),
            allowNull: false
        },
        activity_type: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'Type of activity performed'
        },
        details: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Details of the activity'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'trial_transfer_activity_log',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            {
                name: 'idx_transfer_id',
                fields: ['transfer_id']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

module.exports = TrialTransferActivityLog;