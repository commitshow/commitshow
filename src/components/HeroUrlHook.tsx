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
import { openTweetIntent } from '../lib/shareTweet'
import { urlLanePolish } from '../lib/laneScore'

// Per-signal echo · what the engine actually probed. Surfaced verbatim
// in the result card so the wait reads as "we measured X, Y, Z" rather
// than a single black-box number. Mirrors what analyze-project writes to
// analysis_snapshots.rich_analysis (see backend `rich_analysis: { ... }`).
interface LighthouseSlot {
  performance?:   number | null     // 0-100 · -1 (LH_NOT_ASSESSED) when unassessed
  accessibility?: number | null
  bestPractices?: number | null
  seo?:           number | null
  total_byte_weight_kb?: number | null
  dom_size?:             number | null
  console_errors_count?: number | null
  network_failures_count?: number | null
}
interface RoutesHealth {
  probed:           number
  reachable:        number
  broken:           number
  reachable_rate:   number
  broken_paths?:    string[]
  sitemap_present?: boolean
  sitemap_url_count?: number
  items?: Array<{ path?: string; status?: number; elapsed_ms?: number }>
}
interface CompletenessSignals {
  has_og_image?: boolean
  has_og_title?: boolean
  has_og_description?: boolean
  has_twitter_card?: boolean
  has_apple_touch?: boolean
  has_manifest?: boolean
  has_theme_color?: boolean
  has_favicon?: boolean
  has_canonical?: boolean
  has_meta_desc?: boolean
  filled?: number
  of?:     number
}
interface SecurityHeaders {
  has_csp?: boolean
  has_hsts?: boolean
  has_frame_protection?: boolean
  has_content_type_opt?: boolean
  has_referrer_policy?: boolean
  has_permissions_policy?: boolean
  filled?: number
  of?:     number
}
interface DeepProbeSummary {
  fetched?:             boolean
  via?:                 string
  proven_reachable?:    boolean
  hydration_framework?: string | null
  html_length?:                number
  post_hydration_text_length?: number
  screenshot_url?:      string | null
  meta_tags?: {
    has_og_title?:    boolean
    has_og_image?:    boolean
    has_canonical?:   boolean
    has_meta_desc?:   boolean
    has_h1?:          boolean
  }
}
interface LiveUrlHealth {
  status?:     number
  ok?:         boolean
  elapsed_ms?: number
}

// Per-probe accountability · §15-E 2026-05-15. The engine writes a
// structured "what we tried · what worked · what failed · why" block
// into rich_analysis.audit_transparency. Surfaced verbatim in the
// result card so the score is grounded in specific evidence rather
// than a black-box number — especially load-bearing for bot-walled
// sites where Live URL / multi-route get refused but Lighthouse +
// Chromium pass. See analyze-project buildAuditTransparency().
interface AuditTransparency {
  lane:               'url_fast_lane' | 'platform' | 'walk_on'
  bot_walled:         boolean
  bot_walled_reason?: string
  probes: Array<{
    id:              string
    label:           string
    status:          'measured' | 'blocked' | 'recovered_via' | 'unavailable' | 'inferred'
    detail:          string
    source?:         string
    blocked_by?:     string
    contributes_to?: string[]
  }>
  score_slot_basis: Array<{
    slot:     string
    points:   number
    of:       number
    evidence: string
    measured: boolean
  }>
}

interface SnapshotRich {
  // Canonical scout_brief shape · matches recentAudits.ts and the Edge
  // Function output (strengths / weaknesses, not strengths / concerns).
  scout_brief?: {
    strengths?:  Array<{ axis?: string | null; bullet?: string }>
    weaknesses?: Array<{ axis?: string | null; bullet?: string }>
  }
  // Per-probe echo · 2026-05-15. Engine writes both mobile + desktop LH,
  // live URL stopwatch, completeness checklist, security headers, deep
  // probe summary into rich_analysis so the result card can show the work.
  lighthouse_mobile?:    LighthouseSlot
  lighthouse_desktop?:   LighthouseSlot
  live_url_health?:      LiveUrlHealth
  routes_health?:        RoutesHealth & { detected_only?: string[] }
  completeness_signals?: CompletenessSignals
  security_headers?:     SecurityHeaders
  deep_probe?:           DeepProbeSummary
  audit_transparency?:   AuditTransparency
}

interface SiteAuditResult {
  project_id: string
  project: { id: string; slug?: string | null; project_name: string; live_url: string; score_total: number; score_auto: number; status: string; creator_id: string | null }
  // `lighthouse` is the snapshot's top-level mobile LH column · we also
  // pull `lighthouse_desktop` from rich_analysis so the result card can
  // render both form factors side-by-side. score_total_delta surfaces the
  // self-delta chip when this isn't the first snapshot for the project.
  latest_snapshot: { id: string; created_at: string; score_total: number; score_auto: number; score_total_delta?: number | null; lighthouse?: LighthouseSlot | null; rich_analysis: SnapshotRich } | null
  status: 'running' | 'ready'
  cache_hit?: boolean
}

type Phase = 'idle' | 'running' | 'ready' | 'error'

