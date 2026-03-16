const Role = require('../../models/role');
const Group = require('../../models/group');
const GroupUser = require('../../models/group-user');
const { validationResult } = require('express-validator');
const User = require('../../models/users');
const { sendCombinedNotifications } = require('../../cronjobs/reminder');
const bcrypt = require('bcrypt');  // Add this import
const { Op } = require('sequelize');
/**
 * Get all roles ordered by creation date
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with roles data
 */
async function getRoles(req, res) {
    try {
        const roles = await Role.findAll({
            order: [['created_at', 'DESC']],
            attributes: ['id', 'name', 'caption']
        });

        return res.status(200).json({
            status: 'success',
            message: 'Roles fetched successfully',
            data: roles
        });

    } catch (err) {
        console.error('Error fetching roles:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch roles'
        });
    }
}


/**
 * Get active user groups ordered by creation date
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with groups data
 */
async function getGroups(req, res) {
    try {
        const groups = await Group.findAll({
            where: {
                status: 'active'
            },
            order: [['created_at', 'DESC']],
            attributes: ['id', 'creator_id', 'name']
        });

        return res.status(200).json({
            status: 'success',
            message: 'Groups fetched successfully',
            data: groups
        });

    } catch (err) {
        console.error('Error fetching groups:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch groups'
        });
    }
}


/**
 * Get a specific role by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with role data
 */
async function getRoleById(req, res) {
    try {
        const { id } = req.params;

        const role = await Role.findByPk(id, {
            attributes: ['id', 'name', 'caption', 'users_count', 'is_admin', 'created_at']
        });

        if (!role) {
            return res.status(404).json({
                status: 'error',
                message: 'Role not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Role fetched successfully',
            data: role
        });

    } catch (err) {
        console.error('Error fetching role:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch role'
        });
    }
}

/**
 * Get a specific group by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with group data
 */
async function getGroupById(req, res) {
    try {
        const { id } = req.params;

        const group = await Group.findOne({
            where: {
                id,
                status: 'active'
            },
            attributes: ['id', 'creator_id', 'name', 'discount', 'commission', 'status', 'created_at']
        });

        if (!group) {
            return res.status(404).json({
                status: 'error',
                message: 'Group not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Group fetched successfully',
            data: group
        });

    } catch (err) {
        console.error('Error fetching group:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch group'
        });
    }
}


/**
 * Send role-specific welcome email to newly created user
 * @param {Object} user - The newly created user object
 * @param {Object} role - The role object for the user
 * @returns {Promise<boolean>} - Success status of the email notification
 */
async function sendRoleBasedWelcomeEmail(user, role) {
    try {
        if (!user || !user.id || !role) {
            console.error('Missing user or role information for welcome email');
            return false;
        }

        // Define template names based on roles
        const templateMapping = {
            'admin': 'admin_welcome',
            'support_agent': 'support_agent_welcome',
            'teacher': 'instructor_welcome',
            'education': 'author_welcome',
            'organization': 'organization_welcome',
            'sales_role': 'sales_agent_welcome',
            'sales_appointment_setter': 'sales_appointment_welcome',
            'user': 'student_welcome'
        };

        // Get template name based on role
        const templateName = templateMapping[role.name] || 'general_welcome';

        // Prepare message parameters for the template
        const messageParams = {
            user_name: user.full_name,
            role_name: getReadableRoleName(role.name),
            login_url: process.env.APP_URL || 'https://tulkka.com',
            email: user.email,
            support_email: 'support@tulkka.com',
            platform_name: 'Tulkka'
        };

        // Prepare recipient details
        const recipientDetails = {
            email: user.email,
            mobile: user.mobile,
            country_code: user.country_code,
            full_name: user.full_name,
            language: user.language || 'EN'
        };

        // Send the welcome email using our common function
        const { emailSent } = await sendCombinedNotifications(
            templateName, 
            messageParams, 
            recipientDetails,
            false
        );

        return emailSent;
    } catch (error) {
        console.error('Error sending role-based welcome email:', error);
        return false;
    }
}

/**
 * Convert role name to a readable format
 * @param {string} roleName - The system role name
 * @returns {string} - Human-readable role name
 */
