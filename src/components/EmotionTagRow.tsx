// Emotion tag preset · quick-insert chips above a comment textarea.
// Carved-out emoji exception per CLAUDE.md §4 — user-typed content, not a
// UI icon. Preset list is canonical (§2 Community): 🙌 🎯 🔥 🤔 💡.
//
// Each chip appends the emoji to the current value (separated by a space
// when the field isn't empty). Chips self-disable when max length would
// be exceeded.

interface Props {
  value:    string
  onChange: (next: string) => void
  maxLength?: number
  className?: string
}

interface Tag {
  emoji: string
  label: string           // tooltip · readable for screen readers
}

const TAGS: Tag[] = [
  { emoji: '🙌', label: 'Cheering you on' },
  { emoji: '🎯', label: 'Nailed the target' },
  { emoji: '🔥', label: 'On fire' },
  { emoji: '🤔', label: 'Curious about something' },
  { emoji: '💡', label: 'Sparked an idea' },
]

export function EmotionTagRow({ value, onChange, maxLength, className }: Props) {
  const spaceNeeded = value.length === 0 ? 0 : 1
  const atLimit = (extra: number) =>
    maxLength != null && value.length + spaceNeeded + extra > maxLength

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <span className="font-mono text-[10px] tracking-widest uppercase mr-1" style={{ color: 'var(--text-muted)' }}>
        quick tag
      </span>
      {TAGS.map(t => {
        const disabled = atLimit(t.emoji.length)
        return (
          <button
            key={t.emoji}
            type="button"
            onClick={() => {
              if (disabled) return
              const prefix = value.length === 0 ? '' : value.endsWith(' ') ? '' : ' '
              onChange(value + prefix + t.emoji)
            }}
            disabled={disabled}
            title={t.label}
            aria-label={t.label}
            className="inline-flex items-center justify-center transition-transform"
            style={{
              width: 26, height: 26,
              fontSize: 14,
              lineHeight: 1,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '2px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
            }}
            onMouseEnter={e => {
              if (disabled) return
              e.currentTarget.style.borderColor = 'rgba(240,192,64,0.5)'
              e.currentTarget.style.transform   = 'translateY(-1px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.transform   = ''
            }}
          >
            {t.emoji}
          </button>
        )
      })}
    </div>
  )
}
