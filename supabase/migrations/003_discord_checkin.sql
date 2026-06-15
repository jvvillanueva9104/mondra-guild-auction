-- Run in Supabase SQL Editor (skip lines already applied).

alter table attendance add column if not exists source text not null default 'manual';

alter table events add column if not exists checkin_open boolean not null default false;
alter table events add column if not exists checkin_message_id text;
alter table events add column if not exists checkin_channel_id text;

-- Allow upsert by discord_id for react-to-register
create unique index if not exists members_discord_id_unique on members(discord_id) where discord_id is not null;
