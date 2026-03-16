const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const ThemeColor = sequelize.define(
    'ThemeColor',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        theme_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'themes',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        theme_type: {
            type: DataTypes.ENUM('light', 'dark'),
            allowNull: false
        },
        color_name: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        color_value: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'theme_colors',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                unique: true,
                fields: ['theme_id', 'theme_type', 'color_name']
            },
            {
                fields: ['theme_id', 'theme_type']
            }
        ]
    }
);

module.exports = ThemeColor;