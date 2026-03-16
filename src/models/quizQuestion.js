const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const QuizQuestion = sequelize.define('quiz_questions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    prompt: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    correct_option_id: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    explanation: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    difficulty: {
        type: DataTypes.STRING(20),
        allowNull: true
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

module.exports = QuizQuestion;