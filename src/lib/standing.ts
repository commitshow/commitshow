// Client helper for the season_standings view (§6.2 · %-based relative rank).
// Drives the GraduationStanding card on ProjectDetailPage.

import { supabase } from './supabase'

export type ProjectedTier = 'valedictorian' | 'honors' | 'graduate' | 'rookie_circle'

export interface ProjectStanding {
  project_id:       string
  season_id:        string | null
  creator_id:       string
  status:           string
  score_total:      number | null
  rank:             number
  total_in_season:  number
  percentile:       number         // 0 (best) → 100 (worst)
  projected_tier:   ProjectedTier
  live_url_ok:      boolean
  snapshots_ok:     boolean         // ≥ 2 analysis snapshots
  brief_ok:         boolean         // has a build_briefs row
  snapshots_count:  number
}

export async function fetchProjectStanding(projectId: string): Promise<ProjectStanding | null> {
  const { data, error } = await supabase
    .from('season_standings')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error || !data) return null
  return data as ProjectStanding
}

// Describe the upper rank that would move the project into the next tier.
// Returns null when already at Valedictorian.
export function nextTierTargetRank(s: ProjectStanding): { tier: ProjectedTier; rank: number } | null {
  if (s.projected_tier === 'valedictorian') return null
  const total = Math.max(1, s.total_in_season)
  if (s.projected_tier === 'honors')        return { tier: 'valedictorian', rank: 1 }
  if (s.projected_tier === 'graduate')      return { tier: 'honors', rank: Math.max(2, Math.ceil(total * 0.05)) }
  return { tier: 'graduate', rank: Math.ceil(total * 0.20) }
}

export const TIER_LABEL: Record<ProjectedTier, string> = {
  valedictorian: 'Valedictorian',
  honors:        'Honors',
  graduate:      'Graduate',
  rookie_circle: 'Rookie Circle',
}

export const TIER_COLOR: Record<ProjectedTier, string> = {
  valedictorian: '#F0C040',
  honors:        '#A78BFA',
  graduate:      '#60A5FA',
  rookie_circle: '#6B7280',
}
