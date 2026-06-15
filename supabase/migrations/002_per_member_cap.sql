alter table event_rewards add column if not exists per_member_cap int check (per_member_cap is null or per_member_cap >= 0);
