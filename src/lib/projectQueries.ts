// Client-side queries for the Projects dashboard and detail page.
// Lanes (Just registered · Climbing · Graduating) run as parallel requests;
// filters + pagination hit the same projects table with composable modifiers.

import { supabase, PUBLIC_PROJECT_COLUMNS, type Project } from './supabase'

export const LANE_LIMIT = 6
export const GRID_PAGE_SIZE = 12

// ── Canonical github URL matching ─────────────────────────────
// Mirrors audit-preview/index.ts:canonicalGithub so /submit can find
// the preview row that the CLI created — even when one side has `.git`,
// trailing slash, or differs in case.

export interface CanonicalGithub {
  canonical: string                                    // https://github.com/owner/repo
  slug:      string                                    // owner/repo (lowercased)
}

export function canonicalizeGithubUrl(url: string): CanonicalGithub | null {
  const m = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i)
  if (!m) return null
  const owner = m[1]
  const repo  = m[2].replace(/\.git$/i, '')
  return {
    canonical: `https://github.com/${owner}/${repo}`,
    slug:      `${owner}/${repo}`.toLowerCase(),
  }
}

// ── Preview claim resolution ──────────────────────────────────
// Returns the existing project row (if any) that the user's submission
// would land on, plus a verdict the SubmitForm uses to decide between
// claim, reject, or fresh insert.

export type ClaimVerdict =
  | { kind: 'fresh' }                                   // no existing row → INSERT
  | { kind: 'claim', projectId: string }                // preview row, claimable → UPDATE
  | { kind: 'already_yours', projectId: string }        // user already auditioning this URL
  | { kind: 'taken_by_other', creatorId: string | null } // someone else owns the active audition
  | { kind: 'lookup_failed', message: string }

export async function resolvePreviewClaim(
  githubUrl: string,
  userId: string | null,
): Promise<ClaimVerdict> {
  const canon = canonicalizeGithubUrl(githubUrl)
  if (!canon) return { kind: 'lookup_failed', message: 'Not a recognisable GitHub URL.' }

  // ilike with both `https://github.com/owner/repo` and `https://github.com/owner/repo.git`
  // covered by trailing wildcard. Case-insensitive.
  const { data, error } = await supabase
    .from('projects')
    .select('id, status, creator_id, github_url')
    .ilike('github_url', `${canon.canonical}%`)
    .order('created_at', { ascending: true })

  if (error) return { kind: 'lookup_failed', message: error.message }

  // Filter strictly to canonical owner/repo (ilike could over-match if owner is a prefix).
  const exact = (data ?? []).filter(r => {
    const c = canonicalizeGithubUrl(r.github_url ?? '')
    return c?.slug === canon.slug
  })

  if (exact.length === 0) return { kind: 'fresh' }

  // Active audition by current user → block (one audition per repo per creator).
  const ownActive = exact.find(r => r.status === 'active' && r.creator_id === userId && userId)
  if (ownActive) return { kind: 'already_yours', projectId: ownActive.id }

  // Active audition by someone else → block (the league assumes one creator per repo).
  const otherActive = exact.find(r => r.status === 'active' && r.creator_id && r.creator_id !== userId)
  if (otherActive) return { kind: 'taken_by_other', creatorId: otherActive.creator_id }

  // Preview shadow with no creator → claim.
  const claimable = exact.find(r => r.status === 'preview' && r.creator_id === null)
  if (claimable) return { kind: 'claim', projectId: claimable.id }

  // Edge case: preview row that already has a creator (shouldn't happen normally).
  // Treat as taken_by_other to be safe.
  const claimedPreview = exact.find(r => r.status === 'preview' && r.creator_id)
  if (claimedPreview) return { kind: 'taken_by_other', creatorId: claimedPreview.creator_id }

  return { kind: 'fresh' }
}

// 1) Just registered — Week 1 blind stage.
// Backed by `projects.created_at` within the last 7 days on the active season.
export async function fetchJustRegistered(): Promise<Project[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .eq('status', 'active')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(LANE_LIMIT)
  return (data ?? []) as unknown as Project[]
}

