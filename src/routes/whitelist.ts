import { Router } from "express";
import { z } from "zod";
import {
  applyDecision,
  getApplication,
  insertApplication,
  listApplications,
  type AppStatus,
} from "../lib/applications.js";

export const whitelistRouter = Router();

const InsertBody = z.object({
  role: z.string().min(1).max(64),
  applicant_discord_id: z.string().regex(/^\d{15,21}$/),
  applicant_name: z.string().min(1).max(120),
  applicant_avatar: z.string().url().nullable().optional().default(null),
  payload: z.record(z.string(), z.unknown()),
  auto_screen_score: z.number().int().min(0).max(100),
});

whitelistRouter.post("/", async (req, res, next) => {
  try {
    const parsed = InsertBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    const id = await insertApplication({
      role: parsed.data.role,
      applicant_discord_id: parsed.data.applicant_discord_id,
      applicant_name: parsed.data.applicant_name,
      applicant_avatar: parsed.data.applicant_avatar ?? null,
      payload: parsed.data.payload,
      auto_screen_score: parsed.data.auto_screen_score,
    });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

const ListQuery = z.object({
  status: z
    .enum(["pending", "interview", "approved", "rejected", "withdrawn"])
    .optional(),
  role: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

whitelistRouter.get("/", async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-query" });
      return;
    }
    const rows = await listApplications({
      ...(parsed.data.status ? { status: parsed.data.status as AppStatus } : {}),
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      limit: parsed.data.limit,
    });
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

whitelistRouter.get("/:id", async (req, res, next) => {
  try {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const app = await getApplication(parsed.data.id);
    if (!app) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(app);
  } catch (err) {
    next(err);
  }
});

const DecisionBody = z.object({
  action: z.enum(["approve", "reject", "interview", "note"]),
  note: z.string().min(1).max(2000).optional(),
  reviewer_discord_id: z.string().regex(/^\d{15,21}$/),
  reviewer_name: z.string().min(1).max(120),
});

whitelistRouter.post("/:id", async (req, res, next) => {
  try {
    const idP = IdParam.safeParse(req.params);
    if (!idP.success) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const bodyP = DecisionBody.safeParse(req.body);
    if (!bodyP.success) {
      res
        .status(400)
        .json({ error: "bad-body", issues: bodyP.error.flatten() });
      return;
    }
    const result = await applyDecision({
      id: idP.data.id,
      action: bodyP.data.action,
      note: bodyP.data.note,
      reviewer_discord_id: bodyP.data.reviewer_discord_id,
      reviewer_name: bodyP.data.reviewer_name,
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
