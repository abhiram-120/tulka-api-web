const express = require('express');
const teacherPerformanceController = require('../../controller/admin/teacher-performance.controller');
const router = express.Router();

// GET /api/adminTeacherPerformance/overview
router.get('/overview', teacherPerformanceController.getTeacherPerformanceOverview);

// GET /api/adminTeacherPerformance/teacher/:id
router.get('/teacher/:id', teacherPerformanceController.getTeacherDetail);

// GET /api/adminTeacherPerformance/comparison
router.get('/comparison', teacherPerformanceController.getTeacherComparison);

// GET /api/adminTeacherPerformance/teachers
router.get('/teachers', teacherPerformanceController.getTeachersList);

module.exports = router;
