// Minimal post body renderer for Community posts.
// No markdown library dep — supports:
//   - Code fences ```...```
//   - Inline code `...`
//   - Auto-linked http(s) URLs
//   - Preserved newlines + whitespace
// Rich markdown (lists, headings, bold) lands in V1.5.

import { Fragment } from 'react'

interface Props {
  source: string
}

// Split on triple-backtick fences, keeping the fences as odd-indexed blocks.
const FENCE_RE = /```([a-z0-9]*)\n([\s\S]*?)```/gi

export function PostBody({ source }: Props) {
  if (!source) return null
  const blocks: Array<{ kind: 'code' | 'text'; lang?: string; text: string }> = []
  let lastIndex = 0
  for (const match of source.matchAll(FENCE_RE)) {
    const before = source.slice(lastIndex, match.index)
    if (before) blocks.push({ kind: 'text', text: before })
    blocks.push({ kind: 'code', lang: match[1], text: match[2] })
    lastIndex = match.index! + match[0].length
  }
  const rest = source.slice(lastIndex)
  if (rest) blocks.push({ kind: 'text', text: rest })

  return (
    <div className="font-mono text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
      {blocks.map((b, i) =>
        b.kind === 'code'
          ? (
            <pre
              key={i}
              className="my-3 px-3 py-2 overflow-x-auto"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderLeft: '3px solid var(--gold-500)',
                borderRadius: '2px',
                color: 'var(--cream)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {b.lang && (
                <div
                  className="font-mono text-[10px] tracking-widest uppercase mb-1.5"
                  style={{ color: 'var(--gold-500)', opacity: 0.75 }}
                >
                  {b.lang}
                </div>
              )}
              <code>{b.text.replace(/\n$/, '')}</code>
            </pre>
          )
          : (
            <TextBlock key={i} text={b.text} />
          )
      )}
    </div>
  )
}

// Inline tokenizer: split on `inline-code` and http(s) URLs, keep everything
// else as plain-text nodes (preserves whitespace via white-space: pre-wrap).
const INLINE_RE = /(`[^`\n]+`|https?:\/\/[^\s)\]]+)/g

function TextBlock({ text }: { text: string }) {
  const parts = text.split(INLINE_RE).filter(part => part !== undefined)
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              style={{
                background: 'rgba(255,255,255,0.06)',
                padding: '1px 5px',
                fontSize: '0.92em',
                borderRadius: '2px',
                color: 'var(--gold-500)',
              }}
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--gold-500)', textDecoration: 'underline', textDecorationColor: 'rgba(240,192,64,0.35)' }}
            >
              {part}
            </a>
          )
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </span>
  )
}
