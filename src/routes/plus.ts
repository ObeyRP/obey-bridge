import { Router } from "express";
import { z } from "zod";
import {
  activatePlus,
  cancelPlus,
  endPlus,
  getPlusByDiscord,
} from "../lib/plus.js";

export const plusRouter = Router();

const DiscordIdParam = z.object({
  discord_id: z.string().regex(/^\d{15,21}$/),
});

plusRouter.get("/:discord_id", async (req, res, next) => {
  try {
    const parsed = DiscordIdParam.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-discord-id" });
      return;
    }
    const sub = await getPlusByDiscord(parsed.data.discord_id);
    if (!sub) {
      res.status(404).json({ error: "no-subscription" });
      return;
    }
    res.json(sub);
  } catch (err) {
    next(err);
  }
});

const ActivateBody = z.object({
  discord_id: z.string().regex(/^\d{15,21}$/),
  period: z.enum(["monthly", "annual"]),
  idempotency_key: z.string().min(8).max(128),
  source: z.string().max(32).default("tebex"),
});

plusRouter.post("/activate", async (req, res, next) => {
  try {
    const parsed = ActivateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    const result = await activatePlus({
      discordId: parsed.data.discord_id,
      period: parsed.data.period,
      idempotencyKey: parsed.data.idempotency_key,
      source: parsed.data.source,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const SimpleBody = z.object({
  discord_id: z.string().regex(/^\d{15,21}$/),
  source: z.string().max(32).default("tebex"),
});

plusRouter.post("/cancel", async (req, res, next) => {
  try {
    const parsed = SimpleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-body" });
      return;
    }
    const result = await cancelPlus({
      discordId: parsed.data.discord_id,
      source: parsed.data.source,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

plusRouter.post("/end", async (req, res, next) => {
  try {
    const parsed = SimpleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-body" });
      return;
    }
    const result = await endPlus({
      discordId: parsed.data.discord_id,
      source: parsed.data.source,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
