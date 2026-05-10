// TicketWalletCard · /me · always-visible audition ticket wallet.
//
// Shows the member's ticket balance (free quota + paid credit) at all
// times so they understand what they have before they audition. The
// 'Buy more' CTA opens Stripe Checkout for an additional ticket.
//
// Buy gating mirrors create-checkout-session's server gate so we
// never surface a CTA that the Edge Function would 400 on:
//   · free_remaining > 0  → 'Use free first' (Buy disabled)
//   · paid_credit > 0     → 'Use existing first' (Buy disabled)
//   · both 0              → Buy enabled; click hits Stripe with no
//                            audition_target (standalone purchase)
//
// On Stripe return, success_url has no audition_target so the
// /submit page (or wherever they redirect to) just polls eligibility
// and lands on the form/portfolio without auto-promoting anything.
// Their paid_audits_credit becomes 1, ready to spend on whichever
// backstage project they want.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchFounderStatus, REGISTRATION_PRICE_CENTS, FOUNDER_PRICE_FALLBACK_CENTS, type FounderStatus } from '../lib/pricing'

interface TicketBalance {
  free_remaining: number
  paid_credit:    number
  total_tickets:  number
  free_quota:     number
  prior_active:   number
}

export function TicketWalletCard({ memberId }: { memberId: string }) {
  const [balance,  setBalance]  = useState<TicketBalance | null>(null)
  const [founder,  setFounder]  = useState<FounderStatus | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      void Promise.all([
        supabase.rpc('ticket_balance', { p_member_id: memberId }),
        fetchFounderStatus(),
      ]).then(([bal, fnd]) => {
        if (!alive) return
        if (!bal.error) setBalance(bal.data as TicketBalance)
        setFounder(fnd)
      })
    }
    load()
    // Refresh on the global tickets-updated event · dispatched after a
    // successful audition_project RPC anywhere in the app so this card
    // (and the Nav callout) stay in sync without prop-drilling.
    const onUpdate = () => load()
    window.addEventListener('commitshow:tickets-updated', onUpdate)
    return () => {
      alive = false
      window.removeEventListener('commitshow:tickets-updated', onUpdate)
    }
  }, [memberId])

  const handleBuy = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign in expired · refresh and try again')

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // No audition_target · this is a standalone wallet top-up.
        // success_url falls back to /me so the user lands here after.
        body: JSON.stringify({
          kind: 'audit_fee',
          success_url: `${window.location.origin}/me?payment=success`,
          cancel_url:  `${window.location.origin}/me?payment=canceled`,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (${res.status})`)
      window.location.assign(body.url)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  if (!balance) return null

  const founderActive = !!(founder && founder.windowOpen && founder.remaining > 0)
  const priceCents    = founderActive ? founder.priceCents : REGISTRATION_PRICE_CENTS
  const priceDollars  = (priceCents / 100).toFixed(0)
  const standardDollars = (REGISTRATION_PRICE_CENTS / 100).toFixed(0)

  // Stockpiling allowed (2026-05-11) — buy any time, even with free
  // quota or paid credit remaining. audition_project RPC spends free
  // first then paid, so additional buys just stack.
  const canBuy = true
  const stackHint = balance.free_remaining > 0
    ? 'Stack on top of your free tickets'
    : balance.paid_credit > 0
      ? 'Stack on top of your paid ticket'
      : null

  return (
    <div className="card-navy p-5 mb-6" style={{ borderRadius: '2px', borderLeft: '3px solid var(--gold-500)' }}>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // AUDITION TICKETS
          </div>
          <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Spend one to put a backstage project on stage
          </div>
        </div>

        {/* Ticket count badge — big, easy to read */}
        <div className="flex items-baseline gap-2">
          <div className="font-display font-black tabular-nums" style={{
            fontSize: '2rem',
            color: balance.total_tickets > 0 ? 'var(--gold-500)' : 'var(--text-muted)',
            lineHeight: 1,
          }}>
            {balance.total_tickets}
          </div>
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ticket{balance.total_tickets === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Breakdown line */}
      <div className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        {balance.free_remaining > 0 && (
          <span style={{ color: 'var(--cream)' }}>{balance.free_remaining} free</span>
        )}
        {balance.free_remaining > 0 && balance.paid_credit > 0 && <span> · </span>}
        {balance.paid_credit > 0 && (
          <span style={{ color: 'var(--cream)' }}>{balance.paid_credit} paid</span>
        )}
        {balance.total_tickets === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>No tickets · audition fee applies on next purchase</span>
        )}
      </div>

      {/* Buy CTA + state-specific helper */}
      {error && (
        <div className="mb-3 px-3 py-2 font-mono text-[11px]" style={{
          background: 'rgba(200,16,46,0.08)',
          border: '1px solid rgba(200,16,46,0.4)',
          borderRadius: '2px',
          color: 'var(--scarlet)',
        }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleBuy}
          disabled={!canBuy || busy}
          className="px-4 py-2 text-xs font-medium tracking-wide transition-all inline-flex items-center gap-1.5"
          style={{
            background:   canBuy ? 'var(--gold-500)' : 'rgba(240,192,64,0.18)',
            color:        canBuy ? 'var(--navy-900)' : 'var(--text-muted)',
            border:       'none',
            borderRadius: '2px',
            cursor:       !canBuy ? 'not-allowed' : busy ? 'wait' : 'pointer',
            fontFamily:   'DM Mono, monospace',
            opacity:      busy ? 0.55 : 1,
          }}
        >
          {busy ? (
            'OPENING STRIPE…'
          ) : founderActive ? (
            <>
              <span>BUY 1 TICKET ·</span>
              <s style={{ opacity: 0.55, textDecorationThickness: '1.5px' }}>${standardDollars}</s>
              <strong>${priceDollars}</strong>
            </>
          ) : (
            <span>BUY 1 TICKET · ${priceDollars}</span>
          )}
        </button>

        {!canBuy && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {buyableReason === 'use_free_first'
              ? 'Use your free tickets first'
              : 'Use your existing paid ticket first'}
          </span>
        )}

        {founderActive && canBuy && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--gold-500)' }}>
            {founder!.remaining} founder spots left
          </span>
        )}
      </div>

      <p className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Tickets don't expire · use any time on a backstage project. Payment goes through Stripe ·
        Encore credit recoupable when the project crosses score 85+.
      </p>
    </div>
  )
}
