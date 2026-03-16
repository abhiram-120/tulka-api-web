const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Game = sequelize.define(
    'Game',
    {
        id: {
            type: DataTypes.STRING(36), // Changed from INTEGER to STRING for UUID
            primaryKey: true,
            allowNull: false,
            comment: 'UUID primary key'
        },
        class_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'classes',
                key: 'id'
            }
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        exercise_type: {
            type: DataTypes.ENUM('flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder'),
            allowNull: false,
            comment: 'Type of exercise/game'
        },
        exercise_data: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Game-specific content (questions, answers, etc.) based on exercise_type'
        },
        // game_option_item_id: {
        //     type: DataTypes.INTEGER,
        //     allowNull: true,
        //     references: {
        //         model: 'game_option_items',
        //         key: 'id'
        //     },
        //     onUpdate: 'CASCADE',
        //     onDelete: 'SET NULL',
        //     comment: 'Links to the specific topic/lesson item from game_option_items'
        // },
        topic_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Associated topic/category ID (legacy field, not used)'
        },
        topic_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Name of the topic (legacy field, not used)'
        },
        difficulty: {
            type: DataTypes.ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2'),
            allowNull: true,
            comment: 'CEFR difficulty level'
        },
        hint: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Optional hint text'
        },
        explanation: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Explanation of answer/concept'
        },
        status: {
            type: DataTypes.ENUM('pending', 'approved', 'rejected'),
            allowNull: false,
            defaultValue: 'pending',
            comment: 'Review/approval status'
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        exercise_explanation: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'UI explanation shown on game cards based on exercise type'
        }
    },
    {
        tableName: 'games',
        timestamps: false,
        indexes: [
            {
                fields: ['student_id']
            },
            {
                fields: ['class_id']
            },
            {
                fields: ['exercise_type']
            },
            {
                fields: ['status']
            },
            // {
            //     fields: ['game_option_item_id']
            // },
            {
                // fields: ['student_id', 'exercise_type', 'status', 'game_option_item_id'],
                fields: ['student_id', 'exercise_type', 'status'],
                name: 'idx_student_type_status_item'
            }
        ]
    }
);

module.exports = Game;
