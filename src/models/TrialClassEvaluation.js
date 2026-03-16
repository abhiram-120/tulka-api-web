// models/TrialClassEvaluation.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const TrialClassEvaluation = sequelize.define(
    'TrialClassEvaluation',
    {
        id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true
        },
        trial_class_registrations_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            comment: 'Reference to trial_class_registrations table'
        },
        plan_recommendation: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Recommended learning plan for the student'
        },
        send_evaluation: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Status of evaluation sent to student/parent'
        },
        pdf_file: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Path to PDF evaluation file if generated'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Detailed evaluation notes'
        },
        student_level: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Assessed level of the student (e.g., A1, B2, etc.)'
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'trial_class_evaluations',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        comment: 'Stores evaluation details for trial classes',
        indexes: [
            {
                name: 'idx_trial_class_registrations_id',
                fields: ['trial_class_registrations_id']
            }
        ]
    }
);

module.exports = TrialClassEvaluation;