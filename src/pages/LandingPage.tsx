import { Hero } from '../components/Hero'
import { SeasonProgressBar } from '../components/SeasonProgress'
import { useHeroStats } from '../lib/heroStats'

// Simple monochrome line icons — inherit stroke from currentColor.
// Kept small and editorial so the gold accent is the only color in the set.
const GRADE_ICONS: Record<string, React.ReactNode> = {
  Rookie: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="9" opacity="0.35" />
    </svg>
  ),
  Builder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19h16" />
      <path d="M6 15h12" />
      <path d="M8 11h8" />
      <path d="M10 7h4" />
    </svg>
  ),
  Maker: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6" />
    </svg>
  ),
  Architect: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 3 9l9 5 9-5-9-5Z" />
      <path d="m3 14 9 5 9-5" opacity="0.55" />
      <path d="m3 19 9 5 9-5" opacity="0.3" />
    </svg>
  ),
  'Vibe Engineer': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3 4 14h7l-2 7 9-11h-7l2-7Z" />
    </svg>
  ),
  Legend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l4 5 5-7 5 7 4-5v11H3V8Z" />
      <path d="M3 19h18" />
    </svg>
  ),
}

const GRADE_DATA = [
  { name: 'Rookie',        cond: '1+ application submitted · 0 graduated' },
  { name: 'Builder',       cond: '1 graduated · avg 60+' },
  { name: 'Maker',         cond: '2 graduated · avg 70+' },
  { name: 'Architect',     cond: '3 graduated · avg 75+ · tech diversity' },
  { name: 'Vibe Engineer', cond: '5 graduated · 20+ applause · avg 80+' },
  { name: 'Legend',        cond: '10+ graduated · community influence' },
]

const UNLOCK_DATA = [
  { votes: 'Application',  label: 'Initial Evaluation',       desc: 'Source structure · live performance audit · brief integrity · live URL health',          active: true },
  { votes: '3 votes',      label: 'Code Quality Snapshot',    desc: 'Complexity analysis · duplicate pattern detection · function length audit',            active: false },
  { votes: '5 votes',      label: 'Security Layer Analysis',  desc: 'Row-level security review · secret exposure check · API auth patterns',                active: false },
  { votes: '10 votes',     label: 'Production Ready Check',   desc: 'Core Web Vitals · dependency vulnerabilities · uptime estimation',                     active: false },
  { votes: '20 votes',     label: 'Scout Deep Review',        desc: 'Structured expert feedback interface — Platinum+ Scouts only',                         active: false },
]

