const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const announcementsController = require('../../controller/admin/announcements.controller');
const ensureAnnouncementsAccess = checkPermission('announcements', 'read');
const ensureAnnouncementsCreate = checkPermission('announcements', 'create');
const ensureAnnouncementsUpdate = checkPermission('announcements', 'update');
const ensureAnnouncementsDelete = checkPermission('announcements', 'delete');

// GET all announcements with pagination and filters
router.get('/announcements', AuthValidator, ensureAnnouncementsAccess, announcementsController.getAnnouncements);

// GET announcement statistics
router.get('/announcements/stats', AuthValidator, ensureAnnouncementsAccess, announcementsController.getAnnouncementStats);

// GET single announcement by ID
router.get('/announcements/:id', AuthValidator, ensureAnnouncementsAccess, announcementsController.getAnnouncementById);

// POST create new announcement (with optional image upload)
router.post('/announcements', AuthValidator, ensureAnnouncementsCreate, announcementsController.uploadAnnouncementImage.single('image'), announcementsController.createAnnouncement);

// PUT update announcement (with optional image upload)
router.put('/announcements/:id', AuthValidator, ensureAnnouncementsUpdate, announcementsController.uploadAnnouncementImage.single('image'), announcementsController.updateAnnouncement);

// DELETE announcement (soft delete)
router.delete('/announcements/:id', AuthValidator, ensureAnnouncementsDelete, announcementsController.deleteAnnouncement);

// PATCH toggle announcement status
router.patch('/announcements/:id/toggle-status', AuthValidator, ensureAnnouncementsUpdate, announcementsController.toggleAnnouncementStatus);

// POST test broadcast notification
router.post('/announcements/broadcast', AuthValidator, ensureAnnouncementsUpdate, announcementsController.testBroadcastNotification);

module.exports = router;