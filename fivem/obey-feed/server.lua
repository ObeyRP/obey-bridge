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
-- Config.BridgeSecret. Same scheme as obey-portal's bridge client and
-- obey-bridge's hmacAuth middleware. Implementation lives in sha256.lua.

-- sha256.lua returns a table. FiveM Lua doesn't have require(), so we
-- LoadResourceFile + load() to evaluate it and capture the exports.
local hmac_sha256_hex
do
  local raw = LoadResourceFile(GetCurrentResourceName(), 'sha256.lua')
  assert(raw, '[obey-feed] could not load sha256.lua')
  local chunk, err = load(raw, 'sha256.lua', 't')
  assert(chunk, '[obey-feed] sha256.lua parse error: ' .. tostring(err))
  local mod = chunk()
  hmac_sha256_hex = mod.hmac_sha256_hex
  assert(type(hmac_sha256_hex) == 'function',
    '[obey-feed] sha256.lua did not export hmac_sha256_hex')
end

local function dbg(msg)
  if Config.Debug then
    print(('[obey-feed] %s'):format(msg))
  end
end

local function postJson(path, body)
  if Config.BridgeSecret == '' then
    print('[obey-feed] WARN: obey_bridge_secret not set — skipping POST to ' .. path)
    return
  end

  local payload = json.encode(body)
  local ts = tostring(os.time())
  local sigInput = ts .. '.POST.' .. path .. '.' .. payload
  local signature = hmac_sha256_hex(Config.BridgeSecret, sigInput)

  local headers = {
    ['content-type']      = 'application/json',
    ['x-obey-timestamp']  = ts,
    ['x-obey-signature']  = signature,
  }

  PerformHttpRequest(
    Config.BridgeUrl .. path,
    function(status, _resp, _respHeaders)
      if status >= 200 and status < 300 then
        dbg(('POST %s -> %d'):format(path, status))
      else
        print(('[obey-feed] POST %s failed: %d (%s)'):format(path, status, tostring(_resp):sub(1, 200)))
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
  local payload = {
    kind        = args.kind,
    actor_cid   = args.actor_cid,
    subject_cid = args.subject_cid,
    body        = args.body,
  }
  -- Only include metadata if it has at least one key — Lua's empty {} would
  -- JSON-encode as [] (array) and the bridge expects a JSON object.
  if args.metadata and next(args.metadata) ~= nil then
    payload.metadata = args.metadata
  end
  postJson('/events', payload)
end

local function logMetric(args)
  if type(args) ~= 'table' or type(args.citizenid) ~= 'string' or type(args.metric) ~= 'string' then
    print('[obey-feed] logMetric: bad args')
    return
  end
  -- Bridge's events route INSERTs into events_feed AND obey_metric_log
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

-- Startup banner + smoke-test event so the dashboard rail has something
-- visible the first time someone hits it. Comment out once real events flow.
print(('[obey-feed] loaded. Bridge: %s'):format(Config.BridgeUrl))

CreateThread(function()
  Wait(15000)
  pushEvent({
    kind = 'announcement',
    body = 'obey-feed online — events from PD / NHS / DOJ will appear here.',
  })
end)
