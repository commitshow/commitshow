import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HeroStats } from '../lib/heroStats'

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
  stats: HeroStats
}

const fmtNum = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US')

const fmtDelta = (n: number | null, suffix: string) => {
  if (n == null) return '—'
  if (n === 0)   return `0 ${suffix}`
  return `+ ${n.toLocaleString('en-US')} ${suffix}`
}

function Tile({
  label,
  value,
  delta,
  deltaTone = 'muted',
}: {
  label: string
  value: string
  delta: string
  deltaTone?: 'muted' | 'gold'
}) {
  return (
    <div className="text-center min-w-[128px]">
      <div
        className="font-mono text-[10px] tracking-[0.2em] uppercase mb-2.5"
        style={{ color: 'rgba(248,245,238,0.35)' }}
      >
        {label}
      </div>
      <div
        className="font-display font-bold mb-1.5 tabular-nums"
        style={{ fontSize: '2.25rem', color: 'var(--gold-500)', lineHeight: 1 }}
      >
        {value}
      </div>
      <div
        className="font-mono text-[11px] tabular-nums"
        style={{
          color: deltaTone === 'gold'
            ? 'rgba(240,192,64,0.75)'
            : 'rgba(248,245,238,0.5)',
        }}
      >
        {delta}
      </div>
    </div>
  )
}

export function Hero({ stats }: HeroProps) {
  const navigate = useNavigate()
  const onSubmitClick = () => navigate('/submit')
  const onFeedClick = () => navigate('/projects')

  const countdownValue = stats.graduatesIn
    ? `${stats.graduatesIn.days}d ${stats.graduatesIn.hours}h`
    : '—'
  const countdownDelta =
    stats.seasonPhase === 'active' && stats.weekNum
      ? `Week ${stats.weekNum} closes`
      : stats.seasonPhase === 'applaud'
        ? 'Applaud week closes'
        : stats.seasonPhase === 'graduation'
          ? 'Graduation day'
          : stats.seasonPhase === 'closed'
            ? 'Next season opening'
            : '—'

  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-4 md:px-6 pt-20 pb-16 overflow-hidden">

      {/* ── Background · video restored. The terminal animation didn't
          read well behind the headline (ASCII box clipping, vignette
          fighting the score's gold) and lives better in its own section
          below the hero. See <CliDemoSection /> on the landing page. */}
      <HeroBackground />


      {/* Subtle vertical vignette so text stays legible while the conductor
          frame remains clearly visible behind. Edges darker, middle clearer. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: -1,
          background: 'linear-gradient(to bottom, rgba(6,12,26,0.45) 0%, rgba(6,12,26,0.35) 35%, rgba(6,12,26,0.35) 65%, rgba(6,12,26,0.65) 100%)',
        }}
      />

      {/* Season badge */}
      <div
        className="stagger-1 inline-flex items-center gap-2 mb-10 px-4 py-2 font-mono text-xs tracking-widest"
        style={{
          background: 'rgba(240,192,64,0.06)',
          border: '1px solid rgba(240,192,64,0.25)',
          borderRadius: '2px',
          color: 'var(--gold-500)',
        }}
      >
        <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
        SEASON ZERO · NOW OPEN<span className="hidden sm:inline"> · CLASS OF 2026</span>
      </div>

      {/* Main headline · typed-terminal effect */}
      <TypedH1 />


      {/* Rule */}
      <div className="stagger-3 w-24 h-px mb-6" style={{ background: 'var(--gold-500)', opacity: 0.4 }} />

      {/* Sub · 3-beat rhythm — Audit · Forecast · Graduate. Tight by design. */}
      <p
        className="stagger-3 max-w-md mx-auto mb-10 font-light"
        style={{ color: 'rgba(248,245,238,0.55)', fontSize: '1.1rem', lineHeight: 1.7 }}
      >
        Engine audits. Scouts forecast. Top 20% graduate.
      </p>

      {/* CTA · matched widths · fixed 280px so both buttons render at the
          identical pixel width regardless of label length. min-width
          alone wasn't enough — the longer label ("Audition your product →")
          overflowed past 240px (~257px natural width in DM Mono), making
          the pair visually mismatched. */}
      <div className="stagger-4 flex gap-4 justify-center flex-wrap mb-16">
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

      {/* Stats · tighter gap on mobile so wrapped tiles still feel like one row */}
      <div className="stagger-5 flex gap-6 md:gap-14 justify-center flex-wrap">
        <Tile
          label="PRODUCTS LIVE"
          value={fmtNum(stats.productsLive)}
          delta={fmtDelta(stats.productsDeltaWeek, 'this week')}
        />
        <Tile
          label="SCOUTS ACTIVE"
          value={fmtNum(stats.scoutsActive)}
          delta={fmtDelta(stats.scoutsDeltaWeek, 'this week')}
        />
        <Tile
          label="VOTES CAST"
          value={fmtNum(stats.votesCast)}
          delta={fmtDelta(stats.votesDeltaToday, 'today')}
        />
        <Tile
          label="GRADUATES IN"
          value={countdownValue}
          delta={countdownDelta}
          deltaTone="gold"
        />
      </div>
    </section>
  )
}

