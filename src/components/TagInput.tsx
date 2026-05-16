// Tag chip input · default vocabulary (§13-B.10) + free-text additions.
// Selected tags show with a remove × · suggested defaults still live in the
// chip strip so users can toggle them on/off.

import { useState, type KeyboardEvent } from 'react'
import { DEFAULT_TAGS } from '../lib/community'

interface Props {
  value:      string[]
  onChange:   (next: string[]) => void
  max?:       number
  placeholder?: string
}

export function TagInput({ value, onChange, max = 6, placeholder = 'Add a tag…' }: Props) {
  const [draft, setDraft] = useState('')

  const toggle = (tag: string) => {
    // Strip any user-typed '#' prefix during normalization · we store
    // tags without '#' and the UI prepends one at render time. Without
    // this, '#vibe-life' typed by the user lands as literal '#vibe-life'
    // in DB and renders as '##vibe-life' everywhere. Replacing all '#'
    // (not just the leading one) defends against '##' or stray hashes.
    const normalized = tag.trim().toLowerCase().replace(/#/g, '').replace(/\s+/g, '-')
    if (!normalized) return
    const next = value.includes(normalized)
      ? value.filter(t => t !== normalized)
      : value.length >= max
        ? value
        : [...value, normalized]
    onChange(next)
  }

  const commitDraft = () => {
    if (!draft.trim()) return
    toggle(draft)
    setDraft('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitDraft()
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div>
      {/* Selected chips + free-text input */}
      <div
        className="flex flex-wrap items-center gap-1.5 p-2"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '2px',
          minHeight: 44,
        }}
      >
        {value.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5"
            style={{
              background: 'rgba(240,192,64,0.14)',
              color: 'var(--gold-500)',
              border: '1px solid rgba(240,192,64,0.45)',
              borderRadius: '2px',
            }}
          >
            #{tag}
            <button
              type="button"
              onClick={() => toggle(tag)}
              aria-label={`Remove ${tag}`}
              className="inline-flex items-center justify-center"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--gold-500)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commitDraft}
          placeholder={value.length >= max ? 'Max reached' : placeholder}
          disabled={value.length >= max}
          className="flex-1 font-mono text-xs px-1 py-0.5 bg-transparent"
          style={{
            minWidth: 100,
            color: 'var(--cream)',
            border: 'none',
            outline: 'none',
          }}
        />
      </div>

      {/* Default suggestions */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {DEFAULT_TAGS.map(tag => {
          const active = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className="font-mono text-[10px] tracking-wide px-2 py-0.5 transition-colors"
              style={{
                background:   active ? 'rgba(240,192,64,0.12)' : 'transparent',
                color:        active ? 'var(--gold-500)' : 'var(--text-muted)',
                border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '2px',
                cursor:       'pointer',
              }}
            >
              #{tag}
            </button>
          )
        })}
      </div>
      <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
        {value.length}/{max} · Enter or comma to add custom
      </div>
    </div>
  )
}
