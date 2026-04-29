// §11-NEW · Ladder leaderboard data layer.
//
// Reads from `ladder_rankings_mv` (materialized view · refreshed every 5min
// for today/week, 1h for month/all_time). The MV groups projects into one
// of six categories (saas · tool · ai_agent · game · library · other) and
// applies the 5-tier tiebreaker — score_total desc, last-audit desc,
// score_auto desc, audit_count asc, project.created_at asc.
//
// This module is graceful: until Migration A is applied, the MV doesn't
// exist and queries silently return [] so callers can render an empty
// state instead of throwing. Once the migration lands, the same code
// starts returning rows without redeploy.

import { supabase } from './supabase'
import type { LadderCategory, LadderWindow, Project } from './supabase'

// ── In-memory cache (SWR pattern · 2026-04-30) ─────────────────
// /ladder reads the same MV-backed data on every navigation. Cache
// keyed by (category, window, view) so back-and-forth between filter
// chips is instant. TTL keeps it shorter than the MV cron (5min) so
// stale data doesn't pile up; mount always background-refetches.
//
// Updates reflect immediately because:
//   1. New data overwrites cache on every fetch resolution
//   2. invalidateLadderCache() can be called from anywhere (e.g.
//      admin re-audit success path) to force the next mount to
//      bypass cache entirely
const CACHE_TTL_MS = 30_000

interface CacheEntry<T> { data: T; fetchedAt: number }
const listCache    = new Map<string, CacheEntry<LadderRow[]>>()
const projectCache = new Map<string, CacheEntry<Array<{ project: Project; rank: number }>>>()
const countsCache  = new Map<string, CacheEntry<Record<LadderCategory, number>>>()

function cacheKey(category: LadderCategory, window: LadderWindow): string {
  return `${category}|${window}`
}
function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS
}

/** Force the next fetch to bypass cache (e.g. after a triggered audit). */
export function invalidateLadderCache(): void {
  listCache.clear()
  projectCache.clear()
  countsCache.clear()
}

/** Read whatever's cached now · used by the page for instant first paint. */
export function getCachedLadder(category: LadderCategory, window: LadderWindow): LadderRow[] | null {
  const e = listCache.get(cacheKey(category, window))
  return isFresh(e) ? e.data : null
}
export function getCachedLadderProjects(category: LadderCategory, window: LadderWindow): Array<{ project: Project; rank: number }> | null {
  const e = projectCache.get(cacheKey(category, window))
  return isFresh(e) ? e.data : null
}
export function getCachedCounts(window: LadderWindow): Record<LadderCategory, number> | null {
  const e = countsCache.get(window)
  return isFresh(e) ? e.data : null
}

export interface LadderRow {
  project_id:    string
  rank:          number
  category:      LadderCategory
  score_total:   number
  score_auto:    number
  audit_count:   number
  audited_at:    string | null
  commit_sha:    string | null
  project_name:  string
  github_url:    string | null
  thumbnail_url: string | null
  status:        string
  creator_id:    string | null
  creator_name:  string | null
}

const RANK_COLUMN: Record<LadderWindow, string> = {
  today:    'rank_today',
  week:     'rank_week',
  month:    'rank_month',
  all_time: 'rank_all_time',
}

