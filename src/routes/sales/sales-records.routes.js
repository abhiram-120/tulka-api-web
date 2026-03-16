// routes/sales/sales-records.routes.js

const express = require('express');
const router = express.Router();
const salesRecordsController = require('../../controller/sales/sales-records.controller');
const AuthValidator = require('../../middleware/sales-verify-token');

// Get sales records with filtering and pagination
router.get('/', AuthValidator, salesRecordsController.getSalesRecords);

// Get sales analytics data
router.get('/analytics', AuthValidator, salesRecordsController.getSalesAnalytics);

// Export sales records to CSV
router.get('/export', AuthValidator, salesRecordsController.exportSalesRecords);

// Get specific sales record by ID
router.get('/:id', AuthValidator, salesRecordsController.getSalesRecordById);

// Send receipt email to customer
router.post('/:id/send-receipt', AuthValidator, salesRecordsController.sendReceipt);



module.exports = router; 