const express = require('express');
const teacherController = require('../../controller/mobile/teachers.controller');
const AuthValidator = require('../../middleware/verify-token');

const router = express.Router();

router.get('/teacher-reviews/:id', AuthValidator, teacherController.getTeacherReviews);

module.exports = router;