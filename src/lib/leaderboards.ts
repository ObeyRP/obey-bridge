import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type LeaderboardKind =
  | "top-earner"
  | "most-arrests"
  | "longest-streak"
  | "top-donor"
  | "most-wanted"
  | "best-mechanic";

export type LeaderboardWindow = "today" | "week" | "month" | "all";

export type LeaderboardRow = {
  rank: number;
  citizenid: string;
  display: string;
  metric: number;
};

export const LEADERBOARD_KINDS: readonly LeaderboardKind[] = [
  "top-earner",
  "most-arrests",
  "longest-streak",
  "top-donor",
  "most-wanted",
  "best-mechanic",
];

const WINDOW_TO_INTERVAL: Record<LeaderboardWindow, string | null> = {
  today: "INTERVAL 1 DAY",
  week: "INTERVAL 7 DAY",
  month: "INTERVAL 30 DAY",
  all: null,
};

type Row = RowDataPacket & {
  citizenid: string;
  charinfo?: string;
  name?: string;
  metric: string | number | null;
};

function formatRow(rows: Row[]): LeaderboardRow[] {
  return rows.map((r, i) => {
    const charinfo = (() => {
      try {
        return r.charinfo ? (JSON.parse(r.charinfo) as { firstname?: string; lastname?: string }) : {};
      } catch {
        return {};
      }
    })();
    const display =
      charinfo.firstname || charinfo.lastname
        ? `${charinfo.firstname ?? ""} ${charinfo.lastname ?? ""}`.trim()
        : (r.name ?? r.citizenid);
    return {
      rank: i + 1,
      citizenid: r.citizenid,
      display: display || r.citizenid,
      metric: Number(r.metric ?? 0),
    };
  });
}

function timeFilterFragment(window: LeaderboardWindow): {
  sql: string;
  joinNow: boolean;
} {
  const interval = WINDOW_TO_INTERVAL[window];
  if (!interval) return { sql: "", joinNow: false };
  return { sql: `AND l.occurred_at >= NOW() - ${interval}`, joinNow: true };
}

export async function getLeaderboard(
  kind: LeaderboardKind,
  window: LeaderboardWindow,
  limit: number,
): Promise<LeaderboardRow[]> {
  const { sql: timeFilter } = timeFilterFragment(window);

  switch (kind) {
    case "top-earner": {
      // 'earnings' metric — FiveM scripts log earnings per shift / job.
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(l.amount) AS metric
           FROM obey_metric_log l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.metric = 'earnings' ${timeFilter}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "most-arrests": {
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, COUNT(*) AS metric
           FROM obey_metric_log l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.metric = 'arrest' ${timeFilter}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "longest-streak": {
      // Streak is special — it's already a per-day counter so the time
      // filter is "best streak in the window" or just "current best
      // streak". We use best_streak from obey_metric_streak for "all"
      // and longest run within window for time-bound.
      if (window === "all") {
        const [rows] = await pool.query<Row[]>(
          `SELECT p.citizenid, p.charinfo, p.name, COALESCE(s.best_streak, 0) AS metric
             FROM players p
        LEFT JOIN obey_metric_streak s ON s.citizenid = p.citizenid
            ORDER BY metric DESC
            LIMIT ?`,
          [limit],
        );
        return formatRow(rows);
      }
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, COUNT(DISTINCT DATE(l.occurred_at)) AS metric
           FROM obey_metric_log l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.metric = 'streak_day' ${timeFilter}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "top-donor": {
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(l.amount) AS metric
           FROM obey_coin_ledger l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.source = 'tebex' ${timeFilter ? "AND l.created_at >= " + (window === "today" ? "NOW() - INTERVAL 1 DAY" : window === "week" ? "NOW() - INTERVAL 7 DAY" : "NOW() - INTERVAL 30 DAY") : ""}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "most-wanted": {
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, MAX(l.amount) AS metric
           FROM obey_metric_log l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.metric = 'wanted_stars' ${timeFilter}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "best-mechanic": {
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, COUNT(*) AS metric
           FROM obey_metric_log l
           JOIN players p ON p.citizenid = l.citizenid
          WHERE l.metric = 'mechanic_repair' ${timeFilter}
          GROUP BY p.citizenid
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
  }
}
