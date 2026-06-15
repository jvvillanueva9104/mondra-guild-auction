-- Officer login: allowlisted Supabase Auth users only.
-- Run after creating officer accounts in Supabase Auth (see docs/OFFICER_AUTH_SETUP.md).

create table if not exists officers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

grant select on public.officers to authenticated;

alter table officers enable row level security;

create policy "officers read self"
  on officers for select
  using (user_id = auth.uid());

create or replace function public.is_officer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from officers where user_id = auth.uid()
  );
$$;

grant execute on function public.is_officer() to authenticated;

-- Remove open MVP policies
drop policy if exists "mvp read members" on members;
drop policy if exists "mvp write members" on members;
drop policy if exists "mvp read events" on events;
drop policy if exists "mvp write events" on events;
drop policy if exists "mvp read event_rewards" on event_rewards;
drop policy if exists "mvp write event_rewards" on event_rewards;
drop policy if exists "mvp read attendance" on attendance;
drop policy if exists "mvp write attendance" on attendance;
drop policy if exists "mvp read participants" on event_participants;
drop policy if exists "mvp write participants" on event_participants;
drop policy if exists "mvp read runs" on allocation_runs;
drop policy if exists "mvp write runs" on allocation_runs;
drop policy if exists "mvp read allocations" on auction_allocations;
drop policy if exists "mvp write allocations" on auction_allocations;

-- Officer-only access for the website (anon has no data access)
create policy "officers read members" on members for select using (is_officer());
create policy "officers write members" on members for all using (is_officer()) with check (is_officer());

create policy "officers read events" on events for select using (is_officer());
create policy "officers write events" on events for all using (is_officer()) with check (is_officer());

create policy "officers read event_rewards" on event_rewards for select using (is_officer());
create policy "officers write event_rewards" on event_rewards for all using (is_officer()) with check (is_officer());

create policy "officers read attendance" on attendance for select using (is_officer());
create policy "officers write attendance" on attendance for all using (is_officer()) with check (is_officer());

create policy "officers read participants" on event_participants for select using (is_officer());
create policy "officers write participants" on event_participants for all using (is_officer()) with check (is_officer());

create policy "officers read runs" on allocation_runs for select using (is_officer());
create policy "officers write runs" on allocation_runs for all using (is_officer()) with check (is_officer());

create policy "officers read allocations" on auction_allocations for select using (is_officer());
create policy "officers write allocations" on auction_allocations for all using (is_officer()) with check (is_officer());
