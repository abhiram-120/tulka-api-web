const express = require('express');
const AuthValidator = require('../../middleware/admin-verify-token');
const teacherPenltyController=require('../../controller/admin/teacherPenalty.controller');
const router = express.Router();

router.post("/create-penalty", AuthValidator,teacherPenltyController.createPenalty);
router.get("/get-all-penalties", AuthValidator,teacherPenltyController.getPenalties);
router.get("/get-single-penalty/:id", AuthValidator,teacherPenltyController.getPenaltyById);
router.put("/update-penalty/:id", AuthValidator,teacherPenltyController.updatePenalty);
router.delete("/delete-penalty/:id", AuthValidator,teacherPenltyController.deletePenalty);

module.exports = router;