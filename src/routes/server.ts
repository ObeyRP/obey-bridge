import { Router } from "express";
import { getServerStatus } from "../lib/fivem.js";

export const serverRouter = Router();

serverRouter.get("/status", async (_req, res, next) => {
  try {
    const status = await getServerStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});
