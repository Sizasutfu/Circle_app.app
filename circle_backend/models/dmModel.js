
//  models/dmModel.js
//  All database queries for Direct Messages


const { db } = require('../config/db'); 
// ─── Helpers ────────────────────────────────────────────────

/**
 * Returns [lowerUserId, higherUserId] so the pair is always
 * stored the same way regardless of who starts the conversation.
 */
function _orderedPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

// ─── Conversations ───────────────────────────────────────────

/**
 * Find an existing conversation between two users,
 * or create one if it does not exist yet.
 * Returns the conversation row.
 */
async function getOrCreateConversation(userIdA, userIdB) {
  const [p1, p2] = _orderedPair(Number(userIdA), Number(userIdB));

  // Try to find existing
  const [rows] = await db.query(
    `SELECT id, participant_one_id, participant_two_id, created_at
     FROM dm_conversations
     WHERE participant_one_id = ? AND participant_two_id = ?`,
    [p1, p2]
  );

  if (rows.length > 0) return rows[0];

  // Create new
  const [result] = await db.query(
    `INSERT INTO dm_conversations (participant_one_id, participant_two_id)
     VALUES (?, ?)`,
    [p1, p2]
  );

  return {
    id: result.insertId,
    participant_one_id: p1,
    participant_two_id: p2,
    created_at: new Date(),
  };
}

/**
 * Return all conversations for a given user, enriched with:
 *  - the other participant's name + picture
 *  - the last message preview
 *  - the count of unread messages directed at this user
 * Sorted by most recent activity.
 */
async function getInboxForUser(userId) {
  const uid = Number(userId);

  const [rows] = await db.query(
    `SELECT
       c.id,
       c.created_at,

       -- Other participant info
       u.id          AS other_id,
       u.name        AS other_name,
       u.picture     AS other_picture,

       -- Last message
       lm.body       AS last_message,
       lm.sender_id  AS last_sender_id,
       lm.created_at AS last_message_at,

       -- Unread count (messages sent TO this user that are unread)
       COALESCE(unread.cnt, 0) AS unread_count

     FROM dm_conversations c

     -- Join the other participant
     JOIN users u ON u.id = IF(c.participant_one_id = ?, c.participant_two_id, c.participant_one_id)

     -- Join last message via subquery
     LEFT JOIN dm_messages lm ON lm.id = (
       SELECT id FROM dm_messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     )

     -- Count unread messages sent by the OTHER user
     LEFT JOIN (
       SELECT conversation_id, COUNT(*) AS cnt
       FROM dm_messages
       WHERE is_read = 0 AND sender_id != ?
       GROUP BY conversation_id
     ) unread ON unread.conversation_id = c.id

     WHERE c.participant_one_id = ? OR c.participant_two_id = ?

     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [uid, uid, uid, uid]
  );

  return rows;
}

/**
 * Verify that a given user is a participant in a conversation.
 * Returns true/false.
 */
async function isParticipant(conversationId, userId) {
  const [rows] = await db.query(
    `SELECT id FROM dm_conversations
     WHERE id = ?
       AND (participant_one_id = ? OR participant_two_id = ?)
     LIMIT 1`,
    [conversationId, userId, userId]
  );
  return rows.length > 0;
}

// ─── Messages ────────────────────────────────────────────────

/**
 * Fetch paginated messages in a conversation (cursor-based, before_id).
 * Returns { messages: [...], hasMore: bool } — messages are oldest-first.
 * Also marks all messages sent by the OTHER user as read.
 *
 * @param {number} conversationId
 * @param {number} requestingUserId
 * @param {object} opts
 * @param {number} opts.limit    - max messages to return (default 10)
 * @param {number|null} opts.beforeId - return messages with id < beforeId (for load-more)
 */
async function getMessages(conversationId, requestingUserId, { limit = 10, beforeId = null } = {}) {
  const convId = Number(conversationId);
  const uid    = Number(requestingUserId);
  const lim    = Math.min(Number(limit) || 10, 100);

  // Mark messages from the other person as read
  await db.query(
    `UPDATE dm_messages
     SET is_read = 1
     WHERE conversation_id = ? AND sender_id != ? AND is_read = 0`,
    [convId, uid]
  );

  // Build WHERE clause — optionally cursor-bounded
  const conditions = ['m.conversation_id = ?'];
  const params     = [convId];
  if (beforeId) {
    conditions.push('m.id < ?');
    params.push(Number(beforeId));
  }

  // Fetch limit+1 DESC so we know if older messages still exist,
  // then reverse to serve oldest-first.
  const [rows] = await db.query(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_id,
       u.name        AS sender_name,
       u.picture     AS sender_picture,
       m.body,
       m.is_read,
       m.created_at
     FROM dm_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.created_at DESC
     LIMIT ?`,
    [...params, lim + 1]
  );

  const hasMore = rows.length > lim;
  if (hasMore) rows.pop();   // drop the extra probe row
  rows.reverse();            // back to oldest-first for the client

  return { messages: rows, hasMore };
}

