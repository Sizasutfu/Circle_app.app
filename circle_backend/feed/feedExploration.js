// ============================================================
//  feed/feedExploration.js
//
//  Fetches a pool of "exploration" posts — content the viewer
//  hasn't seen, from creators they don't follow, that is
//  trending or simply recent — and injects them at fixed slots
//  in the personalised feed.
//
//  Injection pattern: every EXPLORE_EVERY_N positions gets one
//  exploration post swapped in (positions 5, 10, 15 … on a
//  20-item page = ~20% exploration, ~80% personalised).
// ============================================================

const { db }                          = require('../config/db');
const { hydratePosts }                = require('../models/PostModel');
const { EXPLORE_EVERY_N, EXPLORE_MAX_AGE_HOURS } = require('../config/constants');

/**
 * Fetch candidate exploration posts.
 * Excludes posts from people the viewer already follows,
 * and posts already in the personalised batch.
 *
 * @param {number|null} viewerUserId
 * @param {number[]}    followingIds      - already-followed author IDs
 * @param {Set<number>} excludePostIds   - personalised batch post IDs
 * @param {number}      needed            - how many exploration slots exist
 * @returns {Object[]}  hydrated posts
 */
async function fetchExplorationPosts(viewerUserId, followingIds, excludePostIds, needed) {
  if (needed <= 0) return [];

  // Exclude the viewer themselves and people they follow
  const excludeAuthorIds = viewerUserId
    ? [viewerUserId, ...followingIds]
    : [...followingIds];

  const authorPh  = excludeAuthorIds.length
    ? excludeAuthorIds.map(() => '?').join(',')
    : 'NULL';  // degenerate safe value if empty

  const postPh = excludePostIds.size
    ? [...excludePostIds].map(() => '?').join(',')
    : 'NULL';

  const params = [
    ...excludeAuthorIds,
    ...[...excludePostIds],
    EXPLORE_MAX_AGE_HOURS,
    needed * 3,   // over-fetch so we have buffer after deduplication
  ];

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
       p.created_at       AS createdAt,
       (
         (SELECT COUNT(*) FROM likes    WHERE post_id = p.id) * 2 +
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id) * 4 +
         (SELECT COUNT(*) FROM reposts  WHERE original_post_id = p.id) * 3
       ) AS _trendScore
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id NOT IN (${authorPh})
       AND p.id      NOT IN (${postPh})
       AND p.created_at >= NOW() - INTERVAL ? HOUR
     ORDER BY _trendScore DESC, RAND()
     LIMIT ?`,
    params
  );

  if (!rawPosts.length) return [];

  const hydrated = await hydratePosts(rawPosts);
  return hydrated.slice(0, needed);
}

/**
 * Splice exploration posts into the personalised feed at
 * every EXPLORE_EVERY_N-th position.
 *
 * @param {Object[]} personalised   - diversity-filtered personalised posts
 * @param {Object[]} exploration    - exploration posts
 * @returns {Object[]}               merged feed
 */
function injectExplorationPosts(personalised, exploration) {
  if (!exploration.length) return personalised;

  const result   = [];
  let   explIdx  = 0;

  for (let i = 0; i < personalised.length; i++) {
    result.push(personalised[i]);

    // After every Nth personalised post, insert one exploration post
    const isSlot = ((i + 1) % EXPLORE_EVERY_N === 0);
    if (isSlot && explIdx < exploration.length) {
      const explPost     = exploration[explIdx++];
      explPost._explore  = true;   // flag for client analytics (optional)
      result.push(explPost);
    }
  }

  return result;
}

module.exports = { fetchExplorationPosts, injectExplorationPosts };
