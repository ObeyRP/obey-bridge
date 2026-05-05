import { Router } from "express";
import { z } from "zod";
import { getLeaderboard, type LeaderboardType } from "../lib/players.js";

export const leaderboardRouter = Router();

const ParamsSchema = z.object({
  type: z.enum(["top-earner", "most-arrests", "longest-streak", "top-donor"]),
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

leaderboardRouter.get("/:type", async (req, res, next) => {
  try {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "bad-leaderboard-type" });
      return;
    }
    const query = QuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad-limit" });
      return;
    }
    const rows = await getLeaderboard(
      params.data.type as LeaderboardType,
      query.data.limit,
    );
    res.json({ type: params.data.type, rows });
  } catch (err) {
    next(err);
  }
});
