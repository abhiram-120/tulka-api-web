const express = require('express');
const router = express.Router();
const classExtensionController = require('../../controller/admin/class-extension.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Get classes that need extension (preview)
router.get('/classes-for-extension', AuthValidator, classExtensionController.getClassesForExtension);

// Actually extend the classes
router.post('/extend-classes-after-date', AuthValidator, classExtensionController.extendClassesAfterDate);

// Check teacher availability for extended classes (preview)
router.get('/teacher-availability-for-extension', AuthValidator, classExtensionController.getTeacherAvailabilityForExtension);

// Update teacher availability for extended classes
router.post('/extend-teacher-availability', AuthValidator, classExtensionController.extendTeacherAvailability);

module.exports = router;
