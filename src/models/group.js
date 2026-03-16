const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Group = sequelize.define(
    'Group',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        creator_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING(128),
            allowNull: false
        },
        discount: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        commission: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive'),
            defaultValue: 'active'
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        }
    },
    {
        tableName: 'groups',
        timestamps: false,
        underscored: true
    }
);

module.exports = Group;