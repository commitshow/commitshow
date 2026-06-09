import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LegitShell } from './legit'
import { setHead } from '../lib/seo'

// Category insights — aggregate the deterministic 4-axis benchmark across every
// tested listing, plus trust/security posture and a by-source breakdown. Pure
// leverage on data we already hold; no overall score (that stays admin-only).
// Computed client-side over the full set (a few hundred rows).

type Sig = { https?: boolean; csp?: boolean; privacy?: boolean; lighthouse?: { perf?: number; a11y?: number; bp?: number } | null }
type Row = {
  category: string | null
  has_pricing: boolean
  source: string | null
  form: string | null
  sig: Sig | null
  q: number | null
  t: number | null
  a: number | null
  tr: number | null
}
type Agg = { key: string; n: number; q: number; t: number; a: number; tr: number; paid: number }

const CSS = `
.ins-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:27px;color:#211C15;margin:4px 0 3px;letter-spacing:-.01em}
.ins-sub{font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-bottom:26px}
.ins-tbl{width:100%;border-collapse:collapse;font-size:14px}
.ins-tbl th{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:#9A9080;text-transform:uppercase;letter-spacing:.05em;padding:0 0 11px;text-align:right;white-space:nowrap}
.ins-tbl th:first-child{text-align:left}
.ins-tbl thead tr{border-bottom:1px solid #E0D8C8}
.ins-tbl td{padding:13px 0;border-bottom:1px solid #F1EADE;text-align:right;color:#2C261D;font-variant-numeric:tabular-nums}
.ins-tbl td:first-child{text-align:left}
.ins-tbl tr.tot td{border-bottom:2px solid #E0D8C8;font-weight:600;color:#211C15}
.ins-cat{font-weight:600;color:#211C15}
.ins-q{display:inline-flex;align-items:center;gap:9px;justify-content:flex-end}
.ins-bar{width:54px;height:5px;border-radius:3px;background:#F1EADE;overflow:hidden;flex-shrink:0}
.ins-bar>i{display:block;height:100%;background:#E0A92E}
.ins-dim{color:#9A9080}
.ins-sec{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:#9A9080;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px;padding-top:34px;margin-top:38px;border-top:1px solid #F1EADE}
.ins-secn{font-size:11.5px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin:0 0 16px}
.ins-rows{display:flex;flex-direction:column;gap:12px;max-width:580px}
.ins-mrow{display:grid;grid-template-columns:1fr 150px 46px;align-items:center;gap:16px;font-size:13.5px}
.ins-mlabel{color:#2C261D}
.ins-mlabel b{font-weight:600;color:#211C15}
.ins-mlabel span{color:#9A9080;font-size:11.5px;margin-left:7px;font-family:'JetBrains Mono',monospace}
.ins-track{height:7px;border-radius:4px;background:#F1EADE;overflow:hidden}
.ins-track>i{display:block;height:100%;background:#E0A92E;border-radius:4px}
.ins-mval{text-align:right;color:#211C15;font-variant-numeric:tabular-nums;font-weight:600}
@media(max-width:560px){.ins-mrow{grid-template-columns:1fr 80px 42px;gap:11px}}
.ins-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0 30px}
.ins-kpi{background:#FCFAF5;border:1px solid #E0D8C8;border-radius:12px;padding:16px 18px}
.ins-kpiv{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:29px;color:#211C15;line-height:1;letter-spacing:-.01em}
.ins-kpil{font-size:11px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-top:8px;text-transform:uppercase;letter-spacing:.04em}
.ins-card{border:1px solid #E9E2D4;border-radius:14px;padding:20px 22px;margin-bottom:16px}
.ins-cardh{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:17px;color:#211C15;margin-bottom:2px}
.ins-cardn{font-size:12px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-bottom:16px}
.ins-card .ins-rows{max-width:none}
@media(max-width:640px){.ins-kpis{grid-template-columns:repeat(2,1fr)}.ins-card{padding:18px 16px}}
`

const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0

function MRow({ label, sub, pct, value }: { label: string; sub?: string; pct: number; value: string }) {
  return (
    <div className="ins-mrow">
      <div className="ins-mlabel"><b>{label}</b>{sub && <span>{sub}</span>}</div>
      <div className="ins-track"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
      <div className="ins-mval">{value}</div>
    </div>
  )
}

