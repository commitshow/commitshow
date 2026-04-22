// Forecast vote logic — Scout casts a 0-100 projected graduation score on a project.
// DB triggers handle tier stamping, weight, AP grant, and monthly cap enforcement.

import { supabase } from './supabase'
import type { ScoutTier, MemberStats } from './supabase'

export interface CastForecastInput {
  projectId: string
  predictedScore: number      // 0-100 graduation projection
  comment?: string
  memberId: string
  seasonId?: string | null    // default: active season
}

export interface CastForecastResult {
  voteId: string
  weight: number
  scoutTier: ScoutTier
  apEarned: number            // base vote AP; bonuses resolve at graduation
}

export class ForecastQuotaError extends Error {
  tier: ScoutTier
  used: number
  cap: number
  constructor(message: string, tier: ScoutTier, used: number, cap: number) {
    super(message)
    this.name = 'ForecastQuotaError'
    this.tier = tier
    this.used = used
    this.cap = cap
  }
}

export class AlreadyForecastedError extends Error {
  constructor() { super('You have already forecasted this project this season.'); this.name = 'AlreadyForecastedError' }
}

// Fetch the current active season. Falls back to season_zero by name.
async function resolveActiveSeasonId(): Promise<string | null> {
  const { data } = await supabase
    .from('seasons')
    .select('id')
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export async function castForecast(input: CastForecastInput): Promise<CastForecastResult> {
  const seasonId = input.seasonId ?? await resolveActiveSeasonId()

  const { data, error } = await supabase
    .from('votes')
    .insert([{
      project_id: input.projectId,
      member_id: input.memberId,
      season_id: seasonId,
      predicted_score: Math.max(0, Math.min(100, Math.round(input.predictedScore))),
      comment: input.comment ?? null,
      vote_count: 1,
      // scout_tier and weight are overwritten by the BEFORE INSERT trigger.
    }])
    .select('id, weight, scout_tier')
    .single()

  if (error) {
    const msg = error.message || ''
    if (/Monthly vote cap reached/i.test(msg)) {
      // Trigger message format: "Monthly vote cap reached for tier X: used / cap"
      const m = msg.match(/tier (\w+):\s*(\d+)\s*\/\s*(\d+)/)
      if (m) {
        throw new ForecastQuotaError(msg, m[1] as ScoutTier, parseInt(m[2]), parseInt(m[3]))
      }
      throw new ForecastQuotaError(msg, 'Bronze', 0, 0)
    }
    if (/duplicate key|votes_member_project_season_uq/i.test(msg)) {
      throw new AlreadyForecastedError()
    }
    throw error
  }

  return {
    voteId: data.id,
    weight: Number(data.weight),
    scoutTier: data.scout_tier as ScoutTier,
    apEarned: 10,   // mirrors the grant_ap(kind='vote', 10) rule in the DB trigger
  }
}

// Fetch the member_stats row for the given member so callers can render
// the Scout Status strip (tier · AP · monthly cap remaining).
export async function loadMemberStats(memberId: string): Promise<MemberStats | null> {
  const { data } = await supabase
    .from('member_stats')
    .select('*')
    .eq('id', memberId)
    .maybeSingle()
  return (data as MemberStats | null) ?? null
}

// Whether the member has already forecasted a given project this season.
export async function hasForecasted(memberId: string, projectId: string, seasonId?: string | null): Promise<boolean> {
  const effectiveSeason = seasonId ?? await resolveActiveSeasonId()
  const { data } = await supabase
    .from('votes')
    .select('id')
    .eq('member_id', memberId)
    .eq('project_id', projectId)
    .eq('season_id', effectiveSeason)
    .maybeSingle()
  return !!data
}
