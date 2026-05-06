import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../db.js";

export type AppStatus =
  | "pending"
  | "interview"
  | "approved"
  | "rejected"
  | "withdrawn";

export type ApplicationListRow = {
  id: number;
  role: string;
  applicant_discord_id: string;
  applicant_name: string;
  applicant_avatar: string | null;
  status: AppStatus;
  auto_screen_score: number;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_discord_id: string | null;
};

export type ApplicationDetail = ApplicationListRow & {
  payload: Record<string, unknown>;
  admin_notes: { author: string; body: string; at: string }[];
};

type DbRow = RowDataPacket & {
  id: number;
  role: string;
  applicant_discord_id: string;
  applicant_name: string;
  applicant_avatar: string | null;
  status: AppStatus;
  auto_screen_score: number;
  payload: string;
  admin_notes: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewer_discord_id: string | null;
};

function safeJson<T>(input: string | null, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function rowToDetail(r: DbRow): ApplicationDetail {
  return {
    id: r.id,
    role: r.role,
    applicant_discord_id: r.applicant_discord_id,
    applicant_name: r.applicant_name,
    applicant_avatar: r.applicant_avatar,
    status: r.status,
    auto_screen_score: r.auto_screen_score,
    payload: safeJson(r.payload, {}),
    admin_notes: safeJson(r.admin_notes, []),
    submitted_at: r.submitted_at.toISOString(),
    reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    reviewer_discord_id: r.reviewer_discord_id,
  };
}

export async function insertApplication(args: {
  role: string;
  applicant_discord_id: string;
  applicant_name: string;
  applicant_avatar: string | null;
  payload: Record<string, unknown>;
  auto_screen_score: number;
}): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO applications
       (role, applicant_discord_id, applicant_name, applicant_avatar,
        status, auto_screen_score, payload, admin_notes, submitted_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, JSON_ARRAY(), NOW())`,
    [
      args.role,
      args.applicant_discord_id,
      args.applicant_name,
      args.applicant_avatar,
      args.auto_screen_score,
      JSON.stringify(args.payload),
    ],
  );
  await pool.query(
    `INSERT INTO application_audit_log
       (application_id, actor_discord_id, action, details, created_at)
     VALUES (?, ?, 'submitted', ?, NOW())`,
    [
      result.insertId,
      args.applicant_discord_id,
      JSON.stringify({ auto_screen_score: args.auto_screen_score }),
    ],
  );
  return result.insertId;
}

export async function listApplications(args?: {
  status?: AppStatus;
  role?: string;
  limit?: number;
}): Promise<ApplicationListRow[]> {
  const wheres: string[] = [];
  const params: (string | number)[] = [];
  if (args?.status) {
    wheres.push("status = ?");
    params.push(args.status);
  }
  if (args?.role) {
    wheres.push("role = ?");
    params.push(args.role);
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const limit = Math.min(Math.max(args?.limit ?? 100, 1), 500);
  const [rows] = await pool.query<DbRow[]>(
    `SELECT id, role, applicant_discord_id, applicant_name, applicant_avatar,
            status, auto_screen_score, submitted_at, reviewed_at,
            reviewer_discord_id
       FROM applications
       ${whereSql}
       ORDER BY submitted_at DESC
       LIMIT ?`,
    [...params, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    applicant_discord_id: r.applicant_discord_id,
    applicant_name: r.applicant_name,
    applicant_avatar: r.applicant_avatar,
    status: r.status,
    auto_screen_score: r.auto_screen_score,
    submitted_at: r.submitted_at.toISOString(),
    reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    reviewer_discord_id: r.reviewer_discord_id,
  }));
}

export async function getApplication(id: number): Promise<ApplicationDetail | null> {
  const [rows] = await pool.query<DbRow[]>(
    `SELECT id, role, applicant_discord_id, applicant_name, applicant_avatar,
            status, auto_screen_score, payload, admin_notes,
            submitted_at, reviewed_at, reviewer_discord_id
       FROM applications WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? rowToDetail(row) : null;
}

export type DecisionAction = "approve" | "reject" | "interview" | "note";

const ACTION_TO_STATUS: Record<DecisionAction, AppStatus | null> = {
  approve: "approved",
  reject: "rejected",
  interview: "interview",
  note: null,
};

export async function applyDecision(args: {
  id: number;
  action: DecisionAction;
  note: string | undefined;
  reviewer_discord_id: string;
  reviewer_name: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query<DbRow[]>(
      `SELECT admin_notes FROM applications WHERE id = ? LIMIT 1 FOR UPDATE`,
      [args.id],
    );
    if (!rows[0]) {
      await conn.rollback();
      return { ok: false, reason: "not-found" };
    }

    const newNote = args.note
      ? {
          author: args.reviewer_name,
          body: args.note,
          at: new Date().toISOString(),
        }
      : null;

    const newStatus = ACTION_TO_STATUS[args.action];

    if (newStatus) {
      await conn.query(
        `UPDATE applications
            SET status = ?,
                reviewed_at = NOW(),
                reviewer_discord_id = ?,
                admin_notes = JSON_ARRAY_APPEND(
                  COALESCE(admin_notes, JSON_ARRAY()),
                  '$',
                  CAST(? AS JSON)
                )
          WHERE id = ?`,
        [
          newStatus,
          args.reviewer_discord_id,
          newNote ? JSON.stringify(newNote) : JSON.stringify({
            author: args.reviewer_name,
            body: `marked as ${newStatus}`,
            at: new Date().toISOString(),
          }),
          args.id,
        ],
      );
    } else if (newNote) {
      await conn.query(
        `UPDATE applications
            SET admin_notes = JSON_ARRAY_APPEND(
                  COALESCE(admin_notes, JSON_ARRAY()),
                  '$',
                  CAST(? AS JSON)
                )
          WHERE id = ?`,
        [JSON.stringify(newNote), args.id],
      );
    }

    await conn.query(
      `INSERT INTO application_audit_log
         (application_id, actor_discord_id, action, details, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        args.id,
        args.reviewer_discord_id,
        args.action,
        JSON.stringify({ note: args.note ?? null }),
      ],
    );

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