function getReadableRoleName(roleName) {
    const roleMapping = {
        'admin': 'Administrator',
        'support_agent': 'Support Agent',
        'teacher': 'Instructor',
        'education': 'Author',
        'organization': 'Organization Manager',
        'sales_role': 'Sales Agent',
        'sales_appointment_setter': 'Appointment Setter',
        'user': 'Student'
    };

    return roleMapping[roleName] || 'User';
}

// Updated store function that includes welcome email
async function store(req, res) {
    try {
        // Validation check
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const data = req.body;
        
        // Determine which email to use - prioritize username if it's an email with alias
        let emailToCheck;
        let usernameField;
        
        if (data.username && data.username.includes('@') && data.username.includes('+')) {
            // If username is an email with alias, use it
            emailToCheck = data.username.trim();
            usernameField = 'email';
        } else if (data.email) {
            // Otherwise use email field
            emailToCheck = data.email.trim();
            usernameField = 'email';
        } else if (data.username && data.username.includes('@')) {
            // Username is email but no alias
            emailToCheck = data.username.trim();
            usernameField = 'email';
        } else if (data.mobile) {
            // Mobile registration
            emailToCheck = null;
            usernameField = 'mobile';
        }
        
      
        // Check for existing user with EXACT match only
        let existingUser = null;
        
        if (emailToCheck) {
            // Check by email
            existingUser = await User.findOne({
                where: { 
                    email: emailToCheck
                }
            });
        } else if (data.mobile) {
            // Check by mobile
            existingUser = await User.findOne({
                where: { 
                    mobile: data.mobile
                }
            });
        }


        if (existingUser) {
            
            return res.status(400).json({
                status: 'error',
                message: `User with this email already exists`,
                debug: {
                    existingEmail: existingUser.email,
                    inputEmail: emailToCheck,
                    exactMatch: existingUser.email === emailToCheck,
                    lengthDifference: existingUser.email ? existingUser.email.length - emailToCheck.length : 0
                }
            });
        }

        // Find role
        const role = await Role.findByPk(data.role_id);
        if (!role) {
            return res.status(404).json({
                status: 'error',
                message: 'Role not found'
            });
        }

        // Get referral settings
        const referralSettings = await getReferralSettings();
        const usersAffiliateStatus = referralSettings?.users_affiliate_status || false;

        // Prepare user data
        const insertData = {
            full_name: data.full_name,
            role_name: role.name,
            role_id: data.role_id,
            email: emailToCheck, // Use the email we checked
            mobile: data.mobile,
            password: await bcrypt.hash(data.password, 10),
            status: data.status,
            affiliate: usersAffiliateStatus,
            verified: true,
            created_at: Math.floor(Date.now() / 1000),
            timezone: 'Asia/Jerusalem',
            country_code: '+972',
            notification_channels: JSON.stringify(['email', 'whatsapp', 'inapp'])
        };


        // Create user
        const user = await User.create(insertData);

        // Handle group assignment
        if (data.group_id) {
            const group = await Group.findByPk(data.group_id);
           
            if (group) {
                await GroupUser.create({
                    group_id: group.id,
                    user_id: user.id,
                    created_at: Math.floor(Date.now() / 1000)
                });
            }
        }

        // Send role-based welcome email
        if (user.email) {
            // Send the welcome email in the background (don't await)
            sendRoleBasedWelcomeEmail(user, role)
                .then(sent => {
                    if (sent) {
                        console.log(`Welcome email sent successfully to ${user.email} for role ${role.name}`);
                    } else {
                        console.error(`Failed to send welcome email to ${user.email} for role ${role.name}`);
                    }
                })
                .catch(error => {
                    console.error('Error in welcome email process:', error);
                });
        }

        return res.status(201).json({
            status: 'success',
            message: 'User created successfully',
            data: {
                user_id: user.id,
                redirect_url: `/admin/users/${user.id}/edit`
            }
        });

    } catch (err) {
        console.error('Error creating user:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create user',
            debug: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Helper function to get referral settings
 * @returns {Object} Referral settings
 */
async function getReferralSettings() {
    // Implement your referral settings logic here
    return {
        users_affiliate_status: true
    };
}


/**
 * module exports*/
module.exports = {
    getRoles,
    getGroups,
    getRoleById,
    getGroupById,
    store
};
