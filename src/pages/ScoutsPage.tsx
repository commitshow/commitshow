import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type ScoutTier, type MemberStats } from '../lib/supabase'
import { useAuth } from '../lib/auth'

interface TopSpotterRow {
  member_id:        string
  display_name:     string | null
  avatar_url:       string | null
  tier:             ScoutTier
  votes_n:          number
  first_spotter_n:  number
  early_spotter_n:  number
  applauds_n:       number
  comments_n:       number
  week_score:       number
}

const TIER_COLOR: Record<ScoutTier, string> = {
  Bronze: '#B98B4E', Silver: '#D1D5DB', Gold: '#F0C040', Platinum: '#A78BFA',
}
const TIER_ORDER: ScoutTier[] = ['Platinum', 'Gold', 'Silver', 'Bronze']

// PRD v2 §9 · tier benefits. Vote value is uniform (×1) across tiers
// — what differs is monthly vote allowance + analysis early-access
// + extra honors. The legacy "Applaud weight ×1.5/×2/×3" column was
// dropped in 20260424_v2_prd_realignment.sql when Applaud became a
// polymorphic toggle (CLAUDE.md §1-A ① · 1 item = 1 applaud · no
// graduation impact). This UI now reflects that.
const TIER_BENEFITS: Record<ScoutTier, {
  threshold:   string
  monthlyVotes: number
  preview:      string   // analysis early-access window
  extras:       string[]
}> = {
  Bronze: {
    threshold:    'AP 0 – 499',
    monthlyVotes: 20,
    preview:      'Standard release',
    extras:       [],
  },
  Silver: {
    threshold:    'AP 500 – 1,999',
    monthlyVotes: 40,
    preview:      'Security layer · 12 h early',
    extras:       [],
  },
  Gold: {
    threshold:    'AP 2,000 – 4,999',
    monthlyVotes: 60,
    preview:      'Security layer · 24 h early',
    extras:       ['Community Award eligible'],
  },
  Platinum: {
    threshold:    'Top 3 % AP',
    monthlyVotes: 80,
    preview:      'Full analysis early + rulebook preview',
    extras:       ['First Spotter title', 'Public LinkedIn / X badge'],
  },
}

type SortMode = 'ap' | 'forecasts' | 'applauds' | 'newest'

