import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type PostType = "suggestion" | "announcement";
export type PostStatus =
  | "open"
  | "under-review"
  | "approved"
  | "rejected"
  | "implemented"
  | "moved-to-faq";

export type ForumPostRow = {
  id: number;
  type: PostType;
  title: string;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar: string | null;
  status: PostStatus;
  locked: boolean;
  created_at: string;
  updated_at: string;
  reply_count: number;
};

export type ForumReplyRow = {
  id: number;
  post_id: number;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar: string | null;
  is_staff: boolean;
  staff_rank: string | null;
  created_at: string;
};

export type ForumPostDetail = ForumPostRow & {
  replies: ForumReplyRow[];
};

type PostDbRow = RowDataPacket & {
  id: number;
  type: PostType;
  title: string;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar: string | null;
  status: PostStatus;
  locked: number;
  created_at: Date;
  updated_at: Date;
  reply_count: number;
};

type ReplyDbRow = RowDataPacket & {
  id: number;
  post_id: number;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar: string | null;
  is_staff: number;
  staff_rank: string | null;
  created_at: Date;
};

function toPost(r: PostDbRow): ForumPostRow {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    author_discord_id: r.author_discord_id,
    author_name: r.author_name,
    author_avatar: r.author_avatar,
    status: r.status,
    locked: !!r.locked,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    reply_count: r.reply_count,
  };
}

function toReply(r: ReplyDbRow): ForumReplyRow {
  return {
    id: r.id,
    post_id: r.post_id,
    body: r.body,
    author_discord_id: r.author_discord_id,
    author_name: r.author_name,
    author_avatar: r.author_avatar,
    is_staff: !!r.is_staff,
    staff_rank: r.staff_rank,
    created_at: r.created_at.toISOString(),
  };
}

export async function listPosts(args?: {
  type?: PostType;
  status?: PostStatus;
  limit?: number;
}): Promise<ForumPostRow[]> {
  const wheres: string[] = [];
  const params: (string | number)[] = [];
  if (args?.type) {
    wheres.push("p.type = ?");
    params.push(args.type);
  }
  if (args?.status) {
    wheres.push("p.status = ?");
    params.push(args.status);
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const limit = Math.min(Math.max(args?.limit ?? 50, 1), 200);
  const [rows] = await pool.query<PostDbRow[]>(
    `SELECT p.id, p.type, p.title, p.body, p.author_discord_id, p.author_name,
            p.author_avatar, p.status, p.locked, p.created_at, p.updated_at,
            COALESCE((SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id), 0) AS reply_count
       FROM forum_posts p
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ?`,
    [...params, limit],
  );
  return rows.map(toPost);
}

export async function getPost(id: number): Promise<ForumPostDetail | null> {
  const [rows] = await pool.query<PostDbRow[]>(
    `SELECT p.id, p.type, p.title, p.body, p.author_discord_id, p.author_name,
            p.author_avatar, p.status, p.locked, p.created_at, p.updated_at,
            COALESCE((SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id), 0) AS reply_count
       FROM forum_posts p WHERE p.id = ? LIMIT 1`,
    [id],
  );
  const post = rows[0];
  if (!post) return null;
  const [replyRows] = await pool.query<ReplyDbRow[]>(
    `SELECT id, post_id, body, author_discord_id, author_name, author_avatar,
            is_staff, staff_rank, created_at
       FROM forum_replies WHERE post_id = ? ORDER BY created_at ASC`,
    [id],
  );
  return { ...toPost(post), replies: replyRows.map(toReply) };
}

export async function createPost(args: {
  type: PostType;
  title: string;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar?: string | null;
  /** Optional idempotency key. If a post with this key already exists,
   *  the existing post's id is returned and no new row is written. The
   *  Discord bot uses `discord-msg:<message-id>` for this so a bot
   *  restart that re-sees old messages doesn't dupe the forum. */
  idempotency_key?: string | null;
}): Promise<{ id: number; deduplicated: boolean }> {
  const idemKey = args.idempotency_key ?? null;

  if (idemKey) {
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM forum_posts WHERE idempotency_key = ? LIMIT 1`,
      [idemKey],
    );
    const row = existing[0] as { id?: number } | undefined;
    if (row?.id) return { id: row.id, deduplicated: true };
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO forum_posts
       (type, title, body, author_discord_id, author_name, author_avatar,
        idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      args.type,
      args.title,
      args.body,
      args.author_discord_id,
      args.author_name,
      args.author_avatar ?? null,
      idemKey,
    ],
  );
  await pool.query(
    `INSERT INTO forum_audit_log
       (post_id, actor_discord_id, actor_name, action, details)
     VALUES (?, ?, ?, 'create', ?)`,
    [
      result.insertId,
      args.author_discord_id,
      args.author_name,
      JSON.stringify({ type: args.type, idempotency_key: idemKey }),
    ],
  );
  return { id: result.insertId, deduplicated: false };
}

export async function addReply(args: {
  post_id: number;
  body: string;
  author_discord_id: string;
  author_name: string;
  author_avatar?: string | null;
  is_staff?: boolean;
  staff_rank?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  // Don't allow replies on locked posts.
  const [post] = await pool.query<PostDbRow[]>(
    `SELECT id, locked FROM forum_posts WHERE id = ? LIMIT 1`,
    [args.post_id],
  );
  if (!post[0]) return { ok: false, reason: "not-found" };
  if (post[0].locked) return { ok: false, reason: "locked" };
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO forum_replies
       (post_id, body, author_discord_id, author_name, author_avatar, is_staff, staff_rank)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      args.post_id,
      args.body,
      args.author_discord_id,
      args.author_name,
      args.author_avatar ?? null,
      args.is_staff ? 1 : 0,
      args.staff_rank ?? null,
    ],
  );
  await pool.query(
    `INSERT INTO forum_audit_log
       (post_id, actor_discord_id, actor_name, action, details)
     VALUES (?, ?, ?, 'reply', ?)`,
    [
      args.post_id,
      args.author_discord_id,
      args.author_name,
      JSON.stringify({
        reply_id: result.insertId,
        is_staff: !!args.is_staff,
      }),
    ],
  );
  return { ok: true as const, id: result.insertId };
}

export async function patchPost(args: {
  post_id: number;
  status?: PostStatus;
  locked?: boolean;
  actor_discord_id: string;
  actor_name: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [exists] = await pool.query<PostDbRow[]>(
    `SELECT id FROM forum_posts WHERE id = ? LIMIT 1`,
    [args.post_id],
  );
  if (!exists[0]) return { ok: false, reason: "not-found" };

  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (args.status) {
    sets.push("status = ?");
    params.push(args.status);
  }
  if (typeof args.locked === "boolean") {
    sets.push("locked = ?");
    params.push(args.locked ? 1 : 0);
  }
  if (sets.length === 0) return { ok: true };

  await pool.query(
    `UPDATE forum_posts SET ${sets.join(", ")} WHERE id = ?`,
    [...params, args.post_id],
  );
  await pool.query(
    `INSERT INTO forum_audit_log
       (post_id, actor_discord_id, actor_name, action, details)
     VALUES (?, ?, ?, ?, ?)`,
    [
      args.post_id,
      args.actor_discord_id,
      args.actor_name,
      args.status ? "status" : args.locked ? "lock" : "unlock",
      JSON.stringify({
        ...(args.status ? { status: args.status } : {}),
        ...(typeof args.locked === "boolean" ? { locked: args.locked } : {}),
      }),
    ],
  );
  return { ok: true };
}
