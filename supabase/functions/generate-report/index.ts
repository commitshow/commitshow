// generate-report — builds a Legit.Show data report from live data and upserts it
// as a DRAFT (status='draft'). Publishing stays a manual editorial step (citation
// stability + the launch playbook), so this never auto-publishes. The quarterly
// cron calls { action:'draft' } for each kind; an admin reviews the draft and flips
// it to published. Deterministic aggregation over listings — same math as the
// /insights dashboard, frozen + dated.
//
//   { action:'draft', kind:'ai-built'|'web-security', period:'2026-q3' }  → upsert draft
//
// Admin-gated (service_role JWT from cron, x-admin-token, or an is_admin member).

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ADMIN_TOKEN = Deno.env.get('ADMIN_TOKEN') ?? ''
const SR = { apikey: SR_KEY, authorization: `Bearer ${SR_KEY}` }

async function authed(req: Request): Promise<boolean> {
  if (ADMIN_TOKEN && req.headers.get('x-admin-token') === ADMIN_TOKEN) return true
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return false
  try { if (JSON.parse(atob((jwt.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role') return true } catch { /* */ }
  if (jwt === ANON_KEY || !SUPABASE_URL || !SR_KEY) return false
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${jwt}` } })
    if (!u.ok) return false
    const uid = (await u.json())?.id
    if (!uid) return false
    const m = await fetch(`${SUPABASE_URL}/rest/v1/members?id=eq.${uid}&select=is_admin`, { headers: SR })
    return !!(await m.json())?.[0]?.is_admin
  } catch { return false }
}

const getRows = async (q: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?${q}`, { headers: SR })
  return r.ok ? await r.json() : []
}
const upsert = async (row: Record<string, unknown>) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/reports?on_conflict=slug`, {
    method: 'POST', headers: { ...SR, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  return { ok: r.ok, body: await r.json() }
}

// ── deep report (repo_audit) ──
const DEEP = [
  { key: 'error_tracking', label: 'No error tracking', plain: 'No crash monitoring — failures happen silently and nobody finds out.', fix: 'Wire in Sentry, OpenTelemetry or a hosted logger — minutes, not days.' },
  { key: 'rate_limiting', label: 'No API rate limiting', plain: 'No rate limit — one user can overload the server or run up the bill.', fix: 'Drop @upstash/ratelimit or express-rate-limit on public routes.' },
  { key: 'rls_coverage', label: 'No row-level security', plain: 'Database tables with no access rules — one user can read another’s data.', fix: 'Enable RLS and write a policy per table before launch.' },
  { key: 'webhook_idempotency', label: 'No webhook idempotency', plain: 'Webhooks with no dedupe — a duplicate delivery double-charges or double-processes.', fix: 'Store the provider’s event id and skip ones you’ve already processed.' },
  { key: 'prompt_injection', label: 'Unsanitized AI input', plain: 'User input flows straight into the model prompt — it can be hijacked.', fix: 'Keep system instructions separate from user input; validate before sending.' },
  { key: 'missing_indexes', label: 'Unindexed foreign keys', plain: 'Fast with little data, slow or down once it grows.', fix: 'Add an index on every foreign key you filter or join on.' },
  { key: 'cors', label: 'Wide-open CORS', plain: 'Any website can call the API directly.', fix: 'Replace origin:"*" with an explicit allow-list.' },
  { key: 'env_committed', label: 'Committed .env', plain: 'Credentials checked into the repo — leaked to anyone who clones it.', fix: 'git rm the file, rotate the keys, add it to .gitignore.' },
  { key: 'client_secret', label: 'Secrets in the browser', plain: 'Secret keys shipped to the client — anyone can steal them.', fix: 'Move secret keys server-side; never import a service-role key in client code.' },
]
async function buildDeep(period: string, asOf: string) {
  const rows = await getRows('select=name,slug,category,repo_audit&repo_audit=not.is.null') as { name: string; slug: string; category: string | null; repo_audit: { summary?: { pass: number; fail: number }; checks?: Record<string, { status: string }> } }[]
  const total = rows.length
  const stats = DEEP.map(({ key, label, plain, fix }) => {
    let fail = 0, n = 0
    for (const r of rows) { const st = r.repo_audit?.checks?.[key]?.status; if (!st || st === 'na') continue; n++; if (st === 'fail') fail++ }
    return { key, label, plain, fix, fail, n, fail_pct: n ? Math.round(100 * fail / n) : null, limited: n < 20 }
  }).filter(s => s.n >= 20).sort((a, b) => (b.fail_pct ?? -1) - (a.fail_pct ?? -1))
  const b = { clean: 0, light: 0, heavy: 0 }
  for (const r of rows) { const f = r.repo_audit?.summary?.fail || 0; if (f === 0) b.clean++; else if (f <= 2) b.light++; else b.heavy++ }
  const distribution = { title: 'How many controls are missing', note: 'Failed checks per tool (checks that don’t apply are excluded).', bands: [
    { label: 'Clean — 0 gaps', n: b.clean, pct: Math.round(100 * b.clean / total), tone: '#5C8A3E' },
    { label: '1–2 gaps', n: b.light, pct: Math.round(100 * b.light / total), tone: '#A8742E' },
    { label: '3 or more gaps', n: b.heavy, pct: Math.round(100 * b.heavy / total), tone: '#C24A33' },
  ] }
  const cat = new Map<string, { n: number; fail: number }>()
  for (const r of rows) { const c = r.category || 'Other'; const st = r.repo_audit?.checks?.error_tracking?.status; if (!st || st === 'na') continue; const e = cat.get(c) || { n: 0, fail: 0 }; e.n++; if (st === 'fail') e.fail++; cat.set(c, e) }
  const by_category = { metric: 'no error tracking', rows: [...cat.entries()].map(([category, e]) => ({ category, n: e.n, fail_pct: Math.round(100 * e.fail / e.n) })).filter(c => c.n >= 3).sort((a, b) => b.n - a.n).slice(0, 6) }
  const sum = rows.map(r => ({ name: r.name, slug: r.slug, pass: r.repo_audit?.summary?.pass || 0, fail: r.repo_audit?.summary?.fail || 0 }))
  const hall = sum.filter(r => r.fail === 0 && r.pass >= 2).sort((a, b) => b.pass - a.pass).slice(0, 8)
  const lowlights = sum.filter(r => r.fail >= 3).sort((a, b) => b.fail - a.fail).slice(0, 6)
  const hero = stats.find(s => s.key === 'error_tracking')!
  const env = stats.find(s => s.key === 'env_committed')?.fail_pct ?? 0
  return {
    slug: `state-of-ai-built-software-${period}`, kind: 'flagship', status: 'draft',
    title: `The State of AI-Built Software · ${period.toUpperCase()}`,
    subtitle: `We ran Legit.Show’s 7-Frame production-readiness benchmark across ${total} open-source AI, MCP and developer tools — straight from their repositories. AI coding ships a flawless demo; this is what quietly never makes it to production.`,
    coined_term: '7-Frame trust gap',
    hero_stat: { value: hero.fail_pct, unit: '%', label: 'of AI-built open-source tools ship with no error tracking', n: hero.n },
    sample: { total, scope: 'open-source AI, MCP & developer tools with a public repository', as_of: asOf },
    stats, distribution, by_category, hall_of_fame: hall, lowlights,
    body: [
      { h: 'Why these seven', md: `The demo always works — that’s what AI coding is *great* at. The gap is everything a demo never forces you to add: monitoring for when it breaks, limits for when it’s abused, access rules for when there’s more than one user. **${b.clean} of ${total}** (${distribution.bands[0].pct}%) had none of these gaps. The rest are one incident away from finding out.` },
      { h: 'The basics most get right', md: `It isn’t carelessness with the obvious stuff: **0%** shipped a hard-coded secret key in client code, and only **${env}%** committed a \`.env\`. The misses are the *invisible* controls a human senior adds by reflex and a model rarely does.` },
      { h: 'What this is not', md: `A health check, not a verdict. A missing rate limit correlates with “shipped fast, hardened never” — it doesn’t prove the product is bad. Every number is a count over a stated sample, measured from the public repository, fully reproducible.` },
    ],
    published_at: `${asOf}T12:00:00Z`,
  }
}