/**
 * Fetch messages newer than a given message id — used by the polling loop
 * so it only retrieves truly new messages instead of re-fetching the whole thread.
 * Also marks incoming messages as read.
 *
 * @param {number} conversationId
 * @param {number} requestingUserId
 * @param {number} afterId - return messages with id > afterId
 */
async function getNewMessages(conversationId, requestingUserId, afterId) {
  const convId = Number(conversationId);
  const uid    = Number(requestingUserId);

  // Mark new incoming messages as read
  await db.query(
    `UPDATE dm_messages
     SET is_read = 1
     WHERE conversation_id = ? AND sender_id != ? AND is_read = 0 AND id > ?`,
    [convId, uid, Number(afterId)]
  );

  const [rows] = await db.query(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_id,
       u.name        AS sender_name,
       u.picture     AS sender_picture,
       m.body,
       m.is_read,
       m.created_at
     FROM dm_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? AND m.id > ?
     ORDER BY m.created_at ASC`,
    [convId, Number(afterId)]
  );

  return rows;
}

/**
 * Insert a new message into a conversation.
 * Returns the full new message row (joined with sender info).
 */
async function sendMessage(conversationId, senderId, body) {
  const convId = Number(conversationId);
  const sid    = Number(senderId);

  const [result] = await db.query(
    `INSERT INTO dm_messages (conversation_id, sender_id, body)
     VALUES (?, ?, ?)`,
    [convId, sid, body.trim()]
  );

  const [rows] = await db.query(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_id,
       u.name        AS sender_name,
       u.picture     AS sender_picture,
       m.body,
       m.is_read,
       m.created_at
     FROM dm_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [result.insertId]
  );

  return rows[0];
}

// ─── Presence ────────────────────────────────────────────────

/**
 * Update the current user's last_seen_at to now.
 * Called by the client heartbeat every 30 s.
 * NOTE: requires the users table to have a last_seen_at DATETIME column:
 *   ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL;
 */
async function touchPresence(userId) {
  await db.query(
    `UPDATE users SET last_seen_at = NOW() WHERE id = ?`,
    [Number(userId)]
  );
}

/**
 * Return the other participant's presence status for a conversation.
 * A user is considered "online" if last_seen_at is within the last 60 s.
 * Returns { online: bool, last_seen_at: <ISO string|null> }
 */
async function getPresence(conversationId, requestingUserId) {
  const convId = Number(conversationId);
  const uid    = Number(requestingUserId);

  // Use TIMESTAMPDIFF in SQL so the online check never touches Node.js date parsing.
  // MySQL DATETIME has no timezone — comparing inside the DB avoids all offset issues.
  const [rows] = await db.query(
    `SELECT
       u.last_seen_at,
       TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS seconds_ago
     FROM dm_conversations c
     JOIN users u ON u.id = IF(c.participant_one_id = ?, c.participant_two_id, c.participant_one_id)
     WHERE c.id = ?
     LIMIT 1`,
    [uid, convId]
  );

  if (!rows.length) return { online: false, last_seen_at: null };

  const { last_seen_at, seconds_ago } = rows[0];
  const online = last_seen_at !== null && seconds_ago !== null && seconds_ago < 90;

  // Normalise the datetime string to ISO — append Z so JS parses it as UTC
  let isoString = null;
  if (last_seen_at) {
    if (last_seen_at instanceof Date) {
      isoString = last_seen_at.toISOString();
    } else {
      const s = String(last_seen_at);
      isoString = new Date(
        (s.includes('Z') || s.includes('+')) ? s : s.replace(' ', 'T') + 'Z'
      ).toISOString();
    }
  }

  return { online, last_seen_at: isoString };
}

/**
 * Total count of unread messages across all conversations for a user.
 * Useful for the nav badge.
 */
async function getTotalUnreadCount(userId) {
  const uid = Number(userId);

  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM dm_messages m
     JOIN dm_conversations c ON c.id = m.conversation_id
     WHERE m.is_read = 0
       AND m.sender_id != ?
       AND (c.participant_one_id = ? OR c.participant_two_id = ?)`,
    [uid, uid, uid]
  );

  return rows[0]?.total || 0;
}

/**
 * Mark all messages in a conversation as read for a specific user.
 */
async function markConversationRead(conversationId, userId) {
  await db.query(
    `UPDATE dm_messages
     SET is_read = 1
     WHERE conversation_id = ? AND sender_id != ? AND is_read = 0`,
    [conversationId, userId]
  );
}

/**
 * Given a list of message IDs sent by a user, return which ones have is_read = 1.
 * Used by the polling loop so the sender knows when the recipient has read their messages.
 *
 * @param {number[]} messageIds
 * @returns {number[]} array of IDs that are now read
 */
async function getReadStatus(messageIds) {
  if (!messageIds || !messageIds.length) return [];
  const ids = messageIds.map(Number).filter(Boolean);
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id FROM dm_messages WHERE id IN (${placeholders}) AND is_read = 1`,
    ids
  );
  return rows.map(r => r.id);
}

module.exports = {
  getOrCreateConversation,
  getInboxForUser,
  isParticipant,
  getMessages,
  getNewMessages,
  sendMessage,
  getTotalUnreadCount,
  markConversationRead,
  touchPresence,
  getPresence,
  getReadStatus,
};