const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SupportUserPermission = sequelize.define(
    'SupportUserPermission',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'Foreign key to users table'
        },
        permission_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'support_permissions',
                key: 'id'
            },
            comment: 'Foreign key to support_permissions table (nullable for direct resource/action assignments)'
        },
        resource: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Resource name (can be used without permission_id for direct assignments)'
        },
        action: {
            type: DataTypes.ENUM('create', 'read', 'update', 'delete'),
            allowNull: true,
            comment: 'Action type (can be used without permission_id for direct assignments)'
        },
        granted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Whether the permission is granted (true) or denied (false)'
        },
        granted_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            comment: 'ID of the admin who granted this permission'
        },
        granted_at: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Timestamp when permission was granted'
        },
        expires_at: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Optional expiration timestamp for temporary permissions'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Optional notes about why this permission was granted/denied'
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
        tableName: 'support_user_permissions',
        timestamps: false,
        underscored: true,
        indexes: [
            {
                fields: ['user_id'],
                name: 'support_user_permissions_user_id_index'
            },
            {
                fields: ['permission_id'],
                name: 'support_user_permissions_permission_id_index'
            },
            {
                unique: true,
                fields: ['user_id', 'resource', 'action'],
                name: 'support_user_permissions_user_resource_action_unique'
            },
            {
                fields: ['granted_by'],
                name: 'support_user_permissions_granted_by_index'
            },
            {
                fields: ['expires_at'],
                name: 'support_user_permissions_expires_at_index'
            },
            {
                fields: ['granted'],
                name: 'support_user_permissions_granted_index'
            }
        ],
        // Add validation to ensure either permission_id OR (resource + action) is provided
        validate: {
            eitherPermissionIdOrResourceAction() {
                if (!this.permission_id && (!this.resource || !this.action)) {
                    throw new Error('Either permission_id must be provided OR both resource and action must be provided');
                }
            }
        },
        // Add hooks for automatic timestamp updates and permission tracking
        hooks: {
            beforeUpdate: (userPermission, options) => {
                userPermission.updated_at = Math.floor(Date.now() / 1000);
            },
            beforeCreate: (userPermission, options) => {
                // Set granted_at timestamp if permission is granted
                if (userPermission.granted && !userPermission.granted_at) {
                    userPermission.granted_at = Math.floor(Date.now() / 1000);
                }
            },
            beforeUpdate: (userPermission, options) => {
                // Update granted_at timestamp if permission status changes to granted
                if (userPermission.granted && userPermission.changed('granted') && !userPermission.granted_at) {
                    userPermission.granted_at = Math.floor(Date.now() / 1000);
                }
            }
        }
    }
);

// Instance methods for easier permission checking
SupportUserPermission.prototype.isExpired = function() {
    if (!this.expires_at) return false;
    return Math.floor(Date.now() / 1000) > this.expires_at;
};

SupportUserPermission.prototype.isActive = function() {
    return this.granted && !this.isExpired();
};

// Static methods for common queries
SupportUserPermission.getUserPermissions = async function(userId, options = {}) {
    const whereClause = {
        user_id: userId,
        granted: true
    };

    // Filter out expired permissions unless explicitly requested
    if (!options.includeExpired) {
        whereClause[sequelize.Op.or] = [
            { expires_at: null },
            { expires_at: { [sequelize.Op.gt]: Math.floor(Date.now() / 1000) } }
        ];
    }

    return await this.findAll({
        where: whereClause,
        include: options.include || []
    });
};

SupportUserPermission.hasPermission = async function(userId, resource, action) {
    const permission = await this.findOne({
        where: {
            user_id: userId,
            resource: resource,
            action: action,
            granted: true,
            [sequelize.Op.or]: [
                { expires_at: null },
                { expires_at: { [sequelize.Op.gt]: Math.floor(Date.now() / 1000) } }
            ]
        }
    });
    
    return !!permission;
};

module.exports = SupportUserPermission;