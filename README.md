# obey-bridge

HTTP service that sits on the FiveM VPS and brokers reads + writes between the
public [obey-portal](https://github.com/ObeyRP/obey-portal) (Vercel) and the
local `qbx_core` MySQL database. Every request is HMAC-signed.

## Endpoints

| Method | Path                  | Auth | Purpose                                   |
| ------ | --------------------- | ---- | ----------------------------------------- |
| GET    | `/healthz`            | —    | Liveness + DB ping. Used by uptime probe. |
| GET    | `/server/status`      | HMAC | `{ online, max, queue, source }` (15s cache). |
| GET    | `/player/:citizenid`  | HMAC | qbx_core player snapshot. Phase 3 callers. |
| GET    | `/leaderboard/:type`  | HMAC | `top-earner` / `top-donor` / `most-arrests` / `longest-streak`. |
| POST   | `/coins/credit`       | HMAC | Tebex webhook target. Idempotent. Phase 7. |

## Local dev

```bash
cp .env.example .env
# fill in BRIDGE_SHARED_SECRET, DB credentials, FiveM host
npm install
npm run dev
```

The bridge listens on `127.0.0.1:3030` by default. Pair with a Caddy / Nginx
reverse proxy in front for TLS and a public hostname (`bridge.obeyrp.uk`).

## HMAC scheme

Each request must include two headers:

- `x-obey-timestamp`: integer seconds since epoch
- `x-obey-signature`: hex HMAC-SHA256 of `${ts}.${METHOD}.${path}.${rawBody}`,
  using `BRIDGE_SHARED_SECRET`.

Skew tolerance: `HMAC_MAX_SKEW_SECONDS` (default 60). Bodies are hashed
verbatim (no canonical-JSON normalisation) — sender + receiver must agree on
exactly what bytes were sent.

## Production install (Ubuntu 22.04+)

```bash
# 1. Code + deps
sudo useradd -r -m -d /opt/obey-bridge -s /usr/sbin/nologin obey
sudo -u obey git clone https://github.com/ObeyRP/obey-bridge.git /opt/obey-bridge
cd /opt/obey-bridge
sudo -u obey npm ci --omit=dev
sudo -u obey npm run build

# 2. Environment
sudo -u obey cp .env.example .env
sudo -u obey nano .env  # fill in real values

# 3. Database migration (one-time, run from a host that can reach MySQL)
mysql -u root -p qbx_core < sql/0001-add-obey-coins.sql

# 4. Systemd unit
sudo cp deploy/obey-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obey-bridge
sudo systemctl status obey-bridge

# 5. Verify
curl -sS http://127.0.0.1:3030/healthz
```

## DB user (least privilege)

```sql
CREATE USER 'obey_bridge'@'127.0.0.1' IDENTIFIED BY 'replace-me';
GRANT SELECT, UPDATE (obey_coins) ON qbx_core.players TO 'obey_bridge'@'127.0.0.1';
GRANT SELECT, INSERT ON qbx_core.obey_coin_ledger TO 'obey_bridge'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON qbx_core.obey_metric_arrests TO 'obey_bridge'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON qbx_core.obey_metric_streak TO 'obey_bridge'@'127.0.0.1';
FLUSH PRIVILEGES;
```

## Phases

- **Phase 4** (this repo's MVP): `/server/status`, `/player`, `/leaderboard`, HMAC.
- **Phase 7**: `/coins/credit` consumed by the portal's Tebex webhook.
- **Phase 8**: `/leaderboard/*` swapped over to live data once the in-game
  `obey-feed` resource starts populating `obey_metric_*` tables.
