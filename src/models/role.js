const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Role = sequelize.define(
    'Role',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(64),
            allowNull: false
        },
        caption: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        users_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        is_admin: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        }
    },
    {
        tableName: 'roles',
        timestamps: false,
        underscored: true
    }
);

module.exports = Role;