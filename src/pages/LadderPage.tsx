// §11-NEW · Ladder · permanent category leaderboard.
//
// URL: /ladder?cat=saas&window=week&view=list
// Reads ladder_rankings_mv. Shows 6 categories × 4 time windows.
//
// 2026-04-30 · merged with /projects per "single surface" decision.
// Two view modes:
//   list  · ranked rows (default · v3 marquee identity)
//   cards · editorial grid (browse / discover feel · was /projects)
// Both views read the same MV-ranked data so switching is instant.

import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LADDER_CATEGORIES,
  LADDER_CATEGORY_LABELS,
  LADDER_WINDOW_LABELS,
  type LadderCategory,
  type LadderWindow,
  type Project,
} from '../lib/supabase'
import {
  fetchLadder, fetchLadderCounts, fetchLadderProjects,
  getCachedLadder, getCachedLadderProjects, getCachedCounts,
  type LadderRow,
} from '../lib/ladder'
import { fetchCreatorsByIds, fetchApplaudCounts, type CreatorIdentity } from '../lib/projectQueries'
import { ProjectCardEditorial } from '../components/ProjectCardEditorial'
import { FeaturedLanes } from '../components/FeaturedLanes'
import { useAuth } from '../lib/auth'

const WINDOWS: LadderWindow[] = ['today', 'week', 'month', 'all_time']
type ViewMode = 'list' | 'cards'

function isCategory(v: string | null): v is LadderCategory {
  return !!v && (LADDER_CATEGORIES as readonly string[]).includes(v)
}
function isWindow(v: string | null): v is LadderWindow {
  return !!v && (WINDOWS as readonly string[]).includes(v)
}
function isView(v: string | null): v is ViewMode {
  return v === 'list' || v === 'cards'
}

