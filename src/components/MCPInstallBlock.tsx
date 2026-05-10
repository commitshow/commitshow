// MCPInstallBlock — "audit this from your AI tools" footer for
// ProjectDetailPage and any page where surfacing the four-surface
// distribution story makes sense (web · CLI · MCP · GitHub Action).
//
// Shape: subtle gold-trimmed block with three collapsible code
// snippets. Tabs default to MCP (the newest surface) but the user
// can flip to CLI or Action without leaving the page. No copy
// button magic — the snippets are short enough that select-all-copy
// is the natural gesture, and select highlight already works.
//
// `slug` is the canonical owner/repo string when the project has a
// repo (full audit / CLI walk-on). For URL fast-lane projects we
// fall back to a placeholder so the install snippet still reads.

import { useState } from 'react'

interface Props {
  /** Canonical "owner/repo" string from project.github_url, or null
   *  for URL fast-lane projects. Null hides repo-specific tabs and
   *  shows only the MCP install block. */
  slug: string | null
}

type Tab = 'mcp' | 'cli' | 'action'

const GOLD = 'var(--gold-500)'
const NAVY = 'var(--navy-800)'

export function MCPInstallBlock({ slug }: Props) {
  const hasRepo = !!slug
  const [tab, setTab] = useState<Tab>('mcp')

  // Repo-less projects can only show MCP install — CLI/Action need
  // an owner/repo to point at. Force-clamp the tab in that case so
  // a stale state never renders an empty CLI snippet.
  const activeTab: Tab = hasRepo ? tab : 'mcp'
  const repoArg = slug ?? 'OWNER/REPO'

  return (
    <div className="mt-12 mb-4 px-5 py-5"
         style={{ background: 'rgba(15,32,64,0.45)', border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: GOLD }}>
        Audit this from your tools
      </div>
      <div className="font-light text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        Same audit, multiple surfaces — pick the one your runtime supports.
      </div>

      {hasRepo && (
        <div className="flex gap-1 mb-3 font-mono text-[10px] tracking-widest uppercase" role="tablist">
          <TabBtn active={activeTab === 'mcp'}    onClick={() => setTab('mcp')}>MCP</TabBtn>
          <TabBtn active={activeTab === 'cli'}    onClick={() => setTab('cli')}>CLI</TabBtn>
          <TabBtn active={activeTab === 'action'} onClick={() => setTab('action')}>GitHub Action</TabBtn>
        </div>
      )}

      {activeTab === 'mcp' && (
        <>
          {/* One-click install row · Cursor has a real deep-link
              scheme; Claude Code (the CLI) has a one-line `claude
              mcp add` command; Claude Desktop has no native deep
              link yet, so we offer copy-config as the closest thing
              to one-click for those hosts. */}
          <div className="grid sm:grid-cols-3 gap-2 mb-4">
            <PrimaryAddBtn href={CURSOR_DEEP_LINK} label="Add to Cursor" />
            <CopyBtn label="Add to Claude Code" copy={CLAUDE_CODE_CMD} okLabel="Command copied · paste in terminal" />
            <CopyBtn label="Add to Claude Desktop" copy={MCP_CONFIG} okLabel="Config copied · paste into claude_desktop_config.json" />
          </div>

          <CodeBlock
            label="~/.cursor/mcp.json · ~/Library/Application Support/Claude/claude_desktop_config.json · etc."
            code={MCP_CONFIG}
          />
          <p className="font-light text-[13px] mt-3 mb-1" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
            Or drop the snippet manually into any MCP host (Cline · Windsurf · Continue · …). Restart the app.
            {hasRepo && <> Then ask Claude / Cursor:{' '}
              <code style={{ color: 'var(--cream)', background: NAVY, padding: '1px 6px', borderRadius: '2px', fontFamily: 'DM Mono, monospace', fontSize: '0.92em' }}>
                audit {repoArg} via commit.show
              </code>
            </>}
          </p>
          <Hint>3 tools exposed: <code style={hintCodeStyle}>audit_repo</code> · <code style={hintCodeStyle}>project_status</code> · <code style={hintCodeStyle}>fetch_docs</code></Hint>
          <Links
            primary={{ href: 'https://www.npmjs.com/package/commitshow-mcp', label: 'commitshow-mcp on npm ↗' }}
            secondary={{ href: 'https://github.com/commitshow/cli/tree/main/mcp', label: 'Full setup guide ↗' }}
          />
        </>
      )}

      {activeTab === 'cli' && hasRepo && (
        <>
          <CodeBlock
            label="terminal"
            code={`npx commitshow@latest audit github.com/${repoArg}`}
          />
          <p className="font-light text-[13px] mt-3" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
            Runs the audit and writes <code style={hintCodeStyle}>.commitshow/audit.&#123;md,json&#125;</code> next to your code so the next AI turn can read it.
          </p>
          <Hint>Add <code style={hintCodeStyle}>--json</code> for stable agent output · <code style={hintCodeStyle}>--workspace path</code> for monorepos</Hint>
          <Links
            primary={{ href: 'https://www.npmjs.com/package/commitshow', label: 'commitshow on npm ↗' }}
            secondary={{ href: 'https://github.com/commitshow/cli', label: 'CLI repo ↗' }}
          />
        </>
      )}

      {activeTab === 'action' && hasRepo && (
        <>
          <CodeBlock
            label=".github/workflows/audit.yml"
            code={ACTION_YAML}
          />
          <p className="font-light text-[13px] mt-3" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
            Sticky PR comment with the score + delta on every pull request. No keys to configure.
          </p>
          <Links
            primary={{ href: 'https://github.com/marketplace/actions/commit-show-audit', label: 'Marketplace listing ↗' }}
            secondary={{ href: 'https://github.com/commitshow/audit-action', label: 'Action repo ↗' }}
          />
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────

const MCP_CONFIG = `{
  "mcpServers": {
    "commitshow": {
      "command": "npx",
      "args": ["-y", "commitshow-mcp"]
    }
  }
}`

// Cursor's official MCP deep-link scheme · `name=` is the human label
// that appears in the install dialog, `config=` is base64-encoded JSON
// of the server entry alone (not the wrapping mcpServers object).
// btoa is the canonical browser global; encodeURIComponent guards
// against any byte landing inside the URL parser.
const CURSOR_CONFIG_B64 = (typeof btoa !== 'undefined')
  ? btoa(JSON.stringify({ command: 'npx', args: ['-y', 'commitshow-mcp'] }))
  : 'eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvbW1pdHNob3ctbWNwIl19'
const CURSOR_DEEP_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=commitshow&config=${encodeURIComponent(CURSOR_CONFIG_B64)}`

// Claude Code (Anthropic's terminal CLI · `claude` binary) has a
// single-shot install: `claude mcp add <name> -- <command> [args...]`.
// User pastes once, no JSON editing.
const CLAUDE_CODE_CMD = 'claude mcp add commitshow -- npx -y commitshow-mcp'

const ACTION_YAML = `name: commit.show audit
on:
  pull_request:
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: commitshow/audit-action@v1`

const hintCodeStyle: React.CSSProperties = {
  color: 'var(--cream)',
  fontFamily: 'DM Mono, monospace',
  fontSize: '0.88em',
  background: 'rgba(15,32,64,0.6)',
  padding: '1px 5px',
  borderRadius: '2px',
}

function PrimaryAddBtn({ href, label }: { href: string; label: string }) {
  return (
    <a href={href}
       className="block text-center px-3 py-2.5 font-mono text-[12px] tracking-widest uppercase font-bold"
       style={{
         background: GOLD,
         color: 'var(--navy-900)',
         border: `1px solid ${GOLD}`,
         borderRadius: '2px',
         textDecoration: 'none',
       }}>
      {label} →
    </a>
  )
}

// Two-state copy button · OK label briefly replaces the regular one
// after a successful clipboard write so the user sees confirmation.
// Clipboard API is available in all modern browsers we target; falls
// back silently to a no-op label change if it isn't.
function CopyBtn({ label, copy, okLabel }: { label: string; copy: string; okLabel: string }) {
  const [done, setDone] = useState(false)
  const onClick = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(copy)
      }
      setDone(true)
      setTimeout(() => setDone(false), 2400)
    } catch {
      setDone(true)
      setTimeout(() => setDone(false), 2400)
    }
  }
  return (
    <button onClick={onClick}
            className="px-3 py-2.5 font-mono text-[11px] tracking-widest uppercase text-center"
            style={{
              background: 'transparent',
              color: done ? GOLD : 'var(--cream)',
              border: `1px solid ${done ? GOLD : 'rgba(255,255,255,0.18)'}`,
              borderRadius: '2px',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}>
      {done ? okLabel : label}
    </button>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="px-3 py-1.5"
      style={{
        background: active ? `${GOLD}` : 'transparent',
        color:      active ? 'var(--navy-900)' : 'var(--text-muted)',
        border:     active ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.08)',
        borderRadius: '2px',
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] mb-1" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <pre className="px-4 py-3 overflow-x-auto"
           style={{
             background: 'rgba(6,12,26,0.85)',
             border: '1px solid rgba(240,192,64,0.18)',
             borderRadius: '2px',
             fontFamily: 'DM Mono, monospace',
             fontSize: '12.5px',
             lineHeight: 1.55,
             color: 'var(--cream)',
             margin: 0,
           }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

function Links({ primary, secondary }: {
  primary:   { href: string; label: string };
  secondary: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap gap-4 mt-3 font-mono text-[11px]">
      <a href={primary.href}   target="_blank" rel="noopener noreferrer" style={{ color: GOLD }}>{primary.label}</a>
      <a href={secondary.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>{secondary.label}</a>
    </div>
  )
}
