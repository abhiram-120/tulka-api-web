const express = require('express');
const router = express.Router();
const audioBroadcastsController = require('../../controller/admin/audio-broadcasts.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

router.get('/list', AuthValidator, audioBroadcastsController.getAudioBroadcasts);
router.get('/stats', AuthValidator, audioBroadcastsController.getAudioBroadcastStats);
router.get('/:id', AuthValidator, audioBroadcastsController.getAudioBroadcastById);
router.post('/', AuthValidator, audioBroadcastsController.uploadFields, audioBroadcastsController.createAudioBroadcast);
router.put('/:id', AuthValidator, audioBroadcastsController.uploadFields, audioBroadcastsController.updateAudioBroadcast);
router.delete('/:id', AuthValidator, audioBroadcastsController.deleteAudioBroadcast);
router.patch('/:id/toggle-status', AuthValidator, audioBroadcastsController.toggleAudioBroadcastStatus);
router.post('/:id/increment-listen', audioBroadcastsController.incrementListenCount);
router.get('/categories/list', AuthValidator, audioBroadcastsController.getCategories);
router.get('/:id/download', AuthValidator, audioBroadcastsController.downloadAudioBroadcast);


module.exports = router;