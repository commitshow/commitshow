import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LegitShell, FaviconTile, visuals, type Listing } from './legit'
import { setHead, clearJsonLd } from '../lib/seo'

// "{X} alternatives" — every other tested service in the same category, compared
// on the same deterministic benchmark. High-intent search + a clean, citable
// answer-engine surface. Pure leverage on existing data; no overall score shown.

const COLS = 'slug,name,domain,url,platform,category,tagline,pricing,has_pricing,image_url,icon_url,benchmark'
const SITE = 'https://commit.show'

const CSS = `
.alt-crumb{font-size:13px;color:#6E6557;padding:24px 0 0}
.alt-crumb a{color:#6E6557;text-decoration:none}.alt-crumb a:hover{color:#211C15}
.alt-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:27px;color:#211C15;margin:10px 0 3px;letter-spacing:-.01em}
.alt-sub{font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-bottom:24px}
.alt-tbl{width:100%;border-collapse:collapse;font-size:14px}
.alt-tbl th{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:#9A9080;text-transform:uppercase;letter-spacing:.05em;padding:0 0 11px;text-align:right;white-space:nowrap}
.alt-tbl th:first-child{text-align:left}
.alt-tbl thead tr{border-bottom:1px solid #E0D8C8}
.alt-tbl td{padding:12px 0;border-bottom:1px solid #F1EADE;text-align:right;color:#2C261D;font-variant-numeric:tabular-nums;white-space:nowrap}
.alt-tbl td:first-child{text-align:left;white-space:normal}
.alt-tbl tr.subj td{background:#FCFAF5}
.alt-svc{display:flex;align-items:center;gap:11px}
.alt-ic{width:30px;height:30px;border-radius:7px;flex-shrink:0;overflow:hidden;background:#F1EADE;display:flex;align-items:center;justify-content:center;font-weight:600;color:#9A8C6E;font-size:13px}
.alt-ic img{width:100%;height:100%;object-fit:cover}
.alt-nm{font-weight:600;color:#211C15;font-size:14.5px;line-height:1.2;text-decoration:none}
.alt-nm:hover{color:#97600F}
.alt-dm{font-size:11px;color:#9A9080;font-family:'JetBrains Mono',monospace}
.alt-you{font-size:10px;color:#97600F;font-family:'JetBrains Mono',monospace;margin-left:7px;text-transform:uppercase;letter-spacing:.05em}
.alt-q{display:inline-flex;align-items:center;gap:9px;justify-content:flex-end}
.alt-bar{width:50px;height:5px;border-radius:3px;background:#F1EADE;overflow:hidden;flex-shrink:0}
.alt-bar>i{display:block;height:100%;background:#E0A92E}
.alt-dim{color:#9A9080}
.alt-empty{font-size:14px;color:#9A9080;padding:8px 0 40px}
@media(max-width:640px){.alt-bar{display:none}.alt-tbl th.opt,.alt-tbl td.opt{display:none}.alt-dm{display:none}}
`

type Bench = { quality?: number; trust?: number; activity?: number; transparency?: number }
const bm = (l: Listing): Bench => (l.benchmark as Bench) || {}

function Cells({ l }: { l: Listing }) {
  const b = bm(l)
  return (
    <>
      <td><span className="alt-q"><span className="alt-bar"><i style={{ width: `${b.quality ?? 0}%` }} /></span>{b.quality ?? '—'}</span></td>
      <td className="opt">{b.trust ?? '—'}</td>
      <td className="opt">{b.activity ?? '—'}</td>
      <td className="opt">{b.transparency ?? '—'}</td>
      <td>{l.has_pricing ? 'Paid' : '—'}</td>
    </>
  )
}

