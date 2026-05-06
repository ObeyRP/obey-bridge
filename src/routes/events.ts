import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const eventsRouter = Router();

type EventRow = RowDataPacket & {
  id: number;
  kind: string;
  actor_cid: string | null;
  subject_cid: string | null;
  body: string;
  metadata: string | null;
  occurred_at: Date;
};

type FeedEvent = {
  id: number;
  kind: string;
  actor_cid: string | null;
  subject_cid: string | null;
  body: string;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

function parseRow(r: EventRow): FeedEvent {
  let metadata: Record<string, unknown> | null = null;
  if (r.metadata) {
    try {
      metadata = JSON.parse(r.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: r.id,
    kind: r.kind,
    actor_cid: r.actor_cid,
    subject_cid: r.subject_cid,
    body: r.body,
    metadata,
    occurred_at: r.occurred_at.toISOString(),
  };
}

const RecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

eventsRouter.get("/recent", async (req, res, next) => {
  try {
    const parsed = RecentQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-query" });
      return;
    }
    const [rows] = await pool.query<EventRow[]>(
      `SELECT id, kind, actor_cid, subject_cid, body, metadata, occurred_at
         FROM events_feed
        ORDER BY id DESC
        LIMIT ?`,
      [parsed.data.limit],
    );
    res.json({ events: rows.map(parseRow) });
  } catch (err) {
    next(err);
  }
});

/**
 * SSE endpoint. Runs OUTSIDE the HMAC middleware (mounted directly on the
 * app in server.ts) because EventSource can't send custom headers.
 *
 * Stream format: each line is `data: {json}\n\n`. Client uses
 * EventSource() and parses event.data as JSON.
 */
eventsRouter.get("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  let lastSeenId = 0;

  function send(event: FeedEvent) {
    res.write(`id: ${event.id}\n`);
    res.write(`event: feed\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Replay the last 25 on connect so the dashboard gets context.
  try {
    const [rows] = await pool.query<EventRow[]>(
      `SELECT id, kind, actor_cid, subject_cid, body, metadata, occurred_at
         FROM events_feed
        ORDER BY id DESC
        LIMIT 25`,
    );
    const replay = rows.map(parseRow).reverse(); // oldest first
    for (const ev of replay) {
      send(ev);
      lastSeenId = Math.max(lastSeenId, ev.id);
    }
  } catch (err) {
    logger.error({ err }, "events/stream replay failed");
  }

  // Heartbeat every 20s so proxies don't kill the connection.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      cleanup();
    }
  }, 20_000);

  // Poll for new rows every 3s. Plenty fast for "within 5s on dashboard".
  const poll = setInterval(async () => {
    try {
      const [rows] = await pool.query<EventRow[]>(
        `SELECT id, kind, actor_cid, subject_cid, body, metadata, occurred_at
           FROM events_feed
          WHERE id > ?
          ORDER BY id ASC
          LIMIT 50`,
        [lastSeenId],
      );
      for (const r of rows) {
        const ev = parseRow(r);
        send(ev);
        lastSeenId = Math.max(lastSeenId, ev.id);
      }
    } catch (err) {
      logger.error({ err }, "events/stream poll failed");
    }
  }, 3_000);

  function cleanup() {
    clearInterval(heartbeat);
    clearInterval(poll);
    try {
      res.end();
    } catch {
      /* already closed */
    }
  }

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

const InsertBody = z.object({
  kind: z.string().min(1).max(48),
  actor_cid: z.string().max(64).optional(),
  subject_cid: z.string().max(64).optional(),
  body: z.string().min(1).max(512),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

eventsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = InsertBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    await pool.query(
      `INSERT INTO events_feed (kind, actor_cid, subject_cid, body, metadata, occurred_at)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), NOW())`,
      [
        parsed.data.kind,
        parsed.data.actor_cid ?? null,
        parsed.data.subject_cid ?? null,
        parsed.data.body,
        JSON.stringify(parsed.data.metadata ?? {}),
      ],
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
