// auditCoach — quick-win catalog + detection · §16.2 Pre-audition Audit
// Coach (2026-05-15).
//
// The Coach turns a finished backstage audit into a short, actionable
// list of "do this and your score goes up" cards. Vibe coders who saw
// their score and stalled on whether to audition need a concrete next
// step — not a wall of weakness bullets, but 3-5 fixable items each
// with an estimated point bump. Following the cards is the on-ramp;
// the moment the score crosses into a higher band, the panel softly
// invites them to bring the project on stage.
//
// Catalog entries are entirely data-driven. Each:
//   · detect(input) → boolean   · is this fix APPLICABLE right now?
//   · title                     · short headline (≤ 50 chars)
//   · why                       · 1-line motivation surfaced inline
//   · impact                    · estimated points (rough · for ordering)
//   · howTo                     · short instructions, multi-line OK,
//                                 may include a copy-pasteable snippet
//   · category                  · 'meta' / 'security' / 'repo' /
//                                 'performance' — drives the chip color
//
// Detection only sees what the snapshot has — rich_analysis (completeness,
// security, scout brief), github_signals (CI, tests, license, …), and the
// lighthouse breakdown. No new server fetches.

export type CoachCategory = 'meta' | 'security' | 'repo' | 'performance'

export interface CoachInput {
  rich:           Record<string, unknown> | null      // snapshot.rich_analysis
  githubSignals:  Record<string, unknown> | null      // snapshot.github_signals
  lighthouse:     Record<string, unknown> | null      // snapshot.lighthouse (mobile)
  hasGithubUrl:   boolean                             // whether repo-track items apply
  isAppForm:      boolean                             // skip web-only fixes for non-app forms
}

export interface CoachItem {
  id:        string
  title:     string
  why:       string
  impact:    number         // estimated +pts · used only for ordering
  category:  CoachCategory
  howTo:     string         // can include backticks / multi-line snippet
}

