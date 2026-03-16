const express = require('express');
const router = express.Router();
const createAdvancedCashRequest = require('../../controller/teacher/advancedCashRequest.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

router.post('/advanced-cash/request', AuthValidator, createAdvancedCashRequest.createAdvancedCashRequest);
router.get('/advanced-cash', AuthValidator, createAdvancedCashRequest.getTeacherAdvancedCashRequests);

module.exports = router;
