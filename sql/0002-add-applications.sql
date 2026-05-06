-- obey-bridge migration 0002
-- Adds the whitelist applications + audit log tables. Phase 6.
--
-- Apply with:
--   mysql -u root -p qbx_core < sql/0002-add-applications.sql

START TRANSACTION;

CREATE TABLE IF NOT EXISTS applications (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role                  VARCHAR(64)  NOT NULL,
  applicant_discord_id  VARCHAR(32)  NOT NULL,
  applicant_name        VARCHAR(120) NOT NULL,
  applicant_avatar      VARCHAR(255),
  status                ENUM('pending','interview','approved','rejected','withdrawn')
                        NOT NULL DEFAULT 'pending',
  auto_screen_score     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  payload               JSON         NOT NULL,
  admin_notes           JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  submitted_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at           DATETIME,
  reviewer_discord_id   VARCHAR(32),
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_role (role),
  KEY idx_applicant (applicant_discord_id),
  KEY idx_submitted_at (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS application_audit_log (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id    BIGINT UNSIGNED NOT NULL,
  actor_discord_id  VARCHAR(32)  NOT NULL,
  action            VARCHAR(32)  NOT NULL,
  details           JSON,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_application_id (application_id),
  KEY idx_created_at (created_at),
  CONSTRAINT fk_audit_application FOREIGN KEY (application_id)
    REFERENCES applications (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

COMMIT;
