// CMO Preview · 5 trigger types rendered with realistic sample data so
// CEO/M can review brand consistency BEFORE building the full Post Studio
// (cmo_posts table · auto-generation · approval queue · API integration).
//
// Each card mocks the X share-card image (1200×630) + the tweet copy that
// would auto-fill from the underlying DB event. No real DB read · pure
// preview surface. Internal admin-gated.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// ── Shared card chrome ─────────────────────────────────────────────────────
const cardWidth = 1200
const cardHeight = 630

function CardFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${cardWidth} ${cardHeight}`} width="100%" style={{ display: 'block', borderRadius: '6px', border: '1px solid rgba(240,192,64,0.25)' }}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F2040" />
          <stop offset="100%" stopColor="#060C1A" />
        </linearGradient>
        <linearGradient id="goldShimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0C040" />
          <stop offset="100%" stopColor="#D4A838" />
        </linearGradient>
      </defs>
      <rect width={cardWidth} height={cardHeight} fill="url(#bg)" />
      {children}
      {/* Wordmark · top-left */}
      <text x={64} y={68} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={32} fill="#F0C040">commit<tspan fill="#F8F5EE" fontWeight={400}>.show</tspan></text>
      <text x={64} y={92} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={12} fill="rgba(248,245,238,0.55)" letterSpacing="2">VIBE-CODING LEAGUE</text>
    </svg>
  )
}

// ── 1. Audit complete ──────────────────────────────────────────────────────
function AuditCompleteCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={20} fill="rgba(248,245,238,0.65)">maa-website</text>
      <text x={cardWidth - 64} y={92} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={12} fill="rgba(248,245,238,0.4)">audit complete</text>

      <text x={cardWidth / 2} y={210} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={150} fill="url(#goldShimmer)" letterSpacing="-1">82</text>
      <text x={cardWidth / 2} y={250} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.6)" letterSpacing="3">/ 100 · STRONG</text>

      <text x={64} y={340} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.45)" letterSpacing="2">WHAT THIS BUILD MISSED</text>
      <text x={64} y={372} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↓ no API rate limiting on /auth — IP cap missing</text>
      <text x={64} y={400} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↓ Lighthouse a11y 72 · buttons missing aria-labels</text>

      <text x={64} y={450} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.45)" letterSpacing="2">WHAT IT GOT RIGHT</text>
      <text x={64} y={482} fontFamily="'DM Sans', sans-serif" fontSize={20} fill="#F8F5EE">↑ 50 RLS policies · every state-changing table covered</text>

      <rect x={64} y={528} width={cardWidth - 128} height={56} rx={3} fill="rgba(0,0,0,0.4)" stroke="rgba(240,192,64,0.4)" strokeWidth={1} />
      <text x={cardWidth / 2} y={563} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={20} fill="#F0C040">npx commitshow audit github.com/owner/maa-website</text>
    </CardFrame>
  )
}

// ── 2. Graduation ──────────────────────────────────────────────────────────
function GraduationCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">SEASON ZERO · SPRING 2026</text>

      {/* Big VALEDICTORIAN word */}
      <text x={cardWidth / 2} y={250} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={88} fill="url(#goldShimmer)">Valedictorian</text>

      {/* Project name */}
      <text x={cardWidth / 2} y={330} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={56} fill="#F8F5EE">cal-clone</text>

      {/* Creator */}
      <text x={cardWidth / 2} y={370} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={22} fill="rgba(248,245,238,0.65)">by @minji_dev</text>

      {/* Score line · pixel digits inline */}
      <text x={cardWidth / 2} y={460} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.5)" letterSpacing="3">FINAL SCORE</text>
      <text x={cardWidth / 2} y={520} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={88} fill="url(#goldShimmer)">94</text>

      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontSize={20} fill="rgba(248,245,238,0.6)">Every commit, on stage.</text>
    </CardFrame>
  )
}

// ── 3. Milestone ───────────────────────────────────────────────────────────
function MilestoneCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">MILESTONE · 100-DAY STREAK</text>

      {/* Big "100" days */}
      <text x={cardWidth / 2} y={310} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={220} fill="url(#goldShimmer)" letterSpacing="-2">100</text>
      <text x={cardWidth / 2} y={360} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={22} fill="rgba(248,245,238,0.7)" letterSpacing="6">DAYS IN TOP 50</text>

      {/* Project */}
      <text x={cardWidth / 2} y={460} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={48} fill="#F8F5EE">stripe-supabase-recipe</text>
      <text x={cardWidth / 2} y={500} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={20} fill="rgba(248,245,238,0.55)">SaaS · ranked #4 in category</text>

      {/* Footer line */}
      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="#F0C040" letterSpacing="2">commit.show/projects/[id]</text>
    </CardFrame>
  )
}

// ── 4. Weekly Top Picks ────────────────────────────────────────────────────
function WeeklyPicksCard() {
  const movers = [
    { rank: 1, name: 'cal-clone',          delta: '+12', score: 88 },
    { rank: 2, name: 'rag-quickstart',     delta:  '+9', score: 81 },
    { rank: 3, name: 'agentic-toolbench',  delta:  '+7', score: 79 },
  ]
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">WEEK 18 · 2026-05-04</text>

      <text x={cardWidth / 2} y={170} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={56} fill="url(#goldShimmer)">This Week in commit.show</text>
      <text x={cardWidth / 2} y={210} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.55)" letterSpacing="3">TOP 3 CLIMBERS</text>

      {movers.map((m, i) => {
        const y = 310 + i * 80
        return (
          <g key={m.rank}>
            <text x={120} y={y + 8} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={56} fill="url(#goldShimmer)">#{m.rank}</text>
            <text x={230} y={y - 8} fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={32} fill="#F8F5EE">{m.name}</text>
            <text x={230} y={y + 22} fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={18} fill="rgba(248,245,238,0.6)">{m.delta} pts · score {m.score}/100</text>
          </g>
        )
      })}

      <text x={cardWidth / 2} y={580} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontSize={20} fill="rgba(248,245,238,0.55)">Every commit, on stage.</text>
    </CardFrame>
  )
}

// ── 5. Early Spotter (Scout Forecast hit) ──────────────────────────────────
function EarlySpotterCard() {
  return (
    <CardFrame>
      <text x={cardWidth - 64} y={68} textAnchor="end" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="rgba(248,245,238,0.4)" letterSpacing="2">SCOUT EARLY SPOTTER · HIT #7</text>

      <text x={cardWidth / 2} y={200} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontStyle="italic" fontWeight={700} fontSize={66} fill="url(#goldShimmer)">Early Spotter</text>

      {/* Scout name */}
      <text x={cardWidth / 2} y={290} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.5)" letterSpacing="2">SPOTTED BY</text>
      <text x={cardWidth / 2} y={340} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={42} fill="#F8F5EE">@gold_scout_07</text>
      <text x={cardWidth / 2} y={368} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="#F0C040" letterSpacing="3">GOLD SCOUT</text>

      <line x1={cardWidth / 2 - 60} y1={398} x2={cardWidth / 2 + 60} y2={398} stroke="rgba(240,192,64,0.35)" strokeWidth={1} />

      <text x={cardWidth / 2} y={440} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={16} fill="rgba(248,245,238,0.5)" letterSpacing="2">SPOTTED 14 DAYS BEFORE GRADUATION</text>
      <text x={cardWidth / 2} y={490} textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight={900} fontSize={36} fill="#F8F5EE">cal-clone · Honors</text>
      <text x={cardWidth / 2} y={524} textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize={20} fill="rgba(248,245,238,0.55)">final score 88/100</text>

      <text x={cardWidth / 2} y={585} textAnchor="middle" fontFamily="'DM Mono', 'SF Mono', monospace" fontSize={14} fill="#F0C040" letterSpacing="2">commit.show/scouts/[id]</text>
    </CardFrame>
  )
}

// ── Page layout ────────────────────────────────────────────────────────────

type TriggerCard = {
  id:           string
  label:        string
  fires_when:   string
  data_source:  string
  Image:        () => React.ReactElement
  copy:         string
}

const triggers: TriggerCard[] = [
  {
    id: 'audit_complete',
    label: '1. Audit complete',
    fires_when: 'analysis_snapshots row inserted (initial · resubmit · weekly)',
    data_source: 'project.project_name · score.total / band · concerns[0..1] · strengths[0]',
    Image: AuditCompleteCard,
    copy: `audited maa-website ↓

