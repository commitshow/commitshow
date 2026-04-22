import { useEffect, useState } from 'react'
import {
  evaluateGraduation,
  type GraduationEvaluation,
  type GraduationCriterion,
  type GraduationCriterionId,
} from '../lib/graduation'
import { IconGraduation } from './icons'

interface Props {
  projectId: string
  /** Owner sees a tighter "what's left for me to do" tone. Visitor sees scorecard. */
  viewerMode?: 'owner' | 'visitor'
}

/**
 * Public graduation checklist (concept v8 · 5 conditions).
 * Transparency-by-default — anyone looking at the project can see which gates
 * are passed and which remain. Owner framing nudges next action. Applaud is
 * handled as a post-season Craft Award track and is NOT a graduation gate.
 */
export function GraduationChecklist({ projectId, viewerMode = 'visitor' }: Props) {
  const [result, setResult] = useState<GraduationEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let alive = true
    evaluateGraduation(projectId).then(r => { if (alive) { setResult(r); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  if (loading) return null
  if (!result || !result.ok) return null

  const pct     = Math.round((result.pass_count / result.total) * 100)
  const isReady = result.graduation_ready
  const isOwner = viewerMode === 'owner'

  return (
    <div className="card-navy" style={{ borderRadius: '2px' }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-3 p-5 text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs tracking-widest" style={{ color: isReady ? '#00D4AA' : 'var(--gold-500)' }}>
            // GRADUATION CHECKLIST
          </div>
          <div className="font-display font-bold text-lg mt-1 flex items-center gap-2" style={{ color: 'var(--cream)' }}>
            {isReady ? (
              <>
                <span style={{ color: '#00D4AA' }}><IconGraduation size={20} /></span>
                Ready to graduate
              </>
            ) : (
              `${result.pass_count} of ${result.total} gates cleared`
            )}
          </div>
          {!expanded && (
            <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {isReady
                ? 'All five conditions pass · awaiting season-end graduation cycle'
                : isOwner
                  ? 'Tap to see what\'s left'
                  : 'Tap to inspect each gate'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="relative" style={{ width: '80px', height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
            <div className="absolute inset-y-0 left-0 transition-all duration-500" style={{
              width: `${pct}%`,
              background: isReady ? '#00D4AA' : 'var(--gold-500)',
              borderRadius: '2px',
              boxShadow: isReady ? '0 0 8px rgba(0,212,170,0.5)' : '0 0 8px rgba(240,192,64,0.35)',
            }} />
          </div>
          <span className="font-mono text-sm" style={{ color: 'var(--gold-500)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(240,192,64,0.12)' }}>
          <p className="font-light text-sm mt-4 mb-5" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            Five gates — all must pass. The Craft Award (Applaud Week) runs separately after the season and
            doesn't affect this checklist.
            {isOwner && ' The red rows are what to focus on next.'}
          </p>

          <div className="space-y-2.5">
            {result.criteria.map(c => (
              <CriterionCard key={c.id} criterion={c} isOwner={isOwner} />
            ))}
          </div>

          {isReady && (
            <div className="mt-4 pl-3 py-2.5 pr-3 font-mono text-xs" style={{
              borderLeft: '2px solid #00D4AA',
              background: 'rgba(0,212,170,0.06)',
              color: '#00D4AA',
              lineHeight: 1.6,
            }}>
              All five gates pass. The next season-end cycle will mark this project as <strong>graduated</strong>,
              trigger refund, verified badge, and Hall of Fame entry.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Friendly copy per criterion ───────────────────────────────
// Each gate has: monochrome line icon · short title · 1-line explanation.
// Action hint is computed from the criterion numbers and only surfaced to the
// owner when failing (so visitors see the scorecard, owners see the todo).
// Icons are inline SVG with stroke=currentColor so CSS `color` tints them —
// emoji are avoided (OS renders in full color and ignores tinting).

interface CriterionCopy {
  icon:        React.ReactNode
  title:       string
  explainer:   string
  ownerHint:   (c: GraduationCriterion) => string | null
}

// Shared base for all criterion icons: 20x20 · stroke 1.5 · rounded caps.
const iconBase = {
  width:  20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const COPY: Record<GraduationCriterionId, CriterionCopy> = {
  score_total: {
    icon: (
      <svg {...iconBase} aria-hidden="true">
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-8" />
        <path d="M3 20h18" />
      </svg>
    ),
    title: 'Overall score ≥ 75',
    explainer: 'Your project\'s combined score (auto analysis + Scout forecasts + community signals).',
    ownerHint: c => c.pass ? null
      : `Ship improvements + re-analyze. ${Math.max(0, (c.target ?? 75) - (c.value ?? 0))} points to go.`,
  },
  score_auto: {
    icon: (
      <svg {...iconBase} aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="1" />
        <path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
      </svg>
    ),
    title: 'Auto analysis ≥ 35 / 50',
    explainer: 'Lighthouse + GitHub repo signals + tech-layer diversity + Build Brief integrity.',
    ownerHint: c => c.pass ? null
      : `Fix Lighthouse issues, flesh out the Build Brief, and re-analyze. ${Math.max(0, (c.target ?? 35) - (c.value ?? 0))} pts short.`,
  },
  forecast_count: {
    icon: (
      <svg {...iconBase} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
    title: '3+ Scout forecasts',
    explainer: 'At least three Scouts have to cast a forecast on your graduation score.',
    ownerHint: c => {
      if (c.pass) return null
      const need = Math.max(0, (c.target ?? 3) - (c.value ?? 0))
      return `Share your project page with Scouts — you need ${need} more forecast${need === 1 ? '' : 's'}.`
    },
  },
  sustained_score: {
    icon: (
      <svg {...iconBase} aria-hidden="true">
        <path d="M3 17l5-5 4 4 8-8" />
        <path d="M14 8h6v6" />
      </svg>
    ),
    title: 'Score 75+ sustained 2 weeks',
    explainer: 'At least one analysis snapshot in the last 14 days has to land ≥ 75.',
    ownerHint: c => c.pass ? null
      : 'Ship a concrete improvement and run Re-analyze — the snapshot itself banks the streak.',
  },
  health_ok: {
    icon: (
      <svg {...iconBase} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </svg>
    ),
    title: 'Live URL healthy',
    explainer: 'Your live app has to answer HTTP 2xx and pass the auto health probe.',
    ownerHint: c => c.pass ? null
      : 'Live URL is missing or the probe failed. Check deploys, SSL, and run Re-analyze.',
  },
}

function CriterionCard({ criterion: c, isOwner }: { criterion: GraduationCriterion; isOwner: boolean }) {
  const copy = COPY[c.id]
  if (!copy) return null

  const tone    = c.pass ? '#00D4AA' : '#F88771'
  const accent  = c.pass ? 'rgba(0,212,170,0.3)' : 'rgba(248,120,113,0.3)'
  const bg      = c.pass ? 'rgba(0,212,170,0.04)' : 'rgba(200,16,46,0.03)'
  const ownerHint = isOwner ? copy.ownerHint(c) : null

  return (
    <div className="p-3 md:p-4" style={{
      background: bg,
      border: `1px solid ${accent}`,
      borderLeft: `3px solid ${tone}`,
      borderRadius: '2px',
    }}>
      <div className="flex items-start gap-3">
        {/* Icon · monochrome line SVG · no tile (design rule §4) */}
        <span className="flex-shrink-0" aria-hidden="true" style={{
          color: tone,
          marginTop: '1px',
          display: 'inline-flex',
          opacity: c.pass ? 1 : 0.75,
        }}>
          {copy.icon}
        </span>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
            <span className="font-mono text-xs font-medium" style={{ color: 'var(--cream)' }}>
              {copy.title}
            </span>
            <StatusPill pass={c.pass} tone={tone} />
          </div>
          <p className="font-light text-[11px] mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {copy.explainer}
          </p>

          {/* Progress surface — bar for numeric gates, note for rest */}
          <ProgressSurface c={c} tone={tone} />

          {ownerHint && (
            <div className="mt-2 pl-2 py-1 pr-2 font-mono text-[10px]" style={{
              borderLeft: `2px solid ${tone}`,
              background: 'rgba(255,255,255,0.02)',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}>
              <span style={{ color: tone }}>Next:</span> {ownerHint}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ pass, tone }: { pass: boolean; tone: string }) {
  return (
    <span className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 flex-shrink-0" style={{
      background: pass ? 'rgba(0,212,170,0.12)' : 'rgba(248,120,113,0.12)',
      color: tone,
      border: `1px solid ${pass ? 'rgba(0,212,170,0.35)' : 'rgba(248,120,113,0.35)'}`,
      borderRadius: '2px',
    }}>
      {pass ? '✓ PASS' : '✗ PENDING'}
    </span>
  )
}

function ProgressSurface({ c, tone }: { c: GraduationCriterion; tone: string }) {
  // Quantitative gates — render bar + "value / target"
  if (c.id === 'score_total' || c.id === 'score_auto' || c.id === 'forecast_count') {
    const value  = c.value  ?? 0
    const target = c.target ?? 1
    const pct = Math.min(100, Math.round((value / target) * 100))
    return (
      <div>
        <div className="flex items-center justify-between mb-1 font-mono text-[10px] tabular-nums"
          style={{ color: 'var(--text-muted)' }}>
          <span>
            <span style={{ color: 'var(--cream)' }}>{value}</span>
            <span> / {target}</span>
            {c.id === 'forecast_count' && <span> {value === 1 ? 'scout' : 'scouts'}</span>}
          </span>
          <span style={{ color: tone }}>{pct}%</span>
        </div>
        <div className="relative" style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
          <div
            className="absolute inset-y-0 left-0 transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: tone,
              borderRadius: '2px',
              boxShadow: c.pass ? `0 0 6px ${tone}55` : undefined,
            }}
          />
        </div>
      </div>
    )
  }

  // Sustained snapshot gate — show the count in a small chip
  if (c.id === 'sustained_score') {
    const n = c.snapshots_over_75_last_14d ?? 0
    return (
      <div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--cream)' }}>{n}</span> qualifying snapshot{n === 1 ? '' : 's'} in the last 14 days
        {c.note && <span style={{ color: 'var(--text-muted)' }}> · {c.note}</span>}
      </div>
    )
  }

  // Health — minimal note row
  if (c.note) {
    return (
      <div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {c.note}
      </div>
    )
  }

  return null
}
