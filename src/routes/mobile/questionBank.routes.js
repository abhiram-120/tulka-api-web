const express = require('express');
const authController = require('../../controller/mobile/questionBank.controller');
const AuthValidator = require('../../middleware/verify-token');
const router = express.Router();

// Get all active questions
router.get('/get-questions', AuthValidator, authController.getAllActiveQuestions);

// Get questions by type
router.get('/get-questions/:type', AuthValidator, authController.getQuestionsByType);

// Store single question response
router.post('/store-response', AuthValidator, authController.storeQuestionResponse);

// Store multiple question responses (bulk) - ENHANCED WITH CACHING
router.post('/store-responses', AuthValidator, authController.storeMultipleResponses);

// Get user's responses
router.get('/get-responses', AuthValidator, authController.getUserResponses);

// NEW: Get cached recommendations only (fast check)
router.get('/get-cached-recommendations', AuthValidator, authController.getCachedRecommendations);

// NEW: Clear user's recommendation cache (force regeneration)
router.delete('/clear-cache', AuthValidator, authController.clearRecommendationCache);

router.get('/get-questionnaire-status', AuthValidator, authController.getUserQuestionnaireStatus);

/** module exports */
module.exports = router;