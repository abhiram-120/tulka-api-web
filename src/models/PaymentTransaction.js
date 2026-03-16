// models/PaymentTransaction.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const User = require('./users');
const SubscriptionPlan = require('./subscription_plan');
const SubscriptionDuration = require('./subscription_duration');

const PaymentTransaction = sequelize.define(
    'PaymentTransaction',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        token: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Unique token to identify the payment transaction'
        },
        transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Payment processor transaction ID'
        },
        student_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Reference to the student/user who made the payment'
        },
        student_email: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Email of the student making the payment'
        },
        student_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Name of the student making the payment'
        },
        plan_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'subscription_plans',
                key: 'id'
            },
            comment: 'Reference to subscription plan if using predefined plan'
        },
        lessons_per_month: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Number of lessons per month in the subscription'
        },
        duration_type: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'subscription_durations',
                key: 'id'
            },
            comment: 'Reference to subscription duration type'
        },
        lesson_minutes: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Duration of each lesson in minutes'
        },
        custom_months: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Custom duration in months for custom plans'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Payment amount'
        },
        currency: {
            type: DataTypes.STRING(10),
            defaultValue: 'ILS',
            comment: 'Currency code (ILS, USD, EUR, GBP)'
        },
        is_recurring: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether this is a recurring payment'
        },
        generated_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'ID of the user/salesperson who generated this payment link'
        },
        status: {
            type: DataTypes.ENUM('success', 'failed', 'pending', 'refunded'),
            defaultValue: 'pending',
            comment: 'Status of the payment transaction'
        },
        payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used (credit card type, etc.)'
        },
        card_last_digits: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Last 4 digits of the credit card used'
        },
        error_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Error code from payment processor if payment failed'
        },
        error_message: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Error message from payment processor if payment failed'
        },
        payment_processor: {
            type: DataTypes.ENUM('tranzila', 'payplus'),
            defaultValue: 'payplus',
            allowNull: false,
            comment: 'Payment processor used for this transaction'
        },
        response_data: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Full response data from payment processor'
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when the transaction was created'
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when the transaction was last updated'
        },
        refund_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            comment: 'Amount refunded (last refund if multiple)'
        },
        refund_type: {
            type: DataTypes.ENUM('full', 'partial'),
            allowNull: true,
            comment: 'Refund type'
        },
        refund_reason: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: 'Reason for refund'
        },
        refund_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when refund was processed'
        },
        lessons_deducted: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Number of lessons deducted during refund'
        },
        subscription_action: {
            type: DataTypes.ENUM('continue', 'cancel_immediate', 'cancel_renewal'),
            allowNull: true,
            comment: 'Action taken on subscription during refund'
        },
        refund_processed_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'ID of admin who processed the refund'
        },
        refund_processed_by_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Name of admin who processed the refund'
        },
        email_notification_sent: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether refund email notification was sent'
        },
        custom_refund_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Custom reason provided for refund'
        },
        acknowledged_used_lessons: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether admin acknowledged student used some lessons being refunded'
        }
    },
    {
        tableName: 'payment_transactions',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

// Define associations
PaymentTransaction.belongsTo(User, { foreignKey: 'student_id', as: 'Student' });
PaymentTransaction.belongsTo(User, { foreignKey: 'generated_by', as: 'Generator' });
PaymentTransaction.belongsTo(SubscriptionPlan, { foreignKey: 'plan_id', as: 'Plan' });
PaymentTransaction.belongsTo(SubscriptionDuration, { foreignKey: 'duration_type', as: 'Duration' });

module.exports = PaymentTransaction;