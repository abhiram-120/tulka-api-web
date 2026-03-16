const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const RiskRules = sequelize.define(
    'risk_rules',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        event_type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        display_name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        default_points: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        default_valid_days: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null
        },
        conditions: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: []
        },
        impact_level: {
            type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
            allowNull: false,
            defaultValue: 'low'
        },
        is_auto: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        }
    },
    { tableName: 'risk_rules', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at' }
);

module.exports = RiskRules;