// Surface probes are scripted to feel sequential, but the Edge Function
// actually runs them in parallel (Promise.all · analyze-project line ~4335).
// The animated cadence buys ~9s of "we're really measuring" perception
// before the Claude reasoning step takes over the wait (60-120s). Each
// label carries a sublabel describing the actual probe — the wait should
// read as professional depth, not opaque spinner. Stages map to the
// engine's real evidence sources (see analyze-project rich_analysis).
const STEP_LABELS: Array<{ label: string; sub: string }> = [
  { label: 'Lighthouse · mobile',      sub: 'Moto G4 · Slow 4G · Perf · A11y · BP · SEO' },
  { label: 'Lighthouse · desktop',     sub: '1366×768 · same 4 categories · throttling off' },
  { label: 'Live URL health',          sub: 'TLS handshake · TTFB · 200 OK · redirect chain' },
  { label: 'Multi-route reachability', sub: 'sitemap.xml + 6 internal paths · 2xx / 4xx / 5xx ratio' },
  { label: 'Meta + completeness',      sub: 'og:image · twitter:card · manifest · canonical · favicon · 6 more' },
  { label: 'Deep probe (post-hydration)', sub: 'Chromium render · console errors · network failures · screenshot' },
  { label: 'Audit reasoning',          sub: 'cross-checking 14 vibe-coding failure frames · 5+3 ledger' },
]
const ENGINE_STEP_INDEX = STEP_LABELS.length - 1     // last = "Audit reasoning"
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
  // Server-side rate-limit details · drives the countdown + sign-in CTA
  // when the global 2,000/day cap is hit. `null` for any non-rate-limit
  // error so the plain text path still works for bad URLs etc.
  const [rateLimit, setRateLimit] = useState<{ reason: string; reset_at: string | null } | null>(null)
  const [result, setResult] = useState<SiteAuditResult | null>(null)
  const [step,   setStep]   = useState(0)
  const [enginePct, setEnginePct] = useState(0)        // 0-99% during engine step · 100% when snapshot lands
  const [engineElapsedSec, setEngineElapsedSec] = useState(0)
  const [reassureIdx, setReassureIdx] = useState(0)
  const [authOpen, setAuthOpen] = useState(false)
  // Track sign-in state so the cap-hit notice can show the "Sign in to
  // raise your daily ceiling" CTA only to anonymous viewers (signed-in
  // members get 50/IP/day and have ticket-gated /submit as a separate
  // channel, so the CTA is noise for them).
  const [isAnon, setIsAnon] = useState(true)
  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return
      setIsAnon(!data.user)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAnon(!session?.user)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])
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

  // Cold-load auto-scroll · when the page loads with #url-hook in the URL
  // (e.g., from /submit's "Just paste a URL" card), scroll the section into
  // view + focus the input so the user lands ready to type.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#url-hook') return
    const t = window.setTimeout(() => {
      const el = document.getElementById('url-hook')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Try to focus the URL input (idle phase only).
      const input = document.querySelector('#url-hook input[type="text"]') as HTMLInputElement | null
      input?.focus()
    }, 80)
    return () => window.clearTimeout(t)
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
    setRateLimit(null)
    setResult(null)
    setPhase('running')
    setStep(0)
    setEnginePct(0)

    // 6 quick probes (~1.5s each = 9s total) → settle on engine step ·
    // engine step shows the long indeterminate bar while we poll for the
    // analyze-project snapshot (~60-120s total). Cadence is theatrical —
    // probes really run in parallel — but the sequential reveal gives the
    // wait a "we're measuring N things" rhythm.
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
      }, 1500)
    } else {
      setStep(ENGINE_STEP_INDEX)
      startEngineProgress()
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('audit-site-preview', {
        body: { site_url: normalized, source: 'hero-hook', force: opts.force === true },
      })

      if (invokeError) {
        // supabase-js wraps non-2xx as `invokeError` and swallows the body.
        // Pull the friendly `message` field out of the Response when present
        // (rate-limit / DNS opt-out / invalid URL all return JSON bodies with
        // a human-readable `message`). Falls through to the generic string
        // only if the body isn't parseable JSON.
        const friendly = await extractFriendlyError(invokeError)
        setPhase('error')
        setError(friendly?.message ?? 'Audit failed. Try again in a moment.')
        setRateLimit(
          friendly?.reason === 'global_cap' || friendly?.reason === 'ip_cap' || friendly?.reason === 'url_cap'
            ? { reason: friendly.reason, reset_at: friendly.reset_at ?? null }
            : null,
        )
        return
      }
      if (!data || typeof data !== 'object') {
        setPhase('error')
        setError('Unexpected response from audit engine.')
        return
      }
      // Rate-limit / DNS opt-out / invalid URL surface as { error: '...' }
      // — same envelope as the FunctionsHttpError path above. audit-site-
      // preview returns 200 + envelope in some lanes (cache hit on a
      // recently-rate-limited project) so we still need to handle it here.
      if ((data as { error?: string }).error) {
        const body = data as { message?: string; error: string; reason?: string; quota?: { reset_at?: string | null } }
        setPhase('error')
        setError(body.message ?? body.error)
        setRateLimit(
          body.reason === 'global_cap' || body.reason === 'ip_cap' || body.reason === 'url_cap'
            ? { reason: body.reason, reset_at: body.quota?.reset_at ?? null }
            : null,
        )
        return
      }

      const envelope = data as SiteAuditResult
      // Cache hit returns 'ready' immediately with the latest_snapshot
      if (envelope.status === 'ready' && envelope.latest_snapshot) {
        finishWithResult(envelope)
        return
      }
      // Capture the latest pre-rerun snapshot id so polling only accepts
      // a NEWER one. Without this, force=true reruns immediately resolve
      // to the cached snapshot at the first 6s poll (analyze-project
      // hasn't finished writing the new row yet) — same number redisplayed.
      let baselineId: string | null = null
      if (opts.force === true) {
        const { data: prev } = await supabase
          .from('analysis_snapshots')
          .select('id')
          .eq('project_id', envelope.project_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        baselineId = prev?.id ?? null
      }
      pollForSnapshot(envelope.project_id, 0, baselineId)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Audit failed.')
    }
  }

  function pollForSnapshot(projectId: string, attempt = 0, baselineId: string | null = null) {
    const maxAttempts = 36 // 36 × 5s = 180s · analyze-project wall is ~150s
    const tick = async () => {
      try {
        const { data: snap } = await supabase
          .from('analysis_snapshots')
          .select('id, created_at, score_total, score_auto, score_total_delta, lighthouse, rich_analysis')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // baselineId set on force-rerun · ignore the stale snapshot until a
        // truly new row appears.
        const snapIsNew = !!snap && (!baselineId || snap.id !== baselineId)

        if (snap && snapIsNew) {
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
        pollTimer.current = window.setTimeout(() => pollForSnapshot(projectId, attempt + 1, baselineId), 5000)
      } catch {
        if (attempt + 1 >= maxAttempts) {
          setPhase('error')
          setError('Audit polling failed.')
          return
        }
        pollTimer.current = window.setTimeout(() => pollForSnapshot(projectId, attempt + 1, baselineId), 5000)
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
    setRateLimit(null)
    setResult(null)
    setStep(0)
    setEnginePct(0)
    setEngineElapsedSec(0)
    setReassureIdx(0)
  }

  return (
    <section
      id="url-hook"
      className="relative z-10 py-20 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40 scroll-mt-20"
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
            <div className="font-mono text-xs tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
              AUDITING {prettyHost(url)}
            </div>
            <div className="font-mono text-[10px] tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
              {STEP_LABELS.length} STAGES · SURFACE PROBES THEN ENGINE REASONING
            </div>
            <ul className="space-y-2 mb-4">
              {STEP_LABELS.map(({ label, sub }, i) => {
                const state = i < step ? 'done' : i === step ? 'active' : 'pending'
                const isEngineActive = i === ENGINE_STEP_INDEX && state === 'active'
                return (
                  <li key={label}>
                    <div className="flex items-baseline gap-3 font-mono text-sm" style={{
                      color: state === 'done'    ? 'var(--cream)'
                           : state === 'active'  ? 'var(--gold-500)'
                           :                       'var(--text-muted)',
                    }}>
                      <span style={{ width: 14, display: 'inline-block', textAlign: 'center', flexShrink: 0 }}>
                        {state === 'done' ? '✓' : state === 'active' ? <span className="pulse-dot" style={{ width: 6, height: 6, display: 'inline-block', background: 'var(--gold-500)', borderRadius: '50%' }} /> : '·'}
                      </span>
                      <span style={{ flexShrink: 0 }}>{label}</span>
                      {isEngineActive && (
                        <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {engineElapsedSec}s
                        </span>
                      )}
                    </div>
                    {/* Sublabel · always visible · describes what the probe
                        actually measures. Dimmer for pending/done so the
                        active row remains the focal point. */}
                    <div
                      className="ml-7 font-mono text-[10px] tracking-wide"
                      style={{
                        color: state === 'active' ? 'var(--text-secondary)' : 'var(--text-faint)',
                        opacity: state === 'pending' ? 0.5 : 1,
                        lineHeight: 1.5,
                      }}
                    >
                      {sub}
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
                : `~9 seconds for the ${ENGINE_STEP_INDEX} surface probes · then the engine reasons`}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="max-w-2xl">
            {rateLimit ? (
              <RateLimitNotice
                reason={rateLimit.reason}
                resetAt={rateLimit.reset_at}
                message={error}
                isAnon={isAnon}
                onTryAgain={reset}
                onSignIn={() => setAuthOpen(true)}
              />
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {phase === 'ready' && result && (
          <ResultCard
            result={result}
            onAudition={async () => {
              // §15-E policy A · URL audit ≠ owned audit · we never claim.
              // CTA funnels users into the FULL lane with their own repo
              // instead. Signed-in users go straight to /submit; anonymous
              // users see the auth modal first, then the auth modal's own
              // post-signup redirect lands them somewhere useful.
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                navigate('/submit')
              } else {
                setAuthOpen(true)
              }
            }}
            onTryAnother={reset}
            onRerun={() => startAudit(undefined, { force: true })}
          />
        )}
      </div>

      <AuthModal
        open={authOpen}
        onClose={async () => {
          setAuthOpen(false)
          // If signup just completed (Supabase session live), funnel
          // straight into /submit so the user lands on the FULL lane
          // entry · removes the "I signed up, now what?" gap.
          const { data: { user } } = await supabase.auth.getUser()
          if (user) navigate('/submit')
        }}
        initialMode="signup"
      />
    </section>
  )
}

// Cap-hit notice · keeps the server's "sold out, not broken" tone but
// translates the absolute reset time (`UTC midnight`) into a relative
// countdown, and surfaces a sign-in CTA for anonymous viewers (signed-in
// members get a 10×-larger IP ceiling + can audit their own repo via
// /submit as a separate channel).
//
// global_cap → platform-wide ceiling · sign-in helps but doesn't bypass
//              the global counter. Frame it as "your own repo is a
//              different channel · go that way."
// ip_cap     → per-IP ceiling · anon hits 5/day fast. Sign-in raises to
//              50/day. CTA is direct.
// url_cap    → per-host ceiling · someone in front of you audited this
//              same site 5× already today. Cache still works.
function RateLimitNotice({
  reason,
  resetAt,
  message,
  isAnon,
  onTryAgain,
  onSignIn,
}: {
  reason:     string
  resetAt:    string | null
  message:    string | null
  isAnon:     boolean
  onTryAgain: () => void
  onSignIn:   () => void
}) {
  const countdown = useCountdown(resetAt)
  const showSignIn = isAnon && (reason === 'ip_cap' || reason === 'global_cap')
  const headline =
    reason === 'global_cap' ? 'Stage is sold out for today'
  : reason === 'ip_cap'     ? 'You\'ve hit your daily ceiling'
  : reason === 'url_cap'    ? 'This site has been audited the max times today'
  :                            'Rate limit reached'
  const secondary =
    reason === 'global_cap'
      ? 'Cached reports still load instantly. Fresh audits resume after the daily reset.'
      : reason === 'ip_cap'
        ? (isAnon
            ? 'Anonymous viewers get a small daily allowance. Signing in lifts the cap 10×.'
            : 'Cached reports still load. Fresh audits reset on the daily counter.')
        : reason === 'url_cap'
          ? 'Cached results stay valid for 7 days · just paste the same URL to load instantly.'
          : (message ?? 'Try again after the daily reset.')

  return (
    <div
      className="p-5"
      style={{
        background:   'rgba(240,192,64,0.06)',
        border:       '1px solid rgba(240,192,64,0.25)',
        borderRadius: '2px',
      }}
    >
      <div
        className="font-mono text-[11px] tracking-widest uppercase mb-2"
        style={{ color: 'var(--gold-500)' }}
      >
        // CAPACITY
      </div>
      <h3
        className="font-display font-bold mb-2"
        style={{ color: 'var(--cream)', fontSize: '1.35rem', lineHeight: 1.3 }}
      >
        {headline}
      </h3>
      <p
        className="font-light text-sm mb-4"
        style={{ color: 'rgba(248,245,238,0.7)', lineHeight: 1.5 }}
      >
        {secondary}
      </p>
      {countdown && (
        <p
          className="font-mono text-xs mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          Resets in <span style={{ color: 'var(--gold-500)' }}>{countdown}</span>
        </p>
      )}
      <div className="flex gap-3 flex-wrap">
        {showSignIn && (
          <button
            onClick={onSignIn}
            className="px-5 py-2.5 font-mono text-xs tracking-widest"
            style={{
              background:   'var(--gold-500)',
              color:        'var(--navy-900)',
              border:       'none',
              borderRadius: '2px',
              cursor:       'pointer',
              boxShadow:    '0 0 30px rgba(240,192,64,0.18)',
            }}
          >
            {reason === 'global_cap' ? 'Audition your own repo →' : 'Sign in for higher cap →'}
          </button>
        )}
        <button
          onClick={onTryAgain}
          className="px-5 py-2.5 font-mono text-xs tracking-widest"
          style={{
            background:   'transparent',
            color:        'var(--cream)',
            border:       '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor:       'pointer',
          }}
        >
          Try again →
        </button>
      </div>
    </div>
  )
}

// Live countdown to `resetAt`. Ticks every 30s — fine for `Xh Ym` display
// without burning a render budget. Returns null when no reset time or it
// is already in the past (counter should have reset already · let the
// user retry).
function useCountdown(resetAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!resetAt) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [resetAt])
  if (!resetAt) return null
  const target = Date.parse(resetAt)
  if (!Number.isFinite(target)) return null
  const ms = target - now
  if (ms <= 0) return null
  const totalMin = Math.ceil(ms / 60_000)
  const hours    = Math.floor(totalMin / 60)
  const mins     = totalMin % 60
  if (hours <= 0) return `${mins}m`
  return `${hours}h ${mins.toString().padStart(2, '0')}m`
}

// Cache hit indicator · 2026-05-15. URL fast lane caches every audit for
// 7 days (preview_rate_limits.last_analysis_at gate inside audit-site-
// preview line ~387). A 1-second response with a 7-day-old snapshot was
// reading as "the engine just measured this" — users were treating stale
// scores as fresh. This notice surfaces the cache + offers a one-click
// fresh run. Hidden when cache_hit is false (most audits).
function CacheNotice({
  cacheHit,
  snapshotAt,
  onRerun,
}: {
  cacheHit:   boolean
  snapshotAt: string | null
  onRerun:    () => void
}) {
  if (!cacheHit || !snapshotAt) return null
  const age = formatAge(Date.parse(snapshotAt))
  return (
    <div
      className="mb-5 px-4 py-3 flex flex-wrap items-center gap-3"
      style={{
        background:   'rgba(240,192,64,0.05)',
        border:       '1px dashed rgba(240,192,64,0.25)',
        borderRadius: '2px',
      }}
    >
      <div className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--gold-500)' }}>
        ⟳ Cached audit
      </div>
      <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
        Showing snapshot from <span style={{ color: 'var(--cream)' }}>{age} ago</span>. Cache holds for 7 days.
      </div>
      <button
        onClick={onRerun}
        className="ml-auto px-3 py-1.5 font-mono text-[11px] tracking-widest"
        style={{
          background:   'var(--gold-500)',
          color:        'var(--navy-900)',
          border:       'none',
          borderRadius: '2px',
          cursor:       'pointer',
        }}
      >
        Run fresh →
      </button>
    </div>
  )
}

function formatAge(ts: number): string {
  if (!Number.isFinite(ts)) return 'recently'
  const ms = Date.now() - ts
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return 'less than a minute'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr} hour${hr === 1 ? '' : 's'}`
  const days = Math.floor(hr / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

// Audit transparency · per-probe accountability + score basis · §15-E.
// The result card's most load-bearing block when the site is bot-walled.
// Without this, a 38/100 on naver.com reads as "engine thinks naver is
// bad" when the reality is "engine could not measure half the slots."
//
// Renders three layers:
//   1. Bot-wall notice (if applicable) — explains the underlying refusal
//      and which probes still passed, so the user knows the site is OK
//   2. Score slot basis — for each scoring slot: points / of / evidence /
//      measured. Failed slots show "0/5 · why 0pt"
//   3. Probe ledger — every probe attempted: status chip + detail + what
//      it contributes to. Always expandable, default open when bot-walled
//      so the explanation is immediately visible
function TransparencyPanel({ transparency }: { transparency?: AuditTransparency }) {
  // Open by default when bot-walled · we WANT the user to see the
  // explanation. Plain audits collapse to keep the result hero clean.
  const [open, setOpen] = useState(transparency?.bot_walled === true)
  if (!transparency || !transparency.probes || transparency.probes.length === 0) return null

  const { bot_walled, bot_walled_reason, probes, score_slot_basis } = transparency
  const measuredCount = probes.filter(p => p.status === 'measured').length
  const blockedCount  = probes.filter(p => p.status === 'blocked').length
  const recoveredCount = probes.filter(p => p.status === 'recovered_via').length
  const inferredCount  = probes.filter(p => p.status === 'inferred').length

  return (
    <div
      className="mb-6"
      style={{
        border: bot_walled ? '1px solid rgba(0,212,170,0.25)' : '1px solid rgba(248,245,238,0.08)',
        borderRadius: '2px',
        background: bot_walled ? 'rgba(0,212,170,0.04)' : 'rgba(6,12,26,0.35)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs tracking-widest"
        style={{
          background: 'transparent',
          color: bot_walled ? '#00D4AA' : 'var(--gold-500)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span>
          {bot_walled ? '⚠ BOT-WALLED · TRANSPARENCY' : '// AUDIT TRANSPARENCY'}
          <span style={{ color: 'var(--text-muted)' }}>
            {' · '}{measuredCount} measured
            {recoveredCount > 0 && <> · {recoveredCount} recovered</>}
            {inferredCount > 0 && <> · {inferredCount} inferred</>}
            {blockedCount > 0 && <> · <span style={{ color: 'var(--scarlet)' }}>{blockedCount} blocked</span></>}
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1 space-y-5">
          {/* Bot-wall explainer · only when the site refused our cheap probes
              but lab/Chromium got through. Frames bot protection as a polish
              signal, not a fault, and explains why some slots scored low. */}
          {bot_walled && (
            <div
              className="px-3 py-3 font-mono text-xs"
              style={{
                background: 'rgba(0,212,170,0.06)',
                border: '1px dashed rgba(0,212,170,0.3)',
                borderRadius: '2px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <div className="mb-2" style={{ color: '#00D4AA' }}>
                This site uses production-grade bot protection.
              </div>
              <div className="mb-2">
                {bot_walled_reason ?? 'Our cheap probes were refused, but Google PageSpeed and Cloudflare Chromium got through — proof the site is live and serving real users.'}
              </div>
              <div style={{ color: 'var(--text-muted)' }}>
                The slots that score below show evidence we recovered from sources that passed. Slots marked "blocked" couldn't be measured at all and contribute 0pt — not because the site is weak there, but because we had no way to check.
              </div>
            </div>
          )}

          {/* Score slot basis · per-slot point grounding */}
          {score_slot_basis && score_slot_basis.length > 0 && (
            <div>
              <SectionLabel>Score basis · per slot</SectionLabel>
              <div className="space-y-2">
                {score_slot_basis.map(slot => {
                  const ratio = slot.of > 0 ? slot.points / slot.of : 0
                  const color = ratio >= 0.8 ? 'var(--gold-500)' : ratio >= 0.5 ? 'var(--cream)' : ratio > 0 ? '#E0B341' : 'var(--scarlet)'
                  return (
                    <div key={slot.slot} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs">
                      <span style={{ color: 'var(--text-secondary)', minWidth: 130 }}>{slot.slot}</span>
                      <span className="tabular-nums" style={{ color, fontWeight: 600 }}>
                        {slot.points}/{slot.of}
                      </span>
                      {!slot.measured && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] tracking-widest"
                          style={{
                            background: 'rgba(200,16,46,0.08)',
                            border: '1px solid rgba(200,16,46,0.35)',
                            color: 'var(--scarlet)',
                            borderRadius: '2px',
                          }}
                        >
                          UNMEASURED
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)', flex: '1 1 100%', paddingLeft: 130, lineHeight: 1.5 }}>
                        {slot.evidence}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Probe ledger · every attempt + status + detail */}
          <div>
            <SectionLabel>Probe ledger</SectionLabel>
            <div className="space-y-2">
              {probes.map(p => <ProbeRow key={p.id} probe={p} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProbeRow({ probe }: { probe: AuditTransparency['probes'][number] }) {
  const chip =
    probe.status === 'measured'       ? { bg: 'rgba(0,212,170,0.08)',  border: 'rgba(0,212,170,0.35)',  color: '#00D4AA',          label: 'MEASURED' }
  : probe.status === 'recovered_via'  ? { bg: 'rgba(240,192,64,0.08)', border: 'rgba(240,192,64,0.35)', color: 'var(--gold-500)',  label: 'RECOVERED' }
  : probe.status === 'inferred'       ? { bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.4)',  color: '#60A5FA',          label: 'INFERRED' }
  : probe.status === 'unavailable'    ? { bg: 'rgba(248,245,238,0.04)',border: 'rgba(248,245,238,0.15)',color: 'var(--text-muted)',label: 'N/A' }
  :                                     { bg: 'rgba(200,16,46,0.08)',  border: 'rgba(200,16,46,0.4)',   color: 'var(--scarlet)',   label: 'BLOCKED' }
  return (
    <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className="px-1.5 py-0.5 text-[10px] tracking-widest"
          style={{
            background:   chip.bg,
            border:       `1px solid ${chip.border}`,
            color:        chip.color,
            borderRadius: '2px',
            flexShrink:   0,
          }}
        >
          {chip.label}
        </span>
        <span style={{ color: 'var(--cream)' }}>{probe.label}</span>
      </div>
      <div className="pl-1 mt-1" style={{ color: 'var(--text-muted)' }}>
        {probe.detail}
        {probe.source && <span> · via <span style={{ color: 'var(--text-secondary)' }}>{probe.source}</span></span>}
      </div>
      {probe.contributes_to && probe.contributes_to.length > 0 && (
        <div className="pl-1 mt-0.5 text-[10px] tracking-wide" style={{ color: 'var(--text-faint)' }}>
          → feeds: {probe.contributes_to.join(' · ')}
        </div>
      )}
    </div>
  )
}

// Per-probe evidence panel · shows what the engine actually measured.
// Replaces the old single-line "ROUTES PROBED · 6/6 reachable" with a
// 3-block expandable structure:
//
//   1. Lighthouse table · Perf / A11y / BP / SEO · mobile vs desktop
//   2. Reachability table · Live URL TTFB · routes · sitemap · broken paths
//   3. Coverage checklists · 10 completeness signals · 6 security headers
//   4. Deep probe summary · hydration framework · console / network counts ·
//      total bytes · DOM size
//
// Each block hides itself if the underlying probe was unavailable. Default
// collapsed to keep the result hero clean; tap to expand. Mobile = single
// column; desktop = 2 columns for the checklists. All numbers come from
// rich_analysis (mirrored from analyze-project line ~5019) plus the
// snapshot's top-level `lighthouse` column.
interface ProbedSignalsProps {
  lhMobile?:     LighthouseSlot
  lhDesktop?:    LighthouseSlot
  liveHealth?:   LiveUrlHealth
  routes?:       RoutesHealth
  completeness?: CompletenessSignals
  security?:     SecurityHeaders
  deepProbe?:    DeepProbeSummary
}
function ProbedSignals({ lhMobile, lhDesktop, liveHealth, routes, completeness, security, deepProbe }: ProbedSignalsProps) {
  const [open, setOpen] = useState(false)
  const lhAny  = !!(lhMobile?.performance != null || lhMobile?.accessibility != null)
  const anyDeep = !!(deepProbe?.fetched)
  const hasAny =
    lhAny ||
    !!(routes?.probed && routes.probed > 0) ||
    !!liveHealth ||
    !!completeness ||
    !!security ||
    anyDeep
  if (!hasAny) return null

  // Quick header summary so collapsed state still carries information.
  const probeCount =
    (lhAny ? 1 : 0) +
    (lhDesktop?.performance != null ? 1 : 0) +
    ((liveHealth?.status ?? 0) > 0 ? 1 : 0) +
    ((routes?.probed ?? 0) > 0 ? 1 : 0) +
    ((completeness?.filled ?? 0) > 0 ? 1 : 0) +
    ((security?.filled ?? 0) > 0 ? 1 : 0) +
    (anyDeep ? 1 : 0)

  return (
    <div
      className="mb-6"
      style={{
        border: '1px solid rgba(248,245,238,0.08)',
        borderRadius: '2px',
        background: 'rgba(6,12,26,0.35)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs tracking-widest"
        style={{
          background: 'transparent',
          color: 'var(--gold-500)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span>// PROBED SIGNALS · {probeCount} sources</span>
        <span style={{ color: 'var(--text-muted)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1 space-y-5">
          {/* ── Lighthouse mobile vs desktop ── */}
          {lhAny && (
            <div>
              <SectionLabel>Lighthouse</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th className="text-left font-normal py-1 pr-3">CATEGORY</th>
                      <th className="text-right font-normal py-1 px-3">MOBILE</th>
                      <th className="text-right font-normal py-1 pl-3">DESKTOP</th>
                    </tr>
                  </thead>
                  <tbody>
                    <LhRow label="Performance"   m={lhMobile?.performance}   d={lhDesktop?.performance} />
                    <LhRow label="Accessibility" m={lhMobile?.accessibility} d={lhDesktop?.accessibility} />
                    <LhRow label="Best practices" m={lhMobile?.bestPractices} d={lhDesktop?.bestPractices} />
                    <LhRow label="SEO"           m={lhMobile?.seo}           d={lhDesktop?.seo} />
                  </tbody>
                </table>
              </div>
              {(lhMobile?.total_byte_weight_kb != null || lhMobile?.dom_size != null) && (
                <div className="mt-2 font-mono text-[10px] tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {lhMobile?.total_byte_weight_kb != null && <span>page weight · <span style={{ color: 'var(--text-secondary)' }}>{(lhMobile.total_byte_weight_kb / 1024).toFixed(1)} MB</span></span>}
                  {lhMobile?.total_byte_weight_kb != null && lhMobile?.dom_size != null && <span> · </span>}
                  {lhMobile?.dom_size != null && <span>dom · <span style={{ color: 'var(--text-secondary)' }}>{lhMobile.dom_size.toLocaleString()} nodes</span></span>}
                </div>
              )}
            </div>
          )}

          {/* ── Reachability · live URL + routes ── */}
          {((liveHealth?.status ?? 0) > 0 || (routes?.probed ?? 0) > 0) && (
            <div>
              <SectionLabel>Reachability</SectionLabel>
              <div className="font-mono text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                {liveHealth && (liveHealth.status ?? 0) > 0 && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>live URL · </span>
                    <span style={{ color: liveHealth.ok ? 'var(--cream)' : 'var(--scarlet)' }}>
                      HTTP {liveHealth.status}
                    </span>
                    {liveHealth.elapsed_ms != null && (
                      <span style={{ color: 'var(--text-muted)' }}> · TTFB {liveHealth.elapsed_ms}ms</span>
                    )}
                  </div>
                )}
                {routes && routes.probed > 0 && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>routes · </span>
                    <span style={{ color: 'var(--cream)' }}>{routes.reachable}/{routes.probed} reachable</span>
                    {routes.broken > 0 && (
                      <span style={{ color: 'var(--scarlet)' }}> · {routes.broken} broken</span>
                    )}
                    {routes.sitemap_present != null && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' · sitemap '}
                        <span style={{ color: routes.sitemap_present ? 'var(--cream)' : 'var(--text-secondary)' }}>
                          {routes.sitemap_present ? `found (${routes.sitemap_url_count ?? '?'} URLs)` : 'absent'}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                {routes?.broken && routes.broken > 0 && routes.broken_paths && routes.broken_paths.length > 0 && (
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    broken paths · <span style={{ color: 'var(--scarlet)' }}>{routes.broken_paths.slice(0, 4).join(' · ')}</span>
                    {routes.broken_paths.length > 4 && <span> · +{routes.broken_paths.length - 4} more</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Coverage checklists · 10 completeness + 6 security ── */}
          {(completeness || security) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {completeness && (
                <div>
                  <SectionLabel>
                    Completeness <span style={{ color: 'var(--text-muted)' }}>· {completeness.filled ?? 0}/{completeness.of ?? 10}</span>
                  </SectionLabel>
                  <SignalChips
                    items={[
                      ['og:image',       !!completeness.has_og_image],
                      ['og:title',       !!completeness.has_og_title],
                      ['og:description', !!completeness.has_og_description],
                      ['twitter:card',   !!completeness.has_twitter_card],
                      ['canonical',      !!completeness.has_canonical],
                      ['meta-desc',      !!completeness.has_meta_desc],
                      ['manifest',       !!completeness.has_manifest],
                      ['theme-color',    !!completeness.has_theme_color],
                      ['apple-touch',    !!completeness.has_apple_touch],
                      ['favicon',        !!completeness.has_favicon],
                    ]}
                  />
                </div>
              )}
              {security && (security.filled ?? 0) >= 0 && (
                <div>
                  <SectionLabel>
                    Security headers <span style={{ color: 'var(--text-muted)' }}>· {security.filled ?? 0}/{security.of ?? 6}</span>
                  </SectionLabel>
                  <SignalChips
                    items={[
                      ['CSP',                !!security.has_csp],
                      ['HSTS',               !!security.has_hsts],
                      ['X-Frame-Options',    !!security.has_frame_protection],
                      ['X-Content-Type',     !!security.has_content_type_opt],
                      ['Referrer-Policy',    !!security.has_referrer_policy],
                      ['Permissions-Policy', !!security.has_permissions_policy],
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Deep probe summary · post-hydration evidence ── */}
          {anyDeep && (
            <div>
              <SectionLabel>Deep probe</SectionLabel>
              <div className="font-mono text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>render · </span>
                  <span style={{ color: 'var(--cream)' }}>{deepProbe?.via ?? 'unknown'}</span>
                  {deepProbe?.hydration_framework && (
                    <span style={{ color: 'var(--text-muted)' }}> · framework <span style={{ color: 'var(--cream)' }}>{deepProbe.hydration_framework}</span></span>
                  )}
                </div>
                {(deepProbe?.post_hydration_text_length ?? 0) > 0 && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>post-hydration text · </span>
                    <span style={{ color: 'var(--cream)' }}>{deepProbe?.post_hydration_text_length?.toLocaleString()} chars</span>
                  </div>
                )}
                {(lhMobile?.console_errors_count != null || lhMobile?.network_failures_count != null) && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>runtime · </span>
                    {lhMobile?.console_errors_count != null && (
                      <span style={{ color: (lhMobile.console_errors_count ?? 0) > 0 ? 'var(--scarlet)' : 'var(--cream)' }}>
                        {lhMobile.console_errors_count} console errors
                      </span>
                    )}
                    {lhMobile?.console_errors_count != null && lhMobile?.network_failures_count != null && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                    {lhMobile?.network_failures_count != null && (
                      <span style={{ color: (lhMobile.network_failures_count ?? 0) > 0 ? 'var(--scarlet)' : 'var(--cream)' }}>
                        {lhMobile.network_failures_count} network failures
                      </span>
                    )}
                  </div>
                )}
                {deepProbe?.screenshot_url && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    screenshot · <span style={{ color: 'var(--cream)' }}>captured (above)</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  )
}

function LhRow({ label, m, d }: { label: string; m?: number | null; d?: number | null }) {
  // LH_NOT_ASSESSED (-1) and null both render as "—" · we don't know enough
  // to score that axis. Positive numbers get the bucket color so the table
  // reads as a quick heat map (90+ gold · 70-89 cream · 50-69 amber · <50 scarlet).
  const cell = (v: number | null | undefined) => {
    if (v == null || v < 0) return <span style={{ color: 'var(--text-faint)' }}>—</span>
    const c = v >= 90 ? 'var(--gold-500)' : v >= 70 ? 'var(--cream)' : v >= 50 ? '#E0B341' : 'var(--scarlet)'
    return <span style={{ color: c }}>{v}</span>
  }
  return (
    <tr style={{ borderTop: '1px solid rgba(248,245,238,0.04)' }}>
      <td className="py-1.5 pr-3" style={{ color: 'var(--text-secondary)' }}>{label}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{cell(m)}</td>
      <td className="py-1.5 pl-3 text-right tabular-nums">{cell(d)}</td>
    </tr>
  )
}

function SignalChips({ items }: { items: Array<[string, boolean]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([name, present]) => (
        <span
          key={name}
          className="font-mono text-[10px] tracking-wide px-2 py-0.5"
          style={{
            background: present ? 'rgba(0,212,170,0.08)' : 'rgba(248,245,238,0.04)',
            border: `1px solid ${present ? 'rgba(0,212,170,0.3)' : 'rgba(248,245,238,0.12)'}`,
            color: present ? '#00D4AA' : 'var(--text-muted)',
            borderRadius: '2px',
          }}
        >
          {present ? '✓' : '·'} {name}
        </span>
      ))}
    </div>
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

// supabase-js `FunctionsHttpError` stuffs the raw Response onto
// `error.context` so we can recover the JSON body. `clone()` because
// supabase-js may have already consumed it. Falls back to the generic
// `error.message` ("Edge Function returned a non-2xx status code") only
// if no body or it isn't JSON.
//
// Returns the structured shape so cap-hit UI (countdown + sign-in CTA)
// can react to `reason` + `quota.reset_at` rather than just a flat string.
interface FriendlyError {
  message:  string
  reason?:  string           // 'global_cap' | 'ip_cap' | 'url_cap' | 'dns_opt_out' | ...
  reset_at?: string | null   // ISO timestamp (UTC midnight) when counters roll
}
async function extractFriendlyError(err: unknown): Promise<FriendlyError | null> {
  const ctx = (err as { context?: unknown })?.context
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json() as {
        message?: string
        error?:   string
        reason?:  string
        quota?:   { reset_at?: string | null }
      }
      const message =
        (typeof body?.message === 'string' && body.message.trim()) ? body.message :
        (typeof body?.error   === 'string' && body.error.trim())   ? body.error   : null
      if (message) {
        return { message, reason: body.reason, reset_at: body.quota?.reset_at ?? null }
      }
    } catch { /* not JSON · ignore */ }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return { message: m }
  }
  return null
}

interface ResultCardProps {
  result:       SiteAuditResult
  onAudition:   () => void
  onTryAnother: () => void
  onRerun:      () => void
}

function ResultCard({ result, onAudition, onTryAnother, onRerun }: ResultCardProps) {
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
  const screenshot  = rich.deep_probe?.screenshot_url ?? null
  // Per-probe echo · feeds the "PROBED SIGNALS" expandable panel below.
  // `snap?.lighthouse` is the snapshot's top-level mobile LH column;
  // `rich.lighthouse_mobile` mirrors it (2026-05-15+ snapshots). Older
  // snapshots only have the column, so fall back to it as primary.
  const lhMobile    = (snap?.lighthouse ?? rich.lighthouse_mobile) as LighthouseSlot | undefined
  const lhDesktop   = rich.lighthouse_desktop
  const completeness = rich.completeness_signals
  const security     = rich.security_headers
  const deepProbe    = rich.deep_probe
  const liveHealth   = rich.live_url_health

  // URL Polish Score · §15-E.3 separate scale.
  // The full /50 audit pillar can't be the denominator for URL-only audits
  // because most slots (tests · CI · LICENSE · Brief · Tech · Maturity) are
  // STRUCTURALLY UNATTAINABLE without a repo. Reporting "anthropic.com 26 / 100"
  // sounds awful when it actually means "URL signals are strong, repo signals
  // unseen". Calibrate against bot-fight-realistic achievable signals:
  //   · Lighthouse 20      — always fillable (PageSpeed = Google's infra)
  //   · Completeness 2     — meta tags · recovered via Tier B even when bot-walled
  //   · Responsive 2       — derived from LH perf
  //   · Runtime evidence 2 — console_clean + network_clean (mined from LH audits)
  //   · (Live URL Health 5 often 0 due to bot fight — excluded so well-polished
  //      SaaS aren't penalized for having bot protection)
  // Lane denominator lives in `laneScore.URL_LANE_MAX` so HeroUrlHook,
  // ProjectDetail (URL-lane projects), and recentAudits.ts all produce
  // identical numbers. The "URL signals only" caption + amber lane chip on
  // the score card stop visitors from mistaking 100/100 for a full audit.
  const polishScore = urlLanePolish(snap?.score_auto ?? result.project.score_auto ?? 0)

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

      <CacheNotice
        cacheHit={result.cache_hit === true}
        snapshotAt={snap?.created_at ?? null}
        onRerun={onRerun}
      />

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

      {/* Screenshot · §15-E.3 wave 5 · captured by CF Browser Rendering ·
          stored in audit-screenshots bucket · shown above stats so it's the
          first proof users see ("yes the engine actually rendered it"). */}
      {screenshot && (
        <div
          className="mb-5 overflow-hidden"
          style={{
            border: '1px solid rgba(248,245,238,0.12)',
            borderRadius: '2px',
            background: 'rgba(6,12,26,0.4)',
          }}
        >
          <img
            src={screenshot}
            alt={`${result.project.project_name} · audited render`}
            loading="lazy"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              maxHeight: 360,
              objectFit: 'cover',
              objectPosition: 'top',
            }}
          />
          <div className="px-3 py-1.5 font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)', borderTop: '1px solid rgba(248,245,238,0.06)' }}>
            CAPTURED BY ENGINE · 1280×720 · POST-HYDRATION
          </div>
        </div>
      )}

      <TransparencyPanel transparency={rich.audit_transparency} />

      <ProbedSignals
        lhMobile={lhMobile}
        lhDesktop={lhDesktop}
        liveHealth={liveHealth}
        routes={routes}
        completeness={completeness}
        security={security}
        deepProbe={deepProbe}
      />

      {/* Action row · mobile stacks full-width · sm+ rows side-by-side with
          consistent button widths. Primary gold · secondaries outline ·
          uniform 44px height (mobile tap target standard). Primary CTA
          drives the user into the FULL lane (/submit) — not a "claim"
          flow, since URL audits have no ownership verification. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <button
          onClick={onAudition}
          className="h-11 px-4 text-sm font-medium tracking-wide transition-all sm:col-span-1"
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
          Audition your repo →
        </button>
        <button
          onClick={() => {
            // Share via X intent · /projects/<id>?og=tweet hits the projects
            // middleware which rewrites twitter:image to the og-png Edge
            // Function (1280×720 PNG with score+bars+strengths/concerns).
            // Same surface auto-tweet uses · "no policy A claim, just share
            // the result card" — anonymous walk-on still gets to brag.
            const projectUrl = `https://commit.show/projects/${result.project.slug ?? result.project_id}?og=tweet`
            const topStrength = result.latest_snapshot?.rich_analysis?.scout_brief?.strengths?.[0]?.bullet ?? null
            openTweetIntent({
              projectName: result.project.project_name,
              score:       polishScore,
              url:         projectUrl,
              takeaway:    topStrength,
            })
          }}
          className="h-11 px-4 text-sm font-mono transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.2)')}
          title="Share this audit result on X · auto-generates a card with the score + top finding"
        >
          Share on X
        </button>
        <button
          onClick={onRerun}
          className="h-11 px-4 text-sm font-mono transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.2)')}
          title="Force a fresh audit · skips the 7-day cache · counts against your daily IP cap"
        >
          Re-run
        </button>
        <button
          onClick={onTryAnother}
          className="h-11 px-4 text-sm font-mono transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--cream)',
            border: '1px solid rgba(248,245,238,0.2)',
            borderRadius: '2px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.2)')}
        >
          Try another URL
        </button>
      </div>
      <p className="mt-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        Walk-on result · anonymous · not on the public ladder. Polish Score is
        the URL-lane scale — Lighthouse + meta + routing only · repo signals
        (tests · CI · LICENSE · Brief · Tech) aren't visible from a URL alone.
        Want the full 50-point report and a spot on the ladder? Audition your
        own repo from the button above.
      </p>
    </div>
  )
}
