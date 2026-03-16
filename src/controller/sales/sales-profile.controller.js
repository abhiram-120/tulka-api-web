const bcrypt = require('bcrypt');
const multer = require('multer');
const User = require('../../models/users');
const { sequelize } = require('../../connection/connection');
const { Op } = require('sequelize');
const { validateProfileData } = require('../../validators/sales/sales-profile.validator');
const { uploadAvatar } = require('../../services/profile/image-service');


/**
 * Get sales profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getSalesProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user with specific attributes
        const user = await User.findByPk(userId, {
            attributes: [
                'id', 
                'full_name', 
                'email', 
                'mobile',
                'country_code',
                'language',
                'timezone',
                'city',
                'avatar',
                'role_name',
                'notification_channels',
                'lesson_notifications'
            ]
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Verify user is a sales role
        if (!user.role_name.includes('sales')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Sales role required.'
            });
        }

        // Format notification preferences
        const notificationPreferences = {
            email: user.notification_channels ? JSON.parse(user.notification_channels).includes('email') : false,
            inapp: user.notification_channels ? JSON.parse(user.notification_channels).includes('inapp') : false,
            whatsapp: user.notification_channels ? JSON.parse(user.notification_channels).includes('whatsapp') : false,
            notification_times: user.lesson_notifications ? JSON.parse(user.lesson_notifications) : []
        };

        // Prepare response data
        const responseData = {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            mobile: user.mobile,
            country_code: user.country_code,
            language: user.language,
            timezone: user.timezone,
            city: user.city,
            avatar: user.avatar,
            role_name: user.role_name,
            notification_preferences: notificationPreferences
        };

        return res.status(200).json({
            status: 'success',
            data: responseData
        });

    } catch (error) {
        console.error('Error in getSalesProfile:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update sales profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateSalesProfile = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const {
            full_name,
            email,
            mobile,
            country_code,
            language,
            timezone,
            city
        } = req.body;

        // Input validation
        const validationError = validateProfileData(req.body);
        if (validationError) {
            return res.status(400).json({
                status: 'error',
                message: validationError
            });
        }

        // Verify user is a sales role
        const user = await User.findByPk(userId);
        if (!user || !user.role_name.includes('sales')) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Sales role required.'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Check if email is already taken (excluding current user)
        if (email) {
            const existingUser = await User.findOne({
                where: {
                    email,
                    id: { [Op.ne]: userId }
                },
                transaction
            });

            if (existingUser) {
                await transaction.rollback();
                return res.status(409).json({
                    status: 'error',
                    message: 'Email is already taken'
                });
            }
        }

        // Update user profile
        const updatedUser = await User.update({
            full_name,
            email,
            mobile,
            country_code,
            language,
            timezone,
            city,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            returning: true,
            transaction
        });

        await transaction.commit();

        // Fetch updated user data
        const salesUser = await User.findByPk(userId, {
            attributes: [
                'id', 
                'full_name', 
                'email', 
                'mobile',
                'country_code',
                'language',
                'timezone',
                'city',
                'avatar',
                'role_name'
            ]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Profile updated successfully',
            data: salesUser
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in updateSalesProfile:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Change sales user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const changeSalesPassword = async (req, res) => {
    let transaction;
    
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                status: 'error',
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                status: 'error',
                message: 'New password must be at least 8 characters long'
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Get user with password and verify role
        const user = await User.findByPk(userId, { transaction });

        if (!user) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Verify user is a sales role
        if (!user.role_name.includes('sales')) {
            await transaction.rollback();
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Sales role required.'
            });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            await transaction.rollback();
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await User.update({
            password: hashedPassword,
            updated_at: Math.floor(Date.now() / 1000)
        }, {
            where: { id: userId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            message: 'Password changed successfully'
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in changeSalesPassword:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Upload avatar for sales user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const uploadSalesAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'No file uploaded'
            });
        }

        const response = await uploadAvatar(req.user.id, req.file);

        if (!response.success) {
            return res.status(400).json({
                status: 'error',
                message: response.error
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Avatar uploaded successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error in uploadSalesAvatar:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Configure multer for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});


module.exports = {
    getSalesProfile,
    updateSalesProfile,
    changeSalesPassword,
    uploadSalesAvatar,
    upload
};