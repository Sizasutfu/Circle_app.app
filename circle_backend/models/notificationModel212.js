// ============================================================
//  models/NotificationModel.js
//  All database queries related to notifications.
// ============================================================

const { db } = require('../config/db');

// ── Create a notification (deduplicates automatically) ─────
async function createNotification(recipientId, actorId, type, postId = null) {
  if (recipientId === actorId) return; // never notify yourself

  try {
    const [dup] = await db.query(
      `SELECT id FROM notifications
       WHERE recipient_id=? AND actor_id=? AND type=?
         AND (post_id=? OR (post_id IS NULL AND ? IS NULL))`,
      [recipientId, actorId, type, postId, postId]
    );
    if (dup.length > 0) return; // already exists

    await db.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id)
       VALUES (?, ?, ?, ?)`,
      [recipientId, actorId, type, postId]
    );
  } catch (err) {
    // Log but never crash the calling request over a notification failure
    console.error('createNotification error:', err.message);
  }
}

// ── Fetch latest 50 notifications for a user ──────────────
async function getNotifications(userId) {
  const [rows] = await db.query(
    `SELECT
       n.id,
       n.type,
       n.is_read      AS isRead,
       n.created_at   AS createdAt,
       n.post_id      AS postId,
       a.id           AS actorId,
       a.name         AS actorName,
       a.picture      AS actorPicture,
       LEFT(p.text, 80) AS postSnippet
     FROM notifications n
     JOIN  users a ON a.id = n.actor_id
     LEFT JOIN posts p ON p.id = n.post_id
     WHERE n.recipient_id = ?
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [userId]
  );
  return rows;
}

// ── Unread count ───────────────────────────────────────────
async function getUnreadCount(userId) {
  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id=? AND is_read=0',
    [userId]
  );
  return count;
}

// ── Mark all notifications as read ────────────────────────
async function markAllRead(userId) {
  await db.query(
    'UPDATE notifications SET is_read=1 WHERE recipient_id=?',
    [userId]
  );
}

// ── Mark a single notification as read ────────────────────
async function markOneRead(notifId) {
  await db.query('UPDATE notifications SET is_read=1 WHERE id=?', [notifId]);
}

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAllRead,
  markOneRead,
};
