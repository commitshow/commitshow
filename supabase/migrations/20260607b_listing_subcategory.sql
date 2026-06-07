-- Legit.Show directory — canonical category consolidation.
--
-- The ingest pipeline let Claude emit a free-text `category`, which fragmented
-- into ~95 mostly-singleton labels across 207 listings (and left 106 un-enriched
-- rows with no category at all). We collapse `category` to a fixed ~12-bucket
-- canonical taxonomy (done by a one-off reclassifier + enforced on future ingests)
-- and preserve the original granular label here as `subcategory` so detail pages
-- keep the finer signal and nothing is lost.

alter table public.listings add column if not exists subcategory text;

-- Snapshot the current granular label before the canonical overwrite.
update public.listings
   set subcategory = category
 where subcategory is null and category is not null;

-- listings already has table-level SELECT for anon/authenticated, but grant the
-- column explicitly to stay consistent with the project's column-grant discipline
-- (a missing grant surfaces as a silent 42501, not an error).
grant select (subcategory) on public.listings to anon, authenticated;
