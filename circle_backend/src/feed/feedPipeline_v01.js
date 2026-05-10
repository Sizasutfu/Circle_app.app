// ============================================================
//  feed/feedPipeline.js
//
//  The main feed pipeline. Replaces getPostsPage() in PostModel.
//
//  Pipeline stages:
//    1. FETCH     — pull a large candidate pool from DB,
//                   excluding already-seen post IDs so the
//                   same post never appears on two pages
//    2. HYDRATE   — add likes / comments / reposts / views
//    3. ENRICH    — attach topics, seen set, engagement map,
//                   topic score map, negative signals
//    4. SCORE     — compute finalScore per post
//    5. SORT      — sort by finalScore DESC
//    6. DIVERSITY — enforce author cap + topic-streak limits
//    7. EXPLORE   — inject exploration posts at fixed slots
//    8. PAGE      — slice to requested page size
//    9. MARK SEEN — write served post IDs to post_views so
//                   they are excluded from future pages
//   10. CLEAN     — strip internal fields before returning
//
//  Pagination model (no OFFSET):
//    OFFSET-based pagination over a score-sorted result causes
//    duplicates because the DB fetch is ordered by created_at
//    but the serve order is by score. Instead, we fetch the
//    entire unseen pool each time and exclude already-seen IDs
//    at the SQL level. "Seen" is written back in stage 9 so
//    each post is served exactly once per viewer session.
// ============================================================

const { db }                          = require('../config/db');
const PostModel                       = require('../models/PostModel');
const TopicPreferenceModel            = require('../models/TopicPreferenceModel');
const NegativeSignalModel             = require('../models/NegativeSignalModel');
const { computeScore }                = require('./feedScorer');
const { applyDiversity }              = require('./feedDiversity');
const { fetchExplorationPosts,
        injectExplorationPosts }       = require('./feedExploration');
const C                               = require('../config/constants');

// ── Stage helpers ──────────────────────────────────────────

