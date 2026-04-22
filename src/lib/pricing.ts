// Registration pricing gate (CLAUDE.md §14 · v1.7)
// Permanent policy: first 3 projects per member are free, 4th+ = $99.
// Launch-event window + event_ended branches were dropped in v1.7.

import { supabase } from './supabase'

export const FREE_REGISTRATIONS_PER_MEMBER = 3
export const REGISTRATION_PRICE_CENTS = 9900  // $99.00

export type RegistrationEligibility =
  | { ok: true;  reason: 'free_quota'; priorCount: number; remainingFree: number }
  | { ok: false; reason: 'quota_exhausted'; priorCount: number; priceCents: number }

export async function checkRegistrationEligibility(memberId: string): Promise<RegistrationEligibility> {
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', memberId)

  const priorCount = error ? 0 : (count ?? 0)

  if (priorCount >= FREE_REGISTRATIONS_PER_MEMBER) {
    return { ok: false, reason: 'quota_exhausted', priorCount, priceCents: REGISTRATION_PRICE_CENTS }
  }

  return {
    ok: true,
    reason: 'free_quota',
    priorCount,
    remainingFree: FREE_REGISTRATIONS_PER_MEMBER - priorCount,
  }
}
