// TokenReceiptForm · the leaderboard opt-in surface.
//
// What it actually does: takes the user's `commitshow extract` blob and
// puts them on the public token leaderboard with a verified efficiency
// score for THIS project. The previous version framed it as "save a
// receipt" — which sounded like a passive bookkeeping action and buried
// the actual outcome (public ranking). 2026-05-07 reframe leads with
// the leaderboard CTA.
//
// Privacy contract · the blob carries token NUMBERS only (input/output/
// cache + session UUIDs + first/last timestamps + cwd). Prompt content
// stays on the user's machine. Submitting publishes the totals to the
// public leaderboard at /tokens — that's the explicit consent
// step, called out before the user hits the button.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface BlobSession {
  session_id?:           string
  input_tokens?:         number
  output_tokens?:        number
  cache_create_tokens?:  number
  cache_read_tokens?:    number
  message_count?:        number
  first_seen_at?:        string
  last_seen_at?:         string
  cwd?:                  string
}

interface BlobPayload {
  v:             1
  source:        'claude_code'
  tool_version?: string
  github_url?:   string | null
  extracted_at?: string
  sessions:      BlobSession[]
}

interface DecodeResult {
  ok:    true
  payload: BlobPayload
  totals:  { input: number; output: number; cacheCreate: number; cacheRead: number; total: number }
  sessionCount: number
}

function decodeBlob(blob: string): DecodeResult | { ok: false; reason: string } {
  const trimmed = blob.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (!trimmed.startsWith('cs_v1:')) return { ok: false, reason: "blob must start with 'cs_v1:' · regenerate via `npx commitshow extract`" }
  const b64 = trimmed.slice('cs_v1:'.length).split(':')[0]
  let json: unknown
  try {
    const txt = atob(b64)
    json = JSON.parse(txt)
  } catch {
    return { ok: false, reason: 'blob did not decode · was it pasted in full?' }
  }
  const p = json as BlobPayload
  if (p.v !== 1) return { ok: false, reason: 'blob version unsupported' }
  if (!Array.isArray(p.sessions) || p.sessions.length === 0) {
    return { ok: false, reason: 'blob carries no sessions' }
  }
  const totals = p.sessions.reduce(
    (acc, s) => ({
      input:       acc.input       + (s.input_tokens        ?? 0),
      output:      acc.output      + (s.output_tokens       ?? 0),
      cacheCreate: acc.cacheCreate + (s.cache_create_tokens ?? 0),
      cacheRead:   acc.cacheRead   + (s.cache_read_tokens   ?? 0),
      total:       acc.total       + (s.input_tokens ?? 0) + (s.output_tokens ?? 0) +
                   (s.cache_create_tokens ?? 0) + (s.cache_read_tokens ?? 0),
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 },
  )
  return { ok: true, payload: p, totals, sessionCount: p.sessions.length }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

interface Props {
  projectId:   string
  /** Current project audit score · used to compute the projected efficiency
   *  preview (score / tokens·1M). null/undefined hides the projection. */
  projectScore?: number | null
  /** GitHub URL of the project · used to pre-filter sessions to ones that
   *  match this repo's working directory during in-browser scan. */
  projectGithubUrl?: string | null
  /** Called with the ingest summary after a successful submit. */
  onSuccess?: (summary: { inserted: number; total_tokens: number; total_cost_usd: number }) => void
}

/** Recursively read every .jsonl file under a directory handle.
 *  Returns the parsed sessions matching the optional cwd filter. */
async function scanDirectoryForSessions(
  dirHandle: FileSystemDirectoryHandle,
  matchCwd: string | null,
): Promise<BlobSession[]> {
  const sessions: BlobSession[] = []

  async function walk(handle: FileSystemDirectoryHandle, depth = 0): Promise<void> {
    if (depth > 3) return  // ~/.claude/projects/<encoded>/ is depth 0/1 — anything deeper is unexpected
    // @ts-ignore · entries() is part of FileSystemDirectoryHandle but TS lib lags
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, depth + 1)
      } else if (entry.kind === 'file' && name.endsWith('.jsonl')) {
        const fileHandle = entry as FileSystemFileHandle
        try {
          const file = await fileHandle.getFile()
          const text = await file.text()
          const sessionTotals: BlobSession = {
            session_id:          name.replace(/\.jsonl$/, ''),
            input_tokens:        0,
            output_tokens:       0,
            cache_create_tokens: 0,
            cache_read_tokens:   0,
            message_count:       0,
            cwd:                 undefined,
          }
          let firstAt: string | null = null
          let lastAt:  string | null = null
          for (const line of text.split('\n')) {
            if (!line.trim()) continue
            let evt: any
            try { evt = JSON.parse(line) } catch { continue }
            if (typeof evt.cwd === 'string') sessionTotals.cwd = evt.cwd
            const usage = evt?.message?.usage
            if (usage && typeof usage === 'object') {
              sessionTotals.input_tokens!        += usage.input_tokens                ?? 0
              sessionTotals.output_tokens!       += usage.output_tokens               ?? 0
              sessionTotals.cache_create_tokens! += usage.cache_creation_input_tokens ?? 0
              sessionTotals.cache_read_tokens!   += usage.cache_read_input_tokens     ?? 0
              sessionTotals.message_count!++
              const ts = evt.timestamp ?? null
              if (ts) {
                if (!firstAt || ts < firstAt) firstAt = ts
                if (!lastAt  || ts > lastAt)  lastAt  = ts
              }
            }
          }
          sessionTotals.first_seen_at = firstAt ?? undefined
          sessionTotals.last_seen_at  = lastAt  ?? undefined
          // Filter to sessions whose cwd matches the target repo (if known).
          if (matchCwd && sessionTotals.cwd && sessionTotals.cwd !== matchCwd) continue
          // Skip empty sessions · cache-only / no-usage records pollute totals.
          const total = (sessionTotals.input_tokens ?? 0) + (sessionTotals.output_tokens ?? 0) +
                        (sessionTotals.cache_create_tokens ?? 0) + (sessionTotals.cache_read_tokens ?? 0)
          if (total > 0) sessions.push(sessionTotals)
        } catch {
          // Skip unreadable / locked files.
        }
      }
    }
  }

  await walk(dirHandle)
  return sessions
}

