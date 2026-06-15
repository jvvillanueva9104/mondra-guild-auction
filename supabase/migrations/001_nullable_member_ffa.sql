-- Allow Free For All rows (MVP + feather remainder) with no assigned member.
alter table auction_allocations alter column member_id drop not null;
