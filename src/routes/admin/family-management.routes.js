// routes/admin/family-management.routes.js
const express = require('express');
const router = express.Router();
const familyManagementController = require('../../controller/admin/family-management.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

/**
 * @route   GET /api/admin/family/stats
 * @desc    Get family management dashboard statistics
 * @access  Private/Admin
 */
router.get(
    '/stats',
    AuthValidator,
    familyManagementController.getFamilyDashboardStats
);

/**
 * @route   GET /api/admin/family/all
 * @desc    Get all families with filtering and pagination
 * @access  Private/Admin
 * @query   page, limit, search, status, sortBy, sortOrder
 */
router.get(
    '/all',
    AuthValidator,
    familyManagementController.getAllFamilies
);

/**
 * @route   GET /api/admin/family/:id
 * @desc    Get family details by ID
 * @access  Private/Admin
 */
router.get(
    '/:id',
    AuthValidator,
    familyManagementController.getFamilyDetails
);

/**
 * @route   GET /api/admin/family/transactions/all
 * @desc    Get all family transactions with filtering
 * @access  Private/Admin
 * @query   page, limit, search, status, paymentType, startDate, endDate, sortBy, sortOrder
 */
router.get(
    '/transactions/all',
    AuthValidator,
    familyManagementController.getFamilyTransactions
);

/**
 * @route   GET /api/admin/family/history/all
 * @desc    Get family activity history/log
 * @access  Private/Admin
 * @query   page, limit, search, actionType, familyId, startDate, endDate, sortOrder
 */
router.get(
    '/history/all',
    AuthValidator,
    familyManagementController.getFamilyHistory
);

/**
 * @route   GET /api/admin/family/subscriptions/all
 * @desc    Get child subscriptions across all families
 * @access  Private/Admin
 * @query   page, limit, search, status, subscriptionType, sortBy, sortOrder
 */
router.get(
    '/subscriptions/all',
    AuthValidator,
    familyManagementController.getChildSubscriptions
);

/**
 * @route   GET /api/admin/family/classes/all
 * @desc    Get child classes/enrollments
 * @access  Private/Admin
 * @query   page, limit, search, status, startDate, endDate, sortBy, sortOrder
 */
router.get(
    '/classes/all',
    AuthValidator,
    familyManagementController.getChildClasses
);

/**
 * @route   GET /api/admin/family/payment/:id/invoice
 * @desc    Download invoice for a family payment transaction
 * @access  Private/Admin
 * @query   type (original|copy), format (pdf)
 */
router.get(
    '/payment/:id/invoice',
    AuthValidator,
    familyManagementController.downloadFamilyInvoice
);

module.exports = router;