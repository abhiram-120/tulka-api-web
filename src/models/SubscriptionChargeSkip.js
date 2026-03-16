// src/models/SubscriptionChargeSkip.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SubscriptionChargeSkip = sequelize.define(
    'SubscriptionChargeSkip',
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
        skip_months: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        skip_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        skip_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        reason_category: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Category of skip reason (financial_issue, complete_existing_lessons, customer_request, technical_issue, other)'
        },
        created_by_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        skip_type: {
            type: DataTypes.ENUM('months', 'custom'),
            allowNull: false,
            defaultValue: 'months'
        },
        custom_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        custom_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        lesson_policy: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: 'no_new_lessons',
            comment: 'Lesson policy during skip period (no_new_lessons, continue_lessons)'
        },
        lesson_amount_during_skip: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Number of lessons per month during skip if continuing lessons'
        },
        // NEW: Additional admin functionality
        admin_notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional admin notes for the charge skip'
        },
        notify_student: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: 'Whether to notify student about the charge skip'
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        }
    },
    {
        tableName: 'subscription_charge_skips',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = SubscriptionChargeSkip;