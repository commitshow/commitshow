import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { CreatorIdentity } from '../lib/projectQueries'
import { IconForecast, IconApplaud } from './icons'
import { resolveCreatorName } from '../lib/creatorName'
import { useViewer } from '../lib/useViewer'
import { ScoreOrBandBadge } from './ScoreOrBandBadge'

/**
 * How clicking the card body behaves. The grid intercepts with `preview` so
 * scouts can quickly flip through many projects via a modal; surfaces like
 * Featured Lanes and profile list keep the direct-navigate default.
 */
export type ProjectCardOpenMode = 'navigate' | 'preview'

const GRADE_COLORS: Record<string, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

const STATUS_COLORS: Record<string, { fg: string; border: string }> = {
  active:        { fg: 'rgba(248,245,238,0.7)', border: 'rgba(255,255,255,0.12)' },
  graduated:     { fg: '#00D4AA',               border: 'rgba(0,212,170,0.35)' },
  valedictorian: { fg: 'var(--gold-500)',       border: 'rgba(240,192,64,0.45)' },
  retry:         { fg: '#C8102E',               border: 'rgba(200,16,46,0.35)' },
}

// Blind-stage placeholder · keeps the legacy hideScore behavior (Week 1
// blind ladder · §11). The band-or-digit decision lives in ScoreOrBandBadge.
function BlindBadge() {
  return (
    <span className="font-mono text-xs px-2 py-1" style={{
      background: 'rgba(255,255,255,0.04)',
      color: 'var(--text-secondary)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '2px',
    }}>
      —
    </span>
  )
}

export interface ProjectCardProps {
  project: Project
  delta?: number | null             // from climbing lane (current - previous)
  hideScore?: boolean               // Week 1 blind stage
  onForecast?: (project: Project) => void
  showForecastButton?: boolean
  creator?: CreatorIdentity | null  // batched from grid / lanes
  applaudCount?: number             // optional — shown when provided
  openMode?: ProjectCardOpenMode    // default 'navigate'
  onOpen?: (project: Project) => void  // only used when openMode === 'preview'
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)     return 'just now'
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  if (d < 30)  return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export function ProjectCard({ project: p, delta, hideScore, onForecast, showForecastButton = true, creator, applaudCount, openMode = 'navigate', onOpen }: ProjectCardProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  // §1-A ⑥ shame mitigation · public surfaces show band, creator/admin/
  // paid-Patron see digit. Encore-graduated projects always reveal digit
  // (handled inside viewerCanSeeDigit). hideScore (blind stage) still wins
  // over the gate — shows the dash placeholder regardless.
  const viewer = useViewer()
  const handleCardOpen = () => {
    if (openMode === 'preview' && onOpen) onOpen(p)
    else navigate(`/projects/${p.id}`)
  }
  const gc = GRADE_COLORS[p.creator_grade] || '#6B7280'
  const isOwner = !!user && user.id === p.creator_id
  const canForecast = showForecastButton && !!user && !isOwner && !!onForecast
  const statusStyle = STATUS_COLORS[p.status] ?? STATUS_COLORS.active
  const creatorLoading = !!p.creator_id && creator === undefined
  const creatorName = resolveCreatorName({
    display_name: creator?.display_name,
    creator_name: p.creator_name,
    loading: creatorLoading,
  })
  const creatorInitial = creatorName.slice(0, 1).toUpperCase()

  return (
    <div
      className="card-navy overflow-hidden transition-all duration-200 cursor-pointer group flex flex-col h-full"
      onClick={handleCardOpen}
    >
      {/* Thumbnail */}
      {p.thumbnail_url ? (
        <div className="relative" style={{ aspectRatio: '1200 / 630', overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <img
            src={p.thumbnail_url}
            alt={`${p.project_name} thumbnail`}
            loading="lazy"
            className="w-full h-full transition-transform duration-500 group-hover:scale-105"
            style={{ objectFit: 'cover', background: 'var(--navy-800)' }}
          />
          {/* Top-left: status chip */}
          <span className="absolute top-2 left-2 font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5" style={{
            background: 'rgba(6,12,26,0.75)',
            color: statusStyle.fg,
            border: `1px solid ${statusStyle.border}`,
            borderRadius: '2px',
            backdropFilter: 'blur(4px)',
          }}>
            {p.status === 'retry' ? 'Rookie Circle' : p.status}
          </span>
          {/* Top-right: delta badge */}
          {delta != null && delta > 0 && (
            <span className="absolute top-2 right-2 font-mono text-xs font-medium px-2 py-0.5" style={{
              background: 'rgba(0,212,170,0.15)',
              color: '#00D4AA',
              border: '1px solid rgba(0,212,170,0.4)',
              borderRadius: '2px',
              backdropFilter: 'blur(4px)',
            }}>
              +{delta}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center font-mono text-xs" style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)', color: 'var(--text-faint)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          NO IMAGE
        </div>
      )}

      <div className="p-5 flex flex-col flex-1">
        {/* Header · title + score */}
        <div className="flex items-start justify-between mb-2 gap-2">
          <h3 className="font-display font-bold text-lg leading-tight group-hover:text-gold-400 transition-colors" style={{ color: 'var(--cream)' }}>
            {p.project_name}
          </h3>
          {hideScore ? <BlindBadge /> : <ScoreOrBandBadge project={p} viewer={viewer} variant="pill" />}
        </div>

        {/* Creator strip — avatar + display name */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden"
            style={{
              width: 20, height: 20, flexShrink: 0,
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
          <span className="font-mono text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>
            {creatorName}
          </span>
          <span className="font-mono text-[10px]" style={{ color: gc, flexShrink: 0 }}>
            {p.creator_grade}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm font-light mb-4 line-clamp-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {p.description}
        </p>

        {/* Tags */}
        {p.tech_layers?.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {p.tech_layers.slice(0, 3).map(t => (
              <span key={t} className="font-mono text-xs px-2 py-0.5" style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
                borderRadius: '2px',
              }}>{t}</span>
            ))}
            {p.tech_layers.length > 3 && (
              <span className="font-mono text-xs px-2 py-0.5" style={{ color: 'var(--text-muted)' }}>
                +{p.tech_layers.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto">
          {/* Footer · meta row */}
          <div className="flex items-center justify-between pt-3 gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-3 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span className="inline-flex items-center gap-1"><IconForecast size={11} /> {p.score_forecast} forecasts</span>
              {applaudCount != null && (
                <span className="inline-flex items-center gap-1"><IconApplaud size={11} /> {applaudCount}</span>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span>{timeAgo(p.created_at)}</span>
              {/* GitHub link — owner only until public access rules are defined */}
              {isOwner && p.github_url && (
                <a
                  href={p.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  GitHub ↗
                </a>
              )}
            </div>
          </div>

          {canForecast && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onForecast!(p) }}
              className="mt-3 w-full py-2 font-mono text-xs font-medium tracking-wide transition-colors"
              style={{
                background: 'rgba(240,192,64,0.08)',
                color: 'var(--gold-500)',
                border: '1px solid rgba(240,192,64,0.3)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-500)'; e.currentTarget.style.color = 'var(--navy-900)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(240,192,64,0.08)'; e.currentTarget.style.color = 'var(--gold-500)' }}
            >
              <span className="inline-flex items-center justify-center gap-1.5"><IconForecast size={12} /> FORECAST</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
