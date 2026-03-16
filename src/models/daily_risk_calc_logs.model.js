const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const DailyRiskCalcLog = sequelize.define(
    'DailyRiskCalcLog',
    {
        run_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        end_time: {
            type: DataTypes.DATE
        },
        total_students: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        affected_students: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        created_events: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        job_status: {
            type: DataTypes.ENUM('completed', 'failed'),
            defaultValue: 'completed'
        },
        notes: {
            type: DataTypes.TEXT
        }
    },
    {
        tableName: 'daily_risk_calc_logs',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false
    }
);

module.exports = DailyRiskCalcLog;
