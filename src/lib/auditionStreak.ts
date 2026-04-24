// Audition streak fetch — counts consecutive `audition_climb` events for
// this project's creator since their last `audition_streak` reward.
// Powers the "🔥 N-round streak" badge in the project hero.

import { supabase } from './supabase'

export interface AuditionStreak {
  climbs:         number           // climbs since last streak reward
  fired:          boolean          // has the streak reward already fired (reset count)
  lastRewardAt:   string | null
}

export async function fetchAuditionStreak(creatorId: string): Promise<AuditionStreak> {
  // When was the most recent audition_streak reward for this creator?
  const { data: lastRow } = await supabase
    .from('activity_point_ledger')
    .select('created_at')
    .eq('member_id', creatorId)
    .eq('kind', 'audition_streak')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastRewardAt = lastRow?.created_at ?? null

  let q = supabase
    .from('activity_point_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', creatorId)
    .eq('kind', 'audition_climb')
  if (lastRewardAt) q = q.gt('created_at', lastRewardAt)

  const { count } = await q
  const climbs = count ?? 0
  return { climbs, fired: false, lastRewardAt }
}
