const path = require('path');

module.exports = {
    // Storage paths
    paths: {
        storage: path.join(__dirname, '..', 'storage'),
        avatar: path.join(__dirname, '..', 'storage', 'avatar'),  // Single avatar directory
        avatars: path.join(__dirname, '..', 'storage', 'avatars'),
        video: path.join(__dirname, '..', 'storage', 'videos'),
        thumbnail: path.join(__dirname, '..', 'storage', 'thumbnails'),
        temp: path.join(__dirname, '..', 'storage', 'temp'),
        homework: path.join(__dirname, '..', 'storage', 'homework'),       // Homework files directory
        evaluation: path.join(__dirname, '..', 'storage', 'evaluations')   // Evaluations directory
    },

    // File upload limits
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 1
    },

    // Allowed file types
    allowedTypes: {
        image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        video: ['video/mp4', 'video/quicktime', 'video/mpeg', 'video/x-msvideo', 'video/webm'],
        document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain']
    },

    // Image processing settings
    imageProcessing: {
        avatar: {
            width: 400,
            height: 400,
            quality: 80,
            format: 'jpeg'
        }
    },

    // URLs
    urls: {
        avatar: '/storage/avatar',
        avatars: '/storage/avatars',
        temp: '/storage/temp',
        video: '/storage/videos',
        thumbnail: '/storage/thumbnails',
        homework: '/storage/homework',
        evaluation: '/storage/evaluations'
    }
};