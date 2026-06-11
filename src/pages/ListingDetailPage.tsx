import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BenchmarkChart, CategoryPicker, FaviconTile, LegitShell, LegitVouch, PricingField, RatingPanel, ReactionBar, RepoAuditCards, ReviewsSection, StarRating, TicketBadge, useLegitAuth, VerifyOwnership, visuals, type Listing } from './legit'
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
            <p><Link to="/" style={{ color: '#97600F' }}>← directory</Link></p>
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
  const [claimOpen, setClaimOpen] = useState(false)
  const dt = (p.info_as_of || '').slice(0, 10)
  const whoFor = p.who_for || []
  const features = p.features || []
  const { icon: vIcon, preview: vPreview } = visuals(p)
  const [ticketCount, setTicketCount] = useState(0)
  const [altCount, setAltCount] = useState(0)
  const [rating, setRatingStats] = useState<{ avg: number; count: number }>({ avg: 0, count: 0 })
  useEffect(() => {
    let alive = true
    supabase.from('listing_ticket_stats').select('ticket_count').eq('listing_id', p.id).maybeSingle()
      .then(({ data }) => { if (alive) setTicketCount((data as { ticket_count: number } | null)?.ticket_count || 0) })
    if (p.category) supabase.from('listings').select('id', { count: 'exact', head: true }).eq('category', p.category).neq('slug', p.slug).not('benchmark', 'is', null)
      .then(({ count }) => { if (alive) setAltCount(count || 0) })
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
      canonical: `https://legit.show/s/${p.slug}`,
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
        <Link to="/">Home</Link> ›
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
            <Link to={`/?platform=${encodeURIComponent(p.platform || 'web')}`} className="l-pill plat">{p.platform || 'web'}</Link>
            <span className="l-pill">{p.domain}</span>
            {p.category && <Link to={`/?cat=${encodeURIComponent(p.category)}`} className="l-pill plat">{p.category}</Link>}
          </div>
        </div>
        <div className="l-heroact">
          <a className="l-btn" href={p.url} target="_blank" rel="noopener noreferrer">Visit site ↗</a>
          {p.category && altCount > 0 && (
            <Link to={`/alternatives/${p.slug}`} className="l-altcta">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></svg>
              Compare {altCount} alternative{altCount === 1 ? '' : 's'}
            </Link>
          )}
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
              ? <BenchmarkChart b={p.benchmark} showOverall={isAdmin} interactive />
              : <>
                  <svg className="l-lockic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6F6757" strokeWidth="1.7">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <div className="l-lockt">Benchmark pending</div>
                  <div className="l-locksub">Objective, reproducible measurements across seven production-readiness frames.</div>
                </>}
          </div>
          {p.repo_audit?.checks && (
            <div className="l-lab" style={{ marginTop: 12 }}>
              <RepoAuditCards audit={p.repo_audit} />
            </div>
          )}
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

      {canEdit && (
        <div className="l-claimcta" style={{ marginTop: 28 }}>
          <div>
            <div className="l-claimcta-h">Manage this listing</div>
            <div className="l-claimcta-s">Edit {p.name}&apos;s tagline, description, category and pricing.</div>
          </div>
          <span className="l-btn" onClick={() => setEditing(true)}>Edit listing</span>
        </div>
      )}

      {p.verified_by ? (
        <div className="l-claimline"><span className="l-claimverified"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg> Verified owner</span></div>
      ) : claimOpen ? (
        <VerifyOwnership listingId={p.id} domain={p.domain} verified={false} onVerified={onReload} />
      ) : (
        <div className="l-claimline"><span className="l-claimlink" onClick={() => setClaimOpen(true)}>Is this your service? Claim it →</span></div>
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
