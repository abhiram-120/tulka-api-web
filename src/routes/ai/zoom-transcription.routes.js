const express = require('express');
const router = express.Router();
const zoomTranscriptionController = require('../../controller/ai/zoom-transcription.controller');

// Request new transcription (webhook endpoint)
router.post('/request', zoomTranscriptionController.requestTranscription);

// Get all transcriptions with filters
router.get('/list', zoomTranscriptionController.getTranscriptions);

// Get transcription statistics
router.get('/stats', zoomTranscriptionController.getTranscriptionStats);

// Get transcription by ID
router.get('/:id', zoomTranscriptionController.getTranscriptionById);

// Delete transcription
router.delete('/:id', zoomTranscriptionController.deleteTranscription);

module.exports = router;