// 2) Climbing — projects whose latest snapshot has a positive score delta.
// We join in two steps: latest snapshot per project then filter positive delta.
export async function fetchClimbing(): Promise<Array<Project & { delta: number }>> {
  // Pull recent snapshots with positive delta, newest first.
  const { data: snaps } = await supabase
    .from('analysis_snapshots')
    .select('project_id, score_total_delta, created_at')
    .gt('score_total_delta', 0)
    .order('created_at', { ascending: false })
    .limit(60)

  if (!snaps || snaps.length === 0) return []

  // Dedup to latest snapshot per project.
  const bestByProject = new Map<string, { delta: number }>()
  for (const s of snaps) {
    if (!bestByProject.has(s.project_id)) {
      bestByProject.set(s.project_id, { delta: s.score_total_delta ?? 0 })
    }
  }
  const projectIds = Array.from(bestByProject.keys()).slice(0, LANE_LIMIT * 2)
  if (projectIds.length === 0) return []

  const { data: rows } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .in('id', projectIds)
    .eq('status', 'active')

  if (!rows) return []

  return (rows as unknown as Project[])
    .map(p => ({ ...p, delta: bestByProject.get(p.id)?.delta ?? 0 }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, LANE_LIMIT)
}

// 3) Graduating — high-scoring projects still in-season (score_total >= 70).
export async function fetchGraduating(): Promise<Project[]> {
  const { data } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .eq('status', 'active')
    .gte('score_total', 70)
    .order('score_total', { ascending: false })
    .limit(LANE_LIMIT)
  return (data ?? []) as unknown as Project[]
}

// Filtered + paginated feed for the main grid.
export interface GridFilters {
  search?: string
  grade?: string         // creator_grade
  status?: 'any' | 'active' | 'graduated' | 'retry'
  minScore?: number
  sort?: 'newest' | 'score' | 'forecasts'
  // §11-NEW.1.1 ladder category filter · 'any' = no filter
  category?:
    | 'any'
    | 'productivity_personal'
    | 'niche_saas'
    | 'creator_media'
    | 'dev_tools'
    | 'ai_agents_chat'
    | 'consumer_lifestyle'
    | 'games_playful'
}

export async function fetchProjectsFiltered(
  filters: GridFilters,
  page: number,
): Promise<{ rows: Project[]; hasMore: boolean; total: number | null }> {
  const from = page * GRID_PAGE_SIZE
  const to = from + GRID_PAGE_SIZE - 1

  let q = supabase.from('projects').select(PUBLIC_PROJECT_COLUMNS, { count: 'exact' })

  if (filters.status && filters.status !== 'any') q = q.eq('status', filters.status)
  else q = q.in('status', ['active', 'graduated', 'valedictorian'])

  if (filters.grade)       q = q.eq('creator_grade', filters.grade)
  if (filters.minScore)    q = q.gte('score_total', filters.minScore)
  if (filters.category && filters.category !== 'any') {
    q = q.eq('business_category', filters.category)
  }
  if (filters.search?.trim()) {
    const s = filters.search.trim().replace(/[%_]/g, m => `\\${m}`)
    q = q.ilike('project_name', `%${s}%`)
  }

  switch (filters.sort ?? 'newest') {
    case 'score':      q = q.order('score_total', { ascending: false }); break
    case 'forecasts':  q = q.order('score_forecast', { ascending: false }); break
    default:           q = q.order('created_at', { ascending: false })
  }

  const { data, count } = await q.range(from, to)
  const rows = (data ?? []) as unknown as Project[]
  const total = typeof count === 'number' ? count : null
  const hasMore = total !== null ? (total > to + 1) : rows.length === GRID_PAGE_SIZE
  return { rows, hasMore, total }
}

// §11-NEW.1.1 · all-time ladder rank lookup for a batch of projects.
// Reads ladder_rankings_mv (refreshed every 5min). Returns a Map keyed
// by project_id for O(1) join from the grid. Empty map when MV is
// missing or query fails — callers degrade gracefully.
export async function fetchCategoryRanks(
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()
  const { data } = await supabase
    .from('ladder_rankings_mv')
    .select('project_id, rank_all_time')
    .in('project_id', projectIds)
  const map = new Map<string, number>()
  if (data) {
    for (const r of data as Array<{ project_id: string; rank_all_time: number | null }>) {
      if (r.rank_all_time != null) map.set(r.project_id, r.rank_all_time)
    }
  }
  return map
}

// Project detail — single row + its snapshot timeline.
export async function fetchProjectById(id: string): Promise<Project | null> {
  const { data } = await supabase
    .from('projects')
    .select(PUBLIC_PROJECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  return (data as Project | null) ?? null
}

// Creator-initiated project deletion. RLS enforces creator_id = auth.uid.
// Cleans up the thumbnail object too — projects cascade handles children rows.
export async function deleteProject(projectId: string): Promise<{ error: string | null }> {
  // Fetch thumbnail_path first so we can tidy up storage after the row is gone.
  const { data: proj } = await supabase
    .from('projects')
    .select('thumbnail_path')
    .eq('id', projectId)
    .maybeSingle()

  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) return { error: error.message }

  if (proj?.thumbnail_path) {
    // Best-effort cleanup; orphan thumbnails are harmless.
    await supabase.storage.from('project-thumbnails').remove([proj.thumbnail_path])
  }
  return { error: null }
}

// Fetch creator identity (current display_name + avatar) for a project.
// Separate from the project row so UIs can re-use across creators without
// polluting the Project type.
export interface CreatorIdentity {
  id: string
  display_name: string | null
  avatar_url: string | null
  creator_grade: string
  tier: string
}

export async function fetchProjectCreator(creatorId: string): Promise<CreatorIdentity | null> {
  const { data } = await supabase
    .from('members')
    .select('id, display_name, avatar_url, creator_grade, tier')
    .eq('id', creatorId)
    .maybeSingle()
  return (data as CreatorIdentity | null) ?? null
}

// Batch variant — used by grids/lanes to avoid N+1 without needing a view.
// Returns a map keyed by member id.
export async function fetchCreatorsByIds(ids: string[]): Promise<Record<string, CreatorIdentity>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return {}
  const { data } = await supabase
    .from('members')
    .select('id, display_name, avatar_url, creator_grade, tier')
    .in('id', unique)
  const map: Record<string, CreatorIdentity> = {}
  ;(data ?? []).forEach((m) => {
    const row = m as CreatorIdentity
    map[row.id] = row
  })
  return map
}

