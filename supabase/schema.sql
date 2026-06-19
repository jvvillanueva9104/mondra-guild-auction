create extension if not exists pgcrypto;

create type member_status as enum ('active', 'inactive', 'left');
create type event_type as enum ('EO', 'GL');
create type event_status as enum ('draft', 'locked', 'designated', 'generated');
create type reward_type as enum ('puppet', 'mvp', 'light_dark', 'time_space');

create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  discord_id text,
  status member_status not null default 'active',
  joined_at date not null default current_date,
  left_at date,
  is_auction_eligible boolean not null default true,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  type event_type not null,
  event_date date not null default current_date,
  status event_status not null default 'draft',
  checkin_open boolean not null default false,
  checkin_message_id text,
  checkin_channel_id text,
  designated_discord_message_id text,
  bidders_discord_message_id text,
  board_discord_channel_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table event_rewards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  reward_type reward_type not null,
  quantity int not null check (quantity >= 0),
  per_member_cap int check (per_member_cap is null or per_member_cap >= 0),
  unique(event_id, reward_type)
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id),
  status text not null default 'present',
  source text not null default 'manual',
  unique(event_id, member_id)
);

create table event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id),
  is_online boolean not null default false,
  no_gold boolean not null default false,
  unique(event_id, member_id)
);

create table allocation_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  seed text not null,
  algorithm_version text not null default 'launch-v1',
  due_for_next jsonb not null default '{}',
  held_turns jsonb not null default '{}',
  generated_at timestamptz not null default now()
);

create table auction_allocations (
  id uuid primary key default gen_random_uuid(),
  allocation_run_id uuid not null references allocation_runs(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid references members(id),
  item_type reward_type not null,
  slot_index int not null,
  page_number int not null,
  row_number int not null,
  is_designated boolean not null default false
);

create table designated_bidders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id),
  bidder_index int not null check (bidder_index >= 0 and bidder_index < 5),
  created_at timestamptz not null default now(),
  unique (event_id, bidder_index)
);

create index idx_designated_bidders_event on designated_bidders(event_id);

create index idx_members_status on members(status);
create unique index idx_members_discord_id on members(discord_id) where discord_id is not null;
create index idx_attendance_event on attendance(event_id);
create index idx_participants_event on event_participants(event_id);
create index idx_allocations_event on auction_allocations(event_id);

-- Required on newer Supabase projects: tables are not auto-granted to API roles.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.members to anon, authenticated, service_role;
grant select, insert, update, delete on public.events to anon, authenticated, service_role;
grant select, insert, update, delete on public.event_rewards to anon, authenticated, service_role;
grant select, insert, update, delete on public.attendance to anon, authenticated, service_role;
grant select, insert, update, delete on public.event_participants to anon, authenticated, service_role;
grant select, insert, update, delete on public.allocation_runs to anon, authenticated, service_role;
grant select, insert, update, delete on public.auction_allocations to anon, authenticated, service_role;
grant select, insert, update, delete on public.designated_bidders to anon, authenticated, service_role;

alter table members enable row level security;
alter table events enable row level security;
alter table event_rewards enable row level security;
alter table attendance enable row level security;
alter table event_participants enable row level security;
alter table allocation_runs enable row level security;
alter table auction_allocations enable row level security;
alter table designated_bidders enable row level security;

create table officers (
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
create policy "officers read designated_bidders" on designated_bidders for select using (is_officer());
create policy "officers write designated_bidders" on designated_bidders for all using (is_officer()) with check (is_officer());

-- Discord bot auto check-in listens for new rows via Realtime.
alter publication supabase_realtime add table public.events;
