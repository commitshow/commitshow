// Registration pricing gate (CLAUDE.md §14 · v1.7)
// Permanent policy is paid-by-default ($99/audit). The number of free
// audits each member gets before the paywall kicks in is an admin-tunable
// runtime setting (`app_settings.free_audits_per_member` · default 3 to
// honor the launch promo). Paid audits land as a +1 credit on
// members.paid_audits_credit when the Stripe webhook flips the payment
// to succeeded — eligibility returns ok=true while credits remain,
// blocked once they're exhausted.

import { supabase } from './supabase'

// Fallback default · used only when the get_app_setting RPC fails or
// returns a non-numeric value. Tracks the current launch promo so a
// transient DB error doesn't accidentally lock everyone out.
export const FREE_AUDITS_FALLBACK_DEFAULT = 3
export const REGISTRATION_PRICE_CENTS = 9900  // $99.00 · standard audit fee
export const FOUNDER_PRICE_FALLBACK_CENTS = 4900  // $49.00 · matches founder_price_cents

// $99 = $20 audit/operations cost (non-refundable) + $79 graduation
// deposit (refunded on Diploma). Founder pricing scales the same split.
// Strategy doc §7.2 — narrative decomposition required on every price
// surface to neutralize the "$99 too high" gut reaction.
export interface PriceBreakdown {
  total:    number  // cents
  cost:     number  // cents · platform-retained
  deposit:  number  // cents · refundable on Diploma
}
export function priceBreakdown(totalCents: number): PriceBreakdown {
  // Cost stays at ~20% of total (rounded to dollars). $99 → $20/$79;
  // $49 → $10/$39. Keeps the narrative tidy at every price point.
  const costRatio = 0.2020   // chosen so 9900 → 2000 and 4900 → ~990 (rounded to 1000)
  const cost = Math.round(totalCents * costRatio / 100) * 100
  return { total: totalCents, cost, deposit: totalCents - cost }
}

export interface FounderStatus {
  windowOpen:  boolean
  cap:         number
  paidCount:   number
  remaining:   number
  priceCents:  number
}

export async function fetchFounderStatus(): Promise<FounderStatus | null> {
  const { data, error } = await supabase.rpc('founder_pricing_status')
  if (error || !data || !Array.isArray(data) || data.length === 0) return null
  const row = data[0] as { window_open: boolean; cap: number; paid_count: number; remaining: number; price_cents: number }
  return {
    windowOpen: !!row.window_open,
    cap:        row.cap,
    paidCount:  row.paid_count,
    remaining:  row.remaining,
    priceCents: row.price_cents,
  }
}

export type RegistrationEligibility =
  | { ok: true;  reason: 'free_quota';  priorCount: number; remainingFree: number; freeQuota: number; paidCredit: number }
  | { ok: true;  reason: 'paid_credit'; priorCount: number; remainingFree: 0;       freeQuota: number; paidCredit: number }
  | { ok: false; reason: 'quota_exhausted'; priorCount: number; freeQuota: number; priceCents: number; paidCredit: number; founder?: FounderStatus | null }

// Per-page-load cache · keyed by nothing (single key). Eligibility checks
// fire on /submit mount + every polling tick after a Stripe checkout
// return, so we don't want to round-trip the RPC every time. Admin
// setting changes show up on the next page load · acceptable for an
// admin-tuned promo flag.
let _cachedFreeQuota: number | null = null
let _cachedFreeQuotaAt = 0
const FREE_QUOTA_TTL_MS = 60_000

export async function getFreeAuditsPerMember(): Promise<number> {
  const now = Date.now()
  if (_cachedFreeQuota !== null && (now - _cachedFreeQuotaAt) < FREE_QUOTA_TTL_MS) {
    return _cachedFreeQuota
  }
  const { data, error } = await supabase.rpc('get_app_setting', { p_key: 'free_audits_per_member' })
  // get_app_setting returns jsonb · supabase-js parses it. Numeric values
  // come back as JS numbers; defensively coerce. Non-numeric / error / null
  // → fallback default so a one-off RPC failure doesn't lock new audits out.
  const parsed = typeof data === 'number' ? data
               : typeof data === 'string' ? Number(data)
               : NaN
  const value = error || !Number.isFinite(parsed) || parsed < 0
    ? FREE_AUDITS_FALLBACK_DEFAULT
    : Math.floor(parsed)
  _cachedFreeQuota   = value
  _cachedFreeQuotaAt = now
  return value
}

export function clearFreeQuotaCache(): void {
  _cachedFreeQuota = null
  _cachedFreeQuotaAt = 0
}

export async function checkRegistrationEligibility(memberId: string): Promise<RegistrationEligibility> {
  // Count audits this member has already submitted, regardless of free
  // vs paid origin — that's the input to "have you used your free quota?"
  // Run all three reads concurrently · two row reads + one settings RPC.
  const [{ count, error: projErr }, { data: memberRow, error: memErr }, freeQuota] = await Promise.all([
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', memberId),
    supabase
      .from('members')
      .select('paid_audits_credit')
      .eq('id', memberId)
      .maybeSingle(),
    getFreeAuditsPerMember(),
  ])

  const priorCount  = projErr ? 0 : (count ?? 0)
  const paidCredit  = memErr ? 0 : (memberRow?.paid_audits_credit ?? 0)

  // Path 1 · still in the free quota (if any) → no payment needed.
  if (priorCount < freeQuota) {
    return {
      ok: true,
      reason: 'free_quota',
      priorCount,
      remainingFree: freeQuota - priorCount,
      freeQuota,
      paidCredit,
    }
  }

  // Path 2 · free quota exhausted (or zero) but the member has bought a credit.
  if (paidCredit > 0) {
    return {
      ok: true,
      reason: 'paid_credit',
      priorCount,
      remainingFree: 0,
      freeQuota,
      paidCredit,
    }
  }

  // Path 3 · blocked. UI surfaces the Stripe checkout button.
  // Bake in the live Founder price so the gate copy is honest about
  // what they'll be charged ($49 inside the window, $99 after) without
  // a separate round-trip from every consumer.
  const founder = await fetchFounderStatus()
  const founderActive = !!(founder && founder.windowOpen && founder.remaining > 0)
  const priceCents = founderActive
    ? (founder?.priceCents ?? FOUNDER_PRICE_FALLBACK_CENTS)
    : REGISTRATION_PRICE_CENTS
  return {
    ok: false,
    reason: 'quota_exhausted',
    priorCount,
    freeQuota,
    priceCents,
    paidCredit,
    founder: founder ?? null,
  }
}
