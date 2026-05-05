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
  apEarned: number              // base 10 + spotter bonus (immediate); accuracy bonus resolves at graduation
  spotterTier: SpotterTier | null
  spotterBonus: number          // 0 if cast outside spotter windows (legacy)
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

export class ForecastWindowClosedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForecastWindowClosedError'
  }
}

// Forecast window state · derived from the project's first 'initial'
// audit snapshot. Window opens at Round 1 and closes 14 days later;
// the earlier you bet inside that window, the higher the spotter tier
// and the bigger the AP bonus on cast (First +50 / Early +20 / Spotter
// +10 — granted by the on_vote_grant_spotter_bonus trigger).
export type SpotterTier = 'first' | 'early' | 'spotter'

export interface VoteWindowState {
  openedAt: string | null
  closesAt: string | null
  isOpen: boolean
  tierNow: SpotterTier | null
}

export async function fetchVoteWindowState(projectId: string): Promise<VoteWindowState> {
  const { data, error } = await supabase
    .rpc('vote_window_state', { p_project_id: projectId })
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    return { openedAt: null, closesAt: null, isOpen: false, tierNow: null }
  }
  const row = data[0] as { opened_at: string | null; closes_at: string | null; is_open: boolean; tier_now: SpotterTier | null }
  return {
    openedAt: row.opened_at,
    closesAt: row.closes_at,
    isOpen: !!row.is_open,
    tierNow: row.tier_now,
  }
}

// AP bonus by spotter tier (mirrors on_vote_grant_spotter_bonus in
// 20260505_vote_window_and_spotter.sql). Surfaced in ForecastModal so
// the user sees the bonus before casting.
export const SPOTTER_BONUS: Record<SpotterTier, number> = {
  first:   50,
  early:   20,
  spotter: 10,
}

// AlreadyForecastedError removed 2026-05-03 · CEO confirmed PRD §1-A ① /
// §9 ×N "몰빵" stays — same Scout can cast multiple forecasts on the same
// project to express stronger conviction. Quota is throttled by the monthly
// ballot wallet (Bronze 20 / Silver 40 / Gold 60 / Platinum 80), not by a
// per-project gate. The votes_member_project_season_uq UNIQUE constraint
// was already dropped in 20260424_v2_prd_realignment.sql.

// Fetch the current live quarterly event id. §11-NEW.8 · was: seasons table.
// events.id == seasons.id (UUID preserved by Migration A), so the foreign
// keys on votes.season_id keep matching.
async function resolveActiveSeasonId(): Promise<string | null> {
  const { data } = await supabase
    .from('events')
    .select('id')
    .eq('template_type', 'quarterly')
    .eq('status', 'live')
    .order('starts_at', { ascending: false })
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
    .select('id, weight, scout_tier, spotter_tier')
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
    if (/Forecast window closed|no audit yet/i.test(msg)) {
      throw new ForecastWindowClosedError(msg)
    }
    throw error
  }

  // Spotter-tier bonus, if any, lands as a separate AP ledger row from
  // the on_vote_grant_spotter_bonus trigger. Surface it on the success
  // toast so the user sees "+10 base + 50 First Spotter" not just "+10".
  const spotterTier = (data as { spotter_tier?: SpotterTier | null }).spotter_tier ?? null
  const spotterBonus = spotterTier ? SPOTTER_BONUS[spotterTier] : 0

  return {
    voteId: data.id,
    weight: Number(data.weight),
    scoutTier: data.scout_tier as ScoutTier,
    apEarned: 10 + spotterBonus,
    spotterTier,
    spotterBonus,
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

/**
 * How many forecasts the member has already cast on this project this
 * season. Returned as a count (not boolean) because PRD §9 allows ×N
 * casts — UI shows "You've cast 3 already · cast another?" rather than
 * gating after the first one.
 */
export async function priorForecastCount(memberId: string, projectId: string, seasonId?: string | null): Promise<number> {
  const effectiveSeason = seasonId ?? await resolveActiveSeasonId()
  const { count } = await supabase
    .from('votes')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('project_id', projectId)
    .eq('season_id', effectiveSeason)
  return count ?? 0
}
