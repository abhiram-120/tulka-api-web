const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const config = require('../../../src/config/config');
const Users = require('../../models/users');
const generateToken = require('../../middleware/generate-token');

// Updated validation schema - removed role requirement
const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    role: Joi.string().valid('teacher'), // Made optional 
    fcm_token: Joi.string().allow(null, '')
});

// Login handler
async function loginTeacher(req, res) {
    try {
        let { email, password, fcm_token } = req.body;
        // Always set role to teacher for this endpoint
        const role = 'teacher';

        // Validate request body
        const { error } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid input data'
            });
        }

        email = email.toLowerCase();

        // Find user
        const user = await Users.findOne({ 
            where: { 
                email,
                role_name: role
            },
            attributes: ['id','full_name', 'avatar', 'email', 'password', 'status', 'role_name', 'fcm_token', 'timezone']
        });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid credentials'
            });
        }

        // Check user status
        if (user.status === 'inactive') {
            return res.status(401).json({
                status: 'error',
                message: 'Account is inactive'
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

        if (fcm_token && !fcmTokens.includes(fcm_token)) {
            fcmTokens.push(fcm_token);
            await Users.update(
                { fcm_token: JSON.stringify(fcmTokens) },
                { where: { id: user.id } }
            );
        }

        // Generate token and prepare response
        const token = generateToken(user.id);
        const userData = user.toJSON();
        delete userData.password;

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

// Logout handler - unchanged
async function logoutTeacher(req, res) {
    try {
        const user = await Users.findOne({
            where: { 
                id: req.userId,
                role_name: ['teacher']
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

// Auth check handler - unchanged
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
                role_name: ['teacher']
            },
            attributes: ['id', 'full_name', 'avatar', 'email', 'status', 'role_name', 'fcm_token']
        });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid token'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Token valid',
            data: user
        });

    } catch (error) {
        return res.status(401).json({
            status: 'error',
            message: 'Invalid token'
        });
    }
}

module.exports = {
    loginTeacher,
    logoutTeacher,
    authCheck
};