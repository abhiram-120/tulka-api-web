// Import required dependencies
const bcrypt = require('bcrypt');          // For password hashing
const jwt = require('jsonwebtoken');
const Joi = require('joi');                // For input validation
const config = require('../../../src/config/config');
const Users = require('../../models/users');        // User model
const Verifications = require('../../models/verifications');  // Verification model
const SupportUserPermission = require('../../models/supportUserPermissions');
const SupportPermission = require('../../models/supportPermissions');
const generateToken = require('../../middleware/generate-token');  // JWT token generator
const generateOTP = require('../../utils/generateOTP');  // OTP generator utility
const { Op } = require('sequelize');

// Define validation schema for login request using Joi
const loginSchema = Joi.object({
    email: Joi.string().email().required(),        // Email must be valid and required
    password: Joi.string().required(),             // Password is required
    fcm_token: Joi.string().allow(null, '')       // FCM token is optional
});

/**
 * Handle admin login functionality
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with login status
 */

async function loginAdmin(req, res) {
    try {
        let { email, password, fcm_token } = req.body;

        // Validate request body against schema
        const { error } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid input data'
            });
        }

        // Convert email to lowercase for consistency
        email = email.toLowerCase();

        // Find user in database with admin or support agent role
        const user = await Users.findOne({ 
            where: { 
                email,
                role_name: ['admin', 'support_agent', 'senior_support', 'support_lead'] // Include all support roles
            },
            attributes: ['id','full_name', 'avatar', 'email', 'password', 'status', 'mobile', 'fcm_token', 'role_name',  'timezone']
        });

        // Return error if user not found
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // Handle inactive or pending accounts
        if (user.status === 'pending' || user.status === 'inactive') {
            // Remove any existing verification records
            await Verifications.destroy({
                where: {
                    user_id: user.id,
                    mobile: user.mobile,
                    email: user.email
                }
            });

            // Generate new OTP
            const OTP = await generateOTP();

            // Attempt to send OTP via WhatsApp (you'll need to implement this)
            // const messageSent = await sendAisensyWhatsappMessage(user, OTP);
            // if (!messageSent) {
            //     return res.status(401).json({
            //         status: 'errorMobile',
            //         message: 'Failed to send WhatsApp message'
            //     });
            // }

            // Create new verification
            await Verifications.create({
                user_id: user.id,
                mobile: user.mobile,
                email: user.email,
                code: OTP
            });
            
            return res.status(401).json({
                status: 'error',
                message: 'Please activate your account'
            });
        }

        // Verify password
        let hashPassword = user.password.replace(/^\$2y(.+)$/i, '$2a$1');
        const isMatch = await bcrypt.compare(password, hashPassword);
        
        if (!isMatch) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // Handle FCM token
        let fcmTokens = [];
        try {
            fcmTokens = user.fcm_token ? JSON.parse(user.fcm_token) : [];
        } catch {
            fcmTokens = user.fcm_token ? [user.fcm_token] : [];
        }

        // Add new FCM token if not exists
        if (fcm_token && !fcmTokens.includes(fcm_token)) {
            fcmTokens.push(fcm_token);
            await Users.update(
                { fcm_token: JSON.stringify(fcmTokens) },
                { where: { id: user.id } }
            );
        }

        // Generate auth token
        const token = generateToken(user.id);

        // Remove sensitive data
        const userData = user.toJSON();
        delete userData.password;

        // Get permissions for support agents
        if (user.role_name !== 'admin') {
            const permissions = await SupportUserPermission.findAll({
                where: {
                    user_id: user.id,
                    granted: true,
                    [Op.or]: [
                        { expires_at: null },
                        { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                    ]
                },
                include: [{
                    model: SupportPermission,
                    as: 'Permission',
                    attributes: ['id', 'name', 'resource', 'action']
                }]
            });

            userData.permissions = permissions.map(p => ({
                resource: p.Permission?.resource || p.resource,
                action: p.Permission?.action || p.action,
                granted: p.granted
            }));
        }

        return res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token,
            data: userData
        });

    } catch (err) {
        console.error('Login Error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Login failed'
        });
    }
}

async function logoutAdmin(req, res) {
    try {
        const user = await Users.findOne({
            where: { 
                id: req.userId,
                role_name: ['admin', 'support_agent', 'senior_support', 'support_lead']
            },
            attributes: ['id', 'fcm_token']
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        const { fcm_token: tokenToRemove } = req.body;

        if (!tokenToRemove) {
            return res.status(200).json({
                status: 'success',
                message: 'Logged out successfully'
            });
        }

        // Update FCM tokens
        let userFcmTokens = [];
        try {
            userFcmTokens = user.fcm_token ? JSON.parse(user.fcm_token) : [];
            userFcmTokens = userFcmTokens.filter(token => token !== tokenToRemove);
        } catch {
            userFcmTokens = [];
        }

        // Update user
        await user.update({
            fcm_token: userFcmTokens.length ? JSON.stringify(userFcmTokens) : null
        });

        return res.status(200).json({
            status: 'success',
            message: 'Logged out successfully'
        });

    } catch (err) {
        console.error('Logout Error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Logout failed'
        });
    }
}

async function authCheck(req, res) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                status: 'error',
                message: 'No token provided'
            });
        }

        const decoded = jwt.verify(token, config.jwtSecret);
        const user = await Users.findOne({
            where: { 
                id: decoded.id,
                role_name: ['admin', 'support_agent', 'senior_support', 'support_lead']
            },
            attributes: ['id', 'full_name', 'avatar', 'email', 'status', 'mobile', 'fcm_token', 'role_name', 'timezone']
        });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid token'
            });
        }

        const userData = user.toJSON();

        // Get permissions for support agents
        if (user.role_name !== 'admin') {
            const permissions = await SupportUserPermission.findAll({
                where: {
                    user_id: user.id,  
                    granted: true,
                    [Op.or]: [
                        { expires_at: null },
                        { expires_at: { [Op.gt]: Math.floor(Date.now() / 1000) } }
                    ]
                },
                include: [{
                    model: SupportPermission,
                    as: 'Permission',
                    attributes: ['id', 'name', 'resource', 'action']
                }]
            });

            userData.permissions = permissions.map(p => ({
                resource: p.Permission?.resource || p.resource,
                action: p.Permission?.action || p.action,
                granted: p.granted
            }));
        }

        return res.status(200).json({
            status: 'success',
            message: 'Token valid',
            data: userData
        });

    } catch (error) {
        return res.status(401).json({
            status: 'error',
            message: 'Invalid token'
        });
    }
}

module.exports = {
    loginAdmin,
    logoutAdmin,
    authCheck
};