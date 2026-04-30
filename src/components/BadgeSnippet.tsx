// README badge snippet · owner-only tool to grab a markdown embed for the
// project's current commit.show standing. Powered by the `badge` Edge Function
// which serves a dynamic SVG.

import { useState } from 'react'
import { SUPABASE_URL } from '../lib/supabase'

interface Props {
  projectId: string
  projectName: string
}

type Style = 'flat' | 'pill'

export function BadgeSnippet({ projectId, projectName }: Props) {
  const [style, setStyle] = useState<Style>('flat')
  const [copied, setCopied] = useState<'md' | 'html' | null>(null)

  const badgeUrl = `${SUPABASE_URL}/functions/v1/badge?project=${projectId}&style=${style}`
  const projectUrl = `https://commit.show/projects/${projectId}`
  const altText = `${projectName} on commit.show`

  const markdown = `[![${altText}](${badgeUrl})](${projectUrl})`
  const html = `<a href="${projectUrl}"><img src="${badgeUrl}" alt="${altText}" /></a>`

  const copy = async (which: 'md' | 'html', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="card-navy p-5" style={{ borderRadius: '2px' }}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
            // README BADGE
          </div>
          <h3 className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>
            Show your score on GitHub
          </h3>
          <p className="font-light text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Drop this into your repo's README — it updates automatically as your score moves.
          </p>
        </div>
        <div className="flex gap-1">
          <StyleChip active={style === 'flat'} onClick={() => setStyle('flat')}>FLAT</StyleChip>
          <StyleChip active={style === 'pill'} onClick={() => setStyle('pill')}>PILL</StyleChip>
        </div>
      </div>

      {/* Live preview */}
      <div
        className="flex items-center justify-center p-6 mb-4"
        style={{
          background: 'rgba(6,12,26,0.45)',
          border: '1px solid rgba(255,255,255,0.06)',
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

      {/* Markdown snippet */}
      <SnippetRow
        label="MARKDOWN"
        value={markdown}
        copied={copied === 'md'}
        onCopy={() => copy('md', markdown)}
      />
      <div className="h-2" />
      <SnippetRow
        label="HTML"
        value={html}
        copied={copied === 'html'}
        onCopy={() => copy('html', html)}
      />
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

function SnippetRow({ label, value, copied, onCopy }: {
  label: string; value: string; copied: boolean; onCopy: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
          {label}
        </span>
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
          background: 'rgba(6,12,26,0.6)',
          color: 'var(--text-primary)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '2px',
          whiteSpace: 'pre',
          // pre + whiteSpace:pre + no max-width was expanding its parent
          // grid column on the project detail page (own-project view only,
          // because BadgeSnippet only renders for isOwner). max-width: 100%
          // pins the box to the column · overflow-x-auto scrolls inside.
          maxWidth: '100%',
        }}
      >
        {value}
      </pre>
    </div>
  )
}
