import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type PlusPeriod = "monthly" | "annual";
export type PlusStatus = "active" | "cancellation_pending" | "ended";

export type PlusSubscription = {
  discord_id: string;
  citizenid: string | null;
  period: PlusPeriod;
  status: PlusStatus;
  started_at: string;
  renews_at: string | null;
  ends_at: string | null;
  cancelled_at: string | null;
  source: string;
};

type Row = RowDataPacket & {
  discord_id: string;
  citizenid: string | null;
  period: PlusPeriod;
  status: PlusStatus;
  started_at: Date;
  renews_at: Date | null;
  ends_at: Date | null;
  cancelled_at: Date | null;
  source: string;
};

export async function lookupCitizenIdByDiscord(
  discordId: string,
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT citizenid FROM players WHERE discord_id = ? ORDER BY last_logged_out DESC LIMIT 1`,
    [discordId],
  );
  const row = rows[0] as { citizenid?: string } | undefined;
  return row?.citizenid ?? null;
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export async function getPlusByDiscord(
  discordId: string,
): Promise<PlusSubscription | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT discord_id, citizenid, period, status,
            started_at, renews_at, ends_at, cancelled_at, source
       FROM obey_plus_subscriptions
      WHERE discord_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [discordId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    discord_id: r.discord_id,
    citizenid: r.citizenid,
    period: r.period,
    status: r.status,
    started_at: r.started_at.toISOString(),
    renews_at: isoOrNull(r.renews_at),
    ends_at: isoOrNull(r.ends_at),
    cancelled_at: isoOrNull(r.cancelled_at),
    source: r.source,
  };
}

function periodEnd(period: PlusPeriod, from: Date): Date {
  const d = new Date(from);
  if (period === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

async function logEvent(
  conn: import("mysql2/promise").PoolConnection,
  args: {
    idempotencyKey: string;
    discordId: string;
    event: string;
    details: unknown;
  },
): Promise<boolean> {
  try {
    await conn.query(
      `INSERT INTO obey_plus_event_log
         (idempotency_key, discord_id, event, details, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        args.idempotencyKey,
        args.discordId,
        args.event,
        JSON.stringify(args.details),
      ],
    );
    return true;
  } catch (err) {
    // Duplicate idempotency key — caller already handled this event.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") return false;
    throw err;
  }
}

export async function activatePlus(args: {
  discordId: string;
  period: PlusPeriod;
  idempotencyKey: string;
  source: string;
}): Promise<{ ok: true; deduplicated: boolean; subscription: PlusSubscription }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const inserted = await logEvent(conn, {
      idempotencyKey: args.idempotencyKey,
      discordId: args.discordId,
      event: "activate",
      details: { period: args.period, source: args.source },
    });
    if (!inserted) {
      const [rows] = await conn.query<Row[]>(
        `SELECT discord_id, citizenid, period, status, started_at, renews_at, ends_at, cancelled_at, source
           FROM obey_plus_subscriptions WHERE discord_id = ? ORDER BY id DESC LIMIT 1`,
        [args.discordId],
      );
      await conn.commit();
      const r = rows[0];
      return {
        ok: true,
        deduplicated: true,
        subscription: r
          ? {
              discord_id: r.discord_id,
              citizenid: r.citizenid,
              period: r.period,
              status: r.status,
              started_at: r.started_at.toISOString(),
              renews_at: isoOrNull(r.renews_at),
              ends_at: isoOrNull(r.ends_at),
              cancelled_at: isoOrNull(r.cancelled_at),
              source: r.source,
            }
          : {
              discord_id: args.discordId,
              citizenid: null,
              period: args.period,
              status: "active",
              started_at: new Date().toISOString(),
              renews_at: periodEnd(args.period, new Date()).toISOString(),
              ends_at: null,
              cancelled_at: null,
              source: args.source,
            },
      };
    }

    const now = new Date();
    const renewsAt = periodEnd(args.period, now);

    // Upsert: replace any existing row's status with active, push out renews_at.
    await conn.query(
      `INSERT INTO obey_plus_subscriptions
         (discord_id, period, status, started_at, renews_at, source, last_event)
       VALUES (?, ?, 'active', NOW(), ?, ?, 'activate')
       ON DUPLICATE KEY UPDATE
         status = 'active',
         period = VALUES(period),
         renews_at = VALUES(renews_at),
         ends_at = NULL,
         cancelled_at = NULL,
         source = VALUES(source),
         last_event = 'activate'`,
      [args.discordId, args.period, renewsAt, args.source],
    );

    const [rows] = await conn.query<Row[]>(
      `SELECT discord_id, citizenid, period, status, started_at, renews_at, ends_at, cancelled_at, source
         FROM obey_plus_subscriptions WHERE discord_id = ? ORDER BY id DESC LIMIT 1`,
      [args.discordId],
    );
    await conn.commit();

    const r = rows[0]!;
    return {
      ok: true,
      deduplicated: false,
      subscription: {
        discord_id: r.discord_id,
        citizenid: r.citizenid,
        period: r.period,
        status: r.status,
        started_at: r.started_at.toISOString(),
        renews_at: isoOrNull(r.renews_at),
        ends_at: isoOrNull(r.ends_at),
        cancelled_at: isoOrNull(r.cancelled_at),
        source: r.source,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function cancelPlus(args: {
  discordId: string;
  source: string;
}): Promise<{ ok: boolean }> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE obey_plus_subscriptions
        SET status = 'cancellation_pending',
            cancelled_at = NOW(),
            last_event = 'cancel',
            source = ?
      WHERE discord_id = ? AND status = 'active'`,
    [args.source, args.discordId],
  );
  return { ok: r.affectedRows > 0 };
}

export async function endPlus(args: {
  discordId: string;
  source: string;
}): Promise<{ ok: boolean }> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE obey_plus_subscriptions
        SET status = 'ended',
            ends_at = NOW(),
            last_event = 'end',
            source = ?
      WHERE discord_id = ? AND status IN ('active','cancellation_pending')`,
    [args.source, args.discordId],
  );
  return { ok: r.affectedRows > 0 };
}
