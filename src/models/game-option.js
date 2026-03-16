const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const GameOption = sequelize.define(
    'GameOption',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        game_type: {
            type: DataTypes.ENUM('flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder'),
            allowNull: false
        },
        option_key: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'topic, lesson, mistakes, mixed'
        },
        option_label: {
            type: DataTypes.STRING(100),
            allowNull: false,
            comment: 'Display name: By Topic, By Lesson, etc.'
        },
        option_description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        icon_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Icon/image URL for the option'
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Display order in UI'
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
        tableName: 'game_options',
        timestamps: false,
        indexes: [
            { fields: ['game_type'] },
            { fields: ['is_active'] },
            { fields: ['game_type', 'is_active'] }
        ]
    }
);

module.exports = GameOption;
