-- obey-bridge migration 0009
-- Server changelog: a third forum post type ('changelog') fed from the
-- Discord #changelog channel by obey-bot, plus an emoji-reaction system
-- so players can react to posts from the website (👍 ❤️ 🎉 🔥).
--
-- Apply with:
--   mysql -h $DB_HOST -u $DB_USER $DB_NAME < sql/0009-add-changelog-and-reactions.sql

START TRANSACTION;

-- 1. Add 'changelog' to the post-type enum. Existing rows keep their
--    values; the default stays 'suggestion'.
ALTER TABLE forum_posts
  MODIFY COLUMN type ENUM('suggestion','announcement','changelog')
    NOT NULL DEFAULT 'suggestion';

-- 2. Emoji reactions. One row per (post, user, emoji) — a user can react
--    with several different emoji on one post, but not the same emoji
--    twice. Toggling a reaction is INSERT or DELETE. Emoji stored as the
--    literal grapheme in a utf8mb4 column; the bridge validates against a
--    fixed allowlist so arbitrary emoji can't be injected.
CREATE TABLE IF NOT EXISTS forum_post_reactions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id            BIGINT UNSIGNED NOT NULL,
  reactor_discord_id VARCHAR(32)     NOT NULL,
  emoji              VARCHAR(16)     NOT NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_post_reactor_emoji (post_id, reactor_discord_id, emoji),
  KEY idx_post_emoji (post_id, emoji),
  CONSTRAINT fk_forum_reaction_post FOREIGN KEY (post_id)
    REFERENCES forum_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
