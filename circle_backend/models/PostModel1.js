// ============================================================
//  CHANGES TO models/PostModel.js
//  Apply these three edits to your existing file.
// ============================================================

// ── EDIT 1 ──────────────────────────────────────────────────
// At the top, add TopicPreferenceModel to the requires:
//
//   const TopicPreferenceModel = require('./TopicPreferenceModel');
//
// ── EDIT 2 ──────────────────────────────────────────────────
// Replace the existing computeScore() function with this version
// that adds a topicBoost parameter:

function computeScore(post, viewerUserId, followingIds = [], engagementMap = {}, topicScoreMap = {}) {
  const hoursOld     = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency      = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore    = (post.likes?.length    || 0) * WEIGHT_LIKE;
  const commentScore = (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore  = (post.reposts?.length  || 0) * WEIGHT_REPOST;
  const viewScore    = (post.views            || 0) * WEIGHT_VIEW;
  const ownBoost     = post.userId === viewerUserId       ? BOOST_OWN    : 0;
  const followBoost  = followingIds.includes(post.userId) ? BOOST_FOLLOW : 0;
  const repostBoost  = post.isRepost                      ? BOOST_REPOST : 0;

  // Personal engagement boost — how much this viewer engaged with this author
  const eng = engagementMap[post.userId] || {};
  const engagementBoost =
    (eng.likes    || 0) * WEIGHT_ENGAGEMENT_LIKE +
    (eng.comments || 0) * WEIGHT_ENGAGEMENT_COMMENT +
    (eng.reposts  || 0) * WEIGHT_ENGAGEMENT_REPOST;

  // Topic affinity boost — sum preference scores for every topic this post carries
  let topicBoost = 0;
  if (post._topics?.length && Object.keys(topicScoreMap).length) {
    post._topics.forEach(t => {
      topicBoost += (topicScoreMap[t] || 0) * WEIGHT_TOPIC;
    });
  }

  return recency + likeScore + commentScore + repostScore + viewScore +
         ownBoost + followBoost + repostBoost + engagementBoost + topicBoost;
}

// ── EDIT 3 ──────────────────────────────────────────────────
// Replace the existing getPostsPage() function with this version.
// Key additions:
//   a) Fetches topicScoreMap from TopicPreferenceModel
//   b) Fetches post topics in bulk and attaches them as post._topics
//   c) Passes topicScoreMap into computeScore()

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

  // Fetch topic map alongside existing parallel queries
  const [hydratedCandidates, seenIds, engagementMap, topicScoreMap] = await Promise.all([
    hydratePosts(candidates),
    getSeenPostIds(viewerKey),
    getEngagementMap(viewerUserId),
    TopicPreferenceModel.getTopicScoreMap(viewerUserId),  // NEW
  ]);

  // Bulk-fetch topics for all candidate posts so computeScore can use them
  // without N+1 queries.
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

  // Clean up internal fields before sending to client
  pagePosts.forEach(p => { delete p._score; delete p._topics; });

  return { posts: pagePosts, hasMore };
}
