// ============================================================
//  controllers/topicController.js
//  Handles topic preference routes:
//    GET    /api/topics                       → trending topics
//    GET    /api/topics/mine                  → user's followed topics
//    POST   /api/topics/:topic/follow         → follow a topic
//    DELETE /api/topics/:topic/follow         → unfollow a topic
//    GET    /api/topics/:topic/posts          → posts for a topic
//    GET    /api/topics/feed                  → personalised topic feed
// ============================================================

const PostModel             = require('../models/PostModel');
const TopicPreferenceModel  = require('../models/TopicPreferenceModel');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/topics?limit=<n>
// Trending topics in the last 24 hours (unchanged behaviour)
async function getTopics(req, res) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const topics = await PostModel.getTopics(limit);
    return sendOk(res, 200, 'Topics fetched.', topics);
  } catch (err) {
    console.error('getTopics error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/topics/mine
// Returns all topics the authenticated user follows, ordered by score
async function getMyTopics(req, res) {
  const userId = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  try {
    const topics = await TopicPreferenceModel.getUserTopics(userId);
    return sendOk(res, 200, 'Your topics fetched.', topics);
  } catch (err) {
    console.error('getMyTopics error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/topics/:topic/follow
// Explicitly follow a topic — gives it a strong score boost
async function followTopic(req, res) {
  const userId = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  const topic = req.params.topic?.toLowerCase().trim();
  if (!topic) return sendError(res, 400, 'Topic is required.');

  try {
    await TopicPreferenceModel.followTopic(userId, topic);
    return sendOk(res, 200, `Now following #${topic}.`, { topic });
  } catch (err) {
    console.error('followTopic error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// DELETE /api/topics/:topic/follow
// Unfollow a topic — removes the preference row entirely
async function unfollowTopic(req, res) {
  const userId = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  const topic = req.params.topic?.toLowerCase().trim();
  if (!topic) return sendError(res, 400, 'Topic is required.');

  try {
    await TopicPreferenceModel.unfollowTopic(userId, topic);
    return sendOk(res, 200, `Unfollowed #${topic}.`);
  } catch (err) {
    console.error('unfollowTopic error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/topics/:topic/posts?page=<n>&limit=<n>
// Posts for a specific topic (unchanged behaviour)
async function getPostsByTopic(req, res) {
  const topic = req.params.topic?.toLowerCase();
  if (!topic) return sendError(res, 400, 'Topic is required.');
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const result = await PostModel.getPostsByTopic(topic, page, limit);
    return sendOk(res, 200, 'Posts fetched.', result);
  } catch (err) {
    console.error('getPostsByTopic error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/topics/feed?page=<n>&limit=<n>
// Personalised feed — posts from the user's followed topics,
// scored so higher-affinity topics surface first.
async function getTopicFeed(req, res) {
  const userId = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  try {
    // Get the user's topic preferences
    const topicScoreMap = await TopicPreferenceModel.getTopicScoreMap(userId);
    const topics        = Object.keys(topicScoreMap);

    if (!topics.length) {
      return sendOk(res, 200, 'No topics followed yet.', { posts: [], hasMore: false, page, limit });
    }

    // Fetch posts that belong to any of the user's followed topics
    const OFFSET = (page - 1) * limit;
    const ph     = topics.map(() => '?').join(',');

    const [rawPosts] = await require('../config/db').db.query(
      `SELECT DISTINCT
         p.id,
         p.user_id          AS userId,
         u.name             AS author,
         u.picture          AS authorPicture,
         p.text,
         p.image,
         p.video,
         p.is_repost        AS isRepost,
         p.original_post_id AS originalPostId,
         p.created_at       AS createdAt
       FROM post_topics pt
       JOIN posts p ON p.id = pt.post_id
       JOIN users u ON u.id = p.user_id
       WHERE pt.topic IN (${ph})
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...topics, limit + 1, OFFSET]
    );

    const hasMore   = rawPosts.length > limit;
    const pagePosts = rawPosts.slice(0, limit);

    // Hydrate with likes/comments/reposts/views
    const hydrated = await PostModel.hydratePosts(pagePosts);

    // Attach post topics so we can score properly
    if (hydrated.length) {
      const ids = hydrated.map(p => p.id);
      const iph = ids.map(() => '?').join(',');
      const { db } = require('../config/db');
      const [topicRows] = await db.query(
        `SELECT post_id, topic FROM post_topics WHERE post_id IN (${iph})`,
        ids
      );
      const topicsByPost = {};
      ids.forEach(id => { topicsByPost[id] = []; });
      topicRows.forEach(r => topicsByPost[r.post_id]?.push(r.topic));
      hydrated.forEach(p => { p._topics = topicsByPost[p.id] || []; });
    }

    // Score each post by topic affinity + recency
    const { WEIGHT_TOPIC, RECENCY_SCALE, RECENCY_SHIFT } = require('../config/constants');
    hydrated.forEach(p => {
      const hoursOld   = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
      const recency    = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
      let topicBoost   = 0;
      (p._topics || []).forEach(t => {
        topicBoost += (topicScoreMap[t] || 0) * WEIGHT_TOPIC;
      });
      p._score = recency + topicBoost;
    });

    hydrated.sort((a, b) => b._score - a._score);
    hydrated.forEach(p => { delete p._score; delete p._topics; });

    return sendOk(res, 200, 'Topic feed fetched.', { posts: hydrated, hasMore, page, limit });
  } catch (err) {
    console.error('getTopicFeed error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { getTopics, getMyTopics, followTopic, unfollowTopic, getPostsByTopic, getTopicFeed };
