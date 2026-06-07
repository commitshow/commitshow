import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LegitShell } from './legit'
import { setHead } from '../lib/seo'

// Category insights — aggregate the deterministic 4-axis benchmark across every
// tested listing. Pure leverage on data we already hold; no overall score (that
// stays admin-only). Computed client-side over the full set (a few hundred rows).

type Row = {
  category: string | null
  has_pricing: boolean
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
@media(max-width:620px){.ins-bar{display:none}.ins-tbl th.opt,.ins-tbl td.opt{display:none}}
`

const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0

export function InsightsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    setHead({
      title: 'Category insights — Legit.Show',
      description: 'Benchmark averages (quality, trust, activity, transparency) and paid share across launched web apps, SaaS, AI tools, MCP servers and developer tools tested on Legit.Show.',
      canonical: 'https://commit.show/v2/insights',
    })
    supabase.from('listings')
      .select('category,has_pricing,q:benchmark->quality,t:benchmark->trust,a:benchmark->activity,tr:benchmark->transparency')
      .not('benchmark', 'is', null)
      .then(({ data }) => setRows((data as Row[]) || []))
  }, [])

  const { aggs, total } = useMemo(() => {
    const list = rows || []
    const by = new Map<string, Row[]>()
    for (const r of list) {
      const k = r.category || 'Uncategorized'
      ;(by.get(k) || by.set(k, []).get(k)!).push(r)
    }
    const aggs: Agg[] = [...by.entries()].map(([key, rs]) => ({
      key,
      n: rs.length,
      q: avg(rs.map(r => r.q ?? 0)),
      t: avg(rs.map(r => r.t ?? 0)),
      a: avg(rs.map(r => r.a ?? 0)),
      tr: avg(rs.map(r => r.tr ?? 0)),
      paid: rs.length ? Math.round(rs.filter(r => r.has_pricing).length / rs.length * 100) : 0,
    })).sort((x, y) => y.n - x.n)
    const total: Agg = {
      key: 'All categories', n: list.length,
      q: avg(list.map(r => r.q ?? 0)), t: avg(list.map(r => r.t ?? 0)),
      a: avg(list.map(r => r.a ?? 0)), tr: avg(list.map(r => r.tr ?? 0)),
      paid: list.length ? Math.round(list.filter(r => r.has_pricing).length / list.length * 100) : 0,
    }
    return { aggs, total }
  }, [rows])

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="l-wrap" style={{ paddingTop: 28, paddingBottom: 56 }}>
        <h1 className="ins-h">Category insights</h1>
        <div className="ins-sub">Benchmark averages across {total.n || '—'} tested services · 0–100 per axis</div>

        {rows === null
          ? <div className="ins-dim" style={{ fontSize: 14 }}>Loading…</div>
          : (
            <table className="ins-tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Services</th>
                  <th>Quality</th>
                  <th className="opt">Trust</th>
                  <th className="opt">Activity</th>
                  <th className="opt">Transparency</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                <tr className="tot">
                  <td className="ins-cat">{total.key}</td>
                  <td>{total.n}</td>
                  <td>{total.q}</td>
                  <td className="opt">{total.t}</td>
                  <td className="opt">{total.a}</td>
                  <td className="opt">{total.tr}</td>
                  <td>{total.paid}%</td>
                </tr>
                {aggs.map(r => (
                  <tr key={r.key}>
                    <td className="ins-cat">{r.key}</td>
                    <td>{r.n}</td>
                    <td>
                      <span className="ins-q"><span className="ins-bar"><i style={{ width: `${r.q}%` }} /></span>{r.q}</span>
                    </td>
                    <td className="opt">{r.t}</td>
                    <td className="opt">{r.a}</td>
                    <td className="opt">{r.tr}</td>
                    <td>{r.paid}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </LegitShell>
  )
}
