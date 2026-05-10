-- ============================================================
--  Migration: allow posts to be scoped to a group
--  Run once against your production database.
-- ============================================================

ALTER TABLE `posts`
  ADD COLUMN `group_id` INT DEFAULT NULL
    COMMENT 'NULL = regular post; non-NULL = posted inside this group'
    AFTER `original_post_id`,
  ADD KEY `idx_posts_group_id` (`group_id`),
  ADD CONSTRAINT `fk_posts_group`
    FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`)
    ON DELETE SET NULL;
