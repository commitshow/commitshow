import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LegitShell } from './legit'
import { setHead } from '../lib/seo'

// /reports — the permanent index of Legit.Show data reports. Each links to its own
// canonical page; this is the hub crawlers and citations land on.

type ReportCard = {
  slug: string; title: string; subtitle: string; kind: string; status?: string
  hero_stat: { value: number; unit: string; label: string; n: number } | null
  sample: { total: number; as_of: string } | null
  published_at: string
}

const CSS = `
.rl-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(28px,5vw,40px);color:#211C15;letter-spacing:-.015em;margin:6px 0 8px}
.rl-sub{font-size:15px;color:#4A4438;line-height:1.6;max-width:620px;margin-bottom:30px}
.rl-card{display:block;text-decoration:none;border:1px solid #E7D4AC;border-radius:16px;padding:24px 26px;margin-bottom:16px;background:#FCFAF5;transition:border-color .15s}
.rl-card:hover{border-color:#C99A2E}
.rl-kind{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#97600F;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.rl-top{display:flex;gap:24px;align-items:flex-start;margin-top:8px}
.rl-ct{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:23px;color:#211C15;line-height:1.15;flex:1}
.rl-stat{text-align:right;flex-shrink:0}
.rl-statv{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:42px;color:#C24A33;line-height:.9}
.rl-statl{font-family:'JetBrains Mono',monospace;font-size:10px;color:#6F6757;margin-top:4px}
.rl-cs{font-size:14px;color:#5A5347;line-height:1.55;margin-top:10px;max-width:560px}
.rl-meta{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#9A9080;margin-top:14px;display:flex;gap:14px}
.rl-read{color:#97600F;font-weight:600}
.rl-empty{border:1px dashed #E7D4AC;border-radius:14px;padding:30px;text-align:center;color:#6F6757}
`

export function ReportsPage() {
  const [reports, setReports] = useState<ReportCard[] | null>(null)

  useEffect(() => {
    setHead({
      title: 'Reports — Legit.Show',
      description: 'Periodic, reproducible data reports on the production-readiness of launched software — measured by Legit.Show’s 7-Frame benchmark. Cite-ready stats with stated samples and open methodology.',
      canonical: 'https://legit.show/reports',
    })
    // no status filter — RLS returns drafts only to admins
    supabase.from('reports').select('slug,title,subtitle,kind,status,hero_stat,sample,published_at')
      .order('published_at', { ascending: false })
      .then(({ data }) => setReports((data as ReportCard[]) || []))
  }, [])

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="l-wrap" style={{ maxWidth: 760, paddingTop: 32, paddingBottom: 80 }}>
        <h1 className="rl-h">Reports</h1>
        <p className="rl-sub">What actually ships to production. Each report runs Legit.Show’s 7-Frame benchmark across a stated sample of launched tools — reproducible numbers, open methodology, free to cite.</p>

        {reports === null && <div className="rl-empty">Loading…</div>}
        {reports && reports.length === 0 && <div className="rl-empty">No reports published yet.</div>}
        {reports?.map(r => (
          <Link key={r.slug} to={`/reports/${r.slug}`} className="rl-card">
            <span className="rl-kind">{r.kind}{r.status === 'draft' ? ' · DRAFT' : ''}</span>
            <div className="rl-top">
              <div className="rl-ct">{r.title}</div>
              {r.hero_stat && (
                <div className="rl-stat">
                  <div className="rl-statv">{r.hero_stat.value}{r.hero_stat.unit}</div>
                  <div className="rl-statl">n={r.hero_stat.n}</div>
                </div>
              )}
            </div>
            <div className="rl-cs">{r.subtitle}</div>
            <div className="rl-meta">
              <span>{(r.sample?.as_of || r.published_at || '').slice(0, 10)}</span>
              {r.sample?.total != null && <span>{r.sample.total} tools</span>}
              <span className="rl-read">Read →</span>
            </div>
          </Link>
        ))}
      </main>
    </LegitShell>
  )
}
