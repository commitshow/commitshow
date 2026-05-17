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

// ticket_balance can also return `{ error: 'caller_target_mismatch' }`
// when caller != target (defense in depth · §RPC contract). Coach only
// ever queries the user's own balance so this branch can't fire here,
// but we still type-guard to stop a future refactor from silently
// reading undefined .free_remaining.
function isTicketBalance(v: unknown): v is TicketBalance {
  return !!v && typeof v === 'object'
      && typeof (v as { free_remaining?: unknown }).free_remaining === 'number'
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
  /** Fires when the polish gate is needed (project missing description /
   *  thumbnail). Parent should expand BackstagePolishGate inline so the
   *  user never leaves the management hub. Falls back to a navigate
   *  redirect if the parent doesn't provide the callback. */
  onPolishNeeded?: () => void
  /** Fires after audition_project flips status backstage→active. Parent
   *  must refetch the project so the page re-renders without the Coach
   *  (status='active' gates it out) — the user is already on
   *  /projects/<id> so a navigate() to the same URL would be a no-op
   *  and the Coach would stay visible with "Redirecting…" forever. */
  onAuditioned?:  () => void | Promise<void>
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
  onAuditioned, onPolishNeeded,
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
      if (isTicketBalance(data)) setTicketBalance(data)
    })
    // Listen for the tickets-updated event AuditionPromoteCard fires
    // so the balance refreshes when a ticket gets spent elsewhere.
    const refetch = () => {
      if (!user?.id) return
      supabase.rpc('ticket_balance', { p_member_id: user.id }).then(({ data, error }) => {
        if (!alive || error) return
        if (isTicketBalance(data)) setTicketBalance(data)
      })
    }
    window.addEventListener('commitshow:tickets-updated', refetch)
    return () => {
      alive = false
      window.removeEventListener('commitshow:tickets-updated', refetch)
    }
  }, [user?.id])

  const auditionNow = async () => {
    // Polish gate · same rule as BackstageSection on /me · description
    // + at least one image are required for the public stage card.
    // Polish logic lives in one place (BackstagePolishGate) · the Coach
    // just routes the user there when the card isn't ready. Keeps the
    // gate from being duplicated across surfaces.
    const hasDescription = !!(project.description && project.description.trim().length > 0)
    const hasImages      = Array.isArray(project.images) && project.images.length > 0
    if (!hasDescription || !hasImages) {
      // 2026-05-17 · prefer inline polish gate via parent callback so
      // the user stays on the management hub. Falls back to the
      // legacy navigate path for surfaces that haven't wired the
      // callback yet.
      if (onPolishNeeded) {
        onPolishNeeded()
      } else {
        navigate('/me?polish=' + project.id)
      }
      return
    }
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
        // We're already on /projects/<id> · navigate to the same URL
        // is a no-op (router skips · no remount · no refetch), which
        // would leave the Coach stuck on "Redirecting…" with stale
        // status='backstage'. Instead poke the parent to refetch the
        // project so the page re-renders with status='active' and the
        // Coach gate evaluates to false.
        if (onAuditioned) {
          void onAuditioned()
        } else {
          // Fallback for surfaces that didn't wire the callback ·
          // hard-reload guarantees the new state is visible.
          setTimeout(() => window.location.assign(`/projects/${project.id}`), 900)
        }
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

  // 2026-05-17 · loop model (CEO 피드백) · was a todo-tracker with
  // checkboxes + cumulative localStorage state across audits. Replaced
  // with a per-audit refresh: each audit run surfaces the TOP 3 most
  // impactful detected items, user pastes the fixes, re-audits, panel
  // refreshes with the NEW top 3 for this audit's evidence. The static
  // todo list was inaccurate because the catalog applicability changes
  // every audit anyway (signals shift, problems get auto-resolved,
  // new ones surface). 3 cards keeps focus tight on what to fix
  // RIGHT NOW · not an overwhelming roadmap.
  //
  // detectQuickWins already returns items sorted by impact desc, so
  // slicing the head gives the top by impact.
  const TOP_N = 3
  const visible = items.slice(0, TOP_N)

  // Cumulative-todo localStorage state is no longer used. The
  // load/save helpers stay imported for backward compat in case any
  // other surface mounts a Coach instance · we silently noop here.
  void loadDoneIds; void saveDoneIds
  const done = new Set<string>()
  const toggle = (_id: string) => {/* no-op · loop model · re-audit is the action */ }

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
      {/* Header strip · loop model 2026-05-17 · was "N quick wins" with
          a cumulative tracker; now "Top 3 to fix now" with a fresh list
          per audit. Each card shows a paste-ready snippet · user
          pastes into their editor / AI, re-audits, the panel returns
          with the NEW top 3 from whatever the next audit flags. */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(240,192,64,0.18)' }}>
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // COACH · TOP {visible.length} TO FIX NOW
        </div>
        <h3 className="font-display font-bold text-xl mt-1" style={{ color: 'var(--cream)' }}>
          Fix these {visible.length}, then re-audit
        </h3>
        <p className="font-light text-sm mt-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Each audit surfaces the top items the engine flagged. Paste the snippet, ship the change, hit
          re-audit — the next audit will surface its own top items based on what's left.
        </p>
        <p className="font-mono text-[11px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          The climb is iterative · most builders run a few cycles before they're happy with the number.
        </p>
        {/* Cumulative "marked done" strip removed with the loop model.
            Was misleading: catalog applicability changes per audit so
            the running tally never matched what the next audit
            actually found. */}
        {/* Open Mic share · only after at least one re-audit so we're
            inviting the user to share an actual climb story, not a
            fresh empty post. previousBand is set the moment the user
            kicks off a re-audit (parent state) — using it as the
            'has iterated at least once' signal.
            2026-05-18 · body template added · CEO 피드백 · the link
            was only seeding title+tldr+tags, leaving the body
            textarea empty. Now seeds a draft markdown body with
            the score delta, a "what I fixed" prompt, and the top
            concerns from the current snapshot — user just edits
            the prompt and hits publish instead of writing from
            scratch. */}
        {previousBand && (() => {
          const score = displayScore(project)
          const projectName = project.project_name || 'this build'
          const title = `${score} after re-audit · ${projectName}`
          const tldr  = 'What I fixed this cycle and what the audit found next.'
          // Top concerns from the current snapshot · max 3, plain
          // strings so the markdown body stays readable.
          const rawWeak = (snapshotRich as { scout_brief?: { weaknesses?: unknown } } | null)?.scout_brief?.weaknesses
          const weaknesses: string[] = Array.isArray(rawWeak)
            ? rawWeak.slice(0, 3).map(w => {
                if (typeof w === 'string') return w
                if (w && typeof w === 'object' && 'bullet' in w && typeof (w as { bullet: unknown }).bullet === 'string') {
                  return (w as { bullet: string }).bullet
                }
                return ''
              }).filter(Boolean)
            : []
          const concernsBlock = weaknesses.length > 0
            ? weaknesses.map(w => `- ${w}`).join('\n')
            : '- (audit found nothing new to fix · ship time)'
          const body = [
            `## ${previousBand} → ${currentBand} · ${score}/100`,
            '',
            '### What I fixed this cycle',
            '- ',
            '- ',
            '',
            '### What the audit flagged next',
            concernsBlock,
            '',
            '### Next move',
            '- ',
            '',
            `— ${projectName} on commit.show`,
          ].join('\n')
          const url = `/community/open-mic/new?title=${encodeURIComponent(title)}&tldr=${encodeURIComponent(tldr)}&body=${encodeURIComponent(body)}&tags=vibe-life,ship-log`
          return (
            <a
              href={url}
              className="inline-flex items-center gap-1.5 mt-3 font-mono text-[11px] tracking-wide"
              style={{ color: '#00D4AA', textDecoration: 'none' }}
            >
              <span>Share your climb on Open Mic</span>
              <span aria-hidden="true">→</span>
            </a>
          )
        })()}
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

      {/* Re-audit CTA · loop model 2026-05-17 · always enabled (was
          gated to checkedCount > 0 under the todo-tracker model). The
          user is in charge of when they re-audit · their action is
          "I shipped a fix, run again", not "I clicked enough boxes
          to unlock the button". */}
      <div className="px-5 pb-5 pt-2 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: '1px solid rgba(240,192,64,0.15)' }}>
        <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Ship a fix, then re-audit · the next audit surfaces its own top {visible.length}. The 24-hour cooldown is waived between coach cycles.
        </div>
        <button
          type="button"
          disabled={!onReanalyze || reanalyzing}
          onClick={() => onReanalyze && onReanalyze()}
          className="px-5 py-2.5 font-mono text-xs font-medium tracking-widest whitespace-nowrap"
          style={{
            background:   'var(--gold-500)',
            color:        'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       reanalyzing || !onReanalyze ? 'wait' : 'pointer',
            opacity:      reanalyzing ? 0.6 : 1,
          }}
        >
          {reanalyzing ? 'RE-AUDITING…' : 'RE-AUDIT NOW →'}
        </button>
      </div>
    </div>
  )
}

