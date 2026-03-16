// routes/admin/sales.routes.js
const express = require('express');
const router = express.Router();
const salesController = require('../../controller/admin/sales.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureSalesAccess = checkPermission('sales', 'read');
const ensureSalesUpdate = checkPermission('sales', 'update');
const ensureSalesDelete = checkPermission('sales', 'delete');

// Sales Agents/Persons Routes
router.get('/sales-persons', AuthValidator, ensureSalesAccess, salesController.getSalesPersons);
router.get('/metrics', AuthValidator, ensureSalesAccess, salesController.getSalesMetrics);
router.put('/update/:id', AuthValidator, ensureSalesUpdate, salesController.updateSalesPerson);
router.delete('/delete/:id', AuthValidator, ensureSalesDelete, salesController.deleteSalesPerson);
router.get('/details/:id', AuthValidator, ensureSalesAccess, salesController.getSalesPersonDetails);
router.get('/performance/:id', AuthValidator, ensureSalesAccess, salesController.getSalesPersonPerformance);

module.exports = router;