// HeroUrlHook · §15-E URL Fast Lane web entry.
//
// Try-before-signup funnel: paste any URL → 30-second partial audit →
// result reveals → login CTA to claim/upgrade. Same try-then-signup
// pattern Wappalyzer / BuiltWith / gstack use. Backed by audit-site-preview
// Edge Function (anonymous-friendly · 3-tier rate limited).
//
// Constraints (CLAUDE.md §4):
//   · navy + gold tokens · no rgba hardcoded outside CSS vars
//   · Playfair Display for h2 · DM Mono for labels · 2px border-radius
//   · no emoji icons (uses inline SVG from icons.tsx where possible)
//   · no trailing period on headings
//   · reduced-motion safe
//
// State machine: idle → running → ready | error
//   running phase animates a 4-step probe trail (Lighthouse · Live URL ·
//   Routes · Meta) so the wait feels purposeful instead of dead.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { AuthModal } from './AuthModal'

interface SnapshotRich {
  // Canonical scout_brief shape · matches recentAudits.ts and the Edge
  // Function output (strengths / weaknesses, not strengths / concerns).
  scout_brief?: {
    strengths?:  Array<{ axis?: string | null; bullet?: string }>
    weaknesses?: Array<{ axis?: string | null; bullet?: string }>
  }
  routes_health?: { probed: number; reachable: number; broken: number; reachable_rate: number; broken_paths?: string[] }
}

interface SiteAuditResult {
  project_id: string
  project: { id: string; project_name: string; live_url: string; score_total: number; score_auto: number; status: string; creator_id: string | null }
  latest_snapshot: { id: string; created_at: string; score_total: number; score_auto: number; rich_analysis: SnapshotRich } | null
  status: 'running' | 'ready'
  cache_hit?: boolean
}

type Phase = 'idle' | 'running' | 'ready' | 'error'

// 3 quick probes (~5.5s) + the long-running engine reasoning step. Engine
// step uses an indeterminate progress bar capped at 95% so the wait feels
// purposeful — analyze-project's Claude call alone is 60-90s.
const STEP_LABELS = [
  'Lighthouse mobile',
  'Live URL probe',
  'Multi-route check',
  'Audit findings',
]
const ENGINE_STEP_INDEX = STEP_LABELS.length - 1     // 3 = "Audit findings"
const ENGINE_FILL_TARGET_MS = 70_000                  // primary fill 0 → 90% over 70s
const ENGINE_TAIL_FILL_MS   = 60_000                  // tail creep 90 → 99% over next 60s · keeps motion alive
// Rotating reassurance copy · cycled every CYCLE_MS so the user sees the
// engine "working through stages" instead of one frozen line. Each phase
// loosely matches what analyze-project / Claude is actually doing.
const ENGINE_REASSURE_LINES = [
  'Cross-checking 14 vibe-coding failure frames…',
  'Comparing against the reference set (supabase · cal.com · vercel)…',
  'Tampering detection pass · brief vs code · pasted vs committed…',
  'Routing the strengths-vs-concerns ledger…',
  'Engine is still thinking · this is the heaviest call of the audit…',
  'Last stretch · final score is being reasoned out…',
]
const REASSURE_CYCLE_MS = 14_000

