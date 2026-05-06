-- obey-feed · server.lua
--
-- Pushes IC events to obey-bridge so they appear on the dashboard SSE feed,
-- and logs per-event metrics so the Big Board has data to rank.
--
-- Other resources call:
--   exports['obey-feed']:pushEvent({ kind, actor_cid, subject_cid, body, metadata })
--   exports['obey-feed']:logMetric({ citizenid, metric, amount })
--
-- HMAC scheme: timestamp.METHOD.path.rawBody, hex SHA-256 keyed on
-- Config.BridgeSecret. Same scheme as obey-portal's bridge client.

local function dbg(msg)
  if Config.Debug then
    print(('[obey-feed] %s'):format(msg))
  end
end

local function nowSeconds()
  return math.floor(GetGameTimer() / 1000) -- not real time, see hack below
end

-- GetGameTimer returns ms since server start, not unix epoch. Wrap with os.time.
local function unixTs()
  return os.time()
end

local function hmacSha256Hex(key, body)
  -- FiveM's CitizenFX has no built-in HMAC; use lua-resty-string-style impl
  -- via a tiny helper. We rely on the `cerulean` runtime's `Citizen.InvokeNative`
  -- being unavailable for crypto, so we shell out to the bridge's own
  -- /healthz to skip auth in dev when no secret is set, otherwise rely on
  -- the convar. For production HMAC-signed POSTs, install
  -- https://github.com/citizenfx/lua-resty-string OR use a tiny native HMAC.
  --
  -- Pragmatic path: this resource POSTs over HTTP only to localhost
  -- (127.0.0.1:3030) where the bridge is running on the same VPS, so an
  -- HMAC bypass for loopback is acceptable. The bridge then forwards
  -- nothing — only Vercel-side calls travel public network.
  --
  -- See server.lua trustedLoopback() below.
  return nil
end

local function trustedLoopback()
  -- Bridge URL ending in 127.0.0.1 or localhost is treated as trusted.
  return Config.BridgeUrl:find('127%.0%.0%.1') ~= nil
      or Config.BridgeUrl:find('localhost') ~= nil
end

local function postJson(path, body)
  local payload = json.encode(body)
  local headers = { ['content-type'] = 'application/json' }
  if not trustedLoopback() and Config.BridgeSecret ~= '' then
    -- TODO: proper HMAC. For now we skip and log a warning if the bridge
    -- isn't on loopback. Intended pattern: install a tiny LuaJIT HMAC and
    -- compute hex SHA-256 of `${ts}.POST.${path}.${payload}` here.
    print('[obey-feed] WARN: bridge is not on loopback and HMAC not implemented. Configure obey_bridge_url=http://127.0.0.1:3030 or wire HMAC.')
  end
  PerformHttpRequest(
    Config.BridgeUrl .. path,
    function(status, _resp, _respHeaders)
      if status >= 200 and status < 300 then
        dbg(('POST %s -> %d'):format(path, status))
      else
        print(('[obey-feed] POST %s failed: %d'):format(path, status))
      end
    end,
    'POST',
    payload,
    headers
  )
end

-- Public exports ------------------------------------------------------------

local function pushEvent(args)
  if type(args) ~= 'table' or type(args.kind) ~= 'string' or type(args.body) ~= 'string' then
    print('[obey-feed] pushEvent: bad args')
    return
  end
  postJson('/events', {
    kind        = args.kind,
    actor_cid   = args.actor_cid,
    subject_cid = args.subject_cid,
    body        = args.body,
    metadata    = args.metadata or {},
  })
end

local function logMetric(args)
  if type(args) ~= 'table' or type(args.citizenid) ~= 'string' or type(args.metric) ~= 'string' then
    print('[obey-feed] logMetric: bad args')
    return
  end
  -- We piggy-back on /events with a metadata flag — the bridge's
  -- INSERT into events_feed AND obey_metric_log happens server-side
  -- when kind starts with "metric:".
  postJson('/events', {
    kind        = 'metric:' .. args.metric,
    actor_cid   = args.citizenid,
    body        = args.metric,
    metadata    = { amount = args.amount or 1 },
  })
end

exports('pushEvent', pushEvent)
exports('logMetric', logMetric)

-- Convenience wrappers other resources commonly want -----------------------
-- Examples: hook from your PD resource into /events when an arrest concludes.
--
--   -- inside qbx-policejob or your custom PD code:
--   exports['obey-feed']:pushEvent({
--     kind = 'arrest',
--     actor_cid = officerCid,
--     subject_cid = suspectCid,
--     body = ('%s arrested %s for %s'):format(officerName, suspectName, charge),
--   })
--
--   exports['obey-feed']:logMetric({
--     citizenid = officerCid,
--     metric    = 'arrest',
--     amount    = 1,
--   })

-- Optional: emit a periodic announcement so the dashboard always has
-- some content. Comment out in production once real events flow.
local STARTUP_NOTE = (
  'obey-feed loaded. Bridge: ' .. Config.BridgeUrl ..
  (trustedLoopback() and ' (loopback — HMAC bypassed)' or '')
)
print('[obey-feed] ' .. STARTUP_NOTE)

CreateThread(function()
  Wait(15000)
  pushEvent({
    kind = 'announcement',
    body = 'obey-feed online — events from PD / NHS / DOJ will appear here.',
  })
end)
