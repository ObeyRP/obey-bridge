import pino from "pino";
import { config } from "./config.js";

// pino-pretty in dev for human-readable logs; raw JSON in prod for the
// log shipper to parse. Same pattern as src/logger.ts.
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(process.env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }
    : {}),
});
