-- PRD v1.7 · Library social-signal pivot
-- Quality signal shifts from 4-axis Claude rubric (hard gate) to community
-- signals: creator grade + downloads + adoption + graduated provenance.
-- 4-axis scoring column stays as advisory only — no longer gates paid listings.
--
-- Rebuilds:
--   · enforce_md_library_rules — drops rule E (discovery_total_score >= 16 gate).
--     Keeps A (Rookie cannot sell), B (prompt pack free), C (Premium = Maker+),
--     D (Scaffold tier = Architect+), F (auto-stamp author_grade · verified_badge).
--   · md_library_feed — adds reputation_score column + default ordering by it.
--     Composite = grade weight + graduated-with-this × 5 + applied × 2 +
--                 downloads × 1 + verified_badge bonus.

begin;

-- ── 1. enforce_md_library_rules · drop 4-axis floor ──────────
create or replace function enforce_md_library_rules()
returns trigger as $$
declare
  v_grade           text;
  v_graduated_count integer;
begin
  select creator_grade, total_graduated
    into v_grade, v_graduated_count
    from members where id = new.creator_id;

  if v_grade is null then
    raise exception 'Creator % not found in members', new.creator_id;
  end if;

  -- A · Rookie cannot sell
  if new.price_cents > 0 and v_grade = 'Rookie' then
    raise exception 'Paid listings require Builder grade or higher (current: %). Publish free to build reputation.', v_grade;
  end if;

  -- B · Prompt packs must be free (commoditized)
  if new.price_cents > 0 and new.target_format = 'prompt_pack' then
    raise exception 'Prompt packs must be published free — they are commoditized. Set price to $0.';
  end if;

  -- C · Premium tier (> $30) needs Maker+
  if new.price_cents > 2999 and v_grade not in ('Maker', 'Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Premium pricing (> $30) requires Maker grade or higher (current: %).', v_grade;
  end if;

  -- D · Scaffold tier (> $100) needs Architect+
  if new.price_cents > 9999 and v_grade not in ('Architect', 'Vibe Engineer', 'Legend') then
    raise exception 'Scaffold pricing (> $100) requires Architect grade or higher (current: %).', v_grade;
  end if;

  -- (v1.7 pivot · rule E removed: discovery_total_score no longer gates paid
  --  listings. Community signal = quality signal.)

  -- F · Auto-stamp verified_badge + author_grade on INSERT
  if tg_op = 'INSERT' then
    new.author_grade   := v_grade;
    new.verified_badge := coalesce(v_graduated_count, 0) > 0;
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- ── 2. md_library_feed · reputation composite + default order ──
drop view if exists md_library_feed;
create view md_library_feed as
  select
    ml.*,
    m.display_name                           as author_name,
    m.email                                  as author_email,
    m.creator_grade                          as current_author_grade,
    m.avatar_url                             as author_avatar_url,
    p.project_name                           as source_project_name,
    p.score_total                            as source_project_score,
    p.status                                 as source_project_status,
    coalesce(ad.projects_applied,    0)      as projects_applied_count,
    coalesce(ad.projects_graduated,  0)      as projects_graduated_count,
    coalesce(ad.total_applications,  0)      as total_applications_count,
    (
      case m.creator_grade
        when 'Legend'        then 60
        when 'Vibe Engineer' then 40
        when 'Architect'     then 25
        when 'Maker'         then 15
        when 'Builder'       then 8
        else 0
      end
      + coalesce(ad.projects_graduated, 0) * 5
      + coalesce(ad.projects_applied,   0) * 2
      + ml.downloads_count                 * 1
      + case when ml.verified_badge then 10 else 0 end
    )                                        as reputation_score
  from md_library ml
  left join members m              on m.id      = ml.creator_id
  left join projects p             on p.id      = ml.linked_project_id
  left join md_library_adoption ad on ad.md_id  = ml.id
  where ml.status = 'published' and ml.is_public = true
  order by
    (
      case m.creator_grade
        when 'Legend'        then 60
        when 'Vibe Engineer' then 40
        when 'Architect'     then 25
        when 'Maker'         then 15
        when 'Builder'       then 8
        else 0
      end
      + coalesce(ad.projects_graduated, 0) * 5
      + coalesce(ad.projects_applied,   0) * 2
      + ml.downloads_count                 * 1
      + case when ml.verified_badge then 10 else 0 end
    ) desc,
    ml.created_at desc;

commit;
