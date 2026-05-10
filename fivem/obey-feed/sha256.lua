-- Pure-Lua SHA-256 + HMAC-SHA-256 for FiveM (Lua 5.4 / CitizenFX).
--
-- Used by obey-feed to sign requests to obey-bridge identically to how
-- obey-portal signs them in Node:
--   sig = HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${rawBody}`).hex()
--
-- Self-contained, no external dependencies, ~80 lines of cryptographic
-- primitives. Unit-tested against the standard FIPS-180 test vectors and
-- against Node's `crypto.createHmac("sha256", k).update(m).digest("hex")`
-- before shipping.

local K = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}

local MASK = 0xffffffff

local function rrot(n, b)
  return ((n >> b) | (n << (32 - b))) & MASK
end

-- Returns h0..h7 as eight 32-bit numbers (the SHA-256 state).
local function sha256_state(msg)
  local h0, h1, h2, h3, h4, h5, h6, h7 =
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19

  local len = #msg
  local bitLen = len * 8

  -- Pad: append 0x80, then zeros, then 64-bit big-endian bit length.
  msg = msg .. string.char(0x80)
  while (#msg % 64) ~= 56 do
    msg = msg .. "\0"
  end
  for i = 7, 0, -1 do
    msg = msg .. string.char((bitLen >> (i * 8)) & 0xff)
  end

  for chunkStart = 1, #msg, 64 do
    local w = {}
    for i = 0, 15 do
      local b = chunkStart + i * 4
      w[i + 1] =
        (string.byte(msg, b) << 24) |
        (string.byte(msg, b + 1) << 16) |
        (string.byte(msg, b + 2) << 8) |
        string.byte(msg, b + 3)
    end
    for i = 17, 64 do
      local s0 = rrot(w[i - 15], 7) ~ rrot(w[i - 15], 18) ~ (w[i - 15] >> 3)
      local s1 = rrot(w[i - 2], 17) ~ rrot(w[i - 2], 19) ~ (w[i - 2] >> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK
    end

    local a, b, c, d, e, f, g, h = h0, h1, h2, h3, h4, h5, h6, h7
    for i = 1, 64 do
      local S1 = rrot(e, 6) ~ rrot(e, 11) ~ rrot(e, 25)
      local ch = (e & f) ~ ((~e) & g & MASK)
      local temp1 = (h + S1 + ch + K[i] + w[i]) & MASK
      local S0 = rrot(a, 2) ~ rrot(a, 13) ~ rrot(a, 22)
      local maj = (a & b) ~ (a & c) ~ (b & c)
      local temp2 = (S0 + maj) & MASK
      h = g
      g = f
      f = e
      e = (d + temp1) & MASK
      d = c
      c = b
      b = a
      a = (temp1 + temp2) & MASK
    end

    h0 = (h0 + a) & MASK
    h1 = (h1 + b) & MASK
    h2 = (h2 + c) & MASK
    h3 = (h3 + d) & MASK
    h4 = (h4 + e) & MASK
    h5 = (h5 + f) & MASK
    h6 = (h6 + g) & MASK
    h7 = (h7 + h) & MASK
  end

  return h0, h1, h2, h3, h4, h5, h6, h7
end

local function sha256_hex(msg)
  local h0, h1, h2, h3, h4, h5, h6, h7 = sha256_state(msg)
  return string.format("%08x%08x%08x%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4, h5, h6, h7)
end

local function sha256_bytes(msg)
  local h = { sha256_state(msg) }
  local out = {}
  for i = 1, 8 do
    local v = h[i]
    out[i] = string.char((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
  end
  return table.concat(out)
end

-- HMAC-SHA-256, returns hex digest.
local function hmac_sha256_hex(key, msg)
  local BLOCK = 64
  if #key > BLOCK then
    key = sha256_bytes(key)
  end
  if #key < BLOCK then
    key = key .. string.rep("\0", BLOCK - #key)
  end
  local opad, ipad = {}, {}
  for i = 1, BLOCK do
    local k = string.byte(key, i)
    opad[i] = string.char(k ~ 0x5c)
    ipad[i] = string.char(k ~ 0x36)
  end
  local inner = sha256_bytes(table.concat(ipad) .. msg)
  return sha256_hex(table.concat(opad) .. inner)
end

return {
  sha256_hex = sha256_hex,
  hmac_sha256_hex = hmac_sha256_hex,
}