export async function fetchLadder(
  category: LadderCategory,
  window:   LadderWindow,
  limit = 50,
): Promise<LadderRow[]> {
  const rankCol = RANK_COLUMN[window]

  // Two-step instead of embedded join: PostgREST won't auto-infer the
  // ladder_rankings_mv ↔ projects relationship (MV has no FK constraints,
  // so PGRST200 'no relationship found' is what came back). Pull MV rows
  // first, then fetch the matching projects in a separate query.
  const { data: mvRows, error } = await supabase
    .from('ladder_rankings_mv')
    .select(`project_id, category, score_total, score_auto, audit_count, audited_at, commit_sha, ${rankCol}`)
    .eq('category', category)
    .not(rankCol, 'is', null)
    .order(rankCol, { ascending: true })
    .limit(limit)
  if (error || !mvRows || mvRows.length === 0) return []

  type MvRaw = {
    project_id:  string
    category:    LadderCategory
    score_total: number
    score_auto:  number
    audit_count: number
    audited_at:  string | null
    commit_sha:  string | null
    [k: string]: unknown
  }

  const ids = (mvRows as unknown as MvRaw[]).map(r => r.project_id)
  const { data: pj } = await supabase
    .from('projects')
    .select('id, project_name, github_url, thumbnail_url, status, creator_id, creator_name')
    .in('id', ids)
  type ProjRow = {
    id: string; project_name: string; github_url: string | null
    thumbnail_url: string | null; status: string
    creator_id: string | null; creator_name: string | null
  }
  const pmap = new Map<string, ProjRow>(
    ((pj as unknown as ProjRow[]) ?? []).map(p => [p.id, p])
  )

  const result = (mvRows as unknown as MvRaw[]).map(r => {
    const p = pmap.get(r.project_id)
    return {
      project_id:    r.project_id,
      rank:          (r[rankCol] as number) ?? 0,
      category:      r.category,
      score_total:   r.score_total,
      score_auto:    r.score_auto,
      audit_count:   r.audit_count,
      audited_at:    r.audited_at,
      commit_sha:    r.commit_sha,
      project_name:  p?.project_name ?? '—',
      github_url:    p?.github_url ?? null,
      thumbnail_url: p?.thumbnail_url ?? null,
      status:        p?.status ?? 'active',
      creator_id:    p?.creator_id ?? null,
      creator_name:  p?.creator_name ?? null,
    }
  })
  listCache.set(cacheKey(category, window), { data: result, fetchedAt: Date.now() })
  return result
}

// Editorial-card view of /ladder · same MV ordering, full Project rows.
// Two-step: pull ranked project_ids from MV, then a separate query for
// the full PUBLIC_PROJECT_COLUMNS shape so cards have description,
// tech_layers, etc. Empty when MV is missing.
export async function fetchLadderProjects(
  category: LadderCategory,
  window:   LadderWindow,
  limit = 50,
): Promise<{ project: Project; rank: number }[]> {
  const rankCol = RANK_COLUMN[window]
  const { data: ids, error: idsErr } = await supabase
    .from('ladder_rankings_mv')
    .select(`project_id, ${rankCol}`)
    .eq('category', category)
    .not(rankCol, 'is', null)
    .order(rankCol, { ascending: true })
    .limit(limit)
  if (idsErr || !ids || ids.length === 0) return []

  const idList = (ids as unknown as Array<{ project_id: string }>).map(r => r.project_id)
  const { PUBLIC_PROJECT_COLUMNS } = await import('./supabase')
  const { data: projects } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .in('id', idList)
  if (!projects) return []

  const rankMap = new Map<string, number>()
  for (const r of ids as unknown as Array<{ project_id: string; [k: string]: unknown }>) {
    rankMap.set(r.project_id, r[rankCol] as number)
  }
  // Preserve MV order
  const projectMap = new Map<string, Project>((projects as unknown as Project[]).map(p => [p.id, p]))
  const result = idList
    .map(id => projectMap.get(id))
    .filter((p): p is Project => !!p)
    .map(p => ({ project: p, rank: rankMap.get(p.id) ?? 0 }))
  projectCache.set(cacheKey(category, window), { data: result, fetchedAt: Date.now() })
  return result
}

// Per-category counts for the chip strip ("SaaS · 47 ranked").
export async function fetchLadderCounts(window: LadderWindow): Promise<Record<LadderCategory, number>> {
  const rankCol = RANK_COLUMN[window]
  const { data, error } = await supabase
    .from('ladder_rankings_mv')
    .select(`category, ${rankCol}`)
    .not(rankCol, 'is', null)

  const empty: Record<LadderCategory, number> = {
    saas: 0, tool: 0, ai_agent: 0, game: 0, library: 0, other: 0,
  }
  if (error || !data) return empty

  for (const row of data as unknown as Array<{ category: LadderCategory }>) {
    if (row.category in empty) empty[row.category] = (empty[row.category] ?? 0) + 1
  }
  countsCache.set(window, { data: empty, fetchedAt: Date.now() })
  return empty
}