export function ScoutsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<MemberStats[]>([])
  const [topWeek, setTopWeek] = useState<TopSpotterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tierFilter, setTierFilter] = useState<'any' | ScoutTier>('any')
  const [sort, setSort] = useState<SortMode>('ap')

  useEffect(() => {
    ;(async () => {
      const [allTime, weekly] = await Promise.all([
        // All-time leaderboard · activity-based gate so the page doesn't
        // list signed-up-but-silent members.
        supabase
          .from('member_stats')
          .select('*')
          .or('total_votes_cast.gt.0,total_applauds_given.gt.0,comments_authored.gt.0')
          .order('activity_points', { ascending: false })
          .limit(200),
        // Weekly window · resets every 7 days so a fresh signup's
        // first decisive forecast can land them at the top the same
        // day. View already orders by week_score DESC.
        supabase
          .from('top_spotters_week')
          .select('*')
          .limit(5),
      ])
      setRows((allTime.data ?? []) as MemberStats[])
      setTopWeek((weekly.data ?? []) as TopSpotterRow[])
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    let list = rows.slice()
    if (tierFilter !== 'any') list = list.filter(m => m.tier === tierFilter)
    switch (sort) {
      case 'forecasts':
        list.sort((a, b) => (b.total_votes_cast ?? 0) - (a.total_votes_cast ?? 0))
        break
      case 'applauds':
        list.sort((a, b) => (b.total_applauds_given ?? 0) - (a.total_applauds_given ?? 0))
        break
      case 'newest':
        list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        break
      case 'ap':
      default:
        list.sort((a, b) => (b.activity_points ?? 0) - (a.activity_points ?? 0))
    }
    return list
  }, [rows, tierFilter, sort])

  const tierCounts = useMemo(() => {
    const c: Record<ScoutTier, number> = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 }
    rows.forEach(r => { c[r.tier as ScoutTier] = (c[r.tier as ScoutTier] ?? 0) + 1 })
    return c
  }, [rows])

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // SCOUT LEADERBOARD
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
            Who calls the shots
          </h1>
          <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
            Forecast. Applaud. Climb tiers. Higher tier = more votes, earlier access.
          </p>
        </header>

        {/* This week's top spotters · 7-day window resets every Monday.
            Onboarding-friendly: a brand-new scout who lands a single First
            Spotter can sit at the top of this list within hours, even
            though they're nowhere on the all-time leaderboard yet. */}
        {topWeek.length > 0 && <TopSpottersThisWeek rows={topWeek} />}

        {/* Tier distribution + benefit strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
          {TIER_ORDER.map(t => (
            <TierCell
              key={t}
              tier={t}
              count={tierCounts[t] ?? 0}
              active={tierFilter === t}
              onClick={() => setTierFilter(tierFilter === t ? 'any' : t)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {tierFilter === 'any' ? `All ${filtered.length} scouts` : `${filtered.length} ${tierFilter} scout${filtered.length === 1 ? '' : 's'}`}
            {tierFilter !== 'any' && (
              <button
                onClick={() => setTierFilter('any')}
                className="ml-2 font-mono text-[10px] tracking-widest"
                style={{ background: 'transparent', color: 'var(--scarlet)', border: 'none', cursor: 'pointer' }}
              >
                Clear ×
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="px-2.5 py-1.5 font-mono text-xs"
            style={{ background: 'rgba(6,12,26,0.6)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--cream)', borderRadius: '2px', cursor: 'pointer' }}
          >
            <option value="ap">Sort · Activity Points</option>
            <option value="forecasts">Sort · Forecasts cast</option>
            <option value="applauds">Sort · Applauds given</option>
            <option value="newest">Sort · Newest member</option>
          </select>
        </div>

        {loading ? (
          <div className="card-navy p-10 text-center font-mono text-xs" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
            Loading leaderboard…
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-navy p-10 text-center" style={{ borderRadius: '2px' }}>
            <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>No scouts at this tier yet</div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
              Cast a Forecast to start earning Activity Points.
            </p>
          </div>
        ) : (
          <div className="card-navy overflow-hidden" style={{ borderRadius: '2px' }}>
            {/* Header row */}
            <div className="hidden md:grid grid-cols-[48px_1fr_100px_100px_100px_100px] items-center gap-3 px-4 py-2.5 font-mono text-[10px] tracking-widest" style={{
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              color: 'var(--text-label)',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <div>RANK</div>
              <div>SCOUT</div>
              <div className="text-right">TIER</div>
              <div className="text-right">AP</div>
              <div className="text-right">FORECASTS</div>
              <div className="text-right">APPLAUDS</div>
            </div>
            {/* My row · pinned at top when authed. Renders BEFORE the
                tier-filtered list so the user's own activity is always
                one click away regardless of which tier filter is on.
                The filtered list still includes them too — duplicating
                is intentional, not a bug; the pin is a "you are here"
                shortcut while the ranked position remains discoverable. */}
            {user && (() => {
              const me = rows.find(r => r.id === user.id)
              if (!me) return null
              const myRank = rows.findIndex(r => r.id === user.id) + 1
              return <ScoutRow key={`me-${me.id}`} rank={myRank} member={me} isMine />
            })()}
            {filtered.map((m, i) => <ScoutRow key={m.id} rank={i + 1} member={m} />)}
          </div>
        )}
      </div>
    </section>
  )
}

