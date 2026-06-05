// /v2/admin — directory (legit) admin. Isolated from the main /admin console.
// is_admin gated. Ingest runs server-side via the ingest-directory Edge Function
// (Claude + service role); curation (edit category, delete) goes through the same
// function. The ADMIN_TOKEN is the shared secret already used by /admin.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SUPABASE_URL } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LegitShell, type Listing } from './legit'

const FN_URL = `${SUPABASE_URL}/functions/v1/ingest-directory`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const SOURCES: { key: string; label: string }[] = [
  { key: 'mcp', label: 'GitHub + npm · MCP' },
  { key: 'hn', label: 'Hacker News · Show HN' },
  { key: 'skills', label: 'GitHub · Skills' },
  { key: 'SideProject vibecoding SaaS indiehackers startups', label: 'Reddit · builder subs' },
  { key: 'ChatGPTCoding cursor ClaudeAI LocalLLaMA', label: 'Reddit · AI-coding subs' },
]

export function DirectoryAdminPage() {
  const { user, member, loading } = useAuth() as {
    user: { id?: string } | null; member: { is_admin?: boolean } | null; loading: boolean
  }
  const isAdmin = !!member?.is_admin

  const [rows, setRows] = useState<Listing[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [out, setOut] = useState<string>('')
  const [custom, setCustom] = useState('')
  const [edit, setEdit] = useState<{ id: string; category: string } | null>(null)

  const loadRows = () => supabase.from('listings').select('*').order('created_at', { ascending: false }).limit(500)
    .then(({ data }) => setRows((data as Listing[] | null) || []))

  useEffect(() => { if (isAdmin) loadRows() }, [isAdmin])

  // Auth = the signed-in admin's own JWT (the page is already is_admin gated),
  // so no ADMIN_TOKEN paste is needed — the Edge Function resolves is_admin.
  const callFn = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession()
    const jwt = session?.access_token || ANON
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json().catch(() => ({ error: `http ${res.status}` }))
  }

  const runIngest = async (target: string) => {
    setBusy(target); setOut(`Ingesting: ${target} …`)
    const r = await callFn({ action: 'ingest', target })
    if (r.error) setOut(`❌ ${r.error}`)
    else setOut(`✅ ${target} · discovered ${r.discovered} · kept ${r.kept}${r.upsert?.error ? ` · upsert: ${r.upsert.error}` : ' · upserted'}`)
    await loadRows(); setBusy(null)
  }

  const saveCategory = async () => {
    if (!edit) return
    const { id, category } = edit
    setBusy('edit')
    const r = await callFn({ action: 'update', id, patch: { category: category || null } })
    if (!r.error) setRows(prev => prev?.map(x => x.id === id ? { ...x, category: category || null } : x) ?? prev)
    setEdit(null); setBusy(null)
  }

  const del = async (l: Listing) => {
    if (!confirm(`Delete "${l.name}"? This removes the public listing.`)) return
    setBusy(l.id)
    const r = await callFn({ action: 'delete', id: l.id })
    if (!r.error) setRows(prev => prev?.filter(x => x.id !== l.id) ?? prev)
    setBusy(null)
  }

  // ── gates ──
  if (loading) return <LegitShell><div className="l-wrap" style={{ padding: '60px 24px' }}>Loading…</div></LegitShell>
  if (!user) return (
    <LegitShell><div className="l-wrap" style={{ padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#6E6557' }}>Sign in with an admin account. <Link to="/v2" style={{ color: '#97600F' }}>← directory</Link></p>
    </div></LegitShell>
  )
  if (!isAdmin) return (
    <LegitShell><div className="l-wrap" style={{ padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Not authorized</h1>
      <p style={{ color: '#6E6557' }}>This account is not an admin. <Link to="/v2" style={{ color: '#97600F' }}>← directory</Link></p>
    </div></LegitShell>
  )

  return (
    <LegitShell>
      <div className="l-wrap" style={{ padding: '26px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26 }}>Directory admin</h1>
          <Link to="/v2" style={{ color: '#97600F', fontSize: 13 }}>view directory →</Link>
        </div>
        <p style={{ color: '#9A9080', fontSize: 13.5, marginBottom: 22 }}>
          Ingest from sources and curate listings. Ingest runs Claude server-side and upserts into the public directory.
        </p>

        {/* ingest */}
        <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: '#9A9080', letterSpacing: '.05em', marginBottom: 10 }}>INGEST SOURCES</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {SOURCES.map(s => (
            <span key={s.key} className="l-cattile" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}
              onClick={() => runIngest(s.key)}>{busy === s.key ? '⏳ ' : '▶ '}{s.label}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, maxWidth: 540 }}>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder='custom subreddits, e.g. "webdev SaaS analytics"'
            autoComplete="off" style={{ flex: 1, border: '1px solid #E0D8C8', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'Inter' }} />
          <span className="l-btn ghost" style={{ opacity: busy || !custom.trim() ? 0.5 : 1, pointerEvents: busy || !custom.trim() ? 'none' : 'auto' }}
            onClick={() => runIngest(custom.trim())}>Run</span>
        </div>
        {out && <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono',monospace", color: '#5A5347', background: '#F4F0E8', border: '1px solid #E9E2D4', borderRadius: 8, padding: '10px 14px', marginBottom: 24 }}>{out}</div>}

        {/* listings */}
        <div className="l-feedhead" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 18 }}>Listings</h2>
          <span className="c">{rows ? `${rows.length} total` : ''}</span>
        </div>
        {rows === null && <div className="l-empty">Loading…</div>}
        {rows?.map(l => (
          <div key={l.id} className="l-row" style={{ cursor: 'default' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="l-nm" style={{ fontSize: 16 }}>
                <Link to={`/v2/s/${l.slug}`} style={{ color: '#211C15' }}>{l.name}</Link>{' '}
                <span className="l-dm">{l.domain}</span>
              </div>
              <div className="l-ol" style={{ fontSize: 13 }}>{(l.tagline || l.description || '—').slice(0, 110)}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {edit?.id === l.id
                  ? <>
                      <input value={edit.category} onChange={e => setEdit({ id: l.id, category: e.target.value })}
                        autoFocus placeholder="category" style={{ border: '1px solid #E0D8C8', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }} />
                      <span className="l-login" onClick={saveCategory} style={{ color: '#2E7D32' }}>save</span>
                      <span className="l-login" onClick={() => setEdit(null)}>cancel</span>
                    </>
                  : <>
                      <span className="l-tag" style={{ background: l.category ? '#F6EBD4' : '#FBEFD9', color: '#97600F', borderColor: '#E7D4AC' }}>
                        {l.category || 'no category'}
                      </span>
                      <span className="l-login" style={{ fontSize: 12 }} onClick={() => setEdit({ id: l.id, category: l.category || '' })}>edit</span>
                      <span className="l-tag">{l.source || '—'}</span>
                    </>}
              </div>
            </div>
            <span className="l-login" style={{ color: '#C8102E', alignSelf: 'center', opacity: busy === l.id ? 0.5 : 1 }} onClick={() => del(l)}>
              {busy === l.id ? '…' : 'delete'}
            </span>
          </div>
        ))}
      </div>
    </LegitShell>
  )
}
