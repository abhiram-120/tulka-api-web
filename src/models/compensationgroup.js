const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const CompensationGroup = sequelize.define(
    'CompensationGroup',
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },

        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },

        levels: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Array of levels with hourly rates'
        },

        eligible_kpis: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {},
            comment: 'Eligibility KPIs per level (lessons, hours, retention rate)'
        },

        bonus_rules: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Bonus slabs with thresholds and amounts'
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },

        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'USD'
        },

        pay_cycle: {
            type: DataTypes.ENUM('monthly', 'half_monthly'),
            allowNull: false,
            defaultValue: 'monthly'
        },

        created_at: {
            type: DataTypes.DATE,
            allowNull: false
        },

        updated_at: {
            type: DataTypes.DATE,
            allowNull: false
        }
    },
    {
        tableName: 'compensation_groups',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true
    }
);

module.exports = CompensationGroup;
