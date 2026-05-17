// StageBadge · single source of truth for the project-stage indicator
// surfaced across the app.
//
// §1-A ⑥ verb pair (Audit / Audition) is reinforced by a 3-stage journey
// that the user should be able to name at any point in the flow:
//
//   BACKSTAGE  →  ON STAGE  →  ENCORE
//   iterating     active        score 84+ permanent badge
//
// Before this component the metaphor only lived in the marketing copy
// at /backstage — every other surface (ProjectDetail, FeaturedLanes,
// ProfilePage rows, Hero CTA) was silent about which stage a project
// occupied. Users couldn't navigate by stage even though the data was
// already on each row. StageBadge fixes that with one component used
// everywhere · same vocabulary, same color treatment, same icon.
//
// Stage derivation rules:
//   · status='backstage'                              → 'backstage'
//   · status='active' OR 'retry'                      → 'on-stage'
//   · status='graduated' OR 'valedictorian' OR
//     score_total >= 84 (encore line)                 → 'encore'
//
// We derive from a `project`-like input so callers don't need to repeat
// the logic. For sites that only have a `status` (or want to force a
// specific stage), pass `stage` directly.

import { useMemo } from 'react'

export type Stage = 'backstage' | 'on-stage' | 'encore'

interface ProjectLike {
  status?:       string | null
  score_total?:  number | null
}

interface StageBadgeProps {
  /** Source of truth · pass a project row OR an explicit stage. */
  project?: ProjectLike | null
  stage?:   Stage
  size?:    'xs' | 'sm' | 'md' | 'lg'
  /** Suppress the icon (rarely useful · default false). */
  iconless?: boolean
  /** Inline-block override (default true). */
  className?: string
  /** Optional sub-text shown after the stage name, e.g. "audit + fix loop". */
  hint?: string
}

export function deriveStage(p: ProjectLike | null | undefined): Stage | null {
  if (!p) return null
  const s = p.status ?? ''
  if (s === 'graduated' || s === 'valedictorian') return 'encore'
  if (s === 'backstage') return 'backstage'
  if (s === 'active' || s === 'retry') {
    // Encore line crossed but still on the stage (not yet flipped to
    // graduated). Surface as encore so the badge matches the score.
    if ((p.score_total ?? 0) >= 84) return 'encore'
    return 'on-stage'
  }
  // preview (CLI walk-on) or unknown · no stage badge.
  return null
}

const STAGE_META: Record<Stage, { label: string; tone: string; toneSoft: string; defaultHint: string }> = {
  'backstage': {
    label:       'BACKSTAGE',
    tone:        'var(--cream)',
    toneSoft:    'rgba(248,245,238,0.10)',
    defaultHint: 'audit + fix loop',
  },
  'on-stage': {
    label:       'ON STAGE',
    tone:        '#00D4AA',
    toneSoft:    'rgba(0,212,170,0.12)',
    defaultHint: 'active on the league',
  },
  'encore': {
    label:       'ENCORE',
    tone:        'var(--gold-500)',
    toneSoft:    'rgba(240,192,64,0.14)',
    defaultHint: 'crossed the 84 line · permanent',
  },
}

const SIZE_TOKENS: Record<Exclude<StageBadgeProps['size'], undefined>, { fontSize: number; px: number; py: number; iconSize: number; gap: number; hintSize: number }> = {
  xs: { fontSize: 9,  px: 6,  py: 2, iconSize: 10, gap: 4, hintSize: 9 },
  sm: { fontSize: 10, px: 7,  py: 2.5, iconSize: 12, gap: 5, hintSize: 10 },
  md: { fontSize: 11, px: 9,  py: 3.5, iconSize: 14, gap: 6, hintSize: 11 },
  lg: { fontSize: 13, px: 12, py: 5,   iconSize: 17, gap: 7, hintSize: 12 },
}

export function StageBadge({ project, stage, size = 'sm', iconless = false, className, hint }: StageBadgeProps) {
  const derivedStage = useMemo(
    () => (stage ?? deriveStage(project ?? null)),
    [project, stage],
  )
  if (!derivedStage) return null
  const meta = STAGE_META[derivedStage]
  const tokens = SIZE_TOKENS[size]
  const hintText = hint ?? null

  return (
    <span
      className={className}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          tokens.gap,
        fontFamily:   'DM Mono, monospace',
        fontSize:     tokens.fontSize,
        letterSpacing: '0.18em',
        fontWeight:   600,
        color:        meta.tone,
        background:   meta.toneSoft,
        border:       `1px solid ${meta.tone}33`,
        borderRadius: '2px',
        padding:      `${tokens.py}px ${tokens.px}px`,
        lineHeight:   1,
        whiteSpace:   'nowrap',
      }}
    >
      {!iconless && <StageIcon stage={derivedStage} size={tokens.iconSize} />}
      <span>{meta.label}</span>
      {hintText && (
        <span style={{ opacity: 0.55, fontSize: tokens.hintSize, letterSpacing: '0.04em', fontWeight: 400, marginLeft: 4 }}>
          · {hintText}
        </span>
      )}
    </span>
  )
}

// Stage-specific line icon. Same SVG convention as icons.tsx · single
// stroke, currentColor, no fill. Each glyph reads as a literal stage:
//   · BACKSTAGE = stage curtain / wing
//   · ON STAGE  = spotlight / mic on stage
//   · ENCORE    = laurel wreath
function StageIcon({ stage, size }: { stage: Stage; size: number }) {
  const baseProps = {
    width:  size,
    height: size,
    viewBox: '0 0 24 24',
    fill:   'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap:  'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden':  true,
  }
  if (stage === 'backstage') {
    // Curtain · two vertical panels with a draped top rail (= waiting in wings)
    return (
      <svg {...baseProps}>
        <path d="M4 4h16" />
        <path d="M6 4v16c0-3 1.5-5 3-7-1.5 2-3 4-3 7" />
        <path d="M18 4v16c0-3-1.5-5-3-7 1.5 2 3 4 3 7" />
        <path d="M12 4v16" />
      </svg>
    )
  }
  if (stage === 'on-stage') {
    // Microphone on stand (= currently performing)
    return (
      <svg {...baseProps}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6 11a6 6 0 0 0 12 0" />
        <path d="M12 17v4" />
        <path d="M9 21h6" />
      </svg>
    )
  }
  // encore · laurel wreath halves
  return (
    <svg {...baseProps}>
      <path d="M6 4c-2 4-2 9 2 13" />
      <path d="M8 7c-1 3-1 6 1 9" />
      <path d="M10 10c-0.5 2 0 4 1 5" />
      <path d="M18 4c2 4 2 9-2 13" />
      <path d="M16 7c1 3 1 6-1 9" />
      <path d="M14 10c0.5 2 0 4-1 5" />
      <path d="M12 16v5" />
    </svg>
  )
}
