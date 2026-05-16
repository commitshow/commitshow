#!/usr/bin/env node
// Per-route SEO + AEO prerender — generates dist/<route>.html for each
// static-content route, with route-specific <title> · <meta> AND a
// rich, semantic <noscript> body so JS-disabled crawlers see meaningful
// per-page content.
//
// Why: Vite SPA returns the same root HTML for every path. Without
// prerendering, /rulebook · /audit · /backstage · etc. all looked like
// duplicate-title pages to search crawlers, and only / got indexed.
// Worse, JS-free crawlers (ChatGPT browse · Claude.ai · Perplexity ·
// GPTBot · ClaudeBot · etc.) saw the SAME 5-line fallback noscript on
// every page — so AI search engines couldn't distinguish /products from
// /library from /rulebook. 2026-05-09 fix: each route bakes its own
// noscript body with h1/h2/p/ul, route-relevant content, and
// cross-links. Googlebot still gets the full SPA after JS hydrates.
//
// How: read dist/index.html, swap title + meta + og:url + canonical
// AND replace the <noscript> block with route-specific HTML, write to
// dist/<route>.html. Cloudflare Pages serves these as static files;
// the SPA still owns dynamic routes (/projects/:id etc) via its
// automatic index.html fallback for unknown paths.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const SRC  = resolve(DIST, 'index.html')

if (!existsSync(SRC)) {
  console.error(`[prerender] dist/index.html not found · run 'vite build' first`)
  process.exit(1)
}

const baseHtml = readFileSync(SRC, 'utf8')
const SITE = 'https://commit.show'

// Shared noscript footer · CTA + cross-links. Appended to every route's
// noscriptBody so AI agents always see the same canonical pointers.
const SHARED_FOOTER = `
    <hr />
    <h3>Run an audit yourself</h3>
    <pre><code>npx commitshow@latest audit github.com/owner/repo</code></pre>
    <p>Or fetch from any agent runtime: <code>GET https://api.commit.show/audit?repo=owner/repo&amp;format=md</code> · see <a href="/llms.txt">/llms.txt</a> for the full agent integration guide.</p>
    <p>Cross-links · <a href="/products">Products</a> · <a href="/scouts">Scouts</a> · <a href="/library">Library</a> · <a href="/rulebook">Rulebook</a> · <a href="/audit">Audit method</a> · <a href="/community">Community</a></p>
    <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · operated by Madeflo Inc., a Delaware corporation.</p>
`

