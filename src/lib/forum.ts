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
  upvotes: number;
  downvotes: number;
  /** -1 / 0 / 1 if the listing was fetched with a viewer; null otherwise. */
  my_vote: -1 | 0 | 1 | null;
};

export type VoteDirection = "up" | "down" | null;

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
  upvotes: number;
  downvotes: number;
  my_vote_raw?: number | null;
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
  const myVoteRaw = r.my_vote_raw;
  const myVote: -1 | 0 | 1 | null =
    myVoteRaw === undefined || myVoteRaw === null
      ? null
      : myVoteRaw > 0
        ? 1
        : myVoteRaw < 0
          ? -1
          : 0;
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
    upvotes: Number(r.upvotes ?? 0),
    downvotes: Number(r.downvotes ?? 0),
    my_vote: myVote,
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

/**
 * Vote-aggregation subquery snippet. Two correlated subqueries against
 * forum_post_votes — uses the (post_id, direction) selectivity from the
 * idx_post index, fast at our scale.
 */
const VOTE_SELECT = `
  COALESCE((SELECT COUNT(*) FROM forum_post_votes v WHERE v.post_id = p.id AND v.direction = 1),  0) AS upvotes,
  COALESCE((SELECT COUNT(*) FROM forum_post_votes v WHERE v.post_id = p.id AND v.direction = -1), 0) AS downvotes
`;

