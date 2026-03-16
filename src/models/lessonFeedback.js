const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection'); // Initialize Sequelize and provide your instance here

const LessonFeedback = sequelize.define('lesson_feedbacks', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    student_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    lesson_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    pronunciation: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    speaking: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    comment: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    grammar_rate: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    pronunciation_rate: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    speaking_rate: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    grammar: {
        type: DataTypes.TEXT,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
}, {
    timestamps: false,
    // Define any additional options for the model here
});

module.exports = LessonFeedback;