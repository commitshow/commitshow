-- preview_rate_limits · caps how many `commitshow audit` previews a given IP
-- can run per day. Cheap defence against Claude-API-cost abuse until we
-- wire something more sophisticated (device-flow auth) in V1.5.
--
-- Schema is minimal on purpose: one row per (ip_hash, day), count bumped
-- atomically by `increment_preview_rate_limit()`. Old days age out naturally
-- because no request touches them.

create table if not exists preview_rate_limits (
  ip_hash text not null,
  day     date not null,
  count   integer not null default 0,
  primary key (ip_hash, day)
);

-- Atomic increment RPC — the Edge Function's single call per request.
-- Returns the post-increment count so the caller can decide whether to
-- refuse. SECURITY DEFINER + search_path locked so it can't be hijacked
-- from RLS-wrapped contexts.
create or replace function increment_preview_rate_limit(p_ip_hash text, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into preview_rate_limits (ip_hash, day, count)
  values (p_ip_hash, p_day, 1)
  on conflict (ip_hash, day) do update set count = preview_rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- Anyone with the anon key can't touch the table directly · gate is via RPC.
alter table preview_rate_limits enable row level security;

grant execute on function increment_preview_rate_limit(text, date) to anon, authenticated;

-- House-keeping · prune rows older than 30 days. Can be wired to a cron
-- in V1.5 Season-end engine work; for now it's just a helper.
create or replace function prune_preview_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from preview_rate_limits where day < current_date - interval '30 days';
$$;