// ── surface report (benchmark signals) ──
const SURF = [
  { key: 'no_csp', label: 'No Content-Security-Policy', plain: 'The browser can’t block injected scripts — the front line against XSS is simply off.', fix: 'Add a Content-Security-Policy header — start in report-only mode, then enforce.', bad: (f: any) => f.security?.csp === false, has: () => true },
  { key: 'no_consent', label: 'No cookie consent', plain: 'Cookies set with no consent prompt — a routine GDPR/ePrivacy gap.', fix: 'Add a consent banner, or don’t set non-essential cookies before consent.', bad: (f: any) => f.privacy?.consentBanner === false, has: () => true },
  { key: 'no_privacy', label: 'No privacy policy page', plain: 'No privacy policy reachable at a standard path — required almost everywhere they operate.', fix: 'Publish a privacy policy at /privacy and link it in the footer.', bad: (f: any) => f.privacy?.privacyPage === false, has: () => true },
  { key: 'no_schema', label: 'No structured data', plain: 'No schema.org markup — invisible to AI answers and rich search results.', fix: 'Add schema.org JSON-LD (Organization, SoftwareApplication) to the page head.', bad: (f: any) => f.discoverability?.structuredData === false, has: () => true },
  { key: 'no_hsts', label: 'No HSTS', plain: 'No Strict-Transport-Security — leaves a window for protocol-downgrade attacks.', fix: 'Send Strict-Transport-Security with a long max-age once you’re HTTPS-only.', bad: (f: any) => f.security?.hsts === false, has: () => true },
  { key: 'a11y_low', label: 'Accessibility below 90', plain: 'Parts of the product are unusable with a screen reader or keyboard.', fix: 'Fix the top Lighthouse a11y items — labels, contrast, landmarks.', bad: (f: any) => (f.accessibility?.a11y ?? 100) < 90, has: (f: any) => f.accessibility?.a11y != null },
  { key: 'soft_404', label: 'No real 404 page', plain: 'Returns “200 OK” for pages that don’t exist — confuses crawlers and hides broken links.', fix: 'Return a real 404 status for unknown routes.', bad: (f: any) => f.reliability?.proper404 === false, has: (f: any) => f.reliability?.proper404 != null },
]
async function buildSurface(period: string, asOf: string) {
  const rows = await getRows('select=name,slug,category,benchmark&benchmark->>form=eq.web&benchmark=not.is.null') as { name: string; slug: string; category: string | null; benchmark: any }[]
  const fr = (r: any) => r.benchmark?.signals?.frames || {}
  const total = rows.length
  const stats = SURF.map(d => {
    let fail = 0, n = 0
    for (const r of rows) { const f = fr(r); if (!d.has(f)) continue; n++; if (d.bad(f)) fail++ }
    return { key: d.key, label: d.label, plain: d.plain, fix: d.fix, fail, n, fail_pct: n ? Math.round(100 * fail / n) : null, limited: n < 20 }
  }).filter(s => s.n >= 20).sort((a, b) => (b.fail_pct ?? -1) - (a.fail_pct ?? -1))
  const b = { a: 0, c: 0, d: 0, e: 0 }
  for (const r of rows) { const f = fr(r); let pass = 0; for (const d of SURF) { if (!d.has(f)) continue; if (!d.bad(f)) pass++ } if (pass >= 6) b.a++; else if (pass >= 4) b.c++; else if (pass >= 2) b.d++; else b.e++ }
  const distribution = { title: 'How many of the 7 do they pass', note: 'Surface checks passed per site (out of 7).', bands: [
    { label: '6–7 passed', n: b.a, pct: Math.round(100 * b.a / total), tone: '#5C8A3E' },
    { label: '4–5 passed', n: b.c, pct: Math.round(100 * b.c / total), tone: '#A8742E' },
    { label: '2–3 passed', n: b.d, pct: Math.round(100 * b.d / total), tone: '#C2683E' },
    { label: '0–1 passed', n: b.e, pct: Math.round(100 * b.e / total), tone: '#C24A33' },
  ] }
  const cat = new Map<string, { n: number; fail: number }>()
  for (const r of rows) { const c = r.category || 'Other'; const e = cat.get(c) || { n: 0, fail: 0 }; e.n++; if (fr(r).security?.csp === false) e.fail++; cat.set(c, e) }
  const by_category = { metric: 'no Content-Security-Policy', rows: [...cat.entries()].map(([category, e]) => ({ category, n: e.n, fail_pct: Math.round(100 * e.fail / e.n) })).filter(c => c.n >= 4).sort((a, b) => b.n - a.n).slice(0, 6) }
  const hall = rows.filter(r => { const f = fr(r); return f.security?.csp && f.security?.hsts && f.privacy?.privacyPage }).map(r => ({ name: r.name, slug: r.slug, pass: r.benchmark?.security || 0, fail: 0 })).sort((a, b) => b.pass - a.pass).slice(0, 8)
  const hero = stats.find(s => s.key === 'no_csp')!
  return {
    slug: `web-security-baseline-${period}`, kind: 'flagship', status: 'draft',
    title: `The Web Security Baseline · ${period.toUpperCase()}`,
    subtitle: `We checked the public security posture of ${total} launched web apps, SaaS and AI tools on Legit.Show — the headers and policies a browser sees before you ever sign in. Most ship without the basics.`,
    coined_term: 'the security-header gap',
    hero_stat: { value: hero.fail_pct, unit: '%', label: 'of launched web apps ship with no Content-Security-Policy', n: hero.n },
    sample: { total, scope: 'launched web apps, SaaS and AI tools', as_of: asOf },
    stats, distribution, by_category, hall_of_fame: hall, lowlights: [],
    body: [
      { h: 'What this measures', md: `These are **public-surface** checks — what any browser or crawler sees from the outside, before login. They measure hygiene, not whether the product is good. Every number is a share of ${total} tested web services as of ${asOf}.` },
      { h: 'Headers, not vibes', md: `A CSP, HSTS and a real 404 cost minutes to add and are the line between “looks done” and “is done.” That **${hero.fail_pct}%** ship without even a CSP isn’t a story about bad engineers — it’s what a demo never forces you to add. Only **${distribution.bands[0].pct}%** pass 6 or 7 of the seven.` },
      { h: 'A health check, not a grade', md: `Surface signals correlate with care; they don’t prove a product is secure inside. We show exactly what was observed from the public surface, and what wasn’t — no overall score, no verdict.` },
    ],
    published_at: `${asOf}T13:00:00Z`,
  }
}

