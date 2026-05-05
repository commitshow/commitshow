// Encore badge · numbered trophy mark.
//
// Two render modes:
//   1. Score-driven (legacy): pass `score` only · renders production
//      Encore once score crosses the threshold. Renders nothing below.
//   2. Kind-driven (4-track): pass `kind` (+ optional serial) · renders
//      the chip for that specific Encore track. Use this when the
//      caller has already fetched the encores row(s) and knows which
//      kinds were earned (production / streak / climb / spotlight).
//
// `serial` is the registry-issued #N — heirloom moat per CLAUDE.md
// §encore. Sequences are per-kind so each track has its own #1.

import { isEncoreScore, ENCORE_KIND_META, type EncoreKind } from '../lib/encore'

interface Props {
  // Score-driven mode (production track only).
  score?:  number | null | undefined
  // Kind-driven mode (any track).
  kind?:   EncoreKind
  serial?: number | null
  size?:   'sm' | 'md'
  className?: string
}

export function EncoreBadge({ score, kind, serial, size = 'sm', className }: Props) {
  // Resolve the effective kind: explicit prop wins, else fall back to
  // production once the score is past the threshold. Below threshold
  // with no kind prop → render nothing (legacy behavior preserved).
  const effectiveKind: EncoreKind | null = kind
    ?? (isEncoreScore(score) ? 'production' : null)
  if (!effectiveKind) return null

  const meta = ENCORE_KIND_META[effectiveKind]
  const padY = size === 'md' ? '4px' : '2px'
  const padX = size === 'md' ? '8px' : '6px'
  const fontSize = size === 'md' ? 11 : 10
  const tooltip = serial
    ? `${meta.label} #${serial} · ${meta.oneLineWhy} · permanent serial, never recycles`
    : `${meta.label} · ${meta.oneLineWhy}`
  return (
    <span
      className={`font-mono tracking-widest uppercase ${className ?? ''}`}
      title={tooltip}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          4,
        padding:      `${padY} ${padX}`,
        background:   'rgba(240,192,64,0.12)',
        color:        'var(--gold-500)',
        border:       '1px solid rgba(240,192,64,0.45)',
        borderRadius: 2,
        fontSize,
        lineHeight:   1,
      }}
    >
      {meta.symbol} {meta.label}
      {serial != null && <span style={{ opacity: 0.85 }}> #{serial}</span>}
    </span>
  )
}
