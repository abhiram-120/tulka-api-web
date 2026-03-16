const express = require('express');
const router = express.Router();
const studentController = require('../../controller/admin/students-portal.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Get list of students with optional filtering
router.get('/list', AuthValidator, studentController.getStudents);

// Get list of subscribed students with optional filtering
router.get('/studentSubscribed', AuthValidator, studentController.getSubscribedStudents);

// Search students by name or email
router.get('/search', AuthValidator, studentController.searchStudents);

// Get specific student by ID
router.get('/:id', AuthValidator, studentController.getStudentById);

// Get student's subscription details
router.get('/:id/subscription', AuthValidator, studentController.getStudentSubscription);

module.exports = router;