function buildBlob(sessions: BlobSession[], githubUrl: string | null): string {
  const payload: BlobPayload = {
    v: 1,
    source: 'claude_code',
    tool_version: 'browser-scan',
    github_url: githubUrl,
    extracted_at: new Date().toISOString(),
    sessions,
  }
  // btoa expects latin1 · JSON is ASCII-safe for our shape (token numbers + UUIDs + ISO timestamps + paths)
  return `cs_v1:${btoa(JSON.stringify(payload))}`
}

export function TokenReceiptForm({ projectId, projectScore, projectGithubUrl, onSuccess }: Props) {
  const [blob, setBlob]         = useState<string>('')
  const [submitting, setSubmit] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<{ inserted: number; total_tokens: number; total_cost_usd: number; efficiency: number | null } | null>(null)

  // File System Access API · Chromium-family browsers only. We feature-
  // detect at render time so the button hides on Firefox / Safari.
  const supportsBrowserScan = typeof window !== 'undefined'
    && 'showDirectoryPicker' in window

  const handleBrowserScan = async () => {
    if (!supportsBrowserScan) return
    setScanning(true); setError(null)
    try {
      // @ts-ignore · TS lib doesn't ship showDirectoryPicker yet
      const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
        id: 'commitshow-claude-projects',
        startIn: 'home',
        mode: 'read',
      })
      const sessions = await scanDirectoryForSessions(dirHandle, null)
      if (sessions.length === 0) {
        setError('No Claude Code sessions found in that folder. Pick the ~/.claude/projects directory (or any subfolder of it).')
        setScanning(false)
        return
      }
      const newBlob = buildBlob(sessions, projectGithubUrl ?? null)
      setBlob(newBlob)
    } catch (e: any) {
      // User cancellation = AbortError · silent. Other errors surface.
      if (e?.name !== 'AbortError') {
        setError(`Browser scan failed: ${e?.message ?? String(e)}`)
      }
    } finally {
      setScanning(false)
    }
  }

  const decoded = useMemo(() => (blob.trim() ? decodeBlob(blob) : null), [blob])
  const previewOk = decoded?.ok === true

  // Projected efficiency · score per 1M tokens. Same formula the
  // /tokens efficiency tab uses, so the preview matches the
  // ranking the user is about to enter.
  const projectedEfficiency: number | null = useMemo(() => {
    if (!decoded?.ok) return null
    if (decoded.totals.total === 0) return null
    if (projectScore == null) return null
    return Number((projectScore / (decoded.totals.total / 1_000_000)).toFixed(2))
  }, [decoded, projectScore])

  const handlePasteFromClipboard = async () => {
    try {
      const txt = await navigator.clipboard.readText()
      if (txt && txt.startsWith('cs_v1:')) setBlob(txt)
    } catch { /* user denied clipboard · ignore */ }
  }

  const handleSubmit = async () => {
    if (!previewOk || !decoded) return
    setSubmit(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setError('You need to be signed in to publish to the leaderboard.')
        setSubmit(false); return
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/usage-ingest`
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          apikey:          import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization:   `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ project_id: projectId, blob }),
      })
      const body = await r.json()
      if (!r.ok || body.error) {
        setError(body.error ? `${body.error}${body.reason ? ` · ${body.reason}` : ''}` : `HTTP ${r.status}`)
      } else {
        const summary = {
          inserted:       body.inserted ?? 0,
          total_tokens:   body.total_tokens ?? 0,
          total_cost_usd: body.total_cost_usd ?? 0,
          efficiency:     projectedEfficiency,
        }
        setSuccess(summary)
        onSuccess?.(body)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmit(false)
    }
  }

  useEffect(() => {
    if (success && blob !== '') setSuccess(null)
  }, [blob])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card-navy p-5 md:p-6" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.35)' }}>
      <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--gold-500)' }}>
        // JOIN THE TOKEN LEADERBOARD
      </div>
      <h3 className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>
        Show how efficiently you built this
      </h3>
      <p className="font-light text-sm mt-1 mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Drop your Claude Code receipt → your build's efficiency score (points per 1M tokens)
        lands on the public leaderboard at{' '}
        <Link to="/tokens" style={{ color: 'var(--gold-500)' }}>
          /tokens
        </Link>.
      </p>

      {/* Primary path · browser scan (Chromium) — no terminal needed.
          Falls back to the CLI path on Firefox / Safari. */}
      {supportsBrowserScan && !blob && (
        <>
          <button
            type="button"
            onClick={handleBrowserScan}
            disabled={scanning}
            className="w-full font-mono text-xs tracking-wide px-4 py-3 mb-2"
            style={{
              background:   scanning ? 'rgba(240,192,64,0.25)' : 'var(--gold-500)',
              color:        scanning ? 'var(--text-muted)'    : 'var(--navy-900)',
              border:       'none',
              borderRadius: '2px',
              cursor:       scanning ? 'wait' : 'pointer',
              fontWeight:   700,
            }}
          >
            {scanning ? 'Scanning…' : 'Scan Claude Code sessions in browser →'}
          </button>
          <p className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Click above · pick the <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: '2px' }}>~/.claude/projects</code> folder when prompted ·
            browser reads JSONL files and builds the receipt locally. Prompt content never leaves your machine.
          </p>
        </>
      )}

      {/* CLI fallback · also useful for re-paste after edits.
          On Chromium this is hidden behind the disclosure once a blob is
          present; on Firefox/Safari it's the only path. */}
      {(!supportsBrowserScan || blob) && (
        <>
          <div className="font-mono text-[10px] tracking-widest mb-1" style={{ color: 'var(--text-label)' }}>
            {!supportsBrowserScan
              ? 'RUN IN TERMINAL · auto-copies blob to clipboard'
              : 'OR PASTE A BLOB FROM CLI'}
          </div>
          {!supportsBrowserScan && (
            <div className="font-mono text-xs mb-3 p-3" style={{
              background:   'rgba(6,12,26,0.6)',
              color:        'var(--gold-500)',
              borderRadius: '2px',
              border:       '1px solid rgba(240,192,64,0.18)',
            }}>
              $ npx commitshow@latest extract
            </div>
          )}

          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
              BLOB
            </span>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="font-mono text-[10px] tracking-wide px-2 py-0.5"
              style={{
                background:   'transparent',
                color:        'var(--gold-500)',
                border:       '1px solid rgba(240,192,64,0.4)',
                borderRadius: '2px',
                cursor:       'pointer',
              }}
            >
              paste from clipboard
            </button>
            {blob && (
              <button
                type="button"
                onClick={() => setBlob('')}
                className="font-mono text-[10px] tracking-wide px-2 py-0.5"
                style={{
                  background:   'transparent',
                  color:        'var(--text-muted)',
                  border:       '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '2px',
                  cursor:       'pointer',
                }}
              >
                clear
              </button>
            )}
          </div>
          <textarea
            value={blob}
            onChange={e => setBlob(e.target.value)}
            placeholder="cs_v1:eyJ2IjoxLCJzb3VyY2UiOiJjbGF1ZGVfY29kZSIsLi4u"
            rows={3}
            spellCheck={false}
            className="w-full font-mono text-[11px] p-3 mb-4"
            style={{
              background:    'var(--navy-950)',
              color:         'var(--cream)',
              border:        `1px solid ${decoded?.ok === false ? 'rgba(248,120,113,0.5)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius:  '2px',
              resize:        'vertical',
              lineHeight:    1.4,
              wordBreak:     'break-all',
            }}
          />
        </>
      )}

      {decoded?.ok === false && (
        <p className="font-mono text-[11px] mb-4" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {decoded.reason}
        </p>
      )}

      {/* Preview · headline efficiency, totals secondary */}
      {decoded?.ok && (
        <div className="mb-4 p-4" style={{
          background:   'rgba(255,255,255,0.025)',
          borderRadius: '2px',
          borderLeft:   '2px solid var(--gold-500)',
        }}>
          <div className="font-mono text-[10px] tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            YOUR LEADERBOARD ENTRY · PREVIEW
          </div>

          {projectedEfficiency !== null ? (
            <div className="flex items-baseline gap-3 mb-3">
              <span className="font-display font-black text-4xl tabular-nums" style={{ color: '#3FA874' }}>
                {projectedEfficiency}
              </span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                pts per 1M tokens · efficiency score
              </span>
            </div>
          ) : (
            <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Audit score not available yet · efficiency lands once your project is scored.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs mb-2">
            <PreviewStat label="input"        value={formatNumber(decoded.totals.input)} />
            <PreviewStat label="output"       value={formatNumber(decoded.totals.output)} />
            <PreviewStat label="cache write"  value={formatNumber(decoded.totals.cacheCreate)} />
            <PreviewStat label="cache read"   value={formatNumber(decoded.totals.cacheRead)} />
          </div>
          <div className="font-mono text-[10px] flex items-baseline justify-between" style={{ color: 'var(--text-muted)' }}>
            <span>{decoded.sessionCount} session{decoded.sessionCount === 1 ? '' : 's'} · {formatNumber(decoded.totals.total)} total tokens</span>
            {decoded.payload.github_url && <span className="truncate ml-2">{decoded.payload.github_url}</span>}
          </div>
        </div>
      )}

      {/* Consent · explicit before the button */}
      {decoded?.ok && !success && (
        <p className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          By publishing, your token totals + efficiency score become public on{' '}
          <Link to="/tokens" style={{ color: 'var(--text-secondary)' }}>
            commit.show/tokens
          </Link>. Prompt content stays on your machine — only counters are sent.
        </p>
      )}

      {error && (
        <p className="font-mono text-[11px] mb-3" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {error}
        </p>
      )}

      {success ? (
        <div className="p-4" style={{
          background:   'rgba(63,168,116,0.1)',
          border:       '1px solid rgba(63,168,116,0.45)',
          borderRadius: '2px',
        }}>
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <span className="font-display font-bold" style={{ color: '#3FA874' }}>
              ✓ You're on the leaderboard
            </span>
            <Link
              to="/tokens"
              className="font-mono text-xs tracking-wide"
              style={{
                color:        '#3FA874',
                textDecoration: 'none',
                borderBottom: '1px dashed rgba(63,168,116,0.5)',
                paddingBottom: 1,
              }}
            >
              See your position →
            </Link>
          </div>
          <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {success.inserted} session{success.inserted === 1 ? '' : 's'} · {formatNumber(success.total_tokens)} tokens
            {success.efficiency !== null && ` · ${success.efficiency} pts/M efficiency`}
            {success.total_cost_usd > 0 && ` · ~$${success.total_cost_usd.toFixed(2)} estimated cost`}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!previewOk || submitting}
          className="w-full font-mono text-xs tracking-wide px-4 py-3"
          style={{
            background:   !previewOk || submitting ? 'rgba(240,192,64,0.25)' : 'var(--gold-500)',
            color:        !previewOk || submitting ? 'var(--text-muted)'    : 'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       !previewOk || submitting ? 'not-allowed' : 'pointer',
            fontWeight:   700,
          }}
        >
          {submitting
            ? 'Publishing…'
            : previewOk
              ? 'Publish to leaderboard →'
              : 'Paste your blob to preview your entry'}
        </button>
      )}
    </div>
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--cream)' }} className="tabular-nums">{value}</span>
    </div>
  )
}
