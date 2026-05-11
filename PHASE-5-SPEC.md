# Phase 5 — Discord bot

The last unbuilt phase from the original plan. Ships the bridge between
Discord-server activity and the obey-portal forum, plus a few operational
nice-to-haves that come along for the ride. **Deliberately deferred** in
favour of getting the rest of the site live first; this doc is the plan
for when you're ready to execute.

## Goals

1. **`#announcements` → portal Forum sync.** Every staff message in a
   designated Discord channel becomes a row in `forum_posts` with
   `type='announcement'`. They render automatically on `/forum` →
   Announcements tab (the placeholder is already wired and waiting).
2. **Slash command `/announce`** so staff can push an announcement
   without it having to come from a specific channel.
3. **Rebrand announce.** One-shot embed message announcing the
   `BritLife → Obey RP` transition. Content, not code.
4. **(Stretch)** Plus purchase + whitelist notifications routed into
   staff-only Discord channels.

## Architecture

Single new long-running Node service, deployed to the **existing bridge
VPS** alongside `obey-bridge`. Same systemd pattern. Same `.env`
secrets path.

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Discord Gateway        │ ──────► │  obey-bot               │
│  (#announcements chan,  │ events  │  (Hetzner bridge VPS,   │
│  slash commands, etc.)  │         │   systemd, port-less)   │
└─────────────────────────┘         └─────────────┬───────────┘
                                                  │ HMAC HTTP
                                                  │ (loopback 127.0.0.1:3030 —
                                                  │  same trick obey-feed's
                                                  │  Lua HMAC uses)
                                                  ▼
                                    ┌─────────────────────────┐
                                    │  obey-bridge            │
                                    │  POST /forum/posts      │
                                    │  POST /events           │
                                    └─────────────┬───────────┘
                                                  ▼
                                       ┌──────────────────┐
                                       │  qbox_fc813d DB  │
                                       └──────────────────┘
```

**Why colocate with bridge VPS:**
- Bot → bridge calls travel loopback (no public hop), HMAC stays cheap.
- One VPS to keep alive, one place env vars live, one snapshot to back up.
- Bot doesn't need inbound ports — only outbound Discord WebSocket.

**Repo strategy:** add `obey-bridge/bot/` as a sibling to the existing
`src/`. Shares `package.json` (one `npm install`), shares `.env` for
secrets, shares the git tag history. Single source of truth.

```
obey-bridge/
  src/              ← existing HTTP bridge
  bot/              ← new Discord bot
    index.ts
    commands/
      announce.ts
    handlers/
      announcements-sync.ts
  package.json      ← extends scripts: "bot:dev", "bot:start"
```

## Tech choices

- **discord.js v14** — by far the most maintained Discord SDK; first-class
  TypeScript types; slash-command + interaction helpers built in.
- **Node 20** (already on the VPS).
- **TypeScript strict** to match the rest of the bridge.
- **No new database tables.** Everything writes through the existing
  `/forum/posts` and `/events` routes — they're the right surface area.
- **No new domain.** Bot doesn't expose HTTP; it's a Discord WS client.

## Feature tiers

### P0 — required for rebrand (~2 hrs)

| # | Feature | What it does |
|---|---|---|
| 1 | Bot scaffolding + token wiring | `obey-bot.service` systemd unit, env vars, `bot/index.ts` connects to Discord gateway, logs ready |
| 2 | `#announcements` channel watcher | On `messageCreate` in configured channel, POST `/forum/posts` with `type='announcement'`. Idempotency key = Discord message ID so re-sends don't dupe. |
| 3 | Rebrand announce (content) | Drafted embed in `bot/content/rebrand.md`. Posted manually from Discord OR via a one-shot `npm run bot:rebrand` script. |

### P1 — high-value adjacent (~3 hrs)

| # | Feature | What it does |
|---|---|---|
| 4 | Slash `/announce <message>` | Staff-gated (rank check via Discord role). Pushes an announcement to the forum without it having to come from `#announcements`. |
| 5 | Plus purchase notifier | Tebex webhook → bridge calls bot via internal HTTP → bot posts an embed to `#plus-purchases`. ("@PlayerName just bought Obey Plus Monthly · welcome to the club") |
| 6 | Whitelist application notifier | New `applications` row → bot posts to `#staff-applications` with a "Review on portal" link. Staff can react ✅ / ❌ to approve/reject without leaving Discord. |

### P2 — future polish (~varies)

| # | Feature |
|---|---|
| 7 | `/whois <discord-or-citizenid>` — staff lookup of portal-linked players |
| 8 | `/plus-grant @user` — Founder-only override via Discord, mirrors the portal admin tool |
| 9 | Live server-status pinned message — auto-updates every 5 min in a designated channel |
| 10 | Mod actions log — bot mirrors `application_audit_log` writes into `#audit` |

## Implementation order

Strict sequence — each step depends on the previous being green.

### Step 1 — Bot account + permissions in Discord Developer Portal

1. https://discord.com/developers/applications → your Obey RP Portal app
2. **Bot** tab → "Add Bot" → confirm
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
   (required for `#announcements` sync)
