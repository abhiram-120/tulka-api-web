const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const engagementController = require('../../controller/admin/engagement.controller');

// ============================================================
// NOTIFICATION RULES - CRUD
// ============================================================

// GET all notification rules
router.get('/rules', AuthValidator, engagementController.getRules);

// GET available trigger types (for dropdowns in admin UI)
router.get('/trigger-types', AuthValidator, engagementController.getTriggerTypes);

// GET single rule by ID
router.get('/rules/:id', AuthValidator, engagementController.getRuleById);

// POST create new rule
router.post('/rules', AuthValidator, engagementController.createRule);

// PUT update rule
router.put('/rules/:id', AuthValidator, engagementController.updateRule);

// DELETE rule
router.delete('/rules/:id', AuthValidator, engagementController.deleteRule);

// PATCH toggle rule active/inactive
router.patch('/rules/:id/toggle', AuthValidator, engagementController.toggleRule);

// ============================================================
// STATS, LOGS & ACTIVITY
// ============================================================

// GET engagement statistics
router.get('/stats', AuthValidator, engagementController.getStats);

// GET notification logs
router.get('/logs', AuthValidator, engagementController.getLogs);

// GET student activity data  
router.get('/activity', AuthValidator, engagementController.getStudentActivity);

module.exports = router;
