import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type PlayerRow = {
  citizenid: string;
  name: string;
  charinfo: { firstname?: string; lastname?: string } & Record<string, unknown>;
  money: { cash?: number; bank?: number; crypto?: number } & Record<string, number>;
  job: { name?: string; label?: string; grade?: { name?: string; level?: number } };
  gang?: { name?: string; label?: string };
  obey_coins: number;
  last_logged_out: Date | null;
  /** Sum of metric='playtime' events from events_feed (minutes). */
  playtimeMinutes: number;
  /** Streak fields written by the FiveM-side daily-streak tracker into
   *  players.metadata. Defaults to { current: 0, best: 0 } for brand-new
   *  players who haven't logged in since the tracker shipped. */
  streak: { current: number; best: number };
};

type PlayerDbRow = RowDataPacket & {
  citizenid: string;
  name: string;
  charinfo: string;
  money: string;
  job: string;
  gang: string | null;
  obey_coins: number | null;
  last_logged_out: Date | null;
  streak_current: string | null;
  streak_best: string | null;
};

type PlaytimeDbRow = RowDataPacket & {
  playtime_minutes: string | number | null;
};

function safeJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function toFiniteInt(input: string | number | null | undefined): number {
  if (input == null) return 0;
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export async function getPlayer(citizenid: string): Promise<PlayerRow | null> {
  const [rows] = await pool.query<PlayerDbRow[]>(
    `SELECT citizenid, name, charinfo, money, job, gang,
            COALESCE(obey_coins, 0) AS obey_coins,
            last_logged_out,
            JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.obey_streak_current')) AS streak_current,
            JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.obey_streak_best'))    AS streak_best
       FROM players
      WHERE citizenid = ?
      LIMIT 1`,
    [citizenid],
  );
  const row = rows[0];
  if (!row) return null;

  // Separate query for playtime sum keeps us off a JOIN against events_feed
  // (which previously bit us on collation mismatches) and keeps the schema
  // unsurprising even if events_feed grows large.
  const [ptRows] = await pool.query<PlaytimeDbRow[]>(
    `SELECT COALESCE(
              SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.amount')) AS UNSIGNED)),
              0
            ) AS playtime_minutes
       FROM events_feed
      WHERE actor_cid = ?
        AND kind = 'metric:playtime'`,
    [citizenid],
  );

  return {
    citizenid: row.citizenid,
    name: row.name,
    charinfo: safeJson(row.charinfo, {}),
    money: safeJson(row.money, {}),
    job: safeJson(row.job, {}),
    ...(row.gang
      ? { gang: safeJson<NonNullable<PlayerRow["gang"]>>(row.gang, {}) }
      : {}),
    obey_coins: row.obey_coins ?? 0,
    last_logged_out: row.last_logged_out,
    playtimeMinutes: toFiniteInt(ptRows[0]?.playtime_minutes ?? 0),
    streak: {
      current: toFiniteInt(row.streak_current),
      best: toFiniteInt(row.streak_best),
    },
  };
}

/**
 * Resolve a Discord ID to its citizenid via players.discord_id, then return
 * the same shape getPlayer() returns. If the same discord_id has multiple
 * characters, the most recently logged-out one wins (same heuristic the
 * Plus webhook flow already uses).
 */
export async function getPlayerByDiscord(
  discordId: string,
): Promise<PlayerRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT citizenid FROM players
      WHERE discord_id = ?
      ORDER BY last_logged_out DESC
      LIMIT 1`,
    [discordId],
  );
  const cid = (rows[0] as { citizenid?: string } | undefined)?.citizenid;
  if (!cid) return null;
  return getPlayer(cid);
}

// Leaderboard helpers live in src/lib/leaderboards.ts (Phase 8). The bridge
// route at src/routes/leaderboard.ts imports from there.

export async function creditCoins(args: {
  citizenid: string;
  amount: number;
  source: string;
  idempotencyKey: string;
}): Promise<{ creditedAmount: number; newBalance: number; deduplicated: boolean }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [exists] = await conn.query<RowDataPacket[]>(
      `SELECT amount FROM obey_coin_ledger WHERE idempotency_key = ? LIMIT 1`,
      [args.idempotencyKey],
    );
    if (exists[0]) {
      const [bal] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(obey_coins, 0) AS bal FROM players WHERE citizenid = ? LIMIT 1`,
        [args.citizenid],
      );
      await conn.commit();
      return {
        creditedAmount: 0,
        newBalance: Number((bal[0] as { bal: number } | undefined)?.bal ?? 0),
        deduplicated: true,
      };
    }

    await conn.query(
      `INSERT INTO obey_coin_ledger (idempotency_key, citizenid, amount, source, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [args.idempotencyKey, args.citizenid, args.amount, args.source],
    );
    await conn.query(
      `UPDATE players SET obey_coins = COALESCE(obey_coins, 0) + ? WHERE citizenid = ?`,
      [args.amount, args.citizenid],
    );
    const [bal] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(obey_coins, 0) AS bal FROM players WHERE citizenid = ? LIMIT 1`,
      [args.citizenid],
    );

    await conn.commit();
    return {
      creditedAmount: args.amount,
      newBalance: Number((bal[0] as { bal: number } | undefined)?.bal ?? 0),
      deduplicated: false,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
