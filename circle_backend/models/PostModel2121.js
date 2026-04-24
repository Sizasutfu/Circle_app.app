// ============================================================
//  models/PostModel.js
//  All database queries related to posts, plus the
//  hydration helper and feed scoring algorithm.
// ============================================================

const { db }          = require('../config/db');
const {
  WEIGHT_LIKE, WEIGHT_COMMENT, WEIGHT_REPOST,
  BOOST_OWN, BOOST_FOLLOW, BOOST_REPOST,
  RECENCY_SCALE, RECENCY_SHIFT, FEED_PAGE_SIZE,
} = require('../config/constants');

// ── Score a single post ────────────────────────────────────
function computeScore(post, viewerUserId, followingIds = []) {
  const hoursOld     = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency      = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore    = (post.likes?.length    || 0) * WEIGHT_LIKE;
  const commentScore = (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore  = (post.reposts?.length  || 0) * WEIGHT_REPOST;
  const ownBoost     = post.userId === viewerUserId        ? BOOST_OWN    : 0;
  const followBoost  = followingIds.includes(post.userId)  ? BOOST_FOLLOW : 0;
  const repostBoost  = post.isRepost                       ? BOOST_REPOST : 0;
  return recency + likeScore + commentScore + repostScore + ownBoost + followBoost + repostBoost;
}

// ── Nest flat comment rows into a parent → replies tree ───
function nestComments(flatComments) {
  const byId  = {};
  const roots = [];

  flatComments.forEach(c => {
    byId[c.id] = { ...c, replies: [] };
  });

  flatComments.forEach(c => {
    if (c.parentId && byId[c.parentId]) {
      byId[c.parentId].replies.push(byId[c.id]);
    } else {
      roots.push(byId[c.id]);
    }
  });

  return roots;
}

// ── Hydrate raw post rows with engagement data ─────────────
async function hydratePosts(posts) {
  if (!posts.length) return posts;

  const ids = posts.map(p => p.id);
  const ph  = ids.map(() => '?').join(',');

  const [[allLikes], [allReposts], [allComments], [allViews]] = await Promise.all([
    db.query(`SELECT user_id, post_id FROM likes WHERE post_id IN (${ph})`, ids),
    db.query(`SELECT user_id, original_post_id FROM reposts WHERE original_post_id IN (${ph})`, ids),
    db.query(
      `SELECT c.id, c.post_id, c.user_id AS userId,
              c.parent_id AS parentId,
              u.name AS author, u.picture AS authorPicture,
              c.text, c.created_at AS createdAt
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id IN (${ph})
       ORDER BY c.created_at ASC`,
      ids
    ),
    db.query(
      `SELECT post_id, COUNT(*) AS view_count FROM post_views WHERE post_id IN (${ph}) GROUP BY post_id`,
      ids
    ),
  ]);

  const lMap = {}, rMap = {}, cMap = {}, vMap = {};
  ids.forEach(id => { lMap[id] = []; rMap[id] = []; cMap[id] = []; vMap[id] = 0; });
  allLikes.forEach(l   => lMap[l.post_id]?.push(l.user_id));
  allReposts.forEach(r => rMap[r.original_post_id]?.push(r.user_id));
  allComments.forEach(c => cMap[c.post_id]?.push(c));
  allViews.forEach(v   => { if (vMap[v.post_id] !== undefined) vMap[v.post_id] = Number(v.view_count); });

  // Embed original posts for repost cards
  const origIds = [
    ...new Set(
      posts.filter(p => p.isRepost && p.originalPostId).map(p => p.originalPostId)
    ),
  ];
  let origMap = {};
  if (origIds.length) {
    const oph = origIds.map(() => '?').join(',');
    const [origRows] = await db.query(
      `SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image, p.video
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id IN (${oph})`,
      origIds
    );
    origRows.forEach(o => { origMap[o.id] = o; });
  }

  posts.forEach(p => {
    p.likes    = lMap[p.id] || [];
    p.reposts  = rMap[p.id] || [];
    p.comments = nestComments(cMap[p.id] || []);
    p.views    = vMap[p.id] || 0;
    if (p.isRepost && p.originalPostId)
      p.originalPost = origMap[p.originalPostId] || null;
    // image and video are now plain URLs — no base64 handling needed
  });

  return posts;
}

// ── Fetch IDs the viewer follows ──────────────────────────
async function getFollowingIds(viewerUserId) {
  if (!viewerUserId) return [];
  const [rows] = await db.query(
    'SELECT following_id FROM follows WHERE follower_id=?',
    [viewerUserId]
  );
  return rows.map(r => r.following_id);
}

// ── Fetch one page of posts ────────────────────────────────
async function getPostsPage(viewerUserId, feedMode, page, limit = FEED_PAGE_SIZE) {
  const LIMIT  = limit;
  const OFFSET = (page - 1) * LIMIT;

  const followingIds = await getFollowingIds(viewerUserId);

  let whereClause = '';
  let whereParams = [];

  if (feedMode === 'following' && viewerUserId) {
    if (!followingIds.length) return { posts: [], hasMore: false };
    const ph = followingIds.map(() => '?').join(',');
    whereClause = `WHERE p.user_id IN (${ph})`;
    whereParams = followingIds;
  }

  const [rawPosts] = await db.query(
    `SELECT
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
     FROM posts p
     JOIN users u ON u.id = p.user_id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, LIMIT + 1, OFFSET]
  );

  const hasMore   = rawPosts.length > LIMIT;
  const pagePosts = rawPosts.slice(0, LIMIT);

  const posts = await hydratePosts(pagePosts);

  posts.forEach(p => { p._score = computeScore(p, viewerUserId, followingIds); });
  posts.sort((a, b) => b._score - a._score);
  posts.forEach(p => delete p._score);

  return { posts, hasMore };
}

// ── Fetch all posts for a specific user profile ────────────
async function getProfilePosts(profileUserId, page = 1, limit = FEED_PAGE_SIZE) {
  const LIMIT  = limit;
  const OFFSET = (page - 1) * LIMIT;

  const [rawPosts] = await db.query(
    `SELECT
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
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ?
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [profileUserId, LIMIT + 1, OFFSET]
  );

  const hasMore   = rawPosts.length > LIMIT;
  const pagePosts = rawPosts.slice(0, LIMIT);
  const posts     = await hydratePosts(pagePosts);

  return { posts, hasMore };
}

// ── Create a post ──────────────────────────────────────────
async function createPost(userId, text, image, video) {
  const [result] = await db.query(
    'INSERT INTO posts (user_id, text, image, video) VALUES (?, ?, ?, ?)',
    [userId, text || null, image || null, video || null]
  );
  return result.insertId;
}

// ── Delete a post ──────────────────────────────────────────
async function deletePost(postId) {
  await db.query('DELETE FROM posts WHERE id=?', [postId]);
}

// ── Find a post by id (returns full row) ───────────────────
async function findById(postId) {
  const [rows] = await db.query('SELECT * FROM posts WHERE id=?', [postId]);
  return rows[0] || null;
}

// ── Like / unlike ──────────────────────────────────────────
async function getLike(userId, postId) {
  const [rows] = await db.query(
    'SELECT id FROM likes WHERE user_id=? AND post_id=?',
    [userId, postId]
  );
  return rows[0] || null;
}

async function addLike(userId, postId) {
  await db.query('INSERT INTO likes (user_id, post_id) VALUES (?,?)', [userId, postId]);
}

async function removeLike(userId, postId) {
  await db.query('DELETE FROM likes WHERE user_id=? AND post_id=?', [userId, postId]);
}

async function getLikeCount(postId) {
  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM likes WHERE post_id=?',
    [postId]
  );
  return total;
}

