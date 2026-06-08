import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BenchmarkChart, CategoryPicker, FaviconTile, LegitShell, LegitVouch, PricingField, RatingPanel, ReactionBar, ReviewsSection, StarRating, TicketBadge, useLegitAuth, visuals, type Listing } from './legit'
import { useAuth } from '../lib/auth'
import { setHead, clearJsonLd } from '../lib/seo'

export function ListingDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [p, setP] = useState<Listing | null | undefined>(undefined)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    if (!slug) return
    let alive = true
    setP(undefined)
    supabase
      .from('listings')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => { if (alive) setP((data as Listing | null) ?? null) })
    return () => { alive = false }
  }, [slug, bump])

  return (
    <LegitShell>
      <div className="l-wrap">
        {p === undefined && <div className="l-head"><h1>Loading…</h1></div>}
        {p === null && (
          <div className="l-head">
            <h1>Not found</h1>
            <p><Link to="/v2" style={{ color: '#97600F' }}>← directory</Link></p>
          </div>
        )}
        {p && <Detail p={p} onReload={() => setBump(b => b + 1)} />}
      </div>
    </LegitShell>
  )
}

function Detail({ p, onReload }: { p: Listing; onReload: () => void }) {
  const { openAuth } = useLegitAuth()
  const { user, member } = useAuth() as { user: { id?: string } | null; member: { is_admin?: boolean } | null }
  const isAdmin = !!member?.is_admin
  const isOwner = !!user?.id && (p.submitted_by === user.id || p.verified_by === user.id)
  const canEdit = isOwner || isAdmin
  const [editing, setEditing] = useState(false)
  const dt = (p.info_as_of || '').slice(0, 10)
  const whoFor = p.who_for || []
  const features = p.features || []
  const { icon: vIcon, preview: vPreview } = visuals(p)
  const [ticketCount, setTicketCount] = useState(0)
  const [rating, setRatingStats] = useState<{ avg: number; count: number }>({ avg: 0, count: 0 })
  useEffect(() => {
    let alive = true
    supabase.from('listing_ticket_stats').select('ticket_count').eq('listing_id', p.id).maybeSingle()
      .then(({ data }) => { if (alive) setTicketCount((data as { ticket_count: number } | null)?.ticket_count || 0) })
    const loadRating = () => supabase.from('listing_rating_stats').select('avg_rating, rating_count').eq('listing_id', p.id).maybeSingle()
      .then(({ data }) => { if (!alive) return; const d = data as { avg_rating: number; rating_count: number } | null; setRatingStats({ avg: d?.avg_rating || 0, count: d?.rating_count || 0 }) })
    loadRating()
    window.addEventListener('legit:rating', loadRating)
    return () => { alive = false; window.removeEventListener('legit:rating', loadRating) }
  }, [p.id])
  // Star-rating color is independent of the legit-ticket tier. Tying it to the
  // tier rendered ratings in the muted 0-ticket tone (#C9BBA0) on most listings —
  // indistinguishable from an empty star. Always use a clear gold.
  const RATING_GOLD = '#E0A92E'

  // SEO/AEO head for client nav + JS crawlers (edge middleware covers the rest)
  useEffect(() => {
    const cat = p.category || p.platform || 'service'
    const blurb = (p.tagline || p.description || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const rated = rating.count > 0 ? `Rated ${rating.avg}★ by ${rating.count}. ` : ''
    setHead({
      title: `${p.name} — ${(p.tagline || cat).slice(0, 60)} | Legit.Show`,
      description: `${blurb}. ${rated}Features, pricing, reviews and an objective benchmark on Legit.Show.`.replace(/\s+/g, ' ').slice(0, 200),
      canonical: `https://commit.show/v2/s/${p.slug}`,
      jsonld: {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication',
        name: p.name, url: p.url, applicationCategory: cat,
        operatingSystem: /apps\.apple\.com/.test(p.url) ? 'iOS' : 'Web',
        description: (p.description || p.tagline || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        ...(p.image_url || p.icon_url ? { image: p.image_url || p.icon_url } : {}),
        ...(rating.count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.count, bestRating: 5, worstRating: 1 } } : {}),
      },
    })
    return () => clearJsonLd()
  }, [p, rating.avg, rating.count])
  return (
    <>
      <div className="l-crumb" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Link to="/v2">Home</Link> ›
        {p.category ? <CategoryPicker variant="crumb" current={p.category} /> : <span>{p.platform || 'Service'}</span>}
        › {p.name}
      </div>

      <div className="l-hero">
        <FaviconTile name={p.name} domain={p.domain} icon={vIcon} cls="l-ico" />
        <div>
          <h1 style={{ fontSize: 32, lineHeight: 1.1 }}>{p.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap' }}>
            <StarRating value={rating.avg} count={rating.count} tone={RATING_GOLD} />
            {ticketCount > 0 && <TicketBadge count={ticketCount} />}
          </div>
          <div className="l-one">{p.tagline || p.description}</div>
          <div className="l-pills">
            <span className="l-pill plat">{p.platform || 'web'}</span>
            <span className="l-pill">{p.domain}</span>
            {p.category && <span className="l-pill plat">{p.category}</span>}
            {p.category && <Link to={`/v2/alternatives/${p.slug}`} className="l-pill" style={{ color: '#97600F', textDecoration: 'none' }}>alternatives →</Link>}
          </div>
        </div>
        <div className="l-heroact">
          <a className="l-btn" href={p.url} target="_blank" rel="noopener noreferrer">Visit site ↗</a>
          <div className="l-prov">Info as of {dt} · from {p.domain}</div>
        </div>
      </div>

      <div className="l-cols">
        <main>
          {vPreview
            ? <div className="l-blk">
                <img src={vPreview} alt="" style={{ width: '100%', maxHeight: 560, objectFit: 'contain', borderRadius: 12, border: '1px solid #E9E2D4', display: 'block', background: '#F4F0E8' }}
                  onError={(e) => { const el = e.currentTarget.parentElement; if (el) el.style.display = 'none' }} />
              </div>
            : vIcon
              ? <div className="l-blk l-iconblk">
                  <img className="l-iconimg" src={vIcon} alt=""
                    onError={(e) => { const el = e.currentTarget.parentElement; if (el) el.style.display = 'none' }} />
                </div>
              : null}
          <div className="l-blk"><h2>What it is</h2><p className="l-lead">{p.description || p.tagline}</p></div>
          {whoFor.length > 0 && (
            <div className="l-blk"><h2>Who it&apos;s for</h2>
              <div className="l-who">{whoFor.map((w, i) => <span key={i} className="l-chip">{w}</span>)}</div>
            </div>
          )}
          {features.length > 0 && (
            <div className="l-blk"><h2>Key features</h2>
              <ul className="l-feat">{features.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div className="l-blk"><h2>Pricing</h2>
            {p.pricing ? <p className="l-lead">{p.pricing}</p>
              : <p className="l-note">Not stated on the page — see official site.</p>}
          </div>
          {p.how_to_use && <div className="l-blk"><h2>How to use</h2><p className="l-lead">{p.how_to_use}</p></div>}
        </main>

        <aside>
          <div className="l-lab">
            <div className="l-lh">◆ legit benchmark</div>
            {p.benchmark
              ? <BenchmarkChart b={p.benchmark} showOverall={isAdmin} />
              : <>
                  <svg className="l-lockic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9A9080" strokeWidth="1.7">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <div className="l-lockt">Benchmark pending</div>
                  <div className="l-locksub">Objective, reproducible measurements — quality, trust, activity, transparency.</div>
                </>}
          </div>
          <div className="l-facts" style={{ marginTop: 16 }}>
            <div className="l-f"><span className="l-k">Platform</span><span className="l-v">{p.platform || 'Web'}</span></div>
            <div className="l-f"><span className="l-k">Category</span><span className="l-v">{p.category || '—'}</span></div>
            <div className="l-f"><span className="l-k">Pricing</span><span className="l-v">{p.has_pricing ? 'Has paid plans' : 'See site'}</span></div>
            <div className="l-f"><span className="l-k">Added</span><span className="l-v">{dt}</span></div>
          </div>
        </aside>
      </div>

      <div className="l-reviews">
        <h2 style={{ marginBottom: 12 }}>Ratings &amp; reviews</h2>
        <div className="l-engage">
          <RatingPanel listingId={p.id} tone={RATING_GOLD} />
          <LegitVouch listingId={p.id} />
        </div>
        <ReviewsSection listingId={p.id} />
      </div>

      <ReactionBar listingId={p.id} />

      <VerifyOwnership p={p} onVerified={onReload} />

      {canEdit && (
        <div className="l-claimcta" style={{ marginTop: 16 }}>
          <div>
            <div className="l-claimcta-h">Manage this listing</div>
            <div className="l-claimcta-s">Edit {p.name}&apos;s tagline, description, category and pricing.</div>
          </div>
          <span className="l-btn" onClick={() => setEditing(true)}>Edit listing</span>
        </div>
      )}
      {editing && <EditListingModal p={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onReload() }} />}
    </>
  )
}

const CANON_CATS = [
  'AI & Agents', 'Developer Tools', 'MCP & Integrations', 'Frameworks & Starter Kits',
  'Infrastructure & DevOps', 'Data & Analytics', 'Productivity', 'Business & Finance',
  'Design & Creative', 'Content & Docs', 'Education & Reference', 'Lifestyle & Other',
]

// Owner/admin edit — patches the curated fields via ingest-directory's update
// action (ownership enforced server-side). Auto-discovered facts the benchmark
// owns (URL, signals, scores) aren't editable here.
function EditListingModal({ p, onClose, onSaved }: { p: Listing; onClose: () => void; onSaved: () => void }) {
  const [tagline, setTagline] = useState(p.tagline || '')
  const [description, setDescription] = useState(p.description || '')
  const [category, setCategory] = useState(p.category || '')
  const [pricing, setPricing] = useState(p.pricing || '')
  const [hasPricing, setHasPricing] = useState(!!p.has_pricing)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('ingest-directory', {
        body: { action: 'update', id: p.id, patch: { tagline, description, category, pricing, has_pricing: hasPricing } },
      })
      const d = (data || {}) as { ok?: boolean; error?: string; message?: string }
      if (error || d.error) { setErr(d.message || 'Could not save. Please try again.'); setBusy(false); return }
      onSaved()
    } catch { setErr('Network error. Please try again.'); setBusy(false) }
  }

  return (
    <div className="l-modal" onClick={onClose}>
      <div className="l-modalcard" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <button className="l-modalclose" onClick={onClose} aria-label="Close">×</button>
        <div className="l-subh">Edit {p.name}</div>
        <label className="l-edlabel">Tagline</label>
        <input className="l-authin" value={tagline} maxLength={90} onChange={e => setTagline(e.target.value)} placeholder="One plain sentence" />
        <label className="l-edlabel">Description</label>
        <textarea className="l-rvta" value={description} onChange={e => setDescription(e.target.value)} placeholder="What it does, who it's for, the key differentiator." />
        <label className="l-edlabel">Category</label>
        <select className="l-authin" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">—</option>
          {CANON_CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="l-edlabel">Pricing</label>
        <PricingField initial={pricing} onChange={(pr, hp) => { setPricing(pr); setHasPricing(hp) }} />
        {err && <div className="l-suberr">{err}</div>}
        <button className="l-btn l-authsubmit" style={{ marginTop: 14, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  )
}

// Domain ownership verification — add a meta tag (or DNS TXT), we fetch & confirm.
function VerifyOwnership({ p, onVerified }: { p: Listing; onVerified: () => void }) {
  const { user } = useAuth() as { user: { id?: string } | null }
  const { openAuth } = useLegitAuth()
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (p.verified_by) {
    return (
      <div className="l-vfy l-vfy-ok">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        Ownership verified
      </div>
    )
  }

  const getCode = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data } = await supabase.functions.invoke('ingest-directory', { body: { action: 'verify_token', id: p.id } })
      const d = (data || {}) as { token?: string; verified?: boolean; error?: string }
      if (d.verified) { onVerified(); return }
      if (d.token) setToken(d.token); else setMsg('Could not start verification. Please try again.')
    } catch { setMsg('Network error. Please try again.') }
    setBusy(false)
  }
  const doVerify = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data } = await supabase.functions.invoke('ingest-directory', { body: { action: 'verify', id: p.id } })
      const d = (data || {}) as { verified?: boolean; message?: string }
      if (d.verified) { onVerified(); return }
      setMsg(d.message || "Couldn't verify yet."); setBusy(false)
    } catch { setMsg('Network error. Please try again.'); setBusy(false) }
  }
  const tag = token ? `<meta name="legit-verify" content="${token}">` : ''

  return (
    <div className="l-vfy">
      <div className="l-vfy-h">Verify ownership</div>
      <div className="l-vfy-s">Prove you control {p.domain} to claim this listing and earn a verified badge.</div>
      {!user ? (
        <span className="l-btn" onClick={() => openAuth('signup')}>Sign in to verify</span>
      ) : !token ? (
        <span className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={getCode}>{busy ? 'Starting…' : 'Get verification tag'}</span>
      ) : (
        <>
          <div className="l-vfy-step">1. Add this to your site&apos;s <code>&lt;head&gt;</code>:</div>
          <div className="l-vfy-code" onClick={() => { try { navigator.clipboard?.writeText(tag) } catch { /* noop */ } setCopied(true) }}>{tag}<span className="l-vfy-copy">{copied ? 'copied' : 'copy'}</span></div>
          <div className="l-vfy-step">…or add a DNS TXT record <code>_legit.{p.domain}</code> = <code>{token}</code></div>
          <span className="l-btn" style={{ marginTop: 12, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={doVerify}>{busy ? 'Checking…' : "I've added it — Verify"}</span>
          {msg && <div className="l-suberr" style={{ marginTop: 10 }}>{msg}</div>}
        </>
      )}
    </div>
  )
}
