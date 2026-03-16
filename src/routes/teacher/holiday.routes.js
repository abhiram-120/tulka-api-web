const express = require('express');
const router = express.Router();
const holidayController = require('../../controller/teacher/holiday.controller');
const AuthValidator = require('../../middleware/teacher-verify-token');

// Teacher holiday routes
router.get('/list', AuthValidator, holidayController.getHolidays);
router.post('/request', AuthValidator, holidayController.createHolidayRequest);
router.get('/:id', AuthValidator, holidayController.getHolidayById);
router.put('/:id', AuthValidator, holidayController.updateHoliday);
router.delete('/:id', AuthValidator, holidayController.deleteHoliday);

// Status-filtered routes
router.get('/status/pending', AuthValidator, holidayController.getTeacherPendingHolidays);
router.get('/status/approved', AuthValidator, holidayController.getTeacherApprovedHolidays);
router.get('/status/rejected', AuthValidator, holidayController.getTeacherRejectedHolidays);

module.exports = router;