// ============================================================
//  routes/topicRoutes.js
//  /api/topics — hashtag topic browsing
//  Register in your main app: app.use('/api/topics', require('./routes/topicRoutes'))
// ============================================================

const router         = require('express').Router();
const postController = require('../controllers/postController');

// GET /api/topics?limit=20  — trending topics ranked by post count
router.get('/', postController.getTopics);

// GET /api/topics/:topic/posts?page=1  — paginated posts for a topic
router.get('/:topic/posts', postController.getPostsByTopic);

module.exports = router;