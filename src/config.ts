import "dotenv/config";
import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3030),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  BRIDGE_SHARED_SECRET: z.string().min(32, {
    message: "BRIDGE_SHARED_SECRET must be at least 32 characters",
  }),
  HMAC_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(60),

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default("qbx_core"),

  FIVEM_HOST: z.string().default("127.0.0.1"),
  FIVEM_PORT: z.coerce.number().int().positive().default(30120),
  TX_ADMIN_URL: z.string().optional().default(""),

  SERVER_STATUS_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(15),
});

const parsed = Schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid bridge configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
