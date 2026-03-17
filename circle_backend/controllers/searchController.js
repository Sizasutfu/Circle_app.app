// ============================================================
//  controllers/searchController.js
//  Handles all request/response logic for search routes.
// ============================================================

const { db }                = require('../config/db');
const FollowModel           = require('../models/FollowModel');
const PostModel             = require('../models/PostModel');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/search?q=<term>&type=posts|people
async function search(req, res) {
  const q    = (req.query.q || '').trim();
  const type = req.query.type === 'people' ? 'people' : 'posts';

  if (q.length < 2)
    return sendError(res, 400, 'Query must be at least 2 characters.');

  try {
    if (type === 'people') {
      const viewerId = parseInt(req.headers['x-user-id']) || null;
      const like     = `%${q}%`;

      const [users] = await db.query(
        `SELECT u.id, u.name, u.email, u.picture,
                COUNT(p.id) AS postCount
         FROM users u
         LEFT JOIN posts p ON p.user_id=u.id AND p.is_repost=0
         WHERE u.name LIKE ? OR u.email LIKE ?
         GROUP BY u.id
         ORDER BY postCount DESC, u.name ASC
         LIMIT 20`,
        [like, like]
      );

      // Tag whether the viewer is already following each result
      const followingSet = await FollowModel.getFollowingSet(viewerId);
      users.forEach(u => { u.isFollowing = followingSet.has(u.id); });

      return sendOk(res, 200, `${users.length} results.`, users);
    } else {
      const posts = await PostModel.searchPosts(q);
      return sendOk(res, 200, `${posts.length} results.`, posts);
    }
  } catch (err) {
    console.error('search error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { search };
