// AuditShowcase · §15-E.6 · proof section on the main landing page.
//
// Why this exists: HeroTerminal cycles ONE audit at a time as a marquee.
// AuditShowcase is the static scan-friendly counterpart — a 6-card grid
// of recent real audits across the three lanes (member full audit · CLI
// repo walk-on · URL fast lane) so visitors can see "the engine actually
// runs on real projects, here are the receipts".
//
// Cards click through to:
//   · platform / walk_on  → /projects/<id>      (own project detail)
//   · url_fast_lane       → external live_url   (no detail page · partial)
//
// Constraints:
//   · §4 design system (navy + gold · Playfair display · DM Mono labels ·
//     2px border-radius · no emoji · no trailing period on headings)
//   · prefers-reduced-motion safe (no animation here · static grid)
//   · empty pool fallback: hide section entirely (no shell with empty cards)

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRecentAuditDemos, type AuditDemo } from '../lib/recentAudits'

const SHOWCASE_LIMIT = 6   // grid · 3 cols × 2 rows on desktop · 2 cols × 3 rows on tablet · 1 col stacked on mobile

interface SourceMeta {
  label:        string
  badge:        string
  badgeBg:      string
  badgeColor:   string
}
const SOURCE_META: Record<AuditDemo['source'], SourceMeta> = {
  platform: {
    label:      'AUDITION',
    badge:      'Audition',
    badgeBg:    'rgba(240,192,64,0.12)',
    badgeColor: 'var(--gold-500)',
  },
  walk_on: {
    label:      'WALK-ON · CLI',
    badge:      'Walk-on',
    badgeBg:    'rgba(248,245,238,0.06)',
    badgeColor: 'var(--cream)',
  },
  url_fast_lane: {
    label:      'URL FAST LANE',
    badge:      'URL audit',
    badgeBg:    'rgba(0,212,170,0.10)',
    badgeColor: '#00D4AA',
  },
}

export function AuditShowcase() {
  const [demos, setDemos] = useState<AuditDemo[] | null>(null)

  useEffect(() => {
    let live = true
    fetchRecentAuditDemos().then(d => {
      if (!live) return
      // Pick a varied mix · prefer 1-2 of each source if available, then
      // top-up with whatever's most recent. Order = display order.
      setDemos(pickVariedMix(d, SHOWCASE_LIMIT))
    }).catch(() => { /* silent · empty pool falls through to no-render */ })
    return () => { live = false }
  }, [])

  if (!demos || demos.length === 0) return null   // hide section if no real audits to show

  return (
    <section
      className="relative z-10 py-20 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40"
      style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // RECENT AUDITS · ENGINE RECEIPTS
        </div>
        <h2 className="font-display font-black text-3xl sm:text-4xl md:text-5xl mb-4 leading-tight" style={{ color: 'var(--cream)' }}>
          See the engine on real projects
        </h2>
        <p className="font-light max-w-2xl mb-12" style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.55 }}>
          Every card below is a real audit run by the engine. Auditioned member
          products · CLI walk-ons · URL fast-lane probes — all three lanes,
          today's results. Click through to the report.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {demos.map(d => <AuditCard key={d.projectId} demo={d} />)}
        </div>
      </div>
    </section>
  )
}

function pickVariedMix(pool: AuditDemo[], limit: number): AuditDemo[] {
  // Round-robin across source buckets so the showcase reads as 3-lane
  // proof rather than just-one-lane. Falls back to whatever's available
  // when a bucket runs out.
  const buckets: Record<AuditDemo['source'], AuditDemo[]> = {
    platform: [], walk_on: [], url_fast_lane: [],
  }
  for (const d of pool) buckets[d.source].push(d)
  const out: AuditDemo[] = []
  let i = 0
  while (out.length < limit) {
    const order: Array<AuditDemo['source']> = ['platform', 'walk_on', 'url_fast_lane']
    let picked = false
    for (const src of order) {
      if (buckets[src][i]) { out.push(buckets[src][i]); picked = true }
      if (out.length >= limit) break
    }
    if (!picked) break
    i++
  }
  return out
}

interface AuditCardProps { demo: AuditDemo }

function AuditCard({ demo }: AuditCardProps) {
  const meta = SOURCE_META[demo.source]
  const scoreColor =
    demo.band === 'strong' ? 'var(--gold-500)'
    : demo.band === 'mid'  ? 'var(--cream)'
    :                        'var(--scarlet)'

  // Click target: own surface (platform / walk_on) → /projects/:id ·
  // url_fast_lane has no member-quality detail page, link to the live
  // site itself with rel="noopener" since it's external + un-vetted.
  const isExternal = demo.source === 'url_fast_lane'
  const href       = isExternal ? (demo.liveUrl ?? '#') : `/projects/${demo.projectId}`

  const inner = (
    <div className="h-full p-5 flex flex-col" style={{
      background: 'rgba(15,32,64,0.45)',
      border: '1px solid rgba(248,245,238,0.10)',
      borderRadius: '2px',
      transition: 'border-color 180ms ease',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(248,245,238,0.10)')}
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className="inline-block px-2 py-1 font-mono text-[10px] tracking-widest"
          style={{
            background: meta.badgeBg,
            color: meta.badgeColor,
            border: `1px solid ${meta.badgeColor}`,
            borderRadius: '2px',
          }}
        >
          {meta.label}
        </span>
        <div className="text-right">
          <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>SCORE</div>
          <div className="font-display font-black" style={{ color: scoreColor, fontSize: '1.75rem', lineHeight: 1 }}>
            {Math.round(demo.score)}<span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>/100</span>
          </div>
        </div>
      </div>

      <div className="font-display font-bold text-lg leading-tight mb-1 truncate" style={{ color: 'var(--cream)' }}>
        {demo.projectName}
      </div>
      <div className="font-mono text-xs mb-4 truncate" style={{ color: 'var(--text-muted)' }}>
        {demo.slug}
      </div>

      <ul className="space-y-1.5 text-sm flex-1" style={{ color: 'var(--cream)', lineHeight: 1.45 }}>
        {demo.strengths[0] && (
          <li>
            <span style={{ color: 'var(--gold-500)' }}>↑ </span>
            <span style={{ color: 'var(--text-primary)' }}>{shorten(demo.strengths[0], 100)}</span>
          </li>
        )}
        {demo.concerns[0] && (
          <li>
            <span style={{ color: 'var(--scarlet)' }}>↓ </span>
            <span style={{ color: 'var(--text-secondary)' }}>{shorten(demo.concerns[0], 100)}</span>
          </li>
        )}
      </ul>
    </div>
  )

  if (isExternal && demo.liveUrl) {
    return (
      <a
        href={demo.liveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-500"
        style={{ textDecoration: 'none' }}
      >
        {inner}
      </a>
    )
  }
  return (
    <Link to={href} className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-500" style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}
