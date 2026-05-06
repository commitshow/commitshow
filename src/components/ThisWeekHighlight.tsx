// "This week in Commit" — Top 3 projects by 7-day BOOKEND delta
// (latest snapshot − earliest snapshot inside the window). The bookend
// view rewards cumulative climb (47→52→60→89 reads as +42, not +29)
// which is the bragging artifact creators actually share to X /
// LinkedIn — pairs with the trajectory share card (§18-B.4).
//
// Earlier version walked single-snapshot deltas client-side and
// surfaced regressions too. Switched to top_movers_week RPC
// (positive-only · service-side) so the landing strip becomes
// the "biggest climbs" view without negative shocks.
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
  startScore:    number
  delta:         number
  when:          string
  snapshots:     number
}

export function ThisWeekHighlight() {
  const [movers, setMovers] = useState<TopMover[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('top_movers_week', {
        p_window_days: 7,
        p_limit:       3,
      })
      if (cancelled) return
      if (error) { console.error('[ThisWeekHighlight] rpc', error); setMovers([]); return }
      const rows = (data ?? []) as Array<{
        project_id:   string
        project_name: string
        start_score:  number
        end_score:    number
        delta:        number
        snapshots:    number
        end_at:       string
      }>

      // Hydrate thumbnails — RPC is lean (no joins) so we fetch
      // thumbnail_url separately. Cheap: at most 3 ids.
      let thumbs: Record<string, string | null> = {}
      if (rows.length > 0) {
        const ids = rows.map(r => r.project_id)
        const { data: tdata } = await supabase
          .from('projects')
          .select('id, thumbnail_url')
          .in('id', ids)
        if (cancelled) return
        thumbs = Object.fromEntries((tdata ?? []).map((t: { id: string; thumbnail_url: string | null }) => [t.id, t.thumbnail_url]))
      }

      const top: TopMover[] = rows.map(r => ({
        projectId:    r.project_id,
        projectName:  r.project_name,
        thumbnailUrl: thumbs[r.project_id] ?? null,
        currentScore: r.end_score,
        startScore:   r.start_score,
        delta:        r.delta,
        when:         r.end_at,
        snapshots:    r.snapshots,
      }))
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
          The three biggest audit climbs over the last 7 days · start to current.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {movers.map((m, i) => <MoverCard key={m.projectId} rank={i + 1} mover={m} />)}
        </div>
      </div>
    </section>
  )
}

function MoverCard({ rank, mover }: { rank: number; mover: TopMover }) {
  // RPC only returns positive movers (climbs) — no need to render a
  // regression branch.
  const tone = '#00D4AA'
  const sign = '+'

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
          <span className="tabular-nums">
            <span style={{ color: 'var(--text-muted)' }}>{mover.startScore}</span>
            <span style={{ color: 'var(--text-muted)' }}> → </span>
            <strong style={{ color: 'var(--cream)' }}>{mover.currentScore}</strong>
            <span style={{ color: 'var(--text-muted)' }}> / 100</span>
          </span>
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
