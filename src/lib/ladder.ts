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

  return (mvRows as unknown as MvRaw[]).map(r => {
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
}

// Editorial-card view of /ladder · same MV ordering, full Project rows.
// Two-step: pull ranked project_ids from MV, then a separate query for
// the full PUBLIC_PROJECT_COLUMNS shape so cards have description,
// tech_layers, etc. Empty when MV is missing.
export async function fetchLadderProjects(
  category: LadderCategory,
  window:   LadderWindow,
  limit = 50,
): Promise<{ project: import('./supabase').Project; rank: number }[]> {
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
  type P = import('./supabase').Project
  const projectMap = new Map<string, P>((projects as unknown as P[]).map(p => [p.id, p]))
  return idList
    .map(id => projectMap.get(id))
    .filter((p): p is P => !!p)
    .map(p => ({ project: p, rank: rankMap.get(p.id) ?? 0 }))
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
