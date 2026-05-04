-- ============================================================
--  Migration: add negative signal tracking + dwell time
--
--  Run this once against your existing schema.
-- ============================================================

-- 1. Negative signals table
CREATE TABLE IF NOT EXISTS post_negative_signals (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT    UNSIGNED NOT NULL,
  post_id     INT    UNSIGNED NOT NULL,
  signal_type ENUM('skip', 'short_view') NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_signal (user_id, post_id, signal_type),
  INDEX idx_user_id (user_id),
  INDEX idx_post_id (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Dwell-time column on post_views
ALTER TABLE post_views
  ADD COLUMN dwell_seconds FLOAT DEFAULT NULL;

-- 3. Index to speed up getSeenPostIds
CREATE INDEX idx_pv_viewer_key ON post_views (viewer_key);
