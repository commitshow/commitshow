-- Extend prevent_self_applaud to cover the 4 new target_types
-- (ask · office_hours · open_mic · post_comment) introduced in
-- 20260515_applaud_target_widen.sql.
--
-- PL/pgSQL CASE WITHOUT ELSE raises an "case not found" exception when
-- new.target_type doesn't match any WHEN branch. The CHECK widening
-- ran first, so the row was structurally allowed; the trigger fired
-- afterward and crashed every applaud on a new type. Bug shipped:
-- every applaud on an Open Mic post / Build Log comment / Stack /
-- Ask / Office Hours / community_post_comments returned
-- "case not found" via PostgREST 500.
--
-- Fix: add WHEN branches for every new target_type. Also add an
-- explicit ELSE so future widenings fail loudly with a clear message
-- instead of the cryptic CASE error.

create or replace function prevent_self_applaud()
returns trigger language plpgsql security definer as $$
declare
  v_owner uuid;
begin
  case new.target_type
    when 'product' then
      select creator_id into v_owner
        from projects where id = new.target_id;
    when 'comment' then
      select member_id into v_owner
        from comments where id = new.target_id;
    when 'build_log' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'build_log';
    when 'stack' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'stack';
    when 'ask' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'ask';
    when 'office_hours' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'office_hours';
    when 'open_mic' then
      select author_id into v_owner
        from community_posts
       where id = new.target_id and type = 'open_mic';
    when 'post_comment' then
      select author_id into v_owner
        from community_post_comments where id = new.target_id;
    when 'brief' then
      select p.creator_id into v_owner
        from build_briefs b
        join projects p on p.id = b.project_id
       where b.id = new.target_id;
    when 'recommit' then
      select p.creator_id into v_owner
        from analysis_snapshots s
        join projects p on p.id = s.project_id
       where s.id = new.target_id;
    else
      -- Loud failure when a new target_type is added to the CHECK
      -- constraint but not to this function. Matches the migration-audit
      -- memory rule: column/value widening must update every function +
      -- trigger that branches on it.
      raise exception 'prevent_self_applaud: unknown target_type %', new.target_type
        using errcode = 'P0001';
  end case;

  if v_owner is not null and v_owner = new.member_id then
    raise exception 'Self-applaud blocked (% / %)', new.target_type, new.target_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
