const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ManualEventLog = sequelize.define(
    'ManualEventLog',
    {
        event_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        event_type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        action: {
            type: DataTypes.ENUM('create', 'update', 'delete'),
            defaultValue: 'create'
        },
        old_data: {
            type: DataTypes.JSONB,
            allowNull: true
        },
        new_data: {
            type: DataTypes.JSONB,
            allowNull: true
        }
    },
    {
        tableName: 'manual_event_logs',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false
    }
);

module.exports = ManualEventLog;