// ── Two-stage hero background ─────────────────────────────────
// Stage 1 (instant · ~12KB): static WebP poster, the first frame of the
//   animation. Preloaded in index.html so it's the LCP candidate.
// Stage 2 (deferred): hardware-decoded <video> with mp4 + webm sources,
//   triggered after the page is idle. Animated WebP was previously
//   software-decoded on the main thread → stutter on mid-range phones.
//   The <video> element offloads to GPU and plays smoothly at 15fps.
//   Slow connections (Save-Data, 2g, downlink < 1.5 Mbps) and
//   prefers-reduced-motion users keep the still poster.
function HeroBackground() {
  const [showVideo, setShowVideo] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mediaMotion.matches) return

    const nav = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection
    if (nav?.saveData) return
    if (nav?.effectiveType && /(^|-)2g$/.test(nav.effectiveType)) return
    // Loosened from 1.5 → 0.7 Mbps. Most 4g/wifi sits well above this; the
    // earlier threshold was skipping the video on otherwise-fine connections,
    // leaving the static poster frozen on the page.
    if (typeof nav?.downlink === 'number' && nav.downlink < 0.7) return

    const arm = () => setShowVideo(true)
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (ric) ric(arm, { timeout: 2500 })
    else setTimeout(arm, 800)
  }, [])

  // Belt-and-suspenders: the autoplay attribute alone fails on some
  // mobile browsers (Low Power Mode iOS, some Chrome versions). Calling
  // .play() explicitly once metadata is loaded covers those cases.
  useEffect(() => {
    if (!showVideo) return
    const v = videoRef.current
    if (!v) return
    const tryPlay = () => v.play().catch(() => { /* user-policy block · poster stays */ })
    if (v.readyState >= 2) tryPlay()
    else v.addEventListener('loadeddata', tryPlay, { once: true })
  }, [showVideo])

  return (
    <>
      <img
        src="/hero-poster.webp"
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{ objectFit: 'cover', zIndex: -2 }}
      />
      {showVideo && (
        <video
          ref={videoRef}
          aria-hidden="true"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/hero-poster.webp"
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{
            objectFit: 'cover',
            zIndex: -2,
            opacity: 1,
            animation: 'fadeIn 600ms ease-out',
          }}
        >
          {/* WebM first for Chrome/Firefox · MP4 for Safari/iOS.
              v3 = high-quality 30fps with motion interpolation
              (mp4 CRF 22 · webm 2-pass 2.5 Mbps). */}
          <source src="/hero-bg-v3.webm" type="video/webm" />
          <source src="/hero-bg-v3.mp4"  type="video/mp4"  />
        </video>
      )}
    </>
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
      style={{ fontSize: 'clamp(3.5rem, 9vw, 8rem)', letterSpacing: '-1.5px' }}
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
