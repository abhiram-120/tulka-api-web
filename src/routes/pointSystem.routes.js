const express = require('express');
const pointSystemController = require('../controller/pointSystem.controller');
const AuthValidator = require('../middleware/verify-token');
const router = express.Router();


router.get('/view/point', AuthValidator, pointSystemController.viewPoint);


module.exports = router;