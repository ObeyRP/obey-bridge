# obey-feed

FiveM resource that pushes in-character events + per-event metrics from the
game server to **obey-bridge**, which then surfaces them on the obey-portal
dashboard (`/dashboard` → live activity feed) and on the leaderboards
(`/leaderboards` → Top Earner, Most Wanted, etc.).

Works against either:
- a **local bridge** on the same VPS (`http://127.0.0.1:3030`), or
- a **remote bridge** behind Cloudflare Tunnel (`https://bridge.obeyrp.uk`)

Either way, every POST is HMAC-SHA-256 signed with the same shared secret
the bridge holds in `BRIDGE_SHARED_SECRET`. The signing implementation is
self-contained pure Lua (no external dependencies) — see `sha256.lua`.

## Install

Copy this folder into your FiveM resources tree:

```
resources/[obey]/obey-feed/
  fxmanifest.lua
  config.lua
  sha256.lua
  server.lua
```

Then in `server.cfg`:

```cfg
ensure obey-feed

# Public Cloudflare-tunnel URL of the bridge (production setup)
setr obey_bridge_url    "https://bridge.obeyrp.uk"

# Or, if you've co-located the bridge on the same VPS as FiveM:
# setr obey_bridge_url  "http://127.0.0.1:3030"

# Shared HMAC secret — MUST match BRIDGE_SHARED_SECRET in obey-bridge/.env.
# Treat as sensitive — never commit, never paste in Discord.
setr obey_bridge_secret "<the-64-char-hex-from-bridge-VPS-.env>"

# Optional: turn on verbose console logging during bring-up
set  obey_feed_debug 1
```

Restart the server. Within 15 seconds you should see in the console:

```
[obey-feed] loaded. Bridge: https://bridge.obeyrp.uk
[obey-feed] POST /events -> 200      (debug=1 only)
```

And on the portal's `/dashboard`, the activity rail should show:
> obey-feed online — events from PD / NHS / DOJ will appear here.

## Exports

```lua
-- Push an IC event to the dashboard activity feed:
exports['obey-feed']:pushEvent({
  kind        = 'arrest',          -- 'arrest', 'revive', 'fire', 'rescue', 'court', 'announcement', 'daily_bonus', 'coin_credit', etc.
  actor_cid   = officerCitizenId,  -- the doer (optional)
  subject_cid = suspectCitizenId,  -- the recipient (optional)
  body        = 'Officer Nox arrested Citizen_Kane for armed robbery on Hyde Park Corner.',
  metadata    = { borough = 'Westminster' },
})

-- Log a per-event metric for the leaderboards:
exports['obey-feed']:logMetric({
  citizenid = officerCitizenId,
  metric    = 'arrest',  -- 'earnings', 'arrest', 'wanted_stars', 'mechanic_repair', 'streak_day'
  amount    = 1,
})
```

## Hooking up your existing resources

These are the exact callsites you want. Patch your resources to call the
exports above:

| FiveM resource event | Pair to add | Why |
| --- | --- | --- |
| `qbx-policejob` post-arrest | `pushEvent({ kind='arrest', ... })` + `logMetric({ metric='arrest' })` | Most Arrests + activity feed |
| `qbx-ambulancejob` revive | `pushEvent({ kind='revive', ... })` | NHS narrative on the feed |
| Mechanic resource (PDM/LSC) on repair complete | `logMetric({ metric='mechanic_repair' })` | Best Mechanic |
| Daily-pay job on shift-end | `logMetric({ metric='earnings', amount=£ })` | Top Earner |
| Wanted-level change | `logMetric({ metric='wanted_stars', amount=stars })` | Most Wanted |
| Daily login claim | `logMetric({ metric='streak_day' })` + `pushEvent({ kind='daily_bonus', ... })` | Longest Streak + activity feed |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[obey-feed] WARN: obey_bridge_secret not set` | Convar missing | Set `setr obey_bridge_secret "..."` in server.cfg, restart |
| `POST /events failed: 401 ({"error":"bad-signature"})` | HMAC secret on FiveM doesn't match the bridge's | Re-paste the bridge's `BRIDGE_SHARED_SECRET` into server.cfg, restart |
| `POST /events failed: 401 ({"error":"stale-timestamp"})` | FiveM VPS clock drifted >60s from bridge VPS | `w32tm /resync` on Windows (or check NTP), then retry |
| `POST /events failed: 0` | Bridge unreachable / Cloudflare Tunnel down | `curl https://bridge.obeyrp.uk/healthz` — should return `{"ok":true,...}` |
| Nothing happens, no log lines | Resource not started | Confirm `ensure obey-feed` is in server.cfg above any resources that depend on it |

## Security note

The HMAC signature payload is `${ts}.POST.${path}.${rawBody}`, hex SHA-256
keyed on the shared secret. Same scheme as obey-portal → obey-bridge,
implemented in `sha256.lua` (verified against FIPS-180 test vectors and
Node's `crypto.createHmac`). Replay protection: the bridge rejects
timestamps drifting more than `HMAC_MAX_SKEW_SECONDS` (default 60s).
