// Encore badge · single-tier "this score crossed the bar" mark.
// Replaces the GraduationStanding-era tier chips (valedictorian /
// honors / graduate / rookie_circle).
//
// Render once per surface where you'd previously have shown a
// graduation_grade chip. The badge silently renders nothing when
// the project's score is below the threshold — no "below bar" tag.

import { isEncoreScore } from '../lib/encore'

interface Props {
  score: number | null | undefined
  size?: 'sm' | 'md'
  className?: string
}

export function EncoreBadge({ score, size = 'sm', className }: Props) {
  if (!isEncoreScore(score)) return null
  const padY = size === 'md' ? '4px' : '2px'
  const padX = size === 'md' ? '8px' : '6px'
  const fontSize = size === 'md' ? 11 : 10
  return (
    <span
      className={`font-mono tracking-widest uppercase ${className ?? ''}`}
      title="Encore · score 84+"
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
      ★ Encore
    </span>
  )
}
