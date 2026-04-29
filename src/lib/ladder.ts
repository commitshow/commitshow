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
import type { LadderCategory, LadderWindow } from './supabase'

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

  const { data, error } = await supabase
    .from('ladder_rankings_mv')
    .select(`
      project_id, category, score_total, score_auto, audit_count,
      audited_at, commit_sha,
      ${rankCol},
      projects!inner(project_name, github_url, thumbnail_url, status, creator_id, creator_name)
    `)
    .eq('category', category)
    .not(rankCol, 'is', null)
    .order(rankCol, { ascending: true })
    .limit(limit)

  // MV may not exist yet (Migration A pending). Treat any error as empty
  // and let the page render its empty state.
  if (error || !data) return []

  type Raw = {
    project_id: string
    category: LadderCategory
    score_total: number
    score_auto: number
    audit_count: number
    audited_at: string | null
    commit_sha: string | null
    rank_today?: number | null
    rank_week?: number | null
    rank_month?: number | null
    rank_all_time?: number | null
    projects: {
      project_name: string
      github_url:   string | null
      thumbnail_url: string | null
      status:       string
      creator_id:   string | null
      creator_name: string | null
    } | null
  }

  return (data as unknown as Raw[]).map(r => ({
    project_id:    r.project_id,
    rank:          (r[rankCol as keyof Raw] as number) ?? 0,
    category:      r.category,
    score_total:   r.score_total,
    score_auto:    r.score_auto,
    audit_count:   r.audit_count,
    audited_at:    r.audited_at,
    commit_sha:    r.commit_sha,
    project_name:  r.projects?.project_name ?? '—',
    github_url:    r.projects?.github_url ?? null,
    thumbnail_url: r.projects?.thumbnail_url ?? null,
    status:        r.projects?.status ?? 'active',
    creator_id:    r.projects?.creator_id ?? null,
    creator_name:  r.projects?.creator_name ?? null,
  }))
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
  return empty
}
