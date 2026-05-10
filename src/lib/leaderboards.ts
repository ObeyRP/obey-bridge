import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type LeaderboardKind =
  | "top-earner"
  | "most-arrests"
  | "longest-streak"
  | "top-donor"
  | "most-wanted"
  | "best-mechanic"
  | "hours-played";

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
  "hours-played",
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

  // All metric-driven boards read from events_feed (kind='metric:X', amount
  // in metadata.amount) — the FiveM side writes everything there via
  // obey-feed's logMetric() export. The legacy obey_metric_log table is
  // currently unused.
  const AMOUNT_SQL =
    "CAST(JSON_UNQUOTE(JSON_EXTRACT(l.metadata, '$.amount')) AS UNSIGNED)";

  switch (kind) {
    case "top-earner": {
      // 'earnings' metric — FiveM scripts log earnings per shift / job.
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(${AMOUNT_SQL}) AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:earnings' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "most-arrests": {
      // amount is typically 1 per event but use SUM to be tolerant of
      // batched/multi-arrest events.
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(${AMOUNT_SQL}) AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:arrest' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "longest-streak": {
      // For 'all' time, use the canonical best-ever streak stored on the
      // player by the FiveM-side daily-streak tracker (players.metadata
      // .obey_streak_best). For windowed views, count distinct claim days
      // inside the window.
      if (window === "all") {
        const [rows] = await pool.query<Row[]>(
          `SELECT p.citizenid, p.charinfo, p.name,
                  COALESCE(
                    CAST(JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.obey_streak_best')) AS UNSIGNED),
                    0
                  ) AS metric
             FROM players p
            ORDER BY metric DESC
            LIMIT ?`,
          [limit],
        );
        return formatRow(rows);
      }
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, COUNT(DISTINCT DATE(l.occurred_at)) AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:streak_day' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "top-donor": {
      // Top Donor is the one board that doesn't depend on FiveM events —
      // it sums Tebex coin ledger rows directly. Kept as-is.
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
        `SELECT p.citizenid, p.charinfo, p.name, MAX(${AMOUNT_SQL}) AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:wanted_stars' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "best-mechanic": {
      // amount is typically 1 per event but use SUM for tolerance.
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(${AMOUNT_SQL}) AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:mechanic_repair' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
    case "hours-played": {
      // Sourced from events_feed kind='metric:playtime' rows (the FiveM
      // side pushes amount=5 every 5 min per online player). amount is in
      // minutes; DIV 60 gives whole hours.
      const [rows] = await pool.query<Row[]>(
        `SELECT p.citizenid, p.charinfo, p.name, SUM(${AMOUNT_SQL}) DIV 60 AS metric
           FROM events_feed l
           JOIN players p ON p.citizenid = l.actor_cid
          WHERE l.kind = 'metric:playtime' ${timeFilter}
          GROUP BY p.citizenid
         HAVING metric > 0
          ORDER BY metric DESC
          LIMIT ?`,
        [limit],
      );
      return formatRow(rows);
    }
  }
}