export function LadderPage() {
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const [params, setParams] = useSearchParams()

  const category: LadderCategory = isCategory(params.get('cat'))    ? params.get('cat') as LadderCategory : 'productivity_personal'
  const window:   LadderWindow   = isWindow(params.get('window'))   ? params.get('window') as LadderWindow : 'week'
  const view:     ViewMode       = isView(params.get('view'))       ? params.get('view') as ViewMode : 'list'

  // List-mode state
  const [rows,   setRows]   = useState<LadderRow[]>([])
  // Cards-mode state
  const [cardRows, setCardRows] = useState<Array<{ project: Project; rank: number }>>([])
  const [creators, setCreators] = useState<Record<string, CreatorIdentity>>({})
  const [applauds, setApplauds] = useState<Record<string, number>>({})

  const [counts, setCounts] = useState<Record<LadderCategory, number>>({
    productivity_personal: 0,
    niche_saas:            0,
    creator_media:         0,
    dev_tools:             0,
    ai_agents_chat:        0,
    consumer_lifestyle:    0,
    games_playful:         0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    // SWR-style: paint cached data immediately if fresh, then always
    // refetch in the background. invalidateLadderCache() (called from
    // /admin re-audit success) wipes both maps so the next mount goes
    // straight to network.
    const cachedCounts = getCachedCounts(window)
    if (cachedCounts) setCounts(cachedCounts)

    if (view === 'cards') {
      const cachedCards = getCachedLadderProjects(category, window)
      if (cachedCards) {
        setCardRows(cachedCards)
        setLoading(false)
      } else {
        setLoading(true)
      }
    } else {
      const cachedRows = getCachedLadder(category, window)
      if (cachedRows) {
        setRows(cachedRows)
        setLoading(false)
      } else {
        setLoading(true)
      }
    }

    const dataPromise = view === 'cards'
      ? fetchLadderProjects(category, window, 50)
      : fetchLadder(category, window, 50)

    Promise.all([dataPromise, fetchLadderCounts(window)]).then(async ([data, counts]) => {
      if (!alive) return
      setCounts(counts)
      if (view === 'cards') {
        const cards = data as Array<{ project: Project; rank: number }>
        setCardRows(cards)
        // Hydrate creators + applauds for editorial cards
        const creatorIds = cards.map(c => c.project.creator_id).filter((x): x is string => !!x)
        const projectIds = cards.map(c => c.project.id)
        const [creatorMap, applaudMap] = await Promise.all([
          fetchCreatorsByIds(creatorIds),
          fetchApplaudCounts(projectIds),
        ])
        if (!alive) return
        setCreators(creatorMap)
        setApplauds(applaudMap)
      } else {
        setRows(data as LadderRow[])
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [category, window, view])

  const updateParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    setParams(next, { replace: true })
  }

  const totalShown = view === 'cards' ? cardRows.length : rows.length
  const hint = useMemo(() => {
    if (loading)            return 'Loading ladder…'
    if (totalShown === 0)   return 'No projects ranked in this window yet. Try All time, or switch category.'
    return `${totalShown} ranked · ${LADDER_WINDOW_LABELS[window]}`
  }, [loading, totalShown, window])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
              // LADDER
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
              Every audited project, ranked
            </h1>
            <p className="font-light text-sm md:text-base max-w-2xl" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              Six categories. Four time windows. Live ranking updates the moment any audit finishes.
            </p>
          </div>
          {!user && (
            <NavLink
              to="/submit"
              className="font-mono text-xs font-medium tracking-wide px-4 py-2 whitespace-nowrap self-start md:self-auto"
              style={{
                background: 'var(--gold-500)', color: 'var(--navy-900)',
                border: 'none', borderRadius: '2px', textDecoration: 'none',
              }}
            >
              AUDIT YOUR BUILD →
            </NavLink>
          )}
        </header>

        {/* ── Spotlight (lanes from old /projects) ── */}
        <div className="mb-8">
          <FeaturedLanes />
        </div>

        {/* ── Time window + view toggle ── */}
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
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

          {/* View toggle · list ↔ cards */}
          <div className="flex items-center" style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '2px',
            background: 'rgba(6,12,26,0.5)',
          }}>
            {(['list', 'cards'] as ViewMode[]).map(v => {
              const active = v === view
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => updateParam('view', v)}
                  className="font-mono text-[10px] tracking-widest px-3 py-1.5"
                  style={{
                    background: active ? 'var(--gold-500)' : 'transparent',
                    color:      active ? 'var(--navy-900)' : 'var(--text-secondary)',
                    border:     'none',
                    cursor:     'pointer',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {v === 'list' ? 'RANK LIST' : 'CARDS'}
                </button>
              )
            })}
          </div>
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

        {/* ── List view (rank-first) ── */}
        {view === 'list' && (
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
        )}

        {/* ── Cards view (editorial grid · was /projects) ── */}
        {view === 'cards' && (
          loading ? (
            <div className="card-navy px-5 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
              loading cards…
            </div>
          ) : cardRows.length === 0 ? (
            <div className="card-navy" style={{ borderRadius: '2px' }}>
              <EmptyState category={category} window={window} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
              {cardRows.map(({ project, rank }) => (
                <ProjectCardEditorial
                  key={project.id}
                  project={project}
                  creator={project.creator_id ? creators[project.creator_id] : undefined}
                  applaudCount={applauds[project.id] ?? 0}
                  categoryRank={rank}
                />
              ))}
            </div>
          )
        )}

        <p className="mt-6 font-mono text-[11px]" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Today/Week refresh every 5 minutes · Month/All time every hour. Your own project
          updates instantly when you audit. <NavLink to="/rulebook" style={{ color: 'var(--gold-500)' }}>commit.show/rulebook</NavLink> explains the score.
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
        className="w-full px-4 md:px-5 py-3 flex items-center gap-3 md:gap-4 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,192,64,0.04)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="font-mono font-medium tabular-nums text-base flex-shrink-0 text-center" style={{ color: rankTone, width: 28 }}>
          {row.rank}
        </div>
        {/* Thumbnail · 16:9 mini · falls back to a faint mono initial when absent */}
        <div className="flex-shrink-0 overflow-hidden" style={{
          width: 64, height: 36, background: 'var(--navy-800)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px',
        }}>
          {row.thumbnail_url ? (
            <img src={row.thumbnail_url} alt="" loading="lazy" className="w-full h-full" style={{ objectFit: 'cover' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
              {(row.project_name || '·').slice(0, 1).toUpperCase()}
            </div>
          )}
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
