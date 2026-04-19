-- ============================================================
--  Migration: add parent_id to comments table
--  Run once against your database before deploying the code changes.
-- ============================================================

ALTER TABLE comments
  ADD COLUMN parent_id INT NULL DEFAULT NULL,
  ADD CONSTRAINT fk_comment_parent
    FOREIGN KEY (parent_id) REFERENCES comments(id)
    ON DELETE CASCADE;

-- Index so "fetch all replies for a comment" is fast
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
