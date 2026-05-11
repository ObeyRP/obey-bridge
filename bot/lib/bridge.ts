import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * HMAC client for talking to obey-bridge from the bot process.
 *
 * Signing matches the bridge's middleware (src/middleware/hmac.ts):
 *   payload  = `${ts}.${METHOD}.${path}.${rawBody}`
 *   header   = HMAC-SHA256(secret, payload) hex-encoded
 *
 * Same shape obey-feed (Lua) and obey-portal (TS) already use — the bot
 * is just a third client of the same protocol.
 */

export class BridgeError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`bridge ${status}`);
  }
}

type FetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Override the path used in the signature payload. Defaults to the
   *  pathname of `path` (no query string). The bridge signs `originalUrl`
   *  which DOES include the query string, so callers passing one in
   *  `path` should leave this alone. */
  signaturePath?: string;
};

export async function bridgeFetch<T>(
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const rawBody = opts.body == null ? "" : JSON.stringify(opts.body);
  const ts = Math.floor(Date.now() / 1000).toString();

  // The bridge signs `req.originalUrl` which is whatever the client
  // requested — path + query string. We mirror that exactly: pass the
  // same `path` the URL uses to both the signature and the request.
  const sigPath = opts.signaturePath ?? path;
  const payload = `${ts}.${method}.${sigPath}.${rawBody}`;
  const sig = crypto
    .createHmac("sha256", config.BRIDGE_SHARED_SECRET)
    .update(payload)
    .digest("hex");

  const url = `${config.BRIDGE_URL.replace(/\/$/, "")}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      "x-obey-timestamp": ts,
      "x-obey-signature": sig,
    },
  };
  // Only attach body when there is one — exactOptionalPropertyTypes
  // forbids `body: undefined`, and GET requests must not carry a body.
  if (rawBody) {
    init.body = rawBody;
  }
  const res = await fetch(url, init);

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new BridgeError(res.status, body);
  }

  // 204 No Content is allowed; cast to unknown then to T.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
