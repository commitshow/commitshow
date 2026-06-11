import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LegitShell, FRAMES } from './legit'
import { setHead } from '../lib/seo'

// /methodology — the public, citable explanation of how Legit.Show measures. Every
// report links here for "open methodology" trust. Honest about scope: we measure
// what's observable from public surfaces and show exactly what was measured.

const DEEP = [
  ['Client-side secrets', 'Secret/service-role keys imported into browser-shipped code.'],
  ['Committed .env', 'Credential files checked into the repository.'],
  ['Row-level security', 'Database tables defined without access policies.'],
  ['API rate limiting', 'Server endpoints with no rate-limit middleware.'],
  ['Webhook idempotency', 'Webhook handlers with no dedupe / signature check.'],
  ['Prompt injection', 'Raw user input flowing into an AI prompt.'],
  ['Error tracking', 'Crash/observability tooling vs. console logging only.'],
  ['Database indexes', 'Foreign keys without explicit indexes.'],
  ['CORS', 'Wide-open cross-origin policy (origin: *).'],
]

const CSS = `
.mt-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(28px,5vw,40px);color:#211C15;letter-spacing:-.015em;margin:6px 0 10px}
.mt-sub{font-size:15.5px;color:#4A4438;line-height:1.65;max-width:680px;margin-bottom:8px}
.mt-sec{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:22px;color:#211C15;margin:38px 0 4px}
.mt-secn{font-size:13px;color:#6F6757;font-family:'JetBrains Mono',monospace;margin-bottom:16px}
.mt-row{display:flex;gap:12px;padding:12px 0;border-top:1px solid #ECE3D2}
.mt-row:first-of-type{border-top:none}
.mt-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0;margin-top:5px}
.mt-rl{font-weight:600;font-size:15px;color:#2C261D}
.mt-rd{font-size:13.5px;color:#5A5347;line-height:1.5;margin-top:2px}
.mt-principle{background:#FBF6EC;border:1px solid #E7D4AC;border-radius:14px;padding:20px 22px;margin-top:14px}
.mt-principle li{font-size:14px;color:#3C362C;line-height:1.6;margin:7px 0}
.mt-principle b{color:#211C15}
.mt-honest{border-left:3px solid #C99A2E;padding:6px 0 6px 16px;margin-top:16px;font-size:14px;color:#4A4438;line-height:1.6;max-width:680px}
`

export function MethodologyPage() {
  useEffect(() => {
    setHead({
      title: 'Methodology — the 7-Frame benchmark | Legit.Show',
      description: 'How Legit.Show measures production-readiness: the seven frames scored from a service’s public surface, the deeper repository code checks, and the integrity rules behind every number we publish.',
      canonical: 'https://legit.show/methodology',
    })
  }, [])

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="l-wrap" style={{ maxWidth: 760, paddingTop: 32, paddingBottom: 80 }}>
        <div className="l-crumb" style={{ marginBottom: 10 }}><Link to="/reports">Reports</Link> › Methodology</div>
        <h1 className="mt-h">How we measure</h1>
        <p className="mt-sub">Legit.Show scores every listed service on seven frames of production-readiness — the things that separate a working demo from software that holds up. Scoring is deterministic and reproducible: no LLM in the scoring path, the same inputs always give the same numbers, and every report traces back to this page.</p>

        <h2 className="mt-sec">The 7 Frames — measured from the public surface</h2>
        <div className="mt-secn">URL · response headers · real Lighthouse run — so closed-source services are fully measurable.</div>
        {FRAMES.map(f => (
          <div key={f.key} className="mt-row">
            <span className="mt-dot" style={{ background: f.tone }} />
            <div><div className="mt-rl">{f.label}</div><div className="mt-rd">{f.blurb}</div></div>
          </div>
        ))}

        <h2 className="mt-sec">Deeper repository checks (open-source)</h2>
        <div className="mt-secn">When a tool has a public repo, code analysis fills the frames more deeply — the production controls AI coding routinely skips.</div>
        {DEEP.map(([label, desc]) => (
          <div key={label} className="mt-row">
            <span className="mt-dot" style={{ background: '#A8742E' }} />
            <div><div className="mt-rl">{label}</div><div className="mt-rd">{desc}</div></div>
          </div>
        ))}

        <h2 className="mt-sec">Integrity rules</h2>
        <div className="mt-principle">
          <ul>
            <li><b>Measurement, not a verdict.</b> We report per-frame facts (“no rate limiting”, “Lighthouse 82”) — never an overall “good/bad” score. Whether a tool is worth it is for the people using it.</li>
            <li><b>Not assessed ≠ zero.</b> A frame a form can’t prove (a code host has no rendered page) is marked not-assessed, never scored as zero.</li>
            <li><b>No noise signals.</b> Anything nearly every site shares the same way (a footer copyright year) carries no information and is left out.</li>
            <li><b>You can’t buy a score.</b> Owners can unlock deeper measurement by linking a repo — but that measures more, it doesn’t raise the number. Looking closer can lower it.</li>
            <li><b>Stated sample, every time.</b> Every published number names its denominator and date.</li>
          </ul>
        </div>

        <div className="mt-honest">
          The seven surface frames measure <b>what can be observed from public surfaces</b> — hygiene, not a guarantee of product quality. Code-level signals (access rules, webhook handling, indexes) <em>correlate with</em> production-readiness; they don’t <em>prove</em> it. We show exactly what was measured, and what wasn’t.
        </div>
      </main>
    </LegitShell>
  )
}
