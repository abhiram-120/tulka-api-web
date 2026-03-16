// services/audioBroadcast/file-service.js
const AWS = require('aws-sdk');
const config = require('../../config/config');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

        return {
            success: true,
            data: {
                file_url: uploadResult.Location,
                file_key: uploadResult.Key,
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
                file_key: uploadResult.Key
            }
        };
    } catch (error) {
        console.error('Error uploading cover image:', error);
        return { success: false, error: 'Failed to upload cover image' };
    }
};

/**
 * Delete audio file from S3
 * @param {string} fileKey - The S3 key of the file to delete
 * @returns {Promise<Object>} - Success status
 */
const deleteAudioFile = async (fileKey) => {
    try {
        await s3.deleteObject({
            Bucket: config.AWS_BUCKET,
            Key: fileKey
        }).promise();

        return { success: true };
    } catch (error) {
        console.error('Error deleting audio file:', error);
        return { success: false, error: 'Failed to delete audio file' };
    }
};

/**
 * Delete cover image from S3
 * @param {string} fileKey - The S3 key of the file to delete
 * @returns {Promise<Object>} - Success status
 */
const deleteCoverImage = async (fileKey) => {
    try {
        await s3.deleteObject({
            Bucket: config.AWS_BUCKET,
            Key: fileKey
        }).promise();

        return { success: true };
    } catch (error) {
        console.error('Error deleting cover image:', error);
        return { success: false, error: 'Failed to delete cover image' };
    }
};

module.exports = {
    uploadAudioFile,
    uploadCoverImage,
    deleteAudioFile,
    deleteCoverImage
};