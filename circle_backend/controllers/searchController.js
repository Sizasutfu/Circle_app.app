// ============================================================
//  controllers/searchController.js
//  Handles all request/response logic for search routes.
//
//  Improvements:
//    - Wildcard escaping: prevents % and _ from blowing up LIKE queries
//    - Strict type validation: rejects unknown type values with 400
//    - Pagination: supports ?page=N&limit=N on both people and posts
//    - JWT auth: viewer identity comes from req.user (set by auth middleware)
//      instead of the spoofable X-User-Id header
// ============================================================

const { db }                = require('../config/db');
const FollowModel           = require('../models/followModel');
const PostModel             = require('../models/PostModel');
const { sendOk, sendError } = require('../middleware/response');

// Escape SQL LIKE wildcards so user input can't glob the whole table.
// Without this, a query of "%" matches every row.
function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

// GET /api/search?q=<term>&type=posts|people&page=1&limit=20
async function search(req, res) {
  const q    = (req.query.q || '').trim();

  // Strict type validation — reject anything that isn't posts or people
  const VALID_TYPES = new Set(['posts', 'people']);
  const type = req.query.type;
  if (!VALID_TYPES.has(type)) {
    return sendError(res, 400, 'Invalid type. Must be "posts" or "people".');
  }

  if (q.length < 2)
    return sendError(res, 400, 'Query must be at least 2 characters.');

  // Pagination params — default page 1, max 50 per page
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    if (type === 'people') {
      // ── Auth: use req.user from JWT middleware, not a spoofable header ──
      // Assumes your auth middleware sets req.user = { id, ... } when a valid
      // JWT is present, and leaves req.user undefined/null otherwise.
      const viewerId = req.user?.id ?? null;

      const like = `%${escapeLike(q)}%`;

      const [users] = await db.query(
        `SELECT u.id, u.name, u.email, u.picture,
                COUNT(DISTINCT p.id)          AS postCount,
                COUNT(DISTINCT f.follower_id) AS followerCount
         FROM users u
         LEFT JOIN posts p   ON p.user_id = u.id AND p.is_repost = 0
         LEFT JOIN follows f ON f.following_id = u.id
         WHERE u.name LIKE ? OR u.email LIKE ?
         GROUP BY u.id
         ORDER BY postCount DESC, u.name ASC
         LIMIT ? OFFSET ?`,
        [like, like, limit, offset]
      );

      // Tag whether the viewer already follows each result
      const followingSet = await FollowModel.getFollowingSet(viewerId);
      users.forEach(u => { u.isFollowing = followingSet.has(u.id); });

      const hasMore = users.length === limit;

      return sendOk(res, 200, `${users.length} results.`, users, {
        page, limit, hasMore,
      });

    } else {
      const posts = await PostModel.searchPosts(q, { limit, offset });
      const hasMore = posts.length === limit;

      return sendOk(res, 200, `${posts.length} results.`, posts, {
        page, limit, hasMore,
      });
    }
  } catch (err) {
    console.error('search error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { search };