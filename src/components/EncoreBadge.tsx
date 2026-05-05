// Encore badge · single-tier "this score crossed the bar" mark.
// Replaces the GraduationStanding-era tier chips (valedictorian /
// honors / graduate / rookie_circle).
//
// Render once per surface where you'd previously have shown a
// graduation_grade chip. The badge silently renders nothing when
// the project's score is below the threshold — no "below bar" tag.
//
// `serial` (optional) is the registry-issued #N. Surfacing it here
// turns Encore from a flat label into a numbered trophy ("Encore
// #43"). Plan v1.2 §2.3 — early adopters earn the low numbers,
// numbers never recycle, copycat sites can never have an Encore #1
// issued in 2026. The hierloom moat lives in this number.

import { isEncoreScore } from '../lib/encore'

interface Props {
  score:   number | null | undefined
  serial?: number | null
  size?:   'sm' | 'md'
  className?: string
}

export function EncoreBadge({ score, serial, size = 'sm', className }: Props) {
  if (!isEncoreScore(score)) return null
  const padY = size === 'md' ? '4px' : '2px'
  const padX = size === 'md' ? '8px' : '6px'
  const fontSize = size === 'md' ? 11 : 10
  const tooltip = serial
    ? `Encore #${serial} · score 85+ · permanent serial, never recycles`
    : 'Encore · score 85+'
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
      ★ Encore{serial != null && <span style={{ opacity: 0.85 }}> #{serial}</span>}
    </span>
  )
}
