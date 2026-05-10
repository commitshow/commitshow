// BackstageSection · /me page · backstage projects + ticket balance.
//
// Audit-then-audition split (§16.2 · 2026-05-11). Projects with
// status='backstage' are private to the creator — audit done, owner
// can see them, not on the league. This section surfaces them so the
// owner can promote any of them to 'active' (= on the audition stage)
// at any time.
//
// Each row offers two actions:
//   · Audition (free / paid credit / Stripe) — calls audition_project
//     RPC; on no_ticket, kicks to Stripe with the project_id baked in.
//   · View report — opens /projects/<id> (only owner can see while
//     status='backstage' due to RLS).

import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase, PUBLIC_PROJECT_COLUMNS, type Project } from '../lib/supabase'

interface TicketBalance {
  free_remaining: number
  paid_credit:    number
  total_tickets:  number
  free_quota:     number
  prior_active:   number
}

export function BackstageSection({ memberId }: { memberId: string }) {
  const [backstage, setBackstage] = useState<Project[] | null>(null)
  const [balance,   setBalance]   = useState<TicketBalance | null>(null)
  const [busyId,    setBusyId]    = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const [projRes, balRes] = await Promise.all([
      supabase.from('projects').select(PUBLIC_PROJECT_COLUMNS)
        .eq('creator_id', memberId).eq('status', 'backstage')
        .order('created_at', { ascending: false }),
      supabase.rpc('ticket_balance', { p_member_id: memberId }),
    ])
    setBackstage((projRes.data ?? []) as unknown as Project[])
    if (!balRes.error) setBalance(balRes.data as TicketBalance)
  }, [memberId])

  useEffect(() => { void loadAll() }, [loadAll])

  const handleAudition = async (projectId: string) => {
    setBusyId(projectId)
    setError(null)
    try {
      const { data, error: e } = await supabase.rpc('audition_project', { p_project_id: projectId })
      if (e) throw new Error(e.message)
      const result = data as { ok: boolean; reason?: string }
      if (result.ok) {
        // Reload list + balance · the auditioned row drops off backstage.
        await loadAll()
        return
      }
      if (result.reason === 'no_ticket') {
        await initiateStripeCheckout(projectId)
        return
      }
      throw new Error(result.reason ?? 'Audition failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // Backstage list hasn't loaded yet · render nothing (parent already
  // shows skeleton state via its own loading prop chain).
  if (backstage === null) return null

  // Common case: nothing backstage. Don't take up vertical space —
  // render only the ticket-balance pill if there's anything notable
  // (paid credit > 0 or first-time visitor with full free quota).
  if (backstage.length === 0) {
    if (!balance || balance.total_tickets === 0) return null
    return (
      <div className="mb-6 px-3 py-2.5 flex items-baseline justify-between gap-3 flex-wrap" style={{
        background: 'rgba(240,192,64,0.04)',
        border: '1px solid rgba(240,192,64,0.18)',
        borderRadius: '2px',
      }}>
        <div className="font-mono text-[11px] tracking-wide" style={{ color: 'var(--gold-500)' }}>
          // YOUR TICKETS
        </div>
        <div className="font-mono text-[12px]" style={{ color: 'var(--cream)' }}>
          {balance.free_remaining > 0 && <>{balance.free_remaining} free</>}
          {balance.free_remaining > 0 && balance.paid_credit > 0 && <> · </>}
          {balance.paid_credit > 0 && <>{balance.paid_credit} paid credit</>}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// BACKSTAGE</div>
          <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {backstage.length} audit{backstage.length === 1 ? '' : 's'} ready · only you can see
          </div>
        </div>
        {balance && balance.total_tickets > 0 && (
          <div className="font-mono text-[11px] tracking-wide" style={{ color: 'var(--gold-500)' }}>
            {balance.free_remaining > 0 && <>{balance.free_remaining} free ticket{balance.free_remaining === 1 ? '' : 's'}</>}
            {balance.free_remaining > 0 && balance.paid_credit > 0 && <> · </>}
            {balance.paid_credit > 0 && <>+{balance.paid_credit} paid credit</>}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 font-mono text-xs" style={{
          background: 'rgba(200,16,46,0.08)',
          border: '1px solid rgba(200,16,46,0.4)',
          borderRadius: '2px',
          color: 'var(--scarlet)',
        }}>
          {error}
        </div>
      )}

      <div className="space-y-2">
        {backstage.map(p => (
          <div key={p.id} className="card-navy p-4 flex items-baseline justify-between gap-3 flex-wrap" style={{
            borderLeft: '3px solid var(--gold-500)',
            borderRadius: '2px',
          }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-display font-bold" style={{ color: 'var(--cream)' }}>{p.project_name}</span>
                {p.score_total != null && (
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--gold-500)' }}>
                    {p.score_total}/100
                  </span>
                )}
              </div>
              {p.live_url && (
                <div className="font-mono text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {p.live_url}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                to={`/projects/${p.id}`}
                className="px-3 py-1.5 font-mono text-[11px] tracking-wide whitespace-nowrap"
                style={{
                  background:     'transparent',
                  color:          'var(--cream)',
                  border:         '1px solid rgba(248,245,238,0.2)',
                  borderRadius:   '2px',
                  textDecoration: 'none',
                }}
              >
                View report →
              </Link>
              <button
                type="button"
                onClick={() => handleAudition(p.id)}
                disabled={busyId === p.id}
                className="px-3 py-1.5 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap"
                style={{
                  background:   'var(--gold-500)',
                  color:        'var(--navy-900)',
                  border:       'none',
                  borderRadius: '2px',
                  cursor:       busyId === p.id ? 'wait' : 'pointer',
                  opacity:      busyId === p.id ? 0.6 : 1,
                }}
              >
                {busyId === p.id ? 'PROCESSING…' : 'AUDITION →'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Audition opens the project to feedback from other builders · lands on the live ladder · Encore at score 85+.
      </p>
    </div>
  )
}

async function initiateStripeCheckout(projectId: string) {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) throw new Error('Sign in expired · refresh and try again')

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ kind: 'audit_fee', audition_target: projectId }),
  })
  const body = await res.json()
  if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (${res.status})`)
  window.location.assign(body.url)
}