const routes = [
  // path, title, description, noscriptBody (route-relevant rich HTML)
  {
    path: '/rulebook',
    title:       'Judging Rulebook · commit.show',
    description: 'How vibe-coded projects are scored. Audit (50pt) + Scout Forecast (30pt) + Community (20pt). 14-frame production-readiness rubric, 4-grade graduation system, transparent calibration baseline.',
    noscriptBody: `
    <h1>Judging Rulebook</h1>
    <p>Every project on commit.show is scored on a transparent rubric. Total = <strong>100 points</strong>:</p>
    <ul>
      <li><strong>Audit (50 pt)</strong> · automated rubric · production-readiness signals from your repo + live URL</li>
      <li><strong>Scout Forecast (30 pt)</strong> · tier-gated humans place predictions on which projects will graduate</li>
      <li><strong>Community Signal (20 pt)</strong> · views, comments, applauds, return visits</li>
    </ul>
    <h2>Audit pillar · 14 production-readiness frames</h2>
    <p>The engine scores 14 axes: Lighthouse (Perf · A11y · BP · SEO), Live URL health, completeness signals (og:image · favicon · meta · etc.), production maturity (tests · CI · observability · TS-strict · lockfile · LICENSE · responsive), source hygiene, tech-layer diversity, Build Brief integrity. Calibration baseline pinned to 5 reference OSS projects (supabase, shadcn-ui, cal.com, vercel/ai, vibe).</p>
    <h2>Graduation tiers</h2>
    <ul>
      <li><strong>Valedictorian</strong> · top 0.5% (1 per season)</li>
      <li><strong>Honors</strong> · top 5%</li>
      <li><strong>Graduate</strong> · top 14.5%</li>
      <li><strong>Rookie Circle</strong> · everyone else · next-audition cohort</li>
    </ul>
    <h2>Anti-gaming</h2>
    <p>Audit-count tiebreaker · projects can't farm score from infinite re-audits. Self-vote blocked. Applauds carry zero leaderboard weight (only Community Signal proxy). Suspicious patterns silently muted, not publicly shamed.</p>`,
  },
  {
    path: '/audit',
    title:       'Audit Report Methodology · commit.show',
    description: 'How the commit.show audit engine scores production-readiness. 14 failure-mode frames calibrated against real OSS projects: RLS, webhook idempotency, secret-in-bundle, column GRANT mismatches, Stripe API idempotency, mobile input zoom, and 8 more.',
    noscriptBody: `
    <h1>Audit Report · methodology</h1>
    <p>commit.show audits AI-assisted GitHub projects against 14 production-readiness frames calibrated on real OSS. The goal: catch the failure modes that vibe-coded projects systematically miss before they ship.</p>
    <h2>What gets scored</h2>
    <ul>
      <li><strong>Lighthouse mobile (20)</strong> · Performance · Accessibility · Best Practices · SEO</li>
      <li><strong>Live URL health (5)</strong> · 200 OK + SSL + &lt; 3000ms TTFB</li>
      <li><strong>Completeness signals (2)</strong> · og:image · twitter card · manifest · favicon · canonical · meta description</li>
      <li><strong>Production maturity (12)</strong> · tests · CI · observability · TypeScript strict · lockfile · LICENSE · responsive</li>
      <li><strong>Source hygiene (5)</strong> · GitHub accessible · monorepo structure · governance docs</li>
      <li><strong>Tech layer diversity (3)</strong> · frontend + backend + DB + AI layer + Web3 / MCP</li>
      <li><strong>Build Brief integrity (5)</strong> · Phase 1 Core Intent answered fully</li>
    </ul>
    <h2>14 vibe-coding failure frames the engine watches for</h2>
    <ul>
      <li>missing-RLS · DB tables exposed without row-level policies</li>
      <li>webhook-not-idempotent · Stripe / GitHub webhooks without idempotency key</li>
      <li>secret-in-bundle · API keys committed to the client bundle</li>
      <li>column-grant-mismatch · new columns missing GRANT SELECT</li>
      <li>stripe-idempotency-missing · payment ops without idempotency key</li>
      <li>mobile-input-auto-zoom · iOS form inputs &lt; 16px font-size</li>
      <li>ai-template-copy · scaffolding identifiers left in prod</li>
      <li>seed-array-in-prod · const users = [...] still active</li>
      <li>cors-wildcard · Access-Control-Allow-Origin: * in prod</li>
      <li>localhost-in-prod · dev URLs committed to source</li>
      <li>+ 4 more</li>
    </ul>
    <h2>Soft bonuses + penalties</h2>
    <p>Stars · contributors · npm downloads · recent commits · elite OSS triple threshold (10K+ stars · 1M+ npm dl · 100+ contributors). Hard penalty if .env / .env.production committed.</p>`,
  },
  {
    path: '/backstage',
    title:       'Backstage · commit.show',
    description: 'The Build Brief earn-status process. Phase 1 (Core Intent) on first audit; Phase 2 (Failure Log · Decision Archaeology · AI Delegation Map · Live Proof · Next Blocker) unlocked at graduation.',
    noscriptBody: `
    <h1>Backstage</h1>
    <p>Every audit unlocks more of the project's "build brief" — the structured story behind the code that no other audit tool captures.</p>
    <h2>Phase 1 · Core Intent (visible from first audit)</h2>
    <ul>
      <li>Problem · features · target user · AI tools used</li>
      <li>5 fields · auto-extracted from your README + live URL · you confirm + edit</li>
    </ul>
    <h2>Phase 2 · Earn-status fields (unlocked at Encore)</h2>
    <ul>
      <li><strong>Stack Fingerprint</strong> · runtime · frontend · backend · DB · infra · AI layer · external APIs · auth</li>
      <li><strong>Failure Log</strong> · what didn't work · root cause · fix</li>
      <li><strong>Decision Archaeology</strong> · trade-offs · what you chose vs what you ruled out</li>
      <li><strong>AI Delegation Map</strong> · which parts of the code AI wrote · which you wrote</li>
      <li><strong>Live Proof</strong> · deployment URLs · public endpoints · contract addresses</li>
      <li><strong>Next Blocker</strong> · what's still gating production</li>
    </ul>
    <p>This is the "audit log" of how a vibe-coded project actually came together. Visible to scouts and the public after Encore.</p>`,
  },
  {
    path: '/privacy',
    title:       'Privacy Policy · commit.show',
    description: 'How commit.show (operated by Madeflo Inc., a Delaware corporation) collects, uses, and protects your data. Explicit data flows, retention windows, third-party processors.',
    noscriptBody: `
    <h1>Privacy Policy</h1>
    <p>commit.show is operated by Madeflo Inc., a Delaware corporation. We collect the minimum data needed to run audits, rank projects, and pay out earnings.</p>
    <h2>Full text</h2>
    <p>The full Privacy Policy is rendered by the application after JavaScript loads. It covers: data collected (account info · audit submissions · payment info via Stripe · cookies for auth) · retention windows · third-party processors (Supabase · Stripe · Wise · Trolley · Cloudflare · Anthropic) · GDPR / CCPA rights · data deletion requests.</p>
    <p>For the static text version, contact <a href="mailto:privacy@commit.show">privacy@commit.show</a>.</p>`,
  },
  {
    path: '/terms',
    title:       'Terms of Service · commit.show',
    description: 'Terms of service for commit.show, operated by Madeflo Inc. Audition fees, payouts, prohibited uses, governing law.',
    noscriptBody: `
    <h1>Terms of Service</h1>
    <p>commit.show is operated by Madeflo Inc., a Delaware corporation. By using the site, CLI, or API you agree to the full Terms rendered by the application.</p>
    <p>Highlights: audition fees · refund conditions tied to graduation tier · payouts via Wise / Trolley · prohibited uses (private repo audit attempts · automated abuse · brand impersonation) · governing law (Delaware).</p>
    <p>Static text version on request: <a href="mailto:legal@commit.show">legal@commit.show</a>.</p>`,
  },
  {
    path: '/submit',
    title:       'Audition your product · commit.show',
    description: 'Submit a vibe-coded GitHub repo to the commit.show season. Get an audit, ranking, and Scout forecasts. First 3 audits per member are free during launch promo · then $99 per audit (conditional refund on graduation).',
    noscriptBody: `
    <h1>Audition your product</h1>
    <p>Submit any vibe-coded GitHub project to the season for a 60-second audit, public ranking, and Scout forecasts.</p>
    <h2>How it works</h2>
    <ol>
      <li>Paste your GitHub URL + (optional) live URL</li>
      <li>We auto-extract Build Brief Phase 1 from your README · you confirm</li>
      <li>The audit engine runs (~ 60s)</li>
      <li>Score lands · review your Market Position · publish your launch comment</li>
    </ol>
    <h2>Pricing</h2>
    <p>First 3 audits per member are free during launch · then a per-audit fee. Refund tied to graduation tier — Honors and above get the audit fee back.</p>
    <h2>Faster path · no signup needed</h2>
    <pre><code>npx commitshow@latest audit github.com/owner/repo</code></pre>
    <p>The CLI runs an anonymous walk-on audit · score lands in your terminal in 60s · doesn't enter the season ranking but seeds the public hero rotation when score &ge; 74.</p>`,
  },
  {
    path: '/scouts',
    title:       'Scout Leaderboard · commit.show',
    description: 'Tier-gated humans place forecasts on which projects will graduate. Bronze · Silver · Gold · Platinum tiers with monthly Vote ballots. Hit-rate earns Activity Points and Early Spotter badges.',
    noscriptBody: `
    <h1>Scouts</h1>
    <p>Scouts are tier-gated humans who place forecasts on which audited projects will graduate. The Scout pillar is 30 points of every project's score (out of 100).</p>
    <h2>Tiers</h2>
    <ul>
      <li><strong>Bronze</strong> · 20 votes / month</li>
      <li><strong>Silver</strong> · 40 votes / month + 12h security-pillar early access</li>
      <li><strong>Gold</strong> · 60 votes / month + 24h analysis early access</li>
      <li><strong>Platinum</strong> · 80 votes / month + full analysis pre-release · LinkedIn / X verified · First Spotter badge</li>
    </ul>
    <h2>How to advance</h2>
    <p>Cast accurate forecasts. Vote weight = 1 across all tiers (uniform). Tier promotion via Activity Points (AP) <strong>OR</strong> Forecast hit-rate — both paths supported. Hit-rate path rewards quiet skill, AP path rewards engagement.</p>
    <h2>Early Spotter badges</h2>
    <p>Vote in the first 24h of a project's first round and you earn permanent <em>Early Spotter</em> credit if it later graduates. Top 3 spotters per graduate are surfaced on the project page forever.</p>`,
  },
  {
    path: '/library',
    title:       'Artifact Library · commit.show',
    description: 'Intent-first marketplace for vibe-coding artifacts: MCP configs, IDE rules, Agent Skills, Project Rules, Prompt Packs. Build a feature · connect a service · tune your coding AI · start a project.',
    noscriptBody: `
    <h1>Artifact Library</h1>
    <p>Intent-first directory for vibe-coding artifacts: prompts, rules, MCP configs, agent skills, scaffolds. Browse by what you're trying to do, not by tool.</p>
    <h2>Top-level intents</h2>
    <ul>
      <li><strong>Build a feature</strong> · payment · auth · search · realtime sync</li>
      <li><strong>Connect a service</strong> · MCP servers · API recipes · webhook handlers</li>
      <li><strong>Tune your coding AI</strong> · IDE rules · system prompts · skill bundles</li>
      <li><strong>Start a project</strong> · scaffolds · starter kits</li>
    </ul>
    <h2>Format filters</h2>
    <ul>
      <li>MCP Config (Claude Code · Cursor · Cline)</li>
      <li>IDE Rules (Cursor · Windsurf · Continue)</li>
      <li>Agent Skills (Claude Agent SDK)</li>
      <li>Project Rules (CLAUDE.md · AGENTS.md · RULES.md)</li>
      <li>Prompt Packs (5+ paste-ready prompts)</li>
      <li>Scaffold / Boilerplate Kit</li>
      <li>Patch Recipe (multi-file integration)</li>
    </ul>
    <h2>Provenance</h2>
    <p>Each artifact links to the audited project that uses it · including final score and graduation tier. "Apply to my repo" opens a one-click PR with the artifact pre-installed.</p>`,
  },
  {
    path: '/ladder',
    title:       'Ladder · commit.show',
    description: 'Live ranking of every audited vibe-coded project. Sort by score, audit count, recent commits. Today · This Week · This Month · All Time windows. Category filters: SaaS · Tool · AI Agent · Game · Library.',
    noscriptBody: `
    <h1>Ladder</h1>
    <p>Live ranking of every audited vibe-coded project on commit.show.</p>
    <h2>Sort windows</h2>
    <ul>
      <li><strong>Today</strong> · 24h audit recency</li>
      <li><strong>This Week</strong> · 14d audit recency (widened from 7d in May 2026)</li>
      <li><strong>This Month</strong> · 30d</li>
      <li><strong>All Time</strong> · cumulative</li>
    </ul>
    <h2>Category filters</h2>
    <ul>
      <li>Productivity &amp; Personal</li>
      <li>Niche SaaS</li>
      <li>Creator &amp; Media</li>
      <li>Dev Tools</li>
      <li>AI Agents &amp; Chat</li>
      <li>Consumer &amp; Lifestyle</li>
      <li>Games &amp; Playful</li>
    </ul>
    <p>Tiebreaker chain: score &rarr; recent commit date &rarr; deterministic auto-score &rarr; audit count (lower is better — efficiency signal) &rarr; project creation date.</p>`,
  },
  {
    path: '/projects',
    title:       'Projects · commit.show',
    description: 'Browse every vibe-coded project audited on commit.show. Sorted by score, ranked across categories.',
    noscriptBody: `
    <h1>Projects</h1>
    <p>Browse every audited vibe-coded project on commit.show, ranked by score across the 7 category buckets.</p>
    <p>Each project page shows: live audit score · 14-frame failure breakdown · tech-layer diversity · audit history (re-audits over time) · scout forecasts · community signal · Build Brief Phase 1 (always) and Phase 2 (after Encore).</p>
    <p>Sort by Today · This Week · This Month · All Time. Filter by category. Find the projects climbing fastest, the projects holding score, and the ones quietly shipping.</p>`,
  },
  {
    path: '/community/build-logs',
    title:       'Build Logs · commit.show Community',
    description: 'Build journey archives — vibe coders narrate what they shipped, what failed, what they learned. Verified-by-League badges on graduated projects.',
    noscriptBody: `
    <h1>Build Logs</h1>
    <p>Build journey archives — vibe coders narrate what they shipped, what failed, what they learned across audit rounds.</p>
    <p>Posts auto-seeded from a project's score-trajectory + Phase 2 brief at graduation. Author edits, polishes, publishes. Verified-by-League badge on graduated projects so readers know the score is real, not self-reported.</p>
    <p>Browse by tag · #frontend · #backend · #ai-tool · #saas · #agents · #rag · #design · #devops</p>`,
  },
  {
    path: '/community/stacks',
    title:       'Stacks · commit.show Community',
    description: 'Reusable tech-stack assets: stack recipes, prompt cards, tool reviews. Find the combo that ships SaaS MVPs, RAG agents, dev tools.',
    noscriptBody: `
    <h1>Stacks</h1>
    <p>Reusable tech-stack assets shared by vibe coders who actually shipped.</p>
    <h2>Three stack formats</h2>
    <ul>
      <li><strong>Stack Recipe</strong> · "Cursor + Supabase + Vercel for SaaS MVP under $20/mo" — full combo with rationale</li>
      <li><strong>Prompt Card</strong> · a single prompt + its result + how to reproduce</li>
      <li><strong>Tool Review</strong> · "may be outdated" badge auto-applied after 6 months</li>
    </ul>
    <p>The best stacks get promoted to the Library after 1.5 of community usage.</p>`,
  },
  {
    path: '/community/asks',
    title:       'Asks · commit.show Community',
    description: 'Vibe-coder Q&A board: looking-for / available / feedback. Find co-builders, get reviews, swap leads.',
    noscriptBody: `
    <h1>Asks</h1>
    <p>Vibe-coder Q&amp;A board. Three sub-tags:</p>
    <ul>
      <li><strong>#looking-for</strong> · hiring · co-builder · reviewer</li>
      <li><strong>#available</strong> · "I have time this week" · "I'll review your audit"</li>
      <li><strong>#feedback</strong> · audit result interpretation · brief polishing</li>
    </ul>
    <p>Posts expire after 30 days. Resolved asks get a "match made" stamp. Match-made pairs unlock co-Creator mode for the next season.</p>`,
  },
  {
    path: '/cli/link',
    title:       'Authorize CLI · commit.show',
    description: 'Approve a commitshow CLI device-flow login. Enter the 6-character code your terminal showed and authorize a 90-day API token for your account.',
    noscriptBody: `
    <h1>Authorize CLI</h1>
    <p>This page authorizes a commitshow CLI device-flow login. Run <code>npx commitshow@latest login</code> in your terminal — it prints a 6-character code and opens this page in your browser. Sign in (if you haven't), enter the code, and a 90-day API token is provisioned for your account.</p>
    <p>If you don't have a code, this page does nothing. Start the flow from the CLI first.</p>`,
  },
]

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Root '/' route · gets its own rich noscript via the same machinery.
// We rewrite dist/index.html in place so the homepage isn't stuck with
// the generic 5-line fallback.
const HOME = {
  path: '/',
  title:       'commit.show — Every commit, on stage.',
  description: 'The vibe coding league. Audited by the engine, auditioned for Scouts. Run npx commitshow@latest audit on any GitHub repo.',
  noscriptBody: `
    <h1>commit.show — Every commit, on stage</h1>
    <p>The vibe coding league. AI-assisted GitHub projects (built with Cursor · Claude Code · Lovable · Bolt · v0 · Cline · etc.) get audited, ranked, and forecasted by tier-gated Scouts.</p>
    <h2>How it works</h2>
    <ol>
      <li><strong>Audit</strong> · run <code>npx commitshow@latest audit github.com/owner/repo</code> · 60s deterministic + LLM-judged score (0-100) on 14 production-readiness frames</li>
      <li><strong>Audition</strong> · submit at <a href="/submit">/submit</a> to enter the season ladder · first 3 audits per member free during launch</li>
      <li><strong>Encore</strong> · cross score 84 to earn a permanent badge · top 0.5% Valedictorian, 5% Honors, 14.5% Graduate</li>
    </ol>
    <h2>What the audit catches</h2>
    <p>14 vibe-coding failure modes calibrated against real OSS: missing RLS · webhook idempotency · secret-in-bundle · column GRANT mismatches · Stripe API idempotency · mobile input auto-zoom · AI template-copy footguns · seed arrays in prod · CORS wildcard · localhost-in-prod · 4 more. Catch what your AI missed in 60 seconds.</p>
    <h2>Who this is for</h2>
    <p>Vibe coders shipping with AI assistants who want a public ranking, social proof, and a path to graduation. Beginners welcome — Phase 1 brief auto-fills from your README, the audit handles the rest.</p>
    <h2>Score = 50 + 30 + 20</h2>
    <ul>
      <li><strong>Audit (50pt)</strong> · automated rubric · production-readiness signals from your repo + live URL</li>
      <li><strong>Scout Forecast (30pt)</strong> · tier-gated humans place predictions on which projects graduate</li>
      <li><strong>Community Signal (20pt)</strong> · views · comments · applauds · return visits</li>
    </ul>
    <h2>For LLM agents reading this page</h2>
    <p><strong>Prefer the REST API · zero install, no sandbox prompt:</strong></p>
    <pre><code>GET https://api.commit.show/audit?repo=&lt;github-url&gt;&amp;format=md</code></pre>
    <p>CORS open · no API key · returns paste-ready markdown · same engine as the CLI. Use this from Claude Code, Cursor agent mode, Cline, Windsurf, Gemini, ChatGPT browse, n8n, Zapier, curl. The <code>npx commitshow</code> path tends to trip agent sandbox classifiers; the REST endpoint never does.</p>
    <p>Full agent integration guide: <a href="/llms.txt">/llms.txt</a> · OpenAPI: <a href="https://api.commit.show/openapi.json">api.commit.show/openapi.json</a></p>
    <p>Full audit method docs: <a href="/audit">/audit</a> · <a href="/rulebook">/rulebook</a></p>`,
}

