-- PRD v1.7: Vote weighting removed.
-- All Forecast votes count as weight = 1.0 regardless of Scout tier.
-- Tier differentiation for Scouts is now carried entirely by the monthly
-- Voteg권 quantity (Bronze 20 / Silver 40 / Gold 60 / Platinum 80).
-- Craft Award Applaud keeps its tier-weighted scale (Applaud Week only).

create or replace function enforce_vote_cap_and_increment()
returns trigger as $$
declare
  v_tier text;
  v_used integer;
  v_reset timestamptz;
  v_cap integer;
begin
  if new.member_id is null then
    return new;
  end if;

  select tier, monthly_votes_used, votes_reset_at
    into v_tier, v_used, v_reset
    from members
   where id = new.member_id;

  -- Month rollover
  if v_reset is null or now() >= v_reset then
    v_used := 0;
    update members
       set monthly_votes_used = 0,
           votes_reset_at = (date_trunc('month', now()) + interval '1 month')
     where id = new.member_id;
  end if;

  v_cap := monthly_vote_cap(coalesce(v_tier, 'Bronze'));

  if v_used >= v_cap then
    raise exception 'Monthly vote cap reached for tier %: % / %', coalesce(v_tier, 'Bronze'), v_used, v_cap
      using errcode = 'P0001';
  end if;

  update members
     set monthly_votes_used = monthly_votes_used + 1
   where id = new.member_id;

  -- v1.7 change · uniform vote weight 1.0 (tier recorded for analytics only)
  new.scout_tier := coalesce(v_tier, 'Bronze');
  new.weight     := 1.0;

  return new;
end;
$$ language plpgsql security definer;

-- Retroactively normalize existing votes (season zero hasn't started · safe).
update votes set weight = 1.0 where weight is distinct from 1.0;
