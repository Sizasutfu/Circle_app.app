// ============================================================
//  config/constants.js
//  Feed algorithm weights and other app-wide constants.
//  Adjust these values to tune feed behaviour without
//  touching any business logic.
// ============================================================

module.exports = {
  // — Engagement weights ————————————————————————————————————
  WEIGHT_LIKE:      30,   // likes matter a lot
  WEIGHT_COMMENT:   60,   // comments signal deep interest (like watch time on YouTube)
  WEIGHT_REPOST:    45,   // reposts = strong endorsement

  // — Personalization boosts ————————————————————————————————
  BOOST_OWN:        20,   // your own posts always rank near top
  BOOST_FOLLOW:     25,   // followed authors ranked higher
  BOOST_REPOST:     5,    // small bump so reposts aren't buried

  // — Recency decay —————————————————————————————————————————
  // Recency is now a soft tiebreaker, not the main driver.
  // Posts don't start decaying until ~48h old (RECENCY_SHIFT).
  // High-engagement old posts can still surface — like YouTube.
  RECENCY_SCALE:    100,
  RECENCY_SHIFT:    48,

  // — Pagination ————————————————————————————————————————————
  FEED_PAGE_SIZE:   15,   // posts returned per page (mobile-friendly)
};
