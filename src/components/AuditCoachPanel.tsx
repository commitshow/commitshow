// AuditCoachPanel — pre-audition coach UI · §16.2 (2026-05-15)
//
// Sits on the project page when status='backstage' + isOwner. Reads the
// latest snapshot's evidence and renders a 3-5 card list of "do this and
// score goes up" items, each with an estimated point bump and a copy-
// pasteable how-to. Checkboxes persist in localStorage. After 1+ checks
// the Re-audit button enables; firing it reuses the existing analyze
// pipeline (parent passes onReanalyze).
//
// Post-re-audit · the parent re-renders the panel with a fresh snapshot.
// AuditCoach computes:
//   · resolved   = items that USED to be in catalog applicable list but
//                  aren't anymore (the fix landed)
//   · climbed    = displayScore went up · drives the climb chip
//   · bandUp     = scoreBand crossed up · triggers the audition prompt
//
// When bandUp is true, a soft prompt sits at the top of the card asking
// "Climbed to Strong · ready to bring this on stage?" with the existing
// audition CTA. User can either go to /me to spend a ticket or stay in
// backstage and keep iterating.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { detectQuickWins, loadDoneIds, saveDoneIds, type CoachItem, type CoachCategory } from '../lib/auditCoach'
import { scoreBand, bandLabel, bandTone, displayScore } from '../lib/laneScore'

interface TicketBalance {
  free_remaining: number
  paid_credit:    number
  total_tickets:  number
}

interface AuditCoachPanelProps {
  project:        Project
  snapshotRich:   Record<string, unknown> | null
  lighthouse:     Record<string, unknown> | null
  githubSignals:  Record<string, unknown> | null
  /** Parent supplies the Re-audit hook (same one used by the Hero
   *  Re-audit button). Coach calls it without forwarding any payload —
   *  parent is responsible for showing progress + refetching. */
  onReanalyze?:   () => void | Promise<void>
  /** True while the parent's onReanalyze is in flight · disables the
   *  Re-audit button + shows a busy state. */
  reanalyzing?:   boolean
  /** Previous band (snapshot before the latest re-audit). When the
   *  current band > previous, surface the soft audition prompt. Parent
   *  remembers this in state across re-audit firings. */
  previousBand?:  ReturnType<typeof scoreBand> | null
}

const CATEGORY_TONE: Record<CoachCategory, string> = {
  meta:        '#60A5FA',
  security:    '#A78BFA',
  repo:        '#00D4AA',
  performance: 'var(--gold-500)',
}
const CATEGORY_LABEL: Record<CoachCategory, string> = {
  meta:        'META',
  security:    'SECURITY',
  repo:        'REPO',
  performance: 'PERF',
}

const BAND_RANK: Record<string, number> = {
  unknown: 0, early: 1, building: 2, strong: 3, encore: 4,
}

