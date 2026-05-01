// ============================================================
//  models/PostModel.js
//  All database queries related to posts, plus the
//  hydration helper and feed scoring algorithm.
// ============================================================

const { db }          = require('../config/db');
const {
  WEIGHT_LIKE, WEIGHT_COMMENT, WEIGHT_REPOST, WEIGHT_VIEW,
  BOOST_OWN, BOOST_FOLLOW, BOOST_REPOST,
  WEIGHT_ENGAGEMENT_LIKE, WEIGHT_ENGAGEMENT_COMMENT, WEIGHT_ENGAGEMENT_REPOST,
  RECENCY_SCALE, RECENCY_SHIFT, FEED_PAGE_SIZE,
  FEED_CANDIDATE_MULTIPLIER, SEEN_PENALTY,
} = require('../config/constants');

// ── Normalise a stored media URL to a relative path ──────────
// Old posts saved before the fix may have a full URL like
// http://192.168.x.x:3000/uploads/foo.webp stored in the DB.
// This strips the origin so only /uploads/foo.webp is returned,
// keeping media accessible from any host the server runs on.
function toRelativePath(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Only strip if it looks like a local/LAN upload URL
    if (u.pathname.startsWith('/uploads/')) return u.pathname;
  } catch {}
  return url; // already relative or an external URL — leave it alone
}

// ── Score a single post ────────────────────────────────────
function computeScore(post, viewerUserId, followingIds = [], engagementMap = {}) {
  const hoursOld     = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency      = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore    = (post.likes?.length    || 0) * WEIGHT_LIKE;
  const commentScore = (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore  = (post.reposts?.length  || 0) * WEIGHT_REPOST;
  const viewScore    = (post.views            || 0) * WEIGHT_VIEW;
  const ownBoost     = post.userId === viewerUserId        ? BOOST_OWN    : 0;
  const followBoost  = followingIds.includes(post.userId)  ? BOOST_FOLLOW : 0;
  const repostBoost  = post.isRepost                       ? BOOST_REPOST : 0;

  // Personal engagement boost — how much this viewer has engaged with this author
  const eng = engagementMap[post.userId] || {};
  const engagementBoost =
    (eng.likes    || 0) * WEIGHT_ENGAGEMENT_LIKE +
    (eng.comments || 0) * WEIGHT_ENGAGEMENT_COMMENT +
    (eng.reposts  || 0) * WEIGHT_ENGAGEMENT_REPOST;

  return recency + likeScore + commentScore + repostScore + viewScore +
         ownBoost + followBoost + repostBoost + engagementBoost;
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

    // Normalise any legacy full URLs (e.g. http://192.168.x.x/uploads/...)
    // down to relative paths so media works from any host
    p.image         = toRelativePath(p.image);
    p.video         = toRelativePath(p.video);
    p.authorPicture = toRelativePath(p.authorPicture);
    if (p.originalPost) {
      p.originalPost.image         = toRelativePath(p.originalPost.image);
      p.originalPost.video         = toRelativePath(p.originalPost.video);
      p.originalPost.authorPicture = toRelativePath(p.originalPost.authorPicture);
    }
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

// ── Fetch viewer's personal engagement with each author ───
async function getEngagementMap(viewerUserId) {
  if (!viewerUserId) return {};
  const [rows] = await db.query(
    `SELECT
       p.user_id                          AS authorId,
       COUNT(DISTINCT l.id)               AS likes,
       COUNT(DISTINCT c.id)               AS comments,
       COUNT(DISTINCT r.id)               AS reposts
     FROM posts p
     LEFT JOIN likes    l ON l.post_id          = p.id AND l.user_id          = ?
     LEFT JOIN comments c ON c.post_id          = p.id AND c.user_id          = ?
     LEFT JOIN reposts  r ON r.original_post_id = p.id AND r.user_id          = ?
     GROUP BY p.user_id
     HAVING likes > 0 OR comments > 0 OR reposts > 0`,
    [viewerUserId, viewerUserId, viewerUserId]
  );
  const map = {};
  rows.forEach(r => {
    map[r.authorId] = {
      likes:    Number(r.likes),
      comments: Number(r.comments),
      reposts:  Number(r.reposts),
    };
  });
  return map;
}

// ── Fetch post IDs the viewer has already seen ────────────
// Returns a Set of post IDs so lookups stay O(1).
async function getSeenPostIds(viewerKey) {
  if (!viewerKey) return new Set();
  const [rows] = await db.query(
    'SELECT DISTINCT post_id FROM post_views WHERE viewer_key = ?',
    [String(viewerKey)]
  );
  return new Set(rows.map(r => r.post_id));
}

// ── Fetch one page of posts ────────────────────────────────
// Strategy:
//   1. Pull a large candidate pool (FEED_CANDIDATE_MULTIPLIER x limit)
//      so the scorer has real variety to work with.
//   2. Fetch which posts this viewer has already seen.
//   3. Hydrate + score all candidates, applying SEEN_PENALTY to
//      seen posts rather than dropping them — keeps the feed from
//      going empty for active users or small apps.
//   4. Sort by score descending, return the top `limit` posts.
async function getPostsPage(viewerUserId, feedMode, page, limit = FEED_PAGE_SIZE) {
  const LIMIT     = limit;
  const POOL_SIZE = LIMIT * FEED_CANDIDATE_MULTIPLIER;
  const OFFSET    = (page - 1) * LIMIT;

  const followingIds = await getFollowingIds(viewerUserId);

  let whereClause = '';
  let whereParams = [];

  if (feedMode === 'following' && viewerUserId) {
    if (!followingIds.length) return { posts: [], hasMore: false };
    const ph = followingIds.map(() => '?').join(',');
    whereClause = `WHERE p.user_id IN (${ph})`;
    whereParams = followingIds;
  }

  // Fetch POOL_SIZE + 1 so we can detect whether more posts exist
  // beyond this pool without a separate COUNT query.
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
    [...whereParams, POOL_SIZE + 1, OFFSET]
  );

  const poolHasMore = rawPosts.length > POOL_SIZE;
  const candidates  = rawPosts.slice(0, POOL_SIZE);

  if (!candidates.length) return { posts: [], hasMore: false };

  // Resolve the viewer key — same logic as recordView so the
  // seen-post set is always consistent with what was recorded.
  const viewerKey = viewerUserId ? String(viewerUserId) : null;

  // Run hydration, seen-ID lookup, and engagement map in parallel.
  const [hydratedCandidates, seenIds, engagementMap] = await Promise.all([
    hydratePosts(candidates),
    getSeenPostIds(viewerKey),
    getEngagementMap(viewerUserId),
  ]);

  // Score every candidate. Seen posts get SEEN_PENALTY applied so
  // they sink to the bottom without vanishing entirely.
  hydratedCandidates.forEach(p => {
    const base = computeScore(p, viewerUserId, followingIds, engagementMap);
    p._score   = seenIds.has(p.id) ? base * SEEN_PENALTY : base;
  });

  hydratedCandidates.sort((a, b) => b._score - a._score);

  const pagePosts = hydratedCandidates.slice(0, LIMIT);
  const hasMore   = hydratedCandidates.length > LIMIT || poolHasMore;

  pagePosts.forEach(p => delete p._score);

  return { posts: pagePosts, hasMore };
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
// Records a view each session — allows return visit recounts like Facebook/X.
async function recordView(postId, viewerId) {
  // viewerId can be a userId (int) or an anonymous fingerprint string
  await db.query(
    `INSERT INTO post_views (post_id, viewer_key) VALUES (?, ?)`,
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
  getEngagementMap,
  getSeenPostIds,
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