const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const UserReview = sequelize.define('user_review', {
    id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    creator_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    instructor_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        defaultValue: null,
    },
    content_quality: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    instructor_skills: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    purchase_worth: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    support_quality: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    rates: {
        type: DataTypes.STRING(10), // char(10) in MySQL
        allowNull: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    description: {
        type: DataTypes.TEXT, // text in MySQL
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    created_at: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('pending', 'active'), // enum in MySQL
        allowNull: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        default: 'pending',
    },
}, {
    tableName: 'user_reviews',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    timestamps: false, // Assuming you don't have 'created_at' and 'updated_at' fields
});

module.exports = UserReview;
