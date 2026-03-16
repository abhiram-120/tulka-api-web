// models/TrialClassStatusHistory.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialClassStatusHistory = sequelize.define(
    'TrialClassStatusHistory',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        trial_class_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            comment: 'Reference to trial_class_registrations table'
        },
        previous_status: {
            type: DataTypes.ENUM(
                'trial_1',
                'trial_2',
                'trial_2_paid',
                'trial_3',
                'trial_3_paid',
                'waiting_for_answer',
                'payment_sent',
                'new_enroll',
                'follow_up',
                'not_relevant',
                'waiting_for_payment',
                'cancelled'
            ),
            allowNull: true, // Allow null for initial creation
            comment: 'Previous trial class status'
        },
        new_status: {
            type: DataTypes.ENUM(
                'trial_1',
                'trial_2',
                'trial_2_paid',
                'trial_3',
                'trial_3_paid',
                'waiting_for_answer',
                'payment_sent',
                'new_enroll',
                'follow_up',
                'not_relevant',
                'waiting_for_payment'
            ),
            allowNull: false,
            comment: 'New trial class status'
        },
        changed_by_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'ID of the user who made the change'
        },
        changed_by_type: {
            type: DataTypes.ENUM('system', 'admin', 'sales_role','sales_appointment_setter'),
            allowNull: false,
            defaultValue: 'admin',
            comment: 'Type of user who made the change'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Optional notes about the status change'
        },
        attendance_change: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'JSON object containing attendance change details if applicable'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when the status change was recorded'
        }
    },
    {
        tableName: 'trial_class_status_history',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false, // We don't need updated_at for history records
        indexes: [
            {
                name: 'idx_trial_class_id',
                fields: ['trial_class_id']
            },
            {
                name: 'idx_changed_by_id',
                fields: ['changed_by_id']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

module.exports = TrialClassStatusHistory;