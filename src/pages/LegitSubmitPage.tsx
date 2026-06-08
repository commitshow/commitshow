import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { LegitShell, PricingField, useLegitAuth } from './legit'
import { setHead } from '../lib/seo'

// Add your service — owner-gated. Paste a URL, review the prefilled details, then
// verify domain ownership (meta tag / DNS TXT). The listing is only published
// once verification passes — nothing goes live before you prove you own it.

const CANON_CATS = [
  'AI & Agents', 'Developer Tools', 'MCP & Integrations', 'Frameworks & Starter Kits',
  'Infrastructure & DevOps', 'Data & Analytics', 'Productivity', 'Business & Finance',
  'Design & Creative', 'Content & Docs', 'Education & Reference', 'Lifestyle & Other',
]

const CSS = `
.sub-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:28px;color:#211C15;margin:4px 0 6px;letter-spacing:-.01em}
.sub-sub{font-size:14px;color:#6E6557;line-height:1.6;margin-bottom:24px;max-width:560px}
.sub-steps{display:flex;gap:8px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#9A9080;margin-bottom:18px;text-transform:uppercase;letter-spacing:.04em}
.sub-steps b{color:#97600F}
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
const invoke = (body: Record<string, unknown>) => supabase.functions.invoke('ingest-directory', { body })

export function LegitSubmitPage() {
  const nav = useNavigate()
  const { user } = useAuth() as { user: { id?: string } | null }
  const { openAuth } = useLegitAuth()
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'url' | 'form' | 'verify'>('url')
  const [f, setF] = useState<Fields>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [existing, setExisting] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setHead({ title: 'Add your service — Legit.Show', description: "Add your launched product to the Legit.Show directory. Verify you own the domain, then it's listed with an objective benchmark.", canonical: 'https://commit.show/v2/submit' })
  }, [])

  const set = (k: keyof Fields, v: string) => setF(prev => ({ ...prev, [k]: v }))

  // url -> form (prefill from the public page)
  const fetchDetails = async () => {
    setErr(null); setExisting(null)
    if (!url.trim()) { setErr('Enter your service URL.'); return }
    setBusy(true)
    try {
      const { data, error } = await invoke({ action: 'submit', url: url.trim(), preview: true })
      const d = (data || {}) as { fields?: Partial<Fields>; existing?: boolean; slug?: string; error?: string; message?: string }
      if (error && !d?.fields && !d?.error) { setErr('Could not read that page. Please try again.'); setBusy(false); return }
      if (d.existing && d.slug) { setExisting(d.slug); setBusy(false); return }
      if (d.error) { setErr(d.message || 'Could not read that page.'); setBusy(false); return }
      setF({ ...EMPTY, ...d.fields }); setPhase('form'); setBusy(false)
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  // form -> verify (fetch the ownership token)
  const toVerify = async () => {
    setErr(null)
    if (!f.name.trim()) { setErr('A name is required.'); return }
    setPhase('verify'); setToken(null)
    setBusy(true)
    try {
      const { data } = await invoke({ action: 'verify_prepare', url: url.trim() })
      const d = (data || {}) as { token?: string; domain?: string; existing?: boolean; slug?: string; error?: string; message?: string }
      if (d.existing && d.slug) { nav(`/v2/s/${d.slug}`); return }
      if (d.error) { setErr(d.message || 'Could not start verification.'); setBusy(false); return }
      if (d.token) { setToken(d.token); setDomain(d.domain || '') }
      setBusy(false)
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  // verify -> publish (only creates the listing if ownership checks out)
  const verifyPublish = async () => {
    setErr(null); setBusy(true)
    try {
      const { data } = await invoke({ action: 'verify_publish', url: url.trim(), fields: f })
      const d = (data || {}) as { slug?: string; verified?: boolean; existing?: boolean; error?: string; message?: string }
      if (d.slug) { nav(`/v2/s/${d.slug}`); return }
      if (d.verified === false || d.error) { setErr(d.message || "Couldn't verify yet — add the tag and try again."); setBusy(false); return }
      setErr('Could not publish. Please try again.'); setBusy(false)
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  const tag = token ? `<meta name="legit-verify" content="${token}">` : ''

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="l-wrap" style={{ maxWidth: 640, paddingTop: 32, paddingBottom: 72 }}>
        <h1 className="sub-h">Add your service</h1>
        <p className="sub-sub">Paste your product URL, review the details, and verify you own the domain. It publishes only after verification — so every self-added listing is owner-verified.</p>
        {user && (
          <div className="sub-steps">
            <b style={{ color: phase === 'url' ? '#97600F' : undefined }}>1 URL</b> ·
            <b style={{ color: phase === 'form' ? '#97600F' : '#9A9080' }}>2 Details</b> ·
            <b style={{ color: phase === 'verify' ? '#97600F' : '#9A9080' }}>3 Verify &amp; publish</b>
          </div>
        )}

        {!user ? (
          <div className="sub-card">
            <div className="l-subh">Sign in to add your service</div>
            <p className="l-modaltext">An account ties the listing to you and lets you verify ownership.</p>
            <button className="l-btn l-authsubmit" onClick={() => openAuth('signup')}>Sign in</button>
          </div>
        ) : phase === 'url' ? (
          <div className="sub-card">
            <label className="l-edlabel">Product URL</label>
            <div className="sub-row">
              <input className="l-authin" type="url" inputMode="url" placeholder="https://yourproduct.com" value={url}
                onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchDetails() }} autoFocus disabled={busy} />
              <button className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={fetchDetails}>{busy ? 'Reading…' : 'Fetch details'}</button>
            </div>
            {err && <div className="l-suberr" style={{ marginTop: 10 }}>{err}</div>}
            {existing && <div className="sub-exist">Already in the directory — <span className="sub-link" onClick={() => nav(`/v2/s/${existing}`)}>view the listing →</span></div>}
            <div className="sub-prov">App Store / Play apps: submit the marketing site · you'll verify the domain next</div>
          </div>
        ) : phase === 'form' ? (
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
            <button className="l-btn l-authsubmit" style={{ marginTop: 16 }} onClick={toVerify}>Continue to verification →</button>
          </div>
        ) : (
          <div className="sub-card">
            <span className="sub-back" onClick={() => { setPhase('form'); setErr(null) }}>← back to details</span>
            <div className="l-subh">Verify you own {domain || 'the domain'}</div>
            <p className="l-modaltext">Your listing publishes the moment we confirm you control the domain.</p>
            {!token ? (
              <button className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={toVerify}>{busy ? 'Starting…' : 'Get verification tag'}</button>
            ) : (
              <>
                <div className="l-vfy-step">1. Add this to your site&apos;s <code>&lt;head&gt;</code>:</div>
                <div className="l-vfy-code" onClick={() => { try { navigator.clipboard?.writeText(tag) } catch { /* noop */ } setCopied(true) }}>{tag}<span className="l-vfy-copy">{copied ? 'copied' : 'copy'}</span></div>
                <div className="l-vfy-step">…or add a DNS TXT record <code>_legit.{domain}</code> = <code>{token}</code></div>
                <button className="l-btn l-authsubmit" style={{ marginTop: 14, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={verifyPublish}>{busy ? 'Verifying…' : 'Verify & publish'}</button>
              </>
            )}
            {err && <div className="l-suberr" style={{ marginTop: 10 }}>{err}</div>}
          </div>
        )}
      </div>
    </LegitShell>
  )
}
