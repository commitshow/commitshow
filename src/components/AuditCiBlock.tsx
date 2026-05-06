// AuditCiBlock — copy-paste GitHub Action snippet that re-runs the
// audit on every pull request. Surfaces in two places (audit result
// card + the /audit explainer page) so beginners see CI as part of
// the "what to do next" flow rather than a separate concept.
//
// The action lives at github.com/commitshow/audit-action and is
// listed on GitHub Marketplace as "commit.show audit". This block
// is the highest-intent funnel into adoption — it appears right
// next to the audit results that prompted the user to look at
// fixes in the first place.

import { useState } from 'react'

interface Props {
  githubUrl: string | null
  // Optional · slim-down variant for narrow contexts (e.g. /audit
  // page sidebar). Drops the longer pitch paragraph.
  compact?: boolean
}

const YAML = `name: audit
on: [pull_request]

permissions:
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: commitshow/audit-action@v1`

export function AuditCiBlock({ githubUrl, compact = false }: Props) {
  const [copied, setCopied] = useState(false)

  // GitHub-hosted only. The action is tied to GitHub Actions; nothing
  // useful to surface for projects that live on GitLab / Bitbucket.
  if (githubUrl !== null && githubUrl !== '' && !githubUrl.includes('github.com')) {
    return null
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(YAML)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = YAML
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div
      className="mt-6"
      style={{
        border: '1px solid rgba(240,192,64,0.25)',
        background: 'rgba(240,192,64,0.04)',
        borderRadius: '2px',
        padding: '20px',
      }}
    >
      <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
        CONTINUOUS AUDIT
      </div>
      <div className="font-light text-base mb-2" style={{ color: 'var(--cream)', lineHeight: 1.4 }}>
        Re-run this audit on every pull request
      </div>
      {!compact && (
        <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
          Drop this into{' '}
          <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '2px' }}>
            .github/workflows/audit.yml
          </code>{' '}
          in your repo. Every pull request gets the score and the top concerns posted as a sticky comment, so regressions surface during review instead of after merge.
        </p>
      )}
      <div className="relative">
        <pre
          className="font-mono text-[12px] leading-snug overflow-x-auto"
          style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '14px 16px',
            paddingRight: '90px',
            borderRadius: '2px',
            color: 'var(--cream)',
            whiteSpace: 'pre',
            margin: 0,
          }}
        >
          {YAML}
        </pre>
        <button
          onClick={copy}
          className="absolute top-3 right-3 font-mono text-[11px] font-medium tracking-wide px-3 py-1.5"
          style={{
            background: copied ? 'rgba(0,212,170,0.15)' : 'var(--gold-500)',
            color: copied ? '#00D4AA' : 'var(--navy-900)',
            border: copied ? '1px solid rgba(0,212,170,0.4)' : 'none',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ COPIED' : 'COPY'}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 font-mono text-[11px]">
        <a
          href="https://github.com/marketplace/actions/commit-show-audit"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-secondary)' }}
        >
          View on Marketplace ↗
        </a>
        <a
          href="https://github.com/commitshow/audit-action"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-secondary)' }}
        >
          Action source ↗
        </a>
      </div>
    </div>
  )
}
