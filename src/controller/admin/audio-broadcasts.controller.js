const AudioBroadcast = require('../../models/AudioBroadcast');
const { Op } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AWS = require('aws-sdk');
const config = require('../../config/config');
const { v4: uuidv4 } = require('uuid'); // You may need to install this package: npm install uuid

// Configure AWS
AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION || 'eu-central-1'
});

const s3 = new AWS.S3();

/**
 * Upload audio file to S3
 * @param {Object} file - The audio file to upload
 * @param {number} userId - ID of the user uploading the file
 * @returns {Promise<Object>} - Success status and file URL
 */
const uploadAudioFile = async (file, userId) => {
    try {
        if (!file) {
            return { success: false, error: 'No file provided' };
        }

        // Validate file type
        const validAudioTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/x-m4a'];
        if (!validAudioTypes.includes(file.mimetype) && !file.mimetype.startsWith('audio/')) {
            return { success: false, error: 'Invalid file type. Please upload an audio file (MP3, WAV, or M4A)' };
        }

        // Validate file size (max 20MB)
        if (file.size > 20 * 1024 * 1024) {
            return { success: false, error: 'File too large. Audio file must be less than 20MB' };
        }

        // Generate unique filename to prevent overwriting
        const uniqueId = uuidv4();
        const extension = path.extname(file.originalname);
        const filename = `audio_broadcasts/${userId}/${uniqueId}${extension}`;

        // Upload to S3
        const uploadResult = await s3.upload({
            Bucket: config.AWS_BUCKET,
            Key: filename,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read'
        }).promise();

        // Calculate file size in MB
        const fileSizeInMB = (file.size / (1024 * 1024)).toFixed(1);
        
        // Estimate duration based on file size
        // This is a rough estimation - approximately 1MB per minute for MP3 files
        const estimatedMinutes = Math.floor(fileSizeInMB * 0.8); // Conservative estimate
        const estimatedSeconds = Math.floor((fileSizeInMB * 0.8 * 60) % 60);
        const durationStr = `${String(estimatedMinutes).padStart(2, '0')}:${String(estimatedSeconds).padStart(2, '0')}`;

        return {
            success: true,
            data: {
                file_url: uploadResult.Location,
                file_key: filename,
                file_size: `${fileSizeInMB} MB`,
                duration: durationStr,
                original_name: file.originalname
            }
        };
    } catch (error) {
        console.error('Error uploading audio file:', error);
        return { success: false, error: 'Failed to upload audio file' };
    }
};

/**
 * Upload cover image to S3
 * @param {Object} file - The image file to upload
 * @param {number} userId - ID of the user uploading the file
 * @returns {Promise<Object>} - Success status and file URL
 */
const uploadCoverImage = async (file, userId) => {
    try {
        if (!file) {
            return { success: false, error: 'No file provided' };
        }

        // Validate file type
        const validImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validImageTypes.includes(file.mimetype)) {
            return { success: false, error: 'Invalid file type. Please upload a JPG, PNG, or WebP image' };
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            return { success: false, error: 'File too large. Image must be less than 5MB' };
        }

        // Generate unique filename to prevent overwriting
        const uniqueId = uuidv4();
        const extension = path.extname(file.originalname);
        const filename = `audio_broadcasts/covers/${userId}/${uniqueId}${extension}`;

        // Upload to S3
        const uploadResult = await s3.upload({
            Bucket: config.AWS_BUCKET,
            Key: filename,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read'
        }).promise();

        return {
            success: true,
            data: {
                file_url: uploadResult.Location,
                file_key: filename
            }
        };
    } catch (error) {
        console.error('Error uploading cover image:', error);
        return { success: false, error: 'Failed to upload cover image' };
    }
};

/**
 * Delete file from S3
 * @param {string} key - The S3 key of the file to delete
 * @returns {Promise<Object>} - Success status
 */
const deleteS3File = async (key) => {
    try {
        await s3.deleteObject({
            Bucket: config.AWS_BUCKET,
            Key: key
        }).promise();

        return { success: true };
    } catch (error) {
        console.error('Error deleting file from S3:', error);
        return { success: false, error: 'Failed to delete file' };
    }
};

