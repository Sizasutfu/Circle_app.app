-- Migration: add created_at to post_topics
-- Run this once against your database before deploying the updated PostModel.js

ALTER TABLE post_topics
  ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows with the parent post's created_at
-- so old data isn't suddenly dropped from any all-time queries.
UPDATE post_topics pt
JOIN posts p ON p.id = pt.post_id
SET pt.created_at = p.created_at;

-- Add an index so the 24h WHERE filter stays fast.
CREATE INDEX idx_post_topics_created_at ON post_topics (created_at);
