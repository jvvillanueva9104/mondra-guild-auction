-- Designated bidders: pre-bidding rotation picks, separate from item totals.

alter type event_status add value if not exists 'designated' after 'locked';

create table designated_bidders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id),
  bidder_index int not null check (bidder_index >= 0 and bidder_index < 5),
  created_at timestamptz not null default now(),
  unique (event_id, bidder_index)
);

create index idx_designated_bidders_event on designated_bidders(event_id);

alter table auction_allocations
  add column if not exists is_designated boolean not null default false;

alter table designated_bidders enable row level security;

create policy "officers read designated_bidders"
  on designated_bidders for select using (is_officer());

create policy "officers write designated_bidders"
  on designated_bidders for all using (is_officer()) with check (is_officer());

grant select, insert, update, delete on public.designated_bidders to anon, authenticated, service_role;
