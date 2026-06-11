import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CategoryPicker, LegitShell, ListingRow, PremiumCard, type Listing } from './legit'
import { setHead, clearJsonLd } from '../lib/seo'

type Stats = { uses_count: number; positive_count: number; negative_count: number }

// Default ranking signal = completeness (quality of the structured listing)
// + lifetime reaction/usage signal + legit-ticket vouches (heaviest). All-time.
function rankScore(r: Listing, s?: Stats, tickets = 0): number {
  let c = 0
  if (r.image_url) c += 3
  if (r.category) c += 2
  if (r.tagline) c += 1
  if (r.description && r.description.length > 40) c += 2
  if ((r.features?.length || 0) >= 3) c += 2
  if (r.who_for?.length) c += 1
  if (r.pricing) c += 1
  if (r.how_to_use) c += 1
  const rx = s ? s.uses_count * 3 + s.positive_count * 2 - s.negative_count : 0
  return c + rx + tickets * 4
}

export function DirectoryPage() {
  const [rows, setRows] = useState<Listing[] | null>(null)
  const [stats, setStats] = useState<Map<string, Stats>>(new Map())
  const [tickets, setTickets] = useState<Map<string, number>>(new Map())
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const cat = params.get('cat')
  const platform = params.get('platform')
  const setCat = (c: string | null) => {
    const next = new URLSearchParams(params)
    if (c) next.set('cat', c); else next.delete('cat')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    let alive = true
    supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => { if (alive) setRows((data as Listing[] | null) || []) })
    supabase
      .from('listing_reaction_stats')
      .select('listing_id, uses_count, positive_count, negative_count')
      .then(({ data }) => {
        if (!alive || !data) return
        const m = new Map<string, Stats>()
        for (const s of data as ({ listing_id: string } & Stats)[]) m.set(s.listing_id, s)
        setStats(m)
      })
    supabase
      .from('listing_ticket_stats')
      .select('listing_id, ticket_count')
      .then(({ data }) => {
        if (!alive || !data) return
        const m = new Map<string, number>()
        for (const t of data as { listing_id: string; ticket_count: number }[]) m.set(t.listing_id, t.ticket_count)
        setTickets(m)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    setHead({
      title: 'Legit.Show — every launched service, tested',
      description: 'A directory of launched web apps, SaaS, AI tools, MCP servers and Skills — what each does, who it is for, real ratings, and an objective benchmark.',
      canonical: 'https://legit.show',
      jsonld: {
        '@context': 'https://schema.org', '@type': 'WebSite', name: 'Legit.Show', url: 'https://legit.show',
        potentialAction: { '@type': 'SearchAction', target: 'https://legit.show/?q={search_term_string}', 'query-input': 'required name=search_term_string' },
      },
    })
    return () => clearJsonLd()
  }, [])

  const cats = useMemo(() => {
    if (!rows) return []
    const m = new Map<string, number>()
    for (const r of rows) if (r.category) m.set(r.category, (m.get(r.category) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    const out = rows.filter(r => {
      if (cat && r.category !== cat) return false
      if (platform && (r.platform || 'web') !== platform) return false
      if (needle) {
        const hay = `${r.name} ${r.tagline || ''} ${r.description || ''} ${r.domain} ${r.category || ''} ${(r.features || []).join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    // Default order = quality/completeness + reactions + legit tickets, desc.
    // Stable sort keeps created_at desc as the tiebreak (rows arrive newest-first).
    return [...out].sort((a, b) => rankScore(b, stats.get(b.id), tickets.get(b.id)) - rankScore(a, stats.get(a.id), tickets.get(a.id)))
  }, [rows, q, cat, platform, stats, tickets])

  const featured = useMemo(() =>
    (rows || []).filter(r => r.image_url)
      .sort((a, b) => rankScore(b, stats.get(b.id), tickets.get(b.id)) - rankScore(a, stats.get(a.id), tickets.get(a.id)))
      .slice(0, 10),
    [rows, stats, tickets])

  // right-edge fade on the category row — shown only while there's more to
  // scroll, hidden once scrolled to the end.
  const catRef = useRef<HTMLDivElement>(null)
  const [catFade, setCatFade] = useState(false)
  useEffect(() => {
    const el = catRef.current
    if (!el) return
    const update = () => setCatFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [cats])

  return (
    <LegitShell>
      <div className="l-herobig">
        <div className="l-wrap">
          <h1>Discover Legit Products</h1>
          <div className="sub">What each one does, who it&apos;s for, and how it holds up.</div>
          <img className="l-owl" src="/owl_smallest.webp" alt="" width="108" height="79" fetchPriority="high" />
          <div className="l-bigsearch">
            <CategoryPicker variant="search" current={cat} />
            <input
              id="l-hero-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search tested services…"
              autoComplete="off"
            />
          </div>
          <div className="l-statrow">
            <span><b>{rows ? rows.length : '—'}</b> services</span>
            <span><b>{cats.length}</b> categories</span>
            <Link to="/reports" style={{ color: '#97600F', textDecoration: 'none' }}>reports →</Link>
            <Link to="/insights" style={{ color: '#97600F', textDecoration: 'none' }}>insights →</Link>
          </div>
        </div>
      </div>

      {/* reserve a screen height so the footer starts below the fold — the async
          listings would otherwise shift it up→down (the main CLS culprit) */}
      <main className="l-wrap" style={{ minHeight: '100vh' }}>
        {!q && !cat && !platform && featured.length > 0 && (
          <div className="l-premium">{featured.map(p => <PremiumCard key={p.id} p={p} tickets={tickets.get(p.id) || 0} />)}</div>
        )}
        {platform && (
          <div className="l-feedhead" style={{ marginTop: 6 }}>
            <span className="c" style={{ fontSize: 13 }}>Platform · <b style={{ color: '#211C15' }}>{platform}</b> · <Link to="/" style={{ color: '#97600F' }}>clear</Link></span>
          </div>
        )}
        {cats.length > 0 && (
          <div className="l-catwrap">
            <div className="l-cattiles" ref={catRef}>
              <span className={`l-cattile ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>All</span>
              {cats.map(c => (
                <span key={c} className={`l-cattile ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? null : c)}>{c}</span>
              ))}
            </div>
            {catFade && <span className="l-catfade" />}
          </div>
        )}

        <div className="l-feedhead">
          <h2>{cat || platform || (q ? 'Search results' : 'All services')}</h2>
          <span className="c">{rows ? `${filtered.length} shown` : ''}</span>
        </div>

        {rows === null && <div className="l-empty">Loading…</div>}
        {rows && filtered.length === 0 && <div className="l-empty">No services match — try a different search or category.</div>}
        {filtered.map(p => <ListingRow key={p.id} p={p} tickets={tickets.get(p.id) || 0} />)}
      </main>
    </LegitShell>
  )
}
