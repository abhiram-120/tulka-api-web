// middleware/check-permission.js
const SupportUserPermission = require('../models/supportUserPermissions');
const SupportPermission = require('../models/supportPermissions');
const { Op } = require('sequelize');

/**
 * Middleware factory to check if user has specific permissions
 * @param {string} resource - The resource to check permission for
 * @param {string} action - The action to check permission for (create, read, update, delete)
 * @returns {Function} Express middleware function
 */
const checkPermission = (resource, action = 'read') => {
    return async (req, res, next) => {
        try {
            // Admin users have all permissions
            if (req.isAdmin) {
                return next();
            }

            // Check if user is a support agent
            if (!req.isSupportAgent) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Insufficient permissions'
                });
            }

            // Check if support agent has the specific permission
            const permission = await SupportUserPermission.findOne({
                where: {
                    user_id: req.userId,
                    resource: resource,
                    action: action,
                    granted: true,
                    [Op.or]: [
                        { expires_at: null },
                        { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                    ]
                }
            });

            if (!permission) {
                return res.status(403).json({
                    status: 'error',
                    message: `You don't have permission to ${action} ${resource}`
                });
            }

            next();

        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Permission validation failed'
            });
        }
    };
};

/**
 * Middleware to check if user has any permission for a resource
 * @param {string} resource - The resource to check permission for
 * @returns {Function} Express middleware function
 */
const hasAnyPermission = (resource) => {
    return async (req, res, next) => {
        try {
            // Admin users have all permissions
            if (req.isAdmin) {
                return next();
            }

            // Check if user is a support agent
            if (!req.isSupportAgent) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Insufficient permissions'
                });
            }

            // Check if support agent has any permission for the resource
            const permission = await SupportUserPermission.findOne({
                where: {
                    user_id: req.userId,
                    resource: resource,
                    granted: true,
                    [Op.or]: [
                        { expires_at: null },
                        { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                    ]
                }
            });

            if (!permission) {
                return res.status(403).json({
                    status: 'error',
                    message: `You don't have permission to access ${resource}`
                });
            }

            next();

        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Permission validation failed'
            });
        }
    };
};

/**
 * Middleware to check multiple permissions (user needs ALL of them)
 * @param {Array} permissions - Array of {resource, action} objects
 * @returns {Function} Express middleware function
 */
const checkMultiplePermissions = (permissions) => {
    return async (req, res, next) => {
        try {
            // Admin users have all permissions
            if (req.isAdmin) {
                return next();
            }

            // Check if user is a support agent
            if (!req.isSupportAgent) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Insufficient permissions'
                });
            }

            // Check all required permissions
            const permissionChecks = permissions.map(({ resource, action }) => 
                SupportUserPermission.findOne({
                    where: {
                        user_id: req.userId,
                        resource: resource,
                        action: action,
                        granted: true,
                        [Op.or]: [
                            { expires_at: null },
                            { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                        ]
                    }
                })
            );

            const results = await Promise.all(permissionChecks);
            
            // Check if any permission is missing
            const missingPermissions = permissions.filter((_, index) => !results[index]);
            
            if (missingPermissions.length > 0) {
                const missingList = missingPermissions.map(p => `${p.action} ${p.resource}`).join(', ');
                return res.status(403).json({
                    status: 'error',
                    message: `Missing required permissions: ${missingList}`
                });
            }

            next();

        } catch (error) {
            console.error('Multiple permissions check error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Permission validation failed'
            });
        }
    };
};

module.exports = {
    checkPermission,
    hasAnyPermission,
    checkMultiplePermissions
};