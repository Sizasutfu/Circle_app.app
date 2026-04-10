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

    const messages = await dmModel.getMessages(conversationId, userId);
    return sendOk(res, 200, 'Messages fetched.', messages);
  } catch (err) {
    console.error('[DM] getMessages error:', err);
    return sendError(res, 500, 'Failed to fetch messages.');
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

module.exports = {
  getInbox,
  getUnreadCount,
  openConversation,
  getMessages,
  sendMessage,
  markRead,
};