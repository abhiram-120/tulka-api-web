const express = require('express');
const router = express.Router();
const teacherProfileController = require('../../controller/teacher/teacher-profile.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Basic teacher profile routes
router.get('/', AuthValidator, teacherProfileController.getTeacherProfile);
router.put('/update', AuthValidator, teacherProfileController.updateTeacherProfile);
router.put('/change-password', AuthValidator, teacherProfileController.changeTeacherPassword);
router.post('/teacher/save-skills', AuthValidator, teacherProfileController.saveTeacherSkills);
router.get('/teacher/get-skills', AuthValidator, teacherProfileController.getTeacherSkills);

// Avatar upload route
router.post('/update-avatar', AuthValidator, teacherProfileController.upload.single('avatar'), teacherProfileController.uploadTeacherAvatar);

// Notification settings routes
router.get('/notifications', AuthValidator, teacherProfileController.getTeacherProfile);
router.put('/notifications/settings', AuthValidator, teacherProfileController.updateNotificationPreferences);

// Zoom settings routes
router.get('/zoom-settings', AuthValidator, teacherProfileController.getTeacherProfile);
router.put('/zoom-settings/update', AuthValidator, teacherProfileController.updateZoomSettings);

// Teaching details routes
router.get('/teaching-details', AuthValidator, teacherProfileController.getTeacherProfile);
router.put('/teaching-details/update', AuthValidator, teacherProfileController.thumbnailUpload.single('video_demo_thumb'), teacherProfileController.updateTeachingDetails);

// Media upload routes
router.post('/upload-intro-video', AuthValidator, teacherProfileController.upload.single('video'), teacherProfileController.uploadIntroVideo);
router.post('/upload-class-video', AuthValidator, teacherProfileController.upload.single('video'), teacherProfileController.uploadClassVideo);
router.post('/upload-thumbnail', AuthValidator, teacherProfileController.thumbnailUpload.single('thumbnail'), teacherProfileController.uploadVideoThumbnail);
router.delete('/delete-video/:id', AuthValidator, teacherProfileController.deleteVideo);

module.exports = router;