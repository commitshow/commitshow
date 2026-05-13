import { useEffect, useState } from 'react'
import { Hero } from '../components/Hero'
import { HeroUrlHook } from '../components/HeroUrlHook'
import { AuditShowcase } from '../components/AuditShowcase'
import { WhatWeCatch } from '../components/WhatWeCatch'
import { LadderTopStrip } from '../components/LadderTopStrip'
import { SeasonProgressBar } from '../components/SeasonProgress'
import { ThisWeekHighlight } from '../components/ThisWeekHighlight'
import { useHeroStats } from '../lib/heroStats'
import { loadCurrentSeason } from '../lib/season'
import type { Season } from '../lib/supabase'

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
  { name: 'Rookie',        cond: '1+ audit · 0 Encore' },
  { name: 'Builder',       cond: '1 Encore · avg 60+' },
  { name: 'Maker',         cond: '2 Encore · avg 70+' },
  { name: 'Architect',     cond: '3 Encore · avg 75+ · tech diversity' },
  { name: 'Vibe Engineer', cond: '5 Encore · 20+ applause · avg 80+' },
  { name: 'Legend',        cond: '10+ Encore · community influence' },
]

const UNLOCK_DATA = [
  { votes: 'Audit 1',     label: 'Initial audit',            desc: 'Source structure · live performance audit · brief integrity · live URL health',          active: true },
  { votes: '3 votes',     label: 'Code quality snapshot',    desc: 'Complexity · duplicate patterns · function length',                                       active: false },
  { votes: '5 votes',     label: 'Security layer audit',     desc: 'Row-level security review · secret exposure · API auth patterns',                        active: false },
  { votes: '10 votes',    label: 'Production-ready check',   desc: 'Core Web Vitals · dependency vulnerabilities · uptime estimation',                       active: false },
  { votes: '20 votes',    label: 'Scout deep review',        desc: 'Structured expert feedback interface — Platinum+ Scouts only',                           active: false },
]

