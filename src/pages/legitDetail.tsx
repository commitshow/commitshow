import { useState } from 'react'
import { FRAMES, type Benchmark, type RepoAudit, type RepoAuditStatus } from './legit'

// Detail-only benchmark visuals — split out of legit.tsx so the directory home
// (which never renders them) doesn't ship the chart, the evidence modal or the
// repo-teardown cards in its shared chunk. Imported only by ListingDetailPage.

// Old-schema rows (pre-7-frame) still carry the 4 axes — render those until the
// re-benchmark sweep overwrites every row with frame data.
const LEGACY_AXES: { key: keyof Benchmark; label: string; tone: string }[] = [
  { key: 'quality', label: 'Quality', tone: '#C99A2E' }, { key: 'trust', label: 'Trust', tone: '#A8743A' },
  { key: 'activity', label: 'Activity', tone: '#C2683E' }, { key: 'transparency', label: 'Transparency', tone: '#7E8A4E' },
]
const BM_FORM: Record<string, string> = { web: 'live site', app_store: 'App Store signals', github: 'GitHub signals', npm: 'npm signals' }

export function BenchmarkChart({ b, showOverall = false, interactive = false }: { b: Benchmark; showOverall?: boolean; interactive?: boolean }) {
  const [open, setOpen] = useState(false)
  const assessed = FRAMES.filter(f => b[f.key] != null)
  const hasFrames = assessed.length > 0
  const rows = hasFrames
    ? assessed.map(f => ({ label: f.label, tone: f.tone, v: b[f.key] as number }))
    : LEGACY_AXES.map(a => ({ label: a.label, tone: a.tone, v: (b[a.key] as number) || 0 }))
  return (
    <div className="l-bm">
      {showOverall && <div className="l-bmtop" title="overall · mean of assessed frames (admin only)"><span className="l-bmscore">{b.overall}</span><span className="l-bmscoremax">/100</span></div>}
      <div className="l-bmsrc" style={{ textAlign: showOverall ? 'center' : 'left', margin: '4px 0 13px' }}>
        evaluated on {BM_FORM[b.form] || b.form}{hasFrames ? ` · ${assessed.length} of 8 frames` : ''}
      </div>
      <div className="l-bmbars">
        {rows.map(r => (
          <div key={r.label} className="l-bmrow">
            <span className="l-bmlabel">{r.label}</span>
            <span className="l-bmtrack"><span className="l-bmfill" style={{ width: `${r.v}%`, background: r.tone }} /></span>
            <span className="l-bmval">{r.v}</span>
          </div>
        ))}
      </div>
      {interactive && hasFrames && <button className="l-bmmore" onClick={() => setOpen(true)}>See the evidence →</button>}
      {open && <BenchmarkDetailModal b={b} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ── benchmark detail modal — the evidence behind every frame ──
// Reads benchmark.signals.frames.<frame> and renders each underlying check as
// pass / fail / value. n/a frames show why they weren't assessed (e.g. a code host
// has no rendered page) so the score is never silently inflated.
const SIG_LABEL: Record<string, string> = {
  lighthouse: 'Lighthouse ran', perf: 'Performance score', a11y: 'Accessibility score', bestPractices: 'Best-practices score', responseMs: 'Response time',
  https: 'HTTPS', hsts: 'HSTS', csp: 'Content-Security-Policy', xFrame: 'X-Frame-Options', xContent: 'X-Content-Type-Options', referrer: 'Referrer-Policy',
  mixedContent: 'No mixed content', secretsFound: 'No leaked secrets',
  privacyPage: 'Privacy policy page', termsPage: 'Terms page', consentBanner: 'Cookie consent',
  homeStatus: 'Homepage responds', routesChecked: 'Internal routes checked', routesOk: 'Routes reachable', proper404: 'Real 404 page',
  responsive: 'Responsive (viewport)', favicon: 'Favicon', manifest: 'Web manifest',
  title: 'Title tag', metaDescription: 'Meta description', ogTitle: 'OpenGraph title', ogImage: 'OpenGraph image', canonical: 'Canonical URL', structuredData: 'Structured data (JSON-LD)', sitemap: 'Sitemap',
  license: 'License', topics: 'Topics', archived: 'Archived', homepage: 'Homepage link', hasDescription: 'Description', description: 'Description', readme: 'README', repository: 'Repository link', hasRepository: 'Repository link', types: 'TypeScript types', versions: 'Published versions',
  pushed_at: 'Last push', daysSincePush: 'Days since push', modified: 'Last publish', daysSinceModified: 'Days since publish', releaseDate: 'Last release', daysSinceRelease: 'Days since release',
  screenshots: 'Screenshots', appPrivacyLabel: 'App privacy label', ageRating: 'Age rating',
}
const INVERTED = new Set(['mixedContent']) // boolean where true = bad
type EvRow = { label: string; state: 'pass' | 'fail' | 'info'; value?: string }
function frameEvidence(sig: Record<string, unknown> | undefined): EvRow[] {
  if (!sig) return []
  const out: EvRow[] = []
  for (const [k, val] of Object.entries(sig)) {
    if (k === 'assessed' || k === 'reason' || val == null) continue
    const label = SIG_LABEL[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
    if (k === 'secretsFound') {
      const arr = val as string[]
      out.push(arr.length ? { label: `Leaked secrets: ${arr.join(', ')}`, state: 'fail' } : { label: 'No leaked secrets', state: 'pass' })
    } else if (k === 'archived') {
      out.push({ label: 'Not archived', state: (val as boolean) ? 'fail' : 'pass' })
    } else if (typeof val === 'boolean') {
      const good = INVERTED.has(k) ? !val : val
      out.push({ label, state: good ? 'pass' : 'fail' })
    } else if (typeof val === 'number') {
      const v = k === 'responseMs' ? `${val} ms` : /^daysSince/.test(k) ? `${val}d ago` : String(val)
      out.push({ label, state: 'info', value: v })
    } else if (typeof val === 'string') {
      out.push({ label, state: 'info', value: val.length > 40 ? val.slice(0, 40) + '…' : val })
    }
  }
  return out
}
const BD_CSS = `
.l-bdov{position:fixed;inset:0;background:rgba(33,28,21,.55);backdrop-filter:blur(3px);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px 16px;overflow:auto}
.l-bdpanel{background:#FCFAF5;border:1px solid #E7D4AC;border-radius:16px;max-width:560px;width:100%;padding:24px 24px 28px;box-shadow:0 24px 60px rgba(33,28,21,.22)}
.l-bdhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px}
.l-bdtitle{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:21px;color:#211C15}
.l-bdsub{font-size:12.5px;color:#6E6557;line-height:1.55;margin-bottom:18px}
.l-bdx{font-size:22px;line-height:1;color:#6F6757;cursor:pointer;background:none;border:none;padding:0}
.l-bdframe{border-top:1px solid #EFE4CC;padding:13px 0}
.l-bdframe:first-of-type{border-top:none}
.l-bdfh{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
.l-bdfname{font-weight:600;font-size:14.5px;color:#2E2820}
.l-bdfscore{font-family:'JetBrains Mono',monospace;font-size:13px;color:#97600F;margin-left:auto}
.l-bdfna{font-family:'JetBrains Mono',monospace;font-size:11px;color:#A99F8C;margin-left:auto;text-transform:uppercase;letter-spacing:.04em}
.l-bdblurb{font-size:11.5px;color:#8A8170;margin-bottom:8px}
.l-bdtrack{height:5px;background:#EFE6D2;border-radius:3px;overflow:hidden;margin-bottom:9px}
.l-bdfill{display:block;height:100%;border-radius:3px}
.l-bdev{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#5A5347;padding:1.5px 0}
.l-bddot{width:14px;text-align:center;flex:0 0 auto;font-weight:700}
.l-bddot.pass{color:#5C8A3E}.l-bddot.fail{color:#C24A33}.l-bddot.info{color:#A8893E}
.l-bdev .v{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#7A7160}
.l-bdnote{font-size:11px;color:#6F6757;margin-top:16px;font-family:'JetBrains Mono',monospace}
`
export function BenchmarkDetailModal({ b, onClose }: { b: Benchmark; onClose: () => void }) {
  const framesSig = (b.signals?.frames || {}) as Record<string, Record<string, unknown>>
  return (
    <div className="l-bdov" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: BD_CSS }} />
      <div className="l-bdpanel" onClick={e => e.stopPropagation()}>
        <div className="l-bdhead">
          <div className="l-bdtitle">Benchmark evidence</div>
          <button className="l-bdx" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="l-bdsub">Seven frames of production-readiness, measured from the outside — {BM_FORM[b.form] || b.form}. Each frame shows the exact checks behind its score. Frames a {b.form === 'web' ? 'live site' : 'this form'} can&apos;t prove are marked not assessed, never scored as zero.</p>
        {FRAMES.map(f => {
          const v = b[f.key]
          const sig = framesSig[f.key]
          const ev = frameEvidence(sig)
          return (
            <div key={f.key} className="l-bdframe">
              <div className="l-bdfh">
                <span className="l-bdfname">{f.label}</span>
                {v != null ? <span className="l-bdfscore">{v as number}/100</span> : <span className="l-bdfna">not assessed</span>}
              </div>
              <div className="l-bdblurb">{f.blurb}</div>
              {v != null && <div className="l-bdtrack"><span className="l-bdfill" style={{ width: `${v as number}%`, background: f.tone }} /></div>}
              {v != null
                ? ev.map((r, i) => (
                    <div key={i} className="l-bdev">
                      <span className={`l-bddot ${r.state}`}>{r.state === 'pass' ? '✓' : r.state === 'fail' ? '✕' : '•'}</span>
                      <span>{r.label}</span>
                      {r.value && <span className="v">{r.value}</span>}
                    </div>
                  ))
                : <div className="l-bdev"><span className="l-bddot info">•</span><span>{(sig?.reason as string) || 'not measurable for this form'}</span></div>}
            </div>
          )
        })}
        <div className="l-bdnote">Measured by Legit.Show · deterministic · re-checked weekly</div>
      </div>
    </div>
  )
}

// ── repo teardown cards — the deep code checks (OSS repos) ──
// Measurement facts, not a verdict (per methodology): each check is a fact +
// why-it-matters + file evidence. This is the "extractable depth" reports cite.
const RA_CHECKS: { key: string; label: string; why: string }[] = [
  { key: 'client_secret',       label: 'Client-side secrets',  why: 'Secret keys in the browser bundle can be stolen and abused' },
  { key: 'auth',                label: 'Authentication',       why: 'An unauthenticated server runs its tools for anyone who can reach it' },
  { key: 'env_committed',       label: 'Committed .env',       why: 'Credentials checked into the repo leak to anyone who clones it' },
  { key: 'rls_coverage',        label: 'Row-level security',   why: 'Tables without access rules can expose other users’ data' },
  { key: 'rate_limiting',       label: 'API rate limiting',    why: 'No limit lets one user overload the server or run up the bill' },
  { key: 'webhook_idempotency', label: 'Webhook idempotency',  why: 'Duplicate webhooks without dedupe cause double charges/processing' },
  { key: 'prompt_injection',    label: 'Prompt injection',     why: 'Raw user input reaching the model can hijack it or leak data' },
  { key: 'error_tracking',      label: 'Error tracking',       why: 'No monitoring means failures happen silently, unnoticed' },
  { key: 'missing_indexes',     label: 'Database indexes',     why: 'Unindexed foreign keys get slow as the data grows' },
  { key: 'cors',                label: 'CORS policy',          why: 'A wide-open CORS origin lets any site call the API' },
]
const RA_DOT: Record<RepoAuditStatus, { c: string; m: string }> = {
  pass: { c: '#5C8A3E', m: '✓' }, warn: { c: '#A8742E', m: '!' }, fail: { c: '#C24A33', m: '✕' }, na: { c: '#B3A992', m: '–' },
}
const RA_CSS = `
.l-ra{margin-top:18px;text-align:left}
.l-rasum{display:flex;gap:14px;font-family:'JetBrains Mono',monospace;font-size:11.5px;margin:7px 0 3px}
.l-rasum b{font-weight:700}
.l-ranote{font-size:11px;color:#9A9080;margin-bottom:15px;line-height:1.5}
.l-racheck{display:flex;gap:9px;padding:11px 0;border-top:1px solid #EFE4CC}
.l-racheck:first-of-type{border-top:none}
.l-radot{flex:0 0 auto;width:13px;font-size:13px;font-weight:700;line-height:1.5}
.l-ralabel{font-weight:600;font-size:13.5px;color:#2E2820}
.l-rafind{font-size:12.5px;color:#5A5347;margin-top:1px;line-height:1.45}
.l-rawhy{font-size:11.5px;color:#9A9080;margin-top:4px;line-height:1.4}
.l-raev{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#97600F;margin-top:4px;word-break:break-all}
.l-rana{opacity:.5}
`
export function RepoAuditCards({ audit }: { audit: RepoAudit }) {
  const checks = audit.checks || {}
  const present = RA_CHECKS.filter(c => checks[c.key])
  if (!present.length) return null
  const s = audit.summary || { pass: 0, warn: 0, fail: 0, na: 0 }
  return (
    <div className="l-ra">
      <style dangerouslySetInnerHTML={{ __html: RA_CSS }} />
      <div className="l-lh">◆ repo teardown</div>
      <div className="l-rasum">
        <span style={{ color: RA_DOT.pass.c }}><b>{s.pass}</b> pass</span>
        {s.warn > 0 && <span style={{ color: RA_DOT.warn.c }}><b>{s.warn}</b> warn</span>}
        <span style={{ color: RA_DOT.fail.c }}><b>{s.fail}</b> fail</span>
        {s.na > 0 && <span style={{ color: RA_DOT.na.c }}><b>{s.na}</b> n/a</span>}
      </div>
      <div className="l-ranote">Code checks on the source{audit.repo ? ` · ${audit.repo}` : ''} — facts, not a verdict.</div>
      {present.map(c => {
        const ck = checks[c.key]; const dot = RA_DOT[ck.status]
        return (
          <div key={c.key} className={`l-racheck ${ck.status === 'na' ? 'l-rana' : ''}`}>
            <span className="l-radot" style={{ color: dot.c }}>{dot.m}</span>
            <div style={{ flex: 1 }}>
              <div className="l-ralabel">{c.label}</div>
              <div className="l-rafind">{ck.finding}</div>
              {(ck.status === 'fail' || ck.status === 'warn') && <div className="l-rawhy">{c.why}</div>}
              {ck.evidence && <div className="l-raev">{ck.evidence}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
