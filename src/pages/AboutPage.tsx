import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LegitShell, FRAMES, useLegitAuth } from './legit'
import { setHead } from '../lib/seo'

// /about — what Legit.Show is, in one page. Mirrors the README. Same amber/cream
// content layout as /methodology.

const REPORTS = [
  ['state-of-ai-built-software-2026', 'The State of AI-Built Software', '94% of AI-built open-source tools ship with no error tracking'],
  ['web-security-baseline-2026', 'The Web Security Baseline', '81% of launched web apps ship with no Content-Security-Policy'],
  ['the-privacy-gap-2026', 'The Privacy Gap', '81% set cookies with no consent prompt'],
  ['state-of-mcp-servers-2026', 'The State of MCP Servers', '53% of MCP servers ship with no authentication'],
]

const CSS = `
.ab-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(30px,5.5vw,46px);line-height:1.05;color:#211C15;letter-spacing:-.015em;margin:6px 0 14px}
.ab-lead{font-size:17px;line-height:1.65;color:#4A4438;max-width:680px}
.ab-lead b{color:#211C15}
.ab-sec{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:23px;color:#211C15;margin:42px 0 6px}
.ab-secn{font-size:13.5px;color:#6F6757;line-height:1.6;max-width:680px;margin-bottom:16px}
.ab-row{display:flex;gap:12px;padding:11px 0;border-top:1px solid #ECE3D2}.ab-row:first-of-type{border-top:none}
.ab-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0;margin-top:5px}
.ab-rl{font-weight:600;font-size:15px;color:#2C261D}
.ab-rd{font-size:13.5px;color:#5A5347;line-height:1.5;margin-top:2px}
.ab-rep{display:block;text-decoration:none;border:1px solid #E7D4AC;border-radius:12px;padding:15px 18px;margin-bottom:11px;background:#FCFAF5;transition:border-color .15s}
.ab-rep:hover{border-color:#C99A2E}
.ab-rept{font-weight:600;font-size:15.5px;color:#211C15}
.ab-reph{font-size:13.5px;color:#5A5347;margin-top:3px;line-height:1.45}
.ab-mission{border-left:3px solid #C99A2E;padding:6px 0 6px 16px;margin-top:16px;font-size:16px;color:#3C362C;line-height:1.6;max-width:680px}
.ab-cta{display:flex;gap:12px;flex-wrap:wrap;margin:36px 0 8px}
.ab-btn{display:inline-block;background:#97600F;color:#fff;text-decoration:none;border-radius:8px;padding:12px 20px;font-weight:600;font-size:14.5px;border:none}
.lgt a.ab-btn{color:#fff}
.ab-btn.ghost{background:#fff;color:#97600F;border:1px solid #E7D4AC}
.lgt a.ab-btn.ghost{color:#97600F}
`

export function AboutPage() {
  const { openSubmit } = useLegitAuth()
  useEffect(() => {
    setHead({
      title: 'About — Legit.Show',
      description: 'Legit.Show is a directory of launched web apps, SaaS, AI tools and MCP servers — each with an objective 7-Frame production-readiness benchmark, plus reproducible "according to Legit.Show" data reports.',
      canonical: 'https://legit.show/about',
    })
  }, [])

  return (
    <LegitShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="l-wrap" style={{ maxWidth: 760, paddingTop: 36, paddingBottom: 80 }}>
        <div className="rp-eyebrow" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#97600F', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>Every launched service, tested</div>
        <h1 className="ab-h">What Legit.Show is</h1>
        <p className="ab-lead">
          A Yelp-style directory of launched web apps, SaaS, AI tools, MCP servers and developer tools — but instead of stars alone, every listing carries an <b>objective benchmark of how production-ready it actually is.</b>
        </p>
        <p className="ab-lead" style={{ marginTop: 14 }}>
          AI-assisted coding ships a flawless demo. Production is the quiet part it skips — monitoring, rate limits, access rules, security headers, a real 404. We measure that gap from the outside, deterministically, and show <b>exactly what was measured</b> — never a black-box “good/bad” verdict.
        </p>

        <h2 className="ab-sec">The benchmark — 7 Frames</h2>
        <div className="ab-secn">Seven frames of production-readiness, scored from the public surface (URL · headers · real Lighthouse), so even closed-source SaaS is fully assessable. Open-source repos get a deeper code teardown. Deterministic · no LLM in the scoring path · re-checked daily.</div>
        {FRAMES.map(f => (
          <div key={f.key} className="ab-row">
            <span className="ab-dot" style={{ background: f.tone }} />
            <div><div className="ab-rl">{f.label}</div><div className="ab-rd">{f.blurb}</div></div>
          </div>
        ))}
        <p style={{ marginTop: 14 }}><Link to="/methodology" style={{ color: '#97600F', fontWeight: 600 }}>Read the full methodology →</Link></p>

        <h2 className="ab-sec">Reports — “According to Legit.Show”</h2>
        <div className="ab-secn">Periodic, reproducible data reports mined from the catalog — cite-ready stats with stated samples and open methodology, rebuilt daily as the directory grows.</div>
        {REPORTS.map(([slug, title, hero]) => (
          <Link key={slug} to={`/reports/${slug}`} className="ab-rep">
            <div className="ab-rept">{title}</div>
            <div className="ab-reph">{hero}</div>
          </Link>
        ))}
        <p style={{ marginTop: 8 }}><Link to="/reports" style={{ color: '#97600F', fontWeight: 600 }}>All reports →</Link> · <Link to="/insights" style={{ color: '#97600F', fontWeight: 600 }}>Live insights →</Link></p>

        <h2 className="ab-sec">For makers</h2>
        <div className="ab-row"><span className="ab-dot" style={{ background: '#97600F' }} /><div><div className="ab-rl">Add your service</div><div className="ab-rd">Paste a URL, verify the domain (meta tag / DNS TXT), and it’s listed with its benchmark.</div></div></div>
        <div className="ab-row"><span className="ab-dot" style={{ background: '#A8742E' }} /><div><div className="ab-rl">Claim it</div><div className="ab-rd">Owners can verify and edit their listing.</div></div></div>
        <div className="ab-row"><span className="ab-dot" style={{ background: '#7E8A4E' }} /><div><div className="ab-rl">Everything is public</div><div className="ab-rd">Every listing’s full teardown is open — measured from public surfaces, with exactly what we saw.</div></div></div>

        <h2 className="ab-sec">Why we exist</h2>
        <div className="ab-mission">Take a vibe-coded MVP and show it the road to production-ready. Every decision is judged against that — <b>errors first, score second.</b></div>

        <div className="ab-cta">
          <Link className="ab-btn" to="/">Browse the directory →</Link>
          <span className="ab-btn ghost" onClick={openSubmit} style={{ cursor: 'pointer' }}>Add your service</span>
        </div>
      </main>
    </LegitShell>
  )
}
