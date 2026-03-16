const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const StudentRiskHistory = sequelize.define(
    'student_risk_history',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        risk_level: {
            type: DataTypes.STRING,
            allowNull: false
        },
        total_points: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        snapshot_json: {
            type: DataTypes.STRING,
            allowNull: false
        }
    },
    { tableName: 'student_risk_history', timestamps: true, underscore: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);

module.exports = StudentRiskHistory;
