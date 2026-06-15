-- Rotation policy v3: no-gold pool flag, held turns, due-member tracking

alter table event_participants
  add column if not exists no_gold boolean not null default false;

alter table allocation_runs
  add column if not exists due_for_next jsonb not null default '{}';

alter table allocation_runs
  add column if not exists held_turns jsonb not null default '{}';

grant select, insert, update, delete on public.event_participants to anon, authenticated, service_role;
grant select, insert, update, delete on public.allocation_runs to anon, authenticated, service_role;
