-- Reports are LIVING (dynamic): rebuilt in place from the current catalog daily.
-- Publishing the *content* is automatic; the editorial launch (X thread, media)
-- stays manual. Supersedes the quarterly-draft cron.
create or replace function public.legit_report_refresh()
returns void language plpgsql security definer set search_path = public as $$
declare v_config record;
begin
  select supabase_url, service_role_key into v_config
  from public._email_dispatch_config order by updated_at desc nulls last limit 1;
  if v_config is null or v_config.service_role_key is null then return; end if;
  perform net.http_post(
    url     := v_config.supabase_url || '/functions/v1/generate-report',
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_config.service_role_key,'Authorization','Bearer ' || v_config.service_role_key),
    body    := jsonb_build_object('action','refresh')
  );
end; $$;

select cron.unschedule('legit-report-drafts') where exists (select 1 from cron.job where jobname='legit-report-drafts');
-- Daily 13:00 UTC (= 22:00 KST), after the daily ingest + benchmark settle.
select cron.schedule('legit-report-refresh', '0 13 * * *', $$ select public.legit_report_refresh(); $$);
