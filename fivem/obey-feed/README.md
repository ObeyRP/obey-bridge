# obey-feed

FiveM resource that pushes in-character events + per-event metrics from the
game server to **obey-bridge**, which then surfaces them on the obey-portal
dashboard (`/dashboard` → live activity feed) and on the leaderboards
(`/leaderboards` → Top Earner, Most Wanted, etc.).

Lives at `/opt/obey-bridge/fivem/obey-feed/` in the source tree but is
**copied into your FiveM resources folder** for installation:

```
resources/[obey]/obey-feed/
  fxmanifest.lua
  config.lua
  server.lua
```

Then add to your `server.cfg`:

```cfg
ensure obey-feed

# Where the bridge HTTP service lives (defaults to loopback)
setr obey_bridge_url   "http://127.0.0.1:3030"
# Shared HMAC secret — same value as BRIDGE_SHARED_SECRET in obey-bridge/.env
setr obey_bridge_secret "<the-hex-secret>"
# Optional: turn on verbose logging during bring-up
set  obey_feed_debug 1
```

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
| `qbx-policejob` post-arrest | `pushEvent({ kind='arrest', ... })` + `logMetric({ metric='arrest' })` | Powers Most Arrests + activity feed |
| `qbx-ambulancejob` revive | `pushEvent({ kind='revive', ... })` | NHS narrative on the feed |
| Mechanic resource (PDM/LSC) on repair complete | `logMetric({ metric='mechanic_repair' })` | Best Mechanic board |
| Daily-pay job on shift-end | `logMetric({ metric='earnings', amount=£ })` | Top Earner |
| Wanted-level change | `logMetric({ metric='wanted_stars', amount=stars })` | Most Wanted |
| Daily login claim | `logMetric({ metric='streak_day' })` + `pushEvent({ kind='daily_bonus', ... })` | Longest Streak + activity feed |

## Security note

This resource currently **assumes the bridge is on loopback**
(`127.0.0.1:3030`) and skips HMAC signing for that case — fine because the
loopback interface is unreachable from outside the VPS.

If you move the bridge to a different host (e.g. behind a Caddy reverse
proxy with TLS), you'll need to wire a Lua HMAC implementation in
`server.lua` (search for `TODO: proper HMAC`). Drop in
[`lua-resty-string`](https://github.com/openresty/lua-resty-string) or any
small SHA-256 HMAC module.
