const express = require('express');
const AuthValidator = require('../../middleware/admin-verify-token');
const teacherSalarySlipController=require('../../controller/admin/teacherPaySlip.controller');
const teacherSalarySlipExportController=require('../../controller/admin/paySlipExport.controller');
const router = express.Router();

router.post('/create-salary-slip',AuthValidator,teacherSalarySlipController.createTeacherPayslip);
router.put('/update-salary-slip/:id',AuthValidator,teacherSalarySlipController.updateTeacherPayslip);
router.post('/finalize-salary-slip/:id',AuthValidator,teacherSalarySlipController.finalizeTeacherPayslip);
router.post('/cancel-salary-slip/:id',AuthValidator,teacherSalarySlipController.cancelPayslipCloneAndReplace);
router.get('/get-salary-slip',AuthValidator,teacherSalarySlipController.getTeacherPayslips)
router.get('/get-salary-slip-classes/:payslip_id',AuthValidator,teacherSalarySlipController.getPayslipClassesForPenalty)
router.post('/add-salary-slip-classes-penalty/:id',AuthValidator,teacherSalarySlipController.addClassPenaltyToPayslip)
// router.post('/export-bulk-payslip',AuthValidator,teacherSalarySlipExportController.bulkExportPayslips);
router.get('/export-bulk-payslip',AuthValidator,teacherSalarySlipExportController.bulkExportPayslips);
router.get('/export-teacher-payslip',AuthValidator,teacherSalarySlipExportController.bulkExportTeacherPayslips);
router.post('/add-penalty/:id',AuthValidator,teacherSalarySlipController.addPenaltyToPayslip);
router.post('/add-bonus/:id',AuthValidator,teacherSalarySlipController.addBonusToPayslip);
router.get('/export-bulk-payslip/:id/export',AuthValidator,teacherSalarySlipExportController.exportSinglePayslip);
module.exports=router;