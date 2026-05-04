-- ============================================================
--  Migration: create user_topic_preferences table
--  Run once. Safe to re-run — uses IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_topic_preferences (
  user_id   INT          NOT NULL,
  topic     VARCHAR(100) NOT NULL,
  score     FLOAT        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, topic),
  INDEX idx_user_score (user_id, score DESC)
);
