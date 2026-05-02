// "This week in Commit" — Top 3 projects by absolute audit delta in the
// last 7 days. Reads analysis_snapshots since cutoff, keeps the largest
// delta per project, joins project row for name / thumbnail.
//
// Landing mount point only. One bright, glanceable row — the 3-minute
// digest hook per CLAUDE.md §16.2 (P6).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface TopMover {
  projectId:     string
  projectName:   string
  thumbnailUrl:  string | null
  currentScore:  number
  delta:         number
  when:          string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function ThisWeekHighlight() {
  const [movers, setMovers] = useState<TopMover[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
      // Pull every snapshot in the last 7 days that carries a non-zero delta.
      // A single project can snapshot multiple times in the window — we keep
      // only the biggest |delta| per project and take the top 3 after that.
      const { data } = await supabase
        .from('analysis_snapshots')
        .select(`
          project_id, created_at, score_total, score_total_delta,
          project:projects!analysis_snapshots_project_id_fkey(id, project_name, thumbnail_url, status)
        `)
        .gte('created_at', since)
        .not('score_total_delta', 'is', null)
        .neq('score_total_delta', 0)
        .order('created_at', { ascending: false })

      if (cancelled) return

      const bestByProject = new Map<string, TopMover>()
      ;(data ?? []).forEach((row: unknown) => {
        const r = row as {
          project_id:        string
          created_at:        string
          score_total:       number
          score_total_delta: number
          project:           { id: string; project_name: string; thumbnail_url: string | null; status: string | null } | Array<{ id: string; project_name: string; thumbnail_url: string | null; status: string | null }>
        }
        const proj = Array.isArray(r.project) ? r.project[0] : r.project
        if (!proj) return
        // Skip CLI preview shadows · they didn't enter the season, so they
        // shouldn't sit at the top of "this week's movers" on the landing.
        if (proj.status === 'preview') return
        const mover: TopMover = {
          projectId:    r.project_id,
          projectName:  proj.project_name,
          thumbnailUrl: proj.thumbnail_url,
          currentScore: r.score_total,
          delta:        r.score_total_delta,
          when:         r.created_at,
        }
        const prev = bestByProject.get(r.project_id)
        if (!prev || Math.abs(mover.delta) > Math.abs(prev.delta)) {
          bestByProject.set(r.project_id, mover)
        }
      })

      const top = Array.from(bestByProject.values())
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3)

      setMovers(top)
    })().catch(err => {
      if (!cancelled) { console.error('[ThisWeekHighlight]', err); setMovers([]) }
    })
    return () => { cancelled = true }
  }, [])

  if (movers === null) return null      // quiet skeleton · no layout jump
  if (movers.length === 0) return null  // hide entirely when nothing moved

  return (
    <section className="relative z-10 px-6 md:px-10 lg:px-24 xl:px-32 2xl:px-40 py-12" style={{ borderTop: '1px solid rgba(240,192,64,0.08)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
          // THIS WEEK IN COMMIT
        </div>
        <h2 className="font-display font-black text-3xl md:text-4xl leading-tight mb-2" style={{ color: 'var(--cream)' }}>
          Top movers this week
        </h2>
        <p className="font-light max-w-lg mb-6" style={{ color: 'var(--text-secondary)' }}>
          The three products whose audit score shifted the most in the last 7 days.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {movers.map((m, i) => <MoverCard key={m.projectId} rank={i + 1} mover={m} />)}
        </div>
      </div>
    </section>
  )
}

function MoverCard({ rank, mover }: { rank: number; mover: TopMover }) {
  const positive = mover.delta > 0
  const tone = positive ? '#00D4AA' : '#F88771'
  const sign = positive ? '+' : ''

  return (
    <Link
      to={`/projects/${mover.projectId}`}
      className="card-navy overflow-hidden transition-all"
      style={{
        borderRadius: '2px',
        borderLeft: `3px solid ${tone}`,
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 12px 32px -16px rgba(240,192,64,0.3)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = ''
      }}
    >
      {mover.thumbnailUrl && (
        <div style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)', overflow: 'hidden' }}>
          <img
            src={mover.thumbnailUrl}
            alt=""
            loading="lazy"
            className="w-full h-full"
            style={{ objectFit: 'cover' }}
          />
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span
            className="font-mono text-[10px] tracking-widest uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            #{rank} mover
          </span>
          <span
            className="font-mono text-[11px] tracking-wide px-1.5 py-0.5 tabular-nums"
            style={{
              background: `${tone}1C`,
              color: tone,
              border: `1px solid ${tone}55`,
              borderRadius: '2px',
            }}
          >
            {sign}{mover.delta}
          </span>
        </div>
        <h3 className="font-display font-bold text-base leading-tight mb-2 truncate" style={{ color: 'var(--cream)' }}>
          {mover.projectName}
        </h3>
        <div className="mt-auto flex items-baseline justify-between font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span>now <strong style={{ color: 'var(--cream)' }}>{mover.currentScore}</strong> / 100</span>
          <span style={{ color: 'var(--text-muted)' }}>{formatRelative(mover.when)}</span>
        </div>
      </div>
    </Link>
  )
}

function formatRelative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600)       return `${Math.floor(s / 60)}m ago`
  if (s < 86400)      return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
