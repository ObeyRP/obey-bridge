-- obey-bridge migration 0004
-- Phase 8: events feed (SSE source) + per-event metric log (time-filtered
-- leaderboards). Apply with:
--
--   mysql -u root -p qbx_core < sql/0004-add-events-and-metric-log.sql

START TRANSACTION;

-- 1. events_feed — every notable thing that happens IC, written by the
--    obey-feed FiveM resource. Bridge SSE streams the last 25 to the
--    portal's dashboard activity rail.
CREATE TABLE IF NOT EXISTS events_feed (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(48)  NOT NULL,    -- 'arrest', 'revive', 'announcement', 'heist', 'pursuit', etc.
  actor_cid   VARCHAR(64),               -- the doer (officer, paramedic, ...)
  subject_cid VARCHAR(64),               -- the recipient (suspect, patient, ...)
  body        VARCHAR(512) NOT NULL,
  metadata    JSON,
  occurred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kind (kind),
  KEY idx_occurred_at (occurred_at),
  KEY idx_actor (actor_cid),
  KEY idx_subject (subject_cid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. obey_metric_log — append-only per-event metric writes. Powers the
--    Big Board with arbitrary time filters (today / week / month / all).
CREATE TABLE IF NOT EXISTS obey_metric_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  citizenid   VARCHAR(64) NOT NULL,
  metric      VARCHAR(32) NOT NULL,
  amount      BIGINT      NOT NULL DEFAULT 1,
  occurred_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_metric_time (metric, occurred_at),
  KEY idx_citizenid_metric (citizenid, metric, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
