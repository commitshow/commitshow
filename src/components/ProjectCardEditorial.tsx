import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/supabase'
import type { CreatorIdentity } from '../lib/projectQueries'
import { IconForecast, IconApplaud, IconGraduation } from './icons'

// Editorial-style card. Treat every submission as a crafted piece —
// generous image, Playfair headline, paragraph-scale description. Replaces
// the dense pump.fun grid when the goal is savoring, not scanning.

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
  onOpen?: (p: Project) => void
}

export function ProjectCardEditorial({
  project: p, delta, hideScore, creator, applaudCount, onOpen,
}: Props) {
  const navigate = useNavigate()
  const handleOpen = () => onOpen ? onOpen(p) : navigate(`/projects/${p.id}`)

  const gc = GRADE_COLORS[p.creator_grade] || '#6B7280'
  const sc = hideScore ? 'rgba(255,255,255,0.35)' : scoreColor(p.score_total)
  const metaBits = (p.tech_layers ?? []).slice(0, 3).map(t => t.toUpperCase())
  if (metaBits.length === 0 && p.creator_grade) metaBits.push(p.creator_grade.toUpperCase())
  const isGraduated = p.status === 'graduated' || p.status === 'valedictorian'

  // "Issue number" cue — short project id slice, magazine-like.
  const issueTag = `#${p.id.slice(0, 4).toUpperCase()}`

  return (
    <article
      className="group cursor-pointer overflow-hidden flex flex-col h-full transition-colors"
      onClick={handleOpen}
      style={{
        background: 'rgba(15,32,64,0.35)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
    >
      {/* Image · 3:2 · hero-first emphasis */}
      <div className="relative" style={{ aspectRatio: '3 / 2', overflow: 'hidden', background: 'var(--navy-800)' }}>
        {p.thumbnail_url ? (
          <img
            src={p.thumbnail_url}
            alt=""
            loading="lazy"
            className="w-full h-full transition-transform duration-700 group-hover:scale-[1.03]"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-xs tracking-widest" style={{ color: 'var(--text-faint)' }}>
            NO IMAGE
          </div>
        )}
        {delta != null && delta !== 0 && (
          <span className="absolute top-3 right-3 font-mono text-[10px] tabular-nums px-1.5 py-0.5" style={{
            background: delta > 0 ? 'rgba(0,212,170,0.18)' : 'rgba(200,16,46,0.18)',
            color:      delta > 0 ? '#00D4AA'             : '#F88771',
            border:     `1px solid ${delta > 0 ? 'rgba(0,212,170,0.45)' : 'rgba(200,16,46,0.45)'}`,
            borderRadius: '2px',
            backdropFilter: 'blur(6px)',
          }}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
        {isGraduated && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase px-2 py-0.5" style={{
            background: 'rgba(0,212,170,0.15)',
            color: '#00D4AA',
            border: '1px solid rgba(0,212,170,0.4)',
            borderRadius: '2px',
            backdropFilter: 'blur(6px)',
          }}>
            <IconGraduation size={10} />
            {p.status === 'valedictorian' ? 'Valedictorian' : 'Graduated'}
          </span>
        )}
      </div>

      {/* Editorial body · generous padding */}
      <div className="px-6 pt-5 pb-6 flex flex-col flex-1">
        {/* Meta line · gold uppercase + issue tag */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="font-mono text-[10px] tracking-widest uppercase leading-[1.6] min-w-0" style={{ color: 'var(--gold-500)' }}>
            {metaBits.length > 0 ? (
              metaBits.map((b, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5" style={{ color: 'rgba(240,192,64,0.45)' }}>×</span>}
                  {b}
                </span>
              ))
            ) : (
              <span style={{ color: 'rgba(240,192,64,0.5)' }}>VIBE PROJECT</span>
            )}
          </div>
          <span className="font-mono text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {issueTag}
          </span>
        </div>

        {/* Headline · Playfair · 2 lines */}
        <h3
          className="font-display font-bold leading-[1.15] mb-3 line-clamp-2"
          style={{ color: 'var(--cream)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}
        >
          {p.project_name}
        </h3>

        {/* Description · editorial paragraph */}
        {p.description && (
          <p
            className="font-light line-clamp-4 mb-5"
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.925rem',
              lineHeight: 1.65,
            }}
          >
            {p.description}
          </p>
        )}

        {/* Footer · creator chip + stats + CTA */}
        <div className="mt-auto pt-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex items-center justify-center font-mono text-[10px] font-bold overflow-hidden flex-shrink-0"
              style={{
                width: 22, height: 22,
                background: creator?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: '1px solid rgba(240,192,64,0.3)',
                borderRadius: '2px',
              }}
            >
              {creator?.avatar_url
                ? <img src={creator.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                : (creator?.display_name || p.creator_name || 'A').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 font-mono text-[11px] leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
              {creator?.display_name || p.creator_name || 'Anonymous'}
              <span className="ml-1" style={{ color: gc }}>· {p.creator_grade}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            <span className="inline-flex items-center gap-1"><IconForecast size={11} /> {p.score_forecast}</span>
            {applaudCount ? (
              <span className="inline-flex items-center gap-1"><IconApplaud size={11} /> {applaudCount}</span>
            ) : null}
            <span style={{ color: sc }}>{hideScore ? '—' : `${p.score_total} pts`}</span>
          </div>
        </div>

        {/* CTA · ref-style "Read →" in gold */}
        <div className="mt-4">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide transition-colors"
            style={{ color: 'var(--gold-500)' }}
          >
            View project
            <span className="transition-transform duration-200 group-hover:translate-x-0.5" style={{ display: 'inline-block' }}>
              →
            </span>
          </span>
        </div>
      </div>
    </article>
  )
}
