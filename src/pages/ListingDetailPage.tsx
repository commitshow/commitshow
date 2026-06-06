import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FaviconTile, LegitShell, RatingPanel, ReactionBar, StarRating, TicketPanel, ticketTier, useLegitAuth, visuals, type Listing } from './legit'

export function ListingDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [p, setP] = useState<Listing | null | undefined>(undefined)

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
  }, [slug])

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
        {p && <Detail p={p} />}
      </div>
    </LegitShell>
  )
}

function Detail({ p }: { p: Listing }) {
  const { openAuth, loggedIn } = useLegitAuth()
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
  const starTone = ticketTier(ticketCount).tone
  return (
    <>
      <div className="l-crumb">
        <Link to="/v2">Home</Link> › {p.category || p.platform || 'Service'} › {p.name}
      </div>

      <div className="l-hero">
        <FaviconTile name={p.name} domain={p.domain} icon={vIcon} cls="l-ico" />
        <div>
          <h1 style={{ fontSize: 32, lineHeight: 1.1 }}>{p.name}</h1>
          <StarRating value={rating.avg} count={rating.count} tone={starTone} />
          <div className="l-one">{p.tagline || p.description}</div>
          <div className="l-pills">
            <span className="l-pill plat">{p.platform || 'web'}</span>
            <span className="l-pill">{p.domain}</span>
            {p.category && <span className="l-pill plat">{p.category}</span>}
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
            <svg className="l-lockic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9A9080" strokeWidth="1.7">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div className="l-lockt">{loggedIn ? 'Benchmark coming soon' : 'Sign in to run the benchmark'}</div>
            <div className="l-locksub">Objective, reproducible measurements — performance, security, reliability.</div>
            {!loggedIn && <span className="l-btn" onClick={() => openAuth('signup')}>Sign in — it&apos;s free</span>}
          </div>
          <div className="l-facts" style={{ marginTop: 16 }}>
            <div className="l-f"><span className="l-k">Platform</span><span className="l-v">{p.platform || 'Web'}</span></div>
            <div className="l-f"><span className="l-k">Category</span><span className="l-v">{p.category || '—'}</span></div>
            <div className="l-f"><span className="l-k">Pricing</span><span className="l-v">{p.has_pricing ? 'Has paid plans' : 'See site'}</span></div>
            <div className="l-f"><span className="l-k">Added</span><span className="l-v">{dt}</span></div>
          </div>
        </aside>
      </div>

      <TicketPanel listingId={p.id} />

      <ReactionBar listingId={p.id} />

      <div className="l-reviews">
        <h2 style={{ marginBottom: 12 }}>Ratings &amp; reviews</h2>
        <RatingPanel listingId={p.id} tone={starTone} />
        <div className="l-empty">
          <b>Written reviews are coming.</b> For now your star rating and a legit ticket are the fastest way to weigh in.
        </div>
      </div>

      <div className="l-claimcta">
        <div>
          <div className="l-claimcta-h">Is this your service?</div>
          <div className="l-claimcta-s">Claim {p.name} to manage its details and respond to ratings.</div>
        </div>
        <span className="l-btn" onClick={() => openAuth('signup')}>Claim this listing</span>
      </div>

      <div className="l-foot">
        Structured from public information on the official site — confirm details there. · <Link to="/terms">Terms</Link>
      </div>
    </>
  )
}
