-- obey-bridge migration 0007
-- Phase X: soft-delete column on forum_posts. Lets staff hide posts
-- without wiping the audit log (the audit log FK has ON DELETE CASCADE,
-- so a hard delete would lose the moderation history along with the
-- post). Soft-deleted rows stay in the table; listings filter them out.
--
-- Apply with:
--   mysql -h $DB_HOST -u $DB_USER $DB_NAME < sql/0007-add-forum-soft-delete.sql

START TRANSACTION;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL;

-- Speed up "WHERE deleted_at IS NULL" filters on listings.
CREATE INDEX IF NOT EXISTS idx_deleted_at ON forum_posts (deleted_at);

COMMIT;