export async function listPosts(args?: {
  type?: PostType;
  status?: PostStatus;
  limit?: number;
  /** Discord ID of the viewer. If passed, each row's my_vote field is
   *  populated with that user's existing vote (or 0 if none). */
  viewer_discord_id?: string;
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

  // Build the my_vote subquery only when a viewer is passed — keeps the
  // anonymous-listing query simple and avoids an unused subquery.
  const viewerSelect = args?.viewer_discord_id
    ? ", (SELECT direction FROM forum_post_votes v WHERE v.post_id = p.id AND v.voter_discord_id = ? LIMIT 1) AS my_vote_raw"
    : "";
  const viewerParams: (string | number)[] = args?.viewer_discord_id
    ? [args.viewer_discord_id]
    : [];

  const [rows] = await pool.query<PostDbRow[]>(
    `SELECT p.id, p.type, p.title, p.body, p.author_discord_id, p.author_name,
            p.author_avatar, p.status, p.locked, p.created_at, p.updated_at,
            COALESCE((SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id), 0) AS reply_count,
            ${VOTE_SELECT}
            ${viewerSelect}
       FROM forum_posts p
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ?`,
    // viewer param has to be early because it's referenced in the SELECT clause.
    [...viewerParams, ...params, limit],
  );
  return rows.map(toPost);
}

export async function getPost(
  id: number,
  viewer_discord_id?: string,
): Promise<ForumPostDetail | null> {
  const viewerSelect = viewer_discord_id
    ? ", (SELECT direction FROM forum_post_votes v WHERE v.post_id = p.id AND v.voter_discord_id = ? LIMIT 1) AS my_vote_raw"
    : "";
  const viewerParams: (string | number)[] = viewer_discord_id
    ? [viewer_discord_id]
    : [];

  const [rows] = await pool.query<PostDbRow[]>(
    `SELECT p.id, p.type, p.title, p.body, p.author_discord_id, p.author_name,
            p.author_avatar, p.status, p.locked, p.created_at, p.updated_at,
            COALESCE((SELECT COUNT(*) FROM forum_replies r WHERE r.post_id = p.id), 0) AS reply_count,
            ${VOTE_SELECT}
            ${viewerSelect}
       FROM forum_posts p WHERE p.id = ? LIMIT 1`,
    [...viewerParams, id],
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

/**
 * Hard-delete a post. The forum_replies and forum_audit_log FK
 * constraints both cascade, so this also removes every reply and the
 * full audit history for the post.
 *
 * Heads-up: the audit-log cascade means we lose the moderation record
 * along with the post. To preserve at least *some* trail, we emit a
 * structured log line on the bridge process *before* firing the delete.
 * journalctl + Hetzner snapshots retain that for forensic lookup.
 *
 * Gated to Founder/Owner ranks at the portal layer (see
 * src/app/api/forum/posts/[id]/route.ts). The bridge does not
 * re-validate ranks — the HMAC+actor pair is trusted because only
 * portal can issue these requests.
 */
export async function deletePost(args: {
  post_id: number;
  actor_discord_id: string;
  actor_name: string;
  actor_rank?: string;
}): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const [exists] = await pool.query<PostDbRow[]>(
    `SELECT id, type, title, author_discord_id, author_name
       FROM forum_posts WHERE id = ? LIMIT 1`,
    [args.post_id],
  );
  const row = exists[0];
  if (!row) return { ok: false, reason: "not-found" };

  // Forensic line — the only record that survives the cascade.
  // Format is JSON-ish so it greps cleanly out of journalctl.
  // eslint-disable-next-line no-console
  console.log(
    `[forum.deletePost] HARD DELETE ${JSON.stringify({
      post_id: args.post_id,
      type: row.type,
      title: row.title,
      original_author_discord_id: row.author_discord_id,
      original_author_name: row.author_name,
      actor_discord_id: args.actor_discord_id,
      actor_name: args.actor_name,
      actor_rank: args.actor_rank ?? null,
      at: new Date().toISOString(),
    })}`,
  );

  // CASCADEs: forum_replies (fk_forum_reply_post) and
  // forum_audit_log (fk_forum_audit_post) both go away with the row.
  await pool.query(`DELETE FROM forum_posts WHERE id = ?`, [args.post_id]);
  return { ok: true };
}

/**
 * Set / change / remove a viewer's vote on a post. Direction:
 *   - "up"   = insert/update to +1
 *   - "down" = insert/update to -1
 *   - null   = delete the row (un-vote)
 *
 * Returns the post's current vote totals + the viewer's resulting vote
 * so the UI can render the new state without a second round-trip.
 *
 * Rejects votes on:
 *   - posts that don't exist
 *   - announcement-type posts (suggestions only — announcements are
 *     one-way and shouldn't be a popularity contest)
 *   - locked posts (lock means "no further engagement")
 */
export async function setVote(args: {
  post_id: number;
  voter_discord_id: string;
  direction: VoteDirection;
}): Promise<
  | {
      ok: true;
      upvotes: number;
      downvotes: number;
      my_vote: -1 | 0 | 1;
    }
  | { ok: false; reason: "not-found" | "wrong-type" | "locked" }
> {
  const [posts] = await pool.query<PostDbRow[]>(
    `SELECT id, type, locked FROM forum_posts WHERE id = ? LIMIT 1`,
    [args.post_id],
  );
  const post = posts[0];
  if (!post) return { ok: false, reason: "not-found" };
  if (post.type !== "suggestion") return { ok: false, reason: "wrong-type" };
  if (post.locked) return { ok: false, reason: "locked" };

  if (args.direction === null) {
    await pool.query(
      `DELETE FROM forum_post_votes WHERE post_id = ? AND voter_discord_id = ?`,
      [args.post_id, args.voter_discord_id],
    );
  } else {
    const dir = args.direction === "up" ? 1 : -1;
    // ON DUPLICATE KEY UPDATE handles both "first vote" and "change
    // direction" in a single round-trip. UNIQUE (post_id, voter_id)
    // is what makes the duplicate-key path fire.
    await pool.query(
      `INSERT INTO forum_post_votes (post_id, voter_discord_id, direction)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE direction = VALUES(direction)`,
      [args.post_id, args.voter_discord_id, dir],
    );
  }

  // Re-read totals and the viewer's current vote in one query each.
  const [counts] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction =  1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN direction = -1 THEN 1 ELSE 0 END), 0) AS downvotes
     FROM forum_post_votes WHERE post_id = ?`,
    [args.post_id],
  );
  const c = counts[0] as { upvotes: number; downvotes: number } | undefined;
  const my_vote: -1 | 0 | 1 =
    args.direction === "up" ? 1 : args.direction === "down" ? -1 : 0;

  return {
    ok: true,
    upvotes: Number(c?.upvotes ?? 0),
    downvotes: Number(c?.downvotes ?? 0),
    my_vote,
  };
}
