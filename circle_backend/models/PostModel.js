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
  WEIGHT_TOPIC,
  RECENCY_SCALE, RECENCY_SHIFT, FEED_PAGE_SIZE,
  FEED_CANDIDATE_MULTIPLIER, SEEN_PENALTY,
} = require('../config/constants');
const TopicPreferenceModel = require('./TopicPreferenceModel');

// ── Normalise a stored media URL to a relative path ──────────
function toRelativePath(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/uploads/')) return u.pathname;
  } catch {}
  return url;
}

// ── Score a single post ────────────────────────────────────
function computeScore(post, viewerUserId, followingIds = [], engagementMap = {}, topicScoreMap = {}) {
  const hoursOld     = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency      = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore    = (post.likes?.length    || 0) * WEIGHT_LIKE;
  const commentScore = (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore  = (post.reposts?.length  || 0) * WEIGHT_REPOST;
  const viewScore    = (post.views            || 0) * WEIGHT_VIEW;
  const ownBoost     = post.userId === viewerUserId        ? BOOST_OWN    : 0;
  const followBoost  = followingIds.includes(post.userId)  ? BOOST_FOLLOW : 0;
  const repostBoost  = post.isRepost                       ? BOOST_REPOST : 0;

  const eng = engagementMap[post.userId] || {};
  const engagementBoost =
    (eng.likes    || 0) * WEIGHT_ENGAGEMENT_LIKE +
    (eng.comments || 0) * WEIGHT_ENGAGEMENT_COMMENT +
    (eng.reposts  || 0) * WEIGHT_ENGAGEMENT_REPOST;

  // Topic affinity boost
  let topicBoost = 0;
  if (post._topics?.length && Object.keys(topicScoreMap).length) {
    post._topics.forEach(t => {
      topicBoost += (topicScoreMap[t] || 0) * WEIGHT_TOPIC;
    });
  }

  return recency + likeScore + commentScore + repostScore + viewScore +
         ownBoost + followBoost + repostBoost + engagementBoost + topicBoost;
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
    db.query(
      `SELECT r.user_id, r.original_post_id FROM reposts r
       JOIN posts p ON p.id = r.repost_post_id
       WHERE r.original_post_id IN (${ph}) AND (p.text IS NULL OR p.text='')`,
      ids
    ),
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

  const origIds = [
    ...new Set(
      posts.filter(p => p.isRepost && p.originalPostId).map(p => p.originalPostId)
    ),
  ];
  let origMap = {};
  if (origIds.length) {
    const oph = origIds.map(() => '?').join(',');
    const [origRows] = await db.query(
      `SELECT p.id, p.user_id AS userId, u.name AS author, u.picture AS authorPicture,
              p.text, p.image, p.video, p.created_at AS createdAt
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
async function getSeenPostIds(viewerKey) {
  if (!viewerKey) return new Set();
  const [rows] = await db.query(
    'SELECT DISTINCT post_id FROM post_views WHERE viewer_key = ?',
    [String(viewerKey)]
  );
  return new Set(rows.map(r => r.post_id));
}

// ── Fetch one page of posts ────────────────────────────────
async function getPostsPage(viewerUserId, feedMode, page, limit = FEED_PAGE_SIZE, mediaFilter = null) {
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

  if (mediaFilter === 'video') {
    whereClause = whereClause
      ? `${whereClause} AND p.video IS NOT NULL AND p.video != ''`
      : `WHERE p.video IS NOT NULL AND p.video != ''`;
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
    [...whereParams, POOL_SIZE + 1, OFFSET]
  );

  const poolHasMore = rawPosts.length > POOL_SIZE;
  const candidates  = rawPosts.slice(0, POOL_SIZE);

  if (!candidates.length) return { posts: [], hasMore: false };

  const viewerKey = viewerUserId ? String(viewerUserId) : null;

  const [hydratedCandidates, seenIds, engagementMap, topicScoreMap] = await Promise.all([
    hydratePosts(candidates),
    getSeenPostIds(viewerKey),
    getEngagementMap(viewerUserId),
    TopicPreferenceModel.getTopicScoreMap(viewerUserId),
  ]);

  // Bulk-fetch topics for all candidate posts
  if (Object.keys(topicScoreMap).length && hydratedCandidates.length) {
    const ids = hydratedCandidates.map(p => p.id);
    const ph  = ids.map(() => '?').join(',');
    const [topicRows] = await db.query(
      `SELECT post_id, topic FROM post_topics WHERE post_id IN (${ph})`,
      ids
    );
    const topicsByPost = {};
    ids.forEach(id => { topicsByPost[id] = []; });
    topicRows.forEach(r => topicsByPost[r.post_id]?.push(r.topic));
    hydratedCandidates.forEach(p => { p._topics = topicsByPost[p.id] || []; });
  }

  hydratedCandidates.forEach(p => {
    const base = computeScore(p, viewerUserId, followingIds, engagementMap, topicScoreMap);
    p._score   = seenIds.has(p.id) ? base * SEEN_PENALTY : base;
  });

  hydratedCandidates.sort((a, b) => b._score - a._score);

  const pagePosts = hydratedCandidates.slice(0, LIMIT);
  const hasMore   = hydratedCandidates.length > LIMIT || poolHasMore;

  pagePosts.forEach(p => { delete p._score; delete p._topics; });

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

// ── Find a post by id ──────────────────────────────────────
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

  await saveCommentTopics(postId, text);

  return result.insertId;
}

// ── Repost ─────────────────────────────────────────────────
async function getExistingRepost(userId, originalPostId) {
  const [rows] = await db.query(
    `SELECT r.id FROM reposts r
     JOIN posts p ON p.id = r.repost_post_id
     WHERE r.user_id=? AND r.original_post_id=? AND (p.text IS NULL OR p.text='')`,
    [userId, originalPostId]
  );
  return rows[0] || null;
}

async function createRepost(userId, text, originalPostId) {
  if (!text) {
    const [existRows] = await db.query(
      `SELECT r.repost_post_id FROM reposts r
       JOIN posts p ON p.id = r.repost_post_id
       WHERE r.user_id=? AND r.original_post_id=? AND (p.text IS NULL OR p.text='')
       LIMIT 1`,
      [userId, originalPostId]
    );
    if (existRows.length) return existRows[0].repost_post_id;
  }

  const [result] = await db.query(
    'INSERT INTO posts (user_id, text, is_repost, original_post_id) VALUES (?,?,1,?)',
    [userId, text || null, originalPostId]
  );
  const repostPostId = result.insertId;
  await db.query(
    'INSERT IGNORE INTO reposts (user_id, original_post_id, repost_post_id) VALUES (?,?,?)',
    [userId, originalPostId, repostPostId]
  );
  if (text) await savePostTopics(repostPostId, text);
  return repostPostId;
}

async function deleteRepost(userId, originalPostId) {
  const [rows] = await db.query(
    `SELECT r.repost_post_id FROM reposts r
     JOIN posts p ON p.id = r.repost_post_id
     WHERE r.user_id=? AND r.original_post_id=? AND (p.text IS NULL OR p.text='')
     LIMIT 1`,
    [userId, originalPostId]
  );
  if (!rows.length) return;
  const repostPostId = rows[0].repost_post_id;
  await db.query('DELETE FROM reposts WHERE repost_post_id=?', [repostPostId]);
  await db.query('DELETE FROM posts   WHERE id=?',             [repostPostId]);
}

async function getOriginalPostEmbed(originalPostId) {
  const [rows] = await db.query(
    `SELECT p.id, p.user_id AS userId, u.name AS author, u.picture AS authorPicture,
            p.text, p.image, p.video, p.created_at AS createdAt
     FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`,
    [originalPostId]
  );
  return rows[0] || null;
}

// ── Trending posts ─────────────────────────────────────────
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
async function recordView(postId, viewerId) {
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

// ── Topic stopwords ────────────────────────────────────────
const TOPIC_STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','can','her','was','one',
  'our','out','day','get','has','him','his','how','its','let','may','new',
  'now','old','see','two','way','who','boy','did','man','men','put','say',
  'she','too','use','had','have','that','this','with','they','from','been',
  'will','what','were','when','your','said','each','just','into','then',
  'than','some','more','also','over','such','here','know','like','time',
  'very','even','most','make','after','first','well','much','good','want',
  'came','come','back','does','made','many','them','these','other','about',
  'their','there','which','would','could','should','really','think','going',
  'still','being','where','every','those','while','before','again','through',
  'because','always','never','people','thing','things','anyone','someone',
  'something','anything','nothing','everyone','everything','little','great',
  'might','only','both','same','last','long','life','give','work','need',
  'feel','seem','keep','tell','next','best','high','look','place','actually',
  'usually','already','another','between','together','without','year','years',
  'today','right','left','sure','stop','took','take','away','around',
  'different','during','since','until','while','just','here','http','https',
  'with','from','that','this','have','been',
]);

// ── Extract topics from post text ─────────────────────────
function extractTopics(text) {
  if (!text) return [];
  const topics = new Set();
  const hashtags = text.match(/#([a-zA-Z0-9_]+)/g) || [];
  hashtags.forEach(t => topics.add(t.slice(1).toLowerCase()));
  text
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !TOPIC_STOPWORDS.has(w) && !/^\d+$/.test(w))
    .forEach(w => topics.add(w));
  return [...topics];
}

// ── Save topics for a post ─────────────────────────────────
async function savePostTopics(postId, text) {
  const topics = extractTopics(text);
  if (!topics.length) return;
  const values = topics.map(topic => [postId, topic, new Date()]);
  await db.query(
    'INSERT IGNORE INTO post_topics (post_id, topic, created_at) VALUES ?',
    [values]
  );
}

// ── Save comment topics back to the parent post ────────────
async function saveCommentTopics(postId, text) {
  const topics = extractTopics(text);
  if (!topics.length) return;
  const values = topics.map(topic => [postId, topic, new Date()]);
  await db.query(
    `INSERT INTO post_topics (post_id, topic, created_at) VALUES ?
     ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
    [values]
  );
}

// ── Get trending topics ────────────────────────────────────
async function getTopics(limit = 20) {
  const [rows] = await db.query(
    `SELECT topic, COUNT(*) AS post_count
     FROM post_topics
     WHERE created_at >= NOW() - INTERVAL 24 HOUR
     GROUP BY topic
     ORDER BY post_count DESC, topic ASC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

// ── Get posts for a topic ──────────────────────────────────
async function getPostsByTopic(topic, page = 1, limit = 20) {
  const OFFSET = (page - 1) * limit;
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
     FROM post_topics pt
     JOIN posts p ON p.id = pt.post_id
     JOIN users u ON u.id = p.user_id
     WHERE pt.topic = ?
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [topic.toLowerCase(), limit + 1, OFFSET]
  );
  const hasMore   = rawPosts.length > limit;
  const pagePosts = rawPosts.slice(0, limit);
  const posts     = await hydratePosts(pagePosts);
  return { posts, hasMore };
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
  deleteRepost,
  getOriginalPostEmbed,
  searchPosts,
  savePostTopics,
  saveCommentTopics,
  getTopics,
  getPostsByTopic,
  recordView,
  getViewCount,
};
