// routes/pushRoutes.js  –  Push notification endpoints

const express = require('express');
const router  = express.Router();

// In-memory store for subscriptions.
// Replace with a DB model (e.g. Mongoose) for production.
// Shape: Map<endpoint, { subscription, userId, preferences }>
const subscriptions = new Map();

// ── POST /api/push/subscribe ──────────────────────────────
// Body: { subscription: PushSubscription, preferences: {} }
router.post('/subscribe', (req, res) => {
  const { subscription, preferences = {} } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object.' });
  }

  subscriptions.set(subscription.endpoint, {
    subscription,
    // Attach userId if you have auth middleware that sets req.user
    userId: req.user?.id || null,
    preferences: {
      likes:       preferences.likes       ?? true,
      comments:    preferences.comments    ?? true,
      reposts:     preferences.reposts     ?? true,
      new_post:    preferences.new_post    ?? true,
      profile_pic: preferences.profile_pic ?? true,
      follows:     preferences.follows     ?? true,
      mentions:    preferences.mentions    ?? true,
    },
  });

  console.log(`🔔 Push subscription saved (${subscriptions.size} total)`);
  res.status(201).json({ message: 'Subscribed.' });
});

// ── POST /api/push/unsubscribe ────────────────────────────
// Body: { endpoint: string }
router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required.' });
  subscriptions.delete(endpoint);
  console.log(`🔕 Push subscription removed (${subscriptions.size} remaining)`);
  res.json({ message: 'Unsubscribed.' });
});

// ── POST /api/push/preferences ────────────────────────────
// Body: { endpoint: string, preferences: {} }
router.post('/preferences', (req, res) => {
  const { endpoint, preferences = {} } = req.body;
  const entry = subscriptions.get(endpoint);
  if (!entry) return res.status(404).json({ error: 'Subscription not found.' });
  entry.preferences = { ...entry.preferences, ...preferences };
  res.json({ message: 'Preferences updated.' });
});

// ── POST /api/push/send ───────────────────────────────────
// Internal helper used by other routes to fan out a notification.
// Body: { userId?, type, title, body, url, icon }
// If userId is provided, only notify that user's subscriptions.
// If omitted, broadcasts to all subscribers (use sparingly).
router.post('/send', async (req, res) => {
  if (!global.webpush) {
    return res.status(503).json({ error: 'Push not configured (missing VAPID keys).' });
  }

  const { userId, type = 'general', title, body, url = './index.html', icon = './icon.svg' } = req.body;

  const payload = JSON.stringify({ title, body, icon, badge: './icon.svg', data: { url }, tag: `circle-${type}` });

  const targets = userId
    ? [...subscriptions.values()].filter(e => String(e.userId) === String(userId))
    : [...subscriptions.values()];

  const relevant = targets.filter(e => e.preferences[type] !== false);

  const results = await Promise.allSettled(
    relevant.map(({ subscription }) =>
      global.webpush.sendNotification(subscription, payload)
        .catch(err => {
          // 410 Gone = subscription expired; clean it up
          if (err.statusCode === 410) subscriptions.delete(subscription.endpoint);
          throw err;
        })
    )
  );

  const sent    = results.filter(r => r.status === 'fulfilled').length;
  const failed  = results.filter(r => r.status === 'rejected').length;
  res.json({ sent, failed, total: relevant.length });
});

// ── Export helpers so other route files can send pushes ───
// Usage in e.g. postRoutes.js:
//   const { sendPushToUser } = require('./pushRoutes');
//   await sendPushToUser(authorId, 'likes', 'New like', `${liker} liked your post`);
async function sendPushToUser(userId, type, title, body, url = './index.html') {
  if (!global.webpush) return;
  const payload = JSON.stringify({
    title, body,
    icon: './icon.svg',
    badge: './icon.svg',
    tag: `circle-${type}`,
    data: { url },
  });

  const targets = [...subscriptions.values()]
    .filter(e => String(e.userId) === String(userId) && e.preferences[type] !== false);

  await Promise.allSettled(
    targets.map(({ subscription }) =>
      global.webpush.sendNotification(subscription, payload)
        .catch(err => {
          if (err.statusCode === 410) subscriptions.delete(subscription.endpoint);
        })
    )
  );
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
