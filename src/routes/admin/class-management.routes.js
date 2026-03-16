const express = require('express');
const router = express.Router();
const classManagementController = require('../../controller/admin/class-management.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureManageClassesAccess = checkPermission('manage-classes', 'read');
const ensureManageClassesCreate = checkPermission('manage-classes', 'create');
const ensureManageClassesUpdate = checkPermission('manage-classes', 'update');
const ensureManageClassesDelete = checkPermission('manage-classes', 'delete');

// Get class statistics (must be before /:id route to avoid conflicts)
router.get('/stats', AuthValidator, ensureManageClassesAccess, classManagementController.getClassStats);

// Get class conflicts
router.get('/conflicts', AuthValidator, ensureManageClassesAccess, classManagementController.getClassConflicts);

// Resolve a specific conflict
router.post('/conflicts/:conflictId/resolve', AuthValidator, ensureManageClassesUpdate, classManagementController.resolveConflict);

// Get students for dropdown
router.get('/students/dropdown', AuthValidator, ensureManageClassesAccess, classManagementController.getStudentsForDropdown);

// Get teachers for dropdown
router.get('/teachers/dropdown', AuthValidator, ensureManageClassesAccess, classManagementController.getTeachersForDropdown);

// Check availability for class booking
router.post('/check-availability', AuthValidator, ensureManageClassesAccess, classManagementController.checkAvailability);

// Export classes to Excel/CSV
router.get('/export', AuthValidator, ensureManageClassesAccess, classManagementController.exportClasses);

router.get('/summery', AuthValidator, ensureManageClassesAccess, classManagementController.getClassSummary);

// Class list with filtering and pagination
router.get('/list', AuthValidator, ensureManageClassesAccess, classManagementController.getClasses);

// Get specific class details
router.get('/:id', AuthValidator, ensureManageClassesAccess, classManagementController.getClassById);

// Create new class
router.post('/', AuthValidator, ensureManageClassesCreate, classManagementController.createClass);

// Update class
router.put('/:id', AuthValidator, ensureManageClassesUpdate, classManagementController.updateClass);

// Cancel class (specific endpoint for cancellation)
router.post('/:id/cancel', AuthValidator, ensureManageClassesUpdate, classManagementController.cancelClass);

// Delete class
router.delete('/:id', AuthValidator, ensureManageClassesDelete, classManagementController.deleteClass);


module.exports = router;