// ── Add a comment or reply ─────────────────────────────────
async function addComment(postId, userId, text, parentId = null) {
  if (parentId) {
    const [parentRows] = await db.query(
      'SELECT id FROM comments WHERE id=? AND post_id=?',
      [parentId, postId]
    );
    if (!parentRows.length) {
      throw new Error('Parent comment not found on this post.');
    }
  }

  const [result] = await db.query(
    'INSERT INTO comments (post_id, user_id, text, parent_id) VALUES (?,?,?,?)',
    [postId, userId, text, parentId]
  );
  return result.insertId;
}

// ── Repost ─────────────────────────────────────────────────
async function getExistingRepost(userId, originalPostId) {
  const [rows] = await db.query(
    'SELECT id FROM reposts WHERE user_id=? AND original_post_id=?',
    [userId, originalPostId]
  );
  return rows[0] || null;
}

async function createRepost(userId, text, originalPostId) {
  const [result] = await db.query(
    'INSERT INTO posts (user_id, text, is_repost, original_post_id) VALUES (?,?,1,?)',
    [userId, text || null, originalPostId]
  );
  const repostPostId = result.insertId;
  await db.query(
    'INSERT INTO reposts (user_id, original_post_id, repost_post_id) VALUES (?,?,?)',
    [userId, originalPostId, repostPostId]
  );
  return repostPostId;
}

