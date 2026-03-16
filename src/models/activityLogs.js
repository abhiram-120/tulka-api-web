const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ActivityLog = sequelize.define(
    'ActivityLog',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },

        entity_type: {
            type: DataTypes.ENUM('salary', 'compensation_group', 'group_level', 'bonus', 'penalty', 'payslip'),
            allowNull: false
        },

        entity_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },

        action_type: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        performed_by: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },

        before_value: {
            type: DataTypes.JSON,
            allowNull: true
        },

        after_value: {
            type: DataTypes.JSON,
            allowNull: true
        },

        action: {
            type: DataTypes.JSON,
            allowNull: true
        },

        source: {
            type: DataTypes.ENUM('admin', 'system'),
            defaultValue: 'admin'
        }
    },
    {
        tableName: 'activity_logs',
        timestamps: true,
        createdAt: 'created_at', // ✅ map correctly
        updatedAt: false
    }
);

module.exports = ActivityLog;
