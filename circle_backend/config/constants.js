// ============================================================
//  config/constants.js  —  Feed Algorithm v2
//
//  Design philosophy:
//    • Engagement signals form a BASE score (log-scaled to avoid
//      viral posts dominating forever).
//    • Affinity and topic are MULTIPLIERS (0.5–2.0 range) so
//      they modulate rank without being additive runaway values.
//    • Recency uses exponential half-life decay, not division.
//    • Exploration posts bypass scoring and are injected at
//      fixed slots to guarantee variety.
//    • All weights are grouped and commented so tuning is easy.
// ============================================================

module.exports = {

  // ── Engagement base weights ─────────────────────────────
  // Applied to log1p(count) so viral posts don't dominate.
  WEIGHT_LIKE:    4.0,   // moderate — likes are cheap
  WEIGHT_COMMENT: 9.0,   // comments = real intent
  WEIGHT_REPOST:  6.0,   // strong endorsement
  WEIGHT_VIEW:    0.3,   // high volume — keep small
  WEIGHT_DWELL:   5.0,   // seconds of reading time (if tracked)

  // ── Negative signal weights ──────────────────────────────
  // Subtracted from base score before multipliers are applied.
  PENALTY_SKIP:        8.0,   // user scrolled past without pause
  PENALTY_SHORT_VIEW:  4.0,   // viewed < SHORT_VIEW_THRESHOLD seconds
  SHORT_VIEW_THRESHOLD: 2,    // seconds — below this = short view

  // ── Affinity multiplier (author ↔ viewer history) ────────
  // Final multiplier = clamp(1.0 + affinityRaw, MIN, MAX)
  // affinityRaw is built from past likes/comments/reposts on
  // this author's posts, each weighted below.
  AFFINITY_LIKE_WEIGHT:    0.05,   // per past like on this author
  AFFINITY_COMMENT_WEIGHT: 0.12,   // per past comment
  AFFINITY_REPOST_WEIGHT:  0.08,   // per past repost
  AFFINITY_FOLLOW_BONUS:   0.40,   // flat bonus if you follow this author
  AFFINITY_MULTIPLIER_MIN: 0.80,   // floor  — unfamiliar author still surfaces
  AFFINITY_MULTIPLIER_MAX: 2.00,   // ceiling — cap so one author doesn't monopolise

  // ── Topic interest multiplier ────────────────────────────
  // topicScore from user_topic_preferences, normalised to [0,1]
  // before being turned into a multiplier.
  // Final multiplier = 1.0 + (normalisedTopicScore * TOPIC_WEIGHT)
  TOPIC_WEIGHT:           0.60,   // max topic lift = +60% of base
  TOPIC_SCORE_NORMALISE:  20.0,   // score value treated as "1.0" (tune to your data)
  TOPIC_MULTIPLIER_MAX:   1.60,   // ceiling — topic can't more than double a post

  // ── Recency decay ────────────────────────────────────────
  // Uses exponential decay: e^(-hoursOld / RECENCY_HALFLIFE_HOURS)
  // At hoursOld == RECENCY_HALFLIFE_HOURS → decay = 0.5
  // A new post (0 h) = 1.0, a 48h post with 24h halflife = 0.25
  RECENCY_HALFLIFE_HOURS:  24,    // tune down for faster-moving apps
  RECENCY_WEIGHT:          50,    // multiplied by decay value → recency score

  // ── Newness boost (brand-new posts) ─────────────────────
  // Posts under NEWNESS_HOURS old get a flat additive boost
  // so they can surface even before they accumulate engagement.
  NEWNESS_HOURS:           2,     // window for the boost
  NEWNESS_BOOST:           20,    // raw points added to base

  // ── Seen-post penalty ────────────────────────────────────
  // Score is multiplied by this value for already-seen posts.
  // 0.0 = hide, 1.0 = no penalty.  0.25 means strong pushdown.
  SEEN_PENALTY:            0.25,

  // ── Diversity constraints ────────────────────────────────
  MAX_PER_AUTHOR:          3,     // max posts per creator per page
  MAX_CONSECUTIVE_TOPIC:   2,     // max same-topic posts in a row

  // ── Exploration injection ────────────────────────────────
  // One exploration post is injected every N positions.
  // e.g. 5 → positions 5, 10, 15 … ≈ 20% of a 20-item page.
  EXPLORE_EVERY_N:         5,     // inject at every 5th slot
  EXPLORE_MAX_AGE_HOURS:   72,    // only surface posts younger than this

  // ── Feed pipeline ────────────────────────────────────────
  FEED_PAGE_SIZE:              20,
  FEED_CANDIDATE_MULTIPLIER:   6,   // candidates = page_size × this

  // ── Score debug flag ─────────────────────────────────────
  // Set to true to attach _scoreDebug to each post object.
  DEBUG_SCORES:  false,
};
