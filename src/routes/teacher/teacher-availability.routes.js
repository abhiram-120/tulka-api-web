const express = require('express');
const router = express.Router();
const teacherAvailabilityController = require('../../controller/teacher/teacher-availability.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Basic availability routes
router.get('/', AuthValidator, teacherAvailabilityController.getTeacherAvailability);
router.put('/update', AuthValidator, teacherAvailabilityController.updateTeacherAvailability);

// Grid format routes
router.get('/grid', AuthValidator, teacherAvailabilityController.getGridAvailability);
router.post('/grid/save', AuthValidator, teacherAvailabilityController.saveGridAvailability);

// Clear availability
router.delete('/clear', AuthValidator, teacherAvailabilityController.clearAvailability);

module.exports = router;