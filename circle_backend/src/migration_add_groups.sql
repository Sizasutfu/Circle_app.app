-- ============================================================
--  Migration: Add auto-topic groups to circle_db
--  Generated: 2026-05-08
--
--  Run against circle_db AFTER applying this file:
--    mysql -u <user> -p circle_db < migration_add_groups.sql
--
--  Safe to re-run: every DDL statement is guarded with
--  IF NOT EXISTS / CREATE OR REPLACE so it won't fail on
--  a partially-applied migration.
--
--  Execution order
--  ───────────────
--  1. `groups`            (no FKs, standalone)
--  2. `group_members`     (FKs → groups.id, users.id)
--  3. Triggers            (maintain groups.member_count)
--  4. Views               (used by the cron job)
-- ============================================================

/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!50503 SET NAMES utf8mb4 */;

-- ── 1. groups ─────────────────────────────────────────────────
--
--  Matches dump conventions:
--    • ENGINE=InnoDB
--    • CHARSET=utf8mb4  COLLATE=utf8mb4_unicode_ci   (same as posts, users, post_topics)
--    • id INT NOT NULL AUTO_INCREMENT                 (same width as posts.id / users.id)
--    • created_at / updated_at TIMESTAMP              (same as posts, follows, likes, etc.)

CREATE TABLE IF NOT EXISTS `groups` (
  `id`           int            NOT NULL AUTO_INCREMENT,
  `topic`        varchar(100)   COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(160)   COLLATE utf8mb4_unicode_ci NOT NULL,
  `description`  text           COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_image`  varchar(512)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_count` int unsigned   NOT NULL DEFAULT '0',
  `post_count`   int unsigned   NOT NULL DEFAULT '0',
  `created_at`   timestamp      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   timestamp      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_groups_topic`    (`topic`),
  KEY           `idx_groups_member_count` (`member_count`),
  KEY           `idx_groups_post_count`   (`post_count`),
  KEY           `idx_groups_created_at`   (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 2. group_members ──────────────────────────────────────────
--
--  FK column types must match the referenced column exactly:
--    • group_id  INT  →  groups.id      (INT NOT NULL)
--    • user_id   INT  →  users.id       (INT NOT NULL)
--
--  No auto-membership: every row is the result of an explicit
--  user action (POST /api/groups/:id/join).

CREATE TABLE IF NOT EXISTS `group_members` (
  `group_id`  int       NOT NULL,
  `user_id`   int       NOT NULL,
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`group_id`, `user_id`),
  KEY `idx_gm_user_id`   (`user_id`),
  KEY `idx_gm_joined_at` (`joined_at`),
  CONSTRAINT `fk_gm_group` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gm_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`  (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 3. Triggers ───────────────────────────────────────────────
--
--  Keep groups.member_count accurate without needing a COUNT(*)
--  query on every page load.  DROP + CREATE guards idempotency.

DROP TRIGGER IF EXISTS `trg_gm_after_insert`;
DROP TRIGGER IF EXISTS `trg_gm_after_delete`;

CREATE TRIGGER `trg_gm_after_insert`
AFTER INSERT ON `group_members`
FOR EACH ROW
  UPDATE `groups`
  SET    `member_count` = `member_count` + 1
  WHERE  `id` = NEW.group_id;

CREATE TRIGGER `trg_gm_after_delete`
AFTER DELETE ON `group_members`
FOR EACH ROW
  UPDATE `groups`
  SET    `member_count` = GREATEST(0, `member_count` - 1)
  WHERE  `id` = OLD.group_id;


-- ── 4. Views ──────────────────────────────────────────────────
--
--  v_topic_post_counts_7d  — queried every hour by the cron job
--    (GroupModel.runGroupCreationCron) to find topics that have
--    crossed the 30-post threshold and need a group created.
--
--  Joins post_topics → posts using the same column types and
--  index (idx_post_topics_created_at on post_topics.created_at)
--  that already exist in your schema, so no extra indexes needed.

CREATE OR REPLACE VIEW `v_topic_post_counts_7d` AS
  SELECT
    `pt`.`topic`,
    COUNT(*) AS `post_count_7d`
  FROM  `post_topics` `pt`
  JOIN  `posts`       `p`  ON `p`.`id` = `pt`.`post_id`
  WHERE `p`.`created_at` >= NOW() - INTERVAL 7 DAY
  GROUP BY `pt`.`topic`;


-- ── Restore session settings ───────────────────────────────────
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Migration complete.
-- Tables created : groups, group_members
-- Triggers created: trg_gm_after_insert, trg_gm_after_delete
-- Views created  : v_topic_post_counts_7d
