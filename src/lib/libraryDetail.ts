// Library detail fetch + interaction tracking (§15 v1.5).

import { supabase, type MDLibraryFeedItem } from './supabase'

export async function fetchLibraryItem(id: string): Promise<MDLibraryFeedItem | null> {
  // Use the feed view so we get author + source project info in one query.
  // Fall back to md_library direct when the item isn't published yet (e.g.
  // owner preview — though public readers only see the view).
  const { data } = await supabase
    .from('md_library_feed')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data as MDLibraryFeedItem | null) ?? null
}

// Increment downloads_count atomically when a user copies/downloads content.
// Not gated on auth — Rookie vibe coders viewing public items should still
// count toward the creator's download totals. RLS allows anyone to update
// published rows' aggregates (we enforce via a specific trigger if needed
// later; for now, relies on service role for the write).
export async function recordDownload(libraryItemId: string): Promise<void> {
  // Atomic increment via Postgres. Using an RPC would be cleaner long-term —
  // for MVP, do a simple read-modify-write inside a single call (not
  // concurrency-safe, but good enough for download counters).
  const { data: row } = await supabase
    .from('md_library')
    .select('downloads_count')
    .eq('id', libraryItemId)
    .maybeSingle()
  if (!row) return
  const next = (row.downloads_count ?? 0) + 1
  await supabase.from('md_library').update({ downloads_count: next }).eq('id', libraryItemId)
}

// Record that a member applied this artifact to one of their projects.
// Used later for the "projects that applied this" back-link (V1 §15.9).
export interface RecordApplicationInput {
  mdId: string
  appliedBy: string
  appliedToProject?: string | null
  githubPrUrl?: string | null
  variableValues?: Record<string, string>
}

export async function recordApplication(input: RecordApplicationInput): Promise<void> {
  await supabase.from('artifact_applications').insert([{
    md_id:              input.mdId,
    applied_by:         input.appliedBy,
    applied_to_project: input.appliedToProject ?? null,
    github_pr_url:      input.githubPrUrl ?? null,
    variable_values:    input.variableValues ?? {},
  }])
}