export function LandingPage() {
  const stats = useHeroStats()
  const [currentQuarterly, setCurrentQuarterly] = useState<Season | null>(null)
  useEffect(() => {
    let alive = true
    loadCurrentSeason().then(s => { if (alive) setCurrentQuarterly(s) })
    return () => { alive = false }
  }, [])

  return (
    <div className="relative min-h-screen">
      <Hero stats={stats} />

      {/* ── URL Fast Lane hook · §15-E.6 · try-before-signup funnel ── */}
      <HeroUrlHook />

      {/* ── Engine receipts · §15-E.6 · 6-card grid of real audits across
          all three lanes (member full · CLI walk-on · URL fast). Hides
          itself if the recent-audits pool is empty. ── */}
      <AuditShowcase />

      {/* ── "What we catch" · live prevalence of the 14 AI-Coder vibe
          concerns across the latest snapshot per non-preview project.
          Pairs with AuditShowcase (real cards) by answering the natural
          follow-up: "ok, what does it catch?" Hides itself when sample
          < 5 or every frame is under the 10% surface threshold. ── */}
      <WhatWeCatch />

      {/* ── LADDER TOP 3 · always-on · §11-NEW.1 ── */}
      <LadderTopStrip />

      {/* ── HOW IT WORKS · two layers (always-on ladder + Encore bar) ── */}
      <section id="how" className="relative z-10 py-24 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// HOW IT WORKS</div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4 leading-tight">
            Ranked always live<br />Score 85+ earns Encore
          </h2>
          <p className="font-light max-w-xl mb-14" style={{ color: 'rgba(248,245,238,0.45)' }}>
            Continuous ranking. Every audited product climbs against its category. Cross the 85 line on
            total score — Audit 50 + Scout 30 + Community 20 — and the product carries a permanent Encore
            badge until it drops back below.
          </p>

          <div className="grid md:grid-cols-2 gap-5 mb-16">
            {/* Always-on layer */}
            <div className="card-navy p-7" style={{ borderLeft: '3px solid var(--gold-500)' }}>
              <div className="font-mono text-[10px] tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>ALWAYS-ON · LADDER</div>
              <h3 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--cream)' }}>
                Audit · 70%
              </h3>
              <h3 className="font-display font-bold text-2xl mb-4" style={{ color: 'var(--cream)' }}>
                Community · 30%
              </h3>
              <p className="text-sm font-light leading-relaxed mb-5" style={{ color: 'rgba(248,245,238,0.55)' }}>
                Source structure, live performance, brief integrity, tech-layer diversity, vibe-coder-specific
                concerns (RLS, webhook idempotency, secret exposure, …). Ranked by category, refreshed every
                5 minutes.
              </p>
              <div className="font-mono text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>
                7 use-case categories · productivity · niche saas · creator · dev tools · ai agents · consumer · games
              </div>
            </div>

            {/* Encore layer */}
            <div className="card-navy p-7" style={{ borderLeft: '3px solid #A78BFA' }}>
              <div className="font-mono text-[10px] tracking-widest mb-3" style={{ color: '#A78BFA' }}>QUALITY BAR · ENCORE</div>
              <h3 className="font-display font-bold text-2xl mb-1" style={{ color: 'var(--cream)' }}>
                Audit 50 + Scout 30 + Community 20
              </h3>
              <h3 className="font-display font-bold text-2xl mb-4" style={{ color: 'var(--cream)' }}>
                Cross 85 → Encore.
              </h3>
              <p className="text-sm font-light leading-relaxed mb-5" style={{ color: 'rgba(248,245,238,0.55)' }}>
                Total score crosses 85 → product earns the permanent Encore badge. No tiers, no
                ceremony · score above the bar = Encore, score below = work in progress. The badge
                sticks until it doesn't deserve to. Featured Lanes pull from the Encore set, so the rest of the platform amplifies what's actually shipping.
              </p>
              <div className="font-mono text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Threshold · 85/100 · audit re-runs are free for owners
              </div>
            </div>
          </div>

          {/* Current quarterly progress · subtle, beneath the layered cards */}
          <div className="mb-20">
            <SeasonProgressBar />
          </div>

          {/* 7 patterns · the AI Coder 7 Frames marketing surface.
              Hero mentions Security / Reliability / Performance / Verification
              as the pillars; this is where they unfold into specific frames so
              creators understand what we look for. Per §4, no emoji icons —
              tonal accent dots + typography. */}
          <div className="mb-20">
            <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// AI CODER 7 FRAMES</div>
            <h3 className="font-display font-bold text-2xl sm:text-3xl mb-3 leading-tight">
              7 patterns vibe-coded products tend to break
            </h3>
            <p className="font-light max-w-xl mb-8" style={{ color: 'rgba(248,245,238,0.45)' }}>
              These are the failure modes AI codegen ships without thinking. The audit looks for each one
              and surfaces the evidence — file paths, sample patterns, what to fix.
            </p>
            {(() => {
              const FRAMES = [
                { pillar: 'Security',     accent: '#F0C040', title: 'Secret hygiene',      desc: 'Service keys, tokens leaked to client' },
                { pillar: 'Reliability',  accent: '#60A5FA', title: 'Webhook integrity',   desc: 'Stripe retries, duplicate charges' },
                { pillar: 'Security',     accent: '#F0C040', title: 'RLS gaps',            desc: 'Tables exposed to all users' },
                { pillar: 'Performance',  accent: '#A78BFA', title: 'Missing indexes',     desc: 'Slow dashboards at scale' },
                { pillar: 'Reliability',  accent: '#60A5FA', title: 'Rate limits',         desc: 'DDoS, bill shock' },
                { pillar: 'Verification', accent: '#00D4AA', title: 'Error tracking',      desc: 'Silent failures' },
                { pillar: 'Security',     accent: '#F0C040', title: 'Prompt injection',    desc: 'User input bleeding into system prompts' },
              ] as const
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {FRAMES.map(f => (
                    <div key={f.title} className="card-navy p-4" style={{ borderLeft: `2px solid ${f.accent}` }}>
                      <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: f.accent, opacity: 0.85 }}>
                        {f.pillar.toUpperCase()}
                      </div>
                      <div className="font-display font-bold text-base mb-1" style={{ color: 'var(--cream)' }}>
                        {f.title}
                      </div>
                      <div className="text-xs font-light leading-relaxed" style={{ color: 'rgba(248,245,238,0.45)' }}>
                        {f.desc}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          <div className="font-mono text-xs tracking-widest mb-6" style={{ color: 'rgba(248,245,238,0.3)' }}>PROGRESSIVE REVEAL — DEEPER ANALYSIS UNLOCKS WITH SCOUT VOTES</div>
          <div className="relative">
            {/* Vertical connector · starts at the bottom edge of the first
                32px circle (top = 2rem) and stops at the top edge of the
                last circle (bottom = pb-6 24px + circle 32px = 3.5rem) so
                the line lives strictly between nodes, never overlapping. */}
            <div className="absolute left-4 w-px" style={{ top: '2rem', bottom: '3.5rem', background: 'linear-gradient(to bottom, var(--gold-500), transparent)', opacity: 0.2 }} />
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

      {/* ── THIS WEEK · 3-min digest ── */}
      <ThisWeekHighlight />

      {/* ── ENCORE PRODUCTS · score-cut quality bar (was 'graduation tiers') ── */}
      <section className="relative z-10 py-24 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40" style={{ borderTop: '1px solid rgba(240,192,64,0.08)', background: 'rgba(15,32,64,0.4)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// ENCORE PRODUCTS</div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4">
            Score 85+ earns Encore
          </h2>
          <p className="font-light max-w-xl mb-12" style={{ color: 'rgba(248,245,238,0.45)' }}>
            One bar. Total score (Audit 50 + Scout 30 + Community 20) crosses 85 → Encore badge on the
            product, permanent. Drops back below the bar → badge disappears. No tiers, no ceremony,
            just a quality threshold visible on the product itself.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { band: 'Encore',   range: '85 – 100',  color: 'var(--gold-500)', desc: 'Permanent ★ badge on the product card · surfaced in Featured Lanes · creator grade boost.' },
              { band: 'Strong',   range: '70 – 83',   color: '#00D4AA',         desc: 'Audited and shipped, climbing. One axis push (a Scout vote, an audit re-run after a fix) typically clears the bar.' },
              { band: 'Early',    range: 'Below 70',  color: '#6B7280',         desc: 'Fresh on the ladder. Pick a concern from the audit report, fix it, re-audit · the score moves with each commit.' },
            ].map(({ band, range, color, desc }) => (
              <div key={band} className="card-navy p-5 transition-all hover:border-gold-500/20" style={{ borderTop: `3px solid ${color}` }}>
                <div className="font-display font-bold text-base mb-0.5" style={{ color }}>{band}</div>
                <div className="font-mono text-xs mb-3 tabular-nums" style={{ color: 'rgba(248,245,238,0.3)' }}>{range}</div>
                <div className="text-xs font-light leading-relaxed" style={{ color: 'rgba(248,245,238,0.4)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SURFACES · §15-E + §15-C + §15-C.6 ──
          Four ways to invoke the same audit engine. Order is
          acquisition-funnel descending (web zero-friction → MCP power
          user). Each tile is a one-liner + an action line so the user
          can evaluate fit without leaving the page. */}
      <section className="relative z-10 py-24 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40" style={{ borderTop: '1px solid rgba(240,192,64,0.08)', background: 'rgba(15,32,64,0.25)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// FOUR SURFACES</div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4">Run the audit anywhere</h2>
          <p className="font-light max-w-xl mb-10" style={{ color: 'rgba(248,245,238,0.45)' }}>
            One scoring engine. Pick the runtime that fits how you build — paste a URL, run a terminal command, gate a pull request, or call it as a tool from Claude Desktop or Cursor.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                tag:    'WEB',
                title:  'URL Fast Lane',
                body:   'Paste a deployed URL. Mobile + desktop Lighthouse, multi-route, post-hydration probe. 30 seconds.',
                action: 'Try the homepage hook ↑',
                href:   '#',
              },
              {
                tag:    'CLI',
                title:  'npx commitshow audit',
                body:   'One terminal command. Writes .commitshow/audit.{md,json} so the next AI turn can read the result.',
                action: 'commitshow on npm ↗',
                href:   'https://www.npmjs.com/package/commitshow',
              },
              {
                tag:    'CI',
                title:  'GitHub Action',
                body:   'Sticky PR comment with score + delta on every pull request. Already on GitHub Marketplace.',
                action: 'commit-show-audit ↗',
                href:   'https://github.com/marketplace/actions/commit-show-audit',
              },
              {
                tag:    'MCP',
                title:  'Claude · Cursor · Cline',
                body:   'Three-line config and the audit engine becomes a tool the host model can call mid-conversation.',
                action: 'commitshow-mcp on npm ↗',
                href:   'https://www.npmjs.com/package/commitshow-mcp',
              },
            ].map(({ tag, title, body, action, href }) => (
              <a key={tag} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                 className="card-navy p-5 transition-all hover:border-gold-500/30"
                 style={{ textDecoration: 'none', display: 'block' }}>
                <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-2" style={{ color: 'var(--gold-500)' }}>{tag}</div>
                <div className="font-display font-bold text-base mb-2" style={{ color: 'var(--cream)' }}>{title}</div>
                <div className="text-[12.5px] font-light mb-3" style={{ color: 'rgba(248,245,238,0.55)', lineHeight: 1.55 }}>{body}</div>
                <div className="font-mono text-[11px]" style={{ color: 'var(--gold-500)' }}>{action}</div>
              </a>
            ))}
          </div>
          <div className="mt-6 font-mono text-[11px]" style={{ color: 'rgba(248,245,238,0.35)' }}>
            Listed on the official <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.commitshow/audit" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-500)' }}>Anthropic MCP Registry</a> as <code style={{ color: 'var(--cream)' }}>io.github.commitshow/audit</code>.
          </div>
        </div>
      </section>

      {/* ── GRADES ── */}
      <section id="grades" className="relative z-10 py-24 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>// CREATOR GRADES</div>
          <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4">Earn your grade</h2>
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
