-- v8 concept restore: Applaud becomes a lightweight Craft Award track.
-- Graduation drops to 5 gates. Scout gets exactly one applaud per season.
-- Safe to re-run (all operations are idempotent · guarded by IF/DO blocks).

-- ── 1. Applauds · add season_id + backfill from project ──
alter table applauds
  add column if not exists season_id uuid references seasons(id) on delete set null;

update applauds a
   set season_id = p.season_id
  from projects p
 where a.project_id = p.id
   and a.season_id is null;

-- ── 2. Applauds · swap unique constraint to (member_id, season_id) ──
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'applauds_member_id_project_id_key' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds drop constraint applauds_member_id_project_id_key;
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'applauds_member_project_axis_uq' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds drop constraint applauds_member_project_axis_uq;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'applauds_member_season_uq' and conrelid = 'applauds'::regclass
  ) then
    alter table applauds add constraint applauds_member_season_uq
      unique (member_id, season_id);
  end if;
end $$;

-- ── 3. Rebuild applaud signals view (drop tier_variety; graduation no longer uses it) ──
drop view if exists project_applaud_signals;
create view project_applaud_signals as
  select
    a.project_id,
    count(distinct a.member_id)                                           as unique_scouts,
    coalesce(sum(a.weight), 0)                                            as weighted_sum,
    count(*) filter (where a.scout_tier = 'Bronze')                       as bronze_count,
    count(*) filter (where a.scout_tier = 'Silver')                       as silver_count,
    count(*) filter (where a.scout_tier = 'Gold')                         as gold_count,
    count(*) filter (where a.scout_tier = 'Platinum')                     as platinum_count
  from applauds a
  where a.member_id is not null
  group by a.project_id;

-- ── 4. Replace evaluate_graduation() with 5-gate version ──
create or replace function evaluate_graduation(p_project_id uuid)
returns jsonb as $$
declare
  v_project          record;
  v_forecast_count   integer;
  v_sustained_days   integer;
  v_health_ok        boolean;
  v_result           jsonb := '{}'::jsonb;
  v_pass_count       integer := 0;
  v_total_conditions constant integer := 5;
begin
  select id, status, score_auto, score_total, creator_id, live_url, github_accessible
    into v_project
    from projects
   where id = p_project_id;

  if v_project.id is null then
    return jsonb_build_object('ok', false, 'error', 'project_not_found');
  end if;

  select count(distinct v.member_id) into v_forecast_count
    from votes v
   where v.project_id = p_project_id
     and v.member_id is not null;

  select count(*) into v_sustained_days
    from analysis_snapshots s
   where s.project_id = p_project_id
     and s.created_at >= now() - interval '14 days'
     and s.score_total >= 75;

  v_health_ok := v_project.live_url is not null and v_project.score_auto >= 5;

  v_result := v_result
    || jsonb_build_object('criteria', jsonb_build_array(
      jsonb_build_object(
        'id',    'score_total',
        'label', 'Overall score >= 75',
        'pass',  v_project.score_total >= 75,
        'value', v_project.score_total,
        'target', 75
      ),
      jsonb_build_object(
        'id',    'score_auto',
        'label', 'Automated score >= 35 / 50',
        'pass',  v_project.score_auto >= 35,
        'value', v_project.score_auto,
        'target', 35
      ),
      jsonb_build_object(
        'id',    'forecast_count',
        'label', 'Forecast >= 3 scouts',
        'pass',  v_forecast_count >= 3,
        'value', v_forecast_count,
        'target', 3
      ),
      jsonb_build_object(
        'id',    'sustained_score',
        'label', 'Score >= 75 for last 2 weeks',
        'pass',  v_sustained_days >= 1,
        'snapshots_over_75_last_14d', v_sustained_days,
        'note',  case when v_sustained_days = 0 then 'no qualifying snapshots' else 'sustained' end
      ),
      jsonb_build_object(
        'id',    'health_ok',
        'label', 'Live URL health check',
        'pass',  v_health_ok,
        'note',  case when v_project.live_url is null then 'no live URL' else 'reachable' end
      )
    ));

  if v_project.score_total >= 75 then v_pass_count := v_pass_count + 1; end if;
  if v_project.score_auto  >= 35 then v_pass_count := v_pass_count + 1; end if;
  if v_forecast_count      >= 3  then v_pass_count := v_pass_count + 1; end if;
  if v_sustained_days      >= 1  then v_pass_count := v_pass_count + 1; end if;
  if v_health_ok                 then v_pass_count := v_pass_count + 1; end if;

  return v_result
    || jsonb_build_object(
      'ok',               true,
      'project_id',       p_project_id,
      'pass_count',       v_pass_count,
      'total',            v_total_conditions,
      'graduation_ready', v_pass_count = v_total_conditions
    );
end;
$$ language plpgsql security definer;
