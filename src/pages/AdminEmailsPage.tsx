// /admin/emails — admin-only editor for email_templates.
//
// Three columns:
//   1. Left rail · list of kinds (welcome, audit_complete, …) · click to load
//   2. Middle · form (subject, html, text, enabled) + Save / Send test
//   3. Right · last 10 notification_log rows for this kind
//
// Edits write directly to public.email_templates (admin-only RLS already
// enforces this · same policy used by the dispatch fn). "Send test" calls
// dispatch_email() for the kind against the admin's own member row, so we
// can sanity-check the rendered HTML in our own inbox without faking
// signups.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

interface Template {
  kind:        string
  subject:     string
  html_body:   string
  text_body:   string | null
  variables:   string[]
  enabled:     boolean
  description: string | null
  updated_at:  string
}

interface LogRow {
  id:             string
  created_at:     string
  recipient_addr: string
  status:         string
  error_message:  string | null
  provider_id:    string | null
}

// Inner panel · the 3-column editor without the page chrome. Embedded
// as a tab inside /admin AND mounted as the body of /admin/emails so
// either entry point shows the same UI.
export function EmailTemplatesPanel() {
  const { user, member } = useAuth()
  const isAdmin = !!member?.is_admin

  const [templates, setTemplates] = useState<Template[]>([])
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const [draft, setDraft] = useState<Template | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<LogRow[]>([])
  // Test-send recipient · default to han@commit.show (the operations
  // monitoring inbox) so every admin sees their tests in one place
  // regardless of which auth account they're logged in as.
  const [testRecipient, setTestRecipient] = useState('han@commit.show')

  // Initial load
  useEffect(() => {
    if (!isAdmin) return
    void reloadTemplates()
  }, [isAdmin])

  // Load logs when active kind changes
  useEffect(() => {
    if (!activeKind || !isAdmin) { setLogs([]); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('notification_log')
        .select('id, created_at, recipient_addr, status, error_message, provider_id')
        .eq('kind', activeKind)
        .order('created_at', { ascending: false })
        .limit(10)
      if (!alive) return
      setLogs((data as LogRow[]) ?? [])
    })()
    return () => { alive = false }
  }, [activeKind, isAdmin, savedAt])

  const reloadTemplates = async () => {
    const { data, error: e } = await supabase
      .from('email_templates')
      .select('*')
      .order('kind')
    if (e) { setError(e.message); return }
    const rows = (data as Template[]) ?? []
    setTemplates(rows)
    if (rows.length > 0 && !activeKind) {
      setActiveKind(rows[0].kind)
      setDraft(rows[0])
    } else if (activeKind) {
      const found = rows.find(t => t.kind === activeKind)
      if (found) setDraft(found)
    }
  }

  const selectKind = (kind: string) => {
    const row = templates.find(t => t.kind === kind)
    if (!row) return
    setActiveKind(kind)
    setDraft(row)
    setError(null)
    setSavedAt(null)
  }

  const onSave = async () => {
    if (!draft || !user) return
    setBusy(true); setError(null)
    const { error: e } = await supabase
      .from('email_templates')
      .update({
        subject:     draft.subject,
        html_body:   draft.html_body,
        text_body:   draft.text_body,
        enabled:     draft.enabled,
        description: draft.description,
        updated_by:  user.id,
        updated_at:  new Date().toISOString(),
      })
      .eq('kind', draft.kind)
    setBusy(false)
    if (e) { setError(e.message); return }
    setSavedAt(new Date().toLocaleTimeString())
    void reloadTemplates()
  }

  // Send a test rendering of the current draft to the admin's own
  // member row. Uses dispatch_email() RPC so we exercise the same code
  // path real triggers go through (template load → var substitution →
  // send-email → Resend → notification_log).
  const onSendTest = async () => {
    if (!draft || !user) return
    const target = testRecipient.trim()
    if (!target) { setError('Recipient empty'); return }
    setBusy(true); setError(null)
    // Build a stub payload so admin sees how the template handles
    // missing-data (each var renders as `[var]`).
    const payload: Record<string, string> = {}
    draft.variables.forEach(v => { payload[v] = `[${v}]` })
    const { error: e } = await supabase.rpc('dispatch_email', {
      p_kind:                     draft.kind,
      p_recipient_id:             user.id,
      p_payload:                  payload,
      p_dedupe_suffix:            `admin_test_${Date.now()}`,
      p_recipient_addr_override:  target,
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setSavedAt(`test sent to ${target} · ${new Date().toLocaleTimeString()}`)
    // Reload logs to surface the new row immediately.
    setActiveKind(activeKind)
  }

  if (!isAdmin) return null

  return (
    <div>
      <p className="font-mono text-[11px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        kind 별 메시지 편집 · 보내는 시점은 DB 트리거가 결정. 새 kind 추가는 마이그레이션 + 트리거 작업 필요.
      </p>
      <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)_280px]">
          {/* Left rail · kind list */}
          <aside className="card-navy p-3" style={{ borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Templates</div>
            <ol className="grid gap-1">
              {templates.map(t => {
                const isActive = t.kind === activeKind
                return (
                  <li key={t.kind}>
                    <button
                      type="button"
                      onClick={() => selectKind(t.kind)}
                      className="w-full text-left px-2 py-1.5 font-mono text-xs"
                      style={{
                        background:   isActive ? 'rgba(240,192,64,0.10)' : 'transparent',
                        border:       `1px solid ${isActive ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.06)'}`,
                        color:        isActive ? 'var(--gold-500)' : 'var(--cream)',
                        borderRadius: '2px',
                        cursor:       'pointer',
                      }}
                    >
                      <div className="font-medium truncate">{t.kind}</div>
                      <div className="font-mono text-[10px] mt-0.5" style={{ color: t.enabled ? '#00D4AA' : 'var(--text-faint)' }}>
                        {t.enabled ? 'enabled' : 'disabled'}
                      </div>
                    </button>
                  </li>
                )
              })}
              {templates.length === 0 && (
                <li className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>no templates yet</li>
              )}
            </ol>
          </aside>

          {/* Middle · editor form */}
          <main>
            {draft ? (
              <div className="card-navy p-4 grid gap-3" style={{ borderRadius: '2px' }}>
                <FieldLabel label="Kind">
                  <input value={draft.kind} disabled className="w-full px-2 py-1.5 font-mono text-xs" />
                </FieldLabel>
                <FieldLabel label="Description (admin-internal)">
                  <input
                    value={draft.description ?? ''}
                    onChange={e => setDraft({ ...draft, description: e.target.value })}
                    className="w-full px-2 py-1.5 font-mono text-xs"
                  />
                </FieldLabel>
                <FieldLabel label={`Variables · pass these in dispatch_email payload (${draft.variables.length})`}>
                  <div className="flex flex-wrap gap-1.5">
                    {draft.variables.length === 0 && <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>none</span>}
                    {draft.variables.map(v => (
                      <code key={v} className="font-mono text-[11px] px-1.5 py-0.5"
                            style={{ background: 'rgba(240,192,64,0.08)', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.3)', borderRadius: '2px' }}>
                        {`{{${v}}}`}
                      </code>
                    ))}
                  </div>
                </FieldLabel>
                <FieldLabel label="Subject">
                  <input
                    value={draft.subject}
                    onChange={e => setDraft({ ...draft, subject: e.target.value })}
                    className="w-full px-2 py-1.5 font-mono text-sm"
                  />
                </FieldLabel>
                <FieldLabel label="HTML body">
                  <HtmlBodyField
                    value={draft.html_body}
                    onChange={v => setDraft({ ...draft, html_body: v })}
                    variables={draft.variables}
                  />
                </FieldLabel>
                <FieldLabel label="Plain text body (multipart fallback)">
                  <textarea
                    value={draft.text_body ?? ''}
                    onChange={e => setDraft({ ...draft, text_body: e.target.value })}
                    rows={6}
                    className="w-full px-2 py-1.5 font-mono text-xs"
                    style={{ lineHeight: 1.55, resize: 'vertical' }}
                  />
                </FieldLabel>

                <label className="flex items-center gap-2 font-mono text-xs cursor-pointer mt-1" style={{ color: 'var(--cream)' }}>
                  <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
                  <span>Enabled · disabled templates skip silently in dispatch</span>
                </label>

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={busy}
                    className="px-4 py-2 font-mono text-xs tracking-wide"
                    style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
                  >Save</button>
                  <input
                    type="email"
                    value={testRecipient}
                    onChange={e => setTestRecipient(e.target.value)}
                    placeholder="test recipient"
                    className="px-2 py-2 font-mono text-xs"
                    style={{
                      background: 'rgba(6,12,26,0.6)',
                      color: 'var(--cream)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '2px',
                      minWidth: 220,
                    }}
                  />
                  <button
                    type="button"
                    onClick={onSendTest}
                    disabled={busy}
                    className="px-4 py-2 font-mono text-xs tracking-wide"
                    style={{ background: 'transparent', color: 'var(--cream)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
                  >Send test</button>
                  {savedAt && <span className="font-mono text-[11px]" style={{ color: '#00D4AA' }}>✓ {savedAt}</span>}
                  {error && <span className="font-mono text-[11px]" style={{ color: 'var(--scarlet)' }}>{error}</span>}
                </div>

                <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Last updated · {new Date(draft.updated_at).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="card-navy p-6 text-center font-mono text-xs" style={{ color: 'var(--text-muted)', borderRadius: '2px' }}>
                좌측에서 kind 를 골라.
              </div>
            )}
          </main>

          {/* Right · log */}
          <aside className="card-navy p-3" style={{ borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
              Recent · {activeKind ?? '—'}
            </div>
            <ol className="grid gap-1.5">
              {logs.length === 0 && (
                <li className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>no sends yet</li>
              )}
              {logs.map(l => {
                const tone = l.status === 'sent' ? '#00D4AA'
                  : l.status === 'failed' ? 'var(--scarlet)'
                  : 'var(--text-muted)'
                return (
                  <li key={l.id} className="font-mono text-[10px]" style={{ color: 'var(--cream)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>{new Date(l.created_at).toLocaleTimeString()}</span>
                      <span style={{ color: tone }}>{l.status}</span>
                    </div>
                    <div className="truncate" style={{ color: 'var(--text-secondary)' }}>{l.recipient_addr}</div>
                    {l.error_message && (
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--scarlet)' }}>{l.error_message.slice(0, 80)}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          </aside>
      </div>
    </div>
  )
}

// Standalone-page wrapper · /admin/emails route. Same panel content
// rendered inside the §-style page chrome plus an auth gate so direct
// URL access still works for admins.
export function AdminEmailsPage() {
  const { user, member, loading: authLoading } = useAuth()
  if (authLoading) {
    return <div className="pt-32 pb-20 px-6 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>checking session…</div>
  }
  if (!user || !member?.is_admin) return <Navigate to="/" replace />
  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen admin-shell">
      <div className="max-w-7xl mx-auto">
        <header className="mb-5">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// ADMIN · 이메일 템플릿</div>
          <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
            Transactional emails
          </h1>
          <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
            <Link to="/admin" className="underline" style={{ color: 'var(--gold-500)' }}>← 어드민 홈</Link>
          </p>
        </header>
        <EmailTemplatesPanel />
      </div>
    </section>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {children}
    </label>
  )
}

// HTML body editor · two modes:
//   Preview  · WYSIWYG. iframe renders the template with sample data;
//              the body is contentEditable so admin can click any
//              text and edit inline. Edits sync back via postMessage
//              and we DON'T re-render the iframe on each keystroke
//              (would blow away cursor position). Substituted vars
//              are stripped before saving so [display_name] doesn't
//              get persisted as literal text.
//   Edit HTML· raw textarea for structural edits / power use.
//
// Sandbox keeps the email's inline CSS from leaking into the admin
// shell. Self-reports scroll height so the iframe fits content.
function HtmlBodyField({
  value, onChange, variables,
}: {
  value:     string
  onChange:  (v: string) => void
  variables: string[]
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [iframeHeight, setIframeHeight] = useState(360)

  // Build the iframe srcDoc only when the EXTERNAL value changes
  // (template switch, Edit-HTML edit, mode toggle to Preview). Inline
  // edits in Preview mode flow back via postMessage WITHOUT setting
  // srcDoc again — that would lose cursor + selection.
  const baseline = useRef('')
  const variablesRef = useRef(variables)
  variablesRef.current = variables

  const renderSrcDoc = (raw: string) => {
    let out = raw
    for (const v of variablesRef.current) {
      out = out.split(`{{${v}}}`).join(`[${v}]`)
    }
    // Inner script:
    //  - body is contentEditable
    //  - on input, post the live innerHTML back to parent
    //  - on first paint and on resize, post height
    //  - input box-shadow flash on focus to hint clickable text
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;padding:0;background:#f4f1ea}
body{padding:14px;outline:none}
[contenteditable=true]:focus{outline:1px dashed rgba(15,32,64,0.25);outline-offset:4px}
[contenteditable=true]:hover{cursor:text}
</style></head><body contenteditable="true">${out}<script>
const parent_=parent;
function H(){parent_.postMessage({type:'commitshow:iframe-height',h:document.documentElement.scrollHeight},'*')}
function S(){parent_.postMessage({type:'commitshow:iframe-html',html:document.body.innerHTML},'*')}
window.addEventListener('load',()=>{H();});
new ResizeObserver(H).observe(document.body);
document.body.addEventListener('input',S);
// Strip the {contenteditable} attr from outgoing HTML by sending the
// body's children's HTML rather than outerHTML.
<\/script></body></html>`
  }

  const [srcDoc, setSrcDoc] = useState(() => {
    baseline.current = value
    return renderSrcDoc(value)
  })

  // Re-render iframe ONLY when external value diverges from our
  // tracked baseline (i.e. the change didn't come from us).
  useEffect(() => {
    if (mode !== 'preview') return
    if (value === baseline.current) return
    baseline.current = value
    setSrcDoc(renderSrcDoc(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode])

  // Re-render when entering Preview from Edit (so latest raw HTML
  // gets reflected in the rendered view).
  useEffect(() => {
    if (mode === 'preview' && value !== baseline.current) {
      baseline.current = value
      setSrcDoc(renderSrcDoc(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Listen for height + html messages from the iframe.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; h?: number; html?: string } | null
      if (!d) return
      if (d.type === 'commitshow:iframe-height' && typeof d.h === 'number') {
        setIframeHeight(Math.max(120, Math.min(1400, d.h + 8)))
      } else if (d.type === 'commitshow:iframe-html' && typeof d.html === 'string') {
        // Reverse-substitute · turn [var] back into {{var}} so the
        // saved template stays parameterized.
        let raw = d.html
        for (const v of variablesRef.current) {
          raw = raw.split(`[${v}]`).join(`{{${v}}}`)
        }
        baseline.current = raw   // mark as our own change · don't re-render
        onChange(raw)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onChange])

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          {(['preview', 'edit'] as const).map(m => {
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="font-mono text-[11px] tracking-wide px-3 py-1"
                style={{
                  background:   active ? 'rgba(240,192,64,0.12)' : 'transparent',
                  color:        active ? 'var(--gold-500)' : 'var(--text-secondary)',
                  border:       `1px solid ${active ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  cursor:       'pointer',
                }}
              >
                {m === 'preview' ? 'Preview · click text to edit' : 'Edit HTML'}
              </button>
            )
          })}
        </div>
        {mode === 'preview' && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            structure broke? switch to Edit HTML
          </span>
        )}
      </div>
      {mode === 'edit' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={14}
          className="w-full px-2 py-1.5 font-mono text-xs"
          style={{ lineHeight: 1.55, resize: 'vertical' }}
        />
      ) : (
        <iframe
          title="Email preview"
          srcDoc={srcDoc}
          // allow-scripts so the inner contentEditable + postMessage
          // sync runs. NO allow-same-origin — keeps the iframe at
          // a null origin so its scripts can't reach into the admin
          // shell's DOM. postMessage works cross-origin by design.
          sandbox="allow-scripts"
          style={{
            width: '100%',
            height: iframeHeight,
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '2px',
            background: '#f4f1ea',
          }}
        />
      )}
    </div>
  )
}