export function LandingPage() {
  const stats = useHeroStats()

  return (
    <div className="relative min-h-screen">
      <Hero stats={stats} />

      {/* ── SEASON PROGRESS ── */}
      <section className="relative z-10 px-6 pt-4 pb-0">
        <div className="max-w-5xl mx-auto">
          <SeasonProgressBar />
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how" className="relative z-10 py-24 px-6" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// HOW IT WORKS</div>
          <h2 className="font-display font-black text-4xl md:text-5xl mb-4 leading-tight">
            3-week league<br />Real graduation
          </h2>
          <p className="font-light max-w-md mb-14" style={{ color: 'rgba(248,245,238,0.45)' }}>
            Not just upvotes. A structured analysis system that separates production-ready projects from prototypes.
          </p>

          <div className="grid md:grid-cols-3 gap-6 mb-20">
            {[
              { pct: '50%', color: 'var(--gold-500)', title: 'Automated Evaluation', desc: 'Source structure · live performance audit · brief integrity · live URL health · tech-layer diversity. Objective. Uncheatable.' },
              { pct: '30%', color: '#A78BFA',         title: 'Scout Forecast',       desc: 'Weighted votes from verified Scouts. Platinum×3 · Gold×2 · Silver×1.5 · Bronze×1. Quality over quantity.' },
              { pct: '20%', color: '#00D4AA',         title: 'Community Signal',     desc: 'Views · comment depth · shares · return visits. Quality-weighted — not raw counts.' },
            ].map(({ pct, color, title, desc }) => (
              <div key={title} className="card-navy p-7 transition-all duration-200 hover:border-gold-500/30">
                <div className="font-display font-black mb-2" style={{ fontSize: '2.8rem', color, lineHeight: 1 }}>{pct}</div>
                <div className="font-medium mb-2" style={{ color: 'var(--cream)' }}>{title}</div>
                <div className="text-sm font-light leading-relaxed" style={{ color: 'rgba(248,245,238,0.4)' }}>{desc}</div>
              </div>
            ))}
          </div>

          <div className="font-mono text-xs tracking-widest mb-6" style={{ color: 'rgba(248,245,238,0.3)' }}>PROGRESSIVE REVEAL — ANALYSIS UNLOCKS WITH SCOUT VOTES</div>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, var(--gold-500), transparent)', opacity: 0.2 }} />
            {UNLOCK_DATA.map(({ votes, label, desc, active }) => (
              <div key={label} className="flex gap-6 pl-10 pb-6 relative">
                <div
                  className="absolute left-0 w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs flex-shrink-0"
                  style={active
                    ? { background: 'rgba(0,212,170,0.15)', color: '#00D4AA', border: '1px solid rgba(0,212,170,0.4)' }
                    : { background: 'var(--navy-800)', color: 'rgba(248,245,238,0.25)', border: '1px solid rgba(255,255,255,0.07)' }
                  }
                >
                  {active ? '✓' : '○'}
                </div>
                <div>
                  <div className="font-mono text-xs mb-1" style={{ color: active ? 'var(--gold-500)' : 'rgba(248,245,238,0.3)' }}>{votes}</div>
                  <div className="font-medium mb-1" style={{ color: active ? 'var(--cream)' : 'rgba(248,245,238,0.45)' }}>{label}</div>
                  <div className="text-sm font-light" style={{ color: 'rgba(248,245,238,0.3)' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GRADUATION ── */}
      <section className="relative z-10 py-24 px-6" style={{ borderTop: '1px solid rgba(240,192,64,0.08)', background: 'rgba(15,32,64,0.4)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// GRADUATION SYSTEM</div>
          <h2 className="font-display font-black text-4xl md:text-5xl mb-12">
            Graduate or retry
          </h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { grade: 'Valedictorian', pct: '≈0.5% (1 fixed)',  refund: '100% + $500 bonus', color: '#F0C040', perks: 'Hall of Fame · 10K media exposure · 1wk featured · Special NFT' },
              { grade: 'Honors',        pct: 'Top 5%',           refund: '85%',               color: '#A78BFA', perks: 'Hall of Fame · Cert badge · Featured · NFT' },
              { grade: 'Graduate',      pct: 'Top 20%',          refund: '70%',               color: '#60A5FA', perks: 'Grad badge · Brief full reveal · MD marketplace access' },
              { grade: 'Retry',         pct: 'Bottom 80%',       refund: '0%',                color: '#6B7280', perks: 'AI analysis report · Brief private option · Retry next season' },
            ].map(({ grade, pct, refund, color, perks }) => (
              <div key={grade} className="card-navy p-5 transition-all hover:border-gold-500/20" style={{ borderTop: `3px solid ${color}` }}>
                <div className="font-display font-bold text-base mb-0.5" style={{ color }}>{grade}</div>
                <div className="font-mono text-xs mb-3" style={{ color: 'rgba(248,245,238,0.3)' }}>{pct}</div>
                <div className="font-mono text-sm font-medium mb-3" style={{ color: 'var(--cream)' }}>Refund: {refund}</div>
                <div className="text-xs font-light leading-relaxed" style={{ color: 'rgba(248,245,238,0.4)' }}>{perks}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GRADES ── */}
      <section id="grades" className="relative z-10 py-24 px-6" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// CREATOR GRADES</div>
          <h2 className="font-display font-black text-4xl md:text-5xl mb-4">Earn your grade</h2>
          <p className="font-light max-w-md mb-10" style={{ color: 'rgba(248,245,238,0.45)' }}>
            Your cumulative graduation record determines your Creator Grade — visible on your profile, LinkedIn, and the Hall of Fame.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {GRADE_DATA.map(({ name, cond }, i) => (
              <div
                key={name}
                className="group relative overflow-hidden card-navy p-6 transition-all duration-300"
                style={{ borderRadius: '2px' }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 12px 32px -16px rgba(240,192,64,0.3)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = ''
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow = ''
                }}
              >
                {/* Subtle corner glow on hover — single accent color across all tiers */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{ background: 'radial-gradient(circle at 85% 15%, rgba(240,192,64,0.08) 0%, transparent 55%)' }}
                />

                <div className="relative flex items-start justify-between mb-5">
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 40, height: 40,
                      color: 'var(--gold-500)',
                    }}
                  >
                    {GRADE_ICONS[name]}
                  </div>
                  <span className="font-mono text-[11px] tabular-nums tracking-widest pt-1" style={{ color: 'var(--text-muted)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                <div className="relative font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
                  {name}
                </div>
                <div className="relative w-10 h-px mb-3" style={{ background: 'var(--gold-500)', opacity: 0.35 }} />
                <div className="relative font-mono text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {cond}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
