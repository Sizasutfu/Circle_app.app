// ============================================================
//  config/constants.js
//  Feed algorithm weights and other app-wide constants.
//  Adjust these values to tune feed behaviour without
//  touching any business logic.
// ============================================================

module.exports = {
  // ── Feed scoring weights ────────────────────────────────
  WEIGHT_LIKE:    15,   // each like adds this many score points
  WEIGHT_COMMENT: 25,   // comments signal deeper interest
  WEIGHT_REPOST:  20,   // reposts mean strong endorsement
  WEIGHT_VIEW:    1,    // views signal broad popularity
  BOOST_OWN:      3,    // small bump for your own posts
  BOOST_FOLLOW:   35,   // strong boost for people you follow
  BOOST_REPOST:   1,    // small bump so reposts aren't buried

  // ── Personal engagement boosts ──────────────────────────
  // How much you've engaged with an author boosts their posts
  WEIGHT_ENGAGEMENT_LIKE:    20,  // you liked their posts before
  WEIGHT_ENGAGEMENT_COMMENT: 35,  // you commented on their posts
  WEIGHT_ENGAGEMENT_REPOST:  30,  // you reposted their posts

  // ── Topic affinity boost ─────────────────────────────────
  // Multiplied by the user's preference score for each topic
  // a post carries.  e.g. user has score 8 for "football" →
  // a football post gets +8 * 3 = +24 added to its score.
  // Raise this to make topic following feel stronger.
  WEIGHT_TOPIC: 100,

  // ── Recency decay ───────────────────────────────────────
  // score = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT)
  RECENCY_SCALE:  100,
  RECENCY_SHIFT:  2,

  // ── Pagination ──────────────────────────────────────────
  FEED_PAGE_SIZE: 15,

  // ── Feed freshness ──────────────────────────────────────
  FEED_CANDIDATE_MULTIPLIER: 4,

  // Multiply a seen post's score by this factor instead of
  // removing it entirely.
  SEEN_PENALTY: 0,
};
