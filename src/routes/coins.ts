import { Router } from "express";
import { z } from "zod";
import { creditCoins } from "../lib/players.js";
import { lookupCitizenIdByDiscord } from "../lib/plus.js";

export const coinsRouter = Router();

const Body = z.object({
  citizenid: z.string().regex(/^[A-Z0-9]{1,16}$/i),
  amount: z.number().int().positive().max(1_000_000),
  source: z.enum(["tebex", "daily", "manual", "promo"]),
  idempotency_key: z.string().min(8).max(128),
});

coinsRouter.post("/credit", async (req, res, next) => {
  try {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    const result = await creditCoins({
      citizenid: parsed.data.citizenid,
      amount: parsed.data.amount,
      source: parsed.data.source,
      idempotencyKey: parsed.data.idempotency_key,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const DiscordCreditBody = z.object({
  discord_id: z.string().regex(/^\d{15,21}$/),
  amount: z.number().int().positive().max(1_000_000),
  source: z.enum(["tebex", "daily", "manual", "promo"]),
  idempotency_key: z.string().min(8).max(128),
});

coinsRouter.post("/credit-by-discord", async (req, res, next) => {
  try {
    const parsed = DiscordCreditBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-body", issues: parsed.error.flatten() });
      return;
    }
    const citizenid = await lookupCitizenIdByDiscord(parsed.data.discord_id);
    if (!citizenid) {
      res.status(404).json({
        error: "discord-not-linked",
        detail:
          "No qbx_core player found with this discord_id. Player needs to log into the FiveM server first.",
      });
      return;
    }
    const result = await creditCoins({
      citizenid,
      amount: parsed.data.amount,
      source: parsed.data.source,
      idempotencyKey: parsed.data.idempotency_key,
    });
    res.json({ ...result, citizenid });
  } catch (err) {
    next(err);
  }
});
