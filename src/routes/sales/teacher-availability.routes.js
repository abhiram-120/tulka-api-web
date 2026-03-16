const express = require('express');
const router = express.Router();
const teacherAvailabilityController = require('../../controller/sales/teacher-availability.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Get all available teachers with their time slots
router.get('/teachers/availability', AuthValidator, teacherAvailabilityController.getTeacherAvailability);

// Get specific teacher's availability
router.get('/teachers/:teacherId/availability', AuthValidator, teacherAvailabilityController.getTeacherAvailabilityById);

// Get teachers by language or other filters
router.get('/teachers/filter', AuthValidator, teacherAvailabilityController.getFilteredTeachers);

// Get specific time slot availability
router.get('/timeslots', AuthValidator, teacherAvailabilityController.getTimeSlotAvailability);

// Check specific teacher availability for a time range
router.post('/teachers/:teacherId/check-availability', AuthValidator, teacherAvailabilityController.checkTeacherAvailability);

module.exports = router;