export function AuditCoachPanel({
  project, snapshotRich, lighthouse, githubSignals,
  onReanalyze, reanalyzing = false, previousBand = null,
}: AuditCoachPanelProps) {
  const navigate = useNavigate()
  const { user } = useAuth()

  // 2026-05-15 · in-panel one-click audition (CEO ask: friction 3 → 1).
  // Previous flow: band climbs → user clicks "BRING IT ON STAGE →"
  // here → lands on /me → finds BackstageSection → clicks audition
  // → ticket spent → redirected to /projects/<id>. That's 3 clicks
  // + 1 navigation. Now: same RPC fires directly from this panel.
  //
  // Mirrors AuditionPromoteCard's handleAudition · we duplicate the
  // RPC plumbing inline rather than extract (only 2 callers · keeping
  // the helper local lets us evolve copy + UX per surface without
  // generalising prematurely).
  const [ticketBalance, setTicketBalance] = useState<TicketBalance | null>(null)
  const [auditionBusy,  setAuditionBusy]  = useState(false)
  const [auditionDone,  setAuditionDone]  = useState(false)
  const [auditionError, setAuditionError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    supabase.rpc('ticket_balance', { p_member_id: user.id }).then(({ data, error }) => {
      if (!alive || error) return
      setTicketBalance(data as TicketBalance)
    })
    // Listen for the tickets-updated event AuditionPromoteCard fires
    // so the balance refreshes when a ticket gets spent elsewhere.
    const refetch = () => {
      if (!user?.id) return
      supabase.rpc('ticket_balance', { p_member_id: user.id }).then(({ data, error }) => {
        if (!alive || error) return
        setTicketBalance(data as TicketBalance)
      })
    }
    window.addEventListener('commitshow:tickets-updated', refetch)
    return () => {
      alive = false
      window.removeEventListener('commitshow:tickets-updated', refetch)
    }
  }, [user?.id])

  const auditionNow = async () => {
    setAuditionBusy(true)
    setAuditionError(null)
    try {
      const { data, error } = await supabase.rpc('audition_project', { p_project_id: project.id })
      if (error) throw new Error(error.message)
      const result = data as { ok: boolean; reason?: string; used?: 'free' | 'credit' }
      if (result.ok) {
        // Notify other surfaces (TicketWalletCard etc.) to refetch.
        window.dispatchEvent(new CustomEvent('commitshow:tickets-updated'))
        setAuditionDone(true)
        setTimeout(() => navigate(`/projects/${project.id}`), 900)
        return
      }
      if (result.reason === 'no_ticket') {
        // Out of tickets · funnel to /me where TicketWalletCard +
        // BackstageSection have the full Stripe purchase flow.
        // Direct Stripe init lives in AuditionPromoteCard but importing
        // it here would create a cyclic dep — /me detour is cheap.
        navigate('/me')
        return
      }
      throw new Error(result.reason ?? 'Audition failed')
    } catch (err) {
      setAuditionBusy(false)
      setAuditionError((err as Error).message)
    }
  }

  // Run catalog · only re-derives when snapshot data changes (audit
  // re-fires → parent re-renders with new rich_analysis).
  const items: CoachItem[] = useMemo(() => detectQuickWins({
    rich:          snapshotRich,
    githubSignals,
    lighthouse,
    hasGithubUrl:  !!project.github_url,
    isAppForm:     (project.form_factor ?? 'unknown') === 'app' || (project.form_factor ?? 'unknown') === 'unknown',
  }), [snapshotRich, githubSignals, lighthouse, project.github_url, project.form_factor])

  // Cap the visible list at 6 · more than that and the panel reads
  // overwhelming. User finishes the top wins, re-audits, panel refreshes
  // with the next batch.
  const visible = items.slice(0, 6)

  // Checked state · localStorage-backed, keyed by project id so each
  // project keeps its own progress.
  const [done, setDone] = useState<Set<string>>(() => loadDoneIds(project.id))
  useEffect(() => { saveDoneIds(project.id, done) }, [project.id, done])

  // Auto-prune · once an item leaves the applicable catalog (the fix
  // landed → detect returns false), remove its id from the done set so
  // localStorage doesn't grow indefinitely.
  useEffect(() => {
    const applicableIds = new Set(items.map(i => i.id))
    let mutated = false
    const next = new Set<string>()
    for (const id of done) {
      if (applicableIds.has(id)) next.add(id)
      else mutated = true
    }
    if (mutated) setDone(next)
    // intentionally only depend on items · this prunes per-snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const toggle = (id: string) => setDone(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const checkedCount = [...done].filter(id => visible.some(i => i.id === id)).length
  const totalImpact  = visible.reduce((sum, i) => done.has(i.id) ? sum + i.impact : sum, 0)

  const currentScore = displayScore(project)
  const currentBand  = scoreBand(currentScore)
  const bandClimbed  = !!previousBand
                    && previousBand !== currentBand
                    && (BAND_RANK[currentBand] ?? 0) > (BAND_RANK[previousBand] ?? 0)

  // ── Auto-audition prompt · only when band climbed AND the new band
  // is Strong or higher (no point inviting them to stage at Early).
  const auditionPrompt = bandClimbed && (currentBand === 'strong' || currentBand === 'encore')

  // Empty state · no applicable items. Either a fresh audit found
  // nothing to fix (unlikely but possible at 95+) or all the catalog
  // items the engine could detect are resolved.
  if (visible.length === 0) {
    return (
      <div
        className="mb-6 p-5"
        style={{
          background: 'rgba(0,212,170,0.04)',
          border: '1px solid rgba(0,212,170,0.25)',
          borderRadius: '2px',
        }}
      >
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: '#00D4AA' }}>
          // COACH · NO QUICK WINS LEFT
        </div>
        <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>
          The cheap fixes are already done
        </div>
        <p className="font-light text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Everything the engine can auto-detect is in place. To climb further you'll need to dig into the audit report itself —
          the strengths and concerns above are where the next gains hide.
        </p>
      </div>
    )
  }

  return (
    <div
      className="mb-6"
      style={{
        background: 'rgba(240,192,64,0.04)',
        border: '1px solid rgba(240,192,64,0.3)',
        borderRadius: '2px',
      }}
    >
      {/* Header strip */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(240,192,64,0.18)' }}>
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // PRE-AUDITION COACH · {visible.length} QUICK WIN{visible.length === 1 ? '' : 'S'}
        </div>
        <h3 className="font-display font-bold text-xl mt-1" style={{ color: 'var(--cream)' }}>
          Climb before you audition
        </h3>
        <p className="font-light text-sm mt-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Each card is something we measured and didn't see. Knock out a few, hit Re-audit, and watch the score move
          — no audition needed until you like the number.
        </p>
        {checkedCount > 0 && (
          <div className="mt-3 font-mono text-xs" style={{ color: '#00D4AA' }}>
            ✓ {checkedCount} marked done · expected +{totalImpact}pt on re-audit
          </div>
        )}
      </div>

      {/* Auto-audition prompt · only when band actually climbed up.
          2026-05-15 · in-panel one-click audition. CTA fires
          audition_project directly · success → /projects/<id>,
          no-ticket → /me (Stripe purchase lives there). */}
      {auditionPrompt && (
        <div
          className="mx-5 my-4 px-4 py-3"
          style={{
            background:   auditionDone ? 'rgba(0,212,170,0.08)' : `${bandTone(currentBand)}15`,
            border:       `1px dashed ${auditionDone ? 'rgba(0,212,170,0.55)' : `${bandTone(currentBand)}66`}`,
            borderRadius: '2px',
          }}
        >
          {auditionDone ? (
            <div>
              <div className="font-mono text-xs tracking-widest" style={{ color: '#00D4AA' }}>
                ⤴ ON STAGE · AUDITIONING NOW
              </div>
              <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                Redirecting to your product page…
              </div>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-mono text-xs tracking-widest" style={{ color: bandTone(currentBand) }}>
                  ⤴ CLIMBED TO {bandLabel(currentBand).toUpperCase()}
                </div>
                <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Solid jump · the project's holding its shape after the fixes. Want feedback from the MVPs already on stage?
                </div>
                {/* Inline ticket line · tells the user exactly what
                    spending the audition costs. Loading state stays
                    quiet · users see it the moment the RPC resolves. */}
                {ticketBalance && (
                  <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    {ticketBalance.free_remaining > 0
                      ? <>uses 1 of <strong style={{ color: 'var(--cream)' }}>{ticketBalance.free_remaining} free ticket{ticketBalance.free_remaining === 1 ? '' : 's'}</strong></>
                      : ticketBalance.paid_credit > 0
                        ? <>uses 1 of <strong style={{ color: 'var(--cream)' }}>{ticketBalance.paid_credit} paid ticket{ticketBalance.paid_credit === 1 ? '' : 's'}</strong></>
                        : <>no free tickets · checkout opens on click</>}
                  </div>
                )}
                {auditionError && (
                  <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--scarlet)' }}>
                    {auditionError}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={auditionNow}
                disabled={auditionBusy}
                className="px-4 py-2 font-mono text-xs font-medium tracking-wide whitespace-nowrap"
                style={{
                  background:   bandTone(currentBand),
                  color:        'var(--navy-900)',
                  border:       'none',
                  borderRadius: '2px',
                  cursor:       auditionBusy ? 'wait' : 'pointer',
                  opacity:      auditionBusy ? 0.6 : 1,
                }}
              >
                {auditionBusy
                  ? 'AUDITIONING…'
                  : ticketBalance && ticketBalance.free_remaining > 0
                    ? 'AUDITION · FREE TICKET →'
                    : ticketBalance && ticketBalance.paid_credit > 0
                      ? 'AUDITION · PAID TICKET →'
                      : ticketBalance
                        ? 'AUDITION · CHECKOUT →'
                        : 'BRING IT ON STAGE →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Item list */}
      <ul className="px-5 py-4 space-y-3">
        {visible.map(item => (
          <CoachRow
            key={item.id}
            item={item}
            checked={done.has(item.id)}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </ul>

      {/* Re-audit CTA */}
      <div className="px-5 pb-5 pt-2 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: '1px solid rgba(240,192,64,0.15)' }}>
        <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {checkedCount > 0
            ? <>Ship your fixes, then re-audit. The 24-hour cooldown is waived for the first re-audit after a coach session.</>
            : <>Pick one above to start. Even a 5-minute fix usually nets the +pt the chip promises.</>}
        </div>
        <button
          type="button"
          disabled={!onReanalyze || reanalyzing || checkedCount === 0}
          onClick={() => onReanalyze && onReanalyze()}
          className="px-5 py-2.5 font-mono text-xs font-medium tracking-widest whitespace-nowrap"
          style={{
            background:   checkedCount > 0 ? 'var(--gold-500)' : 'transparent',
            color:        checkedCount > 0 ? 'var(--navy-900)' : 'var(--text-muted)',
            border:       checkedCount > 0 ? 'none' : '1px solid rgba(248,245,238,0.15)',
            borderRadius: '2px',
            cursor:       checkedCount > 0 && !reanalyzing ? 'pointer' : 'not-allowed',
            opacity:      reanalyzing ? 0.6 : 1,
          }}
        >
          {reanalyzing ? 'RE-AUDITING…' : checkedCount > 0 ? 'RE-AUDIT NOW →' : 'CHECK ITEMS TO ENABLE'}
        </button>
      </div>
    </div>
  )
}

// ── Single card row ─────────────────────────────────────────
function CoachRow({ item, checked, onToggle }: { item: CoachItem; checked: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const tone  = CATEGORY_TONE[item.category]
  const cat   = CATEGORY_LABEL[item.category]
  return (
    <li
      style={{
        background: checked ? 'rgba(0,212,170,0.04)' : 'rgba(255,255,255,0.02)',
        border:     `1px solid ${checked ? 'rgba(0,212,170,0.3)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: '2px',
      }}
    >
      <div className="px-3 py-3 flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label={checked ? 'Mark as not done' : 'Mark as done'}
          className="flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{
            width:        20,
            height:       20,
            background:   checked ? '#00D4AA' : 'transparent',
            border:       `1.5px solid ${checked ? '#00D4AA' : 'rgba(248,245,238,0.3)'}`,
            borderRadius: '2px',
            cursor:       'pointer',
            color:        'var(--navy-900)',
            fontSize:     12,
            fontWeight:   700,
          }}
        >
          {checked ? '✓' : ''}
        </button>

        {/* Body · click to expand */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex-1 text-left"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span
              className="font-display font-bold text-base"
              style={{
                color:           checked ? 'var(--text-secondary)' : 'var(--cream)',
                textDecoration:  checked ? 'line-through' : 'none',
              }}
            >
              {item.title}
            </span>
            <span className="flex items-center gap-2 flex-shrink-0">
              <span
                className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
                style={{
                  background:   `${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.1)' : `${tone}1A`}`,
                  color:        tone,
                  border:       `1px solid ${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.3)' : `${tone}4D`}`,
                  borderRadius: '2px',
                }}
              >
                {cat}
              </span>
              <span className="font-mono text-xs tabular-nums" style={{ color: '#00D4AA', fontWeight: 600 }}>
                +{item.impact}pt
              </span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                {expanded ? '−' : '+'}
              </span>
            </span>
          </div>
          <p className="font-light text-sm mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            {item.why}
          </p>
        </button>
      </div>

      {/* Expanded · how-to */}
      {expanded && (
        <div
          className="mx-3 mb-3 px-3 py-3 font-mono text-[12px] whitespace-pre-wrap"
          style={{
            background:    'rgba(6,12,26,0.5)',
            border:        '1px solid rgba(255,255,255,0.06)',
            borderRadius:  '2px',
            color:         'var(--text-primary)',
            lineHeight:    1.6,
          }}
        >
          {item.howTo}
        </div>
      )}
    </li>
  )
}