async function getOriginalPostEmbed(originalPostId) {
  const [rows] = await db.query(
    `SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image, p.video
     FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`,
    [originalPostId]
  );
  return rows[0] || null;
}

// ── Trending posts (last 24 hours, ranked by engagement) ──
async function getTrendingPosts(limit = 20) {
  const [rawPosts] = await db.query(
    `SELECT
       p.id,
       p.user_id          AS userId,
       u.name             AS author,
       u.picture          AS authorPicture,
       p.text,
       p.image,
       p.video,
       p.is_repost        AS isRepost,
       p.original_post_id AS originalPostId,
       p.created_at       AS createdAt,
       (
         (SELECT COUNT(*) FROM likes    WHERE post_id = p.id) * 1 +
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id) * 2 +
         (SELECT COUNT(*) FROM reposts  WHERE original_post_id = p.id) * 3
       ) AS engagement_score
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.created_at >= NOW() - INTERVAL 24 HOUR
     ORDER BY engagement_score DESC, p.created_at DESC
     LIMIT ?`,
    [limit]
  );

  if (!rawPosts.length) return [];
  return hydratePosts(rawPosts);
}

// ── Search posts ───────────────────────────────────────────
async function searchPosts(query, { limit = 20, offset = 0 } = {}) {
  // Escape SQL LIKE wildcards so a query of "%" doesn't match every row
  const escaped = query.replace(/[%_\\]/g, '\\$&');
  const like = `%${escaped}%`;
  const [rows] = await db.query(
    `SELECT p.id, p.user_id AS userId, u.name AS author, u.picture AS authorPicture,
            p.text, p.image, p.video, p.is_repost AS isRepost, p.created_at AS createdAt,
            (SELECT COUNT(*) FROM likes    WHERE post_id=p.id)           AS likeCount,
            (SELECT COUNT(*) FROM comments WHERE post_id=p.id)           AS commentCount,
            (SELECT COUNT(*) FROM reposts  WHERE original_post_id=p.id)  AS repostCount
     FROM posts p JOIN users u ON u.id=p.user_id
     WHERE p.text LIKE ? OR u.name LIKE ?
     ORDER BY likeCount DESC, p.created_at DESC
     LIMIT ? OFFSET ?`,
    [like, like, limit, offset]
  );
  return rows;
}

// ── View counts ────────────────────────────────────────────
// Records one view per viewer (identified by userId or fingerprint).
// Uses INSERT IGNORE so duplicate views in the same session are silently dropped.
async function recordView(postId, viewerId) {
  // viewerId can be a userId (int) or an anonymous fingerprint string
  await db.query(
    `INSERT IGNORE INTO post_views (post_id, viewer_key) VALUES (?, ?)`,
    [postId, String(viewerId)]
  );
}

async function getViewCount(postId) {
  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM post_views WHERE post_id = ?',
    [postId]
  );
  return Number(total);
}

module.exports = {
  computeScore,
  hydratePosts,
  nestComments,
  getFollowingIds,
  getPostsPage,
  getProfilePosts,
  getTrendingPosts,
  createPost,
  deletePost,
  findById,
  getLike,
  addLike,
  removeLike,
  getLikeCount,
  addComment,
  getExistingRepost,
  createRepost,
  getOriginalPostEmbed,
  searchPosts,
  recordView,
  getViewCount,
};