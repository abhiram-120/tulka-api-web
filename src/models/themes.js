const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Theme = sequelize.define(
    'Theme',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        version: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: '1.0.0'
        },
        organization_id: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        last_updated: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        app_name: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        support_email: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        phone_number: {
            type: DataTypes.STRING(20),
            allowNull: true
        },
        app_logo: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        app_favicon: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        about_app: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        terms_conditions: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    },
    {
        tableName: 'themes',
        timestamps: false,
        indexes: [
            {
                fields: ['organization_id']
            },
            {
                fields: ['last_updated']
            },
            {
                fields: ['app_name']
            },
            {
                fields: ['support_email']
            },
            {
                fields: ['phone_number']
            }
        ]
    }
);

module.exports = Theme;
