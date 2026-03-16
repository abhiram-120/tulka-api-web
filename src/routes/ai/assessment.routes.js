const express = require('express');
const router = express.Router();
const assessmentController = require('../../controller/ai/assessment.controller');
const AuthValidator = require('../../middleware/verify-token');

// POST: start assessment
router.post('/start', AuthValidator, assessmentController.startAssessment);

// POST: submit assessment
router.post('/submit', AuthValidator, assessmentController.submitAssessment);

// POST: import assessment questions from JSON file
router.post('/import-questions', assessmentController.importAssessmentQuestions);

module.exports = router;
