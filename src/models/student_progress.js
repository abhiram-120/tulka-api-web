const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentProgress = sequelize.define(
    'StudentProgress',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
            references: {
                model: 'users',
                key: 'id'
            },
            onDelete: 'CASCADE',
            comment: 'Foreign key to users table'
        },
        current_level: {
            type: DataTypes.STRING(20),
            allowNull: true,
            defaultValue: 'A1',
            comment: 'CEFR level: A1, A2, B1, B2, C1, C2'
        },
        total_points: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total points earned by student'
        },
        total_classes: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total number of classes attended'
        },
        vocabulary_mastered: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of vocabulary words mastered'
        },
        grammar_concepts_learned: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of grammar concepts learned'
        },
        games_played: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total number of games played'
        },
        last_updated: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: DataTypes.NOW,
            comment: 'Last time progress was updated'
        }
    },
    {
        tableName: 'student_progress',
        timestamps: false,
        indexes: [
            {
                name: 'idx_student_id',
                unique: true,
                fields: ['student_id']
            },
            {
                name: 'idx_current_level',
                fields: ['current_level']
            },
            {
                name: 'idx_total_points',
                fields: ['total_points']
            }
        ]
    }
);

module.exports = StudentProgress;