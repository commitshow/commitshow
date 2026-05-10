// AuditionPromoteCard · post-audit promotion CTA.
//
// Audit-then-audition split (§16.2 · 2026-05-11). The user has just
// finished their audit (project sits at status='backstage'). This card
// asks: "Want to put this on the audition stage? Or keep it backstage?"
//
// Three outcomes:
//   1. Free ticket available → audition_project RPC flips to 'active'
//      and we redirect to /projects/<id> for the public view.
//   2. Paid credit available → same RPC, decrements paid_audits_credit.
//   3. No tickets → we kick to Stripe Checkout with the project_id baked
//      into metadata · success_url returns to /submit?payment=success&
//      audition_target=<id>, where PostPaymentAuditionPromote takes
//      over and auto-promotes once the webhook lands.
//
// Tickets visible at all times (free X · paid Y) so the user knows
// what they're spending and what's left.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface TicketBalance {
  free_remaining: number
  paid_credit:    number
  total_tickets:  number
  free_quota:     number
  prior_active:   number
}

interface AuditionPromoteCardProps {
  projectId: string
  memberId:  string
  scoreTotal: number | null
}

export function AuditionPromoteCard({ projectId, memberId, scoreTotal }: AuditionPromoteCardProps) {
  const navigate = useNavigate()
  const [balance, setBalance] = useState<TicketBalance | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [done,    setDone]    = useState(false)

  useEffect(() => {
    let alive = true
    supabase.rpc('ticket_balance', { p_member_id: memberId }).then(({ data, error: e }) => {
      if (!alive) return
      if (e) { setError(e.message); return }
      setBalance(data as TicketBalance)
    })
    return () => { alive = false }
  }, [memberId])

  const handleAudition = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: e } = await supabase.rpc('audition_project', { p_project_id: projectId })
      if (e) throw new Error(e.message)
      const result = data as { ok: boolean; reason?: string; used?: 'free' | 'credit'; tickets_remaining?: number }
      if (result.ok) {
        // Notify all ticket-balance surfaces so they refetch · keeps
        // TicketWalletCard, AuditionTicketsCallout, BackstageSection
        // in sync without prop-drilling.
        window.dispatchEvent(new CustomEvent('commitshow:tickets-updated'))
        setDone(true)
        // Brief pause so the success state lands visually, then redirect.
        setTimeout(() => navigate(`/projects/${projectId}`), 900)
        return
      }
      if (result.reason === 'no_ticket') {
        // Out of tickets · kick to Stripe with project_id baked in.
        await initiateStripeCheckout(projectId)
        return
      }
      throw new Error(result.reason ?? 'Audition failed')
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  const handleKeepBackstage = () => navigate('/me')

  if (done) {
    return (
      <div className="card-navy p-7 mb-6" style={{ borderRadius: '2px', borderLeft: '3px solid #00D4AA' }}>
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: '#00D4AA' }}>// ON STAGE</div>
        <div className="font-display font-bold text-xl mb-1" style={{ color: 'var(--cream)' }}>
          Auditioning now
        </div>
        <p className="font-light text-sm" style={{ color: 'rgba(248,245,238,0.55)' }}>
          Redirecting to your project page…
        </p>
      </div>
    )
  }

  const ticketLine = balance
    ? balance.free_remaining > 0
      ? `${balance.free_remaining} free ticket${balance.free_remaining === 1 ? '' : 's'} remaining${balance.paid_credit > 0 ? ` · +${balance.paid_credit} paid ticket${balance.paid_credit === 1 ? '' : 's'}` : ''}`
      : balance.paid_credit > 0
        ? `${balance.paid_credit} paid ticket${balance.paid_credit === 1 ? '' : 's'} available`
        : 'No tickets · audition fee applies'
    : 'Loading tickets…'

  const auditionLabel = balance
    ? balance.free_remaining > 0
      ? `Audition with free ticket →`
      : balance.paid_credit > 0
        ? `Audition with paid ticket →`
        : `Audition with payment →`
    : 'Audition →'

  // Visual band based on score · matches the four-band convention used
  // elsewhere (encore 85+ · strong 70-84 · building 50-69 · early <50).
  const scoreBand = scoreTotal == null ? 'unknown'
                  : scoreTotal >= 85   ? 'encore'
                  : scoreTotal >= 70   ? 'strong'
                  : scoreTotal >= 50   ? 'building'
                  :                       'early'
  const bandColor = scoreBand === 'encore'   ? 'var(--gold-500)'
                  : scoreBand === 'strong'   ? '#00D4AA'
                  : scoreBand === 'building' ? '#60A5FA'
                  : scoreBand === 'early'    ? 'var(--scarlet)'
                  :                            'var(--text-muted)'
  const bandLabel = scoreBand === 'encore'   ? 'ENCORE TERRITORY'
                  : scoreBand === 'strong'   ? 'STRONG'
                  : scoreBand === 'building' ? 'BUILDING'
                  : scoreBand === 'early'    ? 'EARLY DAYS'
                  :                            'AUDIT COMPLETE'

  return (
    <div className="card-navy p-7 mb-6" style={{ borderRadius: '2px', borderLeft: `3px solid ${bandColor}` }}>
      <div className="font-mono text-xs tracking-widest mb-3" style={{ color: bandColor }}>
        // {bandLabel} · NEXT STEP
      </div>

      {/* Big total-score badge · always visible regardless of band so the
          user sees their number before reading anything else. The pillar
          mini-line below decomposes Audit / Scout / Community for context
          (Scout · Community will be 0 for a fresh backstage audit since
          nobody's seen it yet — labelled accordingly). */}
      {scoreTotal != null && (
        <div className="flex items-baseline gap-3 mb-4 flex-wrap">
          <div className="font-display font-black tabular-nums leading-none" style={{
            fontSize: '3.25rem',
            color: bandColor,
          }}>
            {scoreTotal}
            <span className="font-mono font-normal" style={{
              fontSize: '1rem',
              color: 'var(--text-muted)',
              marginLeft: '0.25rem',
            }}>/ 100</span>
          </div>
          <div className="font-mono text-[10px] tracking-wide" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            audit pillar live<br />
            scout · community open up once you publish
          </div>
        </div>
      )}

      <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>
        Want eyes on this build?
      </div>
      <p className="font-light text-sm mb-5" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.6 }}>
        Your audit is done — right now only you can see it (we call this <em style={{ color: 'var(--cream)', fontStyle: 'normal' }}>backstage</em>).
        Audition to put it on stage and get real feedback from other builders. The project goes public,
        lands on its category ladder, and earns the permanent Encore badge at score 85+.
        {scoreTotal != null && scoreTotal >= 85 && (
          <> <span style={{ color: 'var(--gold-500)' }}>You're already there — Encore lands the moment you go public.</span></>
        )}
      </p>

      {/* Ticket line */}
      <div className="mb-5 px-3 py-2 font-mono text-[12px]" style={{
        background: 'rgba(240,192,64,0.06)',
        border: '1px solid rgba(240,192,64,0.2)',
        borderRadius: '2px',
        color: balance && balance.total_tickets > 0 ? 'var(--gold-500)' : 'var(--text-secondary)',
      }}>
        {ticketLine}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 font-mono text-xs" style={{
          background: 'rgba(200,16,46,0.08)',
          border: '1px solid rgba(200,16,46,0.4)',
          borderRadius: '2px',
          color: 'var(--scarlet)',
        }}>
          {error}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleAudition}
          disabled={busy || !balance}
          className="px-6 py-3 text-sm font-medium tracking-wide transition-all"
          style={{
            background: 'var(--gold-500)',
            color: 'var(--navy-900)',
            border: 'none',
            borderRadius: '2px',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy || !balance ? 0.6 : 1,
            fontFamily: 'DM Mono, monospace',
            boxShadow: '0 0 30px rgba(240,192,64,0.18)',
          }}
        >
          {busy ? 'PROCESSING…' : auditionLabel}
        </button>
        <button
          type="button"
          onClick={handleKeepBackstage}
          disabled={busy}
          className="px-6 py-3 text-sm font-medium tracking-wide transition-all"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
            fontFamily: 'DM Mono, monospace',
          }}
        >
          Keep backstage →
        </button>
      </div>

      <p className="font-mono text-[10px] mt-4" style={{ color: 'rgba(248,245,238,0.35)', lineHeight: 1.6 }}>
        Backstage projects stay on your /me page · audition them later anytime.
      </p>
    </div>
  )
}

// Kick the user to Stripe Checkout with the backstage project baked into
// metadata · the post-payment redirect lands at PostPaymentAuditionPromote
// which auto-promotes the target the moment the webhook arrives.
async function initiateStripeCheckout(projectId: string) {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) throw new Error('Sign in expired · refresh and try again')

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      kind: 'audit_fee',
      audition_target: projectId,
    }),
  })
  const body = await res.json()
  if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (${res.status})`)
  window.location.assign(body.url)
}
