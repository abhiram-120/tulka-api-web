const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ClassSummary = sequelize.define(
    'ClassSummary',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        class_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
            references: {
                model: 'classes',
                key: 'id'
            }
        },
        summary_text: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        topics_detected: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null
        },
        vocabulary_learned: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null
        },
        grammar_concepts: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null
        },
        strengths: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        areas_for_improvement: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        engagement_level: {
            type: DataTypes.STRING(20),
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'class_summaries',
        timestamps: false,
        indexes: [
            {
                unique: true,
                fields: ['class_id']
            },
            {
                fields: ['class_id', 'created_at']
            }
        ]
    }
);

module.exports = ClassSummary;