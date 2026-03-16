const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SupportPermission = sequelize.define(
    'SupportPermission',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Permission name (e.g., create_students, read_teachers)'
        },
        resource: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'Resource type (e.g., students, teachers, classes)'
        },
        action: {
            type: DataTypes.ENUM('create', 'read', 'update', 'delete'),
            allowNull: false,
            comment: 'Action type that can be performed on the resource'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Human readable description of the permission'
        },
        created_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        },
        updated_at: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: () => Math.floor(Date.now() / 1000)
        }
    },
    {
        tableName: 'support_permissions',
        timestamps: false,
        underscored: true,
        indexes: [
            {
                unique: true,
                fields: ['resource', 'action'],
                name: 'support_permissions_resource_action_unique'
            },
            {
                fields: ['resource'],
                name: 'support_permissions_resource_index'
            },
            {
                fields: ['action'],
                name: 'support_permissions_action_index'
            },
            {
                fields: ['name'],
                name: 'support_permissions_name_index'
            }
        ],
        // Add hooks for automatic timestamp updates
        hooks: {
            beforeUpdate: (permission, options) => {
                permission.updated_at = Math.floor(Date.now() / 1000);
            }
        }
    }
);

module.exports = SupportPermission;