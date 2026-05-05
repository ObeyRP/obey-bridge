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

export type LeaderboardType =
  | "top-earner"
  | "most-arrests"
  | "longest-streak"
  | "top-donor";

export type LeaderboardRow = {
  rank: number;
  citizenid: string;
  display: string;
  metric: number;
};

const LEADERBOARD_SQL: Record<LeaderboardType, string> = {
  "top-earner": `
    SELECT citizenid, name,
           CAST(JSON_EXTRACT(money, '$.bank') AS UNSIGNED) AS metric
      FROM players
     ORDER BY metric DESC
     LIMIT ?`,
  "top-donor": `
    SELECT citizenid, name, COALESCE(obey_coins, 0) AS metric
      FROM players
     ORDER BY metric DESC
     LIMIT ?`,
  "most-arrests": `
    SELECT p.citizenid, p.name, COALESCE(SUM(a.count), 0) AS metric
      FROM players p
 LEFT JOIN obey_metric_arrests a ON a.citizenid = p.citizenid
  GROUP BY p.citizenid
  ORDER BY metric DESC
     LIMIT ?`,
  "longest-streak": `
    SELECT p.citizenid, p.name, COALESCE(s.best_streak, 0) AS metric
      FROM players p
 LEFT JOIN obey_metric_streak s ON s.citizenid = p.citizenid
  ORDER BY metric DESC
     LIMIT ?`,
};

type LeaderboardDbRow = RowDataPacket & {
  citizenid: string;
  name: string;
  metric: string | number | null;
};

export async function getLeaderboard(
  type: LeaderboardType,
  limit = 10,
): Promise<LeaderboardRow[]> {
  const sql = LEADERBOARD_SQL[type];
  const [rows] = await pool.query<LeaderboardDbRow[]>(sql, [limit]);
  return rows.map((r, i) => {
    const charinfo = safeJson<{ firstname?: string; lastname?: string }>(
      (r as unknown as { charinfo?: string }).charinfo ?? "",
      {},
    );
    const display =
      charinfo.firstname || charinfo.lastname
        ? `${charinfo.firstname ?? ""} ${charinfo.lastname ?? ""}`.trim()
        : r.name;
    return {
      rank: i + 1,
      citizenid: r.citizenid,
      display: display || r.citizenid,
      metric: Number(r.metric ?? 0),
    };
  });
}

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
