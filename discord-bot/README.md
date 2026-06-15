# Discord check-in bot

Connects your Discord server to the Guild Auction Planner Supabase database.

## What it does

- **Auto check-in** — when a draft is created on the website, posts ✅ check-in in `DISCORD_CHECKIN_CHANNEL_ID` (bot must be running)
- **`/start-checkin type:EO`** — manual fallback if auto check-in is not configured
- **`/start-checkin type:GL`** — same for Guild League
- **First reaction** — creates a roster member (Discord nickname + `discord_id`) and marks attendance
- **Remove reaction** — removes attendance for that event
- **Website** — Attendance page shows who reacted (refresh the page)

## Setup

See the project root guide or follow `../docs/DISCORD_BOT_SETUP.md`.

## Run locally

```bash
cd discord-bot
cp .env.example .env
# fill in .env
npm install
npm run dev
```

Keep the terminal open while check-in is active (or deploy to Railway/Fly.io for 24/7).