// ── Single card row ─────────────────────────────────────────
function CoachRow({ item, checked: _checked, onToggle: _onToggle }: { item: CoachItem; checked: boolean; onToggle: () => void }) {
  // 2026-05-17 loop model · `checked` + `onToggle` props kept for the
  // call-site signature but unused. The checkbox/done-tracker is gone
  // because each audit refreshes the top 3 from scratch (no cumulative
  // state to track). Expanded by default — the snippet IS the value,
  // forcing a click to see it added friction with zero upside in a
  // 3-card panel.
  const [expanded, setExpanded] = useState(true)
  const tone  = CATEGORY_TONE[item.category]
  const cat   = CATEGORY_LABEL[item.category]
  return (
    <li
      style={{
        background: 'rgba(255,255,255,0.02)',
        border:     '1px solid rgba(255,255,255,0.08)',
        borderRadius: '2px',
      }}
    >
      <div className="px-3 py-3 flex items-start gap-3">
        {/* Body · click to collapse/expand */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex-1 text-left"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span
              className="font-display font-bold text-base"
              style={{ color: 'var(--cream)' }}
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
                ≈ +{item.impact}pt
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

      {/* Expanded · how-to with Copy button (2026-05-17 paste-ready).
          Previously rendered as plain pre-wrapped text · users had to
          select-then-copy manually and got the explanation prose
          along with the code. CopyButton extracts the paste-ready
          portion (catalog howTo strings mix narration with concrete
          code snippets · the helper finds the code lines) and copies
          them so the next click in the user's editor / AI is a paste,
          not a re-type. Falls back to whole-text copy if no code-like
          lines are detected. */}
      {expanded && (
        <div className="mx-3 mb-3">
          <div className="flex justify-end mb-1.5">
            <CopyButton howTo={item.howTo} />
          </div>
          <div
            className="px-3 py-3 font-mono text-[12px] whitespace-pre-wrap"
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
        </div>
      )}
    </li>
  )
}

// Extract the paste-ready portion of a Coach howTo string. Catalog
// howTos look like "Add to your <head>:\n<meta property=...>\n\nUse a
// 1200×630 PNG that shows..." — the user only wants the meta tag, not
// the narration. Heuristic: pick lines that look like code (tags /
// JSON braces / config keys / shell commands) and return them joined.
// If the heuristic finds nothing structural, fall back to the entire
// string so the Copy button always does *something* useful.
function extractCodeBlock(raw: string): string {
  const lines = raw.split('\n')
  const codeLike = lines.filter(l => {
    const t = l.trim()
    if (!t) return false
    return /^[<{}\[\]]/.test(t)                              // tags · JSON · arrays
        || /^[A-Z][A-Za-z-]*-[A-Za-z-]+:/.test(t)            // HTTP headers (Content-Security-Policy: …)
        || /^(npm|npx|pnpm|yarn|bun|node|deno|git|curl|supabase)\s/.test(t)  // CLI commands
        || /^\s{2,}["'][^"']+["']\s*:/.test(t)               // nested JSON keys
        || /^\s*"[^"]+"\s*:/.test(t)                          // JSON keys at root
        || (t.includes('=') && t.length < 200 && /^[A-Z_][A-Z0-9_]*=/.test(t))  // env-var lines
  })
  // Need a meaningful block — single character or no hits = bail.
  if (codeLike.length === 0) return raw
  return codeLike.join('\n')
}

function CopyButton({ howTo }: { howTo: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    const payload = extractCodeBlock(howTo)
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard API can be blocked (insecure context, denied permission).
      // Fallback: select the howTo text via textarea hack.
      const ta = document.createElement('textarea')
      ta.value = payload
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { /* give up */ }
      document.body.removeChild(ta)
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] tracking-wide transition-all"
      style={{
        background:   copied ? 'rgba(0,212,170,0.14)' : 'rgba(248,245,238,0.04)',
        color:        copied ? '#00D4AA' : 'var(--cream)',
        border:       `1px solid ${copied ? 'rgba(0,212,170,0.45)' : 'rgba(248,245,238,0.18)'}`,
        borderRadius: '2px',
        cursor:       'pointer',
      }}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? (
          <path d="M5 12l4 4L19 6" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="1.5" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </>
        )}
      </svg>
      {copied ? 'Copied · paste into your AI / editor' : 'Copy paste-ready snippet'}
    </button>
  )
}
