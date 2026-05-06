Config = {}

-- HTTP endpoint of obey-bridge (same machine usually).
Config.BridgeUrl = GetConvar('obey_bridge_url', 'http://127.0.0.1:3030')

-- Shared secret. MUST match BRIDGE_SHARED_SECRET in obey-bridge/.env.
-- Set via `setr obey_bridge_secret "<hex>"` in your server.cfg, NEVER commit
-- the literal value.
Config.BridgeSecret = GetConvar('obey_bridge_secret', '')

-- Allowed clock skew vs. obey-bridge's HMAC_MAX_SKEW_SECONDS (default 60).
Config.HmacSkewSeconds = 60

-- Optional: enable verbose console logging.
Config.Debug = GetConvarInt('obey_feed_debug', 0) == 1
