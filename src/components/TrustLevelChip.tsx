// TrustLevelChip · Discourse-style progression badge.
//
// Shown on member-facing surfaces (scout / creator detail pages,
// future: profile header). Renders nothing for TL0 — every fresh
// signup starts there, surfacing it everywhere reads as noise.
// TL1+ shows the level + name + (on hover) when it was earned.
//
// Phase 1 surfaces are read-only — gates (comment caps, post
// privileges) are enforced server-side as triggers land in later
// migrations. The chip is the public-facing acknowledgement that
// the member has put in time + activity.

interface Props {
  level:    number              // 0–4
  earnedAt?: string | null
  size?:    'sm' | 'md'
  className?: string
}

const META: Record<number, { label: string; tone: string; bg: string; border: string }> = {
  0: { label: 'New',      tone: 'var(--text-muted)',   bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
  1: { label: 'Basic',    tone: '#9CA3AF',             bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.30)' },
  2: { label: 'Member',   tone: '#60A5FA',             bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.35)' },
  3: { label: 'Regular',  tone: '#00D4AA',             bg: 'rgba(0,212,170,0.08)',   border: 'rgba(0,212,170,0.40)' },
  4: { label: 'Leader',   tone: 'var(--gold-500)',     bg: 'rgba(240,192,64,0.10)',  border: 'rgba(240,192,64,0.50)' },
}

export function TrustLevelChip({ level, earnedAt, size = 'sm', className }: Props) {
  if (level == null || level <= 0) return null
  const m = META[level] ?? META[0]
  const padY = size === 'md' ? '4px' : '2px'
  const padX = size === 'md' ? '8px' : '6px'
  const fontSize = size === 'md' ? 11 : 10
  const tooltip = earnedAt
    ? `Trust Level ${level} · ${m.label} · earned ${new Date(earnedAt).toLocaleDateString()}`
    : `Trust Level ${level} · ${m.label}`
  return (
    <span
      className={`font-mono tracking-widest uppercase ${className ?? ''}`}
      title={tooltip}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          4,
        padding:      `${padY} ${padX}`,
        background:   m.bg,
        color:        m.tone,
        border:       `1px solid ${m.border}`,
        borderRadius: 2,
        fontSize,
        lineHeight:   1,
      }}
    >
      TL{level} {m.label}
    </span>
  )
}
