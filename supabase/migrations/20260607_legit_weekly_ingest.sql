-- Legit.Show directory — weekly source poll.
--
-- Fire-and-forget calls to the ingest-directory edge function across a few source
-- groups. Each ingest call dedups (canonical_key), spam-gates, enriches, upserts,
-- and then auto-benchmarks its fresh rows (the edge fn fires a { pending:true }
-- benchmark sweep on its own), so a freshly-discovered listing is never left
-- un-scored. pg_net is async, so this returns immediately and never blocks.
--
-- Auth: the same service_role pattern the email / auto-tweet pipelines use —
-- service_role_key pulled from public._email_dispatch_config. The key is never
-- shipped to the browser (the web app only holds the anon key); ingest-directory
-- now accepts a service_role JWT (role claim) for internal/cron calls.

create or replace function public.legit_weekly_ingest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_targets text[] := array[
    'hn betalist ph mcp skills',
    'SideProject SaaS indiehackers webdev selfhosted opensource',
    'gh:saas gh:ai-agent gh:devtools npm:cli npm:mcp'
  ];
  v_t text;
begin
  select supabase_url, service_role_key into v_config
  from public._email_dispatch_config
  order by updated_at desc nulls last
  limit 1;

  if v_config is null or v_config.service_role_key is null or v_config.supabase_url is null then
    raise notice 'legit_weekly_ingest: no dispatch config — skipped';
    return;
  end if;

  foreach v_t in array v_targets loop
    perform net.http_post(
      url     := v_config.supabase_url || '/functions/v1/ingest-directory',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'apikey',        v_config.service_role_key,
        'Authorization', 'Bearer ' || v_config.service_role_key
      ),
      body    := jsonb_build_object(
        'action', 'ingest',
        'target', v_t,
        'window', 'week',
        'limit',  25
      )
    );
  end loop;
end;
$$;

-- Weekly: Monday 09:00 UTC. cron.schedule de-duplicates by jobname, so re-running
-- this migration just updates the schedule in place.
select cron.schedule(
  'legit-weekly-ingest',
  '0 9 * * 1',
  $$ select public.legit_weekly_ingest(); $$
);
