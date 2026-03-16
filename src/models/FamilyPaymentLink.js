// models/FamilyPaymentLink.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FamilyPaymentLink = sequelize.define(
    'FamilyPaymentLink',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        link_token: {
            type: DataTypes.STRING(64),
            allowNull: false,
            unique: true,
            comment: 'Unique token for this payment link'
        },
        sales_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Sales person who generated the link'
        },
        selected_children_ids: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Legacy field - replaced by selected_children_details'
        },
        selected_children_details: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Array of selected children with their subscription details for payment'
        },
        total_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Total payment amount'
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'USD',
            comment: 'Payment currency'
        },
        payment_type: {
            type: DataTypes.ENUM('one_time', 'recurring'),
            allowNull: false,
            comment: 'Type of payment'
        },
        description: {
            type: DataTypes.STRING(500),
            allowNull: false,
            comment: 'Payment description'
        },
        custom_note: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Custom note for the payment'
        },
        payplus_payment_url: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'PayPlus payment URL'
        },
        payplus_page_request_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus page request UID'
        },
        payplus_qr_code: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'PayPlus QR code image URL'
        },
        status: {
            type: DataTypes.ENUM('active', 'used', 'expired', 'cancelled'),
            defaultValue: 'active',
            comment: 'Payment link status'
        },
        expires_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the payment link expires'
        },
        used_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When the payment link was used'
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            allowNull: false
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            allowNull: false
        }
    },
    {
        tableName: 'family_payment_links',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        indexes: [
            {
                unique: true,
                name: 'unique_link_token',
                fields: ['link_token']
            },
            {
                name: 'idx_sales_user_id',
                fields: ['sales_user_id']
            },
            {
                name: 'idx_status',
                fields: ['status']
            },
            {
                name: 'idx_payment_type',
                fields: ['payment_type']
            },
            {
                name: 'idx_expires_at',
                fields: ['expires_at']
            },
            {
                name: 'idx_payplus_page_request_uid',
                fields: ['payplus_page_request_uid']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

module.exports = FamilyPaymentLink;