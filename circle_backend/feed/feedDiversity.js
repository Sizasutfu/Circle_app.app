// ============================================================
//  feed/feedDiversity.js
//
//  Applies diversity constraints to a sorted list of posts
//  AFTER scoring but BEFORE the final page slice.
//
//  Rules enforced:
//    1. MAX_PER_AUTHOR  — no creator appears more than N times
//    2. MAX_CONSECUTIVE_TOPIC — same topic can't run N+ in a row
//
//  Posts that violate a rule are pushed to an overflow list and
//  appended at the end, so no post is dropped entirely — just
//  reordered.  This keeps hasMore logic intact.
// ============================================================

const { MAX_PER_AUTHOR, MAX_CONSECUTIVE_TOPIC } = require('../config/constants');

/**
 * Re-order `sorted` (already score-sorted) to enforce diversity.
 *
 * @param  {Object[]} sorted  - Posts sorted by finalScore DESC
 * @returns {Object[]}          Diversity-filtered order (same length)
 */
function applyDiversity(sorted) {
  const authorCount   = {};          // authorId → how many times placed
  const overflow      = [];          // posts deferred due to rule violations
  const result        = [];

  let lastTopics      = [];          // topics of the last placed post
  let consecutiveTopic = 0;          // current same-topic streak length

  for (const post of sorted) {
    const authorId     = post.userId;
    const postTopics   = post._topics || [];

    // ── Author cap check ────────────────────────────────────
    const authorSoFar = authorCount[authorId] || 0;
    if (authorSoFar >= MAX_PER_AUTHOR) {
      overflow.push(post);
      continue;
    }

    // ── Topic-streak check ──────────────────────────────────
    // "same topic" = post shares at least one topic with the last post
    const overlaps = postTopics.some(t => lastTopics.includes(t));
    if (overlaps && consecutiveTopic >= MAX_CONSECUTIVE_TOPIC) {
      overflow.push(post);
      continue;
    }

    // ── Accept post ─────────────────────────────────────────
    result.push(post);
    authorCount[authorId] = authorSoFar + 1;

    if (overlaps && postTopics.length > 0) {
      consecutiveTopic++;
    } else {
      consecutiveTopic = postTopics.length > 0 ? 1 : 0;
    }
    lastTopics = postTopics;
  }

  // Append overflow (still score-ordered among themselves)
  return [...result, ...overflow];
}

module.exports = { applyDiversity };
