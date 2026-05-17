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
import { fetchCreatorsByIds, fetchApplaudCounts, fetchMemberStageBuckets, type CreatorIdentity, type MemberStageBuckets } from '../lib/projectQueries'
import { StageBadge } from '../components/StageBadge'
import { ProjectCardEditorial } from '../components/ProjectCardEditorial'
import { FeaturedLanes } from '../components/FeaturedLanes'
import { useAuth } from '../lib/auth'
import { useViewer } from '../lib/useViewer'
import { scoreBand, bandLabel, bandTone, viewerCanSeeDigitOnList } from '../lib/laneScore'

const WINDOWS: LadderWindow[] = ['today', 'week', 'month', 'all_time']
type ViewMode = 'list' | 'cards'
type CatFilter = LadderCategory | 'all'

function isCategoryFilter(v: string | null): v is CatFilter {
  return v === 'all' || (!!v && (LADDER_CATEGORIES as readonly string[]).includes(v))
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

  // Stage buckets for the dynamic header (2026-05-17). Same data the
  // Hero CTA picker uses · here it drives the eyebrow + title + CTA so
  // a returning member sees "Your journey · N backstage · …" instead of
  // the visitor-default "Every audited product, ranked" with a fresh-
  // audit CTA. Fired once on mount when authenticated; anon stays on
  // the default copy.
  const [buckets, setBuckets] = useState<MemberStageBuckets | null>(null)
  useEffect(() => {
    if (!user?.id) { setBuckets(null); return }
    let alive = true
    fetchMemberStageBuckets(user.id).then(b => { if (alive) setBuckets(b) })
    return () => { alive = false }
  }, [user?.id])
  const headerCopy = useMemo(() => pickProductsHeader(user, buckets), [user, buckets])

  const category: CatFilter      = isCategoryFilter(params.get('cat')) ? params.get('cat') as CatFilter : 'all'
  const window:   LadderWindow   = isWindow(params.get('window'))   ? params.get('window') as LadderWindow : 'week'
  const view:     ViewMode       = isView(params.get('view'))       ? params.get('view') as ViewMode : 'list'
  // form_factor filter UI removed 2026-05-12 · form is internal B2B
  // analytics now (still drives audit rubric slot semantics server-side).

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
              {headerCopy.eyebrow}
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl mb-3" style={{ color: 'var(--cream)' }}>
              {headerCopy.title}
            </h1>
            <p className="font-light text-sm md:text-base max-w-2xl" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {headerCopy.sub}
            </p>
            {/* Stage-buckets chip strip · same data as Hero, repeated
                here so /products lands a returning user with their
                journey already named. Anon + zero-bucket members see
                nothing extra. Each chip deep-links to /me. */}
            {buckets && (buckets.backstage > 0 || buckets.onStage > 0 || buckets.encore > 0) && (
              <div className="mt-4 flex gap-2 flex-wrap font-mono text-[10px] tracking-widest">
                {buckets.backstage > 0 && (
                  <NavLink to="/me" className="px-2 py-1 transition-colors no-underline" style={{ background: 'rgba(248,245,238,0.06)', color: 'var(--cream)', border: '1px solid rgba(248,245,238,0.18)', borderRadius: '2px' }}>
                    {buckets.backstage} BACKSTAGE
                  </NavLink>
                )}
                {buckets.onStage > 0 && (
                  <NavLink to="/me" className="px-2 py-1 transition-colors no-underline" style={{ background: 'rgba(0,212,170,0.08)', color: '#00D4AA', border: '1px solid rgba(0,212,170,0.25)', borderRadius: '2px' }}>
                    {buckets.onStage} ON STAGE
                  </NavLink>
                )}
                {buckets.encore > 0 && (
                  <NavLink to="/me" className="px-2 py-1 transition-colors no-underline" style={{ background: 'rgba(240,192,64,0.10)', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.35)', borderRadius: '2px' }}>
                    {buckets.encore} ENCORE
                  </NavLink>
                )}
              </div>
            )}
          </div>
          {/* CTA · state-aware (2026-05-17). Anon + zero-bucket members
              see the "analyze / audition" funnel (same as before).
              Members with backstage rows see "Continue in Backstage" so
              the journey is one click from /products too. The fresh-
              audit funnel is always reachable via the BACKSTAGE lane
              CTA below ("How a backstage audition works →") + the
              ON STAGE lane footer ("Audition your project →"). */}
          <NavLink
            to={headerCopy.ctaTo}
            className="font-mono text-xs font-medium tracking-wide px-4 py-2 whitespace-nowrap self-start md:self-auto"
            style={{
              background: 'var(--gold-500)', color: 'var(--navy-900)',
              border: 'none', borderRadius: '2px', textDecoration: 'none',
            }}
          >
            {headerCopy.ctaLabel}
          </NavLink>
        </header>

        {/* ── Spotlight (lanes from old /projects) ── */}
        <div className="mb-8">
          <FeaturedLanes />
        </div>

        {/* ── Time window strip ── */}
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

        {/* ── Category chip strip · 'All' is the default + always-leftmost ──
              Mobile: horizontal scroll (chips never wrap, full row stays browseable
              with one swipe). ≥sm: wrap onto multiple lines as before. */}
        <div
          className="mb-6 flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0"
          style={{ scrollbarWidth: 'none' }}
        >
          {([
            { value: 'all' as const,           label: 'All' },
            ...LADDER_CATEGORIES.map(c => ({ value: c, label: LADDER_CATEGORY_LABELS[c] })),
          ]).map(c => {
            const active = c.value === category
            const total  = c.value === 'all'
              ? Object.values(counts).reduce((s, n) => s + n, 0)
              : (counts[c.value as LadderCategory] ?? 0)
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => updateParam('cat', c.value)}
                className="font-mono text-[11px] tracking-wide px-3 py-1.5 inline-flex items-center gap-2 shrink-0"
                style={{
                  background:  active ? 'rgba(240,192,64,0.12)' : 'transparent',
                  color:       active ? 'var(--gold-500)' : 'var(--text-primary)',
                  border:      `1px solid ${active ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  cursor:      'pointer',
                }}
              >
                {c.label}
                <span className="tabular-nums" style={{ color: active ? 'var(--gold-500)' : 'var(--text-muted)' }}>
                  {total}
                </span>
              </button>
            )
          })}
        </div>

        {/* Form-factor filter UI removed 2026-05-12 · form_factor stays as
            internal B2B / partnership taxonomy (also drives auditor rubric
            slot semantics) but is no longer shown to ladder visitors. */}

        {/* ── View toggle · sits below the category strip, right-aligned · paired with hint on the left ── */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {hint}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(['list', 'cards'] as ViewMode[]).map((v, i) => {
              const active = v === view
              return (
                <span key={v} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>·</span>}
                  <button
                    type="button"
                    onClick={() => updateParam('view', v)}
                    className="font-mono text-[11px] tracking-wide"
                    style={{
                      background: 'transparent',
                      border:     'none',
                      padding:    0,
                      cursor:     active ? 'default' : 'pointer',
                      color:      active ? 'var(--gold-500)' : 'var(--text-muted)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {v === 'list' ? 'Rank list' : 'Cards'}
                  </button>
                </span>
              )
            })}
            {/* Third option · navigates to /leaderboard rather than swapping
                in-place because the 2D scatter is a different surface
                (different data shape, dedicated controls). Keeping it
                as a peer link in the same toggle preserves discovery
                without redirecting in the URL state. */}
            <span className="flex items-center gap-2">
              <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>·</span>
              <NavLink
                to="/map"
                className="font-mono text-[11px] tracking-wide"
                style={({ isActive }) => ({
                  textDecoration: 'none',
                  color:      isActive ? 'var(--gold-500)' : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 400,
                })}
              >
                Map
              </NavLink>
            </span>
          </div>
        </div>

        {/* ── List view (rank-first) ── */}
        {view === 'list' && (() => {
          const filtered = rows
          return (
          <div className="card-navy" style={{ borderRadius: '2px', overflow: 'hidden' }}>
            {loading ? (
              <div className="px-5 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                loading rankings…
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState category={category} window={window} />
            ) : (
              // Faint per-row border-top (skip first) · Tailwind's divide-y
              // default border color was too bright and the [&>li+li] escape
              // hatch tripped JSX parsing on the '>'.
              <ol>
                {filtered.map((r, i) => (
                  <LadderRowItem
                    key={r.project_id}
                    row={r}
                    isFirst={i === 0}
                    onOpen={() => navigate(`/projects/${r.slug ?? r.project_id}`)}
                  />
                ))}
              </ol>
            )}
          </div>
          )
        })()}

        {/* ── Cards view (editorial grid · was /projects) ── */}
        {view === 'cards' && (() => {
          const filteredCards = cardRows
          return (
          loading ? (
            <div className="card-navy px-5 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
              loading cards…
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="card-navy" style={{ borderRadius: '2px' }}>
              <EmptyState category={category} window={window} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-6">
              {filteredCards.map(({ project, rank }) => (
                <ProjectCardEditorial
                  key={project.id}
                  project={project}
                  creator={project.creator_id ? creators[project.creator_id] : undefined}
                  applaudCount={applauds[project.id] ?? 0}
                  categoryRank={rank}
                />
              ))}
            </div>
          ))
        })()}

        <p className="mt-6 font-mono text-[11px]" style={{ color: 'var(--text-faint)', lineHeight: 1.6 }}>
          Today/Week refresh every 5 minutes · Month/All time every hour. Your own project
          updates instantly when you audit. <NavLink to="/rulebook" style={{ color: 'var(--gold-500)' }}>commit.show/rulebook</NavLink> explains the score.
        </p>
      </div>
    </section>
  )
}

function LadderRowItem({ row, isFirst, onOpen }: { row: LadderRow; isFirst?: boolean; onOpen: () => void }) {
  const rankTone = row.rank === 1 ? 'var(--gold-500)' : row.rank <= 10 ? 'var(--cream)' : 'var(--text-secondary)'
  const audited  = row.audited_at ? new Date(row.audited_at) : null
  const ago      = audited ? formatAgo(audited) : '—'
  // §1-A ⑥ band gate · LadderRow carries enough (creator_id + status +
  // score_total) for viewerCanSeeDigit to decide. Encore-graduated rows
  // reveal digit to everyone regardless of viewer.
  const viewer      = useViewer()
  const canSeeDigit = viewerCanSeeDigitOnList(row, viewer)
  const band        = scoreBand(row.score_total)
  const bandColor   = bandTone(band)

  return (
    <li style={isFirst ? undefined : { borderTop: '1px solid rgba(255,255,255,0.04)' }}>
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
            {(row.status === 'graduated' || row.status === 'valedictorian' || (row.score_total ?? 0) >= 84) && (
              <>
                <span>·</span>
                <StageBadge stage="encore" size="xs" iconless />
              </>
            )}
            <StreakBadge row={row} />
          </div>
        </div>
        <div className="flex-shrink-0 flex items-baseline gap-1">
          {/* §re-audit privacy · round-1 only audits hide the score on
              public listings · reveals on the second analysis. Keeps
              creators from being judged on the unflattering first run. */}
          {(row.audit_count ?? 0) <= 1 ? (
            <span
              className="font-mono text-[11px] tracking-widest"
              style={{ color: 'var(--text-muted)' }}
              title="Score is hidden until the creator re-audits"
            >
              ROUND 1
            </span>
          ) : canSeeDigit ? (
            <>
              <span className="font-display font-bold text-2xl tabular-nums" style={{ color: 'var(--gold-500)' }}>
                {row.score_total}
              </span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/100</span>
            </>
          ) : (
            <span
              className="font-display font-bold text-lg tracking-widest uppercase"
              style={{ color: bandColor }}
              title="Public ladder shows band only · Creator + admin + paid Patron see the digit"
            >
              {bandLabel(band)}
            </span>
          )}
        </div>
      </button>
    </li>
  )
}

// Streak badge · only renders when the project is currently inside the
// Top 50 of the displayed window (`current_top_n` not null) AND the
// streak has lasted at least 2 days. One day in Top 50 is just a hit,
// not a streak — showing it dilutes the badge's signal value.
//
// Tier coloring mirrors the milestone palette so streak + milestone
// chips read as one family on a project's row:
//   Top 1   → gold (var(--gold-500))
//   Top 10  → cream
//   Top 50  → muted teal
function StreakBadge({ row }: { row: LadderRow }) {
  const tier = row.current_top_n
  const days = row.longest_streak_days ?? 0
  if (tier == null || days < 2) return null

  const color =
    tier === 1   ? 'var(--gold-500)' :
    tier <= 10   ? 'var(--cream)' :
                   '#6FA8A0'

  const label =
    tier === 1   ? `🔥 #1 · ${days}d streak` :
    tier <= 10   ? `Top ${tier} · ${days}d streak` :
                   `Top 50 · ${days}d streak`

  return (
    <>
      <span>·</span>
      <span style={{ color }} title={`Best streak: ${days} consecutive days in this tier · ${row.total_days_in_top_50 ?? days} total days in Top 50`}>
        {label}
      </span>
    </>
  )
}

function EmptyState({ category, window }: { category: LadderCategory | 'all'; window: LadderWindow }) {
  const label = category === 'all' ? 'the ladder' : LADDER_CATEGORY_LABELS[category]
  return (
    <div className="px-5 py-12 text-center">
      <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>
        Nothing ranked in {label} for {LADDER_WINDOW_LABELS[window].toLowerCase()}
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

// ── /products header copy picker · stage-aware ──
// Anon and zero-bucket members get the visitor default ("Every audited
// product, ranked"). Members with backstage rows see the journey-aware
// variant so the page lands them on the right next step instead of the
// fresh-audit funnel they don't need.
interface ProductsHeaderCopy {
  eyebrow:  string
  title:    string
  sub:      string
  ctaLabel: string
  ctaTo:    string
}
function pickProductsHeader(user: { id: string } | null | undefined, buckets: MemberStageBuckets | null): ProductsHeaderCopy {
  const DEFAULT: ProductsHeaderCopy = {
    eyebrow:  '// PRODUCTS',
    title:    'Every audited product, ranked',
    sub:      'Seven categories. Four time windows. Score 84+ earns Encore. Live ranking updates the moment any audit finishes.',
    ctaLabel: user ? 'ANALYZE MY MVP →' : 'AUDITION YOUR PROJECT →',
    ctaTo:    '/submit',
  }
  if (!user || !buckets) return DEFAULT
  if (buckets.backstage > 0) {
    const n = buckets.backstage
    return {
      eyebrow:  '// YOUR JOURNEY · PRODUCTS',
      title:    n === 1 ? 'You have 1 audition in backstage' : `You have ${n} auditions in backstage`,
      sub:      'Iterate, re-audit, polish — then put them on stage when they\'re ready. The full ladder below is everyone else who already did.',
      ctaLabel: `CONTINUE BACKSTAGE (${n}) →`,
      ctaTo:    '/me',
    }
  }
  if (buckets.onStage > 0) {
    return {
      eyebrow:  '// YOUR JOURNEY · PRODUCTS',
      title:    'Your projects are on the stage',
      sub:      'Watch where they sit in the ranking · re-audit any one to push the score up · audition another to enter a fresh category.',
      ctaLabel: 'YOUR STANDINGS →',
      ctaTo:    '/me',
    }
  }
  if (buckets.encore > 0) {
    return {
      eyebrow:  '// YOUR JOURNEY · PRODUCTS',
      title:    'You\'ve crossed the Encore line',
      sub:      'The Encore archive is yours · audition your next project to keep the streak going.',
      ctaLabel: 'ANALYZE THE NEXT →',
      ctaTo:    '/submit',
    }
  }
  return DEFAULT
}
