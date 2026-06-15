-- Discord bot uses the secret key (service_role). RLS is bypassed, but Postgres
-- still requires explicit table grants on newer Supabase projects.

grant select, insert, update, delete on public.members to service_role;
grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.event_rewards to service_role;
grant select, insert, update, delete on public.attendance to service_role;
grant select, insert, update, delete on public.event_participants to service_role;
grant select, insert, update, delete on public.allocation_runs to service_role;
grant select, insert, update, delete on public.auction_allocations to service_role;
