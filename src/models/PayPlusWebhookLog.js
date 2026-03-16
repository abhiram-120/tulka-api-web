// models/PayPlusWebhookLog.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PayPlusWebhookLog = sequelize.define(
    'PayPlusWebhookLog',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        transaction_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus transaction unique identifier'
        },
        page_request_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus page request unique identifier'
        },
        event_type: {
            type: DataTypes.ENUM('payment_success', 'payment_failure', 'subscription_created', 'subscription_cancelled', 'refund', 'chargeback'),
            allowNull: false,
            comment: 'Type of webhook event received'
        },
        status_code: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'PayPlus status code (000 = success)'
        },
        status_description: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus status description'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            comment: 'Transaction amount'
        },
        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Currency code (ILS, USD, EUR, GBP)'
        },
        customer_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Customer name from PayPlus'
        },
        customer_email: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Customer email from PayPlus'
        },
        customer_phone: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Customer phone from PayPlus'
        },
        payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used'
        },
        four_digits: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Last four digits of card'
        },
        approval_number: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'PayPlus approval number'
        },
        invoice_number: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'PayPlus invoice number'
        },
        more_info: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Additional info field from PayPlus'
        },
        more_info_1: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Additional info field 1 from PayPlus'
        },
        more_info_2: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Additional info field 2 from PayPlus'
        },
        more_info_3: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Additional info field 3 from PayPlus'
        },
        more_info_4: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Additional info field 4 from PayPlus'
        },
        more_info_5: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional info field 5 (encoded data) from PayPlus'
        },
        is_test: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether this is a test transaction'
        },
        raw_webhook_data: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Complete raw webhook payload from PayPlus'
        },
        processed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether this webhook has been processed'
        },
        processing_error: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Error message if processing failed'
        },
        linked_payment_transaction_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'payment_transactions',
                key: 'id'
            },
            comment: 'Reference to related payment transaction'
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when webhook was received'
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when webhook was last updated'
        }
    },
    {
        tableName: 'payplus_webhook_logs',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci',
        indexes: [
            {
                name: 'idx_transaction_uid',
                fields: ['transaction_uid']
            },
            {
                name: 'idx_page_request_uid',
                fields: ['page_request_uid']
            },
            {
                name: 'idx_event_type',
                fields: ['event_type']
            },
            {
                name: 'idx_processed',
                fields: ['processed']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

module.exports = PayPlusWebhookLog;