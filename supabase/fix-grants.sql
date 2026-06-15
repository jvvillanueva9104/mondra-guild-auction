-- Run this in Supabase SQL Editor if you get "permission denied for table ..."
-- Newer Supabase projects require explicit grants before the Data API can access tables.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.members to anon, authenticated;
grant select, insert, update, delete on public.events to anon, authenticated;
grant select, insert, update, delete on public.event_rewards to anon, authenticated;
grant select, insert, update, delete on public.attendance to anon, authenticated;
grant select, insert, update, delete on public.event_participants to anon, authenticated;
grant select, insert, update, delete on public.allocation_runs to anon, authenticated;
grant select, insert, update, delete on public.auction_allocations to anon, authenticated;
