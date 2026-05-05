// ============================================================
//  models/NotificationModel.js
//  All database queries related to notifications.
// ============================================================

const { db } = require('../config/db');
const { sendPushToUser } = require('./pushModel');

// ── Human-readable push copy for each notification type ────
const PUSH_COPY = {
  like:       (actor)        => ({ title: 'New like ❤️',        body: `${actor} liked your post` }),
  comment:    (actor)        => ({ title: 'New comment 💬',      body: `${actor} commented on your post` }),
  repost:     (actor)        => ({ title: 'New repost 🔁',       body: `${actor} reposted your post` }),
  follow:     (actor)        => ({ title: 'New follower 👤',     body: `${actor} started following you` }),
  mention:    (actor)        => ({ title: 'You were mentioned 📣', body: `${actor} mentioned you in a post` }),
  new_post:   (actor)        => ({ title: 'New post ✨',         body: `${actor} published a new post` }),
  profile_pic:(actor)        => ({ title: 'Profile updated 📸',  body: `${actor} updated their profile photo` }),
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

    await db.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id)
       VALUES (?, ?, ?, ?)`,
      [recipientId, actorId, type, postId]
      
    );
     console.log(`Notification created: recipient=${recipientId} actor=${actorId} type=${type} postId=${postId}`);
    // ── Fire push notification ──────────────────────────────
    // Fetch actor name for the notification body (non-blocking)
    const prefType = TYPE_TO_PREF[type];
    console.log('push firing:', { recipientId, type, prefType });
    const copyFn   = PUSH_COPY[type];
    if (prefType && copyFn) {
      db.query('SELECT name FROM users WHERE id = ?', [actorId])
        .then(([[actor]]) => {
          if (!actor) return;
          const { title, body } = copyFn(actor.name);
          return sendPushToUser(recipientId, prefType, title, body);
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
