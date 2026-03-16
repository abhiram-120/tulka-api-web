const { processAndSaveAvatar, deleteOldAvatar, isValidImageType, processAndSaveVideo, processAndSaveThumbnail, deleteOldVideo, deleteOldThumbnail, isValidVideoType, processAndSaveHomework, deleteOldHomework, processAndSaveEvaluation, deleteOldEvaluation } = require('../../utils/storage/file-storage');
const User = require('../../models/users');
const { sequelize } = require('../../connection/connection');

/**
 * Upload and process avatar image
 * @param {number} userId - User ID
 * @param {Object} file - Uploaded file object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
const uploadAvatar = async (userId, file) => {
    let transaction;
    
    try {
        if (!file) {
            return {
                success: false,
                error: 'No file provided'
            };
        }

        // Validate file type
        if (!isValidImageType(file.mimetype)) {
            return {
                success: false,
                error: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.'
            };
        }

        // Validate file size (5MB max)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: 'File is too large. Maximum size is 5MB.'
            };
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Get current user data
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            await transaction.rollback();
            return {
                success: false,
                error: 'User not found'
            };
        }

        // Process and save new avatar
        const { fileName } = await processAndSaveAvatar(file.buffer, file.originalname);

        // Delete old avatar if exists
        if (user.avatar) {
            await deleteOldAvatar(user.avatar);
        }

        // Update user record with new avatar
        await user.update({
            avatar: fileName,
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Generate avatar URL
        const avatarUrl = `/storage/avatars/${fileName}`;

        return {
            success: true,
            data: {
                avatar_url: avatarUrl,
                fileName: fileName
            }
        };

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in uploadAvatar:', error);
        return {
            success: false,
            error: 'Failed to upload avatar'
        };
    }
};

/**
 * Upload and process video
 * @param {number} userId - User ID
 * @param {Object} file - Uploaded file object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
const uploadVideo = async (userId, file) => {
    let transaction;
    
    try {
        if (!file) {
            return {
                success: false,
                error: 'No file provided'
            };
        }

        // Validate file type
        if (!isValidVideoType(file.mimetype)) {
            return {
                success: false,
                error: 'Invalid file type. Please upload an MP4, MOV, WEBM, or AVI video.'
            };
        }

        // Validate file size (50MB max)
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: 'File is too large. Maximum size is 50MB.'
            };
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Get current user data
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            await transaction.rollback();
            return {
                success: false,
                error: 'User not found'
            };
        }

        // Process and save new video
        const { fileName, thumbnailFileName } = await processAndSaveVideo(file.buffer, file.originalname);

        // Delete old video if exists
        if (user.video_demo) {
            await deleteOldVideo(user.video_demo);
        }

        // Delete old thumbnail if exists
        if (user.video_demo_thumb) {
            await deleteOldThumbnail(user.video_demo_thumb);
        }

        // Update user record with new video and thumbnail
        await user.update({
            video_demo: fileName,
            video_demo_thumb: thumbnailFileName,
            video_demo_source: 'upload',
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Generate URLs
        const videoUrl = `/storage/videos/${fileName}`;
        const thumbnailUrl = thumbnailFileName ? `/storage/thumbnails/${thumbnailFileName}` : null;

        return {
            success: true,
            data: {
                video_url: videoUrl,
                fileName: fileName,
                thumbnail_url: thumbnailUrl,
                thumbnailFileName: thumbnailFileName
            }
        };

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in uploadVideo:', error);
        return {
            success: false,
            error: 'Failed to upload video'
        };
    }
};

/**
 * Upload and process thumbnail image
 * @param {number} userId - User ID
 * @param {Object} file - Uploaded file object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
const uploadThumbnail = async (userId, file) => {
    let transaction;
    
    try {
        if (!file) {
            return {
                success: false,
                error: 'No file provided'
            };
        }

        // Validate file type
        if (!isValidImageType(file.mimetype)) {
            return {
                success: false,
                error: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.'
            };
        }

        // Validate file size (5MB max)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: 'File is too large. Maximum size is 5MB.'
            };
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Get current user data
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            await transaction.rollback();
            return {
                success: false,
                error: 'User not found'
            };
        }

        // Process and save new thumbnail
        const { fileName } = await processAndSaveThumbnail(file.buffer, file.originalname);

        // Delete old thumbnail if exists
        if (user.video_demo_thumb) {
            await deleteOldThumbnail(user.video_demo_thumb);
        }

        // Update user record with new thumbnail
        await user.update({
            video_demo_thumb: fileName,
            updated_at: Math.floor(Date.now() / 1000)
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Generate thumbnail URL
        const thumbnailUrl = `/storage/thumbnails/${fileName}`;

        return {
            success: true,
            data: {
                thumbnail_url: thumbnailUrl,
                fileName: fileName
            }
        };

    } catch (error) {
        if (transaction) await transaction.rollback();
        
        console.error('Error in uploadThumbnail:', error);
        return {
            success: false,
            error: 'Failed to upload thumbnail'
        };
    }
};

/**
 * Upload and process homework file
 * @param {number} userId - User ID
 * @param {Object} file - Uploaded file object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
const uploadHomeworkFile = async (userId, file) => {
    try {
        if (!file) {
            return {
                success: false,
                error: 'No file provided'
            };
        }

        // Define allowed file types (PDF, DOC, DOCX, etc.)
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'application/zip',
            'application/x-zip-compressed',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/gif'
        ];

        // Validate file type
        if (!allowedTypes.includes(file.mimetype)) {
            return {
                success: false,
                error: 'Invalid file type. Please upload a supported document format.'
            };
        }

        // Validate file size (20MB max)
        const maxSize = 20 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: 'File is too large. Maximum size is 20MB.'
            };
        }

        // Process and save the homework file
        const { fileName } = await processAndSaveHomework(file.buffer, file.originalname);

        // Generate URL
        const fileUrl = `storage/homework/${fileName}`;

        return {
            success: true,
            data: {
                file_url: fileUrl,
                fileName: fileName
            }
        };
    } catch (error) {
        console.error('Error in uploadHomeworkFile:', error);
        return {
            success: false,
            error: 'Failed to upload homework file'
        };
    }
};

/**
 * Delete old homework file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteHomeworkFile = async (fileName) => {
    if (!fileName) return;
    
    try {
        await deleteOldHomework(fileName);
    } catch (error) {
        console.error('Error deleting homework file:', error);
        // Don't throw error as this is not critical
    }
};

/**
 * Upload and process evaluation file
 * @param {number} userId - User ID
 * @param {Object} file - Uploaded file object
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
const uploadEvaluationFile = async (userId, file) => {
    try {
        if (!file) {
            return {
                success: false,
                error: 'No file provided'
            };
        }

        // Define allowed file types (PDF, DOC, etc.)
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'image/jpeg',
            'image/png'
        ];

        // Validate file type
        if (!allowedTypes.includes(file.mimetype)) {
            return {
                success: false,
                error: 'Invalid file type. Please upload a supported document format.'
            };
        }

        // Validate file size (10MB max)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                success: false,
                error: 'File is too large. Maximum size is 10MB.'
            };
        }

        // Process and save the evaluation file
        const { fileName } = await processAndSaveEvaluation(file.buffer, file.originalname);

        // Generate URL
        const fileUrl = `/storage/evaluations/${fileName}`;

        return {
            success: true,
            data: {
                file_url: fileUrl,
                fileName: fileName
            }
        };
    } catch (error) {
        console.error('Error in uploadEvaluationFile:', error);
        return {
            success: false,
            error: 'Failed to upload evaluation file'
        };
    }
};

/**
 * Delete old evaluation file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteEvaluationFile = async (fileName) => {
    if (!fileName) return;
    
    try {
        await deleteOldEvaluation(fileName);
    } catch (error) {
        console.error('Error deleting evaluation file:', error);
        // Don't throw error as this is not critical
    }
};

module.exports = {
    uploadAvatar,
    uploadVideo,
    uploadThumbnail,
    uploadHomeworkFile,
    deleteHomeworkFile,
    uploadEvaluationFile,
    deleteEvaluationFile
};