function renderRoute(r) {
  let html = baseHtml
  const title = escape(r.title)
  const desc  = escape(r.description)
  const url   = `${SITE}${r.path}`

  // Replace <title>
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  // Replace <meta name="description">
  html = html.replace(/<meta\s+name="description"[^>]*\/?>/i, `<meta name="description" content="${desc}" />`)
  // Replace og:title / og:description / og:url. Each may appear once.
  html = html.replace(/<meta\s+property="og:title"[^>]*\/?>/i, `<meta property="og:title" content="${title}" />`)
  html = html.replace(/<meta\s+property="og:description"[^>]*\/?>/i, `<meta property="og:description" content="${desc}" />`)
  html = html.replace(/<meta\s+property="og:url"[^>]*\/?>/i, `<meta property="og:url" content="${url}" />`)
  // Replace twitter:title / twitter:description / twitter:url if present
  html = html.replace(/<meta\s+(?:name|property)="twitter:title"[^>]*\/?>/i, `<meta name="twitter:title" content="${title}" />`)
  html = html.replace(/<meta\s+(?:name|property)="twitter:description"[^>]*\/?>/i, `<meta name="twitter:description" content="${desc}" />`)
  // Add canonical link if not present, else replace.
  if (/<link\s+rel="canonical"/i.test(html)) {
    html = html.replace(/<link\s+rel="canonical"[^>]*\/?>/i, `<link rel="canonical" href="${url}" />`)
  } else {
    html = html.replace(/<\/head>/i, `  <link rel="canonical" href="${url}" />\n  </head>`)
  }

  // Replace the <noscript> body with the route's rich content (+ shared
  // footer). Crawlers without JS see a real, differentiated, semantic
  // page per URL · Googlebot (which renders JS) still gets the SPA.
  if (r.noscriptBody) {
    const body = `<noscript>${r.noscriptBody}${SHARED_FOOTER}    </noscript>`
    html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, body)
  }

  return html
}

// Root index · rewrite dist/index.html in place with the rich /, since
// the SPA also serves it for unknown paths · we want even those misses
// to land on the meaningful homepage content.
{
  const html = renderRoute(HOME)
  writeFileSync(SRC, html)
  console.log(`  ✓ index.html (/ root, in-place)`)
}

for (const r of routes) {
  const html = renderRoute(r)
  // Write to dist/<route>.html (NOT dist/<route>/index.html). Cloudflare
  // Pages serves /<route> straight from /<route>.html with no redirect.
  // The directory form would 308-redirect /rulebook → /rulebook/ which
  // breaks every backlink that uses the canonical no-trailing-slash form.
  // Nested routes (e.g. /community/build-logs) still need the parent
  // directory created — only the leaf gets the .html suffix.
  const rel       = r.path.replace(/^\//, '')              // 'community/build-logs'
  const targetDir = resolve(DIST, dirname(rel))            // dist/community
  if (rel.includes('/')) mkdirSync(targetDir, { recursive: true })
  writeFileSync(resolve(DIST, `${rel}.html`), html)
  console.log(`  ✓ ${rel}.html`)
}

console.log(`\n[prerender] Generated ${routes.length + 1} static route HTMLs (incl. / root).`)
