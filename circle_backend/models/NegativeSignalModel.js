// ============================================================
//  models/NegativeSignalModel.js
//
//  Stores negative engagement signals (skips, short views) and
//  provides a batch-loader for the feed scoring pipeline.
//
//  DB table (add this migration):
//  ─────────────────────────────
//  CREATE TABLE IF NOT EXISTS post_negative_signals (
//    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//    user_id     INT    UNSIGNED NOT NULL,
//    post_id     INT    UNSIGNED NOT NULL,
//    signal_type ENUM('skip','short_view') NOT NULL,
//    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//    UNIQUE KEY uq_signal (user_id, post_id, signal_type),
//    INDEX idx_user (user_id)
//  );
// ============================================================

const { db }                    = require('../config/db');
const { SHORT_VIEW_THRESHOLD }  = require('../config/constants');

/**
 * Record that a user skipped a post (scrolled past without meaningful pause).
 */
async function recordSkip(userId, postId) {
  if (!userId || !postId) return;
  await db.query(
    `INSERT INTO post_negative_signals (user_id, post_id, signal_type)
     VALUES (?, ?, 'skip')
     ON DUPLICATE KEY UPDATE created_at = created_at`,  // idempotent
    [userId, postId]
  );
}

/**
 * Record that a user viewed a post for fewer than SHORT_VIEW_THRESHOLD seconds.
 * Call this from the same endpoint as recordView when dwellMs is known.
 *
 * @param {number} userId
 * @param {number} postId
 * @param {number} dwellMs   milliseconds the post was in the viewport
 */
async function recordDwellView(userId, postId, dwellMs) {
  if (!userId || !postId) return;
  const dwellSeconds = dwellMs / 1000;

  // Store dwell seconds in post_views (add a dwell_seconds column):
  //   ALTER TABLE post_views ADD COLUMN dwell_seconds FLOAT DEFAULT 0;
  await db.query(
    `UPDATE post_views SET dwell_seconds = ?
     WHERE post_id = ? AND viewer_key = ?`,
    [dwellSeconds, postId, String(userId)]
  );

  if (dwellSeconds < SHORT_VIEW_THRESHOLD) {
    await db.query(
      `INSERT INTO post_negative_signals (user_id, post_id, signal_type)
       VALUES (?, ?, 'short_view')
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [userId, postId]
    );
  }
}

/**
 * Load negative signals for a batch of posts for a specific viewer.
 * Returns { [postId]: { skips: 0|1, shortViews: 0|1 } }
 *
 * (Counts are 0|1 per viewer — we store one signal per user+post,
 * so this is effectively a boolean. Scale-up: if you allow multiple
 * signals, change SUM to COUNT.)
 */
async function getNegativeSignalMap(userId, postIds) {
  if (!userId || !postIds.length) return {};

  const ph = postIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT
       post_id,
       SUM(signal_type = 'skip')       AS skips,
       SUM(signal_type = 'short_view') AS shortViews
     FROM post_negative_signals
     WHERE user_id = ? AND post_id IN (${ph})
     GROUP BY post_id`,
    [userId, ...postIds]
  );

  const map = {};
  rows.forEach(r => {
    map[r.post_id] = {
      skips:      Number(r.skips),
      shortViews: Number(r.shortViews),
    };
  });
  return map;
}

module.exports = { recordSkip, recordDwellView, getNegativeSignalMap };
