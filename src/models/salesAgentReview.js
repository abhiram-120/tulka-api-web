// models/SalesAgentReview.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SalesAgentReview = sequelize.define(
    'SalesAgentReview',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        sales_agent_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'ID of the sales agent being reviewed'
        },
        reviewer_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'ID of the user submitting the review'
        },
        reviewer_role: {
            type: DataTypes.ENUM('teacher', 'student', 'admin', 'sales_appointment_setter'),
            allowNull: false,
            comment: 'Role of the person submitting the review'
        },
        trial_class_id: {
            type: DataTypes.BIGINT(20),
            allowNull: true,
            comment: 'ID of the trial class this review is associated with (if applicable)'
        },
        communication_rating: {
            type: DataTypes.INTEGER(11),
            allowNull: false,
            comment: 'Rating for communication skills (1-5 stars)'
        },
        behavior_rating: {
            type: DataTypes.INTEGER(11),
            allowNull: false,
            comment: 'Rating for professional behavior (1-5 stars)'
        },
        support_quality_rating: {
            type: DataTypes.INTEGER(11),
            allowNull: false,
            comment: 'Rating for quality of support provided (1-5 stars)'
        },
        responsiveness_rating: {
            type: DataTypes.INTEGER(11),
            allowNull: false,
            comment: 'Rating for response time and availability (1-5 stars)'
        },
        knowledge_rating: {
            type: DataTypes.INTEGER(11),
            allowNull: false,
            comment: 'Rating for product and course knowledge (1-5 stars)'
        },
        overall_rating: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
            comment: 'Automatically calculated average of all rating criteria'
        },
        review_comment: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional text comments provided with the review'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when the review was created'
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'Timestamp when the review was last updated'
        }
    },
    {
        tableName: 'sales_agent_reviews',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        comment: 'Stores detailed reviews and ratings for sales agents across multiple criteria',
        indexes: [
            {
                name: 'PRIMARY',
                fields: ['id']
            },
            {
                name: 'idx_sales_agent_id',
                fields: ['sales_agent_id']
            },
            {
                name: 'idx_reviewer_id',
                fields: ['reviewer_id']
            },
            {
                name: 'idx_trial_class_id',
                fields: ['trial_class_id']
            }
        ]
    }
);

module.exports = SalesAgentReview;