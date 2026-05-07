// README badge snippet · owner-only tool to grab a markdown embed for the
// project's current commit.show standing. Powered by the `badge` Edge Function
// which serves a dynamic SVG.
//
// 2026-05-07 simplification: one primary CTA (copy markdown), one obvious
// next step (paste at top of README). Earlier version surfaced 4 buttons
// (md/html × FLAT/PILL) with no priority — too many decisions for a
// drop-in tool. Style + HTML options collapsed into a single disclosure.

import { useState } from 'react'
import { SUPABASE_URL } from '../lib/supabase'

interface Props {
  projectId: string
  projectName: string
}

type Style = 'flat' | 'pill'

export function BadgeSnippet({ projectId, projectName }: Props) {
  const [style, setStyle]       = useState<Style>('flat')
  const [showMore, setShowMore] = useState(false)
  const [copied, setCopied]     = useState<'md' | 'html' | null>(null)

  const badgeUrl   = `${SUPABASE_URL}/functions/v1/badge?project=${projectId}&style=${style}`
  const projectUrl = `https://commit.show/projects/${projectId}`
  const altText    = `${projectName} on commit.show`

  const markdown = `[![${altText}](${badgeUrl})](${projectUrl})`
  const html     = `<a href="${projectUrl}"><img src="${badgeUrl}" alt="${altText}" /></a>`

  const copy = async (which: 'md' | 'html', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1800)
  }

  const primaryCopied = copied === 'md'

  return (
    <div className="card-navy p-5 md:p-6" style={{ borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
        // README BADGE
      </div>
      <h3 className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>
        Show your score on GitHub
      </h3>
      <p className="font-light text-sm mt-1 mb-5" style={{ color: 'var(--text-secondary)' }}>
        One copy, one paste in your README. The badge auto-updates as your score moves.
      </p>

      {/* Live preview */}
      <div
        className="flex items-center justify-center p-6 mb-4"
        style={{
          background:   'rgba(6,12,26,0.45)',
          border:       '1px solid rgba(255,255,255,0.06)',
          borderRadius: '2px',
        }}
      >
        <img
          key={badgeUrl}
          src={badgeUrl}
          alt={altText}
          style={{ height: style === 'flat' ? 20 : 24, display: 'block' }}
        />
      </div>

      {/* Primary CTA · single button does the only thing 99% of users want */}
      <button
        type="button"
        onClick={() => copy('md', markdown)}
        className="w-full font-mono text-xs tracking-wide px-4 py-3 mb-3"
        style={{
          background:   primaryCopied ? 'rgba(0,212,170,0.15)' : 'var(--gold-500)',
          color:        primaryCopied ? '#00D4AA'              : 'var(--navy-900)',
          border:       primaryCopied ? '1px solid rgba(0,212,170,0.5)' : 'none',
          borderRadius: '2px',
          cursor:       'pointer',
          fontWeight:   700,
        }}
      >
        {primaryCopied ? '✓ Copied · paste it at the top of your README' : 'Copy markdown for README →'}
      </button>

      <p className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Tip · paste right above your project's title in the README so visitors see the score
        before scrolling. Re-audit anytime — the badge re-fetches the latest score.
      </p>

      {/* Disclosure: HTML embed + style toggle. Collapsed by default · power
          users (Notion, plain HTML pages, custom doc sites) open it. */}
      <button
        type="button"
        onClick={() => setShowMore(s => !s)}
        className="font-mono text-[10px] tracking-widest"
        style={{
          background:   'transparent',
          color:        'var(--text-muted)',
          border:       'none',
          padding:      0,
          cursor:       'pointer',
        }}
      >
        {showMore ? '▾ MORE OPTIONS' : '▸ MORE OPTIONS'}
      </button>

      {showMore && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
              STYLE
            </span>
            <StyleChip active={style === 'flat'} onClick={() => setStyle('flat')}>FLAT</StyleChip>
            <StyleChip active={style === 'pill'} onClick={() => setStyle('pill')}>PILL</StyleChip>
          </div>

          <SnippetRow
            label="HTML EMBED"
            value={html}
            copied={copied === 'html'}
            onCopy={() => copy('html', html)}
            hint="for plain HTML pages, Notion, custom doc sites"
          />
        </div>
      )}
    </div>
  )
}

function StyleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[10px] tracking-widest px-2.5 py-1 transition-colors"
      style={{
        background: active ? 'rgba(240,192,64,0.12)' : 'transparent',
        color:      active ? 'var(--gold-500)'      : 'var(--text-secondary)',
        border: `1px solid ${active ? 'rgba(240,192,64,0.4)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '2px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function SnippetRow({ label, value, copied, onCopy, hint }: {
  label: string; value: string; copied: boolean; onCopy: () => void; hint?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
            {label}
          </span>
          {hint && (
            <span className="font-mono text-[10px] ml-2" style={{ color: 'var(--text-muted)' }}>
              · {hint}
            </span>
          )}
        </div>
        <button
          onClick={onCopy}
          className="font-mono text-[10px] tracking-wide px-2 py-0.5 transition-colors"
          style={{
            background: copied ? 'rgba(0,212,170,0.12)' : 'transparent',
            color:      copied ? '#00D4AA'             : 'var(--gold-500)',
            border: `1px solid ${copied ? 'rgba(0,212,170,0.4)' : 'rgba(240,192,64,0.3)'}`,
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          {copied ? 'COPIED ✓' : 'COPY'}
        </button>
      </div>
      <pre
        className="font-mono text-[11px] px-3 py-2 overflow-x-auto max-w-full"
        style={{
          background:   'rgba(6,12,26,0.6)',
          color:        'var(--text-primary)',
          border:       '1px solid rgba(255,255,255,0.06)',
          borderRadius: '2px',
          whiteSpace:   'pre',
          maxWidth:     '100%',
        }}
      >
        {value}
      </pre>
    </div>
  )
}
