-- Re-create md_library_feed view to surface the new bundle metadata
-- columns (slug, bundle_url, bundle_sha256, bundle_size_bytes,
-- bundle_version, manifest_version). Adding columns to the underlying
-- table doesn't propagate to a view that explicitly lists columns.
--
-- Behavior is otherwise unchanged · same WHERE / ORDER BY.

DROP VIEW IF EXISTS public.md_library_feed;
CREATE VIEW public.md_library_feed AS
SELECT
  ml.id,
  ml.created_at,
  ml.updated_at,
  ml.creator_id,
  ml.linked_project_id,
  ml.title,
  ml.description,
  ml.category,
  ml.tags,
  ml.content_md,
  ml.storage_path,
  ml.verified_badge,
  ml.downloads_count,
  ml.status,
  ml.preview,
  ml.author_grade,
  ml.is_public,
  ml.target_format,
  ml.target_tools,
  ml.variables,
  ml.bundle_files,
  ml.stack_tags,
  ml.discovery_total_score,
  ml.price_cents,
  ml.platform_fee_pct,
  ml.purchase_count,
  ml.revenue_cents,
  ml.is_free,
  ml.intent,
  -- v1 marketplace bundle metadata (2026-05-06)
  ml.slug,
  ml.bundle_url,
  ml.bundle_sha256,
  ml.bundle_size_bytes,
  ml.bundle_version,
  ml.manifest_version,
  -- Author + provenance
  m.display_name        AS author_name,
  m.creator_grade       AS current_author_grade,
  m.avatar_url          AS author_avatar_url,
  p.project_name        AS source_project_name,
  p.score_total         AS source_project_score,
  p.status              AS source_project_status,
  COALESCE(ad.projects_applied,     0::bigint) AS projects_applied_count,
  COALESCE(ad.projects_graduated,   0::bigint) AS projects_graduated_count,
  COALESCE(ad.total_applications,   0::bigint) AS total_applications_count,
  (CASE m.creator_grade
     WHEN 'Legend'        THEN 60
     WHEN 'Vibe Engineer' THEN 40
     WHEN 'Architect'     THEN 25
     WHEN 'Maker'         THEN 15
     WHEN 'Builder'       THEN 8
     ELSE 0 END
   + COALESCE(ad.projects_graduated, 0::bigint) * 5
   + COALESCE(ad.projects_applied,   0::bigint) * 2
   + ml.downloads_count * 1
   + CASE WHEN ml.verified_badge THEN 10 ELSE 0 END
  ) AS reputation_score
FROM md_library ml
  LEFT JOIN members             m  ON m.id  = ml.creator_id
  LEFT JOIN projects            p  ON p.id  = ml.linked_project_id
  LEFT JOIN md_library_adoption ad ON ad.md_id = ml.id
WHERE ml.status = 'published' AND ml.is_public = true
ORDER BY
  (CASE m.creator_grade
     WHEN 'Legend'        THEN 60
     WHEN 'Vibe Engineer' THEN 40
     WHEN 'Architect'     THEN 25
     WHEN 'Maker'         THEN 15
     WHEN 'Builder'       THEN 8
     ELSE 0 END
   + COALESCE(ad.projects_graduated, 0::bigint) * 5
   + COALESCE(ad.projects_applied,   0::bigint) * 2
   + ml.downloads_count * 1
   + CASE WHEN ml.verified_badge THEN 10 ELSE 0 END
  ) DESC,
  ml.created_at DESC;

GRANT SELECT ON public.md_library_feed TO anon, authenticated;
