// AuditCiBlock — one-click GitHub Action installer.
//
// 2026-05-07 simplification: previous version dumped a YAML snippet and
// a COPY button, expecting the user to know to navigate to their repo,
// click "Create new file", paste at .github/workflows/audit.yml, commit.
// 8 steps. Friction killed adoption.
//
// New flow uses GitHub's "new file" deep-link · clicking the button
// opens a pre-filled "Create new file" page in the user's repo with:
//   · path  = .github/workflows/audit.yml
//   · body  = the workflow YAML
// User just clicks "Commit new file" at the bottom. 1 click + 1 commit
// = CI active.
//
// Fallback when no githubUrl is known (e.g. /audit explainer page) ·
// surface the YAML + a copy button + clear "what to do" instructions.

import { useState } from 'react'

interface Props {
  githubUrl: string | null
  /** Slim-down variant for narrow contexts (e.g. /audit sidebar). */
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

const FILE_PATH = '.github/workflows/audit.yml'

// Parse owner/repo from a GitHub URL · used to build the deep-link.
// Handles all the canonical forms (https/http · with/without .git).
function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[#?]|$)/i)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

// Construct the GitHub "new file" deep-link · pre-fills path + content.
// Branch defaults to main; GitHub auto-corrects if the repo's default
// is master/dev/etc by showing the actual branch in its UI.
function buildInstallLink(githubUrl: string): string | null {
  const repo = parseRepo(githubUrl)
  if (!repo) return null
  const url = new URL(`https://github.com/${repo.owner}/${repo.repo}/new/main`)
  url.searchParams.set('filename', FILE_PATH)
  url.searchParams.set('value',    YAML)
  url.searchParams.set('message',  'Add commit.show audit on PR')
  url.searchParams.set('description', 'Audit every pull request via commitshow/audit-action')
  return url.toString()
}

export function AuditCiBlock({ githubUrl, compact = false }: Props) {
  const [copied, setCopied] = useState(false)
  const [showYaml, setShowYaml] = useState(false)

  // GitHub-hosted only. The action is tied to GitHub Actions; nothing
  // useful to surface for projects on GitLab / Bitbucket.
  if (githubUrl !== null && githubUrl !== '' && !githubUrl.includes('github.com')) {
    return null
  }

  const installLink = githubUrl ? buildInstallLink(githubUrl) : null

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
      className="mt-6 p-5 md:p-6"
      style={{
        border:        '1px solid rgba(240,192,64,0.32)',
        background:    'rgba(240,192,64,0.04)',
        borderRadius:  '2px',
      }}
    >
      <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
        // CI · AUDIT EVERY PR
      </div>
      <div className="font-display font-bold text-lg mb-1" style={{ color: 'var(--cream)' }}>
        Audit every pull request automatically
      </div>
      {!compact && (
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
          One click installs a GitHub Action that runs this audit on every PR and posts the score + top concerns
          as a sticky comment. Regressions surface during review, not after merge.
        </p>
      )}

      {/* Primary CTA · deep-link to GitHub "new file" with everything pre-filled */}
      {installLink ? (
        <a
          href={installLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block w-full sm:w-auto font-mono text-xs tracking-wide px-5 py-3 text-center"
          style={{
            background:     'var(--gold-500)',
            color:          'var(--navy-900)',
            border:         'none',
            borderRadius:   '2px',
            textDecoration: 'none',
            fontWeight:     700,
          }}
        >
          Install on GitHub →
        </a>
      ) : (
        // No githubUrl context · /audit explainer page hits this branch.
        // Lead with copy CTA · still single-button.
        <button
          type="button"
          onClick={copy}
          className="w-full sm:w-auto font-mono text-xs tracking-wide px-5 py-3"
          style={{
            background:   copied ? 'rgba(0,212,170,0.15)' : 'var(--gold-500)',
            color:        copied ? '#00D4AA'             : 'var(--navy-900)',
            border:       copied ? '1px solid rgba(0,212,170,0.45)' : 'none',
            borderRadius: '2px',
            cursor:       'pointer',
            fontWeight:   700,
          }}
        >
          {copied ? '✓ Copied · paste at .github/workflows/audit.yml' : 'Copy workflow YAML →'}
        </button>
      )}

      {/* Inline next-step copy that explains exactly what's about to happen */}
      <p className="font-mono text-[11px] mt-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {installLink
          ? <>You'll land on GitHub's "Create new file" page with <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: '2px' }}>{FILE_PATH}</code> pre-filled. Just click <strong>Commit new file</strong> · CI is live on the next PR.</>
          : <>Drop the YAML into <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: '2px' }}>{FILE_PATH}</code> in your repo · commit · CI is live on the next PR.</>
        }
      </p>

      {/* Secondary · disclose YAML for users who want to read/edit before installing */}
      <button
        type="button"
        onClick={() => setShowYaml(s => !s)}
        className="font-mono text-[10px] tracking-widest mt-4"
        style={{
          background:   'transparent',
          color:        'var(--text-muted)',
          border:       'none',
          padding:      0,
          cursor:       'pointer',
        }}
      >
        {showYaml ? '▾ HIDE YAML' : '▸ VIEW YAML'}
      </button>

      {showYaml && (
        <div className="relative mt-2">
          <pre
            className="font-mono text-[12px] leading-snug overflow-x-auto"
            style={{
              background:   'rgba(0,0,0,0.3)',
              padding:      '14px 16px',
              paddingRight: '90px',
              borderRadius: '2px',
              color:        'var(--cream)',
              whiteSpace:   'pre',
              margin:       0,
            }}
          >
            {YAML}
          </pre>
          <button
            onClick={copy}
            className="absolute top-3 right-3 font-mono text-[11px] tracking-wide px-3 py-1.5"
            style={{
              background:   copied ? 'rgba(0,212,170,0.15)' : 'transparent',
              color:        copied ? '#00D4AA'             : 'var(--gold-500)',
              border:       `1px solid ${copied ? 'rgba(0,212,170,0.4)' : 'rgba(240,192,64,0.4)'}`,
              borderRadius: '2px',
              cursor:       'pointer',
            }}
          >
            {copied ? '✓ COPIED' : 'COPY'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 font-mono text-[10px]">
        <a
          href="https://github.com/marketplace/actions/commit-show-audit"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)' }}
        >
          View on Marketplace ↗
        </a>
        <a
          href="https://github.com/commitshow/audit-action"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)' }}
        >
          Action source ↗
        </a>
      </div>
    </div>
  )
}
