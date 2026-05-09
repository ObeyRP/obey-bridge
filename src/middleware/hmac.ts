import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Portal must sign every request with two headers:
 *   x-obey-timestamp: integer seconds since epoch
 *   x-obey-signature: HMAC-SHA256(secret, `${ts}.${method}.${path}.${rawBody}`) hex-encoded
 *
 * Replay protection: timestamps outside HMAC_MAX_SKEW_SECONDS are rejected.
 * Idempotency keys for write endpoints are enforced separately at the route level.
 */
export function hmacAuth(req: Request, res: Response, next: NextFunction): void {
  const ts = req.header("x-obey-timestamp");
  const sig = req.header("x-obey-signature");
  if (!ts || !sig) {
    res.status(401).json({ error: "missing-signature" });
    return;
  }

  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    res.status(401).json({ error: "bad-timestamp" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > config.HMAC_MAX_SKEW_SECONDS) {
    res.status(401).json({ error: "stale-timestamp" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
  // Use req.originalUrl so the signature payload matches what the portal
  // signed: it includes the full path (with the /forum, /whitelist, etc.
  // mount prefix that Express strips from req.path) AND the query string.
  const payload = `${ts}.${req.method.toUpperCase()}.${req.originalUrl}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", config.BRIDGE_SHARED_SECRET)
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    logger.warn({ ip: req.ip, path: req.path }, "HMAC signature mismatch");
    res.status(401).json({ error: "bad-signature" });
    return;
  }

  next();
}
