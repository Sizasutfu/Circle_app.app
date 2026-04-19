// ============================================================
//  routes/dm.js
//  All Direct Message endpoints — all routes require auth
// ============================================================

const express   = require('express');
const router    = express.Router();
const { requireAuth } = require("../middleware/auth");
const dmCtrl    = require('../controllers/dmController');

// Every DM route is protected — user must be logged in
router.use(requireAuth);

// ── Presence & heartbeat ──────────────────────────────────────
// POST /api/dm/heartbeat                                      → touch last_seen_at (call every 30 s)
// GET  /api/dm/conversations/:conversationId/presence         → { online, last_seen_at } for the other user
router.post('/heartbeat', dmCtrl.heartbeat);
router.get ('/conversations/:conversationId/presence', dmCtrl.getPresence);

// ── Inbox & badge ─────────────────────────────────────────────
// GET  /api/dm/inbox         → list all conversations for current user
// GET  /api/dm/unread-count  → { count: N } for the nav badge
router.get('/inbox',         dmCtrl.getInbox);
router.get('/unread-count',  dmCtrl.getUnreadCount);

// ── Conversations ─────────────────────────────────────────────
// POST /api/dm/conversations
//   body: { recipientId }
//   → open (or find) a 1-to-1 conversation
router.post('/conversations', dmCtrl.openConversation);

// ── Messages ─────────────────────────────────────────────────
// GET   /api/dm/conversations/:conversationId/messages         → fetch paginated thread
//         query: ?limit=10&before_id=<id>  (before_id omitted on first load)
// GET   /api/dm/conversations/:conversationId/messages/new     → polling: only new messages
//         query: ?after_id=<id>
// POST  /api/dm/conversations/:conversationId/messages         → send a message
// PATCH /api/dm/conversations/:conversationId/read             → mark all read
router.get  ('/conversations/:conversationId/messages/new', dmCtrl.getNewMessages);
router.get  ('/conversations/:conversationId/messages',     dmCtrl.getMessages);
router.post ('/conversations/:conversationId/messages',     dmCtrl.sendMessage);
router.patch('/conversations/:conversationId/read',         dmCtrl.markRead);

// POST /api/dm/read-status  body: { ids: [...] }  → { readIds: [...] }
router.post('/read-status', dmCtrl.getReadStatus);

module.exports = router;