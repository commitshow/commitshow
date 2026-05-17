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
import { deleteProject } from '../lib/projectQueries'

export function BackstageSection({ memberId }: { memberId: string }) {
  const [backstage,     setBackstage]     = useState<Project[] | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  // 2026-05-17 · which row is being confirm-removed inline. Two-step
  // remove (click trash icon → row shows "Sure? · REMOVE / CANCEL")
  // so the destructive action lives in the same visual space as the
  // row. Cleans up duplicate / abandoned backstage entries.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removingId,      setRemovingId]      = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const { data } = await supabase.from('projects').select(PUBLIC_PROJECT_COLUMNS)
      .eq('creator_id', memberId).eq('status', 'backstage')
      .order('created_at', { ascending: false })
    setBackstage((data ?? []) as unknown as Project[])
    // Ticket balance is shown by TicketWalletCard on /me · this list
    // no longer renders it inline, so we skip the RPC round-trip.
  }, [memberId])

  useEffect(() => {
    void loadAll()
    const onUpdate = () => { void loadAll() }
    window.addEventListener('commitshow:tickets-updated', onUpdate)
    return () => window.removeEventListener('commitshow:tickets-updated', onUpdate)
  }, [loadAll])

  const handleRemove = async (projectId: string) => {
    setRemovingId(projectId)
    setError(null)
    try {
      const { error: e } = await deleteProject(projectId)
      if (e) throw new Error(e)
      setConfirmRemoveId(null)
      await loadAll()
    } catch (err) {
      setError(`Remove failed · ${(err as Error).message}`)
    } finally {
      setRemovingId(null)
    }
  }

  // Audition + Polish flow live on /projects/<id> now (the management
  // hub). The audition_project RPC + Stripe fallback + polish gate are
  // all surfaced there. This section is a list, not a dispatcher.

  // Backstage list hasn't loaded yet · render nothing (parent already
  // shows skeleton state via its own loading prop chain).
  if (backstage === null) return null

  // No backstage projects · render nothing. Ticket balance is now
  // owned by TicketWalletCard on /me, so we don't duplicate it here.
  if (backstage.length === 0) return null

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// BACKSTAGE</div>
          <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {backstage.length} audit{backstage.length === 1 ? '' : 's'} ready · only you can see
          </div>
        </div>
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
        {backstage.map(p => {
          return (
            <div key={p.id} id={`backstage-row-${p.id}`}>
              <div className="card-navy p-4 flex items-baseline justify-between gap-3 flex-wrap" style={{
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
                {/* Single primary action · "Open" enters the project
                    detail page where audit report + Coach panel +
                    Polish gate + Re-audit + Audition CTA + Remove zone
                    all live as one management hub. Previously each row
                    sprouted 3-4 buttons (Coach toggle / View report /
                    Audition / Remove) which read as decision-overload
                    on a scan · 2026-05-17 consolidation. The Remove
                    icon stays inline because it's the one action that
                    only makes sense from the list view (cleaning a
                    duplicate row · you don't need to open it first). */}
                <div className="flex gap-2 flex-wrap">
                  {confirmRemoveId === p.id ? (
                    <div className="flex items-center gap-2 px-2 py-1.5" style={{
                      background: 'rgba(200,16,46,0.08)',
                      border: '1px solid rgba(200,16,46,0.35)',
                      borderRadius: '2px',
                    }}>
                      <span className="font-mono text-[10px]" style={{ color: 'var(--scarlet)' }}>Remove this audition?</span>
                      <button
                        type="button"
                        onClick={() => handleRemove(p.id)}
                        disabled={removingId === p.id}
                        className="px-2 py-1 font-mono text-[10px] tracking-wide"
                        style={{
                          background:   'var(--scarlet)',
                          color:        'var(--cream)',
                          border:       'none',
                          borderRadius: '2px',
                          cursor:       removingId === p.id ? 'wait' : 'pointer',
                          opacity:      removingId === p.id ? 0.6 : 1,
                        }}
                      >
                        {removingId === p.id ? 'REMOVING…' : 'REMOVE'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        disabled={removingId === p.id}
                        className="px-2 py-1 font-mono text-[10px] tracking-wide"
                        style={{
                          background:   'transparent',
                          color:        'var(--cream)',
                          border:       '1px solid rgba(248,245,238,0.2)',
                          borderRadius: '2px',
                          cursor:       'pointer',
                        }}
                      >
                        CANCEL
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(p.id)}
                        aria-label="Remove this backstage audition"
                        title="Remove this backstage audition"
                        className="flex items-center justify-center transition-colors"
                        style={{
                          width: 32, height: 32,
                          background:   'transparent',
                          color:        'var(--text-muted)',
                          border:       '1px solid rgba(248,245,238,0.12)',
                          borderRadius: '2px',
                          cursor:       'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--scarlet)'; e.currentTarget.style.borderColor = 'rgba(200,16,46,0.45)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'rgba(248,245,238,0.12)' }}
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                      <Link
                        to={`/projects/${p.id}`}
                        className="px-4 py-2 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap"
                        style={{
                          background:     'var(--gold-500)',
                          color:          'var(--navy-900)',
                          border:         'none',
                          borderRadius:   '2px',
                          textDecoration: 'none',
                        }}
                      >
                        OPEN →
                      </Link>
                    </>
                  )}
                </div>
              </div>
              {/* 2026-05-17 · inline Coach panel + PolishGate were
                  moved off this list view onto /projects/<id> (the
                  owner-mode management hub). The list stays minimal:
                  one row per audition, single OPEN action, single
                  Remove icon. Multi-button rows + collapsible panels
                  conflicted with the "scan list → enter one" mental
                  model the page is supposed to support. */}
            </div>
          )
        })}
      </div>

      <p className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Audition opens the project to feedback from other builders · lands on the live ladder · Encore at score 85+.
      </p>
    </div>
  )
}

// initiateStripeCheckout moved to ProjectDetailPage's owner-mode
// management hub (2026-05-17 consolidation) — audition + ticket
// fallback live where the rest of the project actions live.
