import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import type { CreatorIdentity } from '../lib/projectQueries'
import { resolveCreatorName } from '../lib/creatorName'
import { useViewer } from '../lib/useViewer'
import { scoreBand, bandLabel, bandTone, viewerCanSeeDigit } from '../lib/laneScore'

export interface LaneCardAccent {
  tone: 'rookie' | 'climber' | 'graduating'
  leftBadge?: string
  rightBadge?: string
}

interface FeaturedLaneCardProps {
  project: Project
  accent: LaneCardAccent
  hideScore?: boolean
  creator?: CreatorIdentity | null
}

const TONE_COLOR: Record<LaneCardAccent['tone'], string> = {
  rookie:      '#6B7280',
  climber:     '#00D4AA',
  graduating:  '#F0C040',
}

const GRADE_COLORS: Record<string, string> = {
  Rookie: '#9CA3AF', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

export function FeaturedLaneCard({ project: p, accent, hideScore, creator }: FeaturedLaneCardProps) {
  const navigate = useNavigate()
  const tone = TONE_COLOR[accent.tone]
  const gradeColor = GRADE_COLORS[p.creator_grade] || '#9CA3AF'
  // §1-A ⑥ band gate · creator/admin/paid-Patron see digit. Encore reveals.
  const viewer       = useViewer()
  const canSeeDigit  = viewerCanSeeDigit(p, viewer)
  const band         = scoreBand(p.score_total ?? 0)
  const bandColor    = bandTone(band)
  const creatorLoading = !!p.creator_id && creator === undefined
  const creatorName = resolveCreatorName({
    display_name: creator?.display_name,
    creator_name: p.creator_name,
    loading: creatorLoading,
  })
  const creatorInitial = creatorName.slice(0, 1).toUpperCase()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${p.id}`)}
      onKeyDown={e => { if (e.key === 'Enter') navigate(`/projects/${p.id}`) }}
      className="group overflow-hidden transition-all cursor-pointer flex flex-col"
      style={{
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${tone}66` }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
    >
      {/* Image region — pure visual, no text overlay or gradient.
          Badges (grade + accent) sit on top with their own backdrop chip. */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)' }}>
        {p.thumbnail_url ? (
          <img
            src={p.thumbnail_url}
            alt={`${p.project_name} thumbnail`}
            loading="lazy"
            className="w-full h-full transition-transform duration-500 group-hover:scale-[1.04]"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-xs" style={{ color: 'rgba(248,245,238,0.25)' }}>
            NO IMAGE
          </div>
        )}

        {/* Accent badge — top right */}
        {accent.rightBadge && (
          <span
            className="absolute top-2 right-2 font-mono text-[11px] font-medium px-2 py-0.5"
            style={{
              background: `${tone}22`,
              color: tone,
              border: `1px solid ${tone}55`,
              borderRadius: '2px',
              backdropFilter: 'blur(6px)',
            }}
          >
            {accent.rightBadge}
          </span>
        )}

        {/* Grade chip — top left */}
        <span
          className="absolute top-2 left-2 font-mono text-[10px] tracking-widest uppercase px-2 py-0.5"
          style={{
            background: 'rgba(6,12,26,0.65)',
            color: gradeColor,
            border: `1px solid ${gradeColor}44`,
            borderRadius: '2px',
            backdropFilter: 'blur(6px)',
          }}
        >
          {p.creator_grade}
        </span>
      </div>

      {/* Title + score region — its own clean band below the image */}
      <div
        className="px-3 py-2.5 flex items-center justify-between gap-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <h4
          className="font-display font-bold text-base leading-tight truncate flex-1"
          style={{ color: 'var(--cream)' }}
        >
          {p.project_name}
        </h4>
        <span
          className="font-mono text-xs font-medium px-2 py-0.5 flex-shrink-0"
          style={{
            background: hideScore ? 'rgba(255,255,255,0.04)' : (canSeeDigit ? 'rgba(240,192,64,0.1)' : `${bandColor}1A`),
            color:      hideScore ? 'var(--text-secondary)' : (canSeeDigit ? 'var(--gold-500)' : bandColor),
            border:     `1px solid ${hideScore ? 'rgba(255,255,255,0.08)' : (canSeeDigit ? 'rgba(240,192,64,0.3)' : `${bandColor}4D`)}`,
            borderRadius: '2px',
            ...(canSeeDigit ? { fontVariantNumeric: 'tabular-nums' } : { textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '10px' }),
          }}
        >
          {hideScore ? '— pts' : canSeeDigit ? `${p.score_total} pts` : bandLabel(band)}
        </span>
      </div>

      {/* Creator region — own band at the bottom with subtle separator */}
      <div
        className="px-3 py-2.5 flex items-center gap-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div
          className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden flex-shrink-0"
          style={{
            width: 20, height: 20,
            background: creator?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
            color: 'var(--navy-900)',
            border: '1px solid rgba(240,192,64,0.3)',
            borderRadius: '2px',
          }}
        >
          {creator?.avatar_url
            ? <img src={creator.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
            : creatorInitial}
        </div>
        <span className="font-mono text-[11px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>
          {creatorName}
        </span>
        {accent.leftBadge && (
          <span className="font-mono text-[10px] flex-shrink-0" style={{ color: tone }}>
            {accent.leftBadge}
          </span>
        )}
      </div>
    </div>
  )
}
