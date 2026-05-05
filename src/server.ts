import express, { type ErrorRequestHandler, type Request } from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { hmacAuth } from "./middleware/hmac.js";
import { healthzRouter } from "./routes/healthz.js";
import { serverRouter } from "./routes/server.js";
import { playerRouter } from "./routes/player.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { coinsRouter } from "./routes/coins.js";

const app = express();

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "64kb",
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

app.use("/healthz", healthzRouter);

app.use("/server", hmacAuth, serverRouter);
app.use("/player", hmacAuth, playerRouter);
app.use("/leaderboard", hmacAuth, leaderboardRouter);
app.use("/coins", hmacAuth, coinsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not-found", path: req.path });
});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err, path: req.path, method: req.method }, "request-error");
  res.status(500).json({ error: "internal" });
};
app.use(errorHandler);

app.listen(config.PORT, config.HOST, () => {
  logger.info(
    { host: config.HOST, port: config.PORT, env: config.NODE_ENV },
    "obey-bridge listening",
  );
});
