-- PRD v1.7 audition loop · reward real iteration.
-- Fires AFTER analysis_snapshots INSERT. 3 reward channels:
--   audition_reanalyze (+15)  — Creator re-ran analysis with a NEW commit_sha
--   audition_climb     (+25)  — score_total_delta >= +5 since last snapshot
--   audition_streak    (+50)  — 3 consecutive climbs (once per streak)
-- None fires on the initial snapshot (there's nothing to climb from).

create or replace function on_analysis_snapshot_audition_rewards()
returns trigger as $$
declare
  v_creator_id       uuid;
  v_parent_commit    text;
  v_parent_score     integer;
  v_is_iteration     boolean;
  v_is_climb         boolean;
  v_recent_climbs    integer;
  v_last_streak_at   timestamptz;
begin
  -- Only reward resubmit/weekly · baseline initial/season_end do not climb
  if new.trigger_type not in ('resubmit', 'weekly') then
    return new;
  end if;
  if new.parent_snapshot_id is null then
    return new;
  end if;

  -- Load parent
  select p.creator_id, a.commit_sha, a.score_total
    into v_creator_id, v_parent_commit, v_parent_score
    from projects p, analysis_snapshots a
   where p.id = new.project_id
     and a.id = new.parent_snapshot_id;

  if v_creator_id is null then
    return new;
  end if;

  -- Gate 1: iteration requires a new commit_sha (anti-gaming · AP 긁기 차단)
  v_is_iteration := (new.commit_sha is not null
                 and v_parent_commit is not null
                 and new.commit_sha <> v_parent_commit);

  if v_is_iteration then
    perform grant_ap(v_creator_id, 'audition_reanalyze', 15, null, null, new.project_id,
      format('Round up · commit %s → %s', left(v_parent_commit, 7), left(new.commit_sha, 7)));
  end if;

  -- Gate 2: climb requires the iteration reward PLUS score_total_delta >= 5
  v_is_climb := (v_is_iteration
             and new.score_total_delta is not null
             and new.score_total_delta >= 5);

  if v_is_climb then
    perform grant_ap(v_creator_id, 'audition_climb', 25, null, null, new.project_id,
      format('Round climb · +%s points', new.score_total_delta));
  end if;

  -- Gate 3: streak · 3 consecutive audition_climb events including this one,
  -- and no audition_streak reward already granted since the current streak
  -- started. Lightweight — we only check the last 5 events, skipping
  -- any non-audition kinds in between (Scout voting noise).
  if v_is_climb then
    -- When was the most recent audition_streak granted to this creator?
    select max(created_at)
      into v_last_streak_at
      from ap_events
     where member_id = v_creator_id
       and kind = 'audition_streak';

    -- Count audition_climb events (including this insert) since then
    select count(*) into v_recent_climbs
      from ap_events
     where member_id = v_creator_id
       and kind      = 'audition_climb'
       and (v_last_streak_at is null or created_at > v_last_streak_at);

    -- The current event was just inserted by grant_ap above, so v_recent_climbs
    -- already includes it. Fire streak once when it hits 3.
    if v_recent_climbs >= 3 then
      perform grant_ap(v_creator_id, 'audition_streak', 50, null, null, new.project_id,
        '3 consecutive round climbs · on fire');
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_analysis_snapshot_audition on analysis_snapshots;
create trigger on_analysis_snapshot_audition
  after insert on analysis_snapshots
  for each row execute function on_analysis_snapshot_audition_rewards();
