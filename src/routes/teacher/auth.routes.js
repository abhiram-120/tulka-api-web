const express = require('express');
const teacherAuthController = require('../../controller/teacher/auth.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');
const router = express.Router();

router.post('/teacher-login', teacherAuthController.loginTeacher);
router.post('/teacher-logout', AuthValidator, teacherAuthController.logoutTeacher);
router.get('/auth-check', AuthValidator, teacherAuthController.authCheck);

module.exports = router;