-- Bundle metadata columns on md_library + Storage RLS policies for the
-- library-bundles bucket. Bucket itself is provisioned via the Storage
-- REST API (one-shot, idempotent — bucket creation isn't a SQL concern).
--
-- Bundle URL format · Storage public bucket:
--   https://<ref>.supabase.co/storage/v1/object/public/library-bundles/<slug>/<version>.tar.gz
--
-- The CLI fetches by URL, sha256-verifies, untars to its cache dir, and
-- runs the entry script declared in pack.yaml.

-- 1) md_library bundle metadata columns
ALTER TABLE public.md_library
  ADD COLUMN IF NOT EXISTS bundle_url        text,
  ADD COLUMN IF NOT EXISTS bundle_sha256     text,
  ADD COLUMN IF NOT EXISTS bundle_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS bundle_version    text,
  ADD COLUMN IF NOT EXISTS manifest_version  text DEFAULT 'v0.1',
  ADD COLUMN IF NOT EXISTS slug              text;

-- Slug is the install identifier · `commitshow install <slug>`. Unique
-- among published listings so the CLI lookup is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_md_library_slug
  ON public.md_library(slug)
  WHERE slug IS NOT NULL;

-- Grant read on new columns to anon + authenticated (Library is public).
GRANT SELECT (bundle_url, bundle_sha256, bundle_size_bytes, bundle_version,
              manifest_version, slug)
  ON public.md_library TO anon, authenticated;

-- 2) Storage policies on library-bundles bucket
-- Public read · matches the public marketplace model.
DROP POLICY IF EXISTS "library_bundles_public_read" ON storage.objects;
CREATE POLICY "library_bundles_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'library-bundles');

-- Admin write only · staff seeds the first packs. Creator-publish flow
-- (V1.5) will broaden this to verified Builder+ creators with their own
-- folder prefix.
DROP POLICY IF EXISTS "library_bundles_admin_write" ON storage.objects;
CREATE POLICY "library_bundles_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'library-bundles'
    AND EXISTS (
      SELECT 1 FROM public.members
       WHERE id = auth.uid() AND COALESCE(is_admin, false) = true
    )
  );

DROP POLICY IF EXISTS "library_bundles_admin_update" ON storage.objects;
CREATE POLICY "library_bundles_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'library-bundles'
    AND EXISTS (
      SELECT 1 FROM public.members
       WHERE id = auth.uid() AND COALESCE(is_admin, false) = true
    )
  );

DROP POLICY IF EXISTS "library_bundles_admin_delete" ON storage.objects;
CREATE POLICY "library_bundles_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'library-bundles'
    AND EXISTS (
      SELECT 1 FROM public.members
       WHERE id = auth.uid() AND COALESCE(is_admin, false) = true
    )
  );