function TierCell({ tier, count, active, onClick }: { tier: ScoutTier; count: number; active: boolean; onClick: () => void }) {
  const color = TIER_COLOR[tier]
  const b = TIER_BENEFITS[tier]
  return (
    <button
      onClick={onClick}
      className="card-navy px-3.5 py-3 text-left transition-colors flex flex-col h-full"
      style={{
        borderRadius: '2px',
        borderColor: active ? color : 'rgba(255,255,255,0.06)',
        background: active ? `${color}14` : undefined,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] tracking-widest" style={{ color }}>
          {tier.toUpperCase()}
        </div>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {b.threshold}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="font-display font-black text-2xl tabular-nums" style={{ color: 'var(--cream)' }}>
          {count}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          scout{count === 1 ? '' : 's'}
        </span>
      </div>

      <dl className="mt-2.5 space-y-1 font-mono text-[10px]" style={{ lineHeight: 1.4 }}>
        <BenefitRow k="Votes / mo" v={`${b.monthlyVotes}`} vColor="var(--cream)" />
        <BenefitRow k="Analysis"   v={b.preview} vColor="var(--text-secondary)" />
        {b.extras.map((x, i) => (
          <BenefitRow key={i} k="·" v={x} vColor="var(--text-secondary)" />
        ))}
      </dl>
    </button>
  )
}

function BenefitRow({ k, v, vColor }: { k: string; v: string; vColor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
      <dd className="text-right" style={{ color: vColor }}>{v}</dd>
    </div>
  )
}

function ScoutRow({ rank, member: m, isMine }: { rank: number; member: MemberStats; isMine?: boolean }) {
  const tier = m.tier as ScoutTier
  const tierColor = TIER_COLOR[tier]
  const displayName = m.display_name || 'Member'
  const initial = displayName.slice(0, 1).toUpperCase()

  return (
    <Link
      to={`/scouts/${m.id}`}
      className="grid grid-cols-[48px_1fr_auto] md:grid-cols-[48px_1fr_100px_100px_100px_100px] items-center gap-3 px-4 py-3 transition-colors"
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        textDecoration: 'none',
        // Differentiate the "you" pin · gold tint background + a 3-px
        // gold left bar so the row visually hooks out of the list.
        background: isMine ? 'rgba(240,192,64,0.10)' : undefined,
        boxShadow:  isMine ? 'inset 3px 0 0 var(--gold-500)' : undefined,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = isMine ? 'rgba(240,192,64,0.14)' : 'rgba(240,192,64,0.03)')}
      onMouseLeave={e => (e.currentTarget.style.background = isMine ? 'rgba(240,192,64,0.10)' : 'transparent')}
    >
      <div className="font-mono text-xs font-medium tabular-nums" style={{ color: isMine ? 'var(--gold-500)' : (rank <= 3 ? tierColor : 'var(--text-muted)') }}>
        #{rank}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden flex-shrink-0"
          style={{
            width: 32, height: 32,
            background: m.avatar_url ? 'var(--navy-800)' : tierColor,
            color: 'var(--navy-900)',
            border: `1px solid ${isMine ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)'}`,
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
            Creator {m.creator_grade ?? 'Rookie'}
            {m.graduated_count > 0 ? ` · ${m.graduated_count} Encore` : ''}
          </div>
        </div>
      </div>

      {/* Mobile: inline compact stats */}
      <div className="md:hidden flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
        <span style={{ color: tierColor }}>{tier}</span>
        <span style={{ color: 'var(--text-muted)' }}>· {m.activity_points ?? 0} AP</span>
      </div>

      {/* Desktop: full columns */}
      <div className="hidden md:block text-right font-mono text-xs" style={{ color: tierColor }}>
        {tier}
      </div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: 'var(--cream)' }}>
        {(m.activity_points ?? 0).toLocaleString()}
      </div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {m.total_votes_cast ?? 0}
      </div>
      <div className="hidden md:block text-right font-mono text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {m.total_applauds_given ?? 0}
      </div>
    </Link>
  )
}

// This-week leaderboard · 7-day window. Sits above the tier-distribution
// row on /scouts so newcomers see a leaderboard they can plausibly enter
// before the all-time leaderboard buries them under accumulated AP.
function TopSpottersThisWeek({ rows }: { rows: TopSpotterRow[] }) {
  return (
    <section className="mb-6 card-navy" style={{ borderRadius: '2px' }}>
      <header className="flex items-baseline justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // THIS WEEK'S TOP SPOTTERS
          </div>
          <div className="font-display font-bold text-base mt-0.5" style={{ color: 'var(--cream)' }}>
            Last 7 days · resets every Monday
          </div>
        </div>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          First Spotter ×10 · Early ×4 · Forecast ×2 · Applaud ×1
        </div>
      </header>
      <ol className="grid divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        {rows.map((r, i) => {
          const initial = (r.display_name ?? 'M').slice(0, 1).toUpperCase()
          const rankColor = i === 0 ? 'var(--gold-500)' : i === 1 ? '#D1D5DB' : i === 2 ? '#CD7F32' : 'var(--text-muted)'
          return (
            <li key={r.member_id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
              <Link
                to={`/scouts/${r.member_id}`}
                className="grid grid-cols-[28px_32px_1fr_auto] items-center gap-3 px-4 py-2.5"
                style={{ textDecoration: 'none' }}
              >
                <span className="font-mono text-sm tabular-nums" style={{ color: rankColor, fontWeight: 700 }}>
                  #{i + 1}
                </span>
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden"
                  style={{
                    width: 32, height: 32,
                    background: r.avatar_url ? 'transparent' : 'var(--navy-800)',
                    color: 'var(--cream)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '50%',
                  }}
                >
                  {r.avatar_url
                    ? <img src={r.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                    : initial}
                </span>
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--cream)' }}>
                    {r.display_name ?? 'Member'}
                  </div>
                  <div className="font-mono text-[10px] flex items-center gap-2 flex-wrap mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {r.first_spotter_n > 0 && (
                      <span style={{ color: 'var(--gold-500)' }}>★ {r.first_spotter_n} First</span>
                    )}
                    {r.early_spotter_n > 0 && (
                      <span>· {r.early_spotter_n} Early</span>
                    )}
                    <span>· {r.votes_n} forecasts</span>
                    {r.applauds_n > 0 && <span>· {r.applauds_n} applauds</span>}
                    {r.comments_n > 0 && <span>· {r.comments_n} comments</span>}
                  </div>
                </div>
                <span className="font-display font-bold text-lg tabular-nums" style={{ color: 'var(--gold-500)' }}>
                  {r.week_score}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
