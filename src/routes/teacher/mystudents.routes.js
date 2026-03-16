// routes/teacher/mystudents.routes.js
const express = require('express');
const router = express.Router();
const myStudentsController = require('../../controller/teacher/mystudents.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Teacher my students routes
router.get('/levels', AuthValidator, myStudentsController.getStudentLevels);
router.get('/list', AuthValidator, myStudentsController.getMyStudents);
router.get('/student/:id', AuthValidator, myStudentsController.getStudentDetails);
router.patch('/student/:id/level', AuthValidator, myStudentsController.updateStudentLevel);

module.exports = router;