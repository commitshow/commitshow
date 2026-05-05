// Encore · 2026-05-05 rebrand · single-threshold quality badge that
// replaced the 4-tier graduation system (valedictorian / honors /
// graduate / rookie_circle).
//
// Why the change: a continuous ladder has no "graduation event", so
// awarding tier labels at season-end was conceptually mismatched.
// Encore is just a badge on the project itself — the moment its
// `score_total` crosses the threshold the badge shows up; if it
// later regresses it disappears. No cron, no ceremony.
//
// Threshold lives in this file so adjusting it is one edit + redeploy.
// Pre-existing graduation_grade column is left in the DB for now
// (read by legacy components until they're swept) but new UI should
// only depend on the score-derived encore signal.

// 2026-05-05 · raised from 84 to 85. Hits a cleaner round-edge mark
// and ensures sub-85 climbers (e.g. score 76) don't get surfaced in
// any "Encore" lane / chart by accident.
export const ENCORE_THRESHOLD = 85

export function isEncoreScore(score: number | null | undefined): boolean {
  return typeof score === 'number' && score >= ENCORE_THRESHOLD
}

// 4-track Encore display metadata · keep sorted by intended visual
// weight (production = the gold mark; others are sibling honors).
export type EncoreKind = 'production' | 'streak' | 'climb' | 'spotlight'

export const ENCORE_KIND_META: Record<EncoreKind, {
  label: string         // chip label shown after the symbol
  symbol: string        // single-glyph mark (kept ASCII-friendly)
  rank: number          // sort order when a project earned multiple kinds
  oneLineWhy: string    // tooltip / detail line — what the gate measured
}> = {
  production: { label: 'Encore',    symbol: '★', rank: 0, oneLineWhy: 'Score crossed 85 — the production-quality bar' },
  streak:     { label: 'Streak',    symbol: '⟳', rank: 1, oneLineWhy: '4 consecutive snapshots ≥ 75 — sustained quality' },
  climb:      { label: 'Climb',     symbol: '↗', rank: 2, oneLineWhy: '+25 points improvement from the first audit' },
  spotlight:  { label: 'Spotlight', symbol: '✦', rank: 3, oneLineWhy: '10+ supporters with avg forecast ≥ 75' },
}

import { supabase } from './supabase'

export interface EncoreRow {
  kind:         'production' | 'streak' | 'climb' | 'spotlight'
  serial:       number
  earned_at:    string
  earned_score: number
}

// Fetch the production-kind Encore row for a single project. Kept
// for backwards compat — many callers want the headline serial only.
// Use fetchAllProjectEncores for the full 4-track set.
export async function fetchProjectEncore(projectId: string): Promise<EncoreRow | null> {
  const { data } = await supabase
    .from('encores')
    .select('kind, serial, earned_at, earned_score')
    .eq('project_id', projectId)
    .eq('kind', 'production')
    .maybeSingle()
  return (data as EncoreRow | null) ?? null
}

// All Encore rows for a project, sorted by ENCORE_KIND_META.rank so
// production always shows first when multiple kinds were earned.
export async function fetchAllProjectEncores(projectId: string): Promise<EncoreRow[]> {
  const { data } = await supabase
    .from('encores')
    .select('kind, serial, earned_at, earned_score')
    .eq('project_id', projectId)
  const rows = (data as EncoreRow[] | null) ?? []
  return rows.slice().sort((a, b) =>
    ENCORE_KIND_META[a.kind as EncoreKind].rank - ENCORE_KIND_META[b.kind as EncoreKind].rank,
  )
}

// Bulk variant for list pages · returns a Map keyed by project_id.
// Defaults to production-only (the headline serial); pass allKinds=true
// when the caller wants every track (e.g. project portfolio cards).
export async function fetchEncoresByProjectIds(
  projectIds: string[],
  allKinds = false,
): Promise<Map<string, EncoreRow>> {
  if (projectIds.length === 0) return new Map()
  let q = supabase
    .from('encores')
    .select('project_id, kind, serial, earned_at, earned_score')
    .in('project_id', projectIds)
  if (!allKinds) q = q.eq('kind', 'production')
  const { data } = await q
  const map = new Map<string, EncoreRow>()
  // When allKinds, prefer the highest-rank (production) row per project.
  const sorted = ((data ?? []) as Array<{ project_id: string } & EncoreRow>)
    .slice()
    .sort((a, b) => ENCORE_KIND_META[a.kind as EncoreKind].rank - ENCORE_KIND_META[b.kind as EncoreKind].rank)
  sorted.forEach(r => {
    if (!map.has(r.project_id)) {
      map.set(r.project_id, { kind: r.kind, serial: r.serial, earned_at: r.earned_at, earned_score: r.earned_score })
    }
  })
  return map
}

// Bulk variant returning all kinds grouped by project_id (for the
// few surfaces that want to render the full set per project).
export async function fetchAllEncoresByProjectIds(
  projectIds: string[],
): Promise<Map<string, EncoreRow[]>> {
  if (projectIds.length === 0) return new Map()
  const { data } = await supabase
    .from('encores')
    .select('project_id, kind, serial, earned_at, earned_score')
    .in('project_id', projectIds)
  const map = new Map<string, EncoreRow[]>()
  ;(data ?? []).forEach((r: { project_id: string } & EncoreRow) => {
    const list = map.get(r.project_id) ?? []
    list.push({ kind: r.kind, serial: r.serial, earned_at: r.earned_at, earned_score: r.earned_score })
    map.set(r.project_id, list)
  })
  for (const [k, list] of map) {
    list.sort((a, b) => ENCORE_KIND_META[a.kind as EncoreKind].rank - ENCORE_KIND_META[b.kind as EncoreKind].rank)
    map.set(k, list)
  }
  return map
}
