import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LegitShell } from './legit'
import { useAuth } from '../lib/auth'
import { setHead, clearJsonLd } from '../lib/seo'

// A published data report — the "According to Legit.Show" citation surface. Reads a
// frozen row from `reports` (stable numbers + stated sample + date) and renders it
// citation-first: one hero stat, the failure bars in plain language, a hall of fame
// that links to each tool, a visible methodology box, and a copy-paste cite block.

type Stat = { key: string; label: string; plain: string; fix?: string; fail: number; n: number; fail_pct: number | null; limited?: boolean }
type Tool = { name: string; slug: string; pass?: number; fail?: number }
type Band = { label: string; n: number; pct: number; tone: string }
type CatRow = { category: string; n: number; fail_pct: number }
type Report = {
  slug: string; kind: string; title: string; subtitle: string; coined_term: string | null
  hero_stat: { value: number; unit: string; label: string; n: number }
  sample: { total: number; scope: string; as_of: string }
  stats: Stat[]; hall_of_fame: Tool[]; lowlights: Tool[]
  distribution?: { title: string; note: string; bands: Band[] } | null
  by_category?: { metric: string; rows: CatRow[] } | null
  status?: string
  compare?: { oss_n: number; saas_n: number; oss_label: string; saas_label: string; frames: { key: string; label: string; oss: number; saas: number }[] } | null
  trend?: { window_days: number; n: number; avg_delta: number; improved_pct: number; most_improved: { name: string; slug: string; delta: number }[] } | null
  body: { h: string; md: string }[]; published_at: string
}

