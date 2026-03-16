const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

// Constants for better maintainability
const REWARD_TYPES = {
  FREE_LESSONS: 'free_lessons',
  FREE_MONTHS: 'free_months',
  DISCOUNT: 'discount',
  CASH: 'cash',
  CASH_AND_SUBSCRIPTION: 'cash_and_subscription'
};

const ReferralTierClaim = sequelize.define(
    'ReferralTierClaim',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users', // Assuming you have a users table
                key: 'id'
            }
        },
        
        tier_level: {
            type: DataTypes.INTEGER,
            allowNull: false,
            validate: {
                min: 1
            }
        },
        tier_name: {
            type: DataTypes.STRING(50),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [1, 50]
            }
        },
        reward_type: {
            type: DataTypes.ENUM(Object.values(REWARD_TYPES)),
            allowNull: false
        },
        reward_value: {
            type: DataTypes.JSON,
            allowNull: false,
            validate: {
                isValidRewardValue(value) {
                    if (typeof value !== 'object' || value === null) {
                        throw new Error('Reward value must be a valid JSON object');
                    }
                }
            },
            comment: 'Stores reward details like {count: 1} or {amount: 200, duration: "3_months"}'
        },
        claim_receipt_id: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true,
                len: [1, 50]
            }
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            validate: {
                len: [0, 1000] //length validation for notes
            }
        },
        claimed_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000),
            validate: {
                isInt: true,
                min: 0
            }
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000),
            validate: {
                isInt: true,
                min: 0
            }
        }
    },
    {
        tableName: 'referral_tier_claims',
        timestamps: false,
        underscored: true,
        indexes: [
            {
                unique: true,
                fields: ['user_id', 'tier_level'],
                name: 'unique_user_tier' // Named index for better identification
            },
            {
                fields: ['user_id'], // Additional index for user queries
                name: 'idx_user_id'
            },
            {
                fields: ['claimed_at'], // Index for time-based queries
                name: 'idx_claimed_at'
            }
        ]
    }
);

// Add instance methods
ReferralTierClaim.prototype.getRewardDetails = function() {
  return this.reward_value;
};

ReferralTierClaim.prototype.isCashReward = function() {
  return this.reward_type === REWARD_TYPES.CASH || 
         this.reward_type === REWARD_TYPES.CASH_AND_SUBSCRIPTION;
};

module.exports = {
  ReferralTierClaim,
  REWARD_TYPES
};