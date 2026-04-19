// ============================================================
//  controllers/exploreController.js
//  Handles the Explore page endpoints.
// ============================================================

const PostModel  = require('../models/PostModel');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/explore/trending
// Returns top posts from the last 24 hours ranked by engagement.
// Likes count x1, comments x2, reposts x3.
async function getTrending(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    const posts = await PostModel.getTrendingPosts(limit);
    return sendOk(res, 200, 'Trending posts fetched.', posts);
  } catch (err) {
    console.error('[Explore] getTrending error:', err);
    return sendError(res, 500, 'Failed to fetch trending posts.');
  }
}

module.exports = { getTrending };