// ── Catalog ──────────────────────────────────────────────────
// Order in the array doesn't matter — final list is sorted by impact
// desc + category preference (cheap wins first, harder ones last).
const CATALOG: Array<CoachItem & { detect: (input: CoachInput) => boolean }> = [
  // ── META · cheapest wins · each fills part of Completeness slot ──
  {
    id:       'meta-og-image',
    title:    'Add an Open Graph image',
    why:      'Social shares (X, Slack, Discord) need an og:image — without it your link unfurls as a blank card.',
    impact:   1,
    category: 'meta',
    howTo:    'Add to your <head>:\n<meta property="og:image" content="https://yoursite.com/og.png" />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n\nUse a 1200×630 PNG that shows the product name + screenshot. Tools like og-image.vercel.app generate one for free.',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_og_image']) === false,
  },
  {
    id:       'meta-og-title',
    title:    'Add og:title meta tag',
    why:      'Without og:title, social cards fall back to the raw page <title>, which is often empty or generic on SPAs.',
    impact:   1,
    category: 'meta',
    howTo:    '<meta property="og:title" content="Your Product · One-line value prop" />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_og_title']) === false,
  },
  {
    id:       'meta-og-description',
    title:    'Add og:description meta tag',
    why:      'Social cards show a description preview. Without it, your unfurl is a thumbnail with no context.',
    impact:   1,
    category: 'meta',
    howTo:    '<meta property="og:description" content="One sentence on what this does and who it\'s for." />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_og_description']) === false,
  },
  {
    id:       'meta-twitter-card',
    title:    'Add Twitter card meta tag',
    why:      'X (Twitter) reads twitter:card separately from og:* — projects often have og:image but no twitter:card and the X unfurl misses.',
    impact:   1,
    category: 'meta',
    howTo:    '<meta name="twitter:card" content="summary_large_image" />\n<meta name="twitter:image" content="https://yoursite.com/og.png" />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_twitter_card']) === false,
  },
  {
    id:       'meta-canonical',
    title:    'Add canonical link',
    why:      'Canonical tells search engines which URL is the real one. Without it, query-string variants get indexed as duplicates.',
    impact:   1,
    category: 'meta',
    howTo:    '<link rel="canonical" href="https://yoursite.com/" />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_canonical']) === false,
  },
  {
    id:       'meta-description',
    title:    'Add meta description',
    why:      'Search results snippet comes from <meta name="description">. Without one, Google shows whatever text it scrapes — usually navigation labels.',
    impact:   1,
    category: 'meta',
    howTo:    '<meta name="description" content="One sentence pitch · what · for whom · why now." />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_meta_desc']) === false,
  },
  {
    id:       'meta-manifest',
    title:    'Add web app manifest',
    why:      'PWA-ready apps install to home screens. The manifest is also a Lighthouse Best-Practices signal.',
    impact:   1,
    category: 'meta',
    howTo:    'Create /public/manifest.json:\n{\n  "name": "Your Product",\n  "short_name": "Product",\n  "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }],\n  "start_url": "/",\n  "display": "standalone"\n}\n\nThen link in <head>:\n<link rel="manifest" href="/manifest.json" />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_manifest']) === false,
  },
  {
    id:       'meta-favicon',
    title:    'Add a favicon',
    why:      'Browsers + tab strips + bookmarks all surface the favicon. Missing one looks unfinished even when the product is polished.',
    impact:   1,
    category: 'meta',
    howTo:    'Drop a 32×32 favicon.ico in /public, then link:\n<link rel="icon" href="/favicon.ico" sizes="any" />\n<link rel="icon" type="image/svg+xml" href="/icon.svg" />',
    detect:   (i) => readBool(i.rich, ['completeness_signals', 'has_favicon']) === false,
  },

  // ── SECURITY · headers · usually free at the CDN/edge layer ──
  {
    id:       'security-csp',
    title:    'Add Content-Security-Policy header',
    why:      'CSP blocks XSS by allowlisting where scripts can load from. Most production sites set at least a basic default.',
    impact:   1,
    category: 'security',
    howTo:    'Cloudflare / Vercel: add response header via _headers file or middleware.\nMinimal starting policy:\nContent-Security-Policy: default-src \'self\'; img-src \'self\' data: https:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'',
    detect:   (i) => readBool(i.rich, ['security_headers', 'has_csp']) === false,
  },
  {
    id:       'security-hsts',
    title:    'Add Strict-Transport-Security header',
    why:      'HSTS forces HTTPS for repeat visitors, preventing protocol downgrade attacks.',
    impact:   1,
    category: 'security',
    howTo:    'Strict-Transport-Security: max-age=31536000; includeSubDomains\n\nCloudflare: dashboard → SSL/TLS → Edge Certificates → enable HSTS.\nVercel: in vercel.json under headers[].',
    detect:   (i) => readBool(i.rich, ['security_headers', 'has_hsts']) === false,
  },
  {
    id:       'security-frame',
    title:    'Add X-Frame-Options header',
    why:      'Stops other sites from embedding you in an iframe (clickjacking defense).',
    impact:   1,
    category: 'security',
    howTo:    'X-Frame-Options: DENY\n\nOr the modern equivalent in CSP:\nContent-Security-Policy: frame-ancestors \'none\'',
    detect:   (i) => readBool(i.rich, ['security_headers', 'has_frame_protection']) === false,
  },
  {
    id:       'security-content-type',
    title:    'Add X-Content-Type-Options header',
    why:      'Stops browsers from MIME-sniffing JS as scripts when served as text.',
    impact:   1,
    category: 'security',
    howTo:    'X-Content-Type-Options: nosniff\n\nOne line in your edge config — universally safe to enable.',
    detect:   (i) => readBool(i.rich, ['security_headers', 'has_content_type_opt']) === false,
  },
  {
    id:       'security-referrer',
    title:    'Add Referrer-Policy header',
    why:      'Controls how much referrer info leaks to outbound links. Default leaks the full URL including query params.',
    impact:   1,
    category: 'security',
    howTo:    'Referrer-Policy: strict-origin-when-cross-origin\n\nGives you analytics (origin) without leaking paths to third parties.',
    detect:   (i) => readBool(i.rich, ['security_headers', 'has_referrer_policy']) === false,
  },

  // ── REPO · only when repo audit was actually performed ──
  {
    id:       'repo-license',
    title:    'Add a LICENSE file',
    why:      'OSS-style audits require a license declaration. MIT / Apache 2.0 / BSD all work; no license at all means others legally can\'t reuse the code.',
    impact:   2,
    category: 'repo',
    howTo:    'Pick one at choosealicense.com (MIT is the bread-and-butter for vibe-coded MVPs).\nCommit as /LICENSE in repo root.',
    detect:   (i) => i.hasGithubUrl && readBool(i.githubSignals, ['signals', 'has_license']) === false,
  },
  {
    id:       'repo-lockfile',
    title:    'Commit your package lockfile',
    why:      'A committed lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lockb) is the reproducible-build signal Lighthouse + audit pipelines look for.',
    impact:   1,
    category: 'repo',
    howTo:    'Make sure .gitignore does NOT include your lockfile.\nRun npm install (or yarn/pnpm/bun) and commit the generated lockfile.',
    detect:   (i) => i.hasGithubUrl && readBool(i.githubSignals, ['signals', 'has_lockfile']) === false,
  },
  {
    id:       'repo-ci',
    title:    'Add a CI workflow',
    why:      'CI = "this code is tested on every commit". One GitHub Actions yaml signals you treat the project seriously.',
    impact:   2,
    category: 'repo',
    howTo:    'Create .github/workflows/ci.yml:\n\nname: ci\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: \'20\' }\n      - run: npm ci && npm run build',
    detect:   (i) => i.hasGithubUrl && readBool(i.githubSignals, ['signals', 'has_ci_config']) === false,
  },
  {
    id:       'repo-tests',
    title:    'Add at least one test file',
    why:      'Zero tests = a structural penalty in Production Maturity. Even a single smoke test that confirms the app boots moves the needle.',
    impact:   2,
    category: 'repo',
    howTo:    'Pick the test runner that matches your framework:\n  · Next / React → vitest or jest\n  · Bun → bun test (built-in)\n\nCreate /tests/smoke.test.ts:\nimport { describe, it, expect } from \'vitest\'\ndescribe(\'app\', () => {\n  it(\'imports without crashing\', async () => {\n    expect(await import(\'../src/main\')).toBeDefined()\n  })\n})',
    detect:   (i) => i.hasGithubUrl && readNum(i.githubSignals, ['signals', 'test_files']) === 0,
  },
  {
    id:       'repo-ts-strict',
    title:    'Enable TypeScript strict mode',
    why:      'tsconfig "strict": true catches whole classes of bugs at compile time. Audits look for it as a production-readiness signal.',
    impact:   1,
    category: 'repo',
    howTo:    'In tsconfig.json compilerOptions:\n{\n  "compilerOptions": {\n    "strict": true,\n    "noUncheckedIndexedAccess": true\n  }\n}\n\nFix the errors that appear — they\'re real bugs every one.',
    detect:   (i) => i.hasGithubUrl && readBool(i.githubSignals, ['signals', 'has_typescript_strict']) === false,
  },
  {
    id:       'repo-readme-depth',
    title:    'Flesh out your README',
    why:      'A README under 80 lines reads as "WIP" to the audit. Install + Usage + a screenshot + a one-paragraph "what is this" goes a long way.',
    impact:   1,
    category: 'repo',
    howTo:    'Headings the audit looks for: ## Install, ## Usage, ## Features.\nAdd a screenshot at the top (renders inline on the GitHub page).\nLink to a deployed demo if you have one.',
    detect:   (i) => i.hasGithubUrl && readNum(i.githubSignals, ['signals', 'readme_depth_score']) < 3,
  },

  // ── PERFORMANCE · Lighthouse mobile · trickier but high impact ──
  {
    id:       'perf-mobile-perf',
    title:    'Improve mobile performance score',
    why:      'Mobile Lighthouse perf < 50 = 0 points on the 8-pt Lighthouse Performance slot. Top wins: lazy-load images, defer 3rd-party scripts, drop unused deps.',
    impact:   3,
    category: 'performance',
    howTo:    '1. Open PageSpeed Insights with your URL → Mobile.\n2. Tackle the top "Opportunities":\n   · "Eliminate render-blocking resources" → defer/async non-critical JS.\n   · "Properly size images" → use srcset or <picture> + WebP.\n   · "Reduce unused JavaScript" → code-split routes (React.lazy / dynamic import).\n3. Run again — even 10pt jump moves you up a bucket.',
    detect:   (i) => i.isAppForm && (readNum(i.lighthouse, ['performance']) >= 0) && readNum(i.lighthouse, ['performance']) < 50,
  },
  {
    id:       'perf-mobile-a11y',
    title:    'Fix mobile accessibility gaps',
    why:      'A11y < 70 misses the easy 3pt bucket. Common offenders: missing alt text, buttons with no name, low contrast.',
    impact:   2,
    category: 'performance',
    howTo:    'Run Lighthouse → Accessibility tab. Top fixes that hit fast:\n  · <img alt="…"> on every meaningful image\n  · <button aria-label="…"> on icon-only buttons\n  · Contrast ratio ≥ 4.5:1 for body text (use webaim.org/resources/contrastchecker)\n  · <html lang="en"> on the root element',
    detect:   (i) => i.isAppForm && (readNum(i.lighthouse, ['accessibility']) >= 0) && readNum(i.lighthouse, ['accessibility']) < 70,
  },
  {
    id:       'perf-mobile-seo',
    title:    'Patch mobile SEO score',
    why:      'SEO < 70 usually means missing meta description, missing alt text on images, or a malformed <html lang>. Cheap to fix.',
    impact:   1,
    category: 'performance',
    howTo:    'Lighthouse → SEO. The flagged audits are step-by-step (each tells you the exact element to fix). Most are 30-second changes.',
    detect:   (i) => i.isAppForm && (readNum(i.lighthouse, ['seo']) >= 0) && readNum(i.lighthouse, ['seo']) < 70,
  },
]

