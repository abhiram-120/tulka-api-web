const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const storageConfig = require('../../config/storage.config');

// Ensure storage directories exist
Object.values(storageConfig.paths).forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Make sure homework and evaluation directories exist
if (!storageConfig.paths.homework) {
    storageConfig.paths.homework = path.join(__dirname, '../../storage/homework');
}
if (!fs.existsSync(storageConfig.paths.homework)) {
    fs.mkdirSync(storageConfig.paths.homework, { recursive: true });
}

if (!storageConfig.paths.evaluation) {
    storageConfig.paths.evaluation = path.join(__dirname, '../../storage/evaluations');
}
if (!fs.existsSync(storageConfig.paths.evaluation)) {
    fs.mkdirSync(storageConfig.paths.evaluation, { recursive: true });
}

/**
 * Process and save avatar image
 * @param {Buffer} buffer - Image buffer
 * @param {string} originalName - Original file name
 * @returns {Promise<{fileName: string, filePath: string}>}
 */
const processAndSaveAvatar = async (buffer, originalName) => {
    try {
        const fileName = `${uuidv4()}${path.extname(originalName)}`;
        const filePath = path.join(storageConfig.paths.avatar, fileName);

        // Process image with sharp
        await sharp(buffer)
            .resize(
                storageConfig.imageProcessing.avatar.width,
                storageConfig.imageProcessing.avatar.height,
                { fit: 'cover', withoutEnlargement: true }
            )
            .jpeg({ quality: storageConfig.imageProcessing.avatar.quality })
            .toFile(filePath);

        return {
            fileName,
            filePath,
            url: `${storageConfig.urls.avatar}/${fileName}`
        };
    } catch (error) {
        console.error('Error processing avatar:', error);
        throw new Error('Failed to process avatar image');
    }
};

/**
 * Delete old avatar file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteOldAvatar = async (fileName) => {
    if (!fileName) return;

    const filePath = path.join(storageConfig.paths.avatar, fileName);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (error) {
        console.error('Error deleting old avatar:', error);
        // Don't throw error as this is not critical
    }
};

/**
 * Validate file type
 * @param {string} mimeType - File MIME type
 * @returns {boolean}
 */
const isValidImageType = (mimeType) => {
    return storageConfig.allowedTypes.image.includes(mimeType);
};

/**
 * Clean temp directory
 * Removes files older than 1 hour
 */
const cleanTempDirectory = async () => {
    try {
        const files = await fs.promises.readdir(storageConfig.paths.temp);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const file of files) {
            const filePath = path.join(storageConfig.paths.temp, file);
            const stats = await fs.promises.stat(filePath);

            if (stats.mtimeMs < oneHourAgo) {
                await fs.promises.unlink(filePath);
            }
        }
    } catch (error) {
        console.error('Error cleaning temp directory:', error);
    }
};

/**
 * Process and save video
 * @param {Buffer} buffer - Video buffer
 * @param {string} originalName - Original file name
 * @returns {Promise<{fileName: string, filePath: string, thumbnailFileName: string, thumbnailFilePath: string}>}
 */
