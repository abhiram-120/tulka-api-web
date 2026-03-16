const express = require('express');
const router = express.Router();
const teacherClassesController = require('../../controller/teacher/teacher-classes.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Get teacher's classes with pagination and filtering
router.get('/', AuthValidator, teacherClassesController.viewTeacherClasses);

// Get class counts for dashboard badges
router.get('/counts', AuthValidator, teacherClassesController.getClassCounts);

// Get trial class evaluation data
router.get('/evaluation/:id', AuthValidator, teacherClassesController.getTrialEvaluation);

// Add routes for feedback, homework, and evaluation
router.post('/feedback/:id', AuthValidator, teacherClassesController.submitFeedback);
router.post('/homework/:id', AuthValidator, teacherClassesController.homeworkUpload.fields([{name:'attachment',maxCount:1},{name:'image',maxCount:1}]), teacherClassesController.assignHomework);
router.post('/evaluation/:id', AuthValidator, teacherClassesController.evaluationUpload.single('attachment'), teacherClassesController.submitEvaluation);
router.post('/absent/:id', AuthValidator, teacherClassesController.markAbsent);

router.get('/feedback/:id', AuthValidator, teacherClassesController.getSubmittedFeedback);
router.get('/homework/:id', AuthValidator, teacherClassesController.getSubmittedHomework);

module.exports = router;