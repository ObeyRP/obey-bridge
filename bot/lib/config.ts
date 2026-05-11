import "dotenv/config";
import { z } from "zod";

// Bot env is loaded from the same .env the bridge uses (they live on the
// same VPS). Most fields are required to start the bot — except the
// notifier channel IDs which only kick in when P1 features ship.

const Schema = z.object({
  // Discord side
  DISCORD_BOT_TOKEN: z.string().min(20, {
    message:
      "DISCORD_BOT_TOKEN missing — copy from Discord Dev Portal → your app → Bot → Reset Token",
  }),
  DISCORD_GUILD_ID: z.string().regex(/^\d{15,21}$/, {
    message: "DISCORD_GUILD_ID must be a Discord snowflake (right-click guild → Copy ID)",
  }),
  DISCORD_ANNOUNCE_CHANNEL_ID: z.string().regex(/^\d{15,21}$/, {
    message:
      "DISCORD_ANNOUNCE_CHANNEL_ID must be a Discord snowflake (right-click #announcements → Copy ID)",
  }),

  // P1 notifier channels — optional, only enforced when those features ship.
  DISCORD_PLUS_CHANNEL_ID: z.string().regex(/^\d{15,21}$/).optional(),
  DISCORD_STAFF_APPS_CHANNEL_ID: z.string().regex(/^\d{15,21}$/).optional(),

  // Bridge side — bot talks loopback HMAC to obey-bridge.
  BRIDGE_URL: z.string().url().default("http://127.0.0.1:3030"),
  BRIDGE_SHARED_SECRET: z.string().min(32, {
    message:
      "BRIDGE_SHARED_SECRET must match the bridge's value (same .env, same key)",
  }),
  HMAC_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(60),

  // Logging
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

const parsed = Schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid obey-bot configuration:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
