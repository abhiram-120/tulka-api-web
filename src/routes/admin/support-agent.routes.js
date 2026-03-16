const express = require('express');
const supportAgentController = require('../../controller/admin/support-agent.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const router = express.Router();
const ensureSupportAgentsAccess = checkPermission('support-agents', 'read');
const ensureSupportAgentsCreate = checkPermission('support-agents', 'create');
const ensureSupportAgentsUpdate = checkPermission('support-agents', 'update');
const ensureSupportAgentsDelete = checkPermission('support-agents', 'delete');

// Support Agent Management Routes
router.get('/agents', AuthValidator, ensureSupportAgentsAccess, supportAgentController.getSupportAgents);
router.post('/create', AuthValidator, ensureSupportAgentsCreate, supportAgentController.createSupportAgent);
router.get('/details/:id', AuthValidator, ensureSupportAgentsAccess, supportAgentController.getSupportAgentDetails);
router.put('/update/:id', AuthValidator, ensureSupportAgentsUpdate, supportAgentController.updateSupportAgent);
router.put('/update-password/:id', AuthValidator, ensureSupportAgentsUpdate, supportAgentController.updatePassword);
router.delete('/delete/:id', AuthValidator, ensureSupportAgentsDelete, supportAgentController.deleteSupportAgent);
router.post('/activate/:id', AuthValidator, ensureSupportAgentsUpdate, supportAgentController.activateSupportAgent);
router.post('/inactivate/:id', AuthValidator, ensureSupportAgentsUpdate, supportAgentController.inactivateSupportAgent);

// Permissions Management
router.get('/permissions/:id', AuthValidator, ensureSupportAgentsAccess, supportAgentController.getSupportAgentPermissions);
router.put('/permissions/:id', AuthValidator, ensureSupportAgentsUpdate, supportAgentController.updateSupportAgentPermissions);

// Export and Metrics
router.get('/export', AuthValidator, ensureSupportAgentsAccess, supportAgentController.exportSupportAgents);
router.get('/metrics', AuthValidator, ensureSupportAgentsAccess, supportAgentController.getSupportAgentMetrics);

module.exports = router;