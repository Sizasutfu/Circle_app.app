-- post_topics already has created_at, so skip the ALTER TABLE.
-- Just backfill existing rows and add the index.

-- Backfill existing rows with the parent post's created_at
UPDATE post_topics pt
JOIN posts p ON p.id = pt.post_id
SET pt.created_at = p.created_at;

-- Add an index so the 24h WHERE filter stays fast.
CREATE INDEX idx_post_topics_created_at ON post_topics (created_at);
