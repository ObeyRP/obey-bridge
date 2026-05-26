-- obey-bridge migration 0008
-- Phase X: upvote / downvote system on forum suggestions. Modeled after
-- the Carl-bot Discord suggestion pattern — both up and down counts are
-- tracked + displayed separately rather than a single net score.
--
-- One row per (post, voter) pair. direction is +1 for up, -1 for down.
-- Changing a vote = UPDATE; un-voting = DELETE.
--
-- Apply with:
--   mysql -h $DB_HOST -u $DB_USER $DB_NAME < sql/0008-add-forum-votes.sql

START TRANSACTION;

CREATE TABLE IF NOT EXISTS forum_post_votes (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id           BIGINT UNSIGNED NOT NULL,
  voter_discord_id  VARCHAR(32)     NOT NULL,
  direction         TINYINT         NOT NULL,  -- +1 = up, -1 = down
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_post_voter (post_id, voter_discord_id),
  KEY idx_post (post_id),
  CONSTRAINT chk_direction CHECK (direction IN (-1, 1)),
  CONSTRAINT fk_forum_vote_post FOREIGN KEY (post_id)
    REFERENCES forum_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
