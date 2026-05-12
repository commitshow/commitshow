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

function cacheKey(category: LadderCategory | 'all', window: LadderWindow): string {
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
export function getCachedLadder(category: LadderCategory | 'all', window: LadderWindow): LadderRow[] | null {
  const e = listCache.get(cacheKey(category, window))
  return isFresh(e) ? e.data : null
}
export function getCachedLadderProjects(category: LadderCategory | 'all', window: LadderWindow): Array<{ project: Project; rank: number }> | null {
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
  /** Denormalized form_factor from projects.form_factor. Drives the
   *  Ladder form-filter UI and the inline 'audited as X' tag below
   *  the score so visitors don't compare a library 85 to an app 85
   *  without knowing the rubric shifted. */
  form_factor:   'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown' | null
  slug:          string | null
  // Streak signal · pulled from ladder_streaks, keyed by (project_id,
  // current viewing time_window). Null when the project isn't currently
  // in Top 50 for that window. `longest_streak_days` is the project's
  // PB · `current_top_n` is what tier they're parked at right now.
  current_top_n:        number | null
  longest_streak_days:  number | null
  total_days_in_top_50: number | null
}

const RANK_COLUMN: Record<LadderWindow, string> = {
  today:    'rank_today',
  week:     'rank_week',
  month:    'rank_month',
  all_time: 'rank_all_time',
}

export async function fetchLadder(
  category: LadderCategory | 'all',
  window:   LadderWindow,
  limit = 50,
): Promise<LadderRow[]> {
  const rankCol = RANK_COLUMN[window]

  // Two-step instead of embedded join: PostgREST won't auto-infer the
  // ladder_rankings_mv ↔ projects relationship (MV has no FK constraints,
  // so PGRST200 'no relationship found' is what came back). Pull MV rows
  // first, then fetch the matching projects in a separate query.
  //
  // 'all' bucket: skip the category eq filter and re-rank globally by
  // score_total. The MV's rank_* columns are per-category partitions,
  // so for an All-view we have to assign sequential ranks ourselves.
  let q = supabase
    .from('ladder_rankings_mv')
    .select(`project_id, category, score_total, score_auto, audit_count, audited_at, commit_sha, ${rankCol}`)
  if (category !== 'all') q = q.eq('category', category)
  if (window !== 'all_time') q = q.not(rankCol, 'is', null)
  q = category === 'all'
    // Global view · order by score so re-ranked sequence reads as a
    // single overall leaderboard.
    ? q.order('score_total', { ascending: false })
    : q.order(rankCol, { ascending: true })
  const { data: mvRows, error } = await q.limit(limit)
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
  // Parallel: project rows + streak rows for the current time window.
  // Each project has at most one streak row per (project_id, time_window)
  // because a project belongs to exactly one category.
  const [{ data: pj }, { data: streakRows }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, project_name, github_url, thumbnail_url, status, creator_id, creator_name, form_factor, slug')
      .in('id', ids),
    supabase
      .from('ladder_streaks')
      .select('project_id, current_top_n, longest_streak_days, total_days_in_top_50')
      .in('project_id', ids)
      .eq('time_window', window),
  ])
  type ProjRow = {
    id: string; project_name: string; github_url: string | null
    thumbnail_url: string | null; status: string
    creator_id: string | null; creator_name: string | null
    form_factor: LadderRow['form_factor']; slug: string | null
  }
  type StreakRow = {
    project_id: string
    current_top_n:        number | null
    longest_streak_days:  number | null
    total_days_in_top_50: number | null
  }
  const pmap = new Map<string, ProjRow>(
    ((pj as unknown as ProjRow[]) ?? []).map(p => [p.id, p])
  )
  const smap = new Map<string, StreakRow>(
    ((streakRows as unknown as StreakRow[]) ?? []).map(s => [s.project_id, s])
  )

  const result = (mvRows as unknown as MvRaw[]).map((r, i) => {
    const p = pmap.get(r.project_id)
    const s = smap.get(r.project_id)
    return {
      project_id:    r.project_id,
      // 'all' view: assign sequential rank from sort order (score desc)
      // since MV's rank_* are partitioned per-category.
      rank:          category === 'all' ? i + 1 : ((r[rankCol] as number) ?? 0),
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
      form_factor:   p?.form_factor ?? null,
      slug:          p?.slug ?? null,
      current_top_n:        s?.current_top_n        ?? null,
      longest_streak_days:  s?.longest_streak_days  ?? null,
      total_days_in_top_50: s?.total_days_in_top_50 ?? null,
    }
  })
  listCache.set(cacheKey(category as LadderCategory, window), { data: result, fetchedAt: Date.now() })
  return result
}

// Editorial-card view of /ladder · same MV ordering, full Project rows.
// Two-step: pull ranked project_ids from MV, then a separate query for
// the full PUBLIC_PROJECT_COLUMNS shape so cards have description,
// tech_layers, etc. Empty when MV is missing.
export async function fetchLadderProjects(
  category: LadderCategory | 'all',
  window:   LadderWindow,
  limit = 50,
): Promise<{ project: Project; rank: number }[]> {
  const rankCol = RANK_COLUMN[window]
  let q = supabase
    .from('ladder_rankings_mv')
    .select(`project_id, score_total, ${rankCol}`)
  if (category !== 'all') q = q.eq('category', category)
  if (window !== 'all_time') q = q.not(rankCol, 'is', null)
  q = category === 'all'
    ? q.order('score_total', { ascending: false })
    : q.order(rankCol, { ascending: true })
  const { data: ids, error: idsErr } = await q.limit(limit)
  if (idsErr || !ids || ids.length === 0) return []

  const idList = (ids as unknown as Array<{ project_id: string }>).map(r => r.project_id)
  const { PUBLIC_PROJECT_COLUMNS } = await import('./supabase')
  const { data: projects } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .in('id', idList)
  if (!projects) return []

  const rankMap = new Map<string, number>()
  ;(ids as unknown as Array<{ project_id: string; [k: string]: unknown }>).forEach((r, i) => {
    // 'all' view: sequential rank from order; otherwise use MV partition rank.
    rankMap.set(r.project_id, category === 'all' ? i + 1 : (r[rankCol] as number))
  })
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
    productivity_personal: 0,
    niche_saas:            0,
    creator_media:         0,
    dev_tools:             0,
    ai_agents_chat:        0,
    consumer_lifestyle:    0,
    games_playful:         0,
  }
  if (error || !data) return empty

  for (const row of data as unknown as Array<{ category: LadderCategory }>) {
    if (row.category in empty) empty[row.category] = (empty[row.category] ?? 0) + 1
  }
  countsCache.set(window, { data: empty, fetchedAt: Date.now() })
  return empty
}