export function InsightsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    setHead({
      title: 'Category insights — Legit.Show',
      description: 'Benchmark averages, trust & security posture, and discovery-source breakdown across launched web apps, SaaS, AI tools, MCP servers and developer tools tested on Legit.Show.',
      canonical: 'https://legit.show/insights',
    })
    supabase.from('listings')
      .select('category,has_pricing,source,form:benchmark->form,sig:benchmark->signals,q:benchmark->quality,t:benchmark->trust,a:benchmark->activity,tr:benchmark->transparency')
      .not('benchmark', 'is', null)
      .then(({ data }) => setRows((data as Row[]) || []))
  }, [])

  const { aggs, total, bands, trust, sources } = useMemo(() => {
    const list = rows || []
    // ── by category ──
    const by = new Map<string, Row[]>()
    for (const r of list) {
      const k = r.category || 'Uncategorized'
      ;(by.get(k) || by.set(k, []).get(k)!).push(r)
    }
    const mk = (key: string, rs: Row[]): Agg => ({
      key, n: rs.length,
      q: avg(rs.map(r => r.q ?? 0)), t: avg(rs.map(r => r.t ?? 0)),
      a: avg(rs.map(r => r.a ?? 0)), tr: avg(rs.map(r => r.tr ?? 0)),
      paid: rs.length ? Math.round(rs.filter(r => r.has_pricing).length / rs.length * 100) : 0,
    })
    const aggs = [...by.entries()].map(([k, rs]) => mk(k, rs)).sort((x, y) => y.n - x.n)
    const total = mk('All categories', list)

    // ── quality distribution ──
    const defs = [
      { label: '85–100', sub: 'excellent', min: 85 },
      { label: '70–84', sub: 'solid', min: 70 },
      { label: '50–69', sub: 'fair', min: 50 },
      { label: '0–49', sub: 'weak', min: 0 },
    ]
    const bands = defs.map((d, i) => {
      const max = i === 0 ? 100 : defs[i - 1].min - 1
      const n = list.filter(r => (r.q ?? 0) >= d.min && (r.q ?? 0) <= max).length
      return { ...d, n, pct: list.length ? Math.round(n / list.length * 100) : 0 }
    })

    // ── trust & security (web form only — these signals are web-specific) ──
    const web = list.filter(r => r.form === 'web')
    const pctOf = (f: (r: Row) => boolean | undefined) => web.length ? Math.round(web.filter(r => !!f(r)).length / web.length * 100) : 0
    const lh = (k: 'perf' | 'a11y') => avg(web.map(r => r.sig?.lighthouse?.[k]).filter((x): x is number => x != null))
    const trust = {
      n: web.length,
      https: pctOf(r => r.sig?.https),
      csp: pctOf(r => r.sig?.csp),
      privacy: pctOf(r => r.sig?.privacy),
      perf: lh('perf'),
      a11y: lh('a11y'),
    }

    // ── by discovery source ──
    const bySrc = new Map<string, Row[]>()
    for (const r of list) {
      const k = r.source || 'Other'
      ;(bySrc.get(k) || bySrc.set(k, []).get(k)!).push(r)
    }
    const sources = [...bySrc.entries()]
      .map(([key, rs]) => ({ key, n: rs.length, q: avg(rs.map(r => r.q ?? 0)) }))
      .sort((x, y) => y.n - x.n)

    return { aggs, total, bands, trust, sources }
  }, [rows])

  if (rows === null) {
    return (
      <LegitShell>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="l-wrap" style={{ paddingTop: 28, paddingBottom: 56 }}>
          <h1 className="ins-h">Directory insights</h1>
          <div className="ins-dim" style={{ fontSize: 14 }}>Loading…</div>
        </div>
      </LegitShell>
    )
  }

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="l-wrap" style={{ paddingTop: 28, paddingBottom: 64 }}>
        <h1 className="ins-h">Directory insights</h1>
        <div className="ins-sub">Objective benchmark across every tested service · 0–100 per axis</div>

        <div className="ins-kpis">
          <div className="ins-kpi"><div className="ins-kpiv">{total.n}</div><div className="ins-kpil">Tested services</div></div>
          <div className="ins-kpi"><div className="ins-kpiv">{total.q}</div><div className="ins-kpil">Avg quality</div></div>
          <div className="ins-kpi"><div className="ins-kpiv">{aggs.length}</div><div className="ins-kpil">Categories</div></div>
          <div className="ins-kpi"><div className="ins-kpiv">{total.paid}%</div><div className="ins-kpil">Paid</div></div>
        </div>

        <div className="ins-card">
          <div className="ins-cardh">By category</div>
          <div className="ins-cardn">Benchmark averages per category</div>
          <table className="ins-tbl">
            <thead>
              <tr>
                <th>Category</th><th>Services</th><th>Quality</th>
                <th className="opt">Trust</th><th className="opt">Activity</th><th className="opt">Transparency</th><th>Paid</th>
              </tr>
            </thead>
            <tbody>
              <tr className="tot">
                <td className="ins-cat">{total.key}</td><td>{total.n}</td><td>{total.q}</td>
                <td className="opt">{total.t}</td><td className="opt">{total.a}</td><td className="opt">{total.tr}</td><td>{total.paid}%</td>
              </tr>
              {aggs.map(r => (
                <tr key={r.key}>
                  <td className="ins-cat">{r.key}</td><td>{r.n}</td>
                  <td><span className="ins-q"><span className="ins-bar"><i style={{ width: `${r.q}%` }} /></span>{r.q}</span></td>
                  <td className="opt">{r.t}</td><td className="opt">{r.a}</td><td className="opt">{r.tr}</td><td>{r.paid}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ins-card">
          <div className="ins-cardh">Quality distribution</div>
          <div className="ins-cardn">How {total.n} tested services land on the quality axis</div>
          <div className="ins-rows">
            {bands.map(b => <MRow key={b.label} label={b.label} sub={b.sub} pct={b.pct} value={`${b.n}`} />)}
          </div>
        </div>

        <div className="ins-card">
          <div className="ins-cardh">Trust &amp; security posture</div>
          <div className="ins-cardn">Across {trust.n} tested web services</div>
          <div className="ins-rows">
            <MRow label="Served over HTTPS" pct={trust.https} value={`${trust.https}%`} />
            <MRow label="Security header (CSP)" pct={trust.csp} value={`${trust.csp}%`} />
            <MRow label="Privacy policy reachable" pct={trust.privacy} value={`${trust.privacy}%`} />
            <MRow label="Lighthouse performance" sub="avg" pct={trust.perf} value={`${trust.perf}`} />
            <MRow label="Lighthouse accessibility" sub="avg" pct={trust.a11y} value={`${trust.a11y}`} />
          </div>
        </div>

        <div className="ins-card">
          <div className="ins-cardh">By discovery source</div>
          <div className="ins-cardn">Where tested launches come from · bar = avg quality</div>
          <div className="ins-rows">
            {sources.map(s => <MRow key={s.key} label={s.key} sub={`${s.n}`} pct={s.q} value={`${s.q}`} />)}
          </div>
        </div>
      </div>
    </LegitShell>
  )
}
