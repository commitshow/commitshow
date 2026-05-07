// TokenReceiptForm · paste a `commitshow extract` blob to attach a
// verified Claude Code token receipt to your audition.
//
// Used in two surfaces:
//   1. Post-audition success view (AnalysisResultCard) · "you just
//      submitted · drop a receipt for your build's token usage"
//   2. ProjectDetailPage owner section · retroactive add or resubmit
//
// Privacy posture · the blob carries token NUMBERS only (input/output/
// cache + session UUIDs + first/last timestamps + cwd). Prompt content
// stays on the user's machine. We decode + preview client-side before
// the user confirms · so they can verify what's about to be uploaded.

import { useEffect, useMemo, useState } from 'react'
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
  projectId: string
  /** Called with the ingest summary after a successful submit. */
  onSuccess?: (summary: { inserted: number; total_tokens: number; total_cost_usd: number }) => void
  /** Hide the explanatory copy block · for compact placements. */
  compact?: boolean
}

export function TokenReceiptForm({ projectId, onSuccess, compact = false }: Props) {
  const [blob, setBlob]         = useState<string>('')
  const [submitting, setSubmit] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<{ inserted: number; total_tokens: number; total_cost_usd: number } | null>(null)

  const decoded = useMemo(() => (blob.trim() ? decodeBlob(blob) : null), [blob])
  const previewOk = decoded?.ok === true

  // Paste-from-clipboard helper · saves the user one extra step when they
  // just ran `npx commitshow extract` (which auto-copies the blob).
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
        setError('You need to be signed in to submit a token receipt.')
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
        setSuccess({
          inserted:       body.inserted ?? 0,
          total_tokens:   body.total_tokens ?? 0,
          total_cost_usd: body.total_cost_usd ?? 0,
        })
        onSuccess?.(body)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmit(false)
    }
  }

  // Reset success when blob changes · lets the user resubmit a fresh blob.
  useEffect(() => {
    if (success && blob !== '') setSuccess(null)
  }, [blob])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card-navy p-5 md:p-6" style={{ borderRadius: '2px', border: '1px solid rgba(240,192,64,0.22)' }}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // TOKEN RECEIPT · CLAUDE CODE
        </div>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          optional
        </span>
      </div>

      {!compact && (
        <p className="text-sm font-light mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Run this in any terminal to get your build's token receipt. Privacy: only counters
          leave your machine, prompt text stays local.
        </p>
      )}

      {!compact && (
        <div className="font-mono text-xs mb-4 p-3" style={{
          background: 'rgba(6,12,26,0.6)',
          color: 'var(--gold-500)',
          borderRadius: '2px',
          border: '1px solid rgba(240,192,64,0.18)',
        }}>
          $ npx commitshow@latest extract
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <label
          htmlFor="token-blob"
          className="font-mono text-[10px] tracking-widest"
          style={{ color: 'var(--text-label)' }}
        >
          PASTE BLOB
        </label>
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
          aria-label="Paste from clipboard"
        >
          paste from clipboard
        </button>
      </div>
      <textarea
        id="token-blob"
        value={blob}
        onChange={e => setBlob(e.target.value)}
        placeholder="cs_v1:eyJ2IjoxLCJzb3VyY2UiOiJjbGF1ZGVfY29kZSIsLi4u"
        rows={4}
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

      {decoded && decoded.ok === false && (
        <p className="font-mono text-[11px] mb-4" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {decoded.reason}
        </p>
      )}

      {decoded?.ok && (
        <div className="mb-4 p-3" style={{ background: 'rgba(255,255,255,0.025)', borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            PREVIEW · {decoded.sessionCount} session{decoded.sessionCount === 1 ? '' : 's'}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
            <PreviewStat label="input"        value={formatNumber(decoded.totals.input)} />
            <PreviewStat label="output"       value={formatNumber(decoded.totals.output)} />
            <PreviewStat label="cache write"  value={formatNumber(decoded.totals.cacheCreate)} />
            <PreviewStat label="cache read"   value={formatNumber(decoded.totals.cacheRead)} />
          </div>
          <div className="font-mono text-xs mt-2 flex items-baseline justify-between">
            <span style={{ color: 'var(--text-muted)' }}>total</span>
            <span style={{ color: 'var(--gold-500)' }} className="font-bold tabular-nums">
              {formatNumber(decoded.totals.total)}
            </span>
          </div>
          {decoded.payload.github_url && (
            <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
              repo: {decoded.payload.github_url}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="font-mono text-[11px] mb-3" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {error}
        </p>
      )}

      {success ? (
        <div className="font-mono text-xs p-3" style={{
          background:    'rgba(63,168,116,0.08)',
          color:         '#3FA874',
          borderRadius:  '2px',
          border:        '1px solid rgba(63,168,116,0.35)',
        }}>
          ✓ Saved · {success.inserted} session{success.inserted === 1 ? '' : 's'} ·
          {' '}{formatNumber(success.total_tokens)} tokens · ~${success.total_cost_usd.toFixed(2)}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!previewOk || submitting}
          className="font-mono text-xs tracking-wide px-4 py-2"
          style={{
            background:   !previewOk || submitting ? 'rgba(240,192,64,0.25)' : 'var(--gold-500)',
            color:        !previewOk || submitting ? 'var(--text-muted)'    : 'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       !previewOk || submitting ? 'not-allowed' : 'pointer',
            fontWeight:   600,
          }}
        >
          {submitting ? 'Saving…' : 'Save receipt →'}
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
