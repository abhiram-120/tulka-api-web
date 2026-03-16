const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const GameApproval = sequelize.define(
    'GameApproval',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        class_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: 'Reference to classes table'
        },
        teacher_id: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Teacher who approved the game'
        },
        student_id: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Student for whom the game was approved'
        },
        zoom_summary_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
            comment: 'Reference to zoom summary if available'
        },
        lesson_number: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
            comment: 'Lesson number'
        },
        fill_in_blank: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Approved fill-in-the-blank exercises with approval status'
        },
        flashcards: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Approved flashcards with approval status'
        },
        spelling: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Approved spelling exercises with approval status'
        },
        quality_score: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
            comment: 'Quality score from the original data'
        },
        approved_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total number of approved exercises'
        },
        rejected_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total number of rejected exercises'
        }
    },
    {
        tableName: 'game_approvals',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true
    }
);

module.exports = GameApproval;