// ── privacy report (surface privacy signals) ──
async function buildPrivacy(period: string, asOf: string) {
  const rows = await getRows('select=name,slug,category,benchmark&benchmark->>form=eq.web&benchmark=not.is.null') as { name: string; slug: string; category: string | null; benchmark: any }[]
  const fr = (r: any) => r.benchmark?.signals?.frames?.privacy || {}
  const total = rows.length
  const defs = [
    { key: 'no_consent', label: 'No cookie consent', plain: 'Cookies set with no consent prompt — a routine GDPR/ePrivacy gap.', fix: 'Add a consent banner, or hold non-essential cookies until consent.', bad: (p: any) => p.consentBanner === false },
    { key: 'no_privacy', label: 'No privacy policy page', plain: 'No privacy policy reachable at a standard path — required almost everywhere they operate.', fix: 'Publish a privacy policy at /privacy and link it in the footer.', bad: (p: any) => p.privacyPage === false },
    { key: 'no_terms', label: 'No terms of service', plain: 'No terms page reachable — the contract users supposedly agree to.', fix: 'Publish /terms and link it.', bad: (p: any) => p.termsPage === false },
  ]
  const stats = defs.map(d => { let fail = 0; for (const r of rows) if (d.bad(fr(r))) fail++; return { key: d.key, label: d.label, plain: d.plain, fix: d.fix, fail, n: total, fail_pct: Math.round(100 * fail / total), limited: false } }).sort((a, b) => b.fail_pct - a.fail_pct)
  let p3 = 0, p1 = 0, p0 = 0
  for (const r of rows) { const p = fr(r); const c = [p.privacyPage, p.termsPage, p.consentBanner].filter(Boolean).length; if (c >= 3) p3++; else if (c >= 1) p1++; else p0++ }
  const distribution = { title: 'How much do they disclose', note: 'Privacy basics present per site (policy · terms · consent).', bands: [
    { label: 'All three', n: p3, pct: Math.round(100 * p3 / total), tone: '#5C8A3E' },
    { label: 'One or two', n: p1, pct: Math.round(100 * p1 / total), tone: '#A8742E' },
    { label: 'None', n: p0, pct: Math.round(100 * p0 / total), tone: '#C24A33' },
  ] }
  const cat = new Map<string, { n: number; fail: number }>()
  for (const r of rows) { const c = r.category || 'Other'; const e = cat.get(c) || { n: 0, fail: 0 }; e.n++; if (fr(r).consentBanner === false) e.fail++; cat.set(c, e) }
  const by_category = { metric: 'no cookie consent', rows: [...cat.entries()].map(([category, e]) => ({ category, n: e.n, fail_pct: Math.round(100 * e.fail / e.n) })).filter(c => c.n >= 4).sort((a, b) => b.n - a.n).slice(0, 6) }
  const hero = stats[0]
  return {
    slug: `the-privacy-gap-${period}`, kind: 'flagship', status: 'draft',
    title: `The Privacy Gap · ${period.toUpperCase()}`,
    subtitle: `We checked what ${total} launched web apps, SaaS and AI tools tell you about your data — before you ever sign in. Most tell you nothing.`,
    coined_term: 'the consent gap',
    hero_stat: { value: hero.fail_pct, unit: '%', label: `of launched web apps ${hero.label.toLowerCase()}`, n: total },
    sample: { total, scope: 'launched web apps, SaaS and AI tools', as_of: asOf },
    stats, distribution, by_category, hall_of_fame: [], lowlights: [],
    body: [
      { h: 'What this measures', md: `Public-surface privacy posture: is there a reachable privacy policy, terms page, and a cookie-consent prompt before non-essential cookies are set. Hygiene and compliance signals, not legal advice — a share of ${total} tested web services as of ${asOf}.` },
      { h: 'Why it’s everywhere', md: `Consent banners and a privacy page are paperwork a demo never needs and a launch quietly skips. **${distribution.bands[2].pct}%** disclose *none* of the three. It isn’t malice — it’s the unglamorous last 10% that AI coding and a deadline both ignore.` },
    ],
    published_at: `${asOf}T14:00:00Z`,
  }
}