const SITE = 'https://legit.show'
const CSS = `
.rp-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#97600F;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.rp-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(30px,5vw,46px);line-height:1.06;color:#211C15;letter-spacing:-.015em;margin:10px 0 14px}
.rp-sub{font-size:16px;line-height:1.6;color:#4A4438;max-width:680px}
.rp-meta{font-family:'JetBrains Mono',monospace;font-size:12px;color:#6F6757;margin-top:16px;display:flex;gap:14px;flex-wrap:wrap}
.rp-hero{background:#211C15;border-radius:18px;padding:38px 32px;margin:30px 0 8px;text-align:center;color:#F8F5EE}
.rp-herov{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(64px,14vw,120px);line-height:.95;color:#E0A92E;letter-spacing:-.02em}
.rp-herol{font-size:16px;line-height:1.5;color:#E9E2D4;max-width:520px;margin:12px auto 0}
.rp-herocite{font-family:'JetBrains Mono',monospace;font-size:11px;color:#9A9080;margin-top:16px;letter-spacing:.04em}
.rp-sec{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:24px;color:#211C15;margin:46px 0 4px}
.rp-secn{font-size:13px;color:#6F6757;font-family:'JetBrains Mono',monospace;margin-bottom:20px}
.rp-bar{padding:15px 0;border-top:1px solid #ECE3D2}
.rp-bar:first-of-type{border-top:none}
.rp-barhead{display:flex;align-items:baseline;gap:10px}
.rp-barlabel{font-weight:600;font-size:16px;color:#2C261D}
.rp-barpct{margin-left:auto;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:26px;color:#C24A33;line-height:1}
.rp-barn{font-family:'JetBrains Mono',monospace;font-size:11px;color:#9A9080}
.rp-track{height:8px;background:#EFE6D2;border-radius:5px;overflow:hidden;margin:9px 0 7px}
.rp-fill{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#C24A33,#A8742E)}
.rp-plain{font-size:13.5px;color:#5A5347;line-height:1.5}
.rp-fix{font-size:12.5px;color:#4E7A36;line-height:1.45;margin-top:5px}
.rp-fix b{font-weight:600;color:#3F6A2A}
.rp-dist{display:flex;flex-direction:column;gap:12px;margin-top:2px}
.rp-distrow{display:grid;grid-template-columns:135px 1fr 78px;align-items:center;gap:14px}
.rp-distlabel{font-size:13.5px;color:#2C261D;font-weight:500}
.rp-disttrack{height:18px;background:#EFE6D2;border-radius:5px;overflow:hidden}
.rp-distfill{display:block;height:100%;border-radius:5px}
.rp-distval{font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#211C15;text-align:right;font-weight:600}
.rp-cat{width:100%;border-collapse:collapse;font-size:14px;margin-top:2px}
.rp-cat td{padding:11px 0;border-top:1px solid #ECE3D2}
.rp-cat tr:first-child td{border-top:none}
.rp-cat .ct{font-weight:500;color:#2C261D}
.rp-cat .num{font-family:'JetBrains Mono',monospace;color:#9A9080;text-align:right;font-size:12px;padding-right:16px;white-space:nowrap}
.rp-cat .bar{width:130px}.rp-cat .bar span{display:block;height:14px;background:#EFE6D2;border-radius:4px;overflow:hidden}.rp-cat .bar i{display:block;height:100%;background:#C24A33;border-radius:4px}
.rp-cat .pct{font-family:'JetBrains Mono',monospace;color:#C24A33;text-align:right;font-weight:600;width:54px}
@media(max-width:560px){.rp-distrow{grid-template-columns:110px 1fr 64px;gap:9px}.rp-cat .num,.rp-cat .bar{display:none}}
.rp-limited{opacity:.62}
.rp-limnote{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#A8742E;margin-left:7px}
.rp-tools{display:flex;flex-wrap:wrap;gap:9px;margin-top:6px}
.rp-tool{display:inline-flex;align-items:center;gap:7px;background:#FCFAF5;border:1px solid #E7D4AC;border-radius:999px;padding:7px 14px;font-size:13.5px;color:#211C15;text-decoration:none;font-weight:500}
.rp-tool:hover{border-color:#C99A2E}
.rp-tool .n{font-family:'JetBrains Mono',monospace;font-size:11px;color:#5C8A3E}
.rp-method{background:#FBF6EC;border:1px solid #E7D4AC;border-radius:14px;padding:22px 24px;margin-top:18px}
.rp-method h3{font-size:15px;font-family:Fraunces,Georgia,serif;font-weight:600;color:#211C15;margin-bottom:8px}
.rp-method p{font-size:13.5px;color:#5A5347;line-height:1.6;margin-bottom:8px}
.rp-cite{border:1px dashed #C99A2E;border-radius:14px;padding:20px 22px;margin-top:18px;background:#fff}
.rp-citeh{font-family:'JetBrains Mono',monospace;font-size:11px;color:#97600F;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px}
.rp-citebox{font-size:14px;line-height:1.6;color:#2C261D;background:#FBF6EC;border-radius:8px;padding:13px 15px}
.rp-citebtn{margin-top:10px;background:#97600F;color:#fff;border:none;border-radius:8px;padding:8px 15px;font-size:13px;font-weight:600;cursor:pointer}
.rp-citebtn:hover{background:#7E4F0C}
.rp-citeperm{font-size:11.5px;color:#6F6757;margin-top:9px;line-height:1.5}
.rp-cta{display:flex;gap:12px;flex-wrap:wrap;margin:40px 0 10px}
.lgt a.rp-ctaa{background:#97600F;color:#fff;text-decoration:none;border-radius:8px;padding:12px 20px;font-weight:600;font-size:14.5px}
.lgt a.rp-ctaa.ghost{background:#fff;color:#97600F;border:1px solid #E7D4AC}
.rp-body p{font-size:15px;line-height:1.7;color:#3C362C;max-width:680px;margin:10px 0}
.rp-cmp{padding:12px 0;border-top:1px solid #ECE3D2}.rp-cmp:first-of-type{border-top:none}
.rp-cmplabel{font-weight:600;font-size:14.5px;color:#2C261D;margin-bottom:7px}
.rp-cmprow{display:grid;grid-template-columns:90px 1fr 36px;align-items:center;gap:11px;margin:4px 0}
.rp-cmptag{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#6F6757}
.rp-cmptrack{height:14px;background:#EFE6D2;border-radius:4px;overflow:hidden}.rp-cmpfill{display:block;height:100%;border-radius:4px}
.rp-cmpv{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:#211C15;text-align:right}
@media(max-width:560px){.rp-cmprow{grid-template-columns:64px 1fr 30px;gap:8px}}
.rp-adminbar{display:flex;align-items:center;gap:10px;margin:-6px 0 14px}
.rp-status{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 8px;border-radius:5px}
.rp-status.draft{background:#FBEFD9;color:#A8742E;border:1px solid #E7D4AC}
.rp-status.pub{background:#E7F0DD;color:#4E7A36;border:1px solid #CFE0BE}
.rp-pubbtn{font-size:12.5px;font-weight:600;border:none;border-radius:7px;padding:6px 14px;cursor:pointer;background:#97600F;color:#fff}
.rp-pubbtn.ghost{background:#fff;color:#97600F;border:1px solid #E7D4AC}
`

