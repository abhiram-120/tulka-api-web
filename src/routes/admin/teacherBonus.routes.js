const express = require('express');
const AuthValidator = require('../../middleware/admin-verify-token');
const teacherBonusController=require('../../controller/admin/teacherBonus.controller');
const router = express.Router();

router.post('/create-bonus',AuthValidator, teacherBonusController.createBonus);
router.get('/get-bonuses',AuthValidator, teacherBonusController.getBonuses);
router.get('/bonuses/:id',AuthValidator, teacherBonusController.getBonusById);
router.put('/bonuses/:id',AuthValidator, teacherBonusController.updateBonus);
router.delete('/bonuses/:id',AuthValidator, teacherBonusController.deleteBonus);

module.exports = router;