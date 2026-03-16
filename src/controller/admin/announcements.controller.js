const Announcement = require('../../models/announcements');
const { Op } = require('sequelize');
const moment = require('moment');
const { sendBroadcastNotification } = require('../../cronjobs/reminder');
const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const config = require('../../config/config');

AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: 'eu-central-1'
});

const s3 = new AWS.S3();

// Configure multer for announcement images
const uploadAnnouncementImage = multer({
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit for images
    },
    storage: multerS3({
        s3: s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const timestamp = Date.now();
            const extension = file.originalname.split('.').pop();
            cb(null, `announcements/images/${timestamp}-${file.originalname}`);
        }
    }),
    fileFilter: function (req, file, cb) {
        // Only allow image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});
/**
 * Get all announcements with pagination and filters
 */
const getAnnouncements = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status, 
            search,
            from_date,
            to_date,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const whereClause = { deleted_at: null };

        // Status filter
        if (status) {
            if (status === 'active') {
                whereClause.is_active = true;
                whereClause.last_date = { [Op.gt]: new Date() };
            } else if (status === 'expired') {
                whereClause.last_date = { [Op.lte]: new Date() };
            } else if (status === 'inactive') {
                whereClause.is_active = false;
            }
        }

        // Search filter
        if (search) {
            whereClause[Op.or] = [
                { title: { [Op.like]: `%${search}%` } },
                { description: { [Op.like]: `%${search}%` } }
            ];
        }

        // Date range filter
        if (from_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.gte]: moment(from_date).startOf('day').toDate()
            };
        }

        if (to_date) {
            whereClause.created_at = {
                ...(whereClause.created_at || {}),
                [Op.lte]: moment(to_date).endOf('day').toDate()
            };
        }

        const { count, rows: announcements } = await Announcement.findAndCountAll({
            where: whereClause,
            order: [[sort_by, sort_order.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Add computed status to each announcement
        const enhancedAnnouncements = announcements.map(announcement => {
            const isExpired = new Date(announcement.last_date) <= new Date();
            const computedStatus = !announcement.is_active ? 'inactive' : 
                                 isExpired ? 'expired' : 'active';
            
            return {
                ...announcement.toJSON(),
                computed_status: computedStatus,
                is_expired: isExpired,
                days_remaining: isExpired ? 0 : Math.ceil((new Date(announcement.last_date) - new Date()) / (1000 * 60 * 60 * 24))
            };
        });

        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Announcements retrieved successfully',
            data: enhancedAnnouncements,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to retrieve announcements',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Get single announcement by ID
 */
const getAnnouncementById = async (req, res) => {
    try {
        const { id } = req.params;

        const announcement = await Announcement.findOne({
            where: { 
                id,
                deleted_at: null 
            }
        });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Announcement not found',
                timestamp: new Date().toISOString()
            });
        }

        const isExpired = new Date(announcement.last_date) <= new Date();
        const computedStatus = !announcement.is_active ? 'inactive' : 
                             isExpired ? 'expired' : 'active';

        const enhancedAnnouncement = {
            ...announcement.toJSON(),
            computed_status: computedStatus,
            is_expired: isExpired,
            days_remaining: isExpired ? 0 : Math.ceil((new Date(announcement.last_date) - new Date()) / (1000 * 60 * 60 * 24))
        };

        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Announcement retrieved successfully',
            data: enhancedAnnouncement,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching announcement:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to retrieve announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Create new announcement
 */
const createAnnouncement = async (req, res) => {
    try {
        const { title, description, last_date, is_active = true } = req.body;
        let image_url = null;

        // If file was uploaded, get the S3 URL
        if (req.file) {
            image_url = req.file.location;
        }

        // Validation
        if (!title || !description || !last_date) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Title, description, and last_date are required',
                timestamp: new Date().toISOString()
            });
        }

        // Validate last_date is in the future
        if (new Date(last_date) <= new Date()) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Last date must be in the future',
                timestamp: new Date().toISOString()
            });
        }

        const announcement = await Announcement.create({
            title,
            description,
            image_url,
            last_date: new Date(last_date),
            is_active,
            created_at: new Date(),
            updated_at: new Date()
        });

        res.status(201).json({
            success: true,
            status: 'success',
            message: 'Announcement created successfully',
            data: announcement,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to create announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Update announcement
 */
const updateAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, last_date, is_active } = req.body;

        const announcement = await Announcement.findOne({
            where: { 
                id,
                deleted_at: null 
            }
        });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Announcement not found',
                timestamp: new Date().toISOString()
            });
        }

        // Validate last_date if provided
        if (last_date && new Date(last_date) <= new Date()) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Last date must be in the future',
                timestamp: new Date().toISOString()
            });
        }

        const updateData = {
            updated_at: new Date()
        };

        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (last_date !== undefined) updateData.last_date = new Date(last_date);
        if (is_active !== undefined) updateData.is_active = is_active;
        
        // If new file was uploaded, update image_url
        if (req.file) {
            updateData.image_url = req.file.location;
        }

        await announcement.update(updateData);

        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Announcement updated successfully',
            data: announcement,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to update announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Delete announcement (soft delete)
 */
const deleteAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;

        const announcement = await Announcement.findOne({
            where: { 
                id,
                deleted_at: null 
            }
        });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Announcement not found',
                timestamp: new Date().toISOString()
            });
        }

        await announcement.update({
            deleted_at: new Date(),
            updated_at: new Date()
        });

        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Announcement deleted successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to delete announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Toggle announcement active status
 */
const toggleAnnouncementStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const announcement = await Announcement.findOne({
            where: { 
                id,
                deleted_at: null 
            }
        });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'Announcement not found',
                timestamp: new Date().toISOString()
            });
        }

        await announcement.update({
            is_active: !announcement.is_active,
            updated_at: new Date()
        });

        res.status(200).json({
            success: true,
            status: 'success',
            message: `Announcement ${announcement.is_active ? 'activated' : 'deactivated'} successfully`,
            data: announcement,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error toggling announcement status:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to toggle announcement status',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Test broadcast notification function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const testBroadcastNotification = async (req, res) => {
    try {
        const { topic = (process.env.ANNOUNCEMENTS_TOPIC || 'announcements'), message, title, language } = req.body;

        // Validate required fields
        if (!topic || !message || !title) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: topic, message, title'
            });
        }

        // Add to the existing log system
        const fs = require('fs');
        const path = require('path');
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        function logToFile(message, level, category, data = null) {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                level,
                category,
                message,
                data
            };
            
            const logFileName = `${category}-${new Date().toISOString().split('T')[0]}.log`;
            const logFilePath = path.join(logsDir, logFileName);
            
            fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
        }

        logToFile(`Starting test broadcast to topic: ${topic}`, 'info', 'test-broadcast', {
            topic,
            title,
            message: message.substring(0, 100) + '...' // Log first 100 chars
        });

        // Import the broadcast function

        // Test message parameters
        const messageParams = {
            test_message: message,
            test_title: title,
            sender: 'Test Admin',
            timestamp: new Date().toISOString(),
        };

        const demoImageUrl = 'https://fastly.picsum.photos/id/13/2500/1667.jpg?hmac=SoX9UoHhN8HyklRA4A3vcCWJMVtiBXUg0W4ljWTor7s';
        // Send test broadcast
        const result = await sendBroadcastNotification(
            topic,
            'test_broadcast', // Template name for test broadcasts
            messageParams,
            {
                language: language || 'EN',
                customData: {
                    test: 'true',
                    broadcast_type: 'test_notification',
                    admin_test: req.userId ? req.userId.toString() : 'unknown'
                },
                // imageUrl: demoImageUrl
                imageUrl: null
            }
        );

        if (result.success) {
            logToFile(`Test broadcast sent successfully to topic: ${topic}`, 'info', 'test-broadcast', {
                topic,
                messageId: result.messageId,
                testId: messageParams.test_id
            });

            return res.status(200).json({
                status: 'success',
                message: 'Test broadcast sent successfully',
                data: {
                    topic: topic,
                    messageId: result.messageId,
                    sentAt: result.sentAt,
                    test_id: messageParams.test_id,
                    content: {
                        title: title,
                        message: message
                    }
                }
            });

        } else {
            logToFile(`Test broadcast failed for topic: ${topic}`, 'error', 'test-broadcast', {
                topic,
                error: result.error,
                testId: messageParams.test_id
            });

            return res.status(500).json({
                status: 'error',
                message: 'Failed to send test broadcast',
                error: result.error,
                test_id: messageParams.test_id
            });
        }

    } catch (error) {
        logToFile('Error in test broadcast', 'error', 'test-broadcast', {
            error: error.message,
            stack: error.stack,
            requestBody: req.body
        });

        return res.status(500).json({
            status: 'error',
            message: 'Internal server error during test broadcast',
            error: error.message
        });
    }
};

/**
 * Get announcement statistics
 */
const getAnnouncementStats = async (req, res) => {
    try {
        const now = new Date();

        const [
            totalCount,
            activeCount,
            expiredCount,
            inactiveCount
        ] = await Promise.all([
            Announcement.count({ where: { deleted_at: null } }),
            Announcement.count({ 
                where: { 
                    deleted_at: null,
                    is_active: true,
                    last_date: { [Op.gt]: now }
                }
            }),
            Announcement.count({ 
                where: { 
                    deleted_at: null,
                    last_date: { [Op.lte]: now }
                }
            }),
            Announcement.count({ 
                where: { 
                    deleted_at: null,
                    is_active: false
                }
            })
        ]);

        res.status(200).json({
            success: true,
            status: 'success',
            message: 'Announcement statistics retrieved successfully',
            data: {
                total: totalCount,
                active: activeCount,
                expired: expiredCount,
                inactive: inactiveCount
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching announcement statistics:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to retrieve announcement statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    getAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    toggleAnnouncementStatus,
    testBroadcastNotification,
    getAnnouncementStats,
    uploadAnnouncementImage
};