import { Router } from "express";
import { z } from "zod";
import {
  addReply,
  createPost,
  deletePost,
  getPost,
  listPosts,
  patchPost,
  type PostStatus,
  type PostType,
} from "../lib/forum.js";

export const forumRouter = Router();

const ListQuery = z.object({
  type: z.enum(["suggestion", "announcement"]).optional(),
  status: z
    .enum([
      "open",
      "under-review",
      "approved",
      "rejected",
      "implemented",
      "moved-to-faq",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

forumRouter.get("/posts", async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-query" });
      return;
    }
    const rows = await listPosts({
      ...(parsed.data.type ? { type: parsed.data.type as PostType } : {}),
      ...(parsed.data.status ? { status: parsed.data.status as PostStatus } : {}),
      limit: parsed.data.limit,
    });
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

forumRouter.get("/posts/:id", async (req, res, next) => {
  try {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const post = await getPost(parsed.data.id);
    if (!post) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(post);
  } catch (err) {
    next(err);
  }
});

const CreateBody = z.object({
  type: z.enum(["suggestion", "announcement"]),
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(8000),
  author_discord_id: z.string().regex(/^\d{15,21}$/),
  author_name: z.string().min(1).max(120),
  author_avatar: z.string().url().nullable().optional().default(null),
  // Optional idempotency key. The Discord bot's announcements-sync handler
  // sends `discord-msg:<message-id>` so re-runs (bot restart, ratelimit
  // retries) don't dupe the forum.
  idempotency_key: z.string().min(1).max(128).optional(),
});

forumRouter.post("/posts", async (req, res, next) => {
  try {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    const result = await createPost({
      type: parsed.data.type,
      title: parsed.data.title,
      body: parsed.data.body,
      author_discord_id: parsed.data.author_discord_id,
      author_name: parsed.data.author_name,
      author_avatar: parsed.data.author_avatar ?? null,
      ...(parsed.data.idempotency_key
        ? { idempotency_key: parsed.data.idempotency_key }
        : {}),
    });
    // 201 for fresh creates, 200 for idempotent replays. Either way the
    // caller gets the id of the post they were trying to create.
    res
      .status(result.deduplicated ? 200 : 201)
      .json({ id: result.id, deduplicated: result.deduplicated });
  } catch (err) {
    next(err);
  }
});

const ReplyBody = z.object({
  body: z.string().min(1).max(8000),
  author_discord_id: z.string().regex(/^\d{15,21}$/),
  author_name: z.string().min(1).max(120),
  author_avatar: z.string().url().nullable().optional().default(null),
  is_staff: z.boolean().optional().default(false),
  staff_rank: z.string().max(64).nullable().optional(),
});

forumRouter.post("/posts/:id/replies", async (req, res, next) => {
  try {
    const idP = IdParam.safeParse(req.params);
    if (!idP.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const bodyP = ReplyBody.safeParse(req.body);
    if (!bodyP.success) {
      res.status(400).json({ error: "bad-body" });
      return;
    }
    const result = await addReply({
      post_id: idP.data.id,
      body: bodyP.data.body,
      author_discord_id: bodyP.data.author_discord_id,
      author_name: bodyP.data.author_name,
      author_avatar: bodyP.data.author_avatar ?? null,
      is_staff: bodyP.data.is_staff,
      staff_rank: bodyP.data.staff_rank ?? null,
    });
    if (!result.ok) {
      res
        .status(result.reason === "not-found" ? 404 : 409)
        .json({ error: result.reason });
      return;
    }
    res.status(201).json({ id: result.id });
  } catch (err) {
    next(err);
  }
});

const PatchBody = z.object({
  status: z
    .enum([
      "open",
      "under-review",
      "approved",
      "rejected",
      "implemented",
      "moved-to-faq",
    ])
    .optional(),
  locked: z.boolean().optional(),
  actor_discord_id: z.string().regex(/^\d{15,21}$/),
  actor_name: z.string().min(1).max(120),
});

const DeleteBody = z.object({
  actor_discord_id: z.string().regex(/^\d{15,21}$/),
  actor_name: z.string().min(1).max(120),
  actor_rank: z.string().max(64).optional(),
});

forumRouter.delete("/posts/:id", async (req, res, next) => {
  try {
    const idP = IdParam.safeParse(req.params);
    if (!idP.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const bodyP = DeleteBody.safeParse(req.body);
    if (!bodyP.success) {
      res
        .status(400)
        .json({ error: "bad-body", issues: bodyP.error.flatten() });
      return;
    }
    const result = await deletePost({
      post_id: idP.data.id,
      actor_discord_id: bodyP.data.actor_discord_id,
      actor_name: bodyP.data.actor_name,
      ...(bodyP.data.actor_rank ? { actor_rank: bodyP.data.actor_rank } : {}),
    });
    if (!result.ok) {
      res.status(404).json({ error: result.reason });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

forumRouter.patch("/posts/:id", async (req, res, next) => {
  try {
    const idP = IdParam.safeParse(req.params);
    if (!idP.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const bodyP = PatchBody.safeParse(req.body);
    if (!bodyP.success) {
      res.status(400).json({ error: "bad-body" });
      return;
    }
    const result = await patchPost({
      post_id: idP.data.id,
      ...(bodyP.data.status ? { status: bodyP.data.status as PostStatus } : {}),
      ...(typeof bodyP.data.locked === "boolean"
        ? { locked: bodyP.data.locked }
        : {}),
      actor_discord_id: bodyP.data.actor_discord_id,
      actor_name: bodyP.data.actor_name,
    });
    if (!result.ok) {
      res.status(404).json({ error: result.reason });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
