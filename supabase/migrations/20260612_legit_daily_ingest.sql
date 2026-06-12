-- Legit.Show directory — DAILY source poll (launches + recently-launched repos).
--
-- Complements the weekly sweep (20260607). Where the weekly run does the broad
-- reddit/keyword pass, this daily run targets the sources where genuinely-new
-- projects appear every day: Product Hunt / BetaList launches, and GitHub repos
-- *created* in the recent window that already have traction (the ingest fn now
-- applies a created:> recency floor to keyword searches, so keyword=stars no
-- longer surfaces old awesome-lists). Dedup (canonical_key) means already-known
-- projects cost zero enrichment, so the daily run only spends on net-new.
--
-- Auth + async exactly like the weekly job: service_role_key from
-- _email_dispatch_config, pg_net fire-and-forget. Each ingest call auto-benchmarks
-- its fresh rows.

create or replace function public.legit_daily_ingest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_targets text[] := array[
    'ph betalist gh:ai-agent gh:devtools gh:saas',
    'gh:mcp gh:llm gh:cli gh:rag npm:ai npm:agent mcp skills'
  ];
  v_t text;
begin
  select supabase_url, service_role_key into v_config
  from public._email_dispatch_config
  order by updated_at desc nulls last
  limit 1;

  if v_config is null or v_config.service_role_key is null or v_config.supabase_url is null then
    raise notice 'legit_daily_ingest: no dispatch config — skipped';
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
        'window', 'week',   -- → ~120-day created floor on GitHub keyword searches
        'limit',  20
      )
    );
  end loop;
end;
$$;

-- Daily 11:00 UTC. cron.schedule de-duplicates by jobname.
select cron.schedule(
  'legit-daily-ingest',
  '0 11 * * *',
  $$ select public.legit_daily_ingest(); $$
);