// Count applauds per project (v2 polymorphic applauds · target_type='product').
export async function fetchApplaudCounts(projectIds: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(projectIds.filter(Boolean)))
  if (unique.length === 0) return {}
  const { data } = await supabase
    .from('applauds')
    .select('target_id')
    .eq('target_type', 'product')
    .in('target_id', unique)
  const map: Record<string, number> = {}
  ;(data ?? []).forEach((r) => {
    const pid = (r as { target_id: string }).target_id
    map[pid] = (map[pid] ?? 0) + 1
  })
  return map
}

export interface TimelinePoint {
  id: string
  created_at: string
  score_total: number
  score_total_delta: number | null
  trigger_type: string
  commit_sha: string | null
}

export async function fetchProjectTimeline(id: string): Promise<TimelinePoint[]> {
  const { data } = await supabase
    .from('analysis_snapshots')
    .select('id, created_at, score_total, score_total_delta, trigger_type, commit_sha')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
  return (data ?? []) as TimelinePoint[]
}

// Forecast + Applaud lists for project detail.
export interface ForecastRow {
  id: string
  created_at: string
  member_id: string | null
  predicted_score: number | null
  comment: string | null
  weight: number
  scout_tier: string
}

export async function fetchProjectForecasts(id: string, limit = 20): Promise<ForecastRow[]> {
  const { data } = await supabase
    .from('votes')
    .select('id, created_at, member_id, predicted_score, comment, weight, scout_tier')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as ForecastRow[]
}

// v2 polymorphic applauds (§7.5). Product applauds = target_type='product'.
export interface ApplaudRow {
  id: string
  created_at: string
  member_id: string
}

export async function fetchProjectApplauds(id: string, limit = 20): Promise<ApplaudRow[]> {
  const { data } = await supabase
    .from('applauds')
    .select('id, created_at, member_id')
    .eq('target_type', 'product')
    .eq('target_id', id)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as ApplaudRow[]
}