// ── Catalog evaluator ────────────────────────────────────────
export function detectQuickWins(input: CoachInput): CoachItem[] {
  const applicable = CATALOG.filter(entry => entry.detect(input))
  // Sort by impact desc, then by category preference (meta first since
  // cheapest, then security, then performance, then repo) so the user
  // sees their easy wins above the longer-effort items.
  const catRank: Record<CoachCategory, number> = { meta: 0, security: 1, performance: 2, repo: 3 }
  applicable.sort((a, b) => {
    if (a.impact !== b.impact) return b.impact - a.impact
    return catRank[a.category] - catRank[b.category]
  })
  return applicable.map(({ detect: _detect, ...rest }) => rest)
}

// ── localStorage persistence · per-project checked state ────
const LS_PREFIX = 'cs:coach:done:'
export function loadDoneIds(projectId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + projectId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter(x => typeof x === 'string')) : new Set()
  } catch { return new Set() }
}
export function saveDoneIds(projectId: string, done: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_PREFIX + projectId, JSON.stringify([...done]))
  } catch { /* quota / private mode · degrade silently */ }
}

// ── Internal · safe nested reader ────────────────────────────
function readBool(obj: unknown, path: string[]): boolean | null {
  const v = readAt(obj, path)
  return typeof v === 'boolean' ? v : null
}
function readNum(obj: unknown, path: string[]): number {
  const v = readAt(obj, path)
  return typeof v === 'number' ? v : 0
}
function readAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}
