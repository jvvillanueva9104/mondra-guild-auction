-- Discord bot posts designated + normal bidder lists to a separate board channel.

alter table events add column if not exists designated_discord_message_id text;
alter table events add column if not exists bidders_discord_message_id text;
alter table events add column if not exists board_discord_channel_id text;