function bold(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>)
}

export function ReportDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [r, setR] = useState<Report | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [bump, setBump] = useState(0)
  const { member } = useAuth() as { member: { is_admin?: boolean } | null }
  const isAdmin = !!member?.is_admin

  useEffect(() => {
    if (!slug) return
    // no status filter — RLS returns drafts only to admins
    supabase.from('reports').select('*').eq('slug', slug).maybeSingle()
      .then(({ data }) => setR((data as Report | null) ?? null))
  }, [slug, bump])

  const setStatus = async (status: string) => {
    if (!r) return
    await supabase.from('reports').update({ status }).eq('slug', r.slug)
    setBump(b => b + 1)
  }

  useEffect(() => {
    if (!r) return
    const year = (r.sample?.as_of || '').slice(0, 4)
    setHead({
      title: `${r.title} | Legit.Show`,
      description: `${r.hero_stat.value}% — ${r.hero_stat.label}. ${r.subtitle}`.replace(/\s+/g, ' ').slice(0, 200),
      canonical: `${SITE}/reports/${r.slug}`,
      jsonld: {
        '@context': 'https://schema.org', '@type': 'Dataset',
        name: r.title, description: r.subtitle,
        url: `${SITE}/reports/${r.slug}`, datePublished: r.published_at,
        creator: { '@type': 'Organization', name: 'Legit.Show', url: SITE },
        isAccessibleForFree: true, keywords: ['production readiness', 'AI tools', 'benchmark', r.coined_term || ''].filter(Boolean),
        measurementTechnique: 'Legit.Show 7-Frame benchmark (deterministic repository + URL analysis)',
        variableMeasured: (r.stats || []).map(s => ({ '@type': 'PropertyValue', name: s.label, value: `${s.fail_pct}%`, description: `${s.fail} of ${s.n}` })),
      },
    })
    return () => clearJsonLd()
  }, [r])

  if (r === undefined) return <LegitShell><div className="l-wrap" style={{ paddingTop: 40 }}><h1>Loading…</h1></div></LegitShell>
  if (r === null) return <LegitShell><div className="l-wrap" style={{ paddingTop: 40 }}><h1>Report not found</h1><p><Link to="/reports" style={{ color: '#97600F' }}>← all reports</Link></p></div></LegitShell>

  const url = `${SITE}/reports/${r.slug}`
  const citation = `According to Legit.Show’s 7-Frame benchmark (${(r.sample?.as_of || '').slice(0, 4)}), ${r.hero_stat.value}% of ${r.sample?.scope} ${r.hero_stat.label.replace(/^of [^,]+\s/, '')}. — ${url}`
  const copy = () => { try { navigator.clipboard?.writeText(citation) } catch { /* */ } setCopied(true) }

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="l-wrap" style={{ maxWidth: 760, paddingTop: 30, paddingBottom: 80 }}>
        <div className="l-crumb" style={{ marginBottom: 28 }}><Link to="/reports">Reports</Link> › {r.title}</div>
        {r.coined_term && <div className="rp-eyebrow">{r.coined_term} · {(r.sample?.as_of || '').slice(0, 4)} edition</div>}
        <h1 className="rp-h">{r.title}</h1>
        {isAdmin && (
          <div className="rp-adminbar">
            <span className={`rp-status ${r.status === 'draft' ? 'draft' : 'pub'}`}>{r.status === 'draft' ? 'DRAFT' : 'PUBLISHED'}</span>
            {r.status === 'draft'
              ? <button className="rp-pubbtn" onClick={() => setStatus('published')}>Publish</button>
              : <button className="rp-pubbtn ghost" onClick={() => setStatus('draft')}>Unpublish</button>}
          </div>
        )}
        <p className="rp-sub">{r.subtitle}</p>
        <div className="rp-meta">
          <span>Published {(r.sample?.as_of || r.published_at || '').slice(0, 10)}</span>
          <span>{r.sample?.total} services tested</span>
          <span>{r.sample?.scope}</span>
        </div>

        <div className="rp-hero">
          <div className="rp-herov">{r.hero_stat.value}{r.hero_stat.unit}</div>
          <div className="rp-herol">{r.hero_stat.label}</div>
          <div className="rp-herocite">according to Legit.Show · {(r.sample?.as_of || '').slice(0, 4)}</div>
        </div>

        <h2 className="rp-sec">The 7-Frame trust gap</h2>
        <div className="rp-secn">What AI-assisted coding ships to production — and what it quietly skips. Failure rate per check (denominator = tools the check applies to).</div>
        {(r.stats || []).map(s => (
          <div key={s.key} className={`rp-bar ${s.limited ? 'rp-limited' : ''}`}>
            <div className="rp-barhead">
              <span className="rp-barlabel">{s.label}</span>
              <span className="rp-barpct">{s.fail_pct}%</span>
            </div>
            <div className="rp-track"><span className="rp-fill" style={{ width: `${s.fail_pct ?? 0}%` }} /></div>
            <div className="rp-plain">{s.plain}</div>
            {s.fix && <div className="rp-fix"><b>Fix:</b> {s.fix}</div>}
          </div>
        ))}

        {r.distribution?.bands?.length ? (
          <>
            <h2 className="rp-sec">{r.distribution.title}</h2>
            <div className="rp-secn">{r.distribution.note}</div>
            <div className="rp-dist">
              {r.distribution.bands.map(b => (
                <div key={b.label} className="rp-distrow">
                  <span className="rp-distlabel">{b.label}</span>
                  <span className="rp-disttrack"><span className="rp-distfill" style={{ width: `${b.pct}%`, background: b.tone }} /></span>
                  <span className="rp-distval">{b.pct}% · {b.n}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {r.by_category?.rows?.length ? (
          <>
            <h2 className="rp-sec">By category</h2>
            <div className="rp-secn">Share with {r.by_category.metric}, by category.</div>
            <table className="rp-cat"><tbody>
              {r.by_category.rows.map(c => (
                <tr key={c.category}>
                  <td className="ct">{c.category}</td>
                  <td className="num">{c.n}</td>
                  <td className="bar"><span><i style={{ width: `${c.fail_pct}%` }} /></span></td>
                  <td className="pct">{c.fail_pct}%</td>
                </tr>
              ))}
            </tbody></table>
          </>
        ) : null}

        {r.compare?.frames?.length ? (
          <>
            <h2 className="rp-sec">{r.compare.oss_label} vs {r.compare.saas_label}</h2>
            <div className="rp-secn">Group average per frame (0–100) · {r.compare.oss_n} open-source · {r.compare.saas_n} closed.</div>
            {r.compare.frames.map(f => (
              <div key={f.key} className="rp-cmp">
                <div className="rp-cmplabel">{f.label}</div>
                <div className="rp-cmprow"><span className="rp-cmptag">{r.compare!.oss_label}</span><span className="rp-cmptrack"><span className="rp-cmpfill" style={{ width: `${f.oss}%`, background: '#5C8A3E' }} /></span><span className="rp-cmpv">{f.oss}</span></div>
                <div className="rp-cmprow"><span className="rp-cmptag">{r.compare!.saas_label}</span><span className="rp-cmptrack"><span className="rp-cmpfill" style={{ width: `${f.saas}%`, background: '#A8742E' }} /></span><span className="rp-cmpv">{f.saas}</span></div>
              </div>
            ))}
          </>
        ) : null}

        {r.trend && r.trend.most_improved?.length ? (
          <>
            <h2 className="rp-sec">What changed</h2>
            <div className="rp-secn">{r.trend.n} tools re-tested over the last {r.trend.window_days} days · {r.trend.improved_pct}% improved · avg {r.trend.avg_delta > 0 ? '+' : ''}{r.trend.avg_delta} pts.</div>
            <div className="rp-tools">
              {r.trend.most_improved.map(m => (
                <Link key={m.slug} to={`/s/${m.slug}`} className="rp-tool">{m.name}<span className="n" style={{ color: '#5C8A3E' }}>+{m.delta}</span></Link>
              ))}
            </div>
          </>
        ) : null}

        {(r.body || []).map((b, i) => (
          <div key={i} className="rp-body"><h2 className="rp-sec">{b.h}</h2><p>{bold(b.md)}</p></div>
        ))}

        {r.hall_of_fame?.length > 0 && (
          <>
            <h2 className="rp-sec">Hall of fame</h2>
            <div className="rp-secn">Tools that passed every check they were measured on.</div>
            <div className="rp-tools">
              {r.hall_of_fame.map(t => (
                <Link key={t.slug} to={`/s/${t.slug}`} className="rp-tool">{t.name}<span className="n">{t.pass}/{(t.pass || 0) + (t.fail || 0)} ✓</span></Link>
              ))}
            </div>
          </>
        )}

        {r.lowlights?.length > 0 && (
          <>
            <h2 className="rp-sec">The biggest gaps</h2>
            <div className="rp-secn">Most missing controls — a chance to fix and re-audit, not a verdict.</div>
            <div className="rp-tools">
              {r.lowlights.map(t => (
                <Link key={t.slug} to={`/s/${t.slug}`} className="rp-tool">{t.name}<span className="n" style={{ color: '#C24A33' }}>{t.fail} gaps</span></Link>
              ))}
            </div>
          </>
        )}

        <div className="rp-method">
          <h3>How this was measured</h3>
          <p>Every number is a count over {r.sample?.total} open-source tools with a public repository, scanned by Legit.Show’s deterministic 7-Frame benchmark — no LLM in the scoring path, fully reproducible. Checks that don’t apply to a tool (no API, no database) are excluded from that check’s denominator, never counted as a pass or fail. We measure what can be observed from the public repository and show exactly what was measured.</p>
          <p><Link to="/methodology" style={{ color: '#97600F', fontWeight: 600 }}>Read the full methodology →</Link></p>
        </div>

        <div className="rp-cite">
          <div className="rp-citeh">Cite this report</div>
          <div className="rp-citebox">{citation}</div>
          <button className="rp-citebtn" onClick={copy}>{copied ? 'Copied' : 'Copy citation'}</button>
          <div className="rp-citeperm">Charts and figures are free to reuse with a link back to this page.</div>
        </div>

        <div className="rp-cta">
          <a className="rp-ctaa" href="/add">Audit your service →</a>
          <Link className="rp-ctaa ghost" to="/reports">All reports</Link>
        </div>
      </main>
    </LegitShell>
  )
}
