# Guild Auction Planner MVP

A Supabase + Next.js app for planning guild auction assignments.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and fill in your Supabase URL and anon key.
4. Install and run:

```bash
npm install
npm run dev
```

## Flow

1. Add members.
2. Create an event with rewards.
3. Mark attendance.
4. Mark auction eligibility / online members.
5. Generate allocation.
6. Copy results for Discord.

## Launch fairness

Initial launch uses eligible online members only, deterministic seeded shuffle, and round-robin assignment.
