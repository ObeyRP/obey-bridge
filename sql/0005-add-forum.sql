-- obey-bridge migration 0005
-- Phase X: forum tables — community suggestions + staff announcements,
-- nested replies, audit log of staff actions.
--
-- Apply with:
--   mysql -u root -p qbx_core < sql/0005-add-forum.sql

START TRANSACTION;

-- 1. Posts (suggestions + announcements share this table; type discriminates).
CREATE TABLE IF NOT EXISTS forum_posts (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type               ENUM('suggestion','announcement') NOT NULL DEFAULT 'suggestion',
  title              VARCHAR(200) NOT NULL,
  body               TEXT         NOT NULL,
  author_discord_id  VARCHAR(32)  NOT NULL,
  author_name        VARCHAR(120) NOT NULL,
  author_avatar      VARCHAR(255),
  status             ENUM(
                       'open',
                       'under-review',
                       'approved',
                       'rejected',
                       'implemented',
                       'moved-to-faq'
                     ) NOT NULL DEFAULT 'open',
  locked             TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_type_created (type, created_at),
  KEY idx_status (status),
  KEY idx_author (author_discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Replies — flat list per post (no nesting in v1).
CREATE TABLE IF NOT EXISTS forum_replies (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id           BIGINT UNSIGNED NOT NULL,
  body              TEXT         NOT NULL,
  author_discord_id VARCHAR(32)  NOT NULL,
  author_name       VARCHAR(120) NOT NULL,
  author_avatar     VARCHAR(255),
  is_staff          TINYINT(1)   NOT NULL DEFAULT 0,
  staff_rank        VARCHAR(64),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post (post_id, created_at),
  CONSTRAINT fk_forum_reply_post FOREIGN KEY (post_id)
    REFERENCES forum_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Audit log — every status change, lock/unlock, deletion, by which
--    staff member. Append-only.
CREATE TABLE IF NOT EXISTS forum_audit_log (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id           BIGINT UNSIGNED NOT NULL,
  actor_discord_id  VARCHAR(32)  NOT NULL,
  actor_name        VARCHAR(120) NOT NULL,
  action            VARCHAR(48)  NOT NULL,    -- 'create' | 'reply' | 'status' | 'lock' | 'unlock' | 'delete'
  details           JSON,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post (post_id, created_at),
  CONSTRAINT fk_forum_audit_post FOREIGN KEY (post_id)
    REFERENCES forum_posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

COMMIT;
