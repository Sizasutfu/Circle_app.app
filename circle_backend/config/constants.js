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

  // ── Recency decay ───────────────────────────────────────
  // score = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT)
  // Tighter decay so fresh posts rank higher, old posts fade faster
  RECENCY_SCALE:  100,
  RECENCY_SHIFT:  2,

  // ── Pagination ──────────────────────────────────────────
  FEED_PAGE_SIZE: 15,  // posts returned per page (mobile-friendly)

  // ── Feed freshness ──────────────────────────────────────
  // How many times the page size to fetch as scoring candidates.
  // e.g. page size 15 × 4 = 60 candidates pulled from DB,
  // scored, sorted, then trimmed to 15 for the response.
  // Higher = more variety but slightly more DB work.
  FEED_CANDIDATE_MULTIPLIER: 4,

  // Multiply a seen post's score by this factor instead of
  // removing it entirely — keeps the feed from going empty
  // for very active users or small apps.
  SEEN_PENALTY: 0,
};