// Import required dependencies
const express = require('express');
const AuthValidator = require('../../middleware/admin-verify-token');
const { deleteCancellationCategory,createCancellationCategory,updateCancellationCategory,getAllCancellationCategories } = require('../../controller/admin/cancellationReasonCategory.controller');
const router = express.Router();

router.get('/get-cancellation-reason-categories', AuthValidator, getAllCancellationCategories);
router.post('/create-cancellation-reason-categories', AuthValidator, createCancellationCategory);
router.put('/update-cancellation-reason-categories', AuthValidator, updateCancellationCategory);
router.delete('/delete-cancellation-reason-categories/:id', AuthValidator, deleteCancellationCategory);

// Export the router for use in main application
module.exports = router;