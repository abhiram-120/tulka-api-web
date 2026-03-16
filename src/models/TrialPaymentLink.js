const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialPaymentLink = sequelize.define(
    'TrialPaymentLink',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        transfer_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            comment: 'Reference to the trial_student_transfers table'
        },
        trial_class_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            comment: 'Reference to the trial_class_registrations table'
        },
        sales_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Sales user who created the payment link'
        },
        subscription_plan_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'The subscription plan being offered'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Amount to be paid'
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'ILS',
            allowNull: false,
            comment: 'Currency code'
        },
        link_token: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Unique token for the payment link'
        },
        payment_url: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Full URL of the payment link'
        },
        payment_status: {
            type: DataTypes.ENUM('pending', 'paid', 'expired', 'cancelled'),
            allowNull: false,
            defaultValue: 'pending'
        },
        sent_via_email: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether link was sent via email'
        },
        sent_via_whatsapp: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether link was sent via WhatsApp'
        },
        email_sent_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the email was sent'
        },
        whatsapp_sent_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the WhatsApp message was sent'
        },
        expiry_date: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'When the payment link expires'
        },
        payment_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When payment was completed'
        },
        payment_reference: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Reference ID from payment processor'
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
        tableName: 'trial_payment_links',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: 'idx_transfer_id',
                fields: ['transfer_id']
            },
            {
                name: 'idx_trial_class_id',
                fields: ['trial_class_id']
            },
            {
                name: 'idx_sales_user_id',
                fields: ['sales_user_id']
            },
            {
                name: 'idx_payment_status',
                fields: ['payment_status']
            },
            {
                name: 'idx_link_token',
                fields: ['link_token']
            }
        ]
    }
);

module.exports = TrialPaymentLink;