↓ no API rate limiting on /auth — IP cap missing
↓ lighthouse a11y 72, buttons missing aria-labels

↑ 50 RLS policies, every state-changing table covered

82/100 · band: strong

npx commitshow audit github.com/owner/maa-website`,
  },
  {
    id: 'graduation',
    label: '2. Graduation',
    fires_when: 'project.graduation_grade flips to Valedictorian / Honors / Graduate',
    data_source: 'project.project_name · creator.x_handle · graduation_grade · season_id · final score',
    Image: GraduationCard,
    copy: `cal-clone graduated Valedictorian · Season Zero.

shipped by @minji_dev — final score 94/100, spring 2026 cohort.

every commit, on stage.

commit.show/projects/[id]`,
  },
  {
    id: 'milestone',
    label: '3. Milestone',
    fires_when: 'ladder_milestones row inserted (first_top_10 · streak_100_days · climb_100_steps · etc.)',
    data_source: 'milestone_type · project.project_name · category · current rank',
    Image: MilestoneCard,
    copy: `stripe-supabase-recipe just hit 100 days in the top 50.

ranked #4 in SaaS · auditioning live in Season Zero.

100-day streak isn't an algorithm trick — it's the same repo holding shape across iterations.

commit.show/projects/[id]`,
  },
  {
    id: 'weekly_picks',
    label: '4. Weekly Top Picks',
    fires_when: 'cron · every Monday 9 AM PT (Peak A slot)',
    data_source: 'top 3 score_total_delta over the past 7 days',
    Image: WeeklyPicksCard,
    copy: `this week in commit.show ↑