// ── State of MCP servers (deep checks on the MCP subset, incl. auth) ──
const MCP_DEEP = [
  { key: 'auth', label: 'No authentication', plain: 'The server runs tools for anyone who can reach it — no API key, no token.', fix: 'Require a bearer token / API key before handling tool calls.' },
  ...[
    { key: 'rate_limiting', label: 'No rate limiting', plain: 'One caller can hammer the server or run up the bill.', fix: 'Add a rate limiter on the request handler.' },
    { key: 'error_tracking', label: 'No error tracking', plain: 'Failures happen silently — nobody finds out.', fix: 'Wire in Sentry / OpenTelemetry.' },
    { key: 'client_secret', label: 'Leaked secret', plain: 'A secret key shipped in the code — anyone can steal it.', fix: 'Keep secrets server-side / in env, never committed.' },
    { key: 'env_committed', label: 'Committed .env', plain: 'Credentials checked into the repo.', fix: 'git rm it, rotate, .gitignore.' },
  ],
]
async function buildMcp(period: string, asOf: string) {
  const all = await getRows('select=name,slug,category,url,repo_audit&repo_audit=not.is.null') as { name: string; slug: string; category: string | null; url: string; repo_audit: any }[]
  const rows = all.filter(r => /mcp/i.test(r.slug + ' ' + r.name + ' ' + (r.url || '')) || /MCP/i.test(r.category || ''))
  const total = rows.length
  const stats = MCP_DEEP.map(({ key, label, plain, fix }) => {
    let fail = 0, n = 0
    for (const r of rows) { const st = r.repo_audit?.checks?.[key]?.status; if (!st || st === 'na') continue; n++; if (st === 'fail') fail++ }
    return { key, label, plain, fix, fail, n, fail_pct: n ? Math.round(100 * fail / n) : null, limited: n < 15 }
  }).filter(s => s.n >= 8).sort((a, b) => (b.fail_pct ?? -1) - (a.fail_pct ?? -1))
  const sum = rows.map(r => ({ name: r.name, slug: r.slug, pass: r.repo_audit?.summary?.pass || 0, fail: r.repo_audit?.summary?.fail || 0 }))
  const hall = sum.filter(r => r.fail === 0 && r.pass >= 2).sort((a, b) => b.pass - a.pass).slice(0, 8)
  const hero = stats.find(s => s.key === 'auth') || stats[0]
  return {
    slug: `state-of-mcp-servers-${period}`, kind: 'flagship', status: 'draft',
    title: `The State of MCP Servers · ${period.toUpperCase()}`,
    subtitle: `MCP is the newest way to give an AI tools — and ${total} of the servers in our catalog were scanned straight from their repositories. The protocol is young; the production hygiene shows it.`,
    coined_term: 'the open-tool gap',
    hero_stat: { value: hero?.fail_pct ?? 0, unit: '%', label: `of MCP servers ${(hero?.label || '').toLowerCase()}`, n: hero?.n ?? total },
    sample: { total, scope: 'open-source MCP servers with a public repository', as_of: asOf },
    stats, distribution: null, by_category: null, hall_of_fame: hall, lowlights: [],
    body: [
      { h: 'Why MCP is the scary one', md: `An MCP server hands an AI the keys to *do things* — read files, hit APIs, run code. When one ships with no authentication, anyone who can reach it gets those keys too. This is the newest category, with the least settled security culture, and zero prior measurement.` },
      { h: 'A young protocol', md: `These aren’t bad engineers — MCP barely existed a year ago. The point isn’t blame; it’s that "exposes tools to an AI" and "has no auth" should never be true at once, and right now they often are.` },
    ],
    published_at: `${asOf}T15:00:00Z`,
  }
}

