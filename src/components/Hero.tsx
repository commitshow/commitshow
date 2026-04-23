import { useNavigate } from 'react-router-dom'
import type { HeroStats } from '../lib/heroStats'

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
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6 pt-20 pb-16 overflow-hidden">

      {/* ── Animated WebP background · conductor + golden matrix ── */}
      <img
        src="/hero-bg.webp"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{
          objectFit: 'cover',
          zIndex: -2,
          opacity: 1,
        }}
      />

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
        SEASON ZERO · NOW OPEN · CLASS OF 2026
      </div>

      {/* Main headline */}
      <h1
        className="stagger-2 font-display font-black leading-none tracking-tight mb-6"
        style={{ fontSize: 'clamp(3.5rem, 9vw, 8rem)', letterSpacing: '-1.5px' }}
      >
        <span style={{ color: 'var(--cream)' }}>Show your</span>
        <br />
        <em className="gold-shimmer not-italic">Commit</em>
        <span className="terminal-cursor" aria-hidden="true" />
      </h1>

      {/* Rule */}
      <div className="stagger-3 w-24 h-px mb-6" style={{ background: 'var(--gold-500)', opacity: 0.4 }} />

      {/* Sub */}
      <p
        className="stagger-3 max-w-xl mx-auto mb-10 font-light"
        style={{ color: 'rgba(248,245,238,0.55)', fontSize: '1.1rem', lineHeight: 1.8 }}
      >
        The vibe coding league where every commit is evidence. AI scores the work,
        Scouts forecast the finish, and the ones ready for production graduate.
      </p>

      {/* CTA */}
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
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-400)'; e.currentTarget.style.boxShadow = '0 0 60px rgba(240,192,64,0.35)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--gold-500)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(240,192,64,0.2)'; }}
        >
          Score your project →
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
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.2)')}
        >
          Browse Projects →
        </button>
      </div>

      {/* Stats */}
      <div className="stagger-5 flex gap-10 md:gap-14 justify-center flex-wrap">
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
