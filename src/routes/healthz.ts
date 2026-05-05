import { Router } from "express";
import { pingDb } from "../db.js";

export const healthzRouter = Router();

healthzRouter.get("/", async (_req, res) => {
  const dbOk = await pingDb();
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: "obey-bridge",
    version: process.env.npm_package_version ?? "0.1.0",
  });
});
