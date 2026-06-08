import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LegitShell, PricingField, useLegitAuth } from './legit'
import { setHead } from '../lib/seo'

// Proper "add your service" page — paste a URL, we read the public page and
// prefill the listing fields, then the owner reviews/edits before it's added.
// Backed by ingest-directory's submit action (preview = prefill, no save).

const CANON_CATS = [
  'AI & Agents', 'Developer Tools', 'MCP & Integrations', 'Frameworks & Starter Kits',
  'Infrastructure & DevOps', 'Data & Analytics', 'Productivity', 'Business & Finance',
  'Design & Creative', 'Content & Docs', 'Education & Reference', 'Lifestyle & Other',
]

const CSS = `
.sub-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:28px;color:#211C15;margin:4px 0 6px;letter-spacing:-.01em}
.sub-sub{font-size:14px;color:#6E6557;line-height:1.6;margin-bottom:26px;max-width:560px}
.sub-card{background:#FCFAF5;border:1px solid #E7D4AC;border-radius:14px;padding:22px}
.sub-row{display:flex;gap:10px;align-items:flex-start}
.sub-row .l-authin{margin-bottom:0}
.sub-row .l-btn{white-space:nowrap;padding:11px 18px}
.sub-prov{font-size:12px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-top:18px}
.sub-back{font-size:13px;color:#97600F;cursor:pointer;margin-bottom:16px;display:inline-block}
.sub-exist{margin-top:12px;font-size:13.5px;color:#5A5347;background:#FBF6EC;border:1px solid #E7D4AC;border-radius:8px;padding:11px 13px}
.sub-link{color:#97600F;cursor:pointer;font-weight:600}
@media(max-width:560px){.sub-row{flex-direction:column}.sub-row .l-btn{width:100%}}
`

type Fields = { name: string; tagline: string; description: string; category: string; pricing: string; has_pricing: boolean }
const EMPTY: Fields = { name: '', tagline: '', description: '', category: '', pricing: '', has_pricing: false }

export function LegitSubmitPage() {
  const nav = useNavigate()
  const { user } = useAuth() as { user: { id?: string } | null }
  const { openAuth } = useLegitAuth()
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'url' | 'form'>('url')
  const [f, setF] = useState<Fields>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [existing, setExisting] = useState<string | null>(null)

  useEffect(() => {
    setHead({ title: 'Add your service — Legit.Show', description: 'Add your launched product to the Legit.Show directory. We read the public page, structure it, and run the benchmark.', canonical: 'https://commit.show/v2/submit' })
  }, [])

  const set = (k: keyof Fields, v: string) => setF(prev => ({ ...prev, [k]: v }))

  const fetchDetails = async () => {
    setErr(null); setExisting(null)
    const u = url.trim()
    if (!u) { setErr('Enter your service URL.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('ingest-directory', { body: { action: 'submit', url: u, preview: true } })
      const d = (data || {}) as { preview?: boolean; fields?: Partial<Fields>; existing?: boolean; slug?: string; error?: string; message?: string }
      if (error && !d?.fields && !d?.error) { setErr('Could not read that page. Please try again.'); setBusy(false); return }
      if (d.existing && d.slug) { setExisting(d.slug); setBusy(false); return }
      if (d.error) { setErr(d.message || 'Could not read that page.'); setBusy(false); return }
      setF({ ...EMPTY, ...d.fields })
      setPhase('form'); setBusy(false)
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  const submit = async () => {
    setErr(null)
    if (!f.name.trim()) { setErr('A name is required.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('ingest-directory', { body: { action: 'submit', url: url.trim(), fields: f } })
      const d = (data || {}) as { slug?: string; existing?: boolean; error?: string; message?: string }
      if (error && !d?.slug && !d?.error) { setErr('Could not save. Please try again.'); setBusy(false); return }
      if (d.error) { setErr(d.message || 'Could not save this service.'); setBusy(false); return }
      if (d.slug) { nav(`/v2/s/${d.slug}`); return }
      setErr('Could not save this service.'); setBusy(false)
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="l-wrap" style={{ maxWidth: 640, paddingTop: 32, paddingBottom: 72 }}>
        <h1 className="sub-h">Add your service</h1>
        <p className="sub-sub">Paste your product URL — we read the public page and prefill the details. Review, edit anything, and add it to the directory. One entry per product.</p>

        {!user ? (
          <div className="sub-card">
            <div className="l-subh">Sign in to add your service</div>
            <p className="l-modaltext">An account lets us attribute the listing to you, so you can edit it and verify ownership later.</p>
            <button className="l-btn l-authsubmit" onClick={() => openAuth('signup')}>Sign in</button>
          </div>
        ) : phase === 'url' ? (
          <div className="sub-card">
            <label className="l-edlabel">Product URL</label>
            <div className="sub-row">
              <input className="l-authin" type="url" inputMode="url" placeholder="https://yourproduct.com" value={url}
                onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchDetails() }} autoFocus disabled={busy} />
              <button className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={fetchDetails}>
                {busy ? 'Reading…' : 'Fetch details'}
              </button>
            </div>
            {err && <div className="l-suberr" style={{ marginTop: 10 }}>{err}</div>}
            {existing && (
              <div className="sub-exist">
                Already in the directory — <span className="sub-link" onClick={() => nav(`/v2/s/${existing}`)}>view the listing →</span>
              </div>
            )}
            <div className="sub-prov">App Store / Play apps: submit the marketing site · public landing pages only · up to 5 per day</div>
          </div>
        ) : (
          <div className="sub-card">
            <span className="sub-back" onClick={() => { setPhase('url'); setErr(null) }}>← change URL</span>
            <label className="l-edlabel">Name</label>
            <input className="l-authin" value={f.name} maxLength={80} onChange={e => set('name', e.target.value)} />
            <label className="l-edlabel">Category</label>
            <select className="l-authin" value={f.category} onChange={e => set('category', e.target.value)}>
              <option value="">— choose —</option>
              {CANON_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="l-edlabel">Tagline</label>
            <input className="l-authin" value={f.tagline} maxLength={90} onChange={e => set('tagline', e.target.value)} placeholder="One plain sentence" />
            <label className="l-edlabel">Description</label>
            <textarea className="l-rvta" value={f.description} onChange={e => set('description', e.target.value)} placeholder="What it does, who it's for, the key differentiator." />
            <label className="l-edlabel">Pricing</label>
            <PricingField initial={f.pricing} onChange={(pricing, has_pricing) => setF(prev => ({ ...prev, pricing, has_pricing }))} />
            {err && <div className="l-suberr" style={{ marginTop: 10 }}>{err}</div>}
            <button className="l-btn l-authsubmit" style={{ marginTop: 16, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={submit}>
              {busy ? 'Adding & benchmarking…' : 'Add to directory'}
            </button>
            <div className="sub-prov" style={{ marginTop: 12 }}>{url.replace(/^https?:\/\//, '')} · benchmark runs automatically</div>
          </div>
        )}
      </div>
    </LegitShell>
  )
}
