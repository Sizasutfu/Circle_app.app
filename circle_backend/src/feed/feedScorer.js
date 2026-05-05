// ============================================================
//  feed/feedScorer.js
//
//  Exports a single pure function: computeScore(post, context)
//
//  Score anatomy (all values ≥ 0):
//
//    finalScore = (baseScore - negativePenalty + newness + recency)
//                 × affinityMultiplier
//                 × topicMultiplier
//                 × seenMultiplier
//                 × jitter               ← tiny randomness
//
//  Each factor is independently logged in scoreDebug so you
//  can inspect exactly why a post ranked where it did.
// ============================================================

const C = require('../config/constants');

// ── Helpers ────────────────────────────────────────────────

// log1p scale keeps engagement scores finite as counts grow large.
// log1p(0)=0, log1p(10)≈2.4, log1p(100)≈4.6, log1p(1000)≈6.9
function logScale(count) {
  return Math.log1p(Math.max(0, count));
}

// Clamp a value between [min, max]
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

// Exponential decay: 1.0 at t=0, 0.5 at t=halfLifeHours
function exponentialDecay(hoursOld, halfLifeHours) {
  return Math.exp((-Math.LN2 * hoursOld) / halfLifeHours);
}

// ── computeScore ───────────────────────────────────────────
/**
 * Score a single post for a specific viewer.
 *
 * @param {Object} post            - Hydrated post row (with likes[], comments[], reposts[], views, createdAt)
 * @param {Object} context
 * @param {number|null}  context.viewerUserId
 * @param {number[]}     context.followingIds   - IDs the viewer follows
 * @param {Object}       context.engagementMap  - { [authorId]: { likes, comments, reposts } }
 * @param {Object}       context.topicScoreMap  - { [topic]: score } from user_topic_preferences
 * @param {Set<number>}  context.seenPostIds    - post IDs already viewed
 * @param {Object}       context.negativeMap    - { [postId]: { skips, shortViews } } (optional)
 *
 * @returns {number} finalScore
 */
