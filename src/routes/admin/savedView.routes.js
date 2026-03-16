const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/admin-verify-token');
const savedView=require('../../controller/admin/savedView.controller');

router.get("/get-saved-views", savedView.getSavedViews);
router.post("/create-saved-view", savedView.createSavedView);
router.delete("/delete-saved-view/:id", savedView.deleteSavedView);

module.exports=router;