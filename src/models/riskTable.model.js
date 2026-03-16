const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection'); // adjust path as needed

const RiskTable = sequelize.define(
    'risk_table',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        student_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            unique: true
        },
        teacher_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        rep_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        risk_level: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'low'
        },
        risk_score: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        recurring_risk: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        contact_status: {
            type: DataTypes.ENUM('not_contacted', 'whatsapp', 'called', 'no_answer', 'follow_up', 'resolved'),
            defaultValue: 'not_contacted'
        },
        recurring_lessons: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        subscription_type: {
            type: DataTypes.STRING(50),
            allowNull: true
        },

        learning_duration: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Learning duration in months'
        },
        payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: 'unknown'
        },

        total_paid: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0.0
        },
        risk_events: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: []
        },
        added_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        family_linked: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        next_class_date: {
            type: DataTypes.DATE,
            allowNull: true
        }
    },
    {
        tableName: 'risk_table',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
);

module.exports = RiskTable;
