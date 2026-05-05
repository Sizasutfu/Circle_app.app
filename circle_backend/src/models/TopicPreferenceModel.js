// ============================================================
//  models/TopicPreferenceModel.js
//  All database logic for user ↔ topic preferences.
//
//  Score semantics
//  ───────────────
//  Each user_topic_preferences row holds a running `score`
//  that grows every time the user engages with a post that
//  carries that topic, and also grows when they explicitly
//  follow a topic.  The score is used by the feed scorer
//  in PostModel to give matching posts a personalised boost.
//
//  Engagement deltas (tunable):
//    like    → +1.0
//    comment → +2.0
//    repost  → +1.5
//    explicit follow → +5.0 (sets floor if row already exists)
// ============================================================

const { db } = require('../config/db');

// ── Score increments ───────────────────────────────────────
const DELTA = {
  like:    1.0,
  comment: 2.0,
  repost:  1.5,
  follow:  5.0,   // explicit "follow topic" button
};

// ── Upsert a preference row, adding `delta` to score ──────
async function incrementTopicScore(userId, topic, delta) {
  await db.query(
    `INSERT INTO user_topic_preferences (user_id, topic, score)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE score = score + VALUES(score)`,
    [userId, topic.toLowerCase(), delta]
  );
}

// ── Explicitly follow a topic ──────────────────────────────
// Sets score to at least DELTA.follow so the topic surfaces
// prominently even if the user is brand-new.
async function followTopic(userId, topic) {
  await db.query(
    `INSERT INTO user_topic_preferences (user_id, topic, score)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE score = GREATEST(score + ?, score)`,
    [userId, topic.toLowerCase(), DELTA.follow, DELTA.follow]
  );
}

// ── Unfollow / remove a topic preference ──────────────────
async function unfollowTopic(userId, topic) {
  await db.query(
    'DELETE FROM user_topic_preferences WHERE user_id = ? AND topic = ?',
    [userId, topic.toLowerCase()]
  );
}

// ── Return all topics a user follows, ordered by score ────
async function getUserTopics(userId) {
  const [rows] = await db.query(
    `SELECT topic, score
     FROM user_topic_preferences
     WHERE user_id = ?
     ORDER BY score DESC`,
    [userId]
  );
  return rows;  // [{ topic, score }, …]
}

// ── Return a score map for use in feed scoring ────────────
//  { "football": 8.5, "tech": 3.0, … }
async function getTopicScoreMap(userId) {
  if (!userId) return {};
  const rows = await getUserTopics(userId);
  const map  = {};
  rows.forEach(r => { map[r.topic] = r.score; });
  return map;
}

// ── Called after a like / comment / repost ────────────────
// Pass the post's extracted topics and the action type so
// we can bump the relevant preference rows automatically.
async function recordEngagement(userId, postTopics = [], action = 'like') {
  if (!userId || !postTopics.length) return;
  const delta = DELTA[action] ?? 1.0;
  await Promise.all(
    postTopics.map(topic => incrementTopicScore(userId, topic, delta))
  );
}

// ── Fetch topics for a post (needed by recordEngagement) ──
async function getPostTopics(postId) {
  const [rows] = await db.query(
    'SELECT topic FROM post_topics WHERE post_id = ?',
    [postId]
  );
  return rows.map(r => r.topic);
}

module.exports = {
  followTopic,
  unfollowTopic,
  getUserTopics,
  getTopicScoreMap,
  recordEngagement,
  getPostTopics,
};
