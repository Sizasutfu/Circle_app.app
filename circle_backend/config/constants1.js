// ============================================================
//  config/constants.js
//  Feed algorithm weights and other app-wide constants.
//  Adjust these values to tune feed behaviour without
//  touching any business logic.
// ============================================================

module.exports = {
  // ── Feed scoring weights ────────────────────────────────
  WEIGHT_LIKE:    15,   // each like adds this many score points
  WEIGHT_COMMENT: 20,   // comments signal deeper interest
  WEIGHT_REPOST:  25,   // reposts mean strong endorsement
  BOOST_OWN:      10,  // your own posts always rank near top
  BOOST_FOLLOW:   8,   // followed authors' posts ranked higher
  BOOST_REPOST:   1,   // small bump so reposts aren't buried

  // ── Recency decay ───────────────────────────────────────
  // score = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT)
  RECENCY_SCALE:  200,
  RECENCY_SHIFT:  50,

  

  // ── Pagination ──────────────────────────────────────────
  FEED_PAGE_SIZE: 15,  // posts returned per page (mobile-friendly)
};
