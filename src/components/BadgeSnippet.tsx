// README badge snippet · owner-only tool to grab a markdown embed for the
// project's current commit.show standing. Powered by the `badge` Edge Function
// which serves a dynamic SVG.
//
// 2026-05-07 v2: GitHub deep-link CTA when we know the repo URL. Earlier
// version stopped at "copy markdown" — user had to navigate to GitHub,
// open README, scroll, paste, commit. Now a single click opens GitHub's
// edit page for README.md AND auto-copies the markdown · user just hits
// ⌘V at the top of the file and commits. Fallback for repos without a
// README points at /new/<branch>?filename=README.md with the badge
// pre-filled.

import { useState } from 'react'
import { SUPABASE_URL } from '../lib/supabase'

interface Props {
  projectId:   string
  projectName: string
  /** Canonical URL slug · README link target prefers this over the
   *  UUID for cleaner display. Null falls back to /projects/<uuid>. */
  projectSlug?: string | null
  /** Canonical https://github.com/owner/repo URL · enables the
   *  one-click "Open README" deep-link. Null falls back to the
   *  copy-only flow used on the /audit explainer page. */
  githubUrl?:  string | null
}

function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[#?]|$)/i)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

type Style = 'flat' | 'pill'

export function BadgeSnippet({ projectId, projectName, projectSlug, githubUrl }: Props) {
  const [style, setStyle]       = useState<Style>('flat')
  const [showMore, setShowMore] = useState(false)
  const [copied, setCopied]     = useState<'md' | 'html' | null>(null)

  const badgeUrl   = `${SUPABASE_URL}/functions/v1/badge?project=${projectId}&style=${style}`
  // Prefer slug · cleaner README link target than UUID. UUID fallback
  // keeps legacy embeds working for projects without a backfilled slug.
  const projectUrl = `https://commit.show/projects/${projectSlug ?? projectId}`
  const altText    = `${projectName} on commit.show`

  const markdown = `[![${altText}](${badgeUrl})](${projectUrl})`
  const html     = `<a href="${projectUrl}"><img src="${badgeUrl}" alt="${altText}" /></a>`

  // GitHub deep-link · /edit/ for existing READMEs (clipboard auto-copy
  // before the new tab opens lets the user just ⌘V at the top). /new/
  // for repos without a README · pre-fills the badge + title.
  const repo = githubUrl ? parseRepo(githubUrl) : null
  const editReadmeUrl = repo
    ? `https://github.com/${repo.owner}/${repo.repo}/edit/main/README.md`
    : null
  const newReadmeUrl = repo
    ? (() => {
        const u = new URL(`https://github.com/${repo.owner}/${repo.repo}/new/main`)
        u.searchParams.set('filename', 'README.md')
        u.searchParams.set('value',    `${markdown}\n\n# ${projectName}\n`)
        u.searchParams.set('message',  'Add commit.show audit badge')
        return u.toString()
      })()
    : null

  const copy = async (which: 'md' | 'html', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1800)
  }

  // Click handler for the primary CTA · clipboard write must be sync
  // inside the user gesture, then we open the new tab.
  const handleOpenReadme = async () => {
    try { await navigator.clipboard.writeText(markdown) }
    catch { /* user can still copy manually below */ }
    setCopied('md')
    setTimeout(() => setCopied(null), 4000)
    if (editReadmeUrl) window.open(editReadmeUrl, '_blank', 'noopener,noreferrer')
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
        {editReadmeUrl
          ? 'Click below · GitHub opens your README in edit mode and the badge markdown is in your clipboard. Paste at the top, commit. Done.'
          : 'One copy, one paste in your README. The badge auto-updates as your score moves.'}
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

      {/* Primary CTA · GitHub deep-link when we know the repo, copy-only otherwise */}
      {editReadmeUrl ? (
        <button
          type="button"
          onClick={handleOpenReadme}
          className="w-full font-mono text-xs tracking-wide px-4 py-3 mb-2"
          style={{
            background:   primaryCopied ? 'rgba(0,212,170,0.15)' : 'var(--gold-500)',
            color:        primaryCopied ? '#00D4AA'              : 'var(--navy-900)',
            border:       primaryCopied ? '1px solid rgba(0,212,170,0.5)' : 'none',
            borderRadius: '2px',
            cursor:       'pointer',
            fontWeight:   700,
          }}
        >
          {primaryCopied ? '✓ Markdown copied · paste at top of README on the GitHub tab' : 'Open README on GitHub →'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => copy('md', markdown)}
          className="w-full font-mono text-xs tracking-wide px-4 py-3 mb-2"
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
      )}

      {/* Fallback for repos without a README · smaller secondary link */}
      {newReadmeUrl && (
        <a
          href={newReadmeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] mb-3"
          style={{
            color:        'var(--text-muted)',
            textDecoration: 'none',
            paddingBottom: 1,
          }}
        >
          No README yet? <span style={{ color: 'var(--gold-500)', borderBottom: '1px dashed rgba(240,192,64,0.5)' }}>Create one with the badge →</span>
        </a>
      )}

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
