const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Word = sequelize.define(
    'Word',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        list_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'word_lists',
                key: 'id'
            }
        },
        word: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        translation: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        is_favorite: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'User can mark word as favorite'
        },
        practice_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total times word was practiced'
        },
        correct_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Times answered correctly'
        },
        accuracy: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
            defaultValue: 0.00,
            comment: 'Accuracy percentage (0-100)'
        },
        last_practiced: {
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
        tableName: 'words',
        timestamps: false,
        indexes: [
            {
                fields: ['list_id']
            },
            {
                fields: ['accuracy']
            },
            {
                fields: ['last_practiced']
            },
            {
                fields: ['is_favorite']
            }
        ]
    }
);

module.exports = Word;