-- Fix on_analysis_snapshot_audition_rewards() to read activity_point_ledger
-- (was ap_events · renamed in v2 · CLAUDE.md §13.2). Same class of bug as
-- 20260501_recalc_grade_polymorphic_applauds.sql · trigger-side stale ref
-- silently rolled back analysis_snapshots INSERTs whenever a project
-- climbed by ≥5 points (the only code path that touched ap_events).
--
-- Why we hadn't caught it: the trigger only reads ap_events inside the
-- climb branch (gate 2), so projects whose audit didn't climb (e.g. flat
-- or down) skipped the dead reference and persisted fine. The bulk
-- re-audit caught it because LinkKbeauty (+43) and Blockbusterlab (+9)
-- both climbed past the 5-point threshold while maa (-31) and 1haeyo
-- (no parent) didn't enter the branch.
--
-- The grant_ap() function still uses the old kind 'audition_reanalyze' /
-- 'audition_climb' / 'audition_streak' which is fine — those got allow-
-- listed in 20260430_audition_reanalyze_ap_kind.sql.

CREATE OR REPLACE FUNCTION public.on_analysis_snapshot_audition_rewards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_creator_id       uuid;
  v_parent_commit    text;
  v_parent_score     integer;
  v_is_iteration     boolean;
  v_is_climb         boolean;
  v_recent_climbs    integer;
  v_last_streak_at   timestamptz;
begin
  if new.trigger_type not in ('resubmit', 'weekly') then
    return new;
  end if;
  if new.parent_snapshot_id is null then
    return new;
  end if;

  select p.creator_id, a.commit_sha, a.score_total
    into v_creator_id, v_parent_commit, v_parent_score
    from projects p, analysis_snapshots a
   where p.id = new.project_id
     and a.id = new.parent_snapshot_id;

  if v_creator_id is null then
    return new;
  end if;

  v_is_iteration := (new.commit_sha is not null
                 and v_parent_commit is not null
                 and new.commit_sha <> v_parent_commit);

  if v_is_iteration then
    perform grant_ap(v_creator_id, 'audition_reanalyze', 15, null, null, new.project_id,
      format('Round up · commit %s → %s', left(v_parent_commit, 7), left(new.commit_sha, 7)));
  end if;

  v_is_climb := (v_is_iteration
             and new.score_total_delta is not null
             and new.score_total_delta >= 5);

  if v_is_climb then
    perform grant_ap(v_creator_id, 'audition_climb', 25, null, null, new.project_id,
      format('Round climb · +%s points', new.score_total_delta));
  end if;

  if v_is_climb then
    -- v2 rename: ap_events → activity_point_ledger (CLAUDE.md §13.2)
    select max(created_at)
      into v_last_streak_at
      from activity_point_ledger
     where member_id = v_creator_id
       and kind      = 'audition_streak';

    select count(*) into v_recent_climbs
      from activity_point_ledger
     where member_id = v_creator_id
       and kind      = 'audition_climb'
       and (v_last_streak_at is null or created_at > v_last_streak_at);

    if v_recent_climbs >= 3 then
      perform grant_ap(v_creator_id, 'audition_streak', 50, null, null, new.project_id,
        '3 consecutive round climbs · on fire');
    end if;
  end if;

  return new;
end;
$function$;
