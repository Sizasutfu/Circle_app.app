// ============================================================
//  models/NotificationModel.js
//  All database queries related to notifications.
// ============================================================

const { db } = require('../config/db');
const { sendPushToUser } = require('./pushModel');

// ── Human-readable push copy for each notification type ────
const PUSH_COPY = {
  like:        (actor, snippet) => ({ title: 'New like ❤️',           body: snippet ? `${actor} liked your post: "${snippet}"` : `${actor} liked your post` }),
  comment:     (actor, snippet) => ({ title: 'New comment 💬',         body: snippet ? `${actor} commented: "${snippet}"` : `${actor} commented on your post` }),
  repost:      (actor, snippet) => ({ title: 'New repost 🔁',          body: `${actor} reposted your post` }),
  follow:      (actor)          => ({ title: 'New follower 👤',         body: `${actor} started following you` }),
  mention:     (actor, snippet) => ({ title: 'You were mentioned 📣',   body: snippet ? `${actor} mentioned you: "${snippet}"` : `${actor} mentioned you in a post` }),
  new_post:    (actor, snippet) => ({ title: 'New post ✨',             body: snippet ? `${actor} posted: "${snippet}"` : `${actor} published a new post` }),
  profile_pic: (actor)          => ({ title: 'Profile updated 📸',      body: `${actor} updated their profile photo` }),
};

// Maps notification `type` values to push_subscriptions pref columns
const TYPE_TO_PREF = {
  like:        'likes',
  comment:     'comments',
  repost:      'reposts',
  follow:      'follows',
  mention:     'mentions',
  new_post:    'new_post',
  profile_pic: 'profile_pic',
};

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

    // INSERT and capture the new row's id for the push payload
    const [result] = await db.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id)
       VALUES (?, ?, ?, ?)`,
      [recipientId, actorId, type, postId]
    );
    const notifId = result.insertId;

    console.log(`Notification created: recipient=${recipientId} actor=${actorId} type=${type} postId=${postId} notifId=${notifId}`);

    // ── Fire push notification (non-blocking) ───────────────
    const prefType = TYPE_TO_PREF[type];
    const copyFn   = PUSH_COPY[type];
    if (prefType && copyFn) {
      db.query(
        // Fetch actor name + post snippet in one query
        `SELECT u.name AS actorName, LEFT(p.text, 60) AS snippet
         FROM users u
         LEFT JOIN posts p ON p.id = ?
         WHERE u.id = ?`,
        [postId, actorId]
      )
        .then(([[row]]) => {
          if (!row) return;
          const { title, body } = copyFn(row.actorName, row.snippet || null);
          return sendPushToUser(recipientId, prefType, title, body, './', {
            postId,           // ← which post (null for follow/profile_pic)
            actorId,          // ← who triggered it
            notifId,          // ← DB row id so client can mark as read
          });
        })
        .catch(err => console.error('push dispatch error:', err.message));
    }
  } catch (err) {
    // Log but never crash the calling request over a notification failure
    console.error('createNotification error:', err.message);
  }
}

// ── Fetch paginated notifications for a user ──────────────
async function getNotifications(userId, limit = 10, offset = 0) {
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
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
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
