import { Router } from "express";
import { z } from "zod";
import {
  getLeaderboard,
  LEADERBOARD_KINDS,
  type LeaderboardKind,
  type LeaderboardWindow,
} from "../lib/leaderboards.js";

export const leaderboardRouter = Router();

const ParamsSchema = z.object({
  type: z.enum([
    "top-earner",
    "most-arrests",
    "longest-streak",
    "top-donor",
    "most-wanted",
    "best-mechanic",
  ]),
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  window: z.enum(["today", "week", "month", "all"]).optional().default("all"),
});

leaderboardRouter.get("/", (_req, res) => {
  res.json({ kinds: LEADERBOARD_KINDS, windows: ["today", "week", "month", "all"] });
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
      res.status(400).json({ error: "bad-query" });
      return;
    }
    const rows = await getLeaderboard(
      params.data.type as LeaderboardKind,
      query.data.window as LeaderboardWindow,
      query.data.limit,
    );
    res.json({
      type: params.data.type,
      window: query.data.window,
      rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
