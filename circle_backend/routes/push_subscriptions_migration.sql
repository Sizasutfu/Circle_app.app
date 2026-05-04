-- Migration: add push_subscriptions table to circle_db
-- Run once: mysql -u root -p circle_db < push_subscriptions_migration.sql

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id`               int          NOT NULL AUTO_INCREMENT,
  `user_id`          int          NOT NULL,
  `endpoint`         text         COLLATE utf8mb4_unicode_ci NOT NULL,
  `p256dh`           varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `auth`             varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  -- per-type preferences (mirrors the toggles in Settings)
  `pref_likes`       tinyint(1)   NOT NULL DEFAULT 1,
  `pref_comments`    tinyint(1)   NOT NULL DEFAULT 1,
  `pref_reposts`     tinyint(1)   NOT NULL DEFAULT 1,
  `pref_new_post`    tinyint(1)   NOT NULL DEFAULT 1,
  `pref_profile_pic` tinyint(1)   NOT NULL DEFAULT 1,
  `pref_follows`     tinyint(1)   NOT NULL DEFAULT 1,
  `pref_mentions`    tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- endpoint is the unique device identifier; prefix index required because TEXT can't be UNIQUE directly
  UNIQUE KEY `uq_endpoint` ((LEFT(`endpoint`, 500))),
  KEY `idx_push_user_id` (`user_id`),
  CONSTRAINT `fk_push_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
