-- Upgrade 008 (per-slot rows) → five designated bidders (one row per person).
-- Safe to run if 008 already created the old columns; no-op if table is already correct.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'designated_bidders'
      and column_name = 'item_type'
  ) then
    delete from designated_bidders;
    alter table designated_bidders drop constraint if exists designated_bidders_event_id_item_type_slot_index_key;
    alter table designated_bidders drop column item_type;
    alter table designated_bidders drop column slot_index;
    alter table designated_bidders add column bidder_index int not null check (bidder_index >= 0 and bidder_index < 5);
    alter table designated_bidders add unique (event_id, bidder_index);
  end if;
end $$;
