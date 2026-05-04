// routes/pushRoutes.js  –  Push notification endpoints (MySQL)

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db'); // reuse your existing MySQL pool

// ── POST /api/push/subscribe ──────────────────────────────
router.post('/subscribe', async (req, res) => {
  const { subscription, preferences = {}, userId } = req.body;

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object.' });
  }
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const {
    likes = true, comments = true, reposts = true,
    new_post = true, profile_pic = true, follows = true, mentions = true,
  } = preferences;

  try {
    await pool.execute(
      `INSERT INTO push_subscriptions
         (user_id, endpoint, p256dh, auth,
          pref_likes, pref_comments, pref_reposts, pref_new_post,
          pref_profile_pic, pref_follows, pref_mentions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
         pref_likes = VALUES(pref_likes), pref_comments = VALUES(pref_comments),
         pref_reposts = VALUES(pref_reposts), pref_new_post = VALUES(pref_new_post),
         pref_profile_pic = VALUES(pref_profile_pic), pref_follows = VALUES(pref_follows),
         pref_mentions = VALUES(pref_mentions), updated_at = CURRENT_TIMESTAMP`,
      [
        userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth,
        likes ? 1 : 0, comments ? 1 : 0, reposts ? 1 : 0, new_post ? 1 : 0,
        profile_pic ? 1 : 0, follows ? 1 : 0, mentions ? 1 : 0,
      ]
    );
    res.status(201).json({ message: 'Subscribed.' });
  } catch (err) {
    console.error('push/subscribe error:', err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// ── POST /api/push/unsubscribe ────────────────────────────
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required.' });
  try {
    await pool.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ message: 'Unsubscribed.' });
  } catch (err) {
    console.error('push/unsubscribe error:', err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// ── POST /api/push/preferences ────────────────────────────
router.post('/preferences', async (req, res) => {
  const { endpoint, preferences = {} } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required.' });

  const { likes, comments, reposts, new_post, profile_pic, follows, mentions } = preferences;
  const b = v => (v != null ? (v ? 1 : 0) : null); // boolean → tinyint, or null to skip

  try {
    await pool.execute(
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
    res.json({ message: 'Preferences updated.' });
  } catch (err) {
    console.error('push/preferences error:', err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// ══════════════════════════════════════════════════════════
//  INTERNAL HELPER – import this in other route files
//
//  Example (postRoutes.js, after saving a like):
//    const { sendPushToUser } = require('./pushRoutes');
//    await sendPushToUser(post.user_id, 'likes', 'New like ❤️', `${actor.name} liked your post`);
// ══════════════════════════════════════════════════════════
const PREF_COLS = {
  likes: 'pref_likes', comments: 'pref_comments', reposts: 'pref_reposts',
  new_post: 'pref_new_post', profile_pic: 'pref_profile_pic',
  follows: 'pref_follows', mentions: 'pref_mentions',
};

async function sendPushToUser(userId, type, title, body, url = './index.html') {
  if (!global.webpush) return;
  const prefCol = PREF_COLS[type];
  if (!prefCol) return; // unknown type — safe guard against injection

  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND ${prefCol} = 1`,
      [userId]
    );
  } catch (err) {
    console.error('sendPushToUser DB error:', err);
    return;
  }

  if (!rows.length) return;

  const payload = JSON.stringify({
    title, body,
    icon: './icon.svg', badge: './icon.svg',
    tag: `circle-${type}`,
    data: { url },
  });

  await Promise.allSettled(
    rows.map(row => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      return global.webpush.sendNotification(sub, payload).catch(async err => {
        if (err.statusCode === 410) { // subscription expired
          await pool.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [row.endpoint]).catch(() => {});
        }
      });
    })
  );
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
