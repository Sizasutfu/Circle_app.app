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
// GET   /api/dm/conversations/:conversationId/messages  → fetch thread
// POST  /api/dm/conversations/:conversationId/messages  → send a message
// PATCH /api/dm/conversations/:conversationId/read      → mark all read
router.get  ('/conversations/:conversationId/messages', dmCtrl.getMessages);
router.post ('/conversations/:conversationId/messages', dmCtrl.sendMessage);
router.patch('/conversations/:conversationId/read',     dmCtrl.markRead);

module.exports = router;