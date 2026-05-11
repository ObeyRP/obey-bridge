import type { Client, Message } from "discord.js";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { bridgeFetch, BridgeError } from "../lib/bridge.js";

/**
 * On every `messageCreate` in the configured #announcements channel,
 * mirror the message into the portal forum as `type='announcement'`.
 *
 * Idempotency: we send `discord-msg:<message-id>` as the idempotency_key
 * so a bot restart that re-sees old messages doesn't dupe. Bridge has a
 * unique index on the column (migration 0006).
 *
 * Skipped messages:
 *   - any message NOT in the configured channel
 *   - bots (including this bot's own — don't want feedback loops)
 *   - empty content (image-only posts; we'd produce a useless empty row)
 *   - system messages (joins, pins, etc.)
 */

export function registerAnnouncementsSync(client: Client): void {
  client.on("messageCreate", async (msg) => {
    if (msg.channelId !== config.DISCORD_ANNOUNCE_CHANNEL_ID) return;
    if (msg.author.bot) return;
    if (msg.system) return;
    if (!msg.content || msg.content.trim().length === 0) return;

    try {
      await syncMessageToForum(msg);
    } catch (err) {
      logger.error(
        { err, messageId: msg.id, authorId: msg.author.id },
        "announcements-sync failed",
      );
    }
  });

  logger.info(
    { channelId: config.DISCORD_ANNOUNCE_CHANNEL_ID },
    "announcements-sync registered",
  );
}

async function syncMessageToForum(msg: Message): Promise<void> {
  // Title = first line, capped. Body = full message content.
  // If the first line is huge (one-liner announcement), the title still
  // gets truncated to 80 chars and the body keeps the full text.
  const firstLine = msg.content.split(/\r?\n/)[0]?.trim() ?? "";
  const title =
    firstLine.length > 0
      ? firstLine.slice(0, 80)
      : "Announcement";

  // Bridge requires body to be at least 10 chars; pad short messages so
  // a one-liner doesn't 400.
  const body =
    msg.content.length >= 10
      ? msg.content
      : `${msg.content}\n\n_(via Discord #announcements)_`;

  // Prefer the server-side display name (nickname) over the global
  // username so the forum credit matches what staff use in Discord.
  const authorName = msg.member?.displayName ?? msg.author.username;
  const authorAvatar = msg.author.displayAvatarURL({ size: 256 }) ?? null;

  const result = await bridgeFetch<{ id: number; deduplicated: boolean }>(
    "/forum/posts",
    {
      method: "POST",
      body: {
        type: "announcement",
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
      "announcement already mirrored — skip",
    );
    return;
  }

  logger.info(
    {
      postId: result.id,
      messageId: msg.id,
      authorId: msg.author.id,
      authorName,
    },
    "announcement mirrored to forum",
  );

  // Best-effort reaction so staff can SEE the mirror landed in real-time
  // without having to switch to the website. Swallow errors — the post
  // already shipped, the reaction is cosmetic.
  try {
    await msg.react("✅");
  } catch (err) {
    logger.debug({ err }, "couldn't react to announcement (non-fatal)");
  }
}

/** Re-export so callers can match on it in error handling if they care. */
export { BridgeError };
