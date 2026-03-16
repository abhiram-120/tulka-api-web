// models/Salesperson.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Salesperson = sequelize.define(
    'Salesperson',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        role_type: {
            type: DataTypes.ENUM('sales_role', 'sales_appointment_setter'),
            allowNull: false
        },
        action_type: {
            type: DataTypes.ENUM('trial_class', 'regular_class', 'subscription', 'payment_link', 'student_registration'),
            allowNull: false
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        class_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        subscription_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        subscription_type: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        subscription_value: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        trial_converted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        conversion_source: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        lead_source: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        appointment_time: {
            type: DataTypes.DATE,
            allowNull: true
        },
        appointment_duration: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        success_status: {
            type: DataTypes.ENUM('successful', 'cancelled', 'no_show'),
            allowNull: true
        },
        profitability_status: {
            type: DataTypes.ENUM('profitable', 'not_profitable'),
            allowNull: true
        },
        revenue_generated: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00
        },
        commission_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        commission_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true
        },
        cost_incurred: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00
        },
        meeting_type: {
            type: DataTypes.ENUM('online', 'in_person'),
            allowNull: false
        },
        calls_made: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0
        },
        call_duration: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: 0
        },
        efficiency_score: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        peak_hour_status: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW
        }
    },
    {
        tableName: 'salesperson',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: 'idx_user_id',
                fields: ['user_id']
            },
            {
                name: 'idx_student_id',
                fields: ['student_id']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

module.exports = Salesperson;