function computeScore(post, {
  viewerUserId   = null,
  followingIds   = [],
  engagementMap  = {},
  topicScoreMap  = {},
  seenPostIds    = new Set(),
  negativeMap    = {},
} = {}) {

  // ── 1. Base engagement score (log-scaled) ──────────────
  const likeCount    = post.likes?.length    ?? 0;
  const commentCount = post.comments?.length ?? 0;
  const repostCount  = post.reposts?.length  ?? 0;
  const viewCount    = post.views            ?? 0;
  const dwellSeconds = post.dwellSeconds     ?? 0;  // optional, 0 if not tracked

  const baseEngagement =
    logScale(likeCount)    * C.WEIGHT_LIKE    +
    logScale(commentCount) * C.WEIGHT_COMMENT +
    logScale(repostCount)  * C.WEIGHT_REPOST  +
    logScale(viewCount)    * C.WEIGHT_VIEW    +
    logScale(dwellSeconds) * C.WEIGHT_DWELL;

  // ── 2. Negative signals ────────────────────────────────
  const negSignals = negativeMap[post.id] || {};
  const negativePenalty =
    (negSignals.skips      || 0) * C.PENALTY_SKIP       +
    (negSignals.shortViews || 0) * C.PENALTY_SHORT_VIEW;

  const baseScore = Math.max(0, baseEngagement - negativePenalty);

  // ── 3. Newness boost ───────────────────────────────────
  const hoursOld    = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const newnessBoost = hoursOld < C.NEWNESS_HOURS ? C.NEWNESS_BOOST : 0;

  // ── 4. Recency (exponential decay) ────────────────────
  const recencyScore =
    C.RECENCY_WEIGHT * exponentialDecay(hoursOld, C.RECENCY_HALFLIFE_HOURS);

  // ── 5. Affinity multiplier ─────────────────────────────
  // Reflects how much the viewer has engaged with this author historically.
  const eng = engagementMap[post.userId] || {};
  const isFollowing = followingIds.includes(post.userId);

  const rawAffinity =
    (eng.likes    || 0) * C.AFFINITY_LIKE_WEIGHT    +
    (eng.comments || 0) * C.AFFINITY_COMMENT_WEIGHT  +
    (eng.reposts  || 0) * C.AFFINITY_REPOST_WEIGHT   +
    (isFollowing ? C.AFFINITY_FOLLOW_BONUS : 0);

  const affinityMultiplier = clamp(
    1.0 + rawAffinity,
    C.AFFINITY_MULTIPLIER_MIN,
    C.AFFINITY_MULTIPLIER_MAX
  );

  // ── 6. Topic interest multiplier ──────────────────────
  // Aggregate the user's preference scores for all topics on this post,
  // normalise to [0,1], then map to a multiplier.
  const postTopics = post._topics || [];
  let topicRaw = 0;
  if (postTopics.length && Object.keys(topicScoreMap).length) {
    postTopics.forEach(t => { topicRaw += topicScoreMap[t] || 0; });
    topicRaw /= postTopics.length;   // average across topics on the post
  }
  const normalisedTopic  = Math.min(1.0, topicRaw / C.TOPIC_SCORE_NORMALISE);
  const topicMultiplier  = clamp(
    1.0 + normalisedTopic * C.TOPIC_WEIGHT,
    1.0,
    C.TOPIC_MULTIPLIER_MAX
  );

  // ── 7. Seen-post penalty ───────────────────────────────
  const seenMultiplier = seenPostIds.has(post.id) ? C.SEEN_PENALTY : 1.0;

  // ── 8. Controlled jitter (exploration randomness) ─────
  // Adds ±0–5% randomness so identical-scoring posts vary
  // between feed loads. Keep it small so ranking stays stable.
  const jitter = 0.95 + Math.random() * 0.10;   // [0.95, 1.05]

  // ── 9. Final score ─────────────────────────────────────
  const preMultiplied = baseScore + newnessBoost + recencyScore;
  const finalScore    = preMultiplied
    * affinityMultiplier
    * topicMultiplier
    * seenMultiplier
    * jitter;

  // ── 10. Debug payload (attach if DEBUG_SCORES = true) ──
  if (C.DEBUG_SCORES) {
    post._scoreDebug = {
      finalScore:          +finalScore.toFixed(3),
      baseEngagement:      +baseEngagement.toFixed(3),
      negativePenalty:     +negativePenalty.toFixed(3),
      baseScore:           +baseScore.toFixed(3),
      newnessBoost,
      recencyScore:        +recencyScore.toFixed(3),
      hoursOld:            +hoursOld.toFixed(2),
      affinityMultiplier:  +affinityMultiplier.toFixed(3),
      topicMultiplier:     +topicMultiplier.toFixed(3),
      seenMultiplier,
      jitter:              +jitter.toFixed(3),
      signals: {
        likes: likeCount, comments: commentCount,
        reposts: repostCount, views: viewCount, dwellSeconds,
        skips: negSignals.skips || 0, shortViews: negSignals.shortViews || 0,
        isFollowing, postTopics, topicRaw: +topicRaw.toFixed(3),
      },
    };
  }

  return finalScore;
}

module.exports = { computeScore };


// ============================================================
//  EXAMPLE CALCULATION (for a 3-hour-old post)
//
//  Post:      5 likes, 2 comments, 1 repost, 120 views
//  Viewer:    follows the author, liked 4 of their posts before
//  Topics:    ['football'] — viewer has score 12 for football
//  Seen:      No
//
//  1. baseEngagement
//     = log1p(5)*4  + log1p(2)*9  + log1p(1)*6  + log1p(120)*0.3
//     = 1.79*4      + 1.10*9      + 0.69*6      + 4.79*0.3
//     = 7.16        + 9.90        + 4.14        + 1.44
//     = 22.64
//
//  2. negativePenalty = 0  (no skips / short views)
//     baseScore = 22.64
//
//  3. newnessBoost = 20  (post is 3h old < NEWNESS_HOURS=2? No → 0)
//     newnessBoost = 0
//
//  4. recencyScore = 50 * e^(-ln2 * 3 / 24) = 50 * 0.917 = 45.85
//
//  5. affinityMultiplier
//     rawAffinity = 4*0.05 + 0*0.12 + 0*0.08 + 0.40 (follow bonus)
//                 = 0.20 + 0.40 = 0.60
//     multiplier  = clamp(1.0 + 0.60, 0.80, 2.00) = 1.60
//
//  6. topicMultiplier
//     topicRaw     = 12 / 1 topic = 12
//     normalised   = min(1.0, 12/20) = 0.60
//     multiplier   = 1.0 + 0.60*0.60 = 1.36
//
//  7. seenMultiplier  = 1.0
//
//  8. jitter ≈ 1.0 (illustrative)
//
//  9. finalScore
//     preMultiplied = 22.64 + 0 + 45.85 = 68.49
//     final         = 68.49 * 1.60 * 1.36 * 1.0 * 1.0 ≈ 149.0
// ============================================================
