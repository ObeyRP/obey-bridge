-- obey-bridge migration 0003
-- Phase 7: discord_id link on players + Plus subscription state.
--
-- Apply with:
--   mysql -u root -p qbx_core < sql/0003-add-plus-and-discord-link.sql

START TRANSACTION;

-- 1. discord_id on players. Populated by the FiveM connect script when a
--    player joins. Lets the Tebex webhook route credits to the right
--    citizen without an out-of-band linking step.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS discord_id VARCHAR(32) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_players_discord_id ON players (discord_id);

-- 2. Plus subscription state per Discord user.
CREATE TABLE IF NOT EXISTS obey_plus_subscriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discord_id    VARCHAR(32)  NOT NULL,
  citizenid     VARCHAR(64),
  period        ENUM('monthly','annual') NOT NULL DEFAULT 'monthly',
  status        ENUM('active','cancellation_pending','ended') NOT NULL DEFAULT 'active',
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  renews_at     DATETIME,
  ends_at       DATETIME,
  cancelled_at  DATETIME,
  last_event    VARCHAR(64),
  source        VARCHAR(32)  NOT NULL DEFAULT 'tebex',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_discord_active (discord_id, status),
  KEY idx_discord_id (discord_id),
  KEY idx_ends_at (ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Idempotent receipt log, mirrors coin_ledger but for Plus events.
CREATE TABLE IF NOT EXISTS obey_plus_event_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(128) NOT NULL,
  discord_id      VARCHAR(32)  NOT NULL,
  event           VARCHAR(64)  NOT NULL,
  details         JSON,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_idem (idempotency_key),
  KEY idx_discord_id (discord_id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
