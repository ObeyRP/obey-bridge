import fs from "node:fs/promises";
import path from "node:path";
import { Client, EmbedBuilder, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";

// One-shot: read bot/content/rebrand.md, build an embed from it, post
// it to the configured announce channel, then exit.
//
//   npm run bot:rebrand             — refuses to run if already posted
//   npm run bot:rebrand -- --force  — post anyway (use after editing copy)
//
// "Already posted" is detected by scanning the channel's recent
// messages for one authored by THIS bot with the same H1 title.
// Cheap, correct, and doesn't need a new DB column.

// Read the markdown from source, not from dist/ — tsc doesn't copy
// non-TS files. The bot's systemd unit and `npm run bot:rebrand` both
// start with cwd = repo root, so this resolves consistently.
const contentPath = path.resolve(process.cwd(), "bot", "content", "rebrand.md");

const FORCE = process.argv.includes("--force");

function parseMarkdown(md: string): {
  title: string;
  body: string;
  footer: string | null;
} {
  const lines = md.split(/\r?\n/);
  const headingIndex = lines.findIndex((l) => /^#\s/.test(l));
  const title =
    headingIndex >= 0
      ? lines[headingIndex]!.replace(/^#\s+/, "").trim()
      : "Announcement";

  // Strip the blockquote preamble (the editor note at the top) and the
  // separator line. Everything between the first H1 and the final
  // "— signature" line is the body.
  const afterH1 = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines;
  const cleaned = afterH1
    .filter((l) => !/^>\s/.test(l))
    .filter((l) => !/^---\s*$/.test(l))
    .join("\n")
    .trim();

  // Pull the final "— signature" line out as the embed footer.
  const sigMatch = cleaned.match(/\n+—\s*([^\n]+)\s*$/);
  const footer = sigMatch ? sigMatch[1]!.trim() : null;
  const body = sigMatch
    ? cleaned.slice(0, sigMatch.index).trim()
    : cleaned;

  return { title, body, footer };
}

async function main(): Promise<void> {
  const md = await fs.readFile(contentPath, "utf8");
  const { title, body, footer } = parseMarkdown(md);

  if (body.length > 4096) {
    throw new Error(
      `rebrand body is ${body.length} chars; Discord embed description maxes at 4096`,
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(config.DISCORD_BOT_TOKEN);
  await new Promise<void>((resolve) => client.once("ready", () => resolve()));

  const channel = await client.channels.fetch(
    config.DISCORD_ANNOUNCE_CHANNEL_ID,
  );
  if (!channel || !channel.isTextBased() || !(channel instanceof TextChannel)) {
    throw new Error(
      `DISCORD_ANNOUNCE_CHANNEL_ID (${config.DISCORD_ANNOUNCE_CHANNEL_ID}) is not a text channel this bot can reach`,
    );
  }

  if (!FORCE) {
    const recent = await channel.messages.fetch({ limit: 50 });
    const botId = client.user?.id;
    const already = recent.find(
      (m) =>
        m.author.id === botId &&
        m.embeds.some((e) => e.title?.trim() === title),
    );
    if (already) {
      logger.warn(
        { messageId: already.id, channel: channel.name, title },
        "rebrand announce already posted — refusing to dupe (pass --force to override)",
      );
      await client.destroy();
      process.exit(0);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(body)
    .setColor(0x4fc3f7); // Obey ice blue.
  if (footer) embed.setFooter({ text: footer });

  const sent = await channel.send({ embeds: [embed] });
  logger.info(
    { messageId: sent.id, channel: channel.name, title },
    "rebrand announce posted",
  );

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("rebrand script failed:", err);
  process.exit(1);
});
