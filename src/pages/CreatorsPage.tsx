// /creators · creator-side leaderboard. Mirror of /scouts but ranks
// members by their CREATOR signals (creator_grade, total_graduated,
// avg_auto_score) rather than scout AP / forecasts.
//
// Same visual shape as ScoutsPage so the two surfaces feel like a
// pair: "judges" on /scouts, "builders" on /creators. Clicking a row
// drops to the same MemberDetailPage (rendered as ScoutDetailPage)
// because one member's activity is one page regardless of which list
// brought you there.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type Member, type CreatorGrade } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const GRADES: CreatorGrade[] = ['Rookie', 'Builder', 'Maker', 'Architect', 'Vibe Engineer', 'Legend']

const GRADE_COLOR: Record<CreatorGrade, string> = {
  Rookie:          '#6B7280',
  Builder:         '#60A5FA',
  Maker:           '#00D4AA',
  Architect:       '#A78BFA',
  'Vibe Engineer': '#F0C040',
  Legend:          '#C8102E',
}

type SortMode = 'encore' | 'best_score' | 'products' | 'newest'

interface CreatorRow extends Member {
  product_count: number
  encore_count:  number
  best_score:    number | null
  avg_score:     number
  total_audits:  number
}

export function CreatorsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<CreatorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [gradeFilter, setGradeFilter] = useState<'any' | CreatorGrade>('any')
  const [sort, setSort] = useState<SortMode>('encore')

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Read from creator_stats view (lateral-joined to projects) so
      // ranking reflects actual product portfolio · not the dormant
      // members.total_graduated / avg_auto_score columns that haven't
      // been touched since the season-end engine was retired.
      const { data } = await supabase
        .from('creator_stats')
        .select('*')
      if (!alive) return
      setRows((data ?? []) as unknown as CreatorRow[])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    let list = rows.slice()
    if (gradeFilter !== 'any') list = list.filter(m => (m.creator_grade ?? 'Rookie') === gradeFilter)
    const cmpAsc = (a: number | null | undefined, b: number | null | undefined) => (a ?? 0) - (b ?? 0)
    switch (sort) {
      case 'encore':
        // Default · most Encore products, then best score, then portfolio
        // size, then earliest member (rewards consistency over recency).
        list.sort((a, b) =>
          (b.encore_count - a.encore_count)
          || cmpAsc(b.best_score, a.best_score)
          || (b.product_count - a.product_count)
          || (a.created_at ?? '').localeCompare(b.created_at ?? '')
        )
        break
      case 'best_score':
        list.sort((a, b) => cmpAsc(b.best_score, a.best_score) || (b.product_count - a.product_count))
        break
      case 'products':
        list.sort((a, b) => (b.product_count - a.product_count) || cmpAsc(b.best_score, a.best_score))
        break
      case 'newest':
        list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        break
    }
    return list
  }, [rows, gradeFilter, sort])

  const gradeCounts = useMemo(() => {
    const c: Record<CreatorGrade, number> = { Rookie: 0, Builder: 0, Maker: 0, Architect: 0, 'Vibe Engineer': 0, Legend: 0 }
    rows.forEach(r => {
      const g = (r.creator_grade ?? 'Rookie') as CreatorGrade
      c[g] = (c[g] ?? 0) + 1
    })
    return c
  }, [rows])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Creators page accent · violet (#A78BFA · "Architect" tone)
            differentiates from Scouts, which uses brand gold. Reads as
            "builders" vs "judges" at a glance. */}
        <header className="mb-5">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: '#A78BFA' }}>// CREATORS</div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
            Who's actually shipping
          </h1>
          <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
            Builders ranked by total Encore-grade products and average audit score. Click a creator for their full activity feed.
          </p>
        </header>

        {/* Grade filter chips */}
        <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <GradeChip label="All" count={rows.length} active={gradeFilter === 'any'} onClick={() => setGradeFilter('any')} color="#A78BFA" />
          {GRADES.map(g => (
            <GradeChip
              key={g}
              label={g}
              count={gradeCounts[g] ?? 0}
              active={gradeFilter === g}
              onClick={() => setGradeFilter(gradeFilter === g ? 'any' : g)}
              color={GRADE_COLOR[g]}
            />
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2 mb-3">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="px-2.5 py-2 font-mono text-xs"
            style={{ background: 'rgba(6,12,26,0.6)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--cream)', borderRadius: '2px', cursor: 'pointer' }}
          >
            <option value="encore">Sort · Most Encore products</option>
            <option value="best_score">Sort · Highest single score</option>
            <option value="products">Sort · Largest portfolio</option>
            <option value="newest">Sort · Newest member</option>
          </select>
        </div>

        {/* List */}
        <div className="card-navy" style={{ borderRadius: '2px', overflow: 'hidden' }}>
          {loading ? (
            <div className="px-5 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>loading creators…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>No creators at this grade yet</div>
            </div>
          ) : (
            <div>
              <div className="hidden md:grid grid-cols-[48px_1fr_120px_80px_80px_80px] items-center gap-3 px-4 py-2.5 font-mono text-[10px] tracking-widest" style={{
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                color: 'var(--text-label)',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <div>RANK</div>
                <div>CREATOR</div>
                <div className="text-right">GRADE</div>
                <div className="text-right">PRODUCTS</div>
                <div className="text-right">ENCORE</div>
                <div className="text-right">BEST</div>
              </div>
              {/* My pin · same pattern as ScoutsPage */}
              {user && (() => {
                const me = rows.find(r => r.id === user.id)
                if (!me) return null
                const myRank = rows.findIndex(r => r.id === user.id) + 1
                return <CreatorRow key={`me-${me.id}`} rank={myRank} member={me} isMine />
              })()}
              {filtered.map((m, i) => <CreatorRow key={m.id} rank={i + 1} member={m} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function GradeChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[11px] tracking-wide px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
      style={{
        background:   active ? `${color}1C` : 'transparent',
        color:        active ? color : 'var(--text-secondary)',
        border:       `1px solid ${active ? `${color}55` : 'rgba(255,255,255,0.08)'}`,
        borderRadius: '2px',
        cursor:       'pointer',
      }}
    >
      {label}
      {count > 0 && <span className="font-mono text-[10px] tabular-nums" style={{ opacity: 0.7 }}>{count}</span>}
    </button>
  )
}

function CreatorRow({ rank, member: m, isMine }: { rank: number; member: CreatorRow; isMine?: boolean }) {
  const grade = (m.creator_grade ?? 'Rookie') as CreatorGrade
  const gradeColor = GRADE_COLOR[grade]
  const displayName = m.display_name || 'Member'
  const initial = displayName.slice(0, 1).toUpperCase()
  return (
    <Link
      to={`/creators/${m.id}`}
      className="grid grid-cols-[48px_1fr_auto] md:grid-cols-[48px_1fr_120px_80px_80px_80px] items-center gap-3 px-4 py-3 transition-colors"
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        textDecoration: 'none',
        background: isMine ? 'rgba(167,139,250,0.10)' : undefined,
        boxShadow:  isMine ? 'inset 3px 0 0 #A78BFA' : undefined,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = isMine ? 'rgba(167,139,250,0.14)' : 'rgba(167,139,250,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = isMine ? 'rgba(167,139,250,0.10)' : 'transparent')}
    >
      <div className="font-mono text-xs font-medium tabular-nums" style={{ color: isMine ? '#A78BFA' : (rank <= 3 ? gradeColor : 'var(--text-muted)') }}>
        #{rank}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden flex-shrink-0"
          style={{
            width: 32, height: 32,
            background: m.avatar_url ? 'var(--navy-800)' : gradeColor,
            color: 'var(--navy-900)',
            border: `1px solid ${isMine ? '#A78BFA' : 'rgba(240,192,64,0.25)'}`,
            borderRadius: '2px',
          }}
        >
          {m.avatar_url
            ? <img src={m.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
            : initial}
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>
            {displayName}
          </div>
          <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Scout {m.tier ?? 'Bronze'}
          </div>
        </div>
      </div>
      <div className="md:hidden flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
        <span style={{ color: gradeColor }}>{grade}</span>
        {m.encore_count > 0 && (
          <span style={{ color: 'var(--gold-500)' }}>· {m.encore_count} Encore</span>
        )}
        {m.encore_count === 0 && m.product_count > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>· {m.product_count} product{m.product_count === 1 ? '' : 's'}</span>
        )}
      </div>
      <div className="hidden md:block text-right font-mono text-xs" style={{ color: gradeColor }}>{grade}</div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: 'var(--cream)' }}>
        {m.product_count}
      </div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: m.encore_count > 0 ? 'var(--gold-500)' : 'var(--text-muted)' }}>
        {m.encore_count}
      </div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {m.best_score ?? '—'}
      </div>
    </Link>
  )
}
