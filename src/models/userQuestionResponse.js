// Complete userQuestionResponse.js file with associations

const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserQuestionResponse = sequelize.define(
    'UserQuestionResponse',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        question_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        response_text: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        selected_options: {
            type: DataTypes.JSON,
            allowNull: true,
            get() {
                const rawValue = this.getDataValue('selected_options');
                
                if (rawValue && typeof rawValue === 'string') {
                    try {
                        return JSON.parse(rawValue);
                    } catch (e) {
                        return rawValue;
                    }
                }
                return rawValue;
            },
            set(value) {
                if (value && (typeof value === 'object' || Array.isArray(value))) {
                    this.setDataValue('selected_options', JSON.stringify(value));
                } else {
                    this.setDataValue('selected_options', value);
                }
            }
        },
        question_type: {
            type: DataTypes.ENUM('single-choice', 'multiple-choice', 'checkbox', 'yes-no', 'text'),
            allowNull: false
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            onUpdate: DataTypes.NOW
        }
    },
    {
        tableName: 'user_question_responses',
        timestamps: false,
        underscored: true,
        collate: 'utf8mb4_unicode_ci',
        hooks: {
            beforeCreate: (response) => {
                if (response.selected_options && (typeof response.selected_options === 'object' || Array.isArray(response.selected_options))) {
                    response.selected_options = JSON.stringify(response.selected_options);
                }
            },
            beforeUpdate: (response) => {
                if (response.selected_options && (typeof response.selected_options === 'object' || Array.isArray(response.selected_options))) {
                    response.selected_options = JSON.stringify(response.selected_options);
                }
            }
        }
    }
);

// 🆕 NEW: Association setup
// This will be set up when the models are initialized
// The association will be defined in a separate place to avoid circular dependencies

module.exports = UserQuestionResponse;