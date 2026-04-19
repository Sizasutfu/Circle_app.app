// ============================================================
//  controllers/dmController.js
//  Handles all Direct Message HTTP requests
// ============================================================

const dmModel    = require('../models/dmModel');
const { sendOk, sendError } = require('../middleware/response');

// ─── GET /api/dm/inbox ───────────────────────────────────────
async function getInbox(req, res) {
  try {
    const userId = req.actorId;
    const conversations = await dmModel.getInboxForUser(userId);
    return sendOk(res, 200, 'Inbox fetched.', conversations);
  } catch (err) {
    console.error('[DM] getInbox error:', err);
    return sendError(res, 500, 'Failed to fetch inbox.');
  }
}

// ─── GET /api/dm/unread-count ────────────────────────────────
async function getUnreadCount(req, res) {
  try {
    const userId = req.actorId;
    const count  = await dmModel.getTotalUnreadCount(userId);
    return sendOk(res, 200, 'Unread count fetched.', { count });
  } catch (err) {
    console.error('[DM] getUnreadCount error:', err);
    return sendError(res, 500, 'Failed to fetch unread count.');
  }
}

// ─── POST /api/dm/conversations ──────────────────────────────
async function openConversation(req, res) {
  try {
    const userId      = req.actorId;
    const recipientId = Number(req.body.recipientId);

    if (!recipientId || isNaN(recipientId)) {
      return sendError(res, 400, 'recipientId is required.');
    }
    if (recipientId === userId) {
      return sendError(res, 400, 'You cannot message yourself.');
    }

    const conversation = await dmModel.getOrCreateConversation(userId, recipientId);
    return sendOk(res, 200, 'Conversation ready.', conversation);
  } catch (err) {
    console.error('[DM] openConversation error:', err);
    return sendError(res, 500, 'Failed to open conversation.');
  }
}

// ─── GET /api/dm/conversations/:conversationId/messages ──────
async function getMessages(req, res) {
  try {
    const userId         = req.actorId;
    const conversationId = Number(req.params.conversationId);

    const allowed = await dmModel.isParticipant(conversationId, userId);
    if (!allowed) {
      return sendError(res, 403, 'Access denied.');
    }

    const limit    = Math.min(parseInt(req.query.limit) || 10, 100);
    const beforeId = req.query.before_id ? Number(req.query.before_id) : null;

    const result = await dmModel.getMessages(conversationId, userId, { limit, beforeId });
    // result = { messages: [...], hasMore: bool }
    return sendOk(res, 200, 'Messages fetched.', result);
  } catch (err) {
    console.error('[DM] getMessages error:', err);
    return sendError(res, 500, 'Failed to fetch messages.');
  }
}

// ─── GET /api/dm/conversations/:conversationId/messages/new ──
// Polling endpoint — only returns messages newer than after_id.
async function getNewMessages(req, res) {
  try {
    const userId         = req.actorId;
    const conversationId = Number(req.params.conversationId);
    const afterId        = Number(req.query.after_id);

    if (!afterId || isNaN(afterId)) {
      return sendError(res, 400, 'after_id query param is required.');
    }

    const allowed = await dmModel.isParticipant(conversationId, userId);
    if (!allowed) {
      return sendError(res, 403, 'Access denied.');
    }

    const messages = await dmModel.getNewMessages(conversationId, userId, afterId);
    return sendOk(res, 200, 'New messages fetched.', messages);
  } catch (err) {
    console.error('[DM] getNewMessages error:', err);
    return sendError(res, 500, 'Failed to fetch new messages.');
  }
}

// ─── POST /api/dm/conversations/:conversationId/messages ─────
async function sendMessage(req, res) {
  try {
    const userId         = req.actorId;
    const conversationId = Number(req.params.conversationId);
    const body           = (req.body.body || '').trim();

    if (!body) {
      return sendError(res, 400, 'Message body cannot be empty.');
    }
    if (body.length > 2000) {
      return sendError(res, 400, 'Message is too long (max 2000 characters).');
    }

    const allowed = await dmModel.isParticipant(conversationId, userId);
    if (!allowed) {
      return sendError(res, 403, 'Access denied.');
    }

    const message = await dmModel.sendMessage(conversationId, userId, body);
    return sendOk(res, 201, 'Message sent.', message);
  } catch (err) {
    console.error('[DM] sendMessage error:', err);
    return sendError(res, 500, 'Failed to send message.');
  }
}

// ─── POST /api/dm/heartbeat ──────────────────────────────────
// Client pings this every 30 s to mark the user as online.
async function heartbeat(req, res) {
  try {
    await dmModel.touchPresence(req.actorId);
    return sendOk(res, 200, 'ok');
  } catch (err) {
    console.error('[DM] heartbeat error:', err);
    return sendError(res, 500, 'Heartbeat failed.');
  }
}

// ─── GET /api/dm/conversations/:conversationId/presence ──────
// Returns { online, last_seen_at } for the OTHER participant.
async function getPresence(req, res) {
  try {
    const userId         = req.actorId;
    const conversationId = Number(req.params.conversationId);

    const allowed = await dmModel.isParticipant(conversationId, userId);
    if (!allowed) return sendError(res, 403, 'Access denied.');

    const presence = await dmModel.getPresence(conversationId, userId);
    return sendOk(res, 200, 'Presence fetched.', presence);
  } catch (err) {
    console.error('[DM] getPresence error:', err);
    return sendError(res, 500, 'Failed to fetch presence.');
  }
}

// ─── PATCH /api/dm/conversations/:conversationId/read ────────
async function markRead(req, res) {
  try {
    const userId         = req.actorId;
    const conversationId = Number(req.params.conversationId);

    const allowed = await dmModel.isParticipant(conversationId, userId);
    if (!allowed) {
      return sendError(res, 403, 'Access denied.');
    }

    await dmModel.markConversationRead(conversationId, userId);
    return sendOk(res, 200, 'Marked as read.');
  } catch (err) {
    console.error('[DM] markRead error:', err);
    return sendError(res, 500, 'Failed to mark as read.');
  }
}

// ─── POST /api/dm/read-status ────────────────────────────────
// Body: { ids: [1,2,3] } — returns which of those message IDs are now read.
// Used by the sender's poll loop to update "Seen" without a full refetch.
async function getReadStatus(req, res) {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return sendOk(res, 200, 'No ids.', { readIds: [] });

    const readIds = await dmModel.getReadStatus(ids);
    return sendOk(res, 200, 'Read status fetched.', { readIds });
  } catch (err) {
    console.error('[DM] getReadStatus error:', err);
    return sendError(res, 500, 'Failed to fetch read status.');
  }
}

module.exports = {
  getInbox,
  getUnreadCount,
  openConversation,
  getMessages,
  getNewMessages,
  sendMessage,
  markRead,
  heartbeat,
  getPresence,
  getReadStatus,
};