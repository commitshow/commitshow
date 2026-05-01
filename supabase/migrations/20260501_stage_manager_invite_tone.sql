-- ───────────────────────────────────────────────────────────────────────────
-- Stage Manager · v2 voice · invite tone
-- ───────────────────────────────────────────────────────────────────────────
-- The first pass of Stage Manager messages was descriptive only ("Round 3:
-- +12 to 82. Real movement."). On a quiet thread this reads as "the engine
-- already summarized it" and humans walk away. v2 swaps in question-ended
-- variants so roughly half the time the Stage Manager hands the mic to the
-- room. Voice still neutral and brand-safe (no failure language per §1-A ⑤,
-- no "AI" word per §19.1 rule 11).
--
-- Pure CREATE OR REPLACE FUNCTION on the three trigger functions added in
-- 20260501_stage_manager_system_comments.sql. Schema and triggers themselves
-- are untouched.
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
  msg := case (floor(random() * 12))::int
    -- ── descriptive (5)
    when 0  then 'This build stepped on stage. First audit underway.'
    when 1  then 'Welcome to the audition. Audit results posting in real time.'
    when 2  then 'New entry on the ladder. The engine is reading the repo now.'
    when 3  then 'Lights up. This build just took the stage.'
    when 4  then 'Curtain''s up. First round audit running.'
    -- ── invite (7)
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
  delta_val int := NEW.score_total_delta;
  abs_delta int;
  rounds    int;
  msg       text;
begin
  if delta_val is null then
    return NEW;
  end if;

  abs_delta := abs(delta_val);
  if abs_delta < 6 then
    return NEW;
  end if;

  select count(*) into rounds
    from analysis_snapshots
    where project_id = NEW.project_id;

  if delta_val > 0 then
    msg := case (floor(random() * 10))::int
      -- ── descriptive (4)
      when 0 then 'Round ' || rounds::text || ': +' || delta_val::text
                  || '. Score ' || NEW.score_total::text || '/100.'
      when 1 then 'Up +' || delta_val::text || ' this round. Now '
                  || NEW.score_total::text || '/100.'
      when 2 then 'Round ' || rounds::text || ' audit posted. Score climbed '
                  || delta_val::text || ' to ' || NEW.score_total::text || '.'
      when 3 then 'Score is on the climb: ' || NEW.score_total::text
                  || '/100 (+' || delta_val::text || ').'
      -- ── invite (6)
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
      -- ── descriptive (4)
      when 0 then 'Round ' || rounds::text || ': ' || delta_val::text
                  || '. Score ' || NEW.score_total::text || '/100.'
      when 1 then abs_delta::text || ' off this round. Now '
                  || NEW.score_total::text || '/100.'
      when 2 then 'Round ' || rounds::text || ' audit posted. Score moved '
                  || delta_val::text || ' to ' || NEW.score_total::text || '.'
      when 3 then 'Score now ' || NEW.score_total::text || ' (' || delta_val::text
                  || '). New entries in the report.'
      -- ── invite (6)
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

create or replace function stage_manager_on_graduation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg text;
begin
  if NEW.graduation_grade is null then
    return NEW;
  end if;
  if OLD.graduation_grade is not null and OLD.graduation_grade = NEW.graduation_grade then
    return NEW;
  end if;
  if NEW.graduation_grade not in ('valedictorian','honors','graduate') then
    return NEW;
  end if;

  if NEW.graduation_grade = 'valedictorian' then
    msg := case (floor(random() * 6))::int
      -- ── descriptive (3)
      when 0 then 'Valedictorian. Hall of Fame entry permanent. Season '
                  || coalesce(NEW.season::text, 'Zero') || '.'
      when 1 then 'Top of the season. Valedictorian for Season '
                  || coalesce(NEW.season::text, 'Zero') || '.'
      when 2 then 'Valedictorian. Final score ' || NEW.score_total::text
                  || '/100. Hall of Fame.'
      -- ── invite (3)
      when 3 then 'Valedictorian. The room saw the climb in real time — anyone want to mark it?'
      when 4 then 'Top score of the season. What did the creator nail that the rest of us missed?'
      else        'Valedictorian. Tell the creator what worked.'
    end;
  elsif NEW.graduation_grade = 'honors' then
    msg := case (floor(random() * 6))::int
      when 0 then 'Honors graduation. Top 5% of Season '
                  || coalesce(NEW.season::text, 'Zero') || '. The build is in the archive.'
      when 1 then 'Honors. Top 5% of the season. Final score '
                  || NEW.score_total::text || '/100.'
      when 2 then 'Honors graduate of Season '
                  || coalesce(NEW.season::text, 'Zero') || '.'
      when 3 then 'Honors. Tell the creator what worked.'
      when 4 then 'Honors graduation. What''s the takeaway from this run?'
      else        'Top 5% of the season. The room saw it — what carried the build?'
    end;
  else
    msg := case (floor(random() * 6))::int
      when 0 then 'Graduated. Top 20% of Season '
                  || coalesce(NEW.season::text, 'Zero') || '. Brief now public.'
      when 1 then 'Season ' || coalesce(NEW.season::text, 'Zero')
                  || ' graduate. Final score ' || NEW.score_total::text || '/100.'
      when 2 then 'Graduated. The build moves to the archive.'
      when 3 then 'Graduate of Season ' || coalesce(NEW.season::text, 'Zero')
                  || '. The creator made it — leave them a note.'
      when 4 then 'Graduated. What''s your one-line take on this run?'
      else        'Top 20%. Notes from the audience?'
    end;
  end if;

  begin
    insert into comments (project_id, member_id, text, kind, event_kind, event_meta)
    values (NEW.id, null, msg, 'system', 'graduated',
            jsonb_build_object(
              'grade',       NEW.graduation_grade,
              'final_score', NEW.score_total,
              'season',      NEW.season
            ));
  exception when others then
    raise warning 'stage_manager graduated comment failed for project %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end$$;