4. Copy the bot token → save as `DISCORD_BOT_TOKEN` in bridge VPS `.env`
5. **OAuth2 → URL Generator** → tick scope `bot`, bot permissions
   `Send Messages`, `Embed Links`, `Add Reactions`, `Read Message History`,
   `Use Slash Commands` → generated URL → open → invite to guild

### Step 2 — Scaffolding (~30 min)

```bash
cd ~/obey-bridge
npm install discord.js @discordjs/rest discord-api-types
mkdir -p bot/handlers bot/commands bot/content
touch bot/index.ts
```

`bot/index.ts` — connect to Discord, register `ready` listener, exit on
SIGTERM. Add `npm run bot:start` script. New systemd unit
`/etc/systemd/system/obey-bot.service` following the same pattern as
`obey-bridge.service` but `ExecStart=/usr/bin/node dist/bot/index.js`.

### Step 3 — Announcements channel watcher (~45 min)

Env:
```ini
DISCORD_ANNOUNCE_CHANNEL_ID=<channel-id>
```

Handler `bot/handlers/announcements-sync.ts`:
- Listen for `messageCreate`
- Filter: only the configured channel; ignore bots; ignore messages with
  no content (image-only posts)
- POST `/forum/posts` with HMAC, body:
  ```json
  {
    "type": "announcement",
    "title": "<first 80 chars or 'Announcement'>",
    "body": "<message.content>",
    "author_discord_id": "<message.author.id>",
    "author_name": "<message.member.displayName>",
    "author_avatar": "<author avatar URL>",
    "idempotency_key": "discord-msg:<message.id>"
  }
  ```

Bridge needs a tiny extension: accept `type='announcement'` in the
existing POST `/forum/posts` (currently hardcoded to `'suggestion'`).
~3-line change. Also add an `idempotency_key` column + unique index to
`forum_posts` so re-runs of an old message don't dupe.

### Step 4 — Rebrand announce (~30 min)

`bot/content/rebrand.md` — final copy.
`npm run bot:rebrand` — one-shot script that builds an embed from that
markdown and posts it to the configured `#general` (or wherever) channel.
Idempotent: refuses to run twice unless `--force` is passed.

### Step 5 — Slash `/announce` (~30 min)

Standard discord.js slash command. Permissions: Discord role check
against the Founder/Owner/Admin role IDs already in `staff-roles.ts`.
On invoke: opens a modal, captures title + body, POSTs forum like the
channel watcher does.

### Step 6 — Tebex / whitelist notifiers (~1.5 hrs each)

Bridge gets a new internal endpoint `POST /bot/notify` (HMAC-gated, same
secret) that the Tebex webhook + whitelist submit routes call. Bot
listens to it… actually the cleaner pattern: bridge writes to a new
`bot_outbox` table, bot polls every 10s. Avoids any "what if bot is
down" message loss.

(Alternative: use the existing `/events` SSE stream — bot is just
another subscriber. Cleaner if you want to keep the bot pull-only.)

### Step 7 — Deployment to bridge VPS

```bash
cd ~/obey-bridge
git pull
npm install
npm run build
sudo systemctl daemon-reload
sudo systemctl enable --now obey-bot
sudo systemctl status obey-bot --no-pager
```

Verify in Discord — bot appears online in member list, slash commands
auto-register on first boot.

## What you'd need to provide before we start

| Item | Where to grab it | Saved as |
|---|---|---|
| **Bot token** | Discord Dev Portal → your app → Bot → Reset Token | `DISCORD_BOT_TOKEN` in bridge `.env` |
| **Announce channel ID** | Discord → right-click `#announcements` → Copy Channel ID (Developer Mode must be on) | `DISCORD_ANNOUNCE_CHANNEL_ID` |
| **Optional: notifier channel IDs** | Same way for `#plus-purchases`, `#staff-applications` | `DISCORD_PLUS_CHANNEL_ID`, etc. |
| **Rebrand announce copy** | You (or we can draft together) | `bot/content/rebrand.md` |

## Total effort

- **P0 only (rebrand-ready):** ~2 hours of work + ~30 min of Discord
  Dev Portal config on your side
- **P0 + P1 (production-grade):** ~5 hours
- **P0 + P1 + P2:** ~10-12 hours, but P2 items are independent
  features that can land one at a time over weeks

## Risks / gotchas

- **Message Content Intent** has to be enabled in Dev Portal AND your bot
  has to be in fewer than 100 guilds (which it will be). For >100 guilds
  you'd need a verified app — irrelevant here.
- **Slash command registration** can take up to 1 hour to propagate
  globally. For staff-only commands in a single guild, use
  *guild-scoped* registration — those propagate instantly.
- **Bot in 1 guild only** — current scope assumes your single Obey
  Discord. Multi-guild deploys would need per-guild config.
- **Privacy** — `#announcements` messages are public to forum readers.
  If you put any private info there, it'll surface on the website.
  Document this for the staff who'll be writing them.

## When to revisit

Trigger conditions:
- You're scheduling the rebrand announce → ship P0
- Staff want a way to push forum announcements without a dedicated
  channel → ship P1 #4
- Tebex purchases start happening and you want Discord visibility →
  ship P1 #5
