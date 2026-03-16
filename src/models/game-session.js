const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const GameSession = sequelize.define(
    'GameSession',
    {
        id: {
            type: DataTypes.STRING(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        game_type: {
            type: DataTypes.ENUM('flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder'),
            allowNull: false
        },
        mode: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Game mode: practice, test, challenge, etc.'
        },
        class_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'classes',
                key: 'id'
            }
        },
        topic_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Topic being practiced'
        },
        difficulty: {
            type: DataTypes.ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2'),
            allowNull: true,
            comment: 'CEFR difficulty level'
        },
        progress_current: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Current question number'
        },
        progress_total: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total questions in session'
        },
        correct_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        incorrect_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        status: {
            type: DataTypes.ENUM('active', 'completed', 'abandoned'),
            allowNull: false,
            defaultValue: 'active'
        },
        started_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        completed_at: {
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
    },
    {
        tableName: 'game_sessions',
        timestamps: false,
        indexes: [
            {
                fields: ['user_id']
            },
            {
                fields: ['class_id']
            },
            {
                fields: ['status']
            },
            {
                fields: ['game_type']
            }
        ]
    }
);

module.exports = GameSession;