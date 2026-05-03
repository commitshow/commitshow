#!/usr/bin/env node
// Per-route SEO prerender — generates dist/<route>/index.html for each
// static-content route, with route-specific <title> + meta tags so
// Googlebot sees unique HTML on each URL even before JS executes.
//
// Why: Vite SPA returns the same root HTML for every path. Without
// prerendering, /rulebook · /audit · /backstage · etc. all looked like
// duplicate-title pages to search crawlers, and only / got indexed.
//
// How: read dist/index.html, swap title + meta + og:url per route,
// write to dist/<route>/index.html. Cloudflare Pages serves these as
// static files; the SPA still owns dynamic routes (/projects/:id etc)
// via its automatic index.html fallback for unknown paths.

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

const routes = [
  // path, title, description
  {
    path: '/rulebook',
    title:       'Judging Rulebook · commit.show',
    description: 'How vibe-coded projects are scored. Audit (50pt) + Scout Forecast (30pt) + Community (20pt). 14-frame production-readiness rubric, 4-grade graduation system, transparent calibration baseline.',
  },
  {
    path: '/audit',
    title:       'Audit Report Methodology · commit.show',
    description: 'How the commit.show audit engine scores production-readiness. 14 failure-mode frames calibrated against real OSS projects: RLS, webhook idempotency, secret-in-bundle, column GRANT mismatches, Stripe API idempotency, mobile input zoom, and 8 more.',
  },
  {
    path: '/backstage',
    title:       'Backstage · commit.show',
    description: 'The Build Brief earn-status process. Phase 1 (Core Intent) on first audit; Phase 2 (Failure Log · Decision Archaeology · AI Delegation Map · Live Proof · Next Blocker) unlocked at graduation.',
  },
  {
    path: '/privacy',
    title:       'Privacy Policy · commit.show',
    description: 'How commit.show (operated by Madeflo Inc., a Delaware corporation) collects, uses, and protects your data. Explicit data flows, retention windows, third-party processors.',
  },
  {
    path: '/terms',
    title:       'Terms of Service · commit.show',
    description: 'Terms of service for commit.show, operated by Madeflo Inc. Audition fees, payouts, prohibited uses, governing law.',
  },
  {
    path: '/submit',
    title:       'Audition your product · commit.show',
    description: 'Submit a vibe-coded GitHub repo to the commit.show season. Get an audit, ranking, and Scout forecasts. First 3 audits per member are free during launch promo · then $99 per audit (conditional refund on graduation).',
  },
  {
    path: '/scouts',
    title:       'Scout Leaderboard · commit.show',
    description: 'Tier-gated humans place forecasts on which projects will graduate. Bronze · Silver · Gold · Platinum tiers with monthly Vote ballots. Hit-rate earns Activity Points and Early Spotter badges.',
  },
  {
    path: '/library',
    title:       'Artifact Library · commit.show',
    description: 'Intent-first marketplace for vibe-coding artifacts: MCP configs, IDE rules, Agent Skills, Project Rules, Prompt Packs. Build a feature · connect a service · tune your coding AI · start a project.',
  },
  {
    path: '/ladder',
    title:       'Ladder · commit.show',
    description: 'Live ranking of every audited vibe-coded project. Sort by score, audit count, recent commits. Today · This Week · This Month · All Time windows. Category filters: SaaS · Tool · AI Agent · Game · Library.',
  },
  {
    path: '/projects',
    title:       'Projects · commit.show',
    description: 'Browse every vibe-coded project audited on commit.show. Sorted by score, ranked across categories.',
  },
  {
    path: '/community/build-logs',
    title:       'Build Logs · commit.show Community',
    description: 'Build journey archives — vibe coders narrate what they shipped, what failed, what they learned. Verified-by-League badges on graduated projects.',
  },
  {
    path: '/community/stacks',
    title:       'Stacks · commit.show Community',
    description: 'Reusable tech-stack assets: stack recipes, prompt cards, tool reviews. Find the combo that ships SaaS MVPs, RAG agents, dev tools.',
  },
  {
    path: '/community/asks',
    title:       'Asks · commit.show Community',
    description: 'Vibe-coder Q&A board: looking-for / available / feedback. Find co-builders, get reviews, swap leads.',
  },
]

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

for (const r of routes) {
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

console.log(`\n[prerender] Generated ${routes.length} static route HTMLs.`)
