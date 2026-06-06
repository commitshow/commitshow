-- Legit tickets — the directory's heavy, scarce vouch signal (vs the light,
-- unlimited tag reactions). A member throws ONE ticket per product, tagging the
-- specialty it nails. Monthly quota keeps throws meaningful. Aggregates drive a
-- ticket-tier star color, a "vouched for" specialty surface, and ranking.

create table if not exists listing_tickets (
  listing_id uuid references listings(id) on delete cascade not null,
  member_id  uuid references members(id)  on delete cascade not null,
  specialty  text not null check (specialty in (
    'reliable',    -- Reliable
    'polished',    -- Polished
    'value',       -- Great value
    'time_saver',  -- Time-saver
    'innovative',  -- Innovative
    'supported'    -- Well-supported
  )),
  created_at timestamptz default now(),
  primary key (listing_id, member_id)   -- 1 ticket per product per member (specialty re-taggable via UPDATE)
);
create index if not exists listing_tickets_listing_idx on listing_tickets (listing_id);

alter table listing_tickets enable row level security;
drop policy if exists listing_tickets_read on listing_tickets;
create policy listing_tickets_read on listing_tickets for select using (true);
drop policy if exists listing_tickets_insert_own on listing_tickets;
create policy listing_tickets_insert_own on listing_tickets for insert with check (auth.uid() = member_id);
drop policy if exists listing_tickets_update_own on listing_tickets;
create policy listing_tickets_update_own on listing_tickets for update using (auth.uid() = member_id);
drop policy if exists listing_tickets_delete_own on listing_tickets;
create policy listing_tickets_delete_own on listing_tickets for delete using (auth.uid() = member_id);
grant select on listing_tickets to anon, authenticated;
grant insert, update, delete on listing_tickets to authenticated;

-- Monthly quota: cap new throws per calendar month. Re-tagging an existing
-- ticket is an UPDATE and does not count; deleting + throwing elsewhere does.
create or replace function enforce_ticket_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare cnt int; quota constant int := 12;
begin
  select count(*) into cnt from listing_tickets
    where member_id = new.member_id and created_at >= date_trunc('month', now());
  if cnt >= quota then
    raise exception 'Monthly legit ticket quota reached (% per month)', quota using errcode = 'check_violation';
  end if;
  return new;
end$$;
drop trigger if exists ticket_quota on listing_tickets;
create trigger ticket_quota before insert on listing_tickets for each row execute function enforce_ticket_quota();

-- Lifetime aggregates per listing: total + per-specialty breakdown.
create or replace view listing_ticket_stats as
select listing_id, sum(c)::int as ticket_count, jsonb_object_agg(specialty, c) as specialties
from (select listing_id, specialty, count(*)::int c from listing_tickets group by 1, 2) t
group by listing_id;
grant select on listing_ticket_stats to anon, authenticated;
