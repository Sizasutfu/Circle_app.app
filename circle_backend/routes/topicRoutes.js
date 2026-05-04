const express          = require('express');
const router           = express.Router();
const { requireAuth }  = require('../middleware/auth');
const {
  getTopics,
  getMyTopics,
  followTopic,
  unfollowTopic,
  getPostsByTopic,
  getTopicFeed,
} = require('../controllers/topicController');

// ── Static/named routes FIRST ──────────────────────────────
router.get('/',        getTopics);                    // GET /api/topics
router.get('/mine',    requireAuth, getMyTopics);     // GET /api/topics/mine
router.get('/feed',    requireAuth, getTopicFeed);    // GET /api/topics/feed

// ── Parameterised routes LAST ──────────────────────────────
router.get('/:topic/posts',     getPostsByTopic);                  // GET /api/topics/:topic/posts
router.post('/:topic/follow',   requireAuth, followTopic);         // POST /api/topics/:topic/follow
router.delete('/:topic/follow', requireAuth, unfollowTopic);       // DELETE /api/topics/:topic/follow

module.exports = router;
