// Season progress — derives the current day/phase of a 3-week season
// (CLAUDE.md §11). Pure function over season row + today's date.

import { supabase, type Season, type SeasonStatus } from './supabase'

export type SeasonPhase =
  | 'upcoming'          // before start_date
  | 'week_1'            // day 1-7   · labels only
  | 'week_2'            // day 8-14  · relative percentiles
  | 'week_3'            // day 15-21 · concrete numbers
  | 'applaud'           // day 22-28 · Applaud Week
  | 'graduation'        // day 29    · graduation day
  | 'completed'         // after graduation_date

export interface SeasonProgress {
  phase:          SeasonPhase
  status:         SeasonStatus
  dayNumber:      number      // 1-indexed day within the season (may be 0 before start, >29 after)
  totalDays:      number      // usually 28
  progressPct:    number      // 0-100
  daysRemaining:  number      // to graduation_date
  phaseLabel:     string
  phaseHint:      string      // user-facing description
  milestones:     Array<{
    day:   number
    label: string
    phase: SeasonPhase
    done:  boolean
    active: boolean
  }>
}

const MS_PER_DAY = 86_400_000

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY)
}

export function computeSeasonProgress(season: Season, now: Date = new Date()): SeasonProgress {
  const start      = new Date(season.start_date)
  const end        = new Date(season.end_date)
  const applaudEnd = new Date(season.applaud_end)
  const grad       = new Date(season.graduation_date)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const totalDays = Math.max(1, daysBetween(start, grad) + 1)
  const rawDay = daysBetween(start, today) + 1
  const dayNumber = Math.max(0, Math.min(rawDay, totalDays))
  const daysRemaining = Math.max(0, daysBetween(today, grad))
  const progressPct = Math.max(0, Math.min(100, (dayNumber / totalDays) * 100))

  let phase: SeasonPhase
  if (today < start)              phase = 'upcoming'
  else if (rawDay <= 7)           phase = 'week_1'
  else if (rawDay <= 14)          phase = 'week_2'
  else if (today <= end)          phase = 'week_3'
  else if (today <= applaudEnd)   phase = 'applaud'
  else if (daysBetween(today, grad) === 0) phase = 'graduation'
  else                            phase = 'completed'

  const phaseLabel: Record<SeasonPhase, string> = {
    upcoming:    'Season opening soon',
    week_1:      'Week 1 · Blind stage',
    week_2:      'Week 2 · Percentile reveal',
    week_3:      'Week 3 · Numbers go live',
    applaud:     'Applaud Week',
    graduation:  'Graduation Day',
    completed:   'Season complete',
  }

  const phaseHint: Record<SeasonPhase, string> = {
    upcoming:    'Applications open. No scoring yet.',
    week_1:      'Scores hidden — you see only the stage label. Iterate without public pressure.',
    week_2:      'Your project reveals only as a percentile band ("top X%"). First feedback lands.',
    week_3:      'Concrete scores unlock with a 6-hour delay. Forecasts intensify.',
    applaud:     'Scouts cast craft-focused Applauds. 30s usage verification required.',
    graduation:  'Final scores frozen. Refunds and badges dispatched.',
    completed:   'Season archived. Alumni briefs are public.',
  }

  const milestones = [
    { day: 1,  label: 'Blind start',      phase: 'week_1' as SeasonPhase },
    { day: 8,  label: 'Percentiles',      phase: 'week_2' as SeasonPhase },
    { day: 15, label: 'Scores live',      phase: 'week_3' as SeasonPhase },
    { day: 22, label: 'Applaud Week',     phase: 'applaud' as SeasonPhase },
    { day: 29, label: 'Graduation',       phase: 'graduation' as SeasonPhase },
  ].map(m => ({
    ...m,
    done:   rawDay > m.day,
    active: rawDay >= m.day && (m === undefined || rawDay < (m.day + 7)) && phase === m.phase,
  }))

  return {
    phase,
    status: season.status,
    dayNumber: rawDay,
    totalDays,
    progressPct,
    daysRemaining,
    phaseLabel: phaseLabel[phase],
    phaseHint:  phaseHint[phase],
    milestones,
  }
}

// Server-side status sync. Safe to call frequently; the DB function is idempotent.
export async function syncActiveSeason(): Promise<Season | null> {
  await supabase.rpc('advance_season_status', { p_season_id: null })
  const { data } = await supabase
    .from('seasons')
    .select('*')
    .in('status', ['active', 'applaud'])
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Season | null) ?? null
}

// Simple convenience: load "the" season we should render for now.
export async function loadCurrentSeason(): Promise<Season | null> {
  const { data } = await supabase
    .from('seasons')
    .select('*')
    .in('status', ['active', 'applaud'])
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) return data as Season
  // Fallback: most recent any-status season
  const { data: any } = await supabase
    .from('seasons')
    .select('*')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (any as Season | null) ?? null
}
