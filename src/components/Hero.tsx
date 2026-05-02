import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HeroStats } from '../lib/heroStats'
import { HeroTerminal } from './HeroTerminal'

const HEADLINE_LINE_1 = 'Show your'
const HEADLINE_LINE_2 = 'Commit'
const TOTAL_HEADLINE_CHARS = HEADLINE_LINE_1.length + HEADLINE_LINE_2.length

function useTypedHeadline() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(TOTAL_HEADLINE_CHARS)
      return
    }
    if (count >= TOTAL_HEADLINE_CHARS) return
    // Initial pause lets the stagger-2 fadeUp finish · longer pause at the
    // line break makes the carriage return feel deliberate · per-char ~95ms
    // matches a realistic terminal-typing cadence.
    const delay =
      count === 0                          ? 650 :
      count === HEADLINE_LINE_1.length     ? 380 :
      95
    const t = setTimeout(() => setCount(c => c + 1), delay)
    return () => clearTimeout(t)
  }, [count])

  const line1 = HEADLINE_LINE_1.slice(0, Math.min(count, HEADLINE_LINE_1.length))
  const line2 = HEADLINE_LINE_2.slice(0, Math.max(0, count - HEADLINE_LINE_1.length))
  const onLine2 = count > HEADLINE_LINE_1.length
  return { line1, line2, onLine2 }
}

interface HeroProps {
  // `stats` retained on the prop surface so the live-tile section (currently
  // hidden) can be re-enabled without a wiring change. LandingPage still
  // passes it. See JSX comment block below.
  stats: HeroStats
}

export function Hero(_props: HeroProps) {
  const navigate = useNavigate()
  const onSubmitClick = () => navigate('/submit')
  const onFeedClick = () => navigate('/projects')

  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40 pt-20 pb-16 overflow-hidden">

      {/* ── Subtle background orbs · drift slowly behind the content.
          Pure CSS — radial-gradient blobs with heavy blur. Two-object
          composition (warm gold top-left · cool indigo bottom-right) so
          the canvas has weight without competing with the headline. */}
      <div aria-hidden="true" className="hero-orbs">
        <span className="hero-orb hero-orb-gold" />
        <span className="hero-orb hero-orb-indigo" />
      </div>

      {/* ── Two-column shell · stacked on mobile/md, side-by-side on lg+ ── */}
      <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-10 items-center">

        {/* ── LEFT · badge + headline + sub + CTAs ── */}
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
          <div
            className="stagger-1 inline-flex items-center gap-2 mb-8 px-4 py-2 font-mono text-xs tracking-widest"
            style={{
              background: 'rgba(240,192,64,0.06)',
              border: '1px solid rgba(240,192,64,0.25)',
              borderRadius: '2px',
              color: 'var(--gold-500)',
            }}
          >
            <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            LADDER LIVE<span className="hidden sm:inline"> · CLASS OF 2026</span>
          </div>

          <TypedH1 />

          <div className="stagger-3 w-24 h-px mb-6" style={{ background: 'var(--gold-500)', opacity: 0.4 }} />

          {/* Value prop · errors-first positioning (2026-04-30 pivot).
              Mobile breaks the two sentences onto separate lines so the
              second beat lands; desktop keeps them on one line. */}
          <p
            className="stagger-3 max-w-lg mb-3 font-display"
            style={{ color: 'var(--cream)', fontSize: '1.45rem', lineHeight: 1.4, fontWeight: 600 }}
          >
            AI ships fast.<span className="hidden sm:inline">{' '}</span><br className="sm:hidden" />AI also misses things.
          </p>
          <p
            className="stagger-3 max-w-lg mb-10 font-light"
            style={{ color: 'rgba(248,245,238,0.55)', fontSize: '1.05rem', lineHeight: 1.65 }}
          >
            We catch what your prompts forgot — and put your build on stage.
          </p>

          <div className="stagger-4 flex gap-4 justify-center lg:justify-start flex-wrap">
            <button
              onClick={onSubmitClick}
              className="px-8 py-3.5 text-sm font-medium tracking-wide transition-all"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
                boxShadow: '0 0 40px rgba(240,192,64,0.2)',
                width: '280px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-400)'; e.currentTarget.style.boxShadow = '0 0 60px rgba(240,192,64,0.35)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--gold-500)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(240,192,64,0.2)'; }}
            >
              Audition your product →
            </button>
            <button
              onClick={onFeedClick}
              className="px-8 py-3.5 text-sm font-medium tracking-wide transition-all"
              style={{
                background: 'transparent',
                color: 'var(--cream)',
                border: '1px solid rgba(248,245,238,0.2)',
                borderRadius: '2px',
                cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
                width: '280px',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.2)')}
            >
              Browse Projects →
            </button>
          </div>
        </div>

        {/* ── RIGHT · live terminal · header + animated audit demo ── */}
        <div className="stagger-5 flex flex-col items-center lg:items-stretch w-full">
          <div className="font-mono text-xs tracking-widest mb-3 text-center lg:text-left" style={{ color: 'var(--gold-500)' }}>
            // LIVE FROM YOUR TERMINAL
          </div>
          <p className="font-light text-sm mb-5 text-center lg:text-left" style={{ color: 'rgba(248,245,238,0.55)' }}>
            <span className="font-mono" style={{ color: 'var(--gold-500)' }}>npx commitshow@latest audit</span>
            {' '}on any GitHub repo. Catch what your AI missed in 60 seconds.
          </p>
          <HeroTerminal />
        </div>
      </div>

      {/* ── Live stats tiles · TEMPORARILY HIDDEN ──
          Hidden 2026-04-28 — kept in source so the wiring (HeroStats prop,
          fmtNum/fmtDelta helpers, Tile component) is one un-comment away.
          Re-enable by deleting the `false && ` guard below. */}
      {false && (
        <div className="stagger-5 flex gap-6 md:gap-14 justify-center flex-wrap mt-16">
          {/* Tiles render here when re-enabled. See git history at this commit
              for the original 4-tile layout (PRODUCTS LIVE / SCOUTS ACTIVE /
              VOTES CAST / GRADUATES IN). */}
        </div>
      )}
    </section>
  )
}

// ── Typed-terminal headline ───────────────────────────────────
// Renders "Show your\nCommit" as if typed at a 95ms-per-char cadence,
// with a longer pause at the line break for the carriage return.
// Reduced-motion users get the full text instantly. The cursor sits at
// the live caret, then settles after "Commit" finishes typing.
function TypedH1() {
  const { line1, line2, onLine2 } = useTypedHeadline()

  return (
    <h1
      className="stagger-2 font-display font-black leading-none tracking-tight mb-6"
      style={{ fontSize: 'clamp(3rem, 7.5vw, 6.5rem)', letterSpacing: '-1.5px' }}
    >
      <span style={{ color: 'var(--cream)' }}>{line1 || '​'}</span>
      {!onLine2 && <span className="terminal-cursor" aria-hidden="true" />}
      <br />
      {/* Use ​ (zero-width space) to keep line height even before any
          characters of "Commit" have been typed — prevents a layout shift
          when the second line starts populating. */}
      <em className="gold-shimmer not-italic">{line2 || '​'}</em>
      {onLine2 && <span className="terminal-cursor" aria-hidden="true" />}
    </h1>
  )
}
