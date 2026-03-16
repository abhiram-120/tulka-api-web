const express = require('express');
const router = express.Router();
const gameApprovalController = require('../../controller/teacher/game-approval.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Get all ended classes for the teacher
router.get('/ended-classes', AuthValidator, gameApprovalController.getEndedClasses);

// Get class details by ID for game approval
router.get('/class/:id', AuthValidator, gameApprovalController.getClassDetailsForApproval);

// Get game approval data from external API
router.get('/game-data', AuthValidator, gameApprovalController.getGameApprovalData);

// Submit approved game approval data
router.post('/submit/:classId', AuthValidator, gameApprovalController.submitGameApproval);

// Get approved game approval data for a class
router.get('/approved/:classId', AuthValidator, gameApprovalController.getApprovedGameApproval);

module.exports = router;

