const express = require('express');
const teacherPerformanceController = require('../../controller/admin/teacher-performance.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const router = express.Router();

// GET /api/adminTeacherPerformance/overview
router.get('/overview', AuthValidator, teacherPerformanceController.getTeacherPerformanceOverview);

// GET /api/adminTeacherPerformance/teacher/:id
router.get('/teacher/:id', AuthValidator, teacherPerformanceController.getTeacherDetail);

// GET /api/adminTeacherPerformance/comparison
router.get('/comparison', AuthValidator, teacherPerformanceController.getTeacherComparison);

// GET /api/adminTeacherPerformance/teachers
router.get('/teachers', AuthValidator, teacherPerformanceController.getTeachersList);

module.exports = router;
