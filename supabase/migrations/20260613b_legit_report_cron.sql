-- Quarterly report-draft generation. Calls generate-report to (re)build each report
-- from the latest data as a DRAFT — publishing stays a manual editorial step
-- (citation stability + the launch playbook). As benchmark_history accumulates, the
-- drafts automatically gain a time-series "what changed" section.
create or replace function public.legit_report_drafts()
returns void language plpgsql security definer set search_path = public as $$
declare v_config record;
begin
  select supabase_url, service_role_key into v_config
  from public._email_dispatch_config order by updated_at desc nulls last limit 1;
  if v_config is null or v_config.service_role_key is null then
    raise notice 'legit_report_drafts: no dispatch config — skipped'; return;
  end if;
  perform net.http_post(
    url     := v_config.supabase_url || '/functions/v1/generate-report',
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_config.service_role_key,'Authorization','Bearer ' || v_config.service_role_key),
    body    := jsonb_build_object('action','draft')
  );
end; $$;

-- Quarterly: 1st of Jan/Apr/Jul/Oct, 23:00 UTC (= 08:00 KST).
select cron.schedule('legit-report-drafts', '0 23 1 1,4,7,10 *', $$ select public.legit_report_drafts(); $$);
