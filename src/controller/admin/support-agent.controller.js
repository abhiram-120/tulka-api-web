const User = require('../../models/users');
const Role = require('../../models/role');
const SupportUserPermission = require('../../models/supportUserPermissions');
const SupportPermission = require('../../models/supportPermissions');
const { Op, Sequelize } = require('sequelize');
const moment = require('moment-timezone');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * Get support agents with filtering and pagination
 */
async function getSupportAgents(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            status = 'all',
            role = 'all',
            accessLevel = 'all'
        } = req.query;

        // Base where conditions for all support agents
        const whereConditions = {
            role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
        };

        // Search conditions
        if (search) {
            whereConditions[Op.or] = [
                { full_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { role_name: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status.toLowerCase() !== 'all') {
            whereConditions.status = status.toLowerCase();
        }

        // Role filter
        if (role && role !== 'all') {
            const roleMap = {
                'Support Agent': 'support_agent',
                'Senior Support': 'senior_support',
                'Support Lead': 'support_lead'
            };
            whereConditions.role_name = roleMap[role] || role.toLowerCase().replace(' ', '_');
        }

        const shouldFilterAccessLevel = accessLevel && accessLevel.toLowerCase() !== 'all';

        // Query options - including permissions
        const queryOptions = {
            where: whereConditions,
            include: [
                {
                    model: Role,
                    as: 'Role',
                    attributes: ['id', 'name', 'caption', 'is_admin'],
                    required: false
                },
                {
                    model: SupportUserPermission,
                    as: 'UserPermissions',
                    required: false,
                    where: { 
                        granted: true,
                        [Op.or]: [
                            { expires_at: null },
                            { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                        ]
                    },
                    include: [{
                        model: SupportPermission,
                        as: 'Permission',
                        attributes: ['id', 'name', 'resource', 'action'],
                        required: false
                    }]
                }
            ],
            attributes: [
                'id', 'full_name', 'email', 'avatar', 'role_name', 'status',
                'created_at', 'updated_at', 'role_id'
            ],
            order: [['id', 'DESC']],
            distinct: true
        };

        if (!shouldFilterAccessLevel) {
            queryOptions.offset = (page - 1) * limit;
            queryOptions.limit = parseInt(limit);
        }

        const { count, rows } = await User.findAndCountAll(queryOptions);

        // Format support agents with permission data
        const supportAgents = rows.map(agent => {
            // Format role name for display
            const roleDisplayNames = {
                'support_agent': 'Support Agent',
                'senior_support': 'Senior Support',
                'support_lead': 'Support Lead'
            };

            // Calculate time since creation
            const createdAt = agent.created_at 
                ? moment.unix(agent.created_at).fromNow()
                : 'Unknown';

            // Calculate permissions - handle both direct permissions and permission-based permissions
            const permissions = agent.UserPermissions || [];
            const permissionCounts = {
                create: permissions.filter(p => {
                    const action = p.Permission?.action || p.action;
                    return action === 'create' && p.granted === true;
                }).length,
                read: permissions.filter(p => {
                    const action = p.Permission?.action || p.action;
                    return action === 'read' && p.granted === true;
                }).length,
                update: permissions.filter(p => {
                    const action = p.Permission?.action || p.action;
                    return action === 'update' && p.granted === true;
                }).length,
                delete: permissions.filter(p => {
                    const action = p.Permission?.action || p.action;  
                    return action === 'delete' && p.granted === true;
                }).length
            };

            // Calculate access level based on granted permissions
            const totalModels = 8; // Adjust based on your system (students, teachers, classes, payments, reports, dashboard, users, settings)
            const grantedPermissions = permissions.filter(p => p.granted === true);
            const uniqueResources = [...new Set(grantedPermissions.map(p => p.Permission?.resource || p.resource))];
            const accessibleModels = Math.min(totalModels, uniqueResources.length);

            return {
                id: agent.id.toString(),
                name: agent.full_name || 'N/A',
                email: agent.email || 'N/A',
                avatar: agent.avatar,
                role: roleDisplayNames[agent.role_name] || agent.role_name,
                role_name: agent.role_name,
                status: agent.status || 'active',
                totalModels: totalModels,
                accessibleModels: accessibleModels,
                permissions: permissionCounts,
                createdAt: createdAt,
                created_at: agent.created_at,
                updated_at: agent.updated_at,
                role_details: agent.Role ? {
                    id: agent.Role.id,
                    name: agent.Role.name,
                    caption: agent.Role.caption,
                    is_admin: agent.Role.is_admin
                } : null
            };
        });

        let filteredAgents = supportAgents;
        if (shouldFilterAccessLevel) {
            const normalizeAccessLevel = (val) => (val || '').toString().toLowerCase();
            const accessLevelNormalized = normalizeAccessLevel(accessLevel);

            filteredAgents = supportAgents.filter((agent) => {
                const percent = agent.totalModels > 0
                    ? (agent.accessibleModels / agent.totalModels) * 100
                    : 0;

                if (accessLevelNormalized === 'full access') return percent >= 80;
                if (accessLevelNormalized === 'partial access') return percent >= 50 && percent < 80;
                if (accessLevelNormalized === 'limited access') return percent >= 25 && percent < 50;
                if (accessLevelNormalized === 'restricted') return percent < 25;
                return true;
            });
        }

        let pagedAgents = filteredAgents;
        let totalCount = count;

        if (shouldFilterAccessLevel) {
            totalCount = filteredAgents.length;
            const offset = (page - 1) * limit;
            pagedAgents = filteredAgents.slice(offset, offset + parseInt(limit));
        }

        return res.status(200).json({
            status: 'success',
            message: 'Support agents fetched successfully',
            data: {
                agents: pagedAgents,
                pagination: {
                    total: totalCount,
                    current_page: parseInt(page),
                    total_pages: Math.ceil(totalCount / limit),
                    per_page: parseInt(limit)
                },
                summary: {
                    total_agents: totalCount,
                    active_agents: filteredAgents.filter(a => a.status === 'active').length,
                    inactive_agents: filteredAgents.filter(a => a.status === 'inactive').length,
                    pending_agents: filteredAgents.filter(a => a.status === 'pending').length,
                    by_role: {
                        support_agent: filteredAgents.filter(a => a.role_name === 'support_agent').length,
                        senior_support: filteredAgents.filter(a => a.role_name === 'senior_support').length,
                        support_lead: filteredAgents.filter(a => a.role_name === 'support_lead').length
                    }
                }
            }
        });

    } catch (err) {
        console.error('Error fetching support agents:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch support agents',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Create a new support agent
 */
async function createSupportAgent(req, res) {
    const transaction = await User.sequelize.transaction();
    
    try {
        const { name, email, password, role, permissions } = req.body;

        // Validation
        if (!name || !email || !password || !role) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Name, email, password, and role are required'
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Password validation
        if (password.length < 8) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 8 characters long'
            });
        }

        // Check if email already exists
        const existingUser = await User.findOne({
            where: { email: email },
            transaction
        });

        if (existingUser) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Email already exists'
            });
        }

        // Map role to role_name
        const roleMap = {
            'Support Agent': 'support_agent',
            'Senior Support': 'senior_support',
            'Support Lead': 'support_lead'
        };

        const roleName = roleMap[role] || 'support_agent';

        // Get role ID
        let roleRecord = await Role.findOne({
            where: { name: roleName },
            transaction
        });

        if (!roleRecord) {
            // Create role if doesn't exist
            roleRecord = await Role.create({
                name: roleName,
                display_name: role,
                description: `${role} role`
            }, { transaction });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create support agent
        const supportAgent = await User.create({
            full_name: name,
            email: email,
            password: hashedPassword,
            role_name: roleName,
            role_id: roleRecord.id,
            status: 'active',
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        // Add default permissions if provided
        if (permissions && typeof permissions === 'object') {
            const permissionPromises = [];
            
            Object.keys(permissions).forEach(action => {
                if (Array.isArray(permissions[action])) {
                    permissions[action].forEach(resource => {
                        permissionPromises.push(
                            SupportUserPermission.create({
                                user_id: supportAgent.id,
                                permission_id: null, // You might need to map this to actual permission IDs
                                resource: resource,
                                action: action,
                                granted: true
                            }, { transaction })
                        );
                    });
                }
            });

            await Promise.all(permissionPromises);
        }

        await transaction.commit();

        return res.status(201).json({
            status: 'success',
            message: 'Support agent created successfully',
            data: {
                id: supportAgent.id,
                name: supportAgent.full_name,
                email: supportAgent.email,
                role: role,
                status: supportAgent.status
            }
        });

    } catch (err) {
        await transaction.rollback();
        console.error('Error creating support agent:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create support agent',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get support agent details
 */
async function getSupportAgentDetails(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            include: [
                {
                    model: Role,
                    as: 'Role',
                    attributes: ['id', 'name', 'caption', 'is_admin'],
                    required: false
                },
                {
                    model: SupportUserPermission,
                    as: 'UserPermissions',
                    required: false,
                    include: [{
                        model: SupportPermission,
                        as: 'Permission',
                        attributes: ['id', 'name', 'resource', 'action']
                    }, {
                        model: User,
                        as: 'GrantedByUser',
                        attributes: ['id', 'full_name', 'email'],
                        required: false
                    }]
                }
            ],
            attributes: [
                'id', 'full_name', 'email', 'avatar', 'role_name', 'status',
                'created_at', 'updated_at', 'role_id'
            ]
        });

        if (!supportAgent) {
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        // Format response
        const roleDisplayNames = {
            'support_agent': 'Support Agent',
            'senior_support': 'Senior Support',
            'support_lead': 'Support Lead'
        };

        const permissions = supportAgent.UserPermissions || [];
        
        // Filter only granted and non-expired permissions
        const activePermissions = permissions.filter(p => {
            const isGranted = p.granted === true;
            const isNotExpired = !p.expires_at || p.expires_at > Math.floor(Date.now() / 1000);
            return isGranted && isNotExpired;
        });

        const permissionCounts = {
            create: activePermissions.filter(p => (p.Permission?.action || p.action) === 'create').length,
            read: activePermissions.filter(p => (p.Permission?.action || p.action) === 'read').length,
            update: activePermissions.filter(p => (p.Permission?.action || p.action) === 'update').length,
            delete: activePermissions.filter(p => (p.Permission?.action || p.action) === 'delete').length
        };

        const totalModels = 8;
        const uniqueResources = [...new Set(activePermissions.map(p => p.Permission?.resource || p.resource))];
        const accessibleModels = Math.min(totalModels, uniqueResources.length);

        const formattedAgent = {
            id: supportAgent.id.toString(),
            name: supportAgent.full_name || 'N/A',
            email: supportAgent.email || 'N/A',
            avatar: supportAgent.avatar,
            role: roleDisplayNames[supportAgent.role_name] || supportAgent.role_name,
            status: supportAgent.status || 'active',
            totalModels: totalModels,
            accessibleModels: accessibleModels,
            permissions: permissionCounts,
            created_at: supportAgent.created_at,
            updated_at: supportAgent.updated_at,
            role_details: supportAgent.Role ? {
                id: supportAgent.Role.id,
                name: supportAgent.Role.name,
                caption: supportAgent.Role.caption,
                is_admin: supportAgent.Role.is_admin
            } : null,
            permissionsList: permissions.map(p => ({
                id: p.id,
                resource: p.Permission?.resource || p.resource,
                action: p.Permission?.action || p.action,
                granted: p.granted,
                granted_at: p.granted_at ? moment.unix(p.granted_at).format('YYYY-MM-DD HH:mm:ss') : null,
                expires_at: p.expires_at ? moment.unix(p.expires_at).format('YYYY-MM-DD HH:mm:ss') : null,
                granted_by: p.GrantedByUser ? {
                    id: p.GrantedByUser.id,
                    name: p.GrantedByUser.full_name,
                    email: p.GrantedByUser.email
                } : null,
                notes: p.notes
            }))
        };

        return res.status(200).json({
            status: 'success',
            message: 'Support agent details fetched successfully',
            data: formattedAgent
        });

    } catch (err) {
        console.error('Error fetching support agent details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch support agent details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update support agent
 */
async function updateSupportAgent(req, res) {
    const transaction = await User.sequelize.transaction();
    
    try {
        const { id } = req.params;
        const { name, email, role, status } = req.body;

        if (!id) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            transaction
        });

        if (!supportAgent) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        // Email validation if email is being updated
        if (email && email !== supportAgent.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid email format'
                });
            }

            const existingUser = await User.findOne({
                where: {
                    email: email,
                    id: { [Op.ne]: id }
                },
                transaction
            });

            if (existingUser) {
                await transaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Email is already taken'
                });
            }
        }

        // Prepare update data
        const updateData = {
            updated_at: Math.floor(Date.now() / 1000)
        };

        if (name) updateData.full_name = name;
        if (email) updateData.email = email;
        if (status) updateData.status = status;

        // Handle role update
        if (role) {
            const roleMap = {
                'Support Agent': 'support_agent',
                'Senior Support': 'senior_support',
                'Support Lead': 'support_lead'
            };

            const roleName = roleMap[role] || role.toLowerCase().replace(' ', '_');
            
            let roleRecord = await Role.findOne({
                where: { name: roleName },
                transaction
            });

            if (!roleRecord) {
                roleRecord = await Role.create({
                    name: roleName,
                    display_name: role,
                    description: `${role} role`
                }, { transaction });
            }

            updateData.role_name = roleName;
            updateData.role_id = roleRecord.id;
        }

        // Update support agent
        await supportAgent.update(updateData, { transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Support agent updated successfully',
            data: {
                id: supportAgent.id,
                name: updateData.full_name || supportAgent.full_name,
                email: updateData.email || supportAgent.email,
                role: role || supportAgent.role_name,
                status: updateData.status || supportAgent.status
            }
        });

    } catch (err) {
        await transaction.rollback();
        console.error('Error updating support agent:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update support agent',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update support agent password
 */
async function updatePassword(req, res) {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        if (!password || password.length < 8) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 8 characters long'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            }
        });

        if (!supportAgent) {
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await supportAgent.update({
            password: hashedPassword,
            updated_at: Math.floor(Date.now() / 1000)
        });

        return res.status(200).json({
            status: 'success',
            message: 'Password updated successfully'
        });

    } catch (err) {
        console.error('Error updating password:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update password',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Delete support agent
 */
async function deleteSupportAgent(req, res) {
    const transaction = await User.sequelize.transaction();
    
    try {
        const { id } = req.params;

        if (!id) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            transaction
        });

        if (!supportAgent) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        // Delete associated permissions
        await SupportUserPermission.destroy({
            where: { user_id: id },
            transaction
        });

        // Delete the support agent
        await supportAgent.destroy({ transaction });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Support agent deleted successfully'
        });

    } catch (err) {
        await transaction.rollback();
        console.error('Error deleting support agent:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete support agent',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Activate support agent
 */
async function activateSupportAgent(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            }
        });

        if (!supportAgent) {
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        await supportAgent.update({
            status: 'active',
            updated_at: Math.floor(Date.now() / 1000)
        });

        return res.status(200).json({
            status: 'success',
            message: 'Support agent activated successfully'
        });

    } catch (err) {
        console.error('Error activating support agent:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to activate support agent',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Inactivate support agent
 */
async function inactivateSupportAgent(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            }
        });

        if (!supportAgent) {
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        await supportAgent.update({
            status: 'inactive',
            updated_at: Math.floor(Date.now() / 1000)
        });

        return res.status(200).json({
            status: 'success',
            message: 'Support agent inactivated successfully'
        });

    } catch (err) {
        console.error('Error inactivating support agent:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to inactivate support agent',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get support agent permissions
 */
async function getSupportAgentPermissions(req, res) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['admin','support_agent'] }
            },
            include: [
                {
                    model: SupportUserPermission,
                    as: 'UserPermissions',
                    required: false,
                    include: [{
                        model: Permission,
                        as: 'Permission',
                        attributes: ['id', 'name', 'resource', 'action']
                    }]
                }
            ]
        });

        if (!supportAgent) {
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        const permissions = supportAgent.UserPermissions || [];
        const formattedPermissions = {
            create: permissions.filter(p => p.Permission?.action === 'create').map(p => p.Permission?.resource || p.resource),
            read: permissions.filter(p => p.Permission?.action === 'read').map(p => p.Permission?.resource || p.resource),
            update: permissions.filter(p => p.Permission?.action === 'update').map(p => p.Permission?.resource || p.resource),
            delete: permissions.filter(p => p.Permission?.action === 'delete').map(p => p.Permission?.resource || p.resource)
        };

        return res.status(200).json({
            status: 'success',
            message: 'Support agent permissions fetched successfully',
            data: {
                agent_id: supportAgent.id,
                name: supportAgent.full_name,
                permissions: formattedPermissions
            }
        });

    } catch (err) {
        console.error('Error fetching support agent permissions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch support agent permissions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Update support agent permissions
 */
async function updateSupportAgentPermissions(req, res) {
    const transaction = await User.sequelize.transaction();
    
    try {
        const { id } = req.params;
        const { permissions } = req.body;

        if (!id) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Support agent ID is required'
            });
        }

        if (!permissions || typeof permissions !== 'object') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Permissions object is required'
            });
        }

        const supportAgent = await User.findOne({
            where: {
                id: id,
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            transaction
        });

        if (!supportAgent) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Support agent not found'
            });
        }

        // Delete existing permissions
        await SupportUserPermission.destroy({
            where: { user_id: id },
            transaction
        });

        // Add new permissions
        const permissionPromises = [];
        
        Object.keys(permissions).forEach(action => {
            if (Array.isArray(permissions[action])) {
                permissions[action].forEach(resource => {
                    permissionPromises.push(
                        SupportUserPermission.create({
                            user_id: id,
                            permission_id: null, // Adjust based on your permission system
                            resource: resource,
                            action: action,
                            granted: true
                        }, { transaction })
                    );
                });
            }
        });

        await Promise.all(permissionPromises);

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Support agent permissions updated successfully',
            data: {
                agent_id: id,
                permissions: permissions
            }
        });

    } catch (err) {
        await transaction.rollback();
        console.error('Error updating support agent permissions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to update support agent permissions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Export support agents
 */
async function exportSupportAgents(req, res) {
    try {
        const { format = 'excel', ...filters } = req.query;

        // Get all support agents (without pagination for export)
        const supportAgents = await User.findAll({
            where: {
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            include: [
                {
                    model: SupportUserPermission,
                    as: 'UserPermissions',
                    required: false,
                    include: [{
                        model: SupportPermission, // Fixed: Changed from Permission to SupportPermission
                        as: 'Permission',
                        attributes: ['id', 'name', 'resource', 'action']
                    }]
                }
            ],
            attributes: [
                'id', 'full_name', 'email', 'role_name', 'status',
                'created_at'
            ]
        });

        if (format === 'pdf') {
            // Generate PDF
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="support_agents.pdf"');
            
            doc.pipe(res);
            
            doc.fontSize(16).text('Support Agents Report', { align: 'center' });
            doc.moveDown();
            
            supportAgents.forEach((agent, index) => {
                doc.fontSize(12).text(`${index + 1}. ${agent.full_name}`);
                doc.text(`   Email: ${agent.email}`);
                doc.text(`   Role: ${agent.role_name}`);
                doc.text(`   Status: ${agent.status}`);
                doc.moveDown();
            });
            
            doc.end();
            
        } else {
            // Generate Excel
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Support Agents');
            
            worksheet.columns = [
                { header: 'ID', key: 'id', width: 10 },
                { header: 'Name', key: 'name', width: 30 },
                { header: 'Email', key: 'email', width: 30 },
                { header: 'Role', key: 'role', width: 20 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Created At', key: 'created_at', width: 20 },
                { header: 'Last Active', key: 'last_active', width: 20 }
            ];
            
            supportAgents.forEach(agent => {
                worksheet.addRow({
                    id: agent.id,
                    name: agent.full_name,
                    email: agent.email,
                    role: agent.role_name,
                    status: agent.status,
                    created_at: moment.unix(agent.created_at).format('YYYY-MM-DD HH:mm:ss'),
                    last_active: agent.last_active ? moment.unix(agent.last_active).format('YYYY-MM-DD HH:mm:ss') : 'Never'
                });
            });
            
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="support_agents.xlsx"');
            
            await workbook.xlsx.write(res);
            res.end();
        }

    } catch (err) {
        console.error('Error exporting support agents:', err);
        if (!res.headersSent) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to export support agents',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    }
}

/**
 * Get support agent metrics
 */
async function getSupportAgentMetrics(req, res) {
    try {
        const totalAgents = await User.count({
            where: {
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            }
        });

        const activeAgents = await User.count({
            where: {
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] },
                status: 'active'
            }
        });

        const inactiveAgents = totalAgents - activeAgents;

        // Role distribution
        const roleDistribution = await User.findAll({
            where: {
                role_name: { [Op.in]: ['support_agent', 'senior_support', 'support_lead'] }
            },
            attributes: [
                'role_name',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            group: ['role_name'],
            raw: true
        });

        return res.status(200).json({
            status: 'success',
            message: 'Support agent metrics fetched successfully',
            data: {
                total_agents: totalAgents,
                active_agents: activeAgents,
                inactive_agents: inactiveAgents,
                role_distribution: roleDistribution.map(role => ({
                    role: role.role_name,
                    count: parseInt(role.count)
                }))
            }
        });

    } catch (err) {
        console.error('Error fetching support agent metrics:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch support agent metrics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

module.exports = {
    getSupportAgents,
    createSupportAgent,
    getSupportAgentDetails,
    updateSupportAgent,
    updatePassword,
    deleteSupportAgent,
    activateSupportAgent,
    inactivateSupportAgent,
    getSupportAgentPermissions,
    updateSupportAgentPermissions,
    exportSupportAgents,
    getSupportAgentMetrics
};