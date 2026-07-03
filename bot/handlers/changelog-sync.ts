import type { Client, Message } from "discord.js";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { bridgeFetch } from "../lib/bridge.js";

/**
 * On every `messageCreate` in the configured #changelog channel, mirror
 * the message into the portal forum as `type='changelog'`. These render
 * on the /changelog page. Same one-way, idempotent pattern as
 * announcements-sync (Discord is the source of truth; site edits don't
 * push back).
 *
 * Skipped messages: not-the-channel, bots, system messages, empty content.
 */
export function registerChangelogSync(client: Client): void {
  // No-op if the changelog channel isn't configured — lets servers run
  // the bot without the changelog feature until they set the env var.
  if (!config.DISCORD_CHANGELOG_CHANNEL_ID) {
    logger.info("changelog-sync skipped — DISCORD_CHANGELOG_CHANNEL_ID unset");
    return;
  }

  client.on("messageCreate", async (msg) => {
    if (msg.channelId !== config.DISCORD_CHANGELOG_CHANNEL_ID) return;
    if (msg.author.bot) return;
    if (msg.system) return;
    if (!msg.content || msg.content.trim().length === 0) return;

    try {
      await syncMessageToChangelog(msg);
    } catch (err) {
      logger.error(
        { err, messageId: msg.id, authorId: msg.author.id },
        "changelog-sync failed",
      );
    }
  });

  logger.info(
    { channelId: config.DISCORD_CHANGELOG_CHANNEL_ID },
    "changelog-sync registered",
  );
}

async function syncMessageToChangelog(msg: Message): Promise<void> {
  const firstLine = msg.content.split(/\r?\n/)[0]?.trim() ?? "";
  const title = firstLine.length > 0 ? firstLine.slice(0, 80) : "Update";

  const body =
    msg.content.length >= 10
      ? msg.content
      : `${msg.content}\n\n_(via Discord #changelog)_`;

  const authorName = msg.member?.displayName ?? msg.author.username;
  const authorAvatar = msg.author.displayAvatarURL({ size: 256 }) ?? null;

  const result = await bridgeFetch<{ id: number; deduplicated: boolean }>(
    "/forum/posts",
    {
      method: "POST",
      body: {
        type: "changelog",
        title,
        body,
        author_discord_id: msg.author.id,
        author_name: authorName,
        author_avatar: authorAvatar,
        idempotency_key: `discord-msg:${msg.id}`,
      },
    },
  );

  if (result.deduplicated) {
    logger.debug(
      { postId: result.id, messageId: msg.id },
      "changelog already mirrored — skip",
    );
    return;
  }

  logger.info(
    { postId: result.id, messageId: msg.id, authorName },
    "changelog mirrored to site",
  );

  try {
    await msg.react("📝");
  } catch (err) {
    logger.debug({ err }, "couldn't react to changelog message (non-fatal)");
  }
}
