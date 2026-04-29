// §11-NEW · Ladder · permanent category leaderboard.
//
// URL: /ladder?cat=saas&window=week
// Reads ladder_rankings_mv. Shows 6 categories × 4 time windows. While
// Migration A is unapplied, the MV is missing and the lib gracefully
// returns []; this page renders an empty state instead of throwing.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  LADDER_CATEGORIES,
  LADDER_CATEGORY_LABELS,
  LADDER_WINDOW_LABELS,
  type LadderCategory,
  type LadderWindow,
} from '../lib/supabase'
import { fetchLadder, fetchLadderCounts, type LadderRow } from '../lib/ladder'

const WINDOWS: LadderWindow[] = ['today', 'week', 'month', 'all_time']

function isCategory(v: string | null): v is LadderCategory {
  return !!v && (LADDER_CATEGORIES as readonly string[]).includes(v)
}

function isWindow(v: string | null): v is LadderWindow {
  return !!v && (WINDOWS as readonly string[]).includes(v)
}

export function LadderPage() {
  const navigate    = useNavigate()
  const [params, setParams] = useSearchParams()

  const category: LadderCategory = isCategory(params.get('cat'))    ? params.get('cat') as LadderCategory : 'saas'
  const window:   LadderWindow   = isWindow(params.get('window'))   ? params.get('window') as LadderWindow : 'week'

  const [rows,   setRows]   = useState<LadderRow[]>([])
  const [counts, setCounts] = useState<Record<LadderCategory, number>>({
    saas: 0, tool: 0, ai_agent: 0, game: 0, library: 0, other: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchLadder(category, window, 50),
      fetchLadderCounts(window),
    ]).then(([rows, counts]) => {
      if (!alive) return
      setRows(rows)
      setCounts(counts)
      setLoading(false)
    })
    return () => { alive = false }
  }, [category, window])

  const updateParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    setParams(next, { replace: true })
  }

  const hint = useMemo(() => {
    if (loading)            return 'Loading ladder…'
    if (rows.length === 0)  return 'No projects ranked in this window yet. Try All time, or switch category.'
    return `${rows.length} ranked · ${LADDER_WINDOW_LABELS[window]}`
  }, [loading, rows.length, window])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // LADDER
          </div>
          <h1 className="font-display font-bold text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
            Every audited project, ranked
          </h1>
          <p className="font-light text-sm md:text-base max-w-2xl" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
            Six categories. Four time windows. Live ranking updates the moment any audit finishes.
            Tiebreakers: score → last audit → audit pillar → fewest audits used → first registered.
          </p>
        </header>

        {/* ── Time window toggle ── */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          {WINDOWS.map(w => {
            const active = w === window
            return (
              <button
                key={w}
                type="button"
                onClick={() => updateParam('window', w)}
                className="font-mono text-[11px] tracking-wide px-3 py-1.5"
                style={{
                  background:  active ? 'var(--gold-500)' : 'transparent',
                  color:       active ? 'var(--navy-900)' : 'var(--text-secondary)',
                  border:      `1px solid ${active ? 'var(--gold-500)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: '2px',
                  cursor:      'pointer',
                }}
              >
                {LADDER_WINDOW_LABELS[w]}
              </button>
            )
          })}
        </div>

        {/* ── Category chip strip ── */}
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          {LADDER_CATEGORIES.map(c => {
            const active = c === category
            return (
              <button
                key={c}
                type="button"
                onClick={() => updateParam('cat', c)}
                className="font-mono text-[11px] tracking-wide px-3 py-1.5 inline-flex items-center gap-2"
                style={{
                  background:  active ? 'rgba(240,192,64,0.12)' : 'transparent',
                  color:       active ? 'var(--gold-500)' : 'var(--text-primary)',
                  border:      `1px solid ${active ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  cursor:      'pointer',
                }}
              >
                {LADDER_CATEGORY_LABELS[c]}
                <span className="tabular-nums" style={{ color: active ? 'var(--gold-500)' : 'var(--text-muted)' }}>
                  {counts[c] ?? 0}
                </span>
              </button>
            )
          })}
        </div>

        <div className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>

        {/* ── Rankings table ── */}
        <div className="card-navy" style={{ borderRadius: '2px', overflow: 'hidden' }}>
          {loading ? (
            <div className="px-5 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              loading rankings…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState category={category} window={window} />
          ) : (
            <ol className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              {rows.map(r => (
                <LadderRowItem key={r.project_id} row={r} onOpen={() => navigate(`/projects/${r.project_id}`)} />
              ))}
            </ol>
          )}
        </div>

        <p className="mt-6 font-mono text-[11px]" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Today/Week refresh every 5 minutes · Month/All time every hour. Your own project
          updates instantly when you audit. <span style={{ color: 'var(--gold-500)' }}>commit.show/rulebook</span> explains the score.
        </p>
      </div>
    </section>
  )
}

function LadderRowItem({ row, onOpen }: { row: LadderRow; onOpen: () => void }) {
  const rankTone = row.rank === 1 ? 'var(--gold-500)' : row.rank <= 10 ? 'var(--cream)' : 'var(--text-secondary)'
  const audited  = row.audited_at ? new Date(row.audited_at) : null
  const ago      = audited ? formatAgo(audited) : '—'

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-4 md:px-5 py-3 flex items-center gap-4 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,192,64,0.04)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="font-mono font-medium tabular-nums text-base flex-shrink-0 text-center" style={{ color: rankTone, width: 36 }}>
          {row.rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-base truncate" style={{ color: 'var(--cream)' }}>
            {row.project_name}
          </div>
          <div className="font-mono text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
            {row.creator_name && <span>by {row.creator_name}</span>}
            <span>·</span>
            <span>{ago}</span>
            <span>·</span>
            <span>{row.audit_count} audit{row.audit_count === 1 ? '' : 's'}</span>
            {row.status === 'graduated' && <>
              <span>·</span>
              <span style={{ color: '#00D4AA' }}>graduated</span>
            </>}
          </div>
        </div>
        <div className="flex-shrink-0 flex items-baseline gap-1">
          <span className="font-display font-bold text-2xl tabular-nums" style={{ color: 'var(--gold-500)' }}>
            {row.score_total}
          </span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/100</span>
        </div>
      </button>
    </li>
  )
}

function EmptyState({ category, window }: { category: LadderCategory; window: LadderWindow }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>
        Nothing ranked in {LADDER_CATEGORY_LABELS[category]} for {LADDER_WINDOW_LABELS[window].toLowerCase()}
      </div>
      <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
        Either no project has been audited in this window, or the ladder is still warming up.
        Try a wider time window or a different category.
      </p>
    </div>
  )
}

function formatAgo(d: Date): string {
  const ms = Date.now() - d.getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)    return 'just now'
  if (min < 60)   return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)    return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30)   return `${day}d ago`
  const mo = Math.floor(day / 30)
  return `${mo}mo ago`
}
