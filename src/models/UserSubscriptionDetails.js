const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserSubscriptionDetails = sequelize.define(
    'UserSubscriptionDetails',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null
        },
        payment_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'payment_transactions',
                key: 'id'
            },
            comment: 'PaymentTransaction ID for the subscription payment'
        },
        type: {
            type: DataTypes.STRING(50),
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        each_lesson: {
            type: DataTypes.STRING(20),
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        renew_date: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        weekly_comp_class: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        how_often: {
            type: DataTypes.STRING(80),
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        weekly_lesson: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
        status: {
            type: DataTypes.STRING(80),
            collate: 'utf8mb4_unicode_ci',
            defaultValue: null
        },
        lesson_min: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
        left_lessons: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        balance: {
            type: DataTypes.DECIMAL(10, 0),
            defaultValue: 0
        },
        lesson_reset_at: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        cost_per_lesson: {
            type: DataTypes.DECIMAL(10, 0),
            defaultValue: 0
        },
        is_cancel: {
            type: DataTypes.TINYINT,
            defaultValue: 0
        },
        inactive_after_renew: {
            type: DataTypes.TINYINT,
            defaultValue: 0,
            comment: 'Flag to indicate if subscription should become inactive after renewal'
        },
        bonus_class: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        bonus_completed_class: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        bonus_expire_date: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        data_of_bonus_class: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'JSON array storing historical bonus class data with refresh tracking'
        },
        discount_data: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'JSON object storing discount information: {type: "percentage"|"fixed", value: number, reason: string, appliedBy: number, appliedAt: string}'
        },
        plan_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'subscription_plans',
                key: 'id'
            }
        },
        // New offline payment fields
        offline_payment_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason for offline payment when marked by admin'
        },
        offline_payment_admin_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Admin who marked the payment as offline'
        },
        offline_payment_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Date when payment was marked as offline'
        },
        payment_status: {
            type: DataTypes.ENUM('online', 'offline', 'pending', 'failed'),
            defaultValue: 'pending',
            comment: 'Payment status of the subscription'
        },
        cancellation_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Date and time when the plan was cancelled'
        },
        cancelled_by_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'User ID of the person who cancelled (student or admin)'
        },
        // cancellation_reason_category: {
        //     type: DataTypes.ENUM(
        //         'cost_too_high',
        //         'time_constraints',
        //         'not_satisfied_with_teaching',
        //         'technical_issues',
        //         'found_alternative',
        //         'personal_reasons',
        //         'temporary_break',
        //         'completed_goals',
        //         'payment_issues',
        //         'other'
        //     ),
        //     allowNull: true,
        //     comment: 'Predefined cancellation reason category'
        // },
        cancellation_reason_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'cancellation_reason_categories',
                key: 'id'
            },
            comment: 'User-selected cancellation reason (FK)'
        },

        cancellation_reason: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Detailed cancellation reason, free text'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes about the subscription'
        }
    },
    {
        tableName: 'user_subscription_details',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = UserSubscriptionDetails;
