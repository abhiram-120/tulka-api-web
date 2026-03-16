const express = require('express');
const router = express.Router();
const teacherFeedbackController = require('../../controller/teacher/teacher-feedback.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Get teacher's feedback with pagination and filtering
router.get('/', AuthValidator, teacherFeedbackController.getTeacherFeedback);

// Get feedback statistics for dashboard
router.get('/stats', AuthValidator, teacherFeedbackController.getFeedbackStats);

// Get specific feedback details
router.get('/:id', AuthValidator, teacherFeedbackController.getFeedbackDetails);

// Update feedback (teacher can modify their feedback)
router.put('/:id', AuthValidator, teacherFeedbackController.updateFeedback);

// Delete feedback
router.delete('/:id', AuthValidator, teacherFeedbackController.deleteFeedback);

// Get feedback by lesson/class ID
router.get('/lesson/:lessonId', AuthValidator, teacherFeedbackController.getFeedbackByLesson);

// Get feedback summary/analytics
router.get('/analytics/summary', AuthValidator, teacherFeedbackController.getFeedbackAnalytics);

module.exports = router;