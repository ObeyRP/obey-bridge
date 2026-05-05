import { Router } from "express";
import { z } from "zod";
import { getPlayer } from "../lib/players.js";

export const playerRouter = Router();

const ParamsSchema = z.object({
  citizenid: z.string().regex(/^[A-Z0-9]{1,16}$/i),
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
