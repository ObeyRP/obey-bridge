import { Router } from "express";
import { z } from "zod";
import { getPlayer, getPlayerByDiscord } from "../lib/players.js";

export const playerRouter = Router();

const ParamsSchema = z.object({
  citizenid: z.string().regex(/^[A-Z0-9]{1,16}$/i),
});

const DiscordParams = z.object({
  // Discord snowflakes are 17-20 digit numeric strings; allow 15-21 to be safe.
  discordId: z.string().regex(/^\d{15,21}$/),
});

// Discord-by-id route MUST be registered before /:citizenid, otherwise
// "by-discord" gets matched as a citizenid.
playerRouter.get("/by-discord/:discordId", async (req, res, next) => {
  try {
    const parsed = DiscordParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-discord-id" });
      return;
    }
    const player = await getPlayerByDiscord(parsed.data.discordId);
    if (!player) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(player);
  } catch (err) {
    next(err);
  }
});

playerRouter.get("/:citizenid", async (req, res, next) => {
  try {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "bad-citizenid" });
      return;
    }
    const player = await getPlayer(parsed.data.citizenid);
    if (!player) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(player);
  } catch (err) {
    next(err);
  }
});
