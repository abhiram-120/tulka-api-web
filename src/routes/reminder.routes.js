const express = require('express');
const reminderController = require('../controller/reminder.controller');
const reminder = require('../cronjobs/reminder');
const AuthValidator = require('../middleware/verify-token');
const router = express.Router();


router.patch('/receive/reminder', AuthValidator, reminderController.receiveReminder);
router.post('/notification/time', AuthValidator, reminderController.addNotificationTime);
router.get('/notification/time', AuthValidator, reminderController.getNotificationTime);

router.get('/reminder/time', reminder.getReminderTime);


module.exports = router;