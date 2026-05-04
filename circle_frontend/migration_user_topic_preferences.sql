-- ============================================================
--  migration: add user_topic_preferences table
--  Run this once against your database.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_topic_preferences (
  id         INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED    NOT NULL,
  topic      VARCHAR(100)    NOT NULL,
  score      FLOAT           NOT NULL DEFAULT 1,   -- grows with engagement
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_topic (user_id, topic),       -- one row per user+topic
  KEY idx_user_id (user_id),
  KEY idx_topic   (topic)
);
