-- Library Free/Trophy pivot (v8-aligned).
-- Paid marketplace was a hypothetical V1.5 revenue line; the ecosystem norm
-- (gstack 77k, awesome-cursorrules, Cursor Directory) is free-forever. We
-- drop pricing machinery entirely and keep what actually differentiates:
--   · Discovery auto-scanner
--   · Apply-to-my-repo one-click PR
--   · Provenance (graduated-project linkage)
--   · Adoption stats ("12 projects applied · 3 graduated with this")
-- Safe to re-run (guarded by IF EXISTS).

-- ── 1. Drop the feed view + paid index that reference is_free / price_cents ──
drop view  if exists md_library_feed;
drop index if exists idx_md_library_paid;
drop index if exists idx_md_library_free;

-- ── 2. Drop pricing enforcement trigger + function ──
drop trigger  if exists on_md_library_write on md_library;
drop function if exists enforce_md_library_rules() cascade;

-- ── 3. Drop md_purchases + its trigger/function (cascade cleans dependents) ──
drop trigger  if exists on_md_purchase_insert on md_purchases;
drop function if exists record_md_purchase_aggregates() cascade;
drop table    if exists md_purchases cascade;

-- ── 4. Drop price + revenue + purchase columns on md_library
-- is_free is a GENERATED column derived from price_cents; drop it first
-- or Postgres rejects the price_cents drop even in a single statement.
alter table md_library drop column if exists is_free;
alter table md_library
  drop column if exists price_cents,
  drop column if exists platform_fee_pct,
  drop column if exists revenue_cents,
  drop column if exists purchase_count;

-- Also drop the legacy CHECK constraint if it's still around
alter table md_library drop constraint if exists md_library_price_check;

-- ── 5. Slim verified_badge + author_grade stamping trigger
-- The old enforce trigger did pricing + stamping; now we only need the
-- stamping half. refresh_md_verified_badge() on members table keeps
-- existing rows in sync when total_graduated changes (unchanged).
create or replace function stamp_md_library_badges()
returns trigger as $$
declare
  v_grade           text;
  v_graduated_count integer;
begin
  if tg_op = 'INSERT' then
    select creator_grade, total_graduated
      into v_grade, v_graduated_count
      from members where id = new.creator_id;

    if v_grade is null then
      raise exception 'Creator % not found in members', new.creator_id;
    end if;

    new.author_grade   := v_grade;
    new.verified_badge := coalesce(v_graduated_count, 0) > 0;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_md_library_stamp on md_library;
create trigger on_md_library_stamp
  before insert on md_library
  for each row execute function stamp_md_library_badges();

-- ── 6. Adoption stats view · "12 projects applied · 3 graduated with this" ──
-- Counted from artifact_applications + projects. Joined on Library detail
-- + creator profile as a trophy surface. Replaces the revenue stat.
drop view if exists md_library_adoption;
create view md_library_adoption as
  select
    aa.md_id,
    count(distinct aa.applied_to_project)
      filter (where aa.applied_to_project is not null)                            as projects_applied,
    count(distinct aa.applied_to_project)
      filter (where p.status in ('graduated', 'valedictorian'))                    as projects_graduated,
    count(aa.id)                                                                   as total_applications,
    max(aa.created_at)                                                             as last_applied_at
  from artifact_applications aa
  left join projects p on p.id = aa.applied_to_project
  group by aa.md_id;

-- ── 7. Recreate md_library_feed without is_free · adds adoption counts ──
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
    coalesce(ad.projects_applied, 0)         as projects_applied_count,
    coalesce(ad.projects_graduated, 0)       as projects_graduated_count,
    coalesce(ad.total_applications, 0)       as total_applications_count
  from md_library ml
  left join members m             on m.id      = ml.creator_id
  left join projects p            on p.id      = ml.linked_project_id
  left join md_library_adoption ad on ad.md_id = ml.id
  where ml.status = 'published' and ml.is_public = true
  order by
    ml.verified_badge desc,
    coalesce(ad.projects_graduated, 0) desc,
    coalesce(ad.projects_applied, 0) desc,
    ml.downloads_count desc,
    ml.created_at desc;