/**
 * Get all audio broadcasts with optional filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAudioBroadcasts = async (req, res) => {
    try {
        const { 
            search, 
            category,
            status = 'all', 
            page = 1, 
            limit = 10 
        } = req.query;
        
        const offset = (page - 1) * parseInt(limit);
        
        // Building where clause based on filters
        const whereClause = {};
        
        // Search filter
        if (search) {
            whereClause[Op.or] = [
                { title: { [Op.like]: `%${search}%` } },
                { description: { [Op.like]: `%${search}%` } }
            ];
        }
        
        // Category filter
        if (category && category !== 'all') {
            whereClause.category = category;
        }
        
        // Status filter
        if (status !== 'all') {
            whereClause.is_active = status === 'active' ? 1 : 0;
        }
        
        // Get counts for badge display
        const [totalCount, activeCount, inactiveCount, totalDuration] = await Promise.all([
            AudioBroadcast.count(),
            AudioBroadcast.count({ where: { is_active: 1 } }),
            AudioBroadcast.count({ where: { is_active: 0 } }),
            AudioBroadcast.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.fn('TIME_TO_SEC', sequelize.col('duration'))), 'total_seconds']
                ],
                raw: true
            })
        ]);

        // Calculate total duration in hours and minutes
        let totalHours = 0;
        let totalMinutes = 0;
        
        if (totalDuration && totalDuration.total_seconds) {
            const totalSecondsVal = parseInt(totalDuration.total_seconds);
            totalHours = Math.floor(totalSecondsVal / 3600);
            totalMinutes = Math.floor((totalSecondsVal % 3600) / 60);
        }
        
        // Get audio broadcasts with pagination
        const broadcasts = await AudioBroadcast.findAll({
            where: whereClause,
            order: [['upload_date', 'DESC']],
            limit: parseInt(limit),
            offset: offset,
            attributes: [
                'id', 'title', 'description', 'category', 
                'audio_file_url', 'image_url', 'duration', 
                'file_size', 'is_active', 'upload_date', 'listens'
            ]
        });
        
        // Format broadcasts for response
        const formattedBroadcasts = broadcasts.map(broadcast => {
            return {
                id: broadcast.id,
                title: broadcast.title,
                description: broadcast.description,
                category: broadcast.category,
                audioUrl: broadcast.audio_file_url,
                imageUrl: broadcast.image_url,
                duration: broadcast.duration,
                fileSize: broadcast.file_size,
                isActive: !!broadcast.is_active,
                uploadDate: broadcast.upload_date,
                listens: broadcast.listens
            };
        });
        
        // Calculate total listeners (sum of all listens)
        const listenersData = await AudioBroadcast.findOne({
            attributes: [
                [sequelize.fn('SUM', sequelize.col('listens')), 'total_listens']
            ],
            raw: true
        });
        
        const totalListeners = listenersData && listenersData.total_listens ? parseInt(listenersData.total_listens) : 0;
        
        res.status(200).json({
            status: 'success',
            message: 'Audio broadcasts retrieved successfully',
            stats: {
                totalBroadcasts: totalCount,
                activeBroadcasts: activeCount,
                totalDuration: `${totalHours}h ${totalMinutes}m`,
                totalListeners: totalListeners
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / parseInt(limit))
            },
            data: formattedBroadcasts
        });
        
    } catch (error) {
        console.error('Error fetching audio broadcasts:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching audio broadcasts',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get audio broadcast by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAudioBroadcastById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        // Format broadcast for response
        const formattedBroadcast = {
            id: broadcast.id,
            title: broadcast.title,
            description: broadcast.description,
            category: broadcast.category,
            audioUrl: broadcast.audio_file_url,
            audioFileName: broadcast.audio_file_name,
            imageUrl: broadcast.image_url,
            duration: broadcast.duration,
            fileSize: broadcast.file_size,
            isActive: !!broadcast.is_active,
            uploadDate: broadcast.upload_date,
            listens: broadcast.listens,
            createdAt: broadcast.created_at,
            updatedAt: broadcast.updated_at
        };
        
        res.status(200).json({
            status: 'success',
            message: 'Audio broadcast retrieved successfully',
            data: formattedBroadcast
        });
        
    } catch (error) {
        console.error('Error fetching audio broadcast:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching the audio broadcast',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Create a new audio broadcast
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createAudioBroadcast = async (req, res) => {
    try {
        const { title, description, category, isActive } = req.body;
        const userId = req.user.id;
        
        // Validate required fields
        if (!title) {
            return res.status(400).json({
                status: 'error',
                message: 'Broadcast title is required'
            });
        }
        
        // Validate audio file
        if (!req.files || !req.files.audio) {
            return res.status(400).json({
                status: 'error',
                message: 'Audio file is required'
            });
        }
        
        // Upload audio file to S3
        const audioFile = req.files.audio[0];
        const audioUploadResult = await uploadAudioFile(audioFile, userId);
        
        if (!audioUploadResult.success) {
            return res.status(400).json({
                status: 'error',
                message: audioUploadResult.error
            });
        }
        
        // Upload cover image if provided
        let coverImageUrl = null;
        if (req.files && req.files.coverImage && req.files.coverImage[0]) {
            const coverImage = req.files.coverImage[0];
            const imageUploadResult = await uploadCoverImage(coverImage, userId);
            
            if (!imageUploadResult.success) {
                // Clean up the audio file if image upload fails
                await deleteS3File(audioUploadResult.data.file_key);
                
                return res.status(400).json({
                    status: 'error',
                    message: imageUploadResult.error
                });
            }
            
            coverImageUrl = imageUploadResult.data.file_url;
        }
        
        // Create the broadcast record
        const broadcast = await AudioBroadcast.create({
            title,
            description: description || null,
            category: category || null,
            audio_file_url: audioUploadResult.data.file_url,
            audio_file_name: audioUploadResult.data.original_name,
            image_url: coverImageUrl,
            duration: audioUploadResult.data.duration,
            file_size: audioUploadResult.data.file_size,
            is_active: isActive !== undefined ? isActive : true,
            upload_date: new Date(),
            created_by: userId
        });
        
        res.status(201).json({
            status: 'success',
            message: 'Audio broadcast created successfully',
            data: {
                id: broadcast.id,
                title: broadcast.title,
                description: broadcast.description,
                category: broadcast.category,
                audioUrl: broadcast.audio_file_url,
                imageUrl: broadcast.image_url,
                duration: broadcast.duration,
                fileSize: broadcast.file_size,
                isActive: !!broadcast.is_active,
                uploadDate: broadcast.upload_date
            }
        });
        
    } catch (error) {
        console.error('Error creating audio broadcast:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while creating the audio broadcast',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update an audio broadcast
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateAudioBroadcast = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, isActive } = req.body;
        const userId = req.user.id;
        
        // Check if broadcast exists
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        // Update fields to be changed
        const updateFields = {};
        
        if (title !== undefined) updateFields.title = title;
        if (description !== undefined) updateFields.description = description;
        if (category !== undefined) updateFields.category = category;
        if (isActive !== undefined) updateFields.is_active = isActive;
        
        // Handle audio file update if provided
        if (req.files && req.files.audio && req.files.audio[0]) {
            const audioFile = req.files.audio[0];
            const audioUploadResult = await uploadAudioFile(audioFile, userId);
            
            if (!audioUploadResult.success) {
                return res.status(400).json({
                    status: 'error',
                    message: audioUploadResult.error
                });
            }
            
            // Extract key from broadcast audio URL
            if (broadcast.audio_file_url) {
                const audioUrlParts = broadcast.audio_file_url.split('/');
                const audioKey = `audio_broadcasts/${userId}/${audioUrlParts[audioUrlParts.length - 1]}`;
                
                // Try to delete old audio file - don't fail if deletion fails
                try {
                    await deleteS3File(audioKey);
                } catch (error) {
                    console.error('Failed to delete old audio file:', error);
                }
            }
            
            updateFields.audio_file_url = audioUploadResult.data.file_url;
            updateFields.audio_file_name = audioUploadResult.data.original_name;
            updateFields.duration = audioUploadResult.data.duration;
            updateFields.file_size = audioUploadResult.data.file_size;
        }
        
        // Handle cover image update if provided
        if (req.files && req.files.coverImage && req.files.coverImage[0]) {
            const coverImage = req.files.coverImage[0];
            const imageUploadResult = await uploadCoverImage(coverImage, userId);
            
            if (!imageUploadResult.success) {
                return res.status(400).json({
                    status: 'error',
                    message: imageUploadResult.error
                });
            }
            
            // Extract key from broadcast image URL
            if (broadcast.image_url) {
                const imageUrlParts = broadcast.image_url.split('/');
                const imageKey = `audio_broadcasts/covers/${userId}/${imageUrlParts[imageUrlParts.length - 1]}`;
                
                // Try to delete old image file - don't fail if deletion fails
                try {
                    await deleteS3File(imageKey);
                } catch (error) {
                    console.error('Failed to delete old cover image:', error);
                }
            }
            
            updateFields.image_url = imageUploadResult.data.file_url;
        }
        
        // Update broadcast
        await broadcast.update(updateFields);
        
        // Get updated broadcast
        const updatedBroadcast = await AudioBroadcast.findByPk(id);
        
        res.status(200).json({
            status: 'success',
            message: 'Audio broadcast updated successfully',
            data: {
                id: updatedBroadcast.id,
                title: updatedBroadcast.title,
                description: updatedBroadcast.description,
                category: updatedBroadcast.category,
                audioUrl: updatedBroadcast.audio_file_url,
                imageUrl: updatedBroadcast.image_url,
                duration: updatedBroadcast.duration,
                fileSize: updatedBroadcast.file_size,
                isActive: !!updatedBroadcast.is_active,
                uploadDate: updatedBroadcast.upload_date,
                listens: updatedBroadcast.listens
            }
        });
        
    } catch (error) {
        console.error('Error updating audio broadcast:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating the audio broadcast',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete an audio broadcast
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteAudioBroadcast = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        
        // Check if broadcast exists
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        // Delete audio file from S3
        if (broadcast.audio_file_url) {
            // Extract the key from the URL
            const audioUrlParts = broadcast.audio_file_url.split('/');
            const audioKey = `audio_broadcasts/${userId}/${audioUrlParts[audioUrlParts.length - 1]}`;
            
            // Try to delete file - don't fail if deletion fails
            try {
                await deleteS3File(audioKey);
            } catch (error) {
                console.error('Failed to delete audio file:', error);
            }
        }
        
        // Delete cover image from S3
        if (broadcast.image_url) {
            // Extract the key from the URL
            const imageUrlParts = broadcast.image_url.split('/');
            const imageKey = `audio_broadcasts/covers/${userId}/${imageUrlParts[imageUrlParts.length - 1]}`;
            
            // Try to delete file - don't fail if deletion fails
            try {
                await deleteS3File(imageKey);
            } catch (error) {
                console.error('Failed to delete cover image:', error);
            }
        }
        
        // Delete broadcast from database
        await broadcast.destroy();
        
        res.status(200).json({
            status: 'success',
            message: 'Audio broadcast deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting audio broadcast:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while deleting the audio broadcast',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Toggle active status of an audio broadcast
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const toggleAudioBroadcastStatus = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if broadcast exists
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        // Toggle active status
        const newStatus = !broadcast.is_active;
        
        await broadcast.update({
            is_active: newStatus
        });
        
        res.status(200).json({
            status: 'success',
            message: `Audio broadcast ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data: {
                id: broadcast.id,
                isActive: newStatus
            }
        });
        
    } catch (error) {
        console.error('Error toggling audio broadcast status:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while toggling the audio broadcast status',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get audio broadcast stats
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAudioBroadcastStats = async (req, res) => {
    try {
        // Get counts for overview stats
        const [totalCount, activeCount, totalDuration, totalListeners] = await Promise.all([
            AudioBroadcast.count(),
            AudioBroadcast.count({ where: { is_active: 1 } }),
            AudioBroadcast.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.fn('TIME_TO_SEC', sequelize.col('duration'))), 'total_seconds']
                ],
                raw: true
            }),
            AudioBroadcast.findOne({
                attributes: [
                    [sequelize.fn('SUM', sequelize.col('listens')), 'total_listens']
                ],
                raw: true
            })
        ]);

        // Calculate total duration in hours and minutes
        let totalHours = 0;
        let totalMinutes = 0;
        
        if (totalDuration && totalDuration.total_seconds) {
            const totalSecondsVal = parseInt(totalDuration.total_seconds);
            totalHours = Math.floor(totalSecondsVal / 3600);
            totalMinutes = Math.floor((totalSecondsVal % 3600) / 60);
        }
        
        // Calculate total listeners
        const listeners = totalListeners && totalListeners.total_listens ? parseInt(totalListeners.total_listens) : 0;
        
        res.status(200).json({
            status: 'success',
            message: 'Audio broadcast stats retrieved successfully',
            data: {
                totalBroadcasts: totalCount,
                activeBroadcasts: activeCount,
                totalDuration: `${totalHours}h ${totalMinutes}m`,
                totalListeners: listeners
            }
        });
        
    } catch (error) {
        console.error('Error fetching audio broadcast stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching audio broadcast stats',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Increment listen count for an audio broadcast
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const incrementListenCount = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if broadcast exists
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        // Increment listen count
        await broadcast.update({
            listens: sequelize.literal('listens + 1')
        });
        
        // Get updated count
        const updatedBroadcast = await AudioBroadcast.findByPk(id);
        
        res.status(200).json({
            status: 'success',
            message: 'Listen count incremented successfully',
            data: {
                id: updatedBroadcast.id,
                listens: updatedBroadcast.listens
            }
        });
        
    } catch (error) {
        console.error('Error incrementing listen count:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while incrementing the listen count',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Download an audio broadcast file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const downloadAudioBroadcast = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if broadcast exists
        const broadcast = await AudioBroadcast.findByPk(id);
        
        if (!broadcast) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio broadcast not found'
            });
        }
        
        const audioUrl = broadcast.audio_file_url;
        
        if (!audioUrl) {
            return res.status(404).json({
                status: 'error',
                message: 'Audio file not found'
            });
        }
        const s3 = new AWS.S3();
        
        // Parse the S3 URL to get the bucket and key
        const urlParts = audioUrl.replace('https://', '').split('/');
        const bucket = urlParts[0].split('.')[0]; // Extracts bucket name from URL
        
        // Join the remaining parts to get the S3 key
        const key = urlParts.slice(1).join('/');
        
        // Generate a signed URL for downloading (expires in 5 minutes)
        const signedUrl = s3.getSignedUrl('getObject', {
            Bucket: bucket,
            Key: key,
            Expires: 300, // 5 minutes
            ResponseContentDisposition: `attachment; filename="${broadcast.audio_file_name}"`
        });
        
        // Return the signed URL to the client
        res.status(200).json({
            status: 'success',
            message: 'Download URL generated successfully',
            data: {
                downloadUrl: signedUrl,
                fileName: broadcast.audio_file_name
            }
        });
        
    } catch (error) {
        console.error('Error generating download URL:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while generating the download URL',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get categories list
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCategories = async (req, res) => {
    try {
        // Get distinct categories
        const categories = await AudioBroadcast.findAll({
            attributes: [
                [sequelize.fn('DISTINCT', sequelize.col('category')), 'category']
            ],
            where: {
                category: {
                    [Op.not]: null
                }
            },
            raw: true
        });
        
        // Format categories
        const formattedCategories = categories
            .map(item => item.category)
            .filter(Boolean);
        
        res.status(200).json({
            status: 'success',
            message: 'Categories retrieved successfully',
            data: formattedCategories
        });
        
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching categories',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Setup multer for handling file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    }
});

// Setup multer fields for handling multiple file types
const uploadFields = upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
]);

module.exports = {
    getAudioBroadcasts,
    getAudioBroadcastById,
    createAudioBroadcast,
    updateAudioBroadcast,
    deleteAudioBroadcast,
    toggleAudioBroadcastStatus,
    getAudioBroadcastStats,
    incrementListenCount,
    downloadAudioBroadcast,
    getCategories,
    uploadFields
};