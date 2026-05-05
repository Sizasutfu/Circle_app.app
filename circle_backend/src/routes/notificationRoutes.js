// ============================================================
//  routes/notificationRoutes.js
//  Defines API endpoints for notifications.
//  Route handlers are in controllers/notificationController.js.
//
//  ⚠️  Order matters: the specific /unread-count route must be
//  registered BEFORE the generic /:id/read route, otherwise
//  Express matches "unread-count" as an :id param.
// ============================================================

const router                   = require('express').Router();
const notificationController   = require('../controllers/notificationController');

router.get('/:userId',                   notificationController.getNotifications);
router.get('/:userId/unread-count',      notificationController.getUnreadCount);
router.put('/:userId/read-all',          notificationController.markAllRead);
router.put('/:id/read',                  notificationController.markOneRead);

module.exports = router;
