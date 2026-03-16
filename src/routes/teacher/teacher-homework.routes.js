const express = require('express');
const router = express.Router();
const teacherHomeworkController = require('../../controller/teacher/teacher-homework.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Get teacher's homework assignments with pagination and filtering
router.get('/', AuthValidator, teacherHomeworkController.getTeacherHomework);

// Get homework statistics for dashboard
router.get('/stats', AuthValidator, teacherHomeworkController.getHomeworkStats);

// Get specific homework details
router.get('/:id', AuthValidator, teacherHomeworkController.getHomeworkDetails);

// Update homework (teacher can modify description, notes)
router.put('/:id', AuthValidator, teacherHomeworkController.homeworkUpload.single('attachment'), teacherHomeworkController.updateHomework);

// Delete homework
router.delete('/:id', AuthValidator, teacherHomeworkController.deleteHomework);

// Review submitted homework (add teacher feedback and grade)
router.post('/:id/review', AuthValidator, teacherHomeworkController.reviewHomework);

// Get homework submissions/answers
router.get('/:id/submissions', AuthValidator, teacherHomeworkController.getHomeworkSubmissions);

module.exports = router;