#1 cal-clone · +12 pts · 88/100
#2 rag-quickstart · +9 pts · 81/100
#3 agentic-toolbench · +7 pts · 79/100

every commit, on stage · commit.show/ladder`,
  },
  {
    id: 'early_spotter',
    label: '5. Early Spotter (Scout hit)',
    fires_when: 'graduation event · scout had a correct Forecast > 7 days before',
    data_source: 'scout.x_handle · scout.tier · project.project_name · days_before_graduation · final score',
    Image: EarlySpotterCard,
    copy: `@gold_scout_07 spotted cal-clone 14 days before it graduated Honors.

Gold Scout · early spotter hit #7 this season.

scouts who call it early get a permanent badge — that's the whole point of the tier.

commit.show/scouts/[id]`,
  },
]

export function CmoPreviewPage() {
  const { user, member, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!user)             { navigate('/'); return }
    if (!member?.is_admin) { navigate('/'); return }
  }, [user, member, loading, navigate])

  if (loading || !user || !member?.is_admin) {
    return null
  }

  return (
    <div className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen" style={{ background: 'var(--navy-950)', color: 'var(--cream)' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// CMO POST STUDIO · PREVIEW MODE</div>
          <h1 className="font-display text-3xl mb-1" style={{ color: 'var(--cream)' }}>5 trigger types · what each post will look like</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Mock preview only · no DB read · approval queue + auto-generation lands in Phase 2 (CMO.md §6).
            Each card mirrors the share-card image (1200×630) + the tweet copy that auto-fills from the underlying event.
          </p>
        </header>

        <div style={{ display: 'grid', gap: 36 }}>
          {triggers.map(t => (
            <section key={t.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <h2 className="font-display text-xl mb-1" style={{ color: 'var(--gold-500)' }}>{t.label}</h2>
                <div className="font-mono text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  fires when: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{t.fires_when}</span>
                </div>
                <div className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  data: <span style={{ color: 'rgba(255,255,255,0.8)' }}>{t.data_source}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, alignItems: 'start' }}>
                <div>
                  <div className="font-mono text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>SHARE CARD · 1200×630</div>
                  <t.Image />
                </div>
                <div>
                  <div className="font-mono text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>TWEET COPY · {t.copy.length} CHARS</div>
                  <pre style={{
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(240,192,64,0.18)',
                    borderRadius: '3px',
                    padding: 16,
                    fontFamily: "'DM Mono', 'SF Mono', monospace",
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: 'var(--cream)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    margin: 0,
                  }}>{t.copy}</pre>
                </div>
              </div>
            </section>
          ))}
        </div>

        <footer className="font-mono text-xs mt-12" style={{ color: 'rgba(255,255,255,0.4)' }}>
          source · src/pages/CmoPreviewPage.tsx · admin-gated (members.is_admin) · iterate the SVG / copy here, ship to Phase 2 once locked
        </footer>
      </div>
    </div>
  )
}
