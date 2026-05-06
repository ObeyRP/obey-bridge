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
};

function safeJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export async function getPlayer(citizenid: string): Promise<PlayerRow | null> {
  const [rows] = await pool.query<PlayerDbRow[]>(
    `SELECT citizenid, name, charinfo, money, job, gang,
            COALESCE(obey_coins, 0) AS obey_coins,
            last_logged_out
       FROM players
      WHERE citizenid = ?
      LIMIT 1`,
    [citizenid],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    citizenid: row.citizenid,
    name: row.name,
    charinfo: safeJson(row.charinfo, {}),
    money: safeJson(row.money, {}),
    job: safeJson(row.job, {}),
    ...(row.gang ? { gang: safeJson<NonNullable<PlayerRow["gang"]>>(row.gang, {}) } : {}),
    obey_coins: row.obey_coins ?? 0,
    last_logged_out: row.last_logged_out,
  };
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
