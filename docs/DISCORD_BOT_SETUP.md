# Discord bot setup guide

Connect your Discord bot to the Guild Auction Planner website.

## Overview

```
Discord (✅ reaction)  →  Bot (discord-bot/)  →  Supabase  ←  Website (Next.js)
```

The bot uses the **Supabase secret key** (server-only). The website keeps using the **publishable key**.

---

## Part 1 — Discord Developer Portal (you may have done this)

1. Open [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → **Bot**
3. Copy the **Bot Token** (keep secret)
4. Enable **Privileged Gateway Intents**:
   - **Server Members Intent**
   - **Message Content Intent** (optional; reactions work without it)
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Read Messages`, `Send Messages`, `Add Reactions`, `Use Slash Commands`, `Manage Messages` (optional)
6. Open the generated URL and **add the bot to your guild server**

---

## Part 2 — Supabase

### 2a. Run the Discord migration

In **Supabase → SQL Editor**, run the file:

`supabase/migrations/003_discord_checkin.sql`

This adds check-in fields on `events`, `source` on `attendance`, and a unique index on `members.discord_id`.

For **automatic check-in** when a draft is created, also run:

`supabase/migrations/004_realtime_events.sql`

Also run earlier migrations if you have not yet:

- `002_per_member_cap.sql`
- `001_nullable_member_ffa.sql`
- `fix-grants.sql` (grants for API roles)

### 2b. Get the secret key

1. Supabase → **Settings → API**
2. Copy **Project URL**
3. Under **Secret keys**, reveal and copy the **secret** key (`sb_secret_...`)
4. **Never** put this in the Next.js `.env.local` or commit it to git

---

## Part 3 — Configure the bot

```bash
cd discord-bot
cp .env.example .env
npm install
```

Edit `discord-bot/.env`:

| Variable | Where to get it |
|----------|-----------------|
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot → Token |
| `DISCORD_GUILD_ID` | Discord → Developer Mode → right-click your server → Copy Server ID |
| `DISCORD_CHECKIN_CHANNEL_ID` | Right-click your check-in channel → Copy Channel ID — bot auto-posts when a draft is created |
| `DISCORD_OFFICER_ROLE_ID` | Optional — right-click officer role → Copy Role ID |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Secret key |

---

## Part 4 — Run the bot

```bash
cd discord-bot
npm run dev
```

You should see:

```
Logged in as YourBot#1234
Slash commands registered for guild ...
```

Leave this running during check-in (or deploy to Railway/Fly.io later).

---

## Part 5 — Use it on guild night

### A. Create the event on the website

1. Open [http://localhost:3000](http://localhost:3000) (or your deployed URL)
2. **Create Draft** (EO Sunday / GL Tue–Thu) — item totals can wait until after the raid
3. If the bot is running with `DISCORD_CHECKIN_CHANNEL_ID` set, check-in posts **automatically** in that channel
4. Otherwise, open check-in manually (step B below)

### B. Manual check-in (optional fallback)

If auto check-in is not configured, run in Discord:

```
/start-checkin type:EO
```

Use `type:GL` on Guild League nights. The bot picks **today's draft** for that type, or the **latest draft** if the date does not match today.

If you have multiple drafts for the same type, optionally pick one:

```
/start-checkin type:EO event:EO · 2025-06-12
```

(start typing in the **event** field for autocomplete)

Members react ✅ on the bot's message.

### C. Verify on the website

1. Open **Attendance** for that event
2. Refresh — members who reacted should appear checked in
3. Continue: **Auction pool → Lock → Generate → Results**

### D. Close check-in

```
/stop-checkin
```

---

## Part 6 — Discord server tips

| Tip | Why |
|-----|-----|
| Create `#auction-checkin` | Keeps test/live check-ins in one place |
| Use **server nicknames** | Becomes the roster name in the app |
| Enable **Developer Mode** | Copy server/role/user IDs |
| Officer role | Restrict `/start-checkin` via `DISCORD_OFFICER_ROLE_ID` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Slash commands don’t appear | Wait ~1 min; re-invite bot with `applications.commands` scope |
| Bot doesn’t see reactions | Enable **Server Members Intent**; restart bot |
| `permission denied` from Supabase | Run `fix-grants.sql`; verify **secret** key in bot `.env` |
| Member not on website after react | Refresh attendance page; check bot terminal for errors |
| Duplicate name error | Two members same nickname — officer renames one in Members page |

---

## Deploy 24/7 (optional)

For production, host the bot so it stays online:

- [Railway](https://railway.app) — connect repo, set root to `discord-bot`, add env vars
- [Fly.io](https://fly.io) — small VM running `npm start`

The **website** can stay on Vercel; the **bot** runs separately.

---

## Security checklist

- [ ] Bot token only in `discord-bot/.env`
- [ ] Secret key only in `discord-bot/.env`
- [ ] Never commit `.env` files
- [ ] Tighten Supabase RLS before public launch (MVP policies are wide open)
