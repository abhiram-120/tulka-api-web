// src/models/PastDuePayment.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PastDuePayment = sequelize.define(
    'PastDuePayment',
    {
        id: {
            type: DataTypes.INTEGER,
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
        subscription_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        recurring_payment_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        currency: {
            type: DataTypes.STRING(10),
            defaultValue: 'ILS'
        },
        failed_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        due_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        grace_period_days: {
            type: DataTypes.INTEGER,
            defaultValue: 30
        },
        grace_period_expires_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('past_due', 'resolved', 'canceled'),
            defaultValue: 'past_due'
        },
        attempt_number: {
            type: DataTypes.INTEGER,
            defaultValue: 1
        },
        last_reminder_sent_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        total_reminders_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        whatsapp_messages_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Count of WhatsApp messages sent for this payment recovery'
        },
        short_id: {
            type: DataTypes.STRING(16),
            allowNull: true,
            comment: 'Short identifier used in recovery URLs for this past due payment'
        },
        payment_link: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        payplus_page_request_uid: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        resolved_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        resolved_transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        resolved_payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used for manual resolution (free_gift, bit, bank_transfer, cash, other)'
        },
        canceled_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        cancellation_reason_category: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Category of cancellation reason'
        },
        cancellation_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Detailed cancellation reason text'
        },
        // Error tracking fields
        failure_status_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'PayPlus status code for the failed payment'
        },
        failure_message_description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'PayPlus message description for the failed payment'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    },
    {
        tableName: 'past_due_payments',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = PastDuePayment;