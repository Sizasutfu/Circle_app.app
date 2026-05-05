// ============================================================
//  feed/feedPipeline.js
//
//  The main feed pipeline. Replaces getPostsPage() in PostModel.
//
//  Pipeline stages:
//    1. FETCH     — pull a large candidate pool from DB
//    2. HYDRATE   — add likes / comments / reposts / views
//    3. ENRICH    — attach topics, seen set, engagement map,
//                   topic score map, negative signals
//    4. SCORE     — compute finalScore per post
//    5. SORT      — sort by finalScore DESC
//    6. DIVERSITY — enforce author cap + topic-streak limits
//    7. EXPLORE   — inject exploration posts at fixed slots
//    8. PAGE      — slice to requested page size
//    9. CLEAN     — strip internal fields before returning
//
//  The pipeline is linear and each stage has a clear input/
//  output contract, making it easy to test or swap stages.
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

// ── Main pipeline ──────────────────────────────────────────

/**
 * Fetch, score, and return one page of personalised feed posts.
 *
 * @param {number|null} viewerUserId   - authenticated user, or null for guest
 * @param {'global'|'following'} feedMode
 * @param {number}      page           - 1-based page number
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
  const LIMIT      = limit;
  const POOL_SIZE  = LIMIT * C.FEED_CANDIDATE_MULTIPLIER;
  const OFFSET     = (page - 1) * LIMIT;

  // ── Stage 1: Fetch ─────────────────────────────────────
  const followingIds = await PostModel.getFollowingIds(viewerUserId);

  let whereClause = '';
  let whereParams = [];

  if (feedMode === 'following' && viewerUserId) {
    if (!followingIds.length) return { posts: [], hasMore: false, page, limit };
    const ph    = followingIds.map(() => '?').join(',');
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

  const poolHasMore  = rawPosts.length > POOL_SIZE;
  const candidates   = rawPosts.slice(0, POOL_SIZE);
  if (!candidates.length) return { posts: [], hasMore: false, page, limit };

  // ── Stage 2: Hydrate ───────────────────────────────────
  const hydrated = await PostModel.hydratePosts(candidates);

  // ── Stage 3: Enrich ────────────────────────────────────
  const postIds = hydrated.map(p => p.id);

  const [
    topicsByPost,
    seenPostIds,
    engagementMap,
    topicScoreMap,
    negativeMap,
  ] = await Promise.all([
    fetchTopicsForPosts(postIds),
    PostModel.getSeenPostIds(viewerUserId ? String(viewerUserId) : null),
    PostModel.getEngagementMap(viewerUserId),
    TopicPreferenceModel.getTopicScoreMap(viewerUserId),
    NegativeSignalModel.getNegativeSignalMap(viewerUserId, postIds),
  ]);

  // Attach topics to each post (used by scorer + diversity filter)
  hydrated.forEach(p => { p._topics = topicsByPost[p.id] || []; });

  // ── Stage 4: Score ─────────────────────────────────────
  const scoringContext = {
    viewerUserId,
    followingIds,
    engagementMap,
    topicScoreMap,
    seenPostIds,
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
  // Determine exploration slots needed on this page
  const personalisedSlice = diversified.slice(0, LIMIT);
  const explorationNeeded = Math.floor(LIMIT / C.EXPLORE_EVERY_N);

  // ── Stage 8: Exploration ───────────────────────────────
  // Only inject exploration for authenticated users on the global feed
  let finalPosts = personalisedSlice;

  if (viewerUserId && feedMode === 'global' && explorationNeeded > 0) {
    const excludeIds = new Set(diversified.map(p => p.id));
    const explorationPosts = await fetchExplorationPosts(
      viewerUserId,
      followingIds,
      excludeIds,
      explorationNeeded,
    );
    finalPosts = injectExplorationPosts(personalisedSlice, explorationPosts);
  }

  const hasMore = diversified.length > LIMIT || poolHasMore;

  // ── Stage 9: Clean ─────────────────────────────────────
  // Strip internal scoring fields before sending to client
  finalPosts.forEach(p => {
    delete p._score;
    delete p._topics;
    if (!C.DEBUG_SCORES) delete p._scoreDebug;
  });

  return { posts: finalPosts, hasMore, page, limit };
}

module.exports = { getPostsPage };