export function HeroUrlHook() {
  const [url,    setUrl]    = useState('')
  const [phase,  setPhase]  = useState<Phase>('idle')
  const [error,  setError]  = useState<string | null>(null)
  const [result, setResult] = useState<SiteAuditResult | null>(null)
  const [step,   setStep]   = useState(0)
  const [enginePct, setEnginePct] = useState(0)        // 0-99% during engine step · 100% when snapshot lands
  const [engineElapsedSec, setEngineElapsedSec] = useState(0)
  const [reassureIdx, setReassureIdx] = useState(0)
  const [authOpen, setAuthOpen] = useState(false)
  const pollTimer = useRef<number | null>(null)
  const stepTimer = useRef<number | null>(null)
  const engineTimer = useRef<number | null>(null)
  const reassureTimer = useRef<number | null>(null)
  const engineStartMs = useRef<number>(0)
  const navigate = useNavigate()

  // Cleanup on unmount
  useEffect(() => () => {
    if (pollTimer.current)     window.clearTimeout(pollTimer.current)
    if (stepTimer.current)     window.clearInterval(stepTimer.current)
    if (engineTimer.current)   window.clearInterval(engineTimer.current)
    if (reassureTimer.current) window.clearInterval(reassureTimer.current)
  }, [])

  // Two-phase progress · always-moving so it never looks frozen:
  //   Phase 1 (0-70s): easeOutCubic 0% → 90% (fast start · taper)
  //   Phase 2 (70s+):  linear creep 90% → 99% over ENGINE_TAIL_FILL_MS
  // Plus elapsed-seconds counter + rotating reassurance subtitle every 14s.
  // Even if the snapshot takes 2+ minutes (Claude slow path), the bar
  // continues moving the whole time and the copy rotates so user sees life.
  function startEngineProgress() {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEnginePct(95)
      return
    }
    engineStartMs.current = performance.now()
    setReassureIdx(0)
    setEngineElapsedSec(0)
    if (engineTimer.current)   window.clearInterval(engineTimer.current)
    if (reassureTimer.current) window.clearInterval(reassureTimer.current)

    engineTimer.current = window.setInterval(() => {
      const elapsed = performance.now() - engineStartMs.current
      setEngineElapsedSec(Math.floor(elapsed / 1000))
      let pct: number
      if (elapsed <= ENGINE_FILL_TARGET_MS) {
        const t = elapsed / ENGINE_FILL_TARGET_MS
        pct = (1 - Math.pow(1 - t, 3)) * 90      // easeOutCubic to 90%
      } else {
        const tailT = Math.min(1, (elapsed - ENGINE_FILL_TARGET_MS) / ENGINE_TAIL_FILL_MS)
        pct = 90 + tailT * 9                       // linear creep 90 → 99
      }
      setEnginePct(Math.min(99, pct))
    }, 200)

    reassureTimer.current = window.setInterval(() => {
      // Cycle through reassurance lines · later cycles freeze on the last
      // line ("last stretch") so we don't loop back to "starting up" copy.
      setReassureIdx(i => Math.min(ENGINE_REASSURE_LINES.length - 1, i + 1))
    }, REASSURE_CYCLE_MS)
  }
  function stopEngineProgress(finalPct: number) {
    if (engineTimer.current)   { window.clearInterval(engineTimer.current);   engineTimer.current = null }
    if (reassureTimer.current) { window.clearInterval(reassureTimer.current); reassureTimer.current = null }
    setEnginePct(finalPct)
  }

  function normalizeInput(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    // Add https:// if user typed bare host
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
      const u = new URL(withProtocol)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      if (!u.host.includes('.')) return null
      return withProtocol
    } catch { return null }
  }

  async function startAudit(e?: React.FormEvent, opts: { force?: boolean } = {}) {
    e?.preventDefault()
    const normalized = normalizeInput(url)
    if (!normalized) {
      setError('Looks off. Try something like https://yoursite.com')
      return
    }
    setError(null)
    setResult(null)
    setPhase('running')
    setStep(0)
    setEnginePct(0)

    // 3 quick probes (~1.8s each = 5.4s total) → settle on engine step ·
    // engine step shows the long indeterminate bar while we poll for the
    // analyze-project snapshot (~60-90s total).
    if (typeof window !== 'undefined' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let s = 0
      stepTimer.current = window.setInterval(() => {
        s += 1
        setStep(Math.min(s, ENGINE_STEP_INDEX))
        if (s >= ENGINE_STEP_INDEX) {
          if (stepTimer.current) { window.clearInterval(stepTimer.current); stepTimer.current = null }
          startEngineProgress()
        }
      }, 1800)
    } else {
      setStep(ENGINE_STEP_INDEX)
      startEngineProgress()
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('audit-site-preview', {
        body: { site_url: normalized, source: 'hero-hook', force: opts.force === true },
      })

      if (invokeError) {
        setPhase('error')
        setError(extractErrorMessage(invokeError) ?? 'Audit failed. Try again in a moment.')
        return
      }
      if (!data || typeof data !== 'object') {
        setPhase('error')
        setError('Unexpected response from audit engine.')
        return
      }
      // Rate-limit / DNS opt-out / invalid URL surface as { error: '...' }
      if ((data as { error?: string }).error) {
        setPhase('error')
        setError((data as { message?: string; error: string }).message ?? (data as { error: string }).error)
        return
      }

      const envelope = data as SiteAuditResult
      // Cache hit returns 'ready' immediately with the latest_snapshot
      if (envelope.status === 'ready' && envelope.latest_snapshot) {
        finishWithResult(envelope)
        return
      }
      // Else poll
      pollForSnapshot(envelope.project_id)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Audit failed.')
    }
  }

  function pollForSnapshot(projectId: string, attempt = 0) {
    const maxAttempts = 36 // 36 × 5s = 180s · analyze-project wall is ~150s
    const tick = async () => {
      try {
        const { data: snap } = await supabase
          .from('analysis_snapshots')
          .select('id, created_at, score_total, score_auto, score_total_delta, rich_analysis')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (snap) {
          const { data: proj } = await supabase
            .from('projects')
            .select('id, project_name, live_url, score_total, score_auto, status, creator_id')
            .eq('id', projectId)
            .single()
          if (proj) {
            finishWithResult({
              project_id: projectId,
              project: proj,
              latest_snapshot: snap as SiteAuditResult['latest_snapshot'],
              status: 'ready',
            })
            return
          }
        }

        if (attempt + 1 >= maxAttempts) {
          setPhase('error')
          setError('Audit took longer than expected. Refresh in a minute.')
          return
        }
        pollTimer.current = window.setTimeout(() => pollForSnapshot(projectId, attempt + 1), 5000)
      } catch {
        if (attempt + 1 >= maxAttempts) {
          setPhase('error')
          setError('Audit polling failed.')
          return
        }
        pollTimer.current = window.setTimeout(() => pollForSnapshot(projectId, attempt + 1), 5000)
      }
    }
    // First poll fires after 6s · gives analyze-project the head start
    pollTimer.current = window.setTimeout(tick, 6000)
  }

  function finishWithResult(envelope: SiteAuditResult) {
    if (stepTimer.current) { window.clearInterval(stepTimer.current); stepTimer.current = null }
    stopEngineProgress(100)
    setStep(STEP_LABELS.length)
    setResult(envelope)
    setPhase('ready')
  }

  function reset() {
    if (pollTimer.current)     { window.clearTimeout(pollTimer.current);    pollTimer.current = null }
    if (stepTimer.current)     { window.clearInterval(stepTimer.current);   stepTimer.current = null }
    if (engineTimer.current)   { window.clearInterval(engineTimer.current); engineTimer.current = null }
    if (reassureTimer.current) { window.clearInterval(reassureTimer.current); reassureTimer.current = null }
    setPhase('idle')
    setError(null)
    setResult(null)
    setStep(0)
    setEnginePct(0)
    setEngineElapsedSec(0)
    setReassureIdx(0)
  }

  return (
    <section
      className="relative z-10 py-20 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40"
      style={{
        borderTop: '1px solid rgba(240,192,64,0.08)',
        background: 'rgba(15,32,64,0.35)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // FAST LANE · NO REPO REQUIRED
        </div>
        <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-3 leading-tight" style={{ color: 'var(--cream)' }}>
          Paste a URL<br />See what's broken
        </h2>
        <p className="font-light max-w-2xl mb-8" style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.55 }}>
          Drop your URL — we'll surface what's wrong with your project in under a minute.
          Like what you see? Audition the project for a sharper audit and a spot on the
          public ladder.
        </p>

        {phase === 'idle' && (
          <form onSubmit={startAudit} className="flex flex-col sm:flex-row gap-3 max-w-2xl">
            <input
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              value={url}
              onChange={e => { setUrl(e.target.value); if (error) setError(null) }}
              placeholder="https://yoursite.com"
              className="flex-1 px-4 py-3.5 font-mono text-sm"
              style={{
                background: 'rgba(6,12,26,0.7)',
                border: '1px solid rgba(248,245,238,0.15)',
                borderRadius: '2px',
                color: 'var(--cream)',
                outline: 'none',
                fontSize: '16px',  // §feedback_mobile_no_zoom — block iOS auto-zoom
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.15)')}
            />
            <button
              type="submit"
              className="px-6 py-3.5 text-sm font-medium tracking-wide transition-all"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
            >
              Audit it →
            </button>
          </form>
        )}

        {phase === 'idle' && error && (
          <p className="mt-3 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{error}</p>
        )}

        {phase === 'idle' && (
          <p className="mt-4 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            Free · up to 5 audits per day from one IP. URL-only audits hit a natural ceiling
            because the engine can't see your tests, CI, or repo signals. Audition with your
            repo to push past it.
          </p>
        )}

        {phase === 'running' && (
          <div className="max-w-2xl">
            <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
              AUDITING {prettyHost(url)}
            </div>
            <ul className="space-y-2.5 mb-4">
              {STEP_LABELS.map((label, i) => {
                const state = i < step ? 'done' : i === step ? 'active' : 'pending'
                const isEngineActive = i === ENGINE_STEP_INDEX && state === 'active'
                return (
                  <li key={label}>
                    <div className="flex items-center gap-3 font-mono text-sm" style={{
                      color: state === 'done'    ? 'var(--cream)'
                           : state === 'active'  ? 'var(--gold-500)'
                           :                       'var(--text-muted)',
                    }}>
                      <span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>
                        {state === 'done' ? '✓' : state === 'active' ? <span className="pulse-dot" style={{ width: 6, height: 6, display: 'inline-block', background: 'var(--gold-500)', borderRadius: '50%' }} /> : '·'}
                      </span>
                      {label}
                      {isEngineActive && (
                        <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {engineElapsedSec}s
                        </span>
                      )}
                    </div>
                    {/* Engine step · two-phase progress (0-70s easeOut to 90%
                        · 70s+ linear creep to 99%) + shimmer overlay so the
                        bar reads as alive even on the slow Claude path. */}
                    {isEngineActive && (
                      <div className="ml-7 mt-2 relative" style={{
                        height: 3,
                        background: 'rgba(248,245,238,0.08)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${enginePct}%`,
                          background: 'var(--gold-500)',
                          transition: 'width 0.4s linear',
                          position: 'relative',
                        }}>
                          {/* Shimmer · ~1.6s sweep · pure CSS keyframe */}
                          <span className="hero-engine-shimmer" />
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="font-mono text-xs" style={{ color: 'var(--text-muted)', minHeight: '1.2em' }}>
              {step >= ENGINE_STEP_INDEX
                ? ENGINE_REASSURE_LINES[reassureIdx]
                : '~30 seconds for the surface probes · then the engine takes over'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="max-w-2xl">
            <p className="font-mono text-sm mb-4" style={{ color: 'var(--scarlet)' }}>{error}</p>
            <button
              onClick={reset}
              className="px-5 py-2.5 font-mono text-xs tracking-widest"
              style={{
                background: 'transparent',
                color: 'var(--cream)',
                border: '1px solid rgba(248,245,238,0.2)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              Try again →
            </button>
          </div>
        )}

        {phase === 'ready' && result && (
          <ResultCard
            result={result}
            onClaim={async () => {
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                navigate(`/projects/${result.project_id}`)
              } else {
                setAuthOpen(true)
              }
            }}
            onTryAnother={reset}
            onRerun={() => startAudit(undefined, { force: true })}
          />
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode="signup" />
    </section>
  )
}

function prettyHost(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.host.replace(/^www\./, '').toUpperCase()
  } catch {
    return raw.toUpperCase()
  }
}

function extractErrorMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return null
}

interface ResultCardProps {
  result:       SiteAuditResult
  onClaim:      () => void
  onTryAnother: () => void
  onRerun:      () => void
}

function ResultCard({ result, onClaim, onTryAnother, onRerun }: ResultCardProps) {
  const snap = result.latest_snapshot
  const rich  = snap?.rich_analysis ?? {}
  // Canonical bullet path · scout_brief.strengths / .weaknesses.
  const strengths = (rich.scout_brief?.strengths ?? []).slice(0, 3)
  // Belt-and-suspenders filter · the prompt now forbids repo-absence
  // weaknesses for URL fast lane, but if Claude slips one in we drop it
  // client-side too. Reframe is "what we couldn't see is an upsell, not
  // a fault" — keep concerns focused on URL-observable issues only.
  const REPO_ABSENCE_PATTERNS = /\b(no source code|0 commits?|0 contributors?|0 files?|no tests|no CI|no observability|no lockfile|no LICENSE|TypeScript strict mode|no Brief|production maturity points|repo signals|repo not visible|GitHub repo (not |in)accessible|no governance|monorepo)\b/i
  const concernsRaw = (rich.scout_brief?.weaknesses ?? []) as Array<{ axis?: string | null; bullet?: string }>
  const concerns    = concernsRaw.filter(c => !c.bullet || !REPO_ABSENCE_PATTERNS.test(c.bullet)).slice(0, 2)
  const routes      = rich.routes_health

  // URL Polish Score · §15-E.3 separate scale.
  // The full /50 audit pillar can't be the denominator for URL-only audits
  // because most slots (tests · CI · LICENSE · Brief · Tech · Maturity) are
  // STRUCTURALLY UNATTAINABLE without a repo. Reporting "anthropic.com 26 / 100"
  // sounds awful when it actually means "URL signals are strong, repo signals
  // unseen". Calibrate against bot-fight-realistic achievable signals:
  //   · Lighthouse 20  — always fillable (PageSpeed = Google's infra)
  //   · Completeness 2 — meta tags · recovered via Tier B even when bot-walled
  //   · Responsive 2   — derived from LH perf
  //   · (Live URL Health 5 often 0 due to bot fight — excluded so well-polished
  //      SaaS aren't penalized for having bot protection)
  // Total: 24. Sites with reachable homepage probe naturally hit the >100
  // ceiling and clamp · this is intentional · we don't dock for over-delivery.
  const URL_LANE_MAX = 24
  const autoPts = snap?.score_auto ?? result.project.score_auto ?? 0
  const polishScore = Math.max(0, Math.min(100, Math.round((autoPts / URL_LANE_MAX) * 100)))

  const band =
    polishScore >= 90 ? 'Top-tier polish' :
    polishScore >= 75 ? 'Strong'          :
    polishScore >= 60 ? 'Solid'           :
    polishScore >= 45 ? 'Mid'             :
    polishScore >= 30 ? 'Below par'       :
                        'Needs work'

  return (
    <div
      className="max-w-3xl"
      style={{
        background: 'rgba(6,12,26,0.55)',
        border: '1px solid rgba(240,192,64,0.18)',
        borderRadius: '2px',
        padding: '28px 24px',
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-6">
        <div>
          <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
            URL AUDIT · partial · repo signals not seen
          </div>
          <div className="font-display font-black text-2xl sm:text-3xl truncate" style={{ color: 'var(--cream)' }}>
            {result.project.project_name}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--text-muted)' }}>POLISH</div>
          <div className="font-display font-black" style={{ color: 'var(--gold-500)', fontSize: '2.5rem', lineHeight: 1 }}>
            {polishScore}<span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}> / 100</span>
          </div>
          <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{band}</div>
          <div className="font-mono text-[10px] tracking-widest mt-1" style={{ color: 'var(--text-muted)' }}>
            URL signals only
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-6">
        <div>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>+ STRENGTHS</div>
          {strengths.length > 0 ? (
            <ul className="space-y-1.5">
              {strengths.map((s, i) => (
                <li key={i} className="text-sm" style={{ color: 'var(--cream)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--gold-500)' }}>↑ </span>{s.bullet ?? '—'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>No clear strengths surfaced.</p>
          )}
        </div>
        <div>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--scarlet)' }}>− TO IMPROVE</div>
          {concerns.length > 0 ? (
            <ul className="space-y-1.5">
              {concerns.map((c, i) => (
                <li key={i} className="text-sm" style={{ color: 'var(--cream)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--scarlet)' }}>↓ </span>{c.bullet ?? '—'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              No URL-side issues surfaced at this depth.
            </p>
          )}
        </div>
      </div>

      {/* UNLOCK WITH REPO · positive-framing upsell · replaces the old
          negative pattern of listing repo-absence as concerns (§15-E). */}
      <div
        className="mb-6 px-4 py-3"
        style={{
          background: 'rgba(240,192,64,0.05)',
          border: '1px dashed rgba(240,192,64,0.25)',
          borderRadius: '2px',
        }}
      >
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          ↑ UNLOCK WITH REPO
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Linking a public repo unlocks <span style={{ color: 'var(--cream)' }}>tests · CI · LICENSE</span> ·{' '}
          <span style={{ color: 'var(--cream)' }}>secret-leak detection</span> ·{' '}
          <span style={{ color: 'var(--cream)' }}>Brief integrity</span> ·{' '}
          <span style={{ color: 'var(--cream)' }}>tech-stack diversity</span> ·{' '}
          <span style={{ color: 'var(--cream)' }}>source hygiene</span> · the full
          50-point audit + ladder ranking + Encore eligibility at score ≥ 85.
        </p>
      </div>

      {routes && routes.probed > 0 && (
        <div className="mb-6 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          ROUTES PROBED · {routes.reachable}/{routes.probed} reachable
          {routes.broken > 0 && routes.broken_paths && routes.broken_paths.length > 0 && (
            <span> · broken: <span style={{ color: 'var(--scarlet)' }}>{routes.broken_paths.slice(0, 3).join(' · ')}</span></span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={onClaim}
          className="px-5 py-3 text-sm font-medium tracking-wide transition-all"
          style={{
            background: 'var(--gold-500)',
            color: 'var(--navy-900)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontFamily: 'DM Mono, monospace',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
        >
          Claim this audit · upgrade to full →
        </button>
        <button
          onClick={onRerun}
          className="px-5 py-3 text-sm font-mono"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
          title="Force a fresh audit · skips the 7-day cache · counts against your daily IP cap"
        >
          Re-run audit
        </button>
        <button
          onClick={onTryAnother}
          className="px-5 py-3 text-sm font-mono"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          Try another URL
        </button>
      </div>
      <p className="mt-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        Walk-on result · creator unclaimed · not on the public ladder. Polish Score
        is the URL-lane scale — it weighs Lighthouse + meta + routing only and
        ignores repo signals (tests · CI · LICENSE · Brief · Tech) the engine can't
        see without a repo. Sign in to claim, share, or upgrade with a repo for
        the full audit on the public ladder.
      </p>
    </div>
  )
}
