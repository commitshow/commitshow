// Applaud — concept v8 Craft Award track.
// Scout picks THE one project worthy of the Craft Award during the post-season
// Applaud Week (Day 22-28). One applaud per scout per season total. No axis.
// DB trigger stamps weight + scout_tier and grants Activity Point.

import { supabase } from './supabase'
import type { ScoutTier } from './supabase'

export interface CastApplaudInput {
  projectId: string
  memberId: string
  seasonId?: string | null   // defaults to the active season
}

export interface CastApplaudResult {
  applaudId: string
  weight:    number
  scoutTier: ScoutTier
  apEarned:  number
}

export class AlreadyApplaudedThisSeasonError extends Error {
  constructor() {
    super("You've already cast your Craft Award for this season. Pick one project only.")
    this.name = 'AlreadyApplaudedThisSeasonError'
  }
}

export class CannotApplaudOwnProjectError extends Error {
  constructor() { super("You can't applaud your own project."); this.name = 'CannotApplaudOwnProjectError' }
}

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

export async function castApplaud(input: CastApplaudInput): Promise<CastApplaudResult> {
  // Reject own-project applauds before hitting the DB.
  const { data: proj } = await supabase
    .from('projects')
    .select('creator_id')
    .eq('id', input.projectId)
    .maybeSingle()
  if (proj?.creator_id && proj.creator_id === input.memberId) {
    throw new CannotApplaudOwnProjectError()
  }

  const seasonId = input.seasonId ?? await resolveActiveSeasonId()

  const { data, error } = await supabase
    .from('applauds')
    .insert([{
      project_id: input.projectId,
      member_id:  input.memberId,
      season_id:  seasonId,
      // scout_tier + weight stamped by BEFORE INSERT trigger.
    }])
    .select('id, weight, scout_tier')
    .single()

  if (error) {
    const msg = error.message || ''
    if (/duplicate key|applauds_member_season_uq/i.test(msg)) {
      throw new AlreadyApplaudedThisSeasonError()
    }
    throw error
  }

  return {
    applaudId: data.id,
    weight:    Number(data.weight),
    scoutTier: data.scout_tier as ScoutTier,
    apEarned:  5,  // v8 §7.6 · Applaud participation = 5 AP
  }
}

// Whether the scout has already cast this season's single Craft Award.
export async function hasApplaudedThisSeason(memberId: string, seasonId?: string | null): Promise<string | null> {
  const effectiveSeason = seasonId ?? await resolveActiveSeasonId()
  const { data } = await supabase
    .from('applauds')
    .select('project_id')
    .eq('member_id', memberId)
    .eq('season_id', effectiveSeason)
    .maybeSingle()
  return data?.project_id ?? null
}
