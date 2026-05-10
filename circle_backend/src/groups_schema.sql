-- ============================================================
--  Circle — Auto-Topic Groups Schema
--  groups + group_members tables
-- ============================================================

-- ── groups ────────────────────────────────────────────────
-- One row per auto-created topic group.
-- System creates a group when a topic accumulates ≥ 30 posts
-- within any rolling 7-day window.

CREATE TABLE IF NOT EXISTS groups (
  id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  topic         VARCHAR(120)    NOT NULL,           -- normalised lowercase
  display_name  VARCHAR(160)    NOT NULL,           -- e.g. "#football"
  description   TEXT            NULL,               -- auto-generated blurb
  cover_image   VARCHAR(512)    NULL,               -- optional banner URL
  member_count  INT UNSIGNED    NOT NULL DEFAULT 0, -- denormalised counter
  post_count    INT UNSIGNED    NOT NULL DEFAULT 0, -- rolling 7-day total at creation / updated by cron
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_groups_topic (topic),
  KEY idx_groups_member_count (member_count DESC),
  KEY idx_groups_post_count   (post_count   DESC),
  KEY idx_groups_created_at   (created_at   DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── group_members ─────────────────────────────────────────
-- Users opt-in explicitly; they are NEVER auto-added.
-- Each row records that user_id chose to join group_id.

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INT UNSIGNED  NOT NULL,
  user_id    INT UNSIGNED  NOT NULL,
  joined_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (group_id, user_id),
  KEY idx_gm_user_id   (user_id),
  KEY idx_gm_joined_at (joined_at DESC),

  CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_user  FOREIGN KEY (user_id)  REFERENCES users  (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Trigger: keep member_count in sync ───────────────────

DELIMITER $$

CREATE TRIGGER trg_gm_after_insert
AFTER INSERT ON group_members
FOR EACH ROW
BEGIN
  UPDATE groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
END$$

CREATE TRIGGER trg_gm_after_delete
AFTER DELETE ON group_members
FOR EACH ROW
BEGIN
  UPDATE groups SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.group_id;
END$$

DELIMITER ;


-- ── Useful views ──────────────────────────────────────────

-- Trending groups: most members, then most posts
CREATE OR REPLACE VIEW v_trending_groups AS
SELECT
  g.id,
  g.topic,
  g.display_name,
  g.description,
  g.cover_image,
  g.member_count,
  g.post_count,
  g.created_at
FROM groups g
ORDER BY g.member_count DESC, g.post_count DESC;


-- Rolling 7-day post counts per topic (used by the cron)
CREATE OR REPLACE VIEW v_topic_post_counts_7d AS
SELECT
  pt.topic,
  COUNT(*) AS post_count_7d
FROM post_topics pt
JOIN posts p ON p.id = pt.post_id
WHERE p.created_at >= NOW() - INTERVAL 7 DAY
GROUP BY pt.topic;
