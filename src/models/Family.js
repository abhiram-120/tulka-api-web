const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Family = sequelize.define(
    'Family',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        parent_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Full name of the parent/guardian'
        },
        parent_email: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Parent email address'
        },
        parent_phone: {
            type: DataTypes.STRING(32),
            allowNull: true,
            comment: 'Parent phone number'
        },
        parent_country_code: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Country code for phone'
        },
        parent_address: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Family address'
        },
        family_notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes about the family'
        },
        status: {
            type: DataTypes.ENUM('active', 'pending', 'suspended', 'cancelled'),
            defaultValue: 'pending',
            comment: 'Family account status'
        },
        created_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Sales person who created this family'
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
        tableName: 'families',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        indexes: [
            {
                name: 'idx_parent_email',
                fields: ['parent_email']
            },
            {
                name: 'idx_created_by',
                fields: ['created_by']
            },
            {
                name: 'idx_status',
                fields: ['status']
            }
        ]
    }
);

const FamilyChild = sequelize.define(
    'FamilyChild',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to families table'
        },
        child_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Child full name'
        },
        child_age: {
            type: DataTypes.INTEGER(3),
            allowNull: false,
            comment: 'Child age'
        },
        child_email: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Child email address'
        },
        relationship_to_parent: {
            type: DataTypes.ENUM('son', 'daughter', 'stepson', 'stepdaughter', 'nephew', 'niece', 'grandson', 'granddaughter', 'other'),
            allowNull: false,
            comment: 'Relationship to parent/guardian'
        },
        subscription_type: {
            type: DataTypes.ENUM('monthly', 'quarterly', 'yearly'),
            allowNull: true,
            comment: 'Subscription billing type - set during payment generation'
        },
        durationmonths: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Duration Months'
        },
        monthly_amount: {
            type: DataTypes.DECIMAL(8, 2),
            allowNull: true,
            comment: 'Monthly subscription amount for this child - set during payment'
        },
        custom_amount: {
            type: DataTypes.DECIMAL(8, 2),
            allowNull: true,
            comment: 'Custom amount if different from standard pricing'
        },
        status: {
            type: DataTypes.ENUM('active', 'paused', 'cancelled', 'pending'),
            defaultValue: 'pending',
            comment: 'Child subscription status'
        },
        payplus_subscription_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus subscription ID for this child'
        },
        subscription_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'When subscription started'
        },
        next_payment_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Next payment due date'
        },
        last_payment_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Last successful payment date'
        },
        child_notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Notes specific to this child'
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
        tableName: 'family_children',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        indexes: [
            {
                name: 'idx_family_id',
                fields: ['family_id']
            },
            {
                name: 'idx_status',
                fields: ['status']
            },
            {
                name: 'idx_subscription_type',
                fields: ['subscription_type']
            },
            {
                name: 'idx_relationship',
                fields: ['relationship_to_parent']
            },
        ]
    }
);

// Updated FamilyCartItem to include subscription details for payment generation
const FamilyCartItem = sequelize.define(
    'FamilyCartItem',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        sales_user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Sales person who added to cart'
        },
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to families table'
        },
        child_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to family_children table'
        },
        selected: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            comment: 'Whether this child is selected in cart'
        },
        cart_subscription_type: {
            type: DataTypes.ENUM('monthly', 'quarterly', 'yearly'),
            allowNull: true,
            comment: 'Subscription type selected in cart for payment generation'
        },
        cart_custom_amount: {
            type: DataTypes.DECIMAL(8, 2),
            allowNull: true,
            comment: 'Custom amount set in cart for this child'
        },
        added_at: {
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
        tableName: 'family_cart_items',
        timestamps: true,
        createdAt: 'added_at',
        updatedAt: 'updated_at',
        underscored: true,
        indexes: [
            {
                unique: true,
                name: 'unique_cart_child',
                fields: ['sales_user_id', 'child_id']
            },
            {
                name: 'idx_sales_user_id',
                fields: ['sales_user_id']
            },
            {
                name: 'idx_family_id',
                fields: ['family_id']
            }
        ]
    }
);

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
            }
        ]
    }
);

// FamilyPaymentTransaction model (for tracking completed payments)
const FamilyPaymentTransaction = sequelize.define(
    'FamilyPaymentTransaction',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        payment_link_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to family_payment_links'
        },
        transaction_token: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
            comment: 'Unique transaction token'
        },
        payplus_transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'PayPlus transaction ID'
        },
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Reference to families table'
        },
        paid_children_ids: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Array of child IDs that were paid for'
        },
        student_ids: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Array of student IDs associated with this payment transaction	'
        },
        subscription_ids: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Array of UserSubscriptionDetails IDs created for this payment'
        },
        paid_children_details: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Detailed information about paid children with their subscription types'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Payment amount'
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
        status: {
            type: DataTypes.ENUM('success', 'failed', 'pending', 'refunded'),
            defaultValue: 'pending',
            comment: 'Transaction status'
        },
        payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used'
        },
        card_last_digits: {
            type: DataTypes.STRING(4),
            allowNull: true,
            comment: 'Last 4 digits of card'
        },
        payplus_response_data: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Full PayPlus response data'
        },
        error_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Error code if failed'
        },
        error_message: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Error message if failed'
        },
        processed_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'When payment was processed'
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
        tableName: 'family_payment_transactions',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        indexes: [
            {
                unique: true,
                name: 'unique_transaction_token',
                fields: ['transaction_token']
            },
            {
                name: 'idx_payment_link_id',
                fields: ['payment_link_id']
            },
            {
                name: 'idx_payplus_transaction_id',
                fields: ['payplus_transaction_id']
            },
            {
                name: 'idx_family_id',
                fields: ['family_id']
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
                name: 'idx_processed_at',
                fields: ['processed_at']
            }
        ]
    }
);

// FamilyActivityLog model (for audit trail and activity tracking)
const FamilyActivityLog = sequelize.define(
    'FamilyActivityLog',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to families table'
        },
        child_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Reference to family_children table if child-specific'
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'User who performed the action'
        },
        action_type: {
            type: DataTypes.ENUM(
                'family_created', 
                'child_added', 
                'child_removed', 
                'child_status_changed',
                'child_subscription_updated',
                'payment_generated', 
                'payment_completed', 
                'subscription_modified', 
                'cart_updated',
                'cart_subscription_configured'
            ),
            allowNull: false,
            comment: 'Type of action performed'
        },
        action_description: {
            type: DataTypes.STRING(500),
            allowNull: false,
            comment: 'Human-readable description of the action'
        },
        old_values: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Previous values before change'
        },
        new_values: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'New values after change'
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Additional metadata about the action'
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            allowNull: false
        }
    },
    {
        tableName: 'family_activity_log',
        timestamps: false,
        underscored: true,
        indexes: [
            {
                name: 'idx_family_id',
                fields: ['family_id']
            },
            {
                name: 'idx_child_id',
                fields: ['child_id']
            },
            {
                name: 'idx_user_id',
                fields: ['user_id']
            },
            {
                name: 'idx_action_type',
                fields: ['action_type']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            }
        ]
    }
);

// Export all models
module.exports = { 
    Family, 
    FamilyChild, 
    FamilyCartItem, 
    FamilyPaymentLink,
    FamilyPaymentTransaction,
    FamilyActivityLog
};