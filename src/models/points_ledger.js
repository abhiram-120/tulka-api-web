const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const PointsLedger = sequelize.define(
    'PointsLedger',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            onDelete: 'CASCADE',
            comment: 'Foreign key to users table'
        },
        points: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: 'Points earned (positive) or deducted (negative)'
        },
        source_type: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'Type of activity: game, class, achievement, bonus, penalty, etc.'
        },
        source_id: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'ID of the source (game_session_id, class_id, etc.)'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Description of how points were earned/deducted'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            comment: 'When the points were awarded'
        }
    },
    {
        tableName: 'points_ledger',
        timestamps: false,
        indexes: [
            {
                name: 'idx_student_id',
                fields: ['student_id']
            },
            {
                name: 'idx_source_type',
                fields: ['source_type']
            },
            {
                name: 'idx_created_at',
                fields: ['created_at']
            },
            {
                name: 'idx_student_source',
                fields: ['student_id', 'source_type']
            }
        ]
    }
);

module.exports = PointsLedger;