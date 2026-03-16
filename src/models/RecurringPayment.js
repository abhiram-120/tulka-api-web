// models/RecurringPayment.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const User = require('./users');

const RecurringPayment = sequelize.define(
    'RecurringPayment',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Student making the payment'
        },
        managed_by_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'User (sales/admin) managing this student'
        },
        managed_by_role: {
            type: DataTypes.ENUM('sales', 'admin', 'teacher'),
            allowNull: false,
            comment: 'Role managing the student'
        },
        subscription_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Linked subscription ID if applicable'
        },
        payplus_transaction_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus transaction unique identifier'
        },
        payplus_page_request_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus page request unique identifier'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Payment amount'
        },
        currency: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'ILS',
            comment: 'Currency code (ILS, USD, EUR, GBP)'
        },
        payment_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Recurring deduction date'
        },
        status: {
            type: DataTypes.ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded'),
            allowNull: false,
            defaultValue: 'pending',
            comment: 'Recurring payment status'
        },
        transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus transaction ID'
        },
        next_payment_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Next recurring billing date'
        },
        recurring_frequency: {
            type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
            defaultValue: 'monthly',
            comment: 'How often the payment recurs'
        },
        recurring_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Number of successful recurring payments made'
        },
        max_recurring_count: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Maximum number of recurring payments (null = unlimited)'
        },
        booked_monthly_classes: {
            type: DataTypes.TINYINT(1),
            allowNull: false,
            defaultValue: 0,
            comment: '0 = Not booked, 1 = Booked'
        },
        payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used'
        },
        card_last_digits: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Last 4 digits of card used'
        },
        failure_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason for payment failure'
        },
        failure_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Number of consecutive failures'
        },
        webhook_data: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'PayPlus webhook data related to this payment'
        },
        pricing_info: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Stores pricing information when PayPlus recurring payment is updated (original_price, final_price, discount, discount_amount, etc.)'
        },
        remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes or remarks'
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            comment: 'Whether this recurring payment is active'
        },
        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the recurring payment was cancelled'
        },
        cancelled_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'User who cancelled the recurring payment'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Record creation timestamp'
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Record update timestamp'
        }
    },
    {
        tableName: 'recurring_payments',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        charset: 'utf8mb4',
        collate: 'utf8mb4_general_ci',
        indexes: [
            {
                name: 'idx_student_id',
                fields: ['student_id']
            },
            {
                name: 'idx_managed_by_id',
                fields: ['managed_by_id']
            },
            {
                name: 'idx_status',
                fields: ['status']
            },
            {
                name: 'idx_payment_date',
                fields: ['payment_date']
            },
            {
                name: 'idx_next_payment_date',
                fields: ['next_payment_date']
            },
            {
                name: 'idx_payplus_transaction_uid',
                fields: ['payplus_transaction_uid']
            },
            {
                name: 'idx_is_active',
                fields: ['is_active']
            }
        ]
    }
);

// Define associations
RecurringPayment.belongsTo(User, { foreignKey: 'student_id', as: 'Student' });
RecurringPayment.belongsTo(User, { foreignKey: 'managed_by_id', as: 'ManagedBy' });
RecurringPayment.belongsTo(User, { foreignKey: 'cancelled_by', as: 'CancelledBy' });

module.exports = RecurringPayment;