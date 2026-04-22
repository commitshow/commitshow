import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import type { CreatorIdentity } from '../lib/projectQueries'

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
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

export function FeaturedLaneCard({ project: p, accent, hideScore, creator }: FeaturedLaneCardProps) {
  const navigate = useNavigate()
  const tone = TONE_COLOR[accent.tone]
  const gradeColor = GRADE_COLORS[p.creator_grade] || '#6B7280'
  const creatorName = creator?.display_name || p.creator_name || 'Anonymous'
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
      {/* Large image — the hero of the card */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '16 / 10', background: 'var(--navy-800)' }}>
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

        {/* Bottom gradient so text on the image reads clearly */}
        <div className="absolute inset-x-0 bottom-0" style={{
          height: '55%',
          background: 'linear-gradient(to top, rgba(6,12,26,0.92) 0%, rgba(6,12,26,0.55) 45%, transparent 100%)',
          pointerEvents: 'none',
        }} />

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

        {/* Title + score row — inside the image at bottom */}
        <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 flex items-end justify-between gap-2">
          <h4
            className="font-display font-bold text-base leading-tight truncate flex-1"
            style={{ color: 'var(--cream)', textShadow: '0 1px 10px rgba(0,0,0,0.6)' }}
          >
            {p.project_name}
          </h4>
          <span
            className="font-mono text-xs tabular-nums font-medium px-2 py-0.5 flex-shrink-0"
            style={{
              background: hideScore ? 'rgba(255,255,255,0.06)' : 'rgba(6,12,26,0.7)',
              color: hideScore ? 'rgba(248,245,238,0.5)' : 'var(--cream)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
              backdropFilter: 'blur(6px)',
            }}
          >
            {hideScore ? '— pts' : `${p.score_total} pts`}
          </span>
        </div>
      </div>

      {/* Footer — creator + description + meta */}
      <div className="px-3 py-2.5 flex items-center gap-2">
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
        <span className="font-mono text-[11px] truncate flex-1" style={{ color: 'var(--cream)' }}>
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
