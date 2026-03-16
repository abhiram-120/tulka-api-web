const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');

const teacherSalarycontroller = require('../../controller/admin/teacherSalaryProfile.controller');

router.post('/create-teacher-salary-profile', AuthValidator,teacherSalarycontroller.createTeacherSalaryProfile);
router.get('/get-all-teacher-salary-profile', AuthValidator,teacherSalarycontroller.getTeacherSalaryProfiles);
router.get('/get-all-teacher-salary-data', AuthValidator,teacherSalarycontroller.getTeacherSalaryProfileDropdownData);
router.get('/get-single-teacher-salary/:id', AuthValidator,teacherSalarycontroller.getTeacherSalaryProfileById);
router.put('/update-teacher-salary/:id', AuthValidator,teacherSalarycontroller.updateTeacherSalaryProfile);
router.delete('/delete-teacher-salary/:id', AuthValidator,teacherSalarycontroller.deleteTeacherSalaryProfile);
router.get('/get-teacher-profile', AuthValidator,teacherSalarycontroller.getTeacherSalaryAndBonuses);
router.get(
  '/export-teacher-payslip-csv',
  AuthValidator,
  teacherSalarycontroller.exportTeacherPayslipsCSV
);

module.exports = router;