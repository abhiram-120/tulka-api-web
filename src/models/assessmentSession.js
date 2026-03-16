const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const AssessmentSession = sequelize.define('assessment_sessions', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    status: {
        type: DataTypes.ENUM('started', 'submitted'),
        allowNull: false,
        defaultValue: 'started'
    },
    question_ids: {
        type: DataTypes.JSON,
        allowNull: false
    },
    answers: {
        type: DataTypes.JSON,
        allowNull: true
    },
    total_questions: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    correct_count: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    score_percent: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true
    },
    started_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    submitted_at: {
        type: DataTypes.DATE,
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

module.exports = AssessmentSession;
