import { config } from "../config.js";
import { logger } from "../logger.js";

const BASE = `http://${config.FIVEM_HOST}:${config.FIVEM_PORT}`;

type PlayersJson = ReadonlyArray<{
  endpoint: string;
  id: number;
  identifiers: string[];
  name: string;
  ping: number;
}>;

type InfoJson = {
  vars: Record<string, string>;
  enhancedHostSupport?: boolean;
  resources?: string[];
  server?: string;
  version?: number;
};

let cache: { value: ServerStatus; expiresAt: number } | null = null;

export type ServerStatus = {
  online: number;
  max: number;
  queue: number;
  source: "fivem" | "fallback";
  fetchedAt: number;
};

export async function getServerStatus(): Promise<ServerStatus> {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.expiresAt > now) return cache.value;

  let online = 0;
  let max = 0;
  let queue = 0;
  let source: ServerStatus["source"] = "fivem";

  try {
    const [playersRes, infoRes] = await Promise.all([
      fetch(`${BASE}/players.json`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${BASE}/info.json`, { signal: AbortSignal.timeout(3000) }),
    ]);
    if (!playersRes.ok || !infoRes.ok) throw new Error("bad-fivem-response");
    const players = (await playersRes.json()) as PlayersJson;
    const info = (await infoRes.json()) as InfoJson;
    online = Array.isArray(players) ? players.length : 0;
    const maxVar =
      info.vars?.sv_maxClients ??
      info.vars?.sv_maxclients ??
      info.vars?.["sv_maxClients"];
    max = maxVar ? Number.parseInt(maxVar, 10) : 0;
  } catch (err) {
    logger.warn({ err }, "FiveM HTTP fetch failed; serving fallback");
    source = "fallback";
  }

  if (config.TX_ADMIN_URL) {
    try {
      const r = await fetch(`${config.TX_ADMIN_URL.replace(/\/$/, "")}/api/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const data = (await r.json()) as { queue?: number };
        queue = typeof data.queue === "number" ? data.queue : 0;
      }
    } catch (err) {
      logger.debug({ err }, "txAdmin status fetch failed");
    }
  }

  const value: ServerStatus = { online, max, queue, source, fetchedAt: now };
  cache = { value, expiresAt: now + config.SERVER_STATUS_CACHE_SECONDS };
  return value;
}
