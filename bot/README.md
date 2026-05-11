# obey-bot

Discord side of obey-bridge. Phase 5 from the original plan.

Currently does **one job**: mirrors staff messages in a designated
`#announcements` channel into the portal forum as
`type='announcement'` rows. The portal renders them on `/forum` →
Announcements tab automatically.

Slash commands and Plus/whitelist notifiers (P1) plug in here later.

## Architecture

```
Discord Gateway ──► obey-bot ──► obey-bridge ──► qbx_core DB
                    (Hetzner)    (loopback HMAC,
                                  same VPS)
```

Single process, no inbound ports. Same `.env` as the bridge. Same
`package.json`. Separate `tsconfig.bot.json` keeps the compiled output
in `dist/bot/` so the bridge's existing `dist/server.js` is undisturbed.

## Required `.env` additions

Append these to `/opt/obey-bridge/.env` on the VPS:

```ini
# Discord Dev Portal → your app → Bot → Reset Token
DISCORD_BOT_TOKEN=...

# Right-click your Obey guild → Copy Server ID (Developer Mode on)
DISCORD_GUILD_ID=...

# Right-click #announcements → Copy Channel ID
DISCORD_ANNOUNCE_CHANNEL_ID=...

# Optional, only used by future P1 notifier features:
# DISCORD_PLUS_CHANNEL_ID=...
# DISCORD_STAFF_APPS_CHANNEL_ID=...
```

`BRIDGE_SHARED_SECRET` is already in the bridge `.env` — the bot reads
the same value.

## Discord Dev Portal setup

1. https://discord.com/developers/applications
2. Pick (or create) your Obey RP app
3. **Bot** tab:
   - "Reset Token" → copy to `.env` as `DISCORD_BOT_TOKEN`
   - Under **Privileged Gateway Intents**, enable **Message Content
     Intent** (required — without it `msg.content` is always empty)
4. **OAuth2 → URL Generator**:
   - Scope: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `Add Reactions`,
     `Read Message History`
   - Open the generated URL → invite to your guild

## Local dev

```bash
npm install                   # once, picks up discord.js
npm run bot:dev               # tsx watch + auto-restart on edit
```

Run the bridge in another terminal — the bot HMACs to
`http://127.0.0.1:3030` by default.

## Deploy

```bash
# On the bridge VPS (cwd: /opt/obey-bridge)
git pull
npm install
npm run build                 # bridge → dist/
npm run bot:build             # bot    → dist/bot/

# Apply migration 0006 (idempotency_key on forum_posts) if you haven't:
mysql -u root -p qbx_core < sql/0006-add-forum-idempotency.sql

# Install + start the unit:
sudo cp deploy/obey-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obey-bot
sudo systemctl status obey-bot --no-pager
```

Watch the logs the first time:

```bash
sudo journalctl -u obey-bot -f
# Expect: "obey-bot ready" with botTag, then any messageCreate
# from the configured channel triggers "announcement mirrored to forum".
```

## Post the rebrand announce

Edit `bot/content/rebrand.md`, then:

```bash
cd /opt/obey-bridge
npm run bot:rebrand            # idempotent — won't dupe
# npm run bot:rebrand -- --force   # repost after a copy edit
```

The script scans the channel's last 50 messages for a bot-authored
embed with the same H1 title and refuses to re-post unless `--force`
is passed.

## Future work (P1, P2)

See `PHASE-5-SPEC.md` at the repo root. Handlers land alongside
`announcements-sync.ts`; slash commands go in `bot/commands/`.
