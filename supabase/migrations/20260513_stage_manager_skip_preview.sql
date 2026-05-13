-- ───────────────────────────────────────────────────────────────────────────
-- Stage Manager · skip preview-lane projects (2026-05-13)
-- ───────────────────────────────────────────────────────────────────────────
-- CLI walk-on + URL fast lane both land as status='preview'. The Stage
-- Manager triggers were posting system comments on every preview row's
-- created+snapshot events — flooding the public comment streams with
-- bot-narrator chatter for projects whose creators never opted into a
-- community presence. CEO directive 2026-05-13: pull all stage-manager
-- output from preview-lane projects, then carve them their own surface
-- (Open Mic) in a follow-up.
--
-- Both INSERT triggers now early-return when NEW.status = 'preview'.
-- Graduation trigger untouched — preview rows never reach a graduation
-- grade so the guard is a no-op there.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function stage_manager_on_project_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg text;
begin
  -- Skip walk-on / URL fast lane · they share status='preview'.
  if NEW.status = 'preview' then
    return NEW;
  end if;

  msg := case (floor(random() * 12))::int
    when 0  then 'This build stepped on stage. First audit underway.'
    when 1  then 'Welcome to the audition. Audit results posting in real time.'
    when 2  then 'New entry on the ladder. The engine is reading the repo now.'
    when 3  then 'Lights up. This build just took the stage.'
    when 4  then 'Curtain''s up. First round audit running.'
    when 5  then 'Stepped on stage. First read, anyone?'
    when 6  then 'On stage. Who saw this one coming?'
    when 7  then 'New build, new round. What''s your read?'
    when 8  then 'A new audition. Drop your first impression below.'
    when 9  then 'Auditioning now. The room''s yours — what do you see?'
    when 10 then 'Stepped on stage. What jumps out at you?'
    else         'New entry. First take from the room?'
  end;

  begin
    insert into comments (project_id, member_id, text, kind, event_kind, event_meta)
    values (NEW.id, null, msg, 'system', 'registered',
            jsonb_build_object('initial_score', NEW.score_total));
  exception when others then
    raise warning 'stage_manager registered comment failed for project %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end$$;

create or replace function stage_manager_on_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta_val   int := NEW.score_total_delta;
  abs_delta   int;
  rounds      int;
  proj_status text;
  msg         text;
begin
  if delta_val is null then
    return NEW;
  end if;

  abs_delta := abs(delta_val);
  if abs_delta < 6 then
    return NEW;
  end if;

  -- Skip preview-lane (walk-on / URL fast lane). Lookup since the snapshot
  -- row doesn't carry status itself.
  select status into proj_status from projects where id = NEW.project_id;
  if proj_status = 'preview' then
    return NEW;
  end if;

  select count(*) into rounds
    from analysis_snapshots
    where project_id = NEW.project_id;

  if delta_val > 0 then
    msg := case (floor(random() * 10))::int
      when 0 then 'Round ' || rounds::text || ': +' || delta_val::text
                  || '. Score ' || NEW.score_total::text || '/100.'
      when 1 then 'Up +' || delta_val::text || ' this round. Now '
                  || NEW.score_total::text || '/100.'
      when 2 then 'Round ' || rounds::text || ' audit posted. Score climbed '
                  || delta_val::text || ' to ' || NEW.score_total::text || '.'
      when 3 then 'Score is on the climb: ' || NEW.score_total::text
                  || '/100 (+' || delta_val::text || ').'
      when 4 then '+' || delta_val::text || ' to ' || NEW.score_total::text
                  || '. What changed this round?'
      when 5 then 'Round ' || rounds::text || ': +' || delta_val::text
                  || '. What jumped first — tests, perf, the brief?'
      when 6 then 'Score climbed +' || delta_val::text
                  || '. Anyone want to call out where the lift came from?'
      when 7 then '+' || delta_val::text || ' this round. Now '
                  || NEW.score_total::text || '. Who saw this coming?'
      when 8 then 'Score reads ' || NEW.score_total::text || ' (+' || delta_val::text
                  || '). What''d the creator do differently?'
      else        '+' || delta_val::text || '. What stood out in the new report?'
    end;
  else
    msg := case (floor(random() * 10))::int
      when 0 then 'Round ' || rounds::text || ': ' || delta_val::text
                  || '. Score ' || NEW.score_total::text || '/100.'
      when 1 then abs_delta::text || ' off this round. Now '
                  || NEW.score_total::text || '/100.'
      when 2 then 'Round ' || rounds::text || ' audit posted. Score moved '
                  || delta_val::text || ' to ' || NEW.score_total::text || '.'
      when 3 then 'Score now ' || NEW.score_total::text || ' (' || delta_val::text
                  || '). New entries in the report.'
      when 4 then delta_val::text || ' to ' || NEW.score_total::text
                  || '. Worth a re-look — what slipped?'
      when 5 then 'Round ' || rounds::text || ': ' || delta_val::text
                  || '. Anyone in the room with eyes on the new concerns?'
      when 6 then 'Score moved ' || delta_val::text
                  || '. What flagged that wasn''t there before?'
      when 7 then 'Down ' || abs_delta::text || ' this round. What''s the read?'
      when 8 then delta_val::text || ' this round. Now '
                  || NEW.score_total::text || '. Where''s the creator''s next move?'
      else        'Round ' || rounds::text || ' delta: ' || delta_val::text
                  || '. Notes from the audience?'
    end;
  end if;

  begin
    insert into comments (project_id, member_id, text, kind, event_kind, event_meta)
    values (NEW.project_id, null, msg, 'system', 'score_jump',
            jsonb_build_object(
              'delta',       delta_val,
              'score_total', NEW.score_total,
              'round',       rounds
            ));
  exception when others then
    raise warning 'stage_manager score_jump comment failed for snapshot %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end$$;

-- ─── Cleanup existing stage-manager output on preview rows ───
-- All 'registered' and 'score_jump' system comments tied to a preview
-- project get purged. Graduation system comments left alone (none exist
-- on preview rows by construction).
delete from comments
where kind = 'system'
  and event_kind in ('registered', 'score_jump')
  and project_id in (select id from projects where status = 'preview');