// ── Open-source vs closed SaaS (comparison) ──
async function buildOssVsSaas(period: string, asOf: string) {
  const rows = await getRows('select=benchmark&benchmark=not.is.null') as { benchmark: any }[]
  const FR = [ ['security', 'Security'], ['standards', 'Standards'], ['discoverability', 'Discoverability'], ['maintenance', 'Maintenance'] ] as [string, string][]
  const oss = rows.filter(r => ['github', 'npm'].includes(r.benchmark?.form))
  const saas = rows.filter(r => r.benchmark?.form === 'web')
  const avg = (arr: any[], k: string) => { const xs = arr.map(r => r.benchmark?.[k]).filter((v: any) => v != null); return xs.length ? Math.round(xs.reduce((a: number, b: number) => a + b, 0) / xs.length) : null }
  const compare = { oss_n: oss.length, saas_n: saas.length, oss_label: 'Open source', saas_label: 'Closed SaaS', frames: FR.map(([k, label]) => ({ key: k, label, oss: avg(oss, k), saas: avg(saas, k) })).filter(f => f.oss != null && f.saas != null) }
  const secGap = (compare.frames.find(f => f.key === 'security') || { oss: 0, saas: 0 }) as any
  const lead = secGap.oss >= secGap.saas ? 'open source' : 'closed SaaS'
  return {
    slug: `open-source-vs-closed-saas-${period}`, kind: 'flagship', status: 'draft',
    title: `Open Source vs Closed SaaS · ${period.toUpperCase()}`,
    subtitle: `Does opening the code make a product more production-ready — or less? We compared ${oss.length} open-source tools against ${saas.length} closed web apps on the frames both can be measured on.`,
    coined_term: 'the openness premium',
    hero_stat: { value: Math.abs(secGap.oss - secGap.saas), unit: 'pt', label: `security gap between open-source and closed SaaS (${lead} leads)`, n: oss.length + saas.length },
    sample: { total: oss.length + saas.length, scope: 'open-source tools vs closed web apps', as_of: asOf },
    stats: [], distribution: null, by_category: null, compare, hall_of_fame: [], lowlights: [],
    body: [
      { h: 'What this compares', md: `Four frames are measurable for both an open repo and a closed website — security posture, web standards, discoverability and maintenance. Each bar is the group average (0–100). Performance / accessibility / privacy need a rendered page, so they’re excluded to keep the comparison fair.` },
      { h: 'The takeaway', md: `**${lead}** leads on security here. Open source gets credit for a license and an active history a crawler can verify; closed SaaS gets credit for the headers and polish a browser can see. Each is strong exactly where the other is opaque.` },
    ],
    published_at: `${asOf}T16:00:00Z`,
  }
}