export function AlternativesPage() {
  const { slug } = useParams<{ slug: string }>()
  const [subject, setSubject] = useState<Listing | null | undefined>(undefined)
  const [alts, setAlts] = useState<Listing[] | null>(null)

  useEffect(() => {
    if (!slug) return
    let alive = true
    setSubject(undefined); setAlts(null)
    supabase.from('listings').select(COLS).eq('slug', slug).maybeSingle().then(({ data }) => {
      if (!alive) return
      const s = (data as Listing | null) ?? null
      setSubject(s)
      if (!s || !s.category) { setAlts([]); return }
      supabase.from('listings').select(COLS).eq('category', s.category).neq('slug', slug).not('benchmark', 'is', null).limit(80)
        .then(({ data: d }) => {
          if (!alive) return
          const rows = ((d as Listing[]) || []).sort((a, b) => (bm(b).quality ?? 0) - (bm(a).quality ?? 0)).slice(0, 12)
          setAlts(rows)
        })
    })
    return () => { alive = false }
  }, [slug])

  const cat = subject?.category || subject?.platform || 'service'

  useEffect(() => {
    if (!subject) return
    const names = (alts || []).map(a => a.name)
    const title = `${subject.name} alternatives — ${names.length} tested options compared | Legit.Show`
    const description = names.length
      ? `${names.length} tested ${cat} alternatives to ${subject.name}, compared on the same objective benchmark${names.length ? `: ${names.slice(0, 6).join(', ')}` : ''}.`.replace(/\s+/g, ' ').slice(0, 200)
      : `Tested ${cat} alternatives to ${subject.name} on Legit.Show.`
    setHead({
      title, description,
      canonical: `${SITE}/v2/alternatives/${subject.slug}`,
      jsonld: {
        '@context': 'https://schema.org', '@type': 'ItemList',
        name: `${subject.name} alternatives`,
        itemListElement: (alts || []).map((a, i) => ({
          '@type': 'ListItem', position: i + 1,
          item: { '@type': 'SoftwareApplication', name: a.name, url: a.url, applicationCategory: a.category || cat },
        })),
      },
    })
    return () => clearJsonLd()
  }, [subject, alts, cat])

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="l-wrap" style={{ paddingBottom: 56 }}>
        {subject === undefined && <div className="alt-dim" style={{ padding: '40px 0' }}>Loading…</div>}
        {subject === null && (
          <div style={{ padding: '40px 0' }}>
            <h1 className="alt-h">Not found</h1>
            <p><Link to="/v2" style={{ color: '#97600F' }}>← directory</Link></p>
          </div>
        )}
        {subject && (
          <>
            <div className="alt-crumb">
              <Link to="/v2">Home</Link> › <Link to={`/v2?cat=${encodeURIComponent(cat)}`}>{cat}</Link> › <Link to={`/v2/s/${subject.slug}`}>{subject.name}</Link> › alternatives
            </div>
            <h1 className="alt-h">{subject.name} alternatives</h1>
            <div className="alt-sub">
              {alts === null ? 'Loading…' : `${alts.length} tested ${cat} alternative${alts.length === 1 ? '' : 's'} · same benchmark · 0–100 per axis`}
            </div>

            {alts && alts.length === 0
              ? <div className="alt-empty">No other tested {cat} services yet. <Link to="/v2" style={{ color: '#97600F' }}>Browse the directory →</Link></div>
              : (
                <table className="alt-tbl">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Quality</th>
                      <th className="opt">Trust</th>
                      <th className="opt">Activity</th>
                      <th className="opt">Transparency</th>
                      <th>Pricing</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ServiceRow l={subject} you />
                    {(alts || []).map(a => <ServiceRow key={a.slug} l={a} />)}
                  </tbody>
                </table>
              )}
          </>
        )}
      </div>
    </LegitShell>
  )
}

function ServiceRow({ l, you = false }: { l: Listing; you?: boolean }) {
  const ic = useMemo(() => visuals(l).icon, [l])
  return (
    <tr className={you ? 'subj' : undefined}>
      <td>
        <div className="alt-svc">
          <FaviconTile name={l.name} domain={l.domain} icon={ic} cls="alt-ic" />
          <div>
            <Link to={`/v2/s/${l.slug}`} className="alt-nm">{l.name}</Link>
            {you && <span className="alt-you">this</span>}
            <div className="alt-dm">{l.domain}</div>
          </div>
        </div>
      </td>
      <Cells l={l} />
    </tr>
  )
}
