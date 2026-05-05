// ============================================================
//  models/RecommendationModel.js
//  User recommendation engine.
//
//  SCORING:
//    like    = 1 point
//    comment = 2 points
//    repost  = 3 points
//
//  Returns top users the current user has interacted with
//  but does not yet follow.
// ============================================================

const { db } = require('../config/db');

async function getRecommendations(userId, limit = 10) {

  // First check if the suspended column exists — safe fallback
  let hasSuspended = false;
  try {
    await db.query('SELECT suspended FROM users LIMIT 1');
    hasSuspended = true;
  } catch (_) {}

  const suspendedClause = hasSuspended ? 'AND u.suspended = 0' : '';

  const [rows] = await db.query(
    `
    SELECT
      u.id,
      u.name,
      u.picture,
      SUM(interactions.score) AS score
    FROM (

      -- Likes: current user liked someone's post  (1 pt)
      SELECT p.user_id AS target_user_id, 1 AS score
      FROM likes l
      JOIN posts p ON p.id = l.post_id
      WHERE l.user_id = ?
        AND p.user_id != ?

      UNION ALL

      -- Comments: current user commented on someone's post  (2 pts)
      SELECT p.user_id AS target_user_id, 2 AS score
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      WHERE c.user_id = ?
        AND p.user_id != ?

      UNION ALL

      -- Reposts: current user reposted someone's post  (3 pts)
      SELECT p.user_id AS target_user_id, 3 AS score
      FROM reposts r
      JOIN posts p ON p.id = r.original_post_id
      WHERE r.user_id = ?
        AND p.user_id != ?

    ) AS interactions

    JOIN users u ON u.id = interactions.target_user_id

    LEFT JOIN follows f
      ON  f.follower_id  = ?
      AND f.following_id = interactions.target_user_id

    WHERE
      f.follower_id IS NULL
      AND u.id != ?
      ${suspendedClause}

    GROUP BY u.id, u.name, u.picture

    ORDER BY score DESC
    LIMIT ?
    `,
    [
      userId, userId,
      userId, userId,
      userId, userId,
      userId,
      userId,
      limit,
    ]
  );

  return rows;
}

module.exports = { getRecommendations };
