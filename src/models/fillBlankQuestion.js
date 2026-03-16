const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FillBlankQuestion = sequelize.define('fill_blank_questions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    sentence: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    missing_word: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    translation: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    hint: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    example: {
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

module.exports = FillBlankQuestion;