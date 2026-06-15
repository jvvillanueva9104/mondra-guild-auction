-- Lets the Discord bot listen for new draft events via Supabase Realtime.
alter publication supabase_realtime add table public.events;
