# Obey Bridge — VPS deployment runbook

Step-by-step deployment of the bridge to a dedicated Hetzner VPS, isolated
from the FiveM VPS via Tailscale, exposed to Vercel via Cloudflare Tunnel.

> **Convention:** anywhere you see `<SOMETHING>` in angle brackets, replace
> the whole `<SOMETHING>` with the actual value (no brackets in the final
> command). Where possible, values are pulled to the top of each phase as
> shell variables so you only substitute once.

---

## Phase A — Provision the bridge VPS

1. Hetzner Cloud → New Project "obey-bridge" → Add Server
2. Settings:
   - Location: **Helsinki** or **Falkenstein**
   - Image: **Ubuntu 24.04**
   - Type: **CX22** (~€4.79/mo)
   - SSH key: paste contents of `~/.ssh/id_ed25519.pub` (run
     `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub` in PowerShell, or
     `type %USERPROFILE%\.ssh\id_ed25519.pub` in cmd, or open the file in
     Notepad)
   - Name: `obey-bridge`
3. Create & Buy now → wait ~30 sec → note the **public IPv4**.

---

## Phase B — First SSH login + harden (run as `root`)

From PowerShell on your local PC:

```powershell
ssh root@<bridge-vps-public-ipv4>
```

You're now logged in as root. **Block 1 — interactive (sets a sudo password):**

```bash
adduser obey
```

This will prompt for:
- A password — **pick something memorable, you'll need it whenever you run `sudo`**
- Full Name, Room Number, etc. — press Enter to skip them all
- Confirm with `Y` at the end

**Block 2 — paste all at once, no substitutions needed:**

```bash
usermod -aG sudo obey
mkdir -p /home/obey/.ssh
cp ~/.ssh/authorized_keys /home/obey/.ssh/
chown -R obey:obey /home/obey/.ssh
chmod 700 /home/obey/.ssh
chmod 600 /home/obey/.ssh/authorized_keys
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
echo "✅ Phase B done. Open a NEW PowerShell window and: ssh obey@<the-vps-ip>"
```

**Verify:** Open a **new** PowerShell window (keep the root one as backup):

```powershell
ssh obey@<bridge-vps-public-ipv4>
```

If it lands you in `/home/obey`, hardening worked. Type `exit` in the
original root window to close it. From here on, **always log in as `obey`**.

---

## Phase C — Install Tailscale on both VPSes

### On the bridge VPS (as `obey`):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

It prints a URL — open it in your laptop browser, sign up (Google /
GitHub / Microsoft, free for personal). Approve the device.

```bash
tailscale ip -4    # note this — it's your BRIDGE_TS_IP
```

### On the FiveM VPS (Windows, via RDP):

1. https://tailscale.com/download/windows → install
2. Sign in with the **same** Tailscale account
3. System tray Tailscale icon → "This device's IP" → note this — it's your
   `FIVEM_TS_IP`

### Verify on the bridge VPS:

```bash
ping -c 3 <FIVEM_TS_IP>
```

3/3 replies = the private mesh works.

---

## Phase D — Configure FiveM VPS MySQL (done on the FiveM VPS)

### 1. Allow MySQL to listen on the Tailscale interface

Find `my.ini`, typically at:
- `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini`, or
- `C:\Program Files\MySQL\MySQL Server 8.0\my.ini`

Open in **Notepad as Administrator**. Find the `[mysqld]` section and
ensure:

```ini
[mysqld]
bind-address = 0.0.0.0
```

Save → Services (`services.msc`) → MySQL80 → Restart.

### 2. Create the bridge MySQL user (temporary wide grants)

In HeidiSQL connected to `qbx_core`, new query tab:

```sql
CREATE USER 'obey_bridge'@'<BRIDGE_TS_IP>' IDENTIFIED BY '<PICK-A-STRONG-PASSWORD>';
GRANT ALL PRIVILEGES ON qbx_core.* TO 'obey_bridge'@'<BRIDGE_TS_IP>';
FLUSH PRIVILEGES;
```

Press F9 to run. **Write down the password** — you need it again in Phase G.

### 3. Windows Firewall — open MySQL only on Tailscale

- Search "Windows Defender Firewall with Advanced Security" → open
- Inbound Rules → New Rule (top right)
- Rule type: **Port** → Next
- Protocol & Port: TCP, **Specific local ports: 3306** → Next
- Action: **Allow the connection** → Next
- Profile: tick **only Private**, untick Domain and Public → Next
- Name: `MySQL via Tailscale` → Finish

Settings → Network & Internet → Tailscale adapter → set network profile
to **Private**.

### Verify from the bridge VPS:

