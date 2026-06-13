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

// Presets. `hint` surfaces the actual keywords/subreddits each one queries so
// the admin can see exactly what a button pulls (and edit it in the field below).
const SOURCES: { key: string; label: string; hint: string }[] = [
  { key: 'mcp', label: 'MCP servers', hint: 'GitHub "mcp server" · npm "mcp"' },
  { key: 'skills', label: 'Claude Skills', hint: 'GitHub "claude skill"' },
  { key: 'hn', label: 'Show HN', hint: 'Hacker News · recent Show HN' },
  { key: 'SideProject vibecoding SaaS indiehackers startups', label: 'Builder subs', hint: 'r/SideProject r/vibecoding r/SaaS r/indiehackers r/startups' },
  { key: 'ChatGPTCoding cursor ClaudeAI LocalLLaMA', label: 'AI-coding subs', hint: 'r/ChatGPTCoding r/cursor r/ClaudeAI r/LocalLLaMA' },
  { key: 'betalist', label: 'BetaList', hint: 'feed → /startups/.../visit → real product site' },
  { key: 'ph', label: 'Product Hunt', hint: 'GraphQL → exact product website (needs PRODUCTHUNT_TOKEN)' },
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
  const [win, setWin] = useState('week')   // Reddit/HN recency window
  const [count, setCount] = useState(16)   // max listings processed per run
  const [edit, setEdit] = useState<{ id: string; category: string } | null>(null)
  const [tab, setTab] = useState<'directory' | 'twitter'>('directory')

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
    setBusy(target); setOut(`Ingesting: ${target} · ${win} · up to ${count} …`)
    const r = await callFn({ action: 'ingest', target, window: win, limit: count })
    if (r.error) setOut(`❌ ${r.error}`)
    else setOut(`✅ ${target} · ${r.window} · discovered ${r.discovered} · kept ${r.kept} (enriched ≤${r.enriched_cap})${r.upsert?.error ? ` · upsert: ${r.upsert.error}` : ' · upserted'}`)
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
      <p style={{ color: '#6E6557' }}>Sign in with an admin account. <Link to="/" style={{ color: '#97600F' }}>← directory</Link></p>
    </div></LegitShell>
  )
  if (!isAdmin) return (
    <LegitShell><div className="l-wrap" style={{ padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>Not authorized</h1>
      <p style={{ color: '#6E6557' }}>This account is not an admin. <Link to="/" style={{ color: '#97600F' }}>← directory</Link></p>
    </div></LegitShell>
  )

  return (
    <LegitShell>
      <div className="l-wrap" style={{ padding: '26px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26 }}>Directory admin</h1>
          <Link to="/" style={{ color: '#97600F', fontSize: 13 }}>view directory →</Link>
        </div>
        <p style={{ color: '#6F6757', fontSize: 13.5, marginBottom: 22 }}>
          Ingest from sources and curate listings. Ingest runs Claude server-side and upserts into the public directory.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['directory', 'twitter'] as const).map(t => (
            <span key={t} className={`l-cattile ${tab === t ? 'on' : ''}`} style={{ padding: '7px 16px', fontSize: 13.5, textTransform: 'capitalize' }} onClick={() => setTab(t)}>{t === 'twitter' ? 'Twitter' : 'Directory'}</span>
          ))}
        </div>

{tab === 'directory' && <>
        {/* scope: recency window + count */}
        <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: '#6F6757', letterSpacing: '.05em', marginBottom: 8 }}>SCOPE</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#6E6557' }}>Window</span>
            {([['day', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']] as const).map(([k, lbl]) => (
              <span key={k} className={`l-cattile ${win === k ? 'on' : ''}`} style={{ padding: '5px 11px', fontSize: 13 }} onClick={() => setWin(k)}>{lbl}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#6E6557' }}>Max listings</span>
            <input type="number" min={1} max={30} value={count}
              onChange={e => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              style={{ width: 64, border: '1px solid #E0D8C8', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: "'JetBrains Mono',monospace" }} />
            <span style={{ fontSize: 12, color: '#6F6757' }}>(≤30 · all get Claude write-up up to 16)</span>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: '#6F6757', marginBottom: 16 }}>
          Window applies to Reddit (top of) and Hacker News (posted within). GitHub/npm rank by stars/relevance.
        </div>

        {/* ingest */}
        <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: '#6F6757', letterSpacing: '.05em', marginBottom: 10 }}>INGEST SOURCES</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {SOURCES.map(s => (
            <div key={s.key} className="l-cattile" title={`Add to field: ${s.key}`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '9px 13px', borderRadius: 10, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}
              onClick={() => runIngest(s.key)}>
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#211C15' }}>{busy === s.key ? '⏳ ' : '▶ '}{s.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#6F6757', lineHeight: 1.35 }}>{s.hint}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: '#6F6757', marginBottom: 6, maxWidth: 620 }}>
          Custom sources — space-separated. Mix any: subreddit name (e.g. <code>SideProject</code>) ·{' '}
          <code>hn</code> · <code>mcp</code> · <code>skills</code> · <code>betalist</code> · <code>ph</code> ·{' '}
          <code>gh:&lt;keyword&gt;</code> (GitHub search) · <code>npm:&lt;keyword&gt;</code> (npm search).
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, maxWidth: 620 }}>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. SideProject indiehackers gh:analytics npm:scheduler hn"
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
                <Link to={`/s/${l.slug}`} style={{ color: '#211C15' }}>{l.name}</Link>{' '}
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
                      {l.benchmark && <span className="l-score" title="overall benchmark (admin only)">◆ {l.benchmark.overall}</span>}
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
        </>}

        {tab === 'twitter' && <TwitterSection />}
      </div>
    </LegitShell>
  )
}

// ── Twitter content auto-generation ──
// Builds tweet drafts from the published reports (deterministic templates · same
// stats as the OG card / cite block) for admin QC. A later routine posts the
// approved ones to @Legit_Show. Account: https://x.com/Legit_Show
type Draft = { id: string; kind: string; source_slug: string | null; group_id: string | null; idx: number; body: string; status: string }
type Rep = { slug: string; title: string; hero_stat: { value: number; unit?: string; label: string } | null; stats: { label: string; fail_pct: number | null }[] | null; sample: { total: number; scope: string } | null }

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const LAUNCH_THREAD = [
  `We started as commit.show — a league grading vibe-coded projects on whether they actually hold up in production.\n\nThe scoreboard was the gimmick. The audit engine underneath was the real product.\n\nSo we rebuilt around it. 🧵`,
  `Meet Legit.Show — a directory of launched web apps, SaaS, AI tools & MCP servers, each with an objective 7-Frame production-readiness benchmark.\n\ncommit.show now runs under the hood as the analysis engine.\n\nlegit.show`,
  `AI ships a flawless demo. Production is the quiet part it skips — monitoring, rate limits, access rules, a real 404.\n\nWe measure that gap from the outside, and report exactly what we find.\n\n@Legit_Show\n\n#buildinpublic #vibecoding #devtools`,
]

function hashtagsFor(slug: string): string {
  if (slug.includes('mcp')) return '#MCP #AI #LLM'
  if (slug.includes('security')) return '#websecurity #infosec #webdev'
  if (slug.includes('privacy')) return '#privacy #GDPR #webdev'
  if (slug.includes('ai-built')) return '#vibecoding #AItools #buildinpublic'
  if (slug.includes('open-source')) return '#opensource #SaaS #devtools'
  return '#buildinpublic #devtools #AItools'
}

function tweetsFor(rep: Rep): { kind: string; body: string }[] {
  const h = rep.hero_stat
  if (!h) return []
  const url = `legit.show/reports/${rep.slug}`
  const stat = `${h.value}${h.unit || '%'} ${h.label || ''}`.trim()
  const scope = (rep.sample?.scope || 'launched services').split(',')[0]
  const tags = hashtagsFor(rep.slug)
  const out: { kind: string; body: string }[] = []
  out.push({ kind: 'single', body: `${cap(stat)}.\n\nWe benchmarked them straight from the source — here's exactly what we measured.\n\n${url}\n\n${tags}` })
  out.push({ kind: 'thread', body: `${cap(stat)}.\n\nWe ran Legit.Show's production-readiness benchmark across ${rep.sample?.total ?? ''} ${scope}. 🧵` })
  const top = (rep.stats || []).slice(0, 3)
  if (top.length) out.push({ kind: 'thread', body: `What's missing:\n\n${top.map(s => `→ ${s.fail_pct}% ${s.label.toLowerCase()}`).join('\n')}` })
  out.push({ kind: 'thread', body: `Not bad engineers — it's the invisible production controls a demo never forces you to add, and a model rarely does.` })
  out.push({ kind: 'thread', body: `Full report + open methodology (we show exactly what was measured):\n${url}\n\n@Legit_Show\n\n${tags}` })
  return out
}

function TwitterSection() {
  const [reports, setReports] = useState<Rep[] | null>(null)
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = () => {
    supabase.from('reports').select('slug,title,hero_stat,stats,sample').eq('status', 'published').order('published_at')
      .then(({ data }) => setReports((data as Rep[]) || []))
    supabase.from('tweet_drafts').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setDrafts((data as Draft[]) || []))
  }
  useEffect(load, [])

  const generate = async () => {
    if (!reports?.length) return
    setBusy(true)
    await supabase.from('tweet_drafts').delete().eq('status', 'draft')   // regenerate fresh; keep approved/posted
    const rows: Omit<Draft, 'id'>[] = []
    const lgid = crypto.randomUUID()
    LAUNCH_THREAD.forEach((body, i) => rows.push({ kind: 'thread', source_slug: 'launch', group_id: lgid, idx: i, body, status: 'draft' }))
    for (const rep of reports) {
      const gid = crypto.randomUUID()
      let i = 0
      for (const t of tweetsFor(rep)) {
        rows.push({ kind: t.kind, source_slug: rep.slug, group_id: t.kind === 'thread' ? gid : crypto.randomUUID(), idx: t.kind === 'thread' ? i++ : 0, body: t.body, status: 'draft' })
      }
    }
    if (rows.length) await supabase.from('tweet_drafts').insert(rows)
    setBusy(false); load()
  }

  const setStatus = async (d: Draft, status: string) => { await supabase.from('tweet_drafts').update({ status }).eq('id', d.id); load() }
  const del = async (d: Draft) => { await supabase.from('tweet_drafts').delete().eq('id', d.id); load() }
  const copy = (d: Draft) => { try { navigator.clipboard?.writeText(d.body) } catch { /* */ } setCopied(d.id); setTimeout(() => setCopied(null), 1400) }
  const copyThread = (ds: Draft[]) => { try { navigator.clipboard?.writeText(ds.map(d => d.body).join('\n\n---\n\n')) } catch { /* */ } setCopied(ds[0].id); setTimeout(() => setCopied(null), 1400) }

  // group drafts by group_id, preserving report order
  const groups = new Map<string, Draft[]>()
  for (const d of drafts || []) { const k = d.group_id || d.id; (groups.get(k) || groups.set(k, []).get(k)!).push(d) }
  const ordered = [...groups.values()].map(g => g.sort((a, b) => a.idx - b.idx)).sort((a, b) => (a[0].source_slug === 'launch' ? -1 : 0) - (b[0].source_slug === 'launch' ? -1 : 0))
  const cc = (b: string) => b.replace(/https?:\/\/\S+|legit\.show\/\S+/g, 'x'.repeat(23)).length  // URLs ≈ 23 on X

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontSize: 18 }}>Tweet drafts</h2>
        <a href="https://x.com/Legit_Show" target="_blank" rel="noopener noreferrer" style={{ color: '#97600F', fontSize: 13 }}>@Legit_Show ↗</a>
      </div>
      <p style={{ color: '#6F6757', fontSize: 13, marginBottom: 14, maxWidth: 620 }}>
        Auto-generated from the published reports — a single stat tweet + a thread each. Quality-check, approve, copy to X.
        An auto-upload routine will post the approved ones later.
      </p>
      <span className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto', marginBottom: 18, display: 'inline-block' }}
        onClick={generate}>{busy ? 'Generating…' : '↻ Generate from reports'}</span>

      {drafts === null && <div className="l-empty">Loading…</div>}
      {drafts && !drafts.length && <div style={{ color: '#6F6757', fontSize: 13, marginTop: 8 }}>No drafts yet — hit Generate.</div>}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ordered.map(g => {
          const isThread = g.length > 1
          const slug = g[0].source_slug
          return (
            <div key={g[0].id} style={{ border: '1px solid #E7D4AC', borderRadius: 12, padding: '14px 16px', background: '#FCFAF5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: '#97600F', fontWeight: 600 }}>{isThread ? `Thread · ${g.length}` : 'Single'}</span>
                {slug && <Link to={`/reports/${slug}`} style={{ fontSize: 11.5, color: '#9A9080' }}>{slug}</Link>}
                <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: g[0].status === 'approved' ? '#4E7A36' : '#A8742E' }}>{g[0].status}</span>
              </div>
              {g.map((d, i) => (
                <div key={d.id} style={{ borderTop: i ? '1px dashed #ECE3D2' : 'none', padding: i ? '9px 0 0' : '0 0 0', marginTop: i ? 9 : 0 }}>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#2C261D', lineHeight: 1.5 }}>{d.body}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: cc(d.body) > 280 ? '#C24A33' : '#9A9080' }}>{cc(d.body)}/280</span>
                    <span className="l-login" style={{ fontSize: 12 }} onClick={() => copy(d)}>{copied === d.id ? 'copied' : 'copy'}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 14, marginTop: 11, borderTop: '1px solid #EFE6D2', paddingTop: 9 }}>
                {isThread && <span className="l-login" style={{ fontSize: 12 }} onClick={() => copyThread(g)}>{copied === g[0].id ? 'copied thread' : 'copy thread'}</span>}
                <span className="l-login" style={{ fontSize: 12, color: g[0].status === 'approved' ? '#A8742E' : '#4E7A36' }}
                  onClick={() => g.forEach(d => setStatus(d, g[0].status === 'approved' ? 'draft' : 'approved'))}>{g[0].status === 'approved' ? 'unapprove' : '✓ approve'}</span>
                <span className="l-login" style={{ fontSize: 12, color: '#C8102E', marginLeft: 'auto' }} onClick={() => g.forEach(del)}>delete</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
