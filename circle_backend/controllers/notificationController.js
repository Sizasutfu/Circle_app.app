// ============================================================
//  controllers/notificationController.js
//  Handles all request/response logic for notification routes.
// ============================================================

const NotificationModel     = require('../models/NotificationModel');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/notifications/:userId
async function getNotifications(req, res) {
  const userId = parseInt(req.params.userId);
  try {
    const notifications = await NotificationModel.getNotifications(userId);
    return sendOk(res, 200, 'Notifications fetched.', notifications);
  } catch (err) {
    console.error('getNotifications error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/notifications/:userId/unread-count
async function getUnreadCount(req, res) {
  const userId = parseInt(req.params.userId);
  try {
    const count = await NotificationModel.getUnreadCount(userId);
    return sendOk(res, 200, 'Unread count.', { count });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/notifications/:userId/read-all
async function markAllRead(req, res) {
  const userId = parseInt(req.params.userId);
  try {
    await NotificationModel.markAllRead(userId);
    return sendOk(res, 200, 'All notifications marked as read.');
  } catch (err) {
    console.error('markAllRead error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/notifications/:id/read
async function markOneRead(req, res) {
  const id = parseInt(req.params.id);
  try {
    await NotificationModel.markOneRead(id);
    return sendOk(res, 200, 'Notification marked as read.');
  } catch (err) {
    console.error('markOneRead error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { getNotifications, getUnreadCount, markAllRead, markOneRead };