```bash
sudo apt install -y mysql-client
mysql -h <FIVEM_TS_IP> -u obey_bridge -p qbx_core -e "SELECT 1"
```

Returns a `1` = MySQL is reachable through Tailscale.

---

## Phase E — Install Node + Git on bridge VPS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential
node -v && npm -v && git --version
```

`node -v` should print `v20.x.x`.

---

## Phase F — Clone, build, run migrations

Set your variables once:

```bash
export FIVEM_TS_IP=<the-fivem-vps-tailscale-ip>
export DB_PASS='<the-password-from-phase-D>'
```

(The single quotes around `DB_PASS` matter if your password contains
special characters.)

Then paste the whole rest as one block:

```bash
cd ~
git clone https://github.com/ObeyRP/obey-bridge.git
cd obey-bridge
npm ci
npm run build

for f in sql/0001-add-obey-coins.sql \
         sql/0002-add-applications.sql \
         sql/0003-add-plus-and-discord-link.sql \
         sql/0004-add-events-and-metric-log.sql \
         sql/0005-add-forum.sql; do
  echo "→ $f"
  MYSQL_PWD="$DB_PASS" mysql -h "$FIVEM_TS_IP" -u obey_bridge qbx_core < "$f" || break
done
echo "✅ Migrations complete."
```

**Verify in HeidiSQL** that `qbx_core` now contains: `applications`,
`forum_posts`, `forum_replies`, `forum_audit_log`, `events`, `metric_log`,
`discord_links`, `plus_subscriptions`, plus an `obey_coins` column on
`players`.

### Tighten the bridge user's MySQL grants

In HeidiSQL, run (replace `<BRIDGE_TS_IP>`):

```sql
REVOKE ALL PRIVILEGES ON qbx_core.* FROM 'obey_bridge'@'<BRIDGE_TS_IP>';

GRANT SELECT ON qbx_core.players TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT UPDATE (obey_coins) ON qbx_core.players TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.applications        TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.forum_posts         TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.forum_replies       TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.forum_audit_log     TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.events              TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.metric_log          TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.discord_links       TO 'obey_bridge'@'<BRIDGE_TS_IP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON qbx_core.plus_subscriptions  TO 'obey_bridge'@'<BRIDGE_TS_IP>';

FLUSH PRIVILEGES;
```

---

## Phase G — Configure `.env` (run on bridge VPS)

Generate the HMAC secret first:

```bash
openssl rand -hex 32
```

Copy that hex string — it goes in the `.env` AND in Vercel later. They
must match exactly.

Then create the env file:

```bash
cd ~/obey-bridge
nano .env
```

Paste this template, fill in your values:

```ini
PORT=3030
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info

BRIDGE_SHARED_SECRET=<paste-hex-from-openssl>
HMAC_MAX_SKEW_SECONDS=60

DB_HOST=<FIVEM_TS_IP>
DB_PORT=3306
DB_USER=obey_bridge
DB_PASSWORD=<the-password-from-phase-D>
DB_NAME=qbx_core

FIVEM_HOST=<FIVEM_TS_IP>
FIVEM_PORT=30120
TX_ADMIN_URL=

SERVER_STATUS_CACHE_SECONDS=15
```

Save (Ctrl+O → Enter → Ctrl+X). Then:

```bash
chmod 600 .env
npm start
```

Logs should show `bridge listening on 127.0.0.1:3030`. From a second SSH
session: `curl http://127.0.0.1:3030/health` returns `{"ok":true}`.

Stop with **Ctrl+C** — we'll run it as a service next.

---

## Phase H — systemd service

```bash
sudo tee /etc/systemd/system/obey-bridge.service > /dev/null <<'EOF'
[Unit]
Description=Obey Bridge (Express + MySQL)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=obey
WorkingDirectory=/home/obey/obey-bridge
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5s
EnvironmentFile=/home/obey/obey-bridge/.env

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/obey/obey-bridge

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now obey-bridge
sudo systemctl status obey-bridge --no-pager
```

Status should show `active (running)`. Tail logs:

```bash
journalctl -u obey-bridge -f      # Ctrl+C to stop tailing
```

Sanity-test reboot:

```bash
sudo reboot
```

Wait 30 sec → `ssh obey@<bridge-ip>` again → `systemctl status obey-bridge`
should still be `active (running)`.

---

## Phase I — Cloudflare Tunnel → `bridge.obeyrp.uk`

**Prerequisite:** `obeyrp.uk` is on Cloudflare (free plan). If not, add it
at dash.cloudflare.com first and update nameservers at your domain
registrar.

```bash
# Install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb

# Authenticate — opens a URL, paste it into your laptop browser
cloudflared tunnel login
# Pick obeyrp.uk → Authorize

# Create tunnel
cloudflared tunnel create obey-bridge
# Note the UUID it prints
```

