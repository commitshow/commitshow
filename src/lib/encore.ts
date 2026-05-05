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

import { supabase } from './supabase'

export interface EncoreRow {
  kind:         'production' | 'streak' | 'climb' | 'spotlight'
  serial:       number
  earned_at:    string
  earned_score: number
}

// Fetch the production-kind Encore row for a single project. Other
// kinds (streak / climb / spotlight) gate on different criteria and
// will be added in subsequent sprints; for now only 'production'
// (= score >= 85) emits rows.
export async function fetchProjectEncore(projectId: string): Promise<EncoreRow | null> {
  const { data } = await supabase
    .from('encores')
    .select('kind, serial, earned_at, earned_score')
    .eq('project_id', projectId)
    .eq('kind', 'production')
    .maybeSingle()
  return (data as EncoreRow | null) ?? null
}

// Bulk variant for list pages · returns a Map keyed by project_id
// so the caller can render serials inline without N+1 queries.
export async function fetchEncoresByProjectIds(
  projectIds: string[],
): Promise<Map<string, EncoreRow>> {
  if (projectIds.length === 0) return new Map()
  const { data } = await supabase
    .from('encores')
    .select('project_id, kind, serial, earned_at, earned_score')
    .in('project_id', projectIds)
    .eq('kind', 'production')
  const map = new Map<string, EncoreRow>()
  ;(data ?? []).forEach((r: { project_id: string } & EncoreRow) =>
    map.set(r.project_id, { kind: r.kind, serial: r.serial, earned_at: r.earned_at, earned_score: r.earned_score }))
  return map
}