/** Bulk-fetch topics for a list of post IDs → { [postId]: string[] } */
async function fetchTopicsForPosts(postIds) {
  if (!postIds.length) return {};
  const ph = postIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT post_id, topic FROM post_topics WHERE post_id IN (${ph})`,
    postIds
  );
  const map = {};
  postIds.forEach(id => { map[id] = []; });
  rows.forEach(r => map[r.post_id]?.push(r.topic));
  return map;
}

/**
 * Write served post IDs to post_views so they are excluded
 * from future pages for this viewer.
 * Uses INSERT IGNORE so re-serving a post (e.g. after a bug)
 * never throws a duplicate-key error.
 */
async function markPostsAsSeen(viewerUserId, postIds) {
  if (!viewerUserId || !postIds.length) return;
  const values = postIds.map(id => [id, String(viewerUserId)]);
  await db.query(
    'INSERT IGNORE INTO post_views (post_id, viewer_key) VALUES ?',
    [values]
  );
}

// ── Main pipeline ──────────────────────────────────────────

/**
 * Fetch, score, and return one page of personalised feed posts.
 *
 * @param {number|null} viewerUserId   - authenticated user, or null for guest
 * @param {'global'|'following'} feedMode
 * @param {number}      page           - 1-based page number (used only for
 *                                       guests who have no seen-post state)
 * @param {number}      limit          - page size (default from constants)
 * @param {string|null} mediaFilter    - 'video' | null
 *
 * @returns {{ posts: Object[], hasMore: boolean, page: number, limit: number }}
 */
async function getPostsPage(
  viewerUserId,
  feedMode     = 'global',
  page         = 1,
  limit        = C.FEED_PAGE_SIZE,
  mediaFilter  = null,
) {
  const LIMIT     = limit;
  const POOL_SIZE = LIMIT * C.FEED_CANDIDATE_MULTIPLIER;

  // ── Stage 1: Fetch ─────────────────────────────────────
  //
  // For authenticated users: fetch the unseen pool by excluding
  // post IDs already recorded in post_views. No OFFSET needed —
  // seen-exclusion is the pagination cursor.
  //
  // For guests: fall back to OFFSET-based pagination (no session
  // state available). Duplicates are possible across guest pages
  // but acceptable — guests cannot log views.
  const followingIds = await PostModel.getFollowingIds(viewerUserId);

  // Read the viewer's seen set once — used for both the SQL
  // exclusion clause (fetch) and the scorer (seen penalty).
  const seenPostIds = await PostModel.getSeenPostIds(
    viewerUserId ? String(viewerUserId) : null
  );

  let conditions = [];
  let whereParams = [];

  // ── Following / global filter ────────────────────────────
  if (feedMode === 'following' && viewerUserId) {
    if (!followingIds.length) return { posts: [], hasMore: false, page, limit };
    const ph = followingIds.map(() => '?').join(',');
    conditions.push(`p.user_id IN (${ph})`);
    whereParams.push(...followingIds);
  } else if (feedMode === 'global' && viewerUserId && followingIds.length) {
    // Hide reposts from strangers — own reposts and followed-user reposts are shown.
    const ph = followingIds.map(() => '?').join(',');
    conditions.push(`(p.is_repost = 0 OR p.user_id = ? OR p.user_id IN (${ph}))`);
    whereParams.push(viewerUserId, ...followingIds);
  } else if (feedMode === 'global' && viewerUserId) {
    // Viewer follows nobody — hide all reposts except their own.
    conditions.push(`(p.is_repost = 0 OR p.user_id = ?)`);
    whereParams.push(viewerUserId);
  }
  // Guests (no viewerUserId): no author/repost filter.

  // ── Media filter ─────────────────────────────────────────
  if (mediaFilter === 'video') {
    conditions.push(`p.video IS NOT NULL AND p.video != ''`);
  }

  // ── Seen-exclusion cursor (authenticated users only) ──────
  // Replaces OFFSET — each page fetches the next unseen slice.
  let guestOffset = 0;
  if (viewerUserId && seenPostIds.size) {
    const seenPh = [...seenPostIds].map(() => '?').join(',');
    conditions.push(`p.id NOT IN (${seenPh})`);
    whereParams.push(...seenPostIds);
  } else if (!viewerUserId) {
    // Guest fallback: OFFSET pagination (duplicates possible).
    guestOffset = (page - 1) * LIMIT;
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

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
    [...whereParams, POOL_SIZE + 1, guestOffset]
  );

  const poolHasMore = rawPosts.length > POOL_SIZE;
  const candidates  = rawPosts.slice(0, POOL_SIZE);
  if (!candidates.length) return { posts: [], hasMore: false, page, limit };

  // ── Stage 2: Hydrate ───────────────────────────────────
  const hydrated = await PostModel.hydratePosts(candidates);

  // ── Stage 3: Enrich ────────────────────────────────────
  const postIds = hydrated.map(p => p.id);

  const [
    topicsByPost,
    engagementMap,
    topicScoreMap,
    negativeMap,
  ] = await Promise.all([
    fetchTopicsForPosts(postIds),
    PostModel.getEngagementMap(viewerUserId),
    TopicPreferenceModel.getTopicScoreMap(viewerUserId),
    NegativeSignalModel.getNegativeSignalMap(viewerUserId, postIds),
  ]);
  // seenPostIds already fetched in Stage 1 — reuse it here.

  // Attach topics to each post (used by scorer + diversity filter).
  hydrated.forEach(p => { p._topics = topicsByPost[p.id] || []; });

  // ── Stage 4: Score ─────────────────────────────────────
  // Convert followingIds to a Set for O(1) lookup in the scorer.
  const followingSet = new Set(followingIds);

  const scoringContext = {
    viewerUserId,
    followingIds: followingSet,
    engagementMap,
    topicScoreMap,
    seenPostIds,   // Set<number> — scorer applies seen penalty
    negativeMap,
  };

  hydrated.forEach(p => {
    p._score = computeScore(p, scoringContext);
  });

  // ── Stage 5: Sort ──────────────────────────────────────
  hydrated.sort((a, b) => b._score - a._score);

  // ── Stage 6: Diversity ─────────────────────────────────
  const diversified = applyDiversity(hydrated);

  // ── Stage 7: Slice to page ─────────────────────────────
  const personalisedSlice = diversified.slice(0, LIMIT);
  const explorationNeeded = Math.floor(LIMIT / C.EXPLORE_EVERY_N);

  // ── Stage 8: Exploration ───────────────────────────────
  // Only inject exploration for authenticated users on the global feed.
  // excludeIds covers the full scored pool so exploration posts never
  // duplicate personalised posts. seenPostIds is also unioned in so
  // exploration posts served on prior pages are never re-served.
  let finalPosts = personalisedSlice;

  if (viewerUserId && feedMode === 'global' && explorationNeeded > 0) {
    const excludeIds = new Set([
      ...diversified.map(p => p.id),
      ...seenPostIds,             // exclude anything served on prior pages
    ]);
    const explorationPosts = await fetchExplorationPosts(
      viewerUserId,
      followingIds,
      excludeIds,
      explorationNeeded,
    );
    finalPosts = injectExplorationPosts(personalisedSlice, explorationPosts);
  }

  const hasMore = diversified.length > LIMIT || poolHasMore;

  // ── Stage 9: Mark served posts as seen ─────────────────
  // Write all served post IDs (personalised + exploration) to
  // post_views. This is the pagination cursor — future pages
  // exclude these IDs at the SQL level, preventing duplicates.
  const servedIds = finalPosts.map(p => p.id);
  await markPostsAsSeen(viewerUserId, servedIds);

  // ── Stage 10: Clean ────────────────────────────────────
  // Strip internal scoring fields before sending to client.
  finalPosts.forEach(p => {
    delete p._score;
    delete p._topics;
    delete p._trendScore;
    delete p._explore;
    if (!C.DEBUG_SCORES) delete p._scoreDebug;
  });

  return { posts: finalPosts, hasMore, page, limit };
}

module.exports = { getPostsPage };
