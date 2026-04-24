-- ════════════════════════════════════════════════════════════════════════════
-- 20260425_library_feed_view_refresh.sql
--
-- Follow-up to 20260425_library_v2_ui.sql. PostgreSQL materializes `SELECT *`
-- at CREATE VIEW time, so `md_library_feed` still exposes the pre-intent
-- column list. Dropping and recreating the view with the identical body
-- (and no new logic) re-expands `ml.*` to include the `intent` column the
-- previous migration added.
--
-- Non-destructive · idempotent.
-- ════════════════════════════════════════════════════════════════════════════

begin;

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
