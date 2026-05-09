-- obey-bridge migration 0001
-- Adds the new Obey Coins currency to qbx_core, plus a coin ledger
-- for idempotent Tebex credits and per-player metric tables that
-- back the leaderboards.
--
-- Apply with:
--   mysql -u root -p qbx_core < sql/0001-add-obey-coins.sql

START TRANSACTION;

-- 1. New currency column on the core players table.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS obey_coins INT NOT NULL DEFAULT 0;

-- 2. Idempotent ledger for /coins/credit.
CREATE TABLE IF NOT EXISTS obey_coin_ledger (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(128) NOT NULL,
  citizenid       VARCHAR(64)  NOT NULL,
  amount          INT          NOT NULL,
  source          VARCHAR(32)  NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_idem (idempotency_key),
  KEY idx_citizenid (citizenid),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Per-player counters for leaderboards. Populated by the FiveM scripts
--    (Phase 8 obey-feed resource) — Phase 4 only reads.
CREATE TABLE IF NOT EXISTS obey_metric_arrests (
  citizenid VARCHAR(64) NOT NULL,
  count     INT          NOT NULL DEFAULT 0,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (citizenid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS obey_metric_streak (
  citizenid    VARCHAR(64) NOT NULL,
  best_streak  INT          NOT NULL DEFAULT 0,
  current_streak INT        NOT NULL DEFAULT 0,
  last_claimed_utc_date DATE,
  PRIMARY KEY (citizenid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
