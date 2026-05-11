import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { registerAnnouncementsSync } from "./handlers/announcements-sync.js";

// obey-bot — Phase 5 P0.
//
// One job for now: mirror staff messages in #announcements into the
// portal forum as `type='announcement'` rows. The portal /forum page
// renders them automatically. Slash commands (P1) and notifiers (P1)
// add to this once P0 is verified live.
//
// Lifecycle:
//   - boot: read env, connect to Discord gateway, register handlers
//   - SIGTERM / SIGINT: log, destroy client, exit 0 (systemd handles
//     restart)
//   - on unhandled rejection: log loudly and crash; systemd brings it
//     back up

async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // MESSAGE CONTENT is a Privileged Intent — must also be enabled in
      // the Discord Dev Portal (Bot tab → Privileged Gateway Intents).
      // Without it, msg.content is always an empty string.
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    // Helpful for messages that arrive before the channel cache is warm
    // (e.g. immediately after bot restart).
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", (c) => {
    logger.info(
      {
        botTag: c.user.tag,
        botId: c.user.id,
        guildId: config.DISCORD_GUILD_ID,
        announceChannelId: config.DISCORD_ANNOUNCE_CHANNEL_ID,
      },
      "obey-bot ready",
    );
  });

  client.on("error", (err) => {
    logger.error({ err }, "discord client error");
  });

  client.on("shardError", (err, shardId) => {
    logger.error({ err, shardId }, "discord shard error");
  });

  registerAnnouncementsSync(client);

  // Graceful shutdown — give systemd a clean exit and Discord a graceful
  // disconnect so we don't sit on a phantom presence.
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutting down");
    try {
      await client.destroy();
    } catch (err) {
      logger.error({ err }, "error during shutdown");
    }
    // Give the logger a tick to flush.
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Crash loudly on unhandled rejections so systemd restarts us into a
  // known-good state rather than silently breaking with a half-dead
  // gateway connection.
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "unhandled rejection");
    process.exit(1);
  });

  await client.login(config.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal startup error:", err);
  process.exit(1);
});
