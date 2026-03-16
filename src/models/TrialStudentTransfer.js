const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialStudentTransfer = sequelize.define(
    'TrialStudentTransfer',
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
        appointment_setter_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'ID of the appointment setter who initiated the transfer'
        },
        sales_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'ID of the sales user the student is transferred to'
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to users table if student already has an account'
        },
        student_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Name of the student being transferred'
        },
        student_email: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Email of the student'
        },
        student_phone: {
            type: DataTypes.STRING(32),
            allowNull: true,
            comment: 'Phone number of the student'
        },
        priority_level: {
            type: DataTypes.ENUM('Low', 'Medium', 'High'),
            allowNull: false,
            defaultValue: 'Medium',
            comment: 'Priority level for this transfer'
        },
        transfer_status: {
            type: DataTypes.ENUM('pending', 'accepted', 'rejected'),
            allowNull: false,
            defaultValue: 'pending'
        },
        transfer_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'When the transfer was initiated'
        },
        response_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the sales user responded to the transfer'
        },
        rejection_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason if the transfer was rejected'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes about the transfer'
        },
        follow_up_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Date for follow-up if needed'
        },
        is_flagged: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Flag for special attention'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW
        }
    },
    {
        tableName: 'trial_student_transfers',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: 'idx_trial_class_id',
                fields: ['trial_class_id']
            },
            {
                name: 'idx_appointment_setter_id',
                fields: ['appointment_setter_id']
            },
            {
                name: 'idx_sales_user_id',
                fields: ['sales_user_id']
            },
            {
                name: 'idx_transfer_status',
                fields: ['transfer_status']
            },
            {
                name: 'idx_transfer_date',
                fields: ['transfer_date']
            }
        ]
    }
);

module.exports = TrialStudentTransfer;