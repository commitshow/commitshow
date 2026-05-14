// ScoreOrBandBadge — viewer-aware score display · §1-A ⑥ shame mitigation
// 2026-05-15.
//
// Renders either the raw digit score (e.g. "82 pts") or a band chip
// (Encore / Strong / Building / Early) based on whether the viewer is
// allowed to see the digit for THIS project. Single source of truth so
// every card / row / modal that previously rendered `score_total` runs
// through the same gate.
//
// Pass `viewer` to opt-in to the gate. Omit `viewer` to preserve the
// pre-gate behavior (always shows digit) — useful during incremental
// rollout so unmigrated surfaces don't accidentally start gating before
// they're audited.
//
// Variants:
//   · 'pill'   default · small chip with band/digit · matches the existing
//              ScoreBadge style in ProjectCard
//   · 'badge'  larger · for FeaturedLaneCard's right-side accent
//   · 'compact' minimal · for tight rows like ProjectCardCompact

import type { Project } from '../lib/supabase'
import { displayScore, scoreBand, bandLabel, bandTone, viewerCanSeeDigit, type ViewerScope } from '../lib/laneScore'

interface ScoreOrBandBadgeProps {
  project: Pick<Project, 'creator_id' | 'status' | 'score_total' | 'score_auto' | 'github_url' | 'live_url'>
  viewer?: ViewerScope | null    // omit to keep legacy digit-always behavior
  variant?: 'pill' | 'badge' | 'compact'
  /** When the digit is hidden, append the suffix? · 'pts' / '/100' / none. */
  showSuffix?: boolean
}

export function ScoreOrBandBadge({ project, viewer, variant = 'pill', showSuffix = true }: ScoreOrBandBadgeProps) {
  const canSeeDigit = viewer === undefined ? true : viewerCanSeeDigit(project, viewer ?? null)
  const score = displayScore(project)
  const band  = scoreBand(score)
  const tone  = bandTone(band)

  // Digit · same visual as the legacy ScoreBadge in ProjectCard (tier color
  // + faint bg + bordered pill). Color thresholds also tuned to the band
  // breakpoints so a digit and its band chip render the same tone.
  if (canSeeDigit && score > 0) {
    if (variant === 'compact') {
      return (
        <span className="font-mono tabular-nums" style={{ color: tone, fontWeight: 600 }}>
          {score}
        </span>
      )
    }
    if (variant === 'badge') {
      return (
        <span className="font-mono text-sm px-2.5 py-1 tabular-nums" style={{
          background: `${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.1)' : `${tone}1A`}`,
          color: tone,
          border: `1px solid ${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.3)' : `${tone}4D`}`,
          borderRadius: '2px',
        }}>
          {score}{showSuffix ? ' pts' : ''}
        </span>
      )
    }
    return (
      <span className="font-mono text-xs px-2 py-1 tabular-nums" style={{
        background: `${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.1)' : `${tone}1A`}`,
        color: tone,
        border: `1px solid ${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.3)' : `${tone}4D`}`,
        borderRadius: '2px',
      }}>
        {score}{showSuffix ? ' pts' : ''}
      </span>
    )
  }

  // Band chip · no digit · uses the same tone palette so it visually slots
  // in next to existing digit badges without color collision.
  const label = bandLabel(band)
  if (variant === 'compact') {
    return (
      <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: tone, fontWeight: 600 }}>
        {label}
      </span>
    )
  }
  if (variant === 'badge') {
    return (
      <span className="font-mono text-[11px] tracking-widest uppercase px-2.5 py-1" style={{
        background: `${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.08)' : `${tone}14`}`,
        color: tone,
        border: `1px solid ${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.25)' : `${tone}40`}`,
        borderRadius: '2px',
      }}>
        {label}
      </span>
    )
  }
  return (
    <span className="font-mono text-[10px] tracking-widest uppercase px-2 py-1" style={{
      background: `${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.08)' : `${tone}14`}`,
      color: tone,
      border: `1px solid ${tone === 'var(--gold-500)' ? 'rgba(240,192,64,0.25)' : `${tone}40`}`,
      borderRadius: '2px',
    }}>
      {label}
    </span>
  )
}
