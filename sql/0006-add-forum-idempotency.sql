-- obey-bridge migration 0006
-- Phase 5: idempotency_key on forum_posts so the Discord bot can post the
-- same #announcements message twice (e.g. on bot restart) without duping.
-- The bot uses `discord-msg:<message-id>` as the key; other writers (the
-- portal's suggestion form) leave it NULL and dedupe via business rules.
--
-- Apply with:
--   mysql -u root -p qbx_core < sql/0006-add-forum-idempotency.sql

START TRANSACTION;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128) DEFAULT NULL;

-- Unique only when the key is non-NULL — MySQL/MariaDB allow many NULLs
-- under a UNIQUE constraint, which is exactly what we want here.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_idem
  ON forum_posts (idempotency_key);

COMMIT;