// ── time-series trend (benchmark_history) — auto-activates once listings have
// 2+ snapshots spanning the window. Returns null until then, so reports gain a
// "what changed" section the moment the weekly cron has built enough history.
async function buildTrend(sinceDays = 100, minListings = 25) {
  const cutoff = Date.now() - sinceDays * 864e5
  const rows = await getRows('select=listing_id,overall,scored_at&order=scored_at.asc&limit=50000') as { listing_id: string; overall: number; scored_at: string }[]
  const byL = new Map<string, { first?: { o: number; t: number }; last?: { o: number; t: number } }>()
  for (const r of rows) {
    const t = Date.parse(r.scored_at); if (t < cutoff || r.overall == null) continue
    const e = byL.get(r.listing_id) || {}
    if (!e.first) e.first = { o: r.overall, t }
    e.last = { o: r.overall, t }
    byL.set(r.listing_id, e)
  }
  const deltas: { id: string; delta: number }[] = []
  for (const [id, e] of byL) if (e.first && e.last && e.last.t > e.first.t) deltas.push({ id, delta: e.last.o - e.first.o })
  if (deltas.length < minListings) return null
  const avg = Math.round((deltas.reduce((a, b) => a + b.delta, 0) / deltas.length) * 10) / 10
  const improved = deltas.filter(d => d.delta > 0).length
  const top = [...deltas].sort((a, b) => b.delta - a.delta).slice(0, 5).filter(d => d.delta > 0)
  // resolve names for the movers
  const ids = top.map(d => `"${d.id}"`).join(',')
  const names = ids ? await getRows(`select=id,name,slug&id=in.(${ids})`) as { id: string; name: string; slug: string }[] : []
  const nm = new Map(names.map(n => [n.id, n]))
  return {
    window_days: sinceDays, n: deltas.length, avg_delta: avg,
    improved_pct: Math.round(100 * improved / deltas.length),
    most_improved: top.map(d => ({ name: nm.get(d.id)?.name || '—', slug: nm.get(d.id)?.slug || '', delta: d.delta })).filter(m => m.slug),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await authed(req))) return json({ error: 'unauthorized' }, 401)
  let p: any = {}; try { p = await req.json() } catch { /* */ }
  const action = p.action || 'draft'
  const asOf = new Date().toISOString().slice(0, 10)
  try {
    if (action === 'draft' || action === 'refresh') {
      // refresh = the two flagship reports are LIVING: rebuilt in place under their
      // year slug and published, so they always reflect the current catalog.
      // draft = a period-stamped draft edition for editorial review.
      const live = action === 'refresh'
      const period = live ? asOf.slice(0, 4)
        : (String(p.period || '').match(/^[0-9a-z-]{4,12}$/) ? p.period : `${asOf.slice(0, 4)}-q${Math.floor((new Date().getUTCMonth()) / 3) + 1}`)
      const trend = await buildTrend().catch(() => null)
      const out: Record<string, unknown> = {}
      const BUILDERS: Record<string, (p: string, a: string) => Promise<any>> = { 'ai-built': buildDeep, 'web-security': buildSurface, 'privacy': buildPrivacy, 'mcp': buildMcp, 'oss-vs-saas': buildOssVsSaas }
      for (const kind of (p.kind ? [p.kind] : Object.keys(BUILDERS))) {
        const build = BUILDERS[kind]; if (!build) continue
        const row = await build(period, asOf)
        row.trend = trend
        row.status = live ? 'published' : 'draft'
        const r = await upsert(row)
        out[kind] = r.ok ? { slug: row.slug, hero: row.hero_stat?.value } : { error: r.body }
      }
      return json({ period, mode: action, trend: trend ? 'included' : 'no history yet', reports: out })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) { return json({ error: String(e) }, 500) }
})
