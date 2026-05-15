import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fetchProjectCreator, type CreatorIdentity } from '../lib/projectQueries'
import { ForecastModal } from './ForecastModal'
import { IconForecast } from './icons'
import { resolveCreatorName } from '../lib/creatorName'
import { useViewer } from '../lib/useViewer'
import { scoreBand, bandLabel, bandTone, viewerCanSeeDigitOnList } from '../lib/laneScore'

interface Props {
  project: Project
  onClose: () => void
  /** Pre-resolved creator from parent (avoids redundant fetch for grids). */
  creator?: CreatorIdentity | null
  applaudCount?: number
}

const GRADE_COLORS: Record<string, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

/**
 * Lightweight quick-peek modal launched from a project card in the grid.
 *
 * The goal is to let Scouts flip through several projects without full-page
 * navigation. Opens with a short summary + thumbnail + two CTAs: VIEW FULL
 * PROJECT (navigates to /projects/:id) or CLOSE (stays on the list).
 */
export function ProjectPreviewModal({ project: p, onClose, creator: creatorProp, applaudCount }: Props) {
  const { user } = useAuth()
  const viewer = useViewer()
  const navigate = useNavigate()
  const [creator, setCreator] = useState<CreatorIdentity | null>(creatorProp ?? null)
  const [forecastOpen, setForecastOpen] = useState(false)

  useEffect(() => {
    if (!creatorProp && p.creator_id) fetchProjectCreator(p.creator_id).then(setCreator)
  }, [creatorProp, p.creator_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isOwner = !!user && user.id === p.creator_id
  const canForecast = !!user && !isOwner
  // §1-A ⑥ list-surface band gate · preview modal is a list-style
  // surface (Scout flipping through grid cards) · creator-self still sees
  // band so they get the public view. Detail page has the dashboard digit.
  const canSeeDigit = viewerCanSeeDigitOnList(p, viewer)
  const band        = scoreBand(p.score_total ?? 0)
  const bandColor   = bandTone(band)
  const scoreColor = p.score_total >= 75 ? '#00D4AA' : p.score_total >= 50 ? '#F0C040' : '#C8102E'
  const creatorLoading = !!p.creator_id && creator === undefined
  const creatorName = resolveCreatorName({
    display_name: creator?.display_name,
    creator_name: p.creator_name,
    loading: creatorLoading,
  })

  // Portal to document.body so the fixed backdrop escapes ProjectsPage's
  // `z-10` stacking context (without the portal, footer — also z-10 but
  // later in the DOM — overlaps this modal on scroll).
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8"
        style={{ background: 'rgba(6,12,26,0.85)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      >
        <div
          className="card-navy w-full max-w-xl max-h-[90vh] overflow-y-auto relative"
          style={{ borderRadius: '2px' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button · always visible top-right */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 z-10 font-mono text-xs px-2 py-1"
            style={{
              background: 'rgba(6,12,26,0.7)',
              color: 'var(--cream)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
            }}
          >
            ESC ×
          </button>

          {/* Thumbnail hero */}
          {p.thumbnail_url ? (
            <div className="relative" style={{ aspectRatio: '1200 / 630', overflow: 'hidden', background: 'var(--navy-800)' }}>
              <img src={p.thumbnail_url} alt="" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
              <span className="absolute top-3 left-3 font-mono text-[10px] tracking-widest uppercase px-2 py-0.5" style={{
                background: 'rgba(6,12,26,0.75)',
                color: p.status === 'graduated' ? '#00D4AA' : 'var(--cream)',
                border: `1px solid ${p.status === 'graduated' ? 'rgba(0,212,170,0.4)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: '2px',
                backdropFilter: 'blur(6px)',
              }}>
                {p.status}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center font-mono text-xs" style={{ aspectRatio: '1200 / 630', background: 'var(--navy-800)', color: 'var(--text-faint)' }}>
              NO IMAGE
            </div>
          )}

          <div className="p-6 space-y-4">
            {/* Title + score */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
                  // PROJECT PREVIEW
                </div>
                <h2 className="font-display font-black text-2xl leading-tight" style={{ color: 'var(--cream)' }}>
                  {p.project_name}
                </h2>
              </div>
              <div className="flex-shrink-0 text-right">
                {canSeeDigit ? (
                  <>
                    <div className="font-display font-black text-3xl tabular-nums" style={{ color: scoreColor }}>
                      {p.score_total}
                    </div>
                    <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>/ 100</div>
                  </>
                ) : (
                  <>
                    <div className="font-display font-black text-xl tracking-widest uppercase" style={{ color: bandColor }}>
                      {bandLabel(band)}
                    </div>
                    <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>band</div>
                  </>
                )}
              </div>
            </div>

            {/* Creator strip */}
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center font-mono text-xs font-bold overflow-hidden"
                style={{
                  width: 28, height: 28,
                  background: creator?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: '1px solid rgba(240,192,64,0.3)',
                  borderRadius: '2px',
                }}
              >
                {creator?.avatar_url
                  ? <img src={creator.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  : creatorName.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>{creatorName}</div>
                <div className="font-mono text-[10px]" style={{ color: GRADE_COLORS[p.creator_grade] ?? 'var(--text-muted)' }}>
                  Creator · {p.creator_grade}
                </div>
              </div>
            </div>

            {/* Description */}
            {p.description && (
              <p className="text-sm font-light" style={{ color: 'var(--text-primary)', lineHeight: 1.7 }}>
                {p.description}
              </p>
            )}

            {/* Meta stats row */}
            <div className="grid grid-cols-3 gap-2">
              <PreviewStat label="Forecasts"  value={String(p.score_forecast ?? 0)} />
              <PreviewStat label="Applauds"   value={String(applaudCount ?? 0)} />
              <PreviewStat label="Audited"    value={timeAgo(p.created_at)} />
            </div>

            {/* Tech tags */}
            {p.tech_layers?.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {p.tech_layers.slice(0, 5).map(t => (
                  <span key={t} className="font-mono text-[11px] px-2 py-0.5" style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-secondary)',
                    borderRadius: '2px',
                  }}>{t}</span>
                ))}
                {p.tech_layers.length > 5 && (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    +{p.tech_layers.length - 5} more
                  </span>
                )}
              </div>
            )}

            {p.verdict && (
              <div className="pl-3 py-2 pr-3 text-sm italic" style={{
                borderLeft: '2px solid var(--gold-500)',
                background: 'rgba(240,192,64,0.04)',
                color: 'var(--text-primary)',
                lineHeight: 1.6,
              }}>
                "{p.verdict}"
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => navigate(`/projects/${p.id}`)}
                className="flex-1 min-w-[180px] py-2.5 font-mono text-xs font-medium tracking-wide"
                style={{
                  background: 'var(--gold-500)',
                  color: 'var(--navy-900)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                VIEW FULL PROJECT →
              </button>
              {p.live_url && (
                <a
                  href={p.live_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-4 font-mono text-xs tracking-wide"
                  style={{
                    background: 'transparent',
                    color: 'var(--cream)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '2px',
                    textDecoration: 'none',
                  }}
                >
                  OPEN LIVE ↗
                </a>
              )}
              {canForecast && (
                <button
                  onClick={() => setForecastOpen(true)}
                  className="py-2.5 px-4 font-mono text-xs tracking-wide"
                  style={{
                    background: 'rgba(240,192,64,0.08)',
                    color: 'var(--gold-500)',
                    border: '1px solid rgba(240,192,64,0.3)',
                    borderRadius: '2px',
                    cursor: 'pointer',
                  }}
                >
                  <span className="inline-flex items-center justify-center gap-1.5"><IconForecast size={12} /> FORECAST</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="py-2.5 px-4 font-mono text-xs tracking-wide"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      </div>

      {forecastOpen && (
        <ForecastModal project={p} onClose={() => setForecastOpen(false)} onCast={() => setForecastOpen(false)} />
      )}
    </>,
    document.body,
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2" style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '2px',
    }}>
      <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
        {label.toUpperCase()}
      </div>
      <div className="font-display font-bold text-base mt-0.5" style={{ color: 'var(--cream)' }}>
        {value}
      </div>
    </div>
  )
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
