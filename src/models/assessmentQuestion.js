const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const AssessmentQuestion = sequelize.define('assessment_questions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    question: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    question_type: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    difficulty_level: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    skill_focus: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    options: {
        type: DataTypes.JSON,
        allowNull: false
    },
    correct_answer: {
        type: DataTypes.JSON,
        allowNull: false
    },
    image_url: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    audio_url: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    explanation: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    disabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false
});

module.exports = AssessmentQuestion;
