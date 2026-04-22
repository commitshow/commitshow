import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import type { CreatorIdentity } from '../lib/projectQueries'
import { IconForecast, IconApplaud } from './icons'

// pump.fun-style dense card. Thumbnail + name + score + 1-line meta.
// Used in the /projects grid where the goal is scan many projects fast.
// For deeper cards (Featured Lanes, creator profile), keep ProjectCard.

const GRADE_COLORS: Record<string, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

function scoreColor(s: number): string {
  if (s >= 75) return '#00D4AA'
  if (s >= 50) return '#F0C040'
  return '#C8102E'
}

interface Props {
  project: Project
  delta?: number | null
  hideScore?: boolean
  creator?: CreatorIdentity | null
  applaudCount?: number
  onOpen?: (p: Project) => void  // preview modal; falls back to navigate
}

export function ProjectCardCompact({
  project: p, delta, hideScore, creator, applaudCount, onOpen,
}: Props) {
  const navigate = useNavigate()
  const handleOpen = () => onOpen ? onOpen(p) : navigate(`/projects/${p.id}`)

  const gc   = GRADE_COLORS[p.creator_grade] || '#6B7280'
  const sc   = hideScore ? 'rgba(255,255,255,0.35)' : scoreColor(p.score_total)
  const name = p.project_name

  // Live pulse: green ring when recently-submitted (< 6h) or re-analyzed.
  // Good proxy until a real realtime signal feed lands.
  const fresh = Date.now() - new Date(p.updated_at || p.created_at).getTime() < 6 * 3600 * 1000

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group text-left overflow-hidden cursor-pointer transition-colors"
      style={{
        background: 'rgba(15,32,64,0.4)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
        padding: 0,
        boxShadow: fresh ? '0 0 0 1px rgba(0,212,170,0.35), 0 0 14px rgba(0,212,170,0.15)' : undefined,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
    >
      {/* Thumbnail strip · fixed 16:9, no text overlay to keep room */}
      <div className="relative" style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: 'var(--navy-800)' }}>
        {p.thumbnail_url ? (
          <img
            src={p.thumbnail_url}
            alt=""
            loading="lazy"
            className="w-full h-full transition-transform duration-500 group-hover:scale-105"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
            NO IMG
          </div>
        )}
        {/* Delta pill · top-right */}
        {delta != null && delta !== 0 && (
          <span className="absolute top-1.5 right-1.5 font-mono text-[10px] tabular-nums px-1 py-0.5" style={{
            background: delta > 0 ? 'rgba(0,212,170,0.18)' : 'rgba(200,16,46,0.18)',
            color:      delta > 0 ? '#00D4AA'             : '#F88771',
            border:     `1px solid ${delta > 0 ? 'rgba(0,212,170,0.45)' : 'rgba(200,16,46,0.45)'}`,
            borderRadius: '2px',
            backdropFilter: 'blur(4px)',
          }}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </div>

      {/* Body · 3 compact lines */}
      <div className="px-2.5 py-2">
        {/* Line 1: name + score */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs truncate" style={{ color: 'var(--cream)' }}>
            {name}
          </span>
          <span className="font-mono text-xs tabular-nums flex-shrink-0" style={{ color: sc }}>
            {hideScore ? '—' : p.score_total}
          </span>
        </div>
        {/* Line 2: creator grade + forecasts + applauds */}
        <div className="flex items-center justify-between mt-1 font-mono text-[10px] tabular-nums">
          <span className="truncate" style={{ color: gc }}>
            {p.creator_grade}
          </span>
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <IconForecast size={10} /> {p.score_forecast}
            {applaudCount ? (
              <>
                <span>·</span>
                <IconApplaud size={10} />
                <span>{applaudCount}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>
      {/* Hidden · creator avatar is batched but not surfaced on compact cards to avoid clutter */}
      {creator && null}
    </button>
  )
}
