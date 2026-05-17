import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import {
  fetchBackstageReady,
  fetchClimbing,
  fetchGraduating,
  fetchCreatorsByIds,
  type CreatorIdentity,
} from '../lib/projectQueries'
import { FeaturedLaneCard } from './FeaturedLaneCard'

interface LaneState<T = Project> {
  loading: boolean
  rows: T[]
}

type ClimberRow = Project & { delta: number }

// Carousel card sizing — each card keeps the same aspect ratio as the grid
// card, but is wider/more breathable in the horizontal lane.
const CARD_WIDTH_PX = 300

// 2026-05-17 · NEW AUDITS lane (fetchJustRegistered · status='active'
// newest-14d) was swapped for BACKSTAGE (fetchBackstageReady ·
// status='backstage' + audit_count≥2 + thumbnail + 30-char description).
//
// Motivation: NEW AUDITS surfaced rows that were already on the body
// ladder — the lane was a duplicate spotlight, not new information.
// BACKSTAGE surfaces a population the ladder *cannot* show (rows still
// in iteration before audition), making the three lanes a stage-by-stage
// journey instead of three slices of the same active set:
//
//     BACKSTAGE  →  ON STAGE (climbing)  →  ENCORE
//     iterating     active, biggest moves   crossed 84+ permanent
//
// CLIMBING lane was renamed ON STAGE so the stage vocabulary is
// consistent across lane labels, StageBadge, ProjectDetail, Hero CTA,
// and ProfilePage. Same underlying query (positive delta this week);
// "biggest moves this week" is now framed as on-stage performance.
export function FeaturedLanes() {
  const [backstage,  setBackstage]  = useState<LaneState>({ loading: true, rows: [] })
  const [climbers,   setClimbers]   = useState<LaneState<ClimberRow>>({ loading: true, rows: [] })
  const [graduating, setGraduating] = useState<LaneState>({ loading: true, rows: [] })
  const [creators,   setCreators]   = useState<Record<string, CreatorIdentity>>({})

  useEffect(() => {
    Promise.all([fetchBackstageReady(), fetchClimbing(), fetchGraduating()]).then(async ([b, c, g]) => {
      setBackstage({ loading: false, rows: b })
      setClimbers({ loading: false, rows: c })
      setGraduating({ loading: false, rows: g })

      const allCreatorIds = [...b, ...c, ...g].map(p => p.creator_id).filter((x): x is string => !!x)
      if (allCreatorIds.length > 0) setCreators(await fetchCreatorsByIds(allCreatorIds))
    })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <Lane
        label="BACKSTAGE"
        hint="Iterating · polished · ready for the stage soon"
        tone="var(--cream)"
        loading={backstage.loading}
        empty="Nothing in backstage yet. Audit, fix, re-audit, dress your project — and your audition lands here."
        footerCta={{
          label: 'How a backstage audition works →',
          to:    '/backstage',
        }}
      >
        {backstage.rows.map(p => (
          <FeaturedLaneCard
            key={p.id}
            project={p}
            creator={p.creator_id ? creators[p.creator_id] : undefined}
            accent={{
              tone: 'backstage',
              leftBadge: `${p.audit_count ?? 1} audits`,
            }}
          />
        ))}
      </Lane>

      <Lane
        label="ON STAGE"
        hint="Active on the league · biggest moves this week"
        tone="#00D4AA"
        loading={climbers.loading}
        empty="No movers yet — be the first to push score upward."
        footerCta={{
          label: 'Audition your project →',
          to:    '/submit',
        }}
      >
        {climbers.rows.map(p => (
          <FeaturedLaneCard
            key={p.id}
            project={p}
            creator={p.creator_id ? creators[p.creator_id] : undefined}
            accent={{ tone: 'climber', rightBadge: `+${p.delta}` }}
          />
        ))}
      </Lane>

      <Lane
        label="ENCORE"
        hint="Crossed the 84 line · permanent badge"
        tone="#F0C040"
        loading={graduating.loading}
        empty="None over the Encore line yet."
        footerCta={{
          label: 'Encore criteria →',
          to:    '/rulebook',
        }}
      >
        {graduating.rows.map(p => (
          <FeaturedLaneCard
            key={p.id}
            project={p}
            creator={p.creator_id ? creators[p.creator_id] : undefined}
            accent={{ tone: 'graduating', rightBadge: `${p.score_total}/100` }}
          />
        ))}
      </Lane>
    </div>
  )
}

interface LaneFooterCta {
  label: string
  to:    string
}

function Lane({ label, hint, tone, loading, empty, children, footerCta }: {
  label: string; hint: string; tone: string; loading: boolean; empty: string;
  children: React.ReactNode; footerCta?: LaneFooterCta;
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const count = (Array.isArray(children) ? children : [children]).filter(Boolean).length

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    const cardsPerStride = Math.max(1, Math.floor(el.clientWidth / (CARD_WIDTH_PX + 12)))
    el.scrollBy({ left: dir * cardsPerStride * (CARD_WIDTH_PX + 12), behavior: 'smooth' })
  }

  const canScroll = !loading && count > 1

  return (
    <div className="flex flex-col gap-2.5">
      {/* Lane header · label + hint + gradient divider + arrow controls */}
      <div className="flex items-baseline justify-between px-1 gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <div>
            <div className="font-mono text-xs tracking-widest" style={{ color: tone }}>{label}</div>
            <div className="font-mono text-[10px] mt-0.5" style={{ color: 'rgba(248,245,238,0.35)' }}>{hint}</div>
          </div>
          {count > 0 && (
            <span className="font-mono text-[10px]" style={{ color: 'rgba(248,245,238,0.35)' }}>
              {count}
            </span>
          )}
        </div>
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${tone}55, transparent)` }} />
          {canScroll && (
            <div className="flex gap-1 flex-shrink-0">
              <ArrowBtn dir="left"  onClick={() => scrollBy(-1)} tone={tone} />
              <ArrowBtn dir="right" onClick={() => scrollBy(1)}  tone={tone} />
            </div>
          )}
        </div>
      </div>

      {/* Horizontal scroller */}
      {loading ? (
        <div className="font-mono text-xs flex items-center justify-center py-10" style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px dashed rgba(255,255,255,0.08)',
          color: 'rgba(248,245,238,0.25)',
          borderRadius: '2px',
        }}>
          Loading…
        </div>
      ) : count === 0 ? (
        <div className="font-mono text-xs flex items-center justify-center py-10 px-6 text-center" style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px dashed rgba(255,255,255,0.08)',
          color: 'rgba(248,245,238,0.3)',
          borderRadius: '2px',
        }}>
          {empty}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-1"
          style={{
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
          }}
          // WebKit scrollbar hiding (Tailwind scrollbar plugin not in use)
          onWheelCapture={e => {
            // Convert vertical wheel to horizontal when the user is clearly scrolling the lane
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              const el = scrollRef.current
              if (!el) return
              // Only eat the event if the lane has room to scroll — otherwise let the page scroll
              const canLeft  = el.scrollLeft > 0
              const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth
              if ((e.deltaY < 0 && canLeft) || (e.deltaY > 0 && canRight)) {
                e.preventDefault()
                el.scrollBy({ left: e.deltaY, behavior: 'auto' })
              }
            }
          }}
        >
          {/* hide webkit scrollbar */}
          <style>{`.lane-scroll::-webkit-scrollbar { display: none }`}</style>
          {(Array.isArray(children) ? children : [children]).filter(Boolean).map((child, i) => (
            <div
              key={i}
              style={{ width: CARD_WIDTH_PX, flexShrink: 0, scrollSnapAlign: 'start' }}
            >
              {child}
            </div>
          ))}
        </div>
      )}

      {/* Lane footer · stage-entry CTA. Renders even on empty/loading
          so visitors always have the next-step pointer regardless of
          how full the lane is. */}
      {footerCta && (
        <div className="flex justify-end px-1">
          <Link
            to={footerCta.to}
            className="font-mono text-[10px] tracking-wide transition-colors"
            style={{ color: `${tone}`, opacity: 0.75 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
          >
            {footerCta.label}
          </Link>
        </div>
      )}
    </div>
  )
}

function ArrowBtn({ dir, onClick, tone }: { dir: 'left' | 'right'; onClick: () => void; tone: string }) {
  return (
    <button
      type="button"
      aria-label={dir === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 26, height: 26,
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid ${tone}33`,
        color: tone,
        borderRadius: '2px',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${tone}18`
        e.currentTarget.style.borderColor = `${tone}66`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
        e.currentTarget.style.borderColor = `${tone}33`
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
           style={{ transform: dir === 'left' ? 'rotate(180deg)' : undefined }}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}