const processAndSaveVideo = async (buffer, originalName) => {
    try {
        const fileName = `${uuidv4()}${path.extname(originalName)}`;
        const filePath = path.join(storageConfig.paths.video, fileName);
        
        // Save video file
        await fs.promises.writeFile(filePath, buffer);
        
        // Generate thumbnail from video (this would typically use ffmpeg)
        // For this example, we'll create a placeholder
        const thumbnailFileName = `${uuidv4()}.jpg`;
        const thumbnailFilePath = path.join(storageConfig.paths.thumbnail, thumbnailFileName);
        
        // In a real implementation, you would use ffmpeg to extract a frame
        // Here we're just creating a placeholder image
        await sharp({
            create: {
                width: 640,
                height: 360,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        })
        .jpeg({ quality: 80 })
        .toFile(thumbnailFilePath);
        
        return {
            fileName,
            filePath,
            thumbnailFileName,
            thumbnailFilePath,
            url: `${storageConfig.urls.video}/${fileName}`,
            thumbnailUrl: `${storageConfig.urls.thumbnail}/${thumbnailFileName}`
        };
    } catch (error) {
        console.error('Error processing video:', error);
        throw new Error('Failed to process video file');
    }
};

/**
 * Process and save thumbnail image
 * @param {Buffer} buffer - Image buffer
 * @param {string} originalName - Original file name
 * @returns {Promise<{fileName: string, filePath: string}>}
 */
const processAndSaveThumbnail = async (buffer, originalName) => {
    try {
        const fileName = `${uuidv4()}${path.extname(originalName)}`;
        const filePath = path.join(storageConfig.paths.thumbnail, fileName);

        // Process image with sharp
        await sharp(buffer)
            .resize(
                640, // Thumbnail width
                360, // Thumbnail height (16:9 aspect ratio)
                { fit: 'cover', withoutEnlargement: true }
            )
            .jpeg({ quality: 80 })
            .toFile(filePath);

        return {
            fileName,
            filePath,
            url: `${storageConfig.urls.thumbnail}/${fileName}`
        };
    } catch (error) {
        console.error('Error processing thumbnail:', error);
        throw new Error('Failed to process thumbnail image');
    }
};

/**
 * Delete old video file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteOldVideo = async (fileName) => {
    if (!fileName) return;

    const filePath = path.join(storageConfig.paths.video, fileName);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (error) {
        console.error('Error deleting old video:', error);
        // Don't throw error as this is not critical
    }
};

/**
 * Delete old thumbnail file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteOldThumbnail = async (fileName) => {
    if (!fileName) return;

    const filePath = path.join(storageConfig.paths.thumbnail, fileName);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (error) {
        console.error('Error deleting old thumbnail:', error);
        // Don't throw error as this is not critical
    }
};

/**
 * Validate video file type
 * @param {string} mimeType - File MIME type
 * @returns {boolean}
 */
const isValidVideoType = (mimeType) => {
    return storageConfig.allowedTypes.video.includes(mimeType);
};

/**
 * Process and save homework file
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original file name
 * @returns {Promise<{fileName: string, filePath: string}>}
 */
const processAndSaveHomework = async (buffer, originalName) => {
    try {
        const fileName = `${uuidv4()}${path.extname(originalName)}`;
        const filePath = path.join(storageConfig.paths.homework, fileName);
        
        // Save file directly (no processing needed for documents)
        await fs.promises.writeFile(filePath, buffer);
        
        return {
            fileName,
            filePath,
            url: `${storageConfig.urls.homework || '/storage/homework'}/${fileName}`
        };
    } catch (error) {
        console.error('Error processing homework file:', error);
        throw new Error('Failed to process homework file');
    }
};

/**
 * Delete old homework file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteOldHomework = async (fileName) => {
    if (!fileName) return;

    // Extract just the filename if a full path is provided
    const baseFileName = path.basename(fileName);
    const filePath = path.join(storageConfig.paths.homework, baseFileName);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (error) {
        console.error('Error deleting old homework file:', error);
        // Don't throw error as this is not critical
    }
};

/**
 * Process and save evaluation file
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original file name
 * @returns {Promise<{fileName: string, filePath: string}>}
 */
const processAndSaveEvaluation = async (buffer, originalName) => {
    try {
        const fileName = `${uuidv4()}${path.extname(originalName)}`;
        const filePath = path.join(storageConfig.paths.evaluation, fileName);
        
        // Save file directly (no processing needed for documents)
        await fs.promises.writeFile(filePath, buffer);
        
        return {
            fileName,
            filePath,
            url: `${storageConfig.urls.evaluation || '/storage/evaluations'}/${fileName}`
        };
    } catch (error) {
        console.error('Error processing evaluation file:', error);
        throw new Error('Failed to process evaluation file');
    }
};

/**
 * Delete old evaluation file
 * @param {string} fileName - File name to delete
 * @returns {Promise<void>}
 */
const deleteOldEvaluation = async (fileName) => {
    if (!fileName) return;

    // Extract just the filename if a full path is provided
    const baseFileName = path.basename(fileName);
    const filePath = path.join(storageConfig.paths.evaluation, baseFileName);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (error) {
        console.error('Error deleting old evaluation file:', error);
        // Don't throw error as this is not critical
    }
};

// Run temp directory cleanup every hour
setInterval(cleanTempDirectory, 60 * 60 * 1000);

module.exports = {
    processAndSaveAvatar,
    deleteOldAvatar,
    isValidImageType,
    processAndSaveVideo,
    processAndSaveThumbnail,
    deleteOldVideo, 
    deleteOldThumbnail,
    isValidVideoType,
    cleanTempDirectory,
    processAndSaveHomework,
    deleteOldHomework,
    processAndSaveEvaluation,
    deleteOldEvaluation
};