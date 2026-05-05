// ============================================================
//  models/pushModel.js
//  MySQL queries for push_subscriptions.
//  Used by:
//    • routes/pushRoutes.js   (subscribe / unsubscribe / prefs)
//    • models/notificationModel.js (sendPushToUser)
// ============================================================

const { db } = require('../config/db');

// Maps pref key names to their column — whitelist prevents injection
const PREF_COLS = {
  likes:       'pref_likes',
  comments:    'pref_comments',
  reposts:     'pref_reposts',
  new_post:    'pref_new_post',
  profile_pic: 'pref_profile_pic',
  follows:     'pref_follows',
  mentions:    'pref_mentions',
};

// Maps prefKey → notifType string the client router expects
const NOTIF_TYPE_MAP = {
  likes:       'like',
  comments:    'comment',
  reposts:     'repost',
  new_post:    'new_post',
  mentions:    'mention',
  follows:     'follow',
  profile_pic: 'profile_pic',
};

// ── Save or update a subscription ─────────────────────────
async function upsertSubscription(userId, subscription, preferences = {}) {
  const {
    likes = true, comments = true, reposts = true,
    new_post = true, profile_pic = true, follows = true, mentions = true,
  } = preferences;

  await db.query(
    `INSERT INTO push_subscriptions
       (user_id, endpoint, p256dh, auth,
        pref_likes, pref_comments, pref_reposts, pref_new_post,
        pref_profile_pic, pref_follows, pref_mentions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       p256dh  = VALUES(p256dh),
       auth    = VALUES(auth),
       pref_likes       = VALUES(pref_likes),
       pref_comments    = VALUES(pref_comments),
       pref_reposts     = VALUES(pref_reposts),
       pref_new_post    = VALUES(pref_new_post),
       pref_profile_pic = VALUES(pref_profile_pic),
       pref_follows     = VALUES(pref_follows),
       pref_mentions    = VALUES(pref_mentions),
       updated_at       = CURRENT_TIMESTAMP`,
    [
      userId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      likes ? 1 : 0, comments ? 1 : 0, reposts ? 1 : 0, new_post ? 1 : 0,
      profile_pic ? 1 : 0, follows ? 1 : 0, mentions ? 1 : 0,
    ]
  );
}

// ── Remove a subscription by endpoint ─────────────────────
async function deleteSubscription(endpoint) {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

// ── Update per-type preferences ───────────────────────────
async function updatePreferences(endpoint, preferences = {}) {
  const b = v => (v != null ? (v ? 1 : 0) : null);
  const { likes, comments, reposts, new_post, profile_pic, follows, mentions } = preferences;

  await db.query(
    `UPDATE push_subscriptions SET
       pref_likes       = COALESCE(?, pref_likes),
       pref_comments    = COALESCE(?, pref_comments),
       pref_reposts     = COALESCE(?, pref_reposts),
       pref_new_post    = COALESCE(?, pref_new_post),
       pref_profile_pic = COALESCE(?, pref_profile_pic),
       pref_follows     = COALESCE(?, pref_follows),
       pref_mentions    = COALESCE(?, pref_mentions),
       updated_at       = CURRENT_TIMESTAMP
     WHERE endpoint = ?`,
    [b(likes), b(comments), b(reposts), b(new_post), b(profile_pic), b(follows), b(mentions), endpoint]
  );
}

// ── Fan out a push to all of a user's subscribed devices ──
//
//  options (all optional but needed for deep navigation on click):
//    postId  — the post the notification is about (likes, comments, reposts, mentions, new_post)
//    actorId — the user who triggered the notification (follows, profile_pic)
//    notifId — the DB notification row id (used by the client to mark as read)
//
async function sendPushToUser(userId, prefKey, title, body, url = './', { postId = null, actorId = null, notifId = null } = {}) {
  if (!global.webpush) return;

  const col = PREF_COLS[prefKey];
  if (!col) return; // unknown type — safe guard

  const [rows] = await db.query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND ${col} = 1`,
    [userId]
  );
  if (!rows.length) return;

  // Build a tag that embeds the target ID so the SW can parse it as a fallback
  const POST_TYPES  = ['likes', 'comments', 'reposts', 'new_post', 'mentions'];
  const ACTOR_TYPES = ['follows', 'profile_pic'];
  let tag;
  if (POST_TYPES.includes(prefKey) && postId) {
    tag = `${prefKey}-${postId}`;   // e.g. "likes-42", "comments-42"
  } else if (ACTOR_TYPES.includes(prefKey) && actorId) {
    tag = `${prefKey}-${actorId}`; // e.g. "follows-7"
  } else {
    tag = `circle-${prefKey}`;     // fallback for milestone etc.
  }

  const payload = JSON.stringify({
    title,
    body,
    icon:  './icon.svg',
    badge: './icon.svg',
    tag,
    data: {
      notifType: NOTIF_TYPE_MAP[prefKey] || prefKey,
      postId:    postId  ? Number(postId)  : null,
      actorId:   actorId ? Number(actorId) : null,
      notifId:   notifId ? Number(notifId) : null,
      url,
    },
  });

  await Promise.allSettled(
    rows.map(row => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      return global.webpush.sendNotification(sub, payload).catch(async err => {
        if (err.statusCode === 410) { // browser revoked subscription
          await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [row.endpoint])
            .catch(() => {});
        }
      });
    })
  );
}

module.exports = { upsertSubscription, deleteSubscription, updatePreferences, sendPushToUser };