Now write the config (replace `<UUID>`):

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: <UUID>
credentials-file: /home/obey/.cloudflared/<UUID>.json

ingress:
  - hostname: bridge.obeyrp.uk
    service: http://localhost:3030
  - service: http_status:404
EOF

cloudflared tunnel route dns obey-bridge bridge.obeyrp.uk
sudo cloudflared service install
sudo systemctl status cloudflared --no-pager
```

**Verify from your laptop:**

```powershell
curl https://bridge.obeyrp.uk/health
```

Returns `{"ok":true}` = tunnel up, bridge reachable from anywhere via HTTPS.

---

## Phase J — Wire up Vercel

Vercel dashboard → project `obey-portal-m8rf` → Settings → Environment
Variables → Production scope:

| Key | Value |
|---|---|
| `BRIDGE_URL` | `https://bridge.obeyrp.uk` |
| `BRIDGE_SHARED_SECRET` | the same hex from `~/obey-bridge/.env` |
| `NEXT_PUBLIC_BRIDGE_URL` | `https://bridge.obeyrp.uk` (for dashboard activity feed) |

Then: Deployments → ⋯ on latest → **Redeploy** → untick "Use existing
build cache" → confirm. Wait ~2 min.

---

## Phase K — End-to-end verification

Open in your laptop browser:

| URL | Expected |
|---|---|
| `https://obeyrp.uk/api/server/status` | JSON with player counts, no `bridge-unconfigured` |
| `https://obeyrp.uk/forum` | Empty list + "Post your first suggestion" CTA |
| `https://obeyrp.uk/forum/new` (signed in) | Posting a test suggestion redirects to detail page |
| `https://obeyrp.uk/leaderboards` | Pills render |
| `https://obeyrp.uk/whitelist` (signed in) | Application form submits and persists |

---

## Troubleshooting

```bash
# Bridge logs
journalctl -u obey-bridge -n 100 --no-pager

# Tunnel logs
journalctl -u cloudflared -n 50 --no-pager

# Direct bridge health
curl http://127.0.0.1:3030/health

# Through tunnel
curl https://bridge.obeyrp.uk/health

# DB connectivity
mysql -h "$FIVEM_TS_IP" -u obey_bridge -p qbx_core -e "SHOW TABLES"
```

| Symptom | Likely cause | Fix |
|---|---|---|
| `bridge-unconfigured` in portal | Vercel env vars not picked up | Redeploy with cache cleared |
| `bridge-error` 502, bridge logs `bad-signature` | HMAC secret mismatch OR `req.path`/`req.originalUrl` bug (fixed in cdb42b2) | Confirm bridge is on `cdb42b2`+; otherwise re-paste hex into both Vercel and `.env`, restart bridge, redeploy portal |
| `ECONNREFUSED <FIVEM_TS_IP>:3306` | MySQL not listening on Tailscale, or firewall | Re-check `bind-address=0.0.0.0` in `my.ini`, restart MySQL80 service, confirm firewall rule is on Private profile |
| MySQL `Illegal mix of collations` on JOIN | Bridge tables created with different collation than qbox `players` | `ALTER TABLE <ours> CONVERT TO CHARACTER SET utf8mb4 COLLATE <whatever players.citizenid uses>`. Migration files (99393eb+) default to `utf8mb4_unicode_ci` to match qbox-core. |
| Bridge resolves Tailscale **hostname** instead of IP in HMAC error | Reverse DNS lookups on MySQL | Add `skip-name-resolve` to `my.ini`, restart MySQL80 |
| Tunnel offline | cloudflared service stopped | `sudo systemctl restart cloudflared` |
| Reboot kills bridge | systemd unit disabled | `sudo systemctl enable obey-bridge` |
| Page shows old "bridge offline" after a fix | Vercel ISR caching (e.g. `/leaderboards` has `revalidate = 3600`) | Trigger a fresh Vercel redeploy to bust the cache, or wait the ISR window |

---

## Operational notes

- **Backup snapshots:** Hetzner → your server → Snapshots → enable nightly
  (~€0.50/mo). One-click rollback if anything breaks.
- **Rotate HMAC secret:** generate new hex, paste into VPS `.env` AND
  Vercel env, `sudo systemctl restart obey-bridge`, redeploy portal.
- **Update bridge code:** `cd ~/obey-bridge && git pull && npm ci && npm run
  build && sudo systemctl restart obey-bridge`.
- **MySQL grant audit:** `SHOW GRANTS FOR 'obey_bridge'@'<BRIDGE_TS_IP>';`
  in HeidiSQL — should match the locked-down list from Phase F.
