// analyze-project — Edge Function
// Runs the level-0 analysis pipeline server-side.
//
// Input: { project_id: string }  (project + build_brief must already exist)
// Output: { score_auto, verdict, insight, tech_layers, lh, github, md_score }
//
// Environment (Supabase secrets):
//   ANTHROPIC_API_KEY   — required
//   PAGESPEED_API_KEY   — optional, improves rate limits
//   GITHUB_TOKEN        — optional, improves rate limits
//
// Architecture: PRD v1.2 §9.2
//   browser → Edge Function → PageSpeed + GitHub + Claude → DB state
//   Function does NOT call other functions. Writes results, returns summary.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime, not typechecked by tsc

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Lighthouse via PageSpeed Insights ─────────────────────────
// Per-category scores are integers 0-100. When PageSpeed is unable to assess
// a category (audit errored · category not computed) we store -1 as a
// "not assessed" sentinel so scoring can distinguish it from a legitimate 0.
interface LighthouseScores {
  performance: number     // -1 = not assessed
  accessibility: number
  bestPractices: number
  seo: number
}

const LH_NOT_ASSESSED = -1

function lhScoreOrNA(raw: number | null | undefined): number {
  if (raw == null) return LH_NOT_ASSESSED
  return Math.round(raw * 100)
}

async function runLighthouse(url: string): Promise<LighthouseScores> {
  const key = Deno.env.get('PAGESPEED_API_KEY')
  // PageSpeed Insights v5 runs ONLY the Performance category unless each other
  // category is explicitly requested. Without these params the other three
  // scores come back as null and render as 0.
  const params = new URLSearchParams({ url, strategy: 'mobile' })
  params.append('category', 'performance')
  params.append('category', 'accessibility')
  params.append('category', 'best-practices')
  params.append('category', 'seo')
  if (key) params.set('key', key)

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
  try {
    const res = await fetch(endpoint)
    if (!res.ok) {
      console.error('PageSpeed', res.status, (await res.text()).slice(0, 200))
      throw new Error(`PageSpeed ${res.status}`)
    }
    const data = await res.json()
    const c = data.lighthouseResult?.categories
    if (!c) throw new Error('No categories')
    return {
      performance:   lhScoreOrNA(c.performance?.score),
      accessibility: lhScoreOrNA(c.accessibility?.score),
      bestPractices: lhScoreOrNA(c['best-practices']?.score),
      seo:           lhScoreOrNA(c.seo?.score),
    }
  } catch (e) {
    console.error('runLighthouse failed', e)
    // Network/API failure — everything unassessed (not 0)
    return { performance: LH_NOT_ASSESSED, accessibility: LH_NOT_ASSESSED, bestPractices: LH_NOT_ASSESSED, seo: LH_NOT_ASSESSED }
  }
}

// ── GitHub repo deep scan ─────────────────────────────────────
interface GitHubInfo {
  accessible: boolean
  owner?: string
  repo?: string
  description?: string | null
  default_branch?: string
  languages: Record<string, number>
  language_pct: Record<string, number>
  stars: number
  forks: number
  open_issues: number
  commit_count_recent: number
  head_commit_sha: string | null       // HEAD sha at scan time — immutability proof
  file_count_estimate: number
  last_commit_at: string | null
  created_at: string | null
  // Deep signals that inform scoring / Claude reasoning
  signals: {
    solidity_files: number               // .sol count → smart contracts
    edge_functions: number               // supabase/functions/*/index.ts
    sql_files: number
    create_table_count: number           // parsed from .sql files
    react_components: number             // *.tsx under components/
    page_files: number                   // *.tsx under pages/ or app/
    mcp_server_files: number             // files matching mcp/mcp-server patterns
    has_claude_md: boolean
    has_prd_docs: boolean                // prd*.md, spec*.md in repo root/docs
    has_rls_policies: boolean            // "enable row level security" OR "create policy" in any sampled .sql
    rls_policy_count: number             // count of "create policy" definitions across sampled files
    test_files: number                   // *.test.* / *.spec.*
    uses_web3_libs: string[]             // ['viem', 'ethers', 'wagmi', ...]
    uses_ai_libs: string[]               // ['@anthropic-ai/sdk', 'openai', ...]
    uses_mcp_libs: string[]              // ['@modelcontextprotocol/*', ...]
    package_deps_count: number
  }
  readme_excerpt: string | null          // first ~2KB for Claude context
  debut_brief: {
    found: boolean
    path: string | null                  // e.g. ".debut/brief.md"
    raw: string | null                   // full MD content
    last_commit_at: string | null        // commit that last touched this file
    sha: string | null                   // blob SHA (immutability proof)
  }
  // v1.4 §15.6 — candidate MD files for MD Discovery scoring.
  // These are filtered but not yet content-loaded. Loader runs in runMDDiscovery.
  md_candidates: Array<{ path: string; sha: string | null }>
}

const WEB3_LIBS = ['viem', 'ethers', 'wagmi', 'web3', '@rainbow-me/rainbowkit', 'permit2', '@account-abstraction/sdk', 'hardhat', 'foundry-rs']
const AI_LIBS   = ['@anthropic-ai/sdk', 'openai', '@google/generative-ai', 'ai', 'langchain', '@langchain/core', 'cohere-ai']
const MCP_LIBS  = ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server-everything']

async function inspectGitHub(url: string): Promise<GitHubInfo> {
  const empty: GitHubInfo = {
    accessible: false, languages: {}, language_pct: {},
    stars: 0, forks: 0, open_issues: 0, commit_count_recent: 0,
    head_commit_sha: null,
    file_count_estimate: 0, last_commit_at: null, created_at: null,
    signals: {
      solidity_files: 0, edge_functions: 0, sql_files: 0, create_table_count: 0,
      react_components: 0, page_files: 0, mcp_server_files: 0,
      has_claude_md: false, has_prd_docs: false, has_rls_policies: false, rls_policy_count: 0,
      test_files: 0, uses_web3_libs: [], uses_ai_libs: [], uses_mcp_libs: [],
      package_deps_count: 0,
    },
    readme_excerpt: null,
    debut_brief: { found: false, path: null, raw: null, last_commit_at: null, sha: null },
    md_candidates: [],
  }
  const m = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i)
  if (!m) return empty
  const owner = m[1], repo = m[2].replace(/\.git$/, '')

  const token = Deno.env.get('GITHUB_TOKEN')
  const headers: Record<string, string> = { 'User-Agent': 'commit.show-analyzer', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  async function gh(path: string): Promise<any | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers })
      return res.ok ? await res.json() : null
    } catch { return null }
  }
  async function ghText(path: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers })
      if (!res.ok) return null
      const data = await res.json()
      if (typeof data.content === 'string' && data.encoding === 'base64') {
        return atob(data.content.replace(/\n/g, ''))
      }
      return null
    } catch { return null }
  }

  const repoData = await gh('')
  if (!repoData) return empty

  // Languages
  const languages = (await gh('/languages')) ?? {}
  const total = Object.values(languages).reduce((s: number, v: any) => s + (v as number), 0) as number
  const language_pct: Record<string, number> = {}
  for (const [lang, bytes] of Object.entries(languages)) {
    language_pct[lang] = total ? Math.round((bytes as number) / total * 1000) / 10 : 0
  }

  // Commit count (last 100 on default branch) — hint of iteration pace
  const commitsResp = await gh('/commits?per_page=100')
  const commit_count_recent = Array.isArray(commitsResp) ? commitsResp.length : 0
  const head_commit_sha = Array.isArray(commitsResp) && commitsResp[0]?.sha ? String(commitsResp[0].sha) : null

  // File tree (recursive, truncated at 100k entries)
  const defBranch = repoData.default_branch || 'main'
  const treeResp = await gh(`/git/trees/${defBranch}?recursive=1`)
  const tree: { path: string; type: string; sha?: string }[] = treeResp?.tree ?? []
  const blobs = tree.filter(x => x.type === 'blob')

  // Signal extraction
  const paths = blobs.map(b => b.path)
  const sol = paths.filter(p => p.endsWith('.sol'))
  const sqlFiles = paths.filter(p => p.endsWith('.sql'))
  const edgeFnDirs = new Set<string>()
  paths.forEach(p => {
    const m2 = p.match(/^supabase\/functions\/([^/]+)\/(index\.ts|index\.js|mod\.ts)$/)
    if (m2) edgeFnDirs.add(m2[1])
  })
  const reactComponents = paths.filter(p => /components\/.*\.(tsx|jsx)$/.test(p))
  const pageFiles = paths.filter(p => /(pages|app|routes)\/.*\.(tsx|jsx|vue|svelte)$/.test(p))
  const mcpServerFiles = paths.filter(p => /mcp[_-]?server|mcp\/index|mcp-config/i.test(p))
  const testFiles = paths.filter(p => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p))
  const hasClaudeMd = paths.some(p => /^CLAUDE\.md$/i.test(p))
  const hasPrdDocs = paths.some(p => /^(docs\/)?(prd|spec|rfc).*\.(md|pdf)$/i.test(p))

  // ── v1.4 §15.6 · MD Discovery candidates ──
  // Library-worthy signals: CLAUDE.md · RULES.md · ARCHITECTURE.md · CONVENTIONS.md
  // plus anything under docs/ · guides/ · integrations/ · playbooks/ · prompts/
  // Exclusions: README (root), LICENSE, CHANGELOG, node_modules/**, dist/**,
  // vendored docs, generated type defs.
  const EXCLUDE_MD = /(^|\/)(README|LICENSE|COPYING|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY)\.md$/i
  const EXCLUDE_DIR = /^(node_modules|dist|build|\.next|\.vercel|vendor|coverage|\.git|target)\//i
  const HIGH_PRIORITY_MD = new Set([
    'CLAUDE.md', 'AGENTS.md', 'RULES.md', 'ARCHITECTURE.md', 'CONVENTIONS.md',
    'PLAYBOOK.md', 'RUNBOOK.md', 'SETUP.md', 'PROMPTS.md',
  ])
  const mdPaths = paths.filter(p => /\.md$/i.test(p))
    .filter(p => !EXCLUDE_MD.test(p))
    .filter(p => !EXCLUDE_DIR.test(p))
  // Priority sort: root high-priority names first, then docs/** / guides/** / prompts/** / integrations/**.
  const priorityRank = (p: string): number => {
    if (HIGH_PRIORITY_MD.has(p)) return 0
    if (/^(docs|guides|prompts?|integrations?|playbooks?|recipes?|runbooks?)\//i.test(p)) return 1
    if (/(stripe|auth|oauth|webhook|deploy|supabase|worker|cron|schema|rls)[-_].*\.md$/i.test(p)) return 1
    if (/\.cursorrules?$/i.test(p) || /\.windsurfrules?$/i.test(p)) return 1
    return 2
  }
  const mdCandidates = mdPaths
    .map(path => ({ path, rank: priorityRank(path) }))
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length)
    .slice(0, 20)
    .map(c => ({ path: c.path, sha: (blobs.find(b => b.path === c.path) as { sha?: string } | undefined)?.sha ?? null }))

  // Parse .sql files for CREATE TABLE and RLS markers.
  // Sample up to 12 files (GitHub API budget allows ~5000/hr with token),
  // and prioritise files most likely to define security: schema.sql first,
  // then any file whose path mentions rls / policy / security / auth.
  let createTableCount = 0
  let hasRls = false
  let rlsPolicyCount = 0
  const sqlPriority = (p: string): number => {
    const name = p.toLowerCase()
    if (/(^|\/)schema\.sql$/.test(name)) return 0   // schema.sql wins
    if (/(rls|polic|security|auth)/.test(name))   return 1
    return 2
  }
  const sqlSample = sqlFiles
    .map(p => ({ p, r: sqlPriority(p) }))
    .sort((a, b) => a.r - b.r || a.p.length - b.p.length)
    .slice(0, 12)
    .map(x => x.p)
  for (const sql of sqlSample) {
    const text = await ghText(`/contents/${encodeURI(sql)}?ref=${defBranch}`)
    if (!text) continue
    createTableCount += (text.match(/create\s+table\s+(if\s+not\s+exists\s+)?[a-zA-Z_]/gi) || []).length
    // Two signals — `enable row level security` (the toggle) and
    // `create policy` (the actual policy definition). Either one means
    // the project takes RLS seriously; counting both gives Claude
    // intensity, not just a boolean.
    if (/enable\s+row\s+level\s+security/i.test(text)) hasRls = true
    if (/create\s+policy\b/i.test(text))               hasRls = true
    rlsPolicyCount += (text.match(/create\s+policy\b/gi) || []).length
  }

  // Parse package.json for deps
  let web3Libs: string[] = [], aiLibs: string[] = [], mcpLibs: string[] = [], depsCount = 0
  const pkgText = await ghText(`/contents/package.json?ref=${defBranch}`)
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText)
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>
      depsCount = Object.keys(all).length
      web3Libs = WEB3_LIBS.filter(l => l in all || Object.keys(all).some(k => k.startsWith(l)))
      aiLibs   = AI_LIBS.filter(l => l in all || Object.keys(all).some(k => k.startsWith(l)))
      mcpLibs  = MCP_LIBS.filter(l => Object.keys(all).some(k => k === l || k.startsWith('@modelcontextprotocol/')))
    } catch { /* ignore */ }
  }

  // README excerpt for Claude context
  const readmeRaw = await ghText(`/readme`)
  const readme_excerpt = readmeRaw ? readmeRaw.slice(0, 2000) : null

  // ── commit.show Build Brief: canonical file search + fuzzy fallback ──
  // Priority: exact paths → fuzzy patterns. Legacy `.debut/` paths still
  // recognized for backward compat with early submissions.
  const exactCandidates = [
    '.commit/brief.md', 'commit/brief.md', 'COMMIT.md', 'docs/commit-brief.md',
    '.debut/brief.md',  'debut/brief.md',  'DEBUT.md',  'docs/debut-brief.md',
  ]
  const fuzzyPatterns: RegExp[] = [
    /(^|\/)\.commit\/brief\.md$/i,
    /(^|\/)commit\/brief\.md$/i,
    /(^|\/)commit[-_]?brief\.md$/i,
    /(^|\/)COMMIT\.md$/i,
    /(^|\/)\.debut\/brief\.md$/i,
    /(^|\/)debut\/brief\.md$/i,
    /(^|\/)debut[-_]?brief\.md$/i,
    /(^|\/)DEBUT\.md$/i,
    /(^|\/)brief\.md$/i,
  ]
  let debut_brief = {
    found: false, path: null as string | null, raw: null as string | null,
    last_commit_at: null as string | null, sha: null as string | null,
  }
  const allPaths = blobs.map(b => b.path)
  let chosenPath: string | null = null
  for (const exact of exactCandidates) {
    if (allPaths.includes(exact)) { chosenPath = exact; break }
  }
  if (!chosenPath) {
    for (const pattern of fuzzyPatterns) {
      const hit = allPaths.find(p => pattern.test(p))
      if (hit) { chosenPath = hit; break }
    }
  }
  if (chosenPath) {
    const raw = await ghText(`/contents/${encodeURI(chosenPath)}?ref=${defBranch}`)
    if (raw) {
      // Fetch last commit touching this file (integrity proof)
      let lastCommit: string | null = null
      try {
        const cRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(chosenPath)}&per_page=1`,
          { headers }
        )
        if (cRes.ok) {
          const arr = await cRes.json()
          lastCommit = arr?.[0]?.commit?.committer?.date ?? null
        }
      } catch { /* ignore */ }
      // blob SHA for content hash / immutability proof
      let sha: string | null = null
      try {
        const contentMeta = await gh(`/contents/${encodeURI(chosenPath)}?ref=${defBranch}`)
        sha = contentMeta?.sha ?? null
      } catch { /* ignore */ }
      debut_brief = { found: true, path: chosenPath, raw, last_commit_at: lastCommit, sha }
    }
  }

  // v1.4 §15.6 · attach discovery candidates to the GitHubInfo payload
  const md_candidates = mdCandidates

  return {
    accessible: true,
    md_candidates,
    owner, repo,
    description: repoData.description ?? null,
    default_branch: defBranch,
    languages,
    language_pct,
    stars: repoData.stargazers_count ?? 0,
    forks: repoData.forks_count ?? 0,
    open_issues: repoData.open_issues_count ?? 0,
    commit_count_recent,
    head_commit_sha,
    file_count_estimate: blobs.length,
    last_commit_at: repoData.pushed_at ?? null,
    created_at: repoData.created_at ?? null,
    signals: {
      solidity_files: sol.length,
      edge_functions: edgeFnDirs.size,
      sql_files: sqlFiles.length,
      create_table_count: createTableCount,
      react_components: reactComponents.length,
      page_files: pageFiles.length,
      mcp_server_files: mcpServerFiles.length,
      has_claude_md: hasClaudeMd,
      has_prd_docs: hasPrdDocs,
      has_rls_policies: hasRls,
      rls_policy_count: rlsPolicyCount,
      test_files: testFiles.length,
      uses_web3_libs: web3Libs,
      uses_ai_libs: aiLibs,
      uses_mcp_libs: mcpLibs,
      package_deps_count: depsCount,
    },
    readme_excerpt,
    debut_brief,
  }
}

// ── Live URL health ───────────────────────────────────────────
async function liveHealth(url: string) {
  const t0 = performance.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(timer)
    return { status: res.status, ok: res.ok, elapsed_ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { status: 0, ok: false, elapsed_ms: Math.round(performance.now() - t0), error: String(e) }
  }
}

// ── Polish & sharing signals ──────────────────────────────────
// Things Lighthouse doesn't grade but separate finished products from
// half-shipped prototypes: OG image / Twitter card (social shares),
// manifest + apple-touch-icon (mobile install), theme-color, favicon,
// canonical. We fetch the HTML once and regex the head — no heavy DOM
// dependency for an Edge runtime.

interface CompletenessSignals {
  fetched:           boolean
  has_og_image:      boolean
  has_og_title:      boolean
  has_og_description: boolean
  has_twitter_card:  boolean
  has_apple_touch:   boolean
  has_manifest:      boolean
  has_theme_color:   boolean
  has_favicon:       boolean
  has_canonical:     boolean
  has_meta_desc:     boolean
  score:             number     // 0-5 derived for Claude evidence
  filled:            number     // raw count of present signals · 0-10
  of:                number     // total checks · 10
}

async function inspectCompleteness(url: string): Promise<CompletenessSignals> {
  const blank: CompletenessSignals = {
    fetched: false,
    has_og_image: false, has_og_title: false, has_og_description: false,
    has_twitter_card: false, has_apple_touch: false, has_manifest: false,
    has_theme_color: false, has_favicon: false, has_canonical: false,
    has_meta_desc: false,
    score: 0, filled: 0, of: 10,
  }
  if (!url) return blank
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      method: 'GET', signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'commit.show-completeness-probe/1' },
    })
    clearTimeout(timer)
    if (!res.ok) return blank

    // Read at most 64 KB — head is always near the top, no need for the body.
    const reader = res.body?.getReader()
    let text = ''
    if (reader) {
      const dec = new TextDecoder()
      let total = 0
      while (total < 65_536) {
        const { value, done } = await reader.read()
        if (done) break
        text += dec.decode(value, { stream: true })
        total += value.byteLength
        if (text.includes('</head>')) break
      }
      try { reader.cancel() } catch { /* ignore */ }
    } else {
      text = await res.text()
    }

    const head = text.split(/<\/head>/i)[0] ?? text
    const has = (re: RegExp) => re.test(head)

    const signals: CompletenessSignals = {
      fetched: true,
      has_og_image:       has(/<meta\s+[^>]*(?:property|name)\s*=\s*["']og:image["']/i),
      has_og_title:       has(/<meta\s+[^>]*(?:property|name)\s*=\s*["']og:title["']/i),
      has_og_description: has(/<meta\s+[^>]*(?:property|name)\s*=\s*["']og:description["']/i),
      has_twitter_card:   has(/<meta\s+[^>]*name\s*=\s*["']twitter:card["']/i),
      has_apple_touch:    has(/<link\s+[^>]*rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["']/i),
      has_manifest:       has(/<link\s+[^>]*rel\s*=\s*["']manifest["']/i),
      has_theme_color:    has(/<meta\s+[^>]*name\s*=\s*["']theme-color["']/i),
      has_favicon:        has(/<link\s+[^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["']/i),
      has_canonical:      has(/<link\s+[^>]*rel\s*=\s*["']canonical["']/i),
      has_meta_desc:      has(/<meta\s+[^>]*name\s*=\s*["']description["']/i),
      score: 0, filled: 0, of: 10,
    }

    // Weighted score · the social-share signals carry more weight because they
    // multiply the audience of every external mention of the product.
    const weighted =
      (signals.has_og_image       ? 1.5 : 0) +
      (signals.has_twitter_card   ? 1.0 : 0) +
      (signals.has_apple_touch    ? 0.75 : 0) +
      (signals.has_manifest       ? 0.75 : 0) +
      (signals.has_theme_color    ? 0.25 : 0) +
      (signals.has_favicon        ? 0.25 : 0) +
      (signals.has_og_title       ? 0.2 : 0) +
      (signals.has_og_description ? 0.2 : 0) +
      (signals.has_canonical      ? 0.05 : 0) +
      (signals.has_meta_desc      ? 0.05 : 0)

    signals.score  = Math.min(5, Math.round(weighted * 10) / 10)
    signals.filled =
      Number(signals.has_og_image) + Number(signals.has_og_title) +
      Number(signals.has_og_description) + Number(signals.has_twitter_card) +
      Number(signals.has_apple_touch) + Number(signals.has_manifest) +
      Number(signals.has_theme_color) + Number(signals.has_favicon) +
      Number(signals.has_canonical) + Number(signals.has_meta_desc)
    return signals
  } catch {
    return blank
  }
}

// ── Scoring (PRD v1.2 §5.2) ───────────────────────────────────
function scoreLighthouse(lh: LighthouseScores) {
  // -1 "not assessed" → neutral midpoint (no bonus, no penalty).
  // Legit 0 still takes the harshest bucket (bad signal).
  const p = lh.performance   === LH_NOT_ASSESSED ? 5
           : lh.performance   >= 90 ? 10
           : lh.performance   >= 70 ? 7
           : lh.performance   >= 50 ? 4 : 0
  const a = lh.accessibility === LH_NOT_ASSESSED ? 4
           : lh.accessibility >= 90 ? 8
           : lh.accessibility >= 70 ? 5 : 2
  const b = lh.bestPractices === LH_NOT_ASSESSED ? 4
           : lh.bestPractices >= 90 ? 8
           : lh.bestPractices >= 70 ? 5 : 1
  const s = lh.seo           === LH_NOT_ASSESSED ? 2
           : lh.seo           >= 90 ? 4
           : lh.seo           >= 70 ? 2 : 0
  return { performance: p, accessibility: a, bestPractices: b, seo: s, total: p + a + b + s }
}

function scoreTechLayers(langs: Record<string, number>, stack: string[]): { pts: number; layers: string[] } {
  const L = new Set<string>()
  const frontendLangs = ['TypeScript', 'JavaScript', 'HTML', 'CSS', 'Svelte', 'Vue']
  if (frontendLangs.some(k => k in langs)) L.add('frontend')
  const backendLangs = ['Python', 'Go', 'Rust', 'Java', 'Ruby', 'PHP']
  if (backendLangs.some(k => k in langs)) L.add('backend')
  const s = stack.join(' ').toLowerCase()
  if (/supabase|postgres|mysql|mongodb|firebase|neon|planetscale/.test(s)) L.add('backend')
  if (/postgres|supabase|mongodb|mysql|redis|d1|neon/.test(s)) L.add('database')
  if (/claude|openai|gpt|gemini|llm|anthropic|cursor|lovable|v0|replit/.test(s)) L.add('ai')
  if (/ethereum|solana|base|chain|wallet|web3|nft|mcp/.test(s)) L.add('chain')
  // PRD: Frontend+Backend+DB = 3, +AI = +1, +Chain/MCP = +1  (cap 5)
  let pts = 0
  if (L.has('frontend') && L.has('backend') && L.has('database')) pts += 3
  if (L.has('ai')) pts += 1
  if (L.has('chain')) pts += 1
  return { pts: Math.min(pts, 5), layers: [...L] }
}

function scoreBriefIntegrity(brief: Record<string, unknown>) {
  const required = ['problem', 'features', 'target_user']
  const filled = required.filter(k => typeof brief[k] === 'string' && (brief[k] as string).trim().length >= 10).length
  // 3 sections → 5 pts when all filled. Missing sections zero out proportionally.
  const pts = filled === required.length ? 5 : filled >= 2 ? 3 : filled >= 1 ? 1 : 0
  return { pts, filled, of: required.length }
}

// ── Claude deep analysis (multi-axis) ─────────────────────────

// Expert panel (v1.6 — panel of experts layered on top of scoring).
// Four personas aligned with commit.show's auto-scoring axes deliver short
// qualitative verdicts. Gated by trigger_type — only initial / resubmit /
// season_end run the panel (weekly/applaud skip to save API cost).
type ExpertRole = 'staff_engineer' | 'security_officer' | 'designer' | 'ceo'

interface ExpertVerdict {
  role:             ExpertRole
  display_name:     string              // "Staff Engineer" · for UI label
  verdict_label:    'ship' | 'iterate' | 'block'
  verdict_summary:  string              // 1-2 sentence reviewer take
  top_strength:     string              // one-line, tied to evidence
  top_issue:        string              // one-line, tied to evidence
  confidence:       number              // 0-10, how sure they are given the evidence
}

// Scout-facing distilled bullets (v1.6.1).
// Strengths and weaknesses derived from the full evidence for Scouts who do
// not have Platinum clearance. Asymmetric visibility: non-Platinum scouts see
// 5 strengths but only the first 3 weaknesses — the last 2 are locked behind
// Platinum tier (PRD §9 · full analysis pre-release for Platinum).
interface ScoutBrief {
  strengths:  Array<{ axis: string; bullet: string }>  // exactly 5, ≤120 chars
  weaknesses: Array<{ axis: string; bullet: string }>  // exactly 5, ≤120 chars · first 3 public to all scouts
}

interface RichAnalysis {
  tldr: string
  headline: string
  role_title: { previous: string; current: string; reasoning: string }
  score: {
    previous_estimate: number
    current: number
    delta_reasoning: string
    // v1.7 structured ledger — arithmetic walkthrough rendered as a list
    // instead of a dense prose paragraph. UI displays each as a +/- chip.
    breakdown?: Array<{
      kind: 'baseline' | 'plus' | 'minus' | 'final'
      points: number
      label: string           // short phrase, ≤ 80 chars (e.g., "RLS on all write tables")
      evidence?: string       // optional one-liner citing exact evidence
    }>
  }
  headline_metrics: Array<{ label: string; value: string; sublabel: string }>
  axis_scores: Array<{
    axis: string
    current: number
    previous: number | null
    delta_label: string
    color_hint: 'blue'|'indigo'|'green'|'emerald'|'pink'|'amber'|'rose'
  }>
  github_findings: Array<{
    title: string
    detail: string
    accent: 'green'|'indigo'|'blue'|'amber'|'rose'
  }>
  open_questions: Array<{ title: string; detail: string }>
  honest_evaluation: string
  tampering_signals: Array<{
    severity: 'low'|'medium'|'high'
    signal: string                  // short label, e.g. "Brief claims 50+ tables, GitHub has 2"
    detail: string                  // specific evidence
  }>
  expert_panel?: ExpertVerdict[]     // length 4 when present · omitted on weekly/applaud triggers
  scout_brief?: ScoutBrief           // distilled 5+5 for scout-tier visibility (creator keeps the long form private)
}

const RICH_ANALYSIS_FALLBACK: RichAnalysis = {
  tldr: '', headline: '',
  role_title: { previous: '', current: '', reasoning: '' },
  score: { previous_estimate: 0, current: 0, delta_reasoning: '' },
  headline_metrics: [], axis_scores: [], github_findings: [],
  open_questions: [], honest_evaluation: '', tampering_signals: [],
}

async function callClaude(
  input: Record<string, unknown>,
  opts: { includeExpertPanel: boolean },
): Promise<RichAnalysis & { error?: string }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { ...RICH_ANALYSIS_FALLBACK, error: 'ANTHROPIC_API_KEY not set' }
  const { includeExpertPanel } = opts

  const systemPrompt = `You are commit.show's senior evaluator for vibe-coded (AI-assisted) projects.
commit.show is a league where creators submit apps, get objectively scored across multiple axes, and graduate after 3-week seasons.
Your job: produce an evidence-backed, specific, and occasionally uncomfortable evaluation of a single project.

Your voice:
- Write every line of prose in American English. Concrete, confident, never generic.
- The user-facing product name for your output is "Audit" / "Audit report" / "Audit findings". NEVER write the literal word "AI" in any prose field you return (findings, rationale, role_title.reasoning, score.delta_reasoning, honest_evaluation, strengths, concerns, panel verdicts, notes). Prefer "the engine", "this audit", "automated checks", "the analyzer", or "the rubric" when you need a noun. Exception: describing the CREATOR's toolchain is fine ("built with Cursor", "Claude-assisted", "AI-assisted development") — that's the Creator's context, not ours.
- NEVER praise vaguely. Every positive claim is tied to a number or file fact from the evidence.
- Distinguish four layers of evidence by increasing trust:
  1) Phase 1 self-claims (problem / features / target_user) — marketing, treat skeptically.
  2) Phase 2 PASTED extraction — may be tampered in transit. Cross-check against ground truth.
  3) Phase 2 COMMITTED brief (committed to the repo with Git history) — higher trust than pasted.
     Reference commit timestamp + sha as integrity proof.
  4) Source-code implementation evidence (code, commits, files, tree) — ground truth, cannot be faked.
- Cross-reference: when Phase 2 claims diverge from code signals, flag it (e.g. "ai_delegation_map says 90% human on security, but no row-level-security policies found").
- Do NOT frame findings as "brief said X, actual is Y" dramatic reveals. Treat the brief as one evidence source among many — not the bar to beat. Describe what the project IS, using the brief only to cross-check claims and flag mismatches.
- When evidence is thin (few commits, no tests, no live URL), flag it as an open question, not a flaw.
- The Failure Log and Decision Archaeology are prime signals of real iteration. Empty/generic entries → deduct.
- The AI Delegation Map reveals honesty: 100%/0% splits = lying. Realistic splits = credible.
- Use specific numbers: "80+ serverless functions", "6 Solidity contracts deployed to Base mainnet", "50+ tables with row-level security".
- Score on multiple axes, not one number. Each axis must have >=1 evidence line in github_findings.

COMPARISON FRAME — critical:
- The evidence pack sets "is_initial_snapshot" true/false, and "previous_snapshot" may carry the prior evaluation.
- If is_initial_snapshot = true: this is the FIRST evaluation of this project. Do NOT invent a "previous" value from the brief. Set score.previous_estimate = score.current, every axis.previous = null, every axis.delta_label = "NEW", and role_title.previous = role_title.current. Write role_title.reasoning / score.delta_reasoning as short justifications of the current value (not comparisons). Write honest_evaluation as a fresh assessment with no "before vs after" framing.
- If is_initial_snapshot = false: previous_snapshot.score_total is the authentic prior score, and previous_snapshot.axis_scores is a map of axis → prior score. Use these as the comparison baseline. score.previous_estimate = previous_snapshot.score_total. For each axis, set previous = prior score when available, else null. delta_label is "+N" / "-N" / "-" / "NEW". Use role_title.reasoning and score.delta_reasoning to explain what specifically changed since the previous snapshot (new commits, new contracts, removed features, perf regressions). Frame honest_evaluation as "since the last evaluation on {date}, these three things moved the needle..."

AUDITION LOOP — round-by-round scoring behavior (critical):
- commit.show runs as a 3-week audition. Each re-analysis is a ROUND of an audition show — Creator ships improvements between rounds to climb the score.
- When is_initial_snapshot = false, your job is to measure the AMOUNT OF REAL PROGRESS since the last round, not to baseline a fresh evaluation.
- If new commits exist since parent (commit_sha changed) and those commits visibly improved Lighthouse metrics, fixed issues you previously flagged, added tests, tightened Brief integrity, or addressed a prior concern — REFLECT THAT IN THE SCORE. Score MUST climb when real iteration is visible. Don't penalize them for where they started; measure the delta.
- If the Creator did not ship anything new (same commit_sha, same Lighthouse, same Brief content), keep the score stable or slightly decay to nudge action. Never climb without evidence.
- Tampering signals still apply — fake polish (brief bumped but repo unchanged) locks the score.
- score.delta_reasoning should tell the audition story: "Round 2: shipped new auth middleware + RLS policies, Lighthouse accessibility +12. Security axis moves from 58 → 74."

TAMPERING DETECTION — mandatory audit:
- Source priority: github.debut_brief.raw (committed) > build_brief_phase_2_pasted (pasted).
  If both exist and differ in material claims, mark 'high' — "pasted brief diverges from committed version".
- If github.debut_brief.found = false AND pasted brief also missing, mark 'high' "no brief submitted".
- If github.debut_brief.found = true, treat last_commit_at as the authoritative brief timestamp and reference the sha in your reasoning.
- If build_brief_phase_2_pasted.integrity_self_check is missing, mark 'high' severity "prompt template was modified".
- If integrity_self_check.confidence_score >= 9 AND unverifiable_claims is empty, mark 'medium' — implausibly high self-rating.
- For every claim in Phase 2 that contradicts GitHub signals (e.g. "80 edge functions" while signals.edge_functions = 0), add a 'high' severity entry.
- If ai_delegation_map shows only 0/100 splits, mark 'medium'.
- If failure_log entries are generic ("no significant failures", <15 chars), mark 'medium'.
- If delivery mentions mainnet contracts but signals.solidity_files = 0, mark 'high'.
- Each tampering signal must cite the specific field and the contradicting GitHub number.
- Tampering signals directly lower score.current. High severity: -10 to -20 each. Medium: -5. Low: -2.

${includeExpertPanel ? `EXPERT PANEL — mandatory layer on top of scoring:
After the axis scoring + tampering audit, speak as a four-person review panel where each expert reads the SAME evidence but foregrounds their own lens. Each expert issues a short verdict.

- Staff Engineer (code execution lens): architecture, testability, dependency hygiene, migrations, CI, error handling. Pull evidence from file_count_estimate, tech layers, commits cadence, tests presence.
- Security Officer (production-readiness lens): auth, RLS, secret hygiene, input validation, rate limits, CORS, supply chain. Pull evidence from RLS policies, auth flows, env var usage, public endpoints.
- Designer (UX + accessibility lens): clarity of copy, empty states, loading states, flow friction, accessibility score, visual coherence. Pull evidence from Lighthouse accessibility, live URL behavior, UI descriptions.
- CEO (product + positioning lens): problem fit, target user sharpness, differentiation, monetization path, distribution story. Pull evidence from Build Brief phase 1, headline metrics, traction signals.

Rules for the panel:
- Each verdict is short — verdict_summary 1-2 sentences (≤200 chars). top_strength and top_issue are single sentences anchored in concrete evidence (cite a number or field).
- verdict_label ∈ {ship, iterate, block}. "ship" = strong enough to graduate today on this dimension. "iterate" = clear path but notable gaps. "block" = would fail this lens in a real launch review.
- Verdicts can DISAGREE with the numeric score on that axis — this is the POINT. A high Lighthouse score doesn't make a Security Officer say "ship".
- NEVER name brand tools (Cursor, Claude Code, Lovable, etc.). Describe findings in product terms.
- All four experts MUST be present; don't skip one because evidence is thin — if evidence is thin, confidence drops and verdict_summary says so.
- American English, no Korean.` : ''}

SCOUT BRIEF — MANDATORY on every analysis (not just when expert_panel runs):
Scouts forecast on these projects but most don't have Platinum clearance to read the full audit. Distill the review into a list they can read in 10 seconds.

- strengths: exactly 5 items. Each = the single strongest thing you'd point a Scout at.
- weaknesses: exactly 5 items. Each = the single thing most likely to stop this project from graduating.

Ordering matters:
- Order by IMPORTANCE for scouting, most decision-moving first. Position 1 = the bullet a Scout would want to see before any other.
- For weaknesses, items 4 and 5 are the deepest/most sensitive issues — only Platinum Scouts will see them. Put surface-level issues first (positions 1-3) and structural/hidden issues last (positions 4-5).

Format per bullet:
- axis: one of "Security", "Infrastructure", "Code", "UX", "Product", "Web3", "Ops", "AI" — pick the best fit.
- bullet: ≤120 chars. Must cite a concrete number, file, or signal. No hedging. No brand names.
  Good: "RLS policies on every state-changing table; no anon writes possible."
  Good: "6 Solidity contracts on Base mainnet, no audit trail or test suite in repo."
  Bad:  "Good security posture overall."
  Bad:  "Could improve UX."

- All 10 bullets MUST be present in every analysis regardless of trigger_type. American English. No Korean.`

  const userPrompt = `Evaluate this project using ONLY the evidence below. Every axis score must be backed by a specific number from the evidence.

========= EVIDENCE PACK =========
${JSON.stringify(input, null, 2)}
==================================

OUTPUT RULES
- Return ONLY valid JSON. No markdown, no prose outside JSON.
- ALL prose fields (tldr, headline, role_title reasoning, delta_reasoning, sublabels, findings detail, open_questions, honest_evaluation, tampering signal detail) MUST be written in American English. Do not use Korean, Korean characters, or Korean phrasing anywhere in the output.
- Do NOT mention any AI coding tool / platform brand names (e.g. Cursor, Lovable, Claude Code, v0, Bolt, Windsurf, Replit AI). Describe what was built, not which tool built it. Tool identity is irrelevant to evaluation.
- tldr: one-line impression, <= 120 characters, the strongest takeaway about the project today.
- headline: one bold sentence shown prominently. For initial snapshot, describe the project's character. For re-analysis, describe the direction of change since the previous snapshot.
- role_title.current: role the creator looks like today based on all evidence (e.g. "Full-Stack Web3 Product Engineer").
- role_title.previous: for re-analysis, the role from the previous snapshot; for initial snapshot, equal to current.
- role_title.reasoning: short justification. For re-analysis, explain what changed.
- score.current: final score 0-100 based on today's evidence.

  SCORE FORMATION — anti-anchoring discipline (critical, v1.7):
  1) START from auto_baseline = scoring_so_far.auto_50_breakdown.total * 2 (so auto 33 → baseline 66).
  2) Apply deductions:
       · Each tampering_signal: high -10 to -20 · medium -5 · low -2
       · Lighthouse Performance  <50 and not NA: -5
       · Lighthouse BestPractices <50 and not NA: -5
       · Thin GitHub (<50 commits or <3 months active): -3
       · No tests in repo: -3
       · No observability / telemetry: -2
       · Polish gap (completeness_signals.score < 1.5 AND live_url is web): -3
         "no og:image, no manifest, no apple-touch — looks half-shipped"
  3) Apply ADDITIVE evidence bonuses — each concrete, independently verifiable bullet
     is worth ~+3 to +5. No bundled "infrastructure depth" lift. Examples of +3/+5:
       · Real smart contract deployed on mainnet (with explorer link): +5
       · RLS enforced across all state-changing tables: +4
       · 20+ Edge Functions wired into a live user flow: +3
       · Migration cadence 50+ over 3 months with meaningful schema shifts: +3
       · Third-party integration that works end-to-end (Stripe · OAuth · etc.): +3
       · Multi-platform surface (web + mobile binary, not just responsive): +3
       · Polish full house (completeness_signals.score >= 4.0): +3
         "shipped: og:image + twitter:card + manifest + apple-touch — production polish"
     Cap total positive bonuses at +25 from baseline unless there is truly
     exceptional evidence (rare — document explicitly in delta_reasoning).
  4) Resulting score.current must be REPRODUCIBLE from the evidence list above.
     Two different projects with different strength profiles must NOT land on
     the same score by default — avoid the 75-80 "pretty good" anchor.
  5) If the math lands you in 75-85 for a solid-but-not-outstanding project,
     push DOWN. The rookie bar is 75 and it should be hard to cross.
  CLI-PREVIEW MODE (input.is_cli_preview === true):
     This run was triggered by an anonymous \`npx commitshow audit\` call —
     the creator never reached the /submit form, so the build_brief is empty
     by design. Adjust scoring rules:
       · DO NOT emit a tampering_signal for missing Phase 2 brief sections
         (failure_log, decision_archaeology, ai_delegation_map, etc.). The
         creator never had the chance to fill them.
       · DO NOT apply the integrity_score = 0 penalty.
       · You MAY note in delta_reasoning that "Phase 2 brief not yet
         provided · audition (commit.show/submit) unlocks +15 to +20 typical."
       · Score what you can verify objectively (Lighthouse, GitHub signals,
         live URL, completeness). The auto_baseline × 2 still applies, but
         missing brief sections are framed as "not yet provided" not as
         dishonesty.
       · Phase 1 self-claims are also absent in CLI mode — that's expected,
         not suspicious.
     The intent: a CLI preview should land at a fair, evidence-only score
     that Creator can clearly improve by auditioning. Don't punish for the
     flow they haven't seen yet.

  6) ALSO emit the arithmetic as a structured list in score.breakdown — one
     entry per step of your math. This is what the UI renders as a ledger:
       · kind: 'baseline' (first row · starting auto_score × 2)
       · kind: 'plus'     (evidence bonus · one per concrete signal)
       · kind: 'minus'    (deduction · one per signal)
       · kind: 'final'    (last row · resulting score.current)
     Keep each label short (≤ 80 chars · human-readable · no jargon).
     Include an "evidence" one-liner citing the exact file/metric where useful.
     Example (always 1 baseline + 1 final, plus/minus in between):
       [{kind:'baseline', points:66, label:'Auto baseline'},
        {kind:'plus',  points:+4, label:'RLS enforced on all write tables',
                       evidence:'15/15 RLS policies found in supabase/migrations'},
        {kind:'plus',  points:+3, label:'End-to-end Stripe integration',
                       evidence:'checkout.ts + webhook handler + customer portal'},
        {kind:'minus', points:-5, label:'Best Practices audit failed to run',
                       evidence:'PageSpeed returned null for the BP category'},
        {kind:'final', points:68, label:'Score.current'}]
  7) score.delta_reasoning is a short PROSE summary (1-3 sentences · human tone)
     that complements the breakdown ledger, not duplicates it. It narrates the
     story — "Round 2: this Creator shipped auth + RLS, so Security climbed from
     58 → 74. Lighthouse Best Practices still failing to run blocks a 75+ score."
- score.previous_estimate: for re-analysis, copy previous_snapshot.score_total verbatim; for initial snapshot, equal to score.current.
- headline_metrics: 3-4 items like "Tech Layers: 5", "Smart Contracts: 6 (Base mainnet)", "Serverless Functions: 80+". No brand names.
- axis_scores: at least 5 axes (e.g. Infrastructure Design · AI Orchestration · Code Execution · Web3/Blockchain · Security · Product Completeness). Pick color_hint to match the axis character. For re-analysis: previous = prior axis score when available (else null), delta_label = "+N"/"-N"/"-"/"NEW". For initial: previous = null, delta_label = "NEW" for every axis.
- github_findings: 3-6 items. Each finding must cite a concrete number tied to source evidence.
- open_questions: 1-3 items. Frame as "cannot verify" / "evidence gap", not defects.
- honest_evaluation: 3-5 paragraphs in American English. For initial snapshot: a fresh assessment of what the project is today, without "before vs after" framing. For re-analysis: anchor on "since the last snapshot on {previous_snapshot.created_at}, these are the material changes..." and reference specific new commits, axes that moved, and regressions.

OUTPUT SHAPE
{
  "tldr": "...",
  "headline": "...",
  "role_title": { "previous": "...", "current": "...", "reasoning": "..." },
  "score": { "previous_estimate": 83, "current": 93, "delta_reasoning": "...", "breakdown": [ { "kind": "baseline", "points": 66, "label": "Auto baseline" }, { "kind": "plus", "points": 4, "label": "RLS on all write tables", "evidence": "..." }, { "kind": "minus", "points": -5, "label": "BP audit failed", "evidence": "..." }, { "kind": "final", "points": 65, "label": "Score.current" } ] },
  "headline_metrics": [ { "label": "...", "value": "...", "sublabel": "..." } ],
  "axis_scores": [ { "axis": "...", "current": 92, "previous": 82, "delta_label": "+10", "color_hint": "blue" } ],
  "github_findings": [ { "title": "...", "detail": "...", "accent": "green" } ],
  "open_questions": [ { "title": "...", "detail": "..." } ],
  "honest_evaluation": "...",
  "scout_brief": {
    "strengths":  [ { "axis": "Security", "bullet": "RLS policies on every state-changing table ..." } ],
    "weaknesses": [ { "axis": "Code",     "bullet": "No tests in repo; 80+ Edge Functions untested ..." } ]
  }${includeExpertPanel ? `,
  "expert_panel": [
    { "role": "staff_engineer",   "display_name": "Staff Engineer",   "verdict_label": "iterate", "verdict_summary": "...", "top_strength": "...", "top_issue": "...", "confidence": 7 },
    { "role": "security_officer", "display_name": "Security Officer", "verdict_label": "block",   "verdict_summary": "...", "top_strength": "...", "top_issue": "...", "confidence": 8 },
    { "role": "designer",         "display_name": "Designer",         "verdict_label": "ship",    "verdict_summary": "...", "top_strength": "...", "top_issue": "...", "confidence": 6 },
    { "role": "ceo",              "display_name": "CEO",              "verdict_label": "iterate", "verdict_summary": "...", "top_strength": "...", "top_issue": "...", "confidence": 7 }
  ]` : ''}
}`

  // Use tool_use to force strict JSON output. Claude reliably emits well-formed
  // tool inputs, which avoids the JSON-in-text escape nightmare.
  const analysisTool = {
    name: 'output_analysis',
    description: 'Emit the full structured multi-axis analysis of this vibe-coded project.',
    input_schema: {
      type: 'object',
      required: ['tldr', 'headline', 'role_title', 'score', 'headline_metrics',
                 'axis_scores', 'github_findings', 'open_questions', 'honest_evaluation',
                 'tampering_signals', 'scout_brief',
                 ...(includeExpertPanel ? ['expert_panel'] : [])],
      properties: {
        tldr: { type: 'string' },
        headline: { type: 'string' },
        role_title: {
          type: 'object',
          required: ['previous', 'current', 'reasoning'],
          properties: {
            previous:  { type: 'string' },
            current:   { type: 'string' },
            reasoning: { type: 'string' },
          },
        },
        score: {
          type: 'object',
          required: ['previous_estimate', 'current', 'delta_reasoning', 'breakdown'],
          properties: {
            previous_estimate: { type: 'number', minimum: 0, maximum: 100 },
            current:           { type: 'number', minimum: 0, maximum: 100 },
            delta_reasoning:   { type: 'string' },
            breakdown: {
              type: 'array', minItems: 3, maxItems: 12,
              items: {
                type: 'object', required: ['kind', 'points', 'label'],
                properties: {
                  kind:     { enum: ['baseline', 'plus', 'minus', 'final'] },
                  points:   { type: 'integer', minimum: -40, maximum: 100 },
                  label:    { type: 'string', minLength: 4, maxLength: 100 },
                  evidence: { type: 'string', maxLength: 200 },
                },
              },
            },
          },
        },
        headline_metrics: {
          type: 'array', minItems: 2, maxItems: 6,
          items: {
            type: 'object', required: ['label', 'value', 'sublabel'],
            properties: {
              label:    { type: 'string' },
              value:    { type: 'string' },
              sublabel: { type: 'string' },
            },
          },
        },
        axis_scores: {
          type: 'array', minItems: 4, maxItems: 8,
          items: {
            type: 'object',
            required: ['axis', 'current', 'previous', 'delta_label', 'color_hint'],
            properties: {
              axis:        { type: 'string' },
              current:     { type: 'number', minimum: 0, maximum: 100 },
              previous:    { type: ['number', 'null'] },
              delta_label: { type: 'string' },
              color_hint:  { enum: ['blue', 'indigo', 'green', 'emerald', 'pink', 'amber', 'rose'] },
            },
          },
        },
        github_findings: {
          type: 'array', minItems: 3, maxItems: 8,
          items: {
            type: 'object', required: ['title', 'detail', 'accent'],
            properties: {
              title:  { type: 'string' },
              detail: { type: 'string' },
              accent: { enum: ['green', 'indigo', 'blue', 'amber', 'rose'] },
            },
          },
        },
        open_questions: {
          type: 'array', minItems: 1, maxItems: 4,
          items: {
            type: 'object', required: ['title', 'detail'],
            properties: {
              title:  { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
        honest_evaluation: { type: 'string', minLength: 200 },
        tampering_signals: {
          type: 'array', minItems: 0, maxItems: 10,
          items: {
            type: 'object', required: ['severity', 'signal', 'detail'],
            properties: {
              severity: { enum: ['low', 'medium', 'high'] },
              signal:   { type: 'string', minLength: 3 },
              detail:   { type: 'string', minLength: 10 },
            },
          },
        },
        scout_brief: {
          type: 'object',
          required: ['strengths', 'weaknesses'],
          properties: {
            strengths: {
              type: 'array', minItems: 5, maxItems: 5,
              items: {
                type: 'object', required: ['axis', 'bullet'],
                properties: {
                  axis:   { enum: ['Security', 'Infrastructure', 'Code', 'UX', 'Product', 'Web3', 'Ops', 'AI'] },
                  bullet: { type: 'string', minLength: 15, maxLength: 140 },
                },
              },
            },
            weaknesses: {
              type: 'array', minItems: 5, maxItems: 5,
              items: {
                type: 'object', required: ['axis', 'bullet'],
                properties: {
                  axis:   { enum: ['Security', 'Infrastructure', 'Code', 'UX', 'Product', 'Web3', 'Ops', 'AI'] },
                  bullet: { type: 'string', minLength: 15, maxLength: 140 },
                },
              },
            },
          },
        },
        ...(includeExpertPanel ? {
          expert_panel: {
            type: 'array', minItems: 4, maxItems: 4,
            items: {
              type: 'object',
              required: ['role', 'display_name', 'verdict_label', 'verdict_summary', 'top_strength', 'top_issue', 'confidence'],
              properties: {
                role:            { enum: ['staff_engineer', 'security_officer', 'designer', 'ceo'] },
                display_name:    { type: 'string' },
                verdict_label:   { enum: ['ship', 'iterate', 'block'] },
                verdict_summary: { type: 'string', minLength: 30, maxLength: 240 },
                top_strength:    { type: 'string', minLength: 15, maxLength: 200 },
                top_issue:       { type: 'string', minLength: 15, maxLength: 200 },
                confidence:      { type: 'integer', minimum: 0, maximum: 10 },
              },
            },
          },
        } : {}),
      },
    },
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: includeExpertPanel ? 5600 : 4500,
        system: systemPrompt,
        tools: [analysisTool],
        tool_choice: { type: 'tool', name: 'output_analysis' },
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('Claude error', res.status, errText)
      // Map Anthropic-specific error types so the CLI / web can show a
      // friendly message instead of generic "http 429". The shapes come
      // straight from Anthropic's own error envelope:
      //   { type: 'error', error: { type: 'rate_limit_error' | 'billing_error'
      //                              | 'overloaded_error' | 'permission_error'
      //                              | 'invalid_request_error', message } }
      let parsedType: string | null = null
      let parsedMsg:  string = errText.slice(0, 240)
      try {
        const j = JSON.parse(errText)
        parsedType = j?.error?.type ?? null
        parsedMsg  = j?.error?.message ?? parsedMsg
      } catch { /* keep raw text */ }

      const errorClass =
        parsedType === 'billing_error'      ? 'anthropic_quota_exceeded' :
        parsedType === 'rate_limit_error'   ? 'anthropic_rate_limited'   :
        parsedType === 'overloaded_error'   ? 'anthropic_overloaded'     :
        parsedType === 'permission_error'   ? 'anthropic_auth_error'     :
        res.status === 429                  ? 'anthropic_rate_limited'   :
        res.status === 529                  ? 'anthropic_overloaded'     :
        res.status === 400 && /(quota|credit|balance|monthly\s*limit)/i.test(parsedMsg)
                                            ? 'anthropic_quota_exceeded' :
        'anthropic_other'

      const retryAfter = Number(res.headers.get('retry-after') || 0) || null

      return {
        ...RICH_ANALYSIS_FALLBACK,
        error: {
          type:                errorClass,
          http_status:         res.status,
          anthropic_error_type: parsedType,
          message:             parsedMsg,
          retry_after_seconds: retryAfter,
        },
      } as RichAnalysis
    }
    const data = await res.json()
    const block = (data.content || []).find((b: any) => b.type === 'tool_use')
    if (!block?.input) {
      return {
        ...RICH_ANALYSIS_FALLBACK,
        error: { type: 'claude_returned_no_data', message: 'Claude returned no tool_use block' },
      } as RichAnalysis
    }
    return { ...RICH_ANALYSIS_FALLBACK, ...block.input } as RichAnalysis
  } catch (e) {
    console.error('Claude fetch failed', e)
    return {
      ...RICH_ANALYSIS_FALLBACK,
      error: { type: 'network_error', message: String(e).slice(0, 240) },
    } as RichAnalysis
  }
}

// ── v1.4 §15.6 MD Discovery ─────────────────────────────────────
// Scan the candidate MD files captured during inspectGitHub, score each on
// four axes via a single Claude tool_use call, and return library-worthy items
// (≥2 of 4 axes at ≥7). Cost cap: at most 12 files, each truncated to 6KB of body.

interface MDDiscoveryItem {
  file_path: string
  sha: string | null
  scores: { iter_depth: number; prod_anchor: number; token_saving: number; distilled: number }
  suggested_category: 'Scaffold' | 'Prompt Library' | 'MCP Config' | 'Project Rules' | 'Backend' | 'Auth/Payment' | 'Playbooks'
  suggested_title: string
  suggested_description: string
  excerpt: string
  library_worthy: boolean
}

const MD_DISCOVERY_FILE_CAP = 12
const MD_DISCOVERY_BODY_CAP = 6000   // chars per file sent to Claude

async function runMDDiscovery(params: {
  candidates: Array<{ path: string; sha: string | null }>
  githubUrl: string
  defaultBranch?: string
  claudeKey: string
}): Promise<MDDiscoveryItem[]> {
  const { candidates, githubUrl, claudeKey } = params
  if (!claudeKey || candidates.length === 0) return []

  const m = githubUrl.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i)
  if (!m) return []
  const owner = m[1], repo = m[2].replace(/\.git$/, '')
  const defBranch = params.defaultBranch || 'HEAD'
  const token = Deno.env.get('GITHUB_TOKEN')
  const headers: Record<string, string> = { 'User-Agent': 'commit.show-analyzer' }
  if (token) headers.Authorization = `Bearer ${token}`

  const topCandidates = candidates.slice(0, MD_DISCOVERY_FILE_CAP)

  // Fetch raw contents in parallel.
  const filesWithContent = await Promise.all(
    topCandidates.map(async c => {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${defBranch}/${encodeURI(c.path)}`,
          { headers },
        )
        if (!res.ok) return null
        const body = await res.text()
        return { path: c.path, sha: c.sha, body: body.slice(0, MD_DISCOVERY_BODY_CAP) }
      } catch { return null }
    }),
  )
  const files = filesWithContent.filter((f): f is { path: string; sha: string | null; body: string } => !!f && !!f.body?.trim())
  if (files.length === 0) return []

  const tool = {
    name: 'score_md_candidates',
    description: 'Score each candidate MD file on four axes and suggest library metadata.',
    input_schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file_path', 'scores', 'suggested_category', 'suggested_title', 'suggested_description'],
            properties: {
              file_path: { type: 'string' },
              scores: {
                type: 'object',
                required: ['iter_depth', 'prod_anchor', 'token_saving', 'distilled'],
                properties: {
                  iter_depth:   { type: 'integer', minimum: 0, maximum: 10 },
                  prod_anchor:  { type: 'integer', minimum: 0, maximum: 10 },
                  token_saving: { type: 'integer', minimum: 0, maximum: 10 },
                  distilled:    { type: 'integer', minimum: 0, maximum: 10 },
                },
              },
              suggested_category: {
                type: 'string',
                enum: ['Scaffold', 'Prompt Library', 'MCP Config', 'Project Rules', 'Backend', 'Auth/Payment', 'Playbooks'],
              },
              suggested_title: { type: 'string', maxLength: 80 },
              suggested_description: { type: 'string', maxLength: 280 },
            },
          },
        },
      },
    },
  }

  const system = `You evaluate Markdown files in a codebase to decide whether each is "library-worthy" for a knowledge marketplace (commit.show MD Library).

Score each file 0-10 on FOUR axes:
- iter_depth: Does the doc show real iteration — failures, v2-after-X notes, "breaking change", debug stories, lessons learned? 10 = multiple concrete iteration cycles documented. 0 = zero failure evidence / pristine marketing prose.
- prod_anchor: Does the doc tie claims to real production evidence — deploy URLs, contract addresses, measured numbers ("tested with 5k users"), real SDK versions? 10 = anchored throughout. 0 = abstract only.
- token_saving: Are rules / constraints / gotchas / do-don't blocks written so a reader making a decision SAVES time? 10 = dense rule-set that lets another team skip hours of trial-and-error. 0 = narrative that requires reading end-to-end.
- distilled: Compression / information density. CLAUDE.md / RULES.md style (every line pulls weight). 10 = ruthlessly distilled. 0 = bloated or template filler.

Rules:
- Do NOT name any AI coding tool brand (Cursor, Lovable, Claude Code, v0, Bolt, Windsurf). Describe capabilities only.
- Write suggested_title and suggested_description in American English. No Korean.
- suggested_category must map to what a buyer would look for. Examples:
  - CLAUDE.md / RULES.md / CONVENTIONS.md → "Project Rules"
  - prompts / cursor-rules → "Prompt Library"
  - mcp.json / MCP server configs → "MCP Config"
  - schema.md / API design / backend patterns → "Backend"
  - stripe-*.md / auth-*.md → "Auth/Payment"
  - full app blueprints / scaffold docs → "Scaffold"
  - scenario / playbook / runbook / guide → "Playbooks"
- Base every score strictly on the file content provided. Do not invent claims about files you have not seen.

Return ONE tool call containing an "items" array with ONE object per input file.`

  const userMsg = files.map((f, i) => `=== FILE ${i + 1}: ${f.path} ===\n${f.body}`).join('\n\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'score_md_candidates' },
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    if (!res.ok) {
      console.error('Discovery Claude error', res.status, await res.text())
      return []
    }
    const data = await res.json()
    const block = (data.content || []).find((b: any) => b.type === 'tool_use')
    const items: Array<{
      file_path: string
      scores: { iter_depth: number; prod_anchor: number; token_saving: number; distilled: number }
      suggested_category: MDDiscoveryItem['suggested_category']
      suggested_title: string
      suggested_description: string
    }> = block?.input?.items ?? []

    return items.map(it => {
      const match = files.find(f => f.path === it.file_path)
      const s = it.scores
      const axesOverThreshold = [s.iter_depth, s.prod_anchor, s.token_saving, s.distilled].filter(v => v >= 7).length
      return {
        file_path: it.file_path,
        sha: match?.sha ?? null,
        scores: s,
        suggested_category: it.suggested_category,
        suggested_title: it.suggested_title,
        suggested_description: it.suggested_description,
        excerpt: (match?.body ?? '').slice(0, 500),
        library_worthy: axesOverThreshold >= 2,
      } satisfies MDDiscoveryItem
    })
  } catch (e) {
    console.error('Discovery call failed', e)
    return []
  }
}

// ── Main handler ──────────────────────────────────────────────
type TriggerType = 'initial' | 'resubmit' | 'applaud' | 'weekly' | 'season_end'
// Re-analysis cooldown window. Temporarily disabled for testing — flip back
// to `24 * 60 * 60 * 1000` (or a policy-driven value) before public launch.
const RESUBMIT_COOLDOWN_MS = 0  // TODO: 24h cooldown before public launch

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let payload: { project_id?: string; trigger_type?: TriggerType; triggered_by?: string }
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const projectId = payload.project_id
  if (!projectId) return json({ error: 'project_id required' }, 400)
  const triggerType: TriggerType = payload.trigger_type ?? 'initial'
  const triggeredBy = payload.triggered_by ?? null

  // Cooldown gate for creator-initiated re-runs
  if (triggerType === 'resubmit') {
    const { data: lastSnap } = await admin
      .from('analysis_snapshots')
      .select('created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSnap?.created_at) {
      const elapsed = Date.now() - new Date(lastSnap.created_at).getTime()
      if (elapsed < RESUBMIT_COOLDOWN_MS) {
        const hoursRemaining = Math.ceil((RESUBMIT_COOLDOWN_MS - elapsed) / 3600000)
        return json({
          error: 'cooldown',
          message: `Re-analysis available in ${hoursRemaining}h. Cooldown prevents spam.`,
          retry_after_hours: hoursRemaining,
        }, 429)
      }
    }
  }

  // Load project + brief
  const { data: project, error: projErr } = await admin
    .from('projects')
    .select('id, project_name, description, github_url, live_url, creator_id, status')
    .eq('id', projectId)
    .single()
  if (projErr || !project) return json({ error: 'project not found' }, 404)

  const { data: brief } = await admin
    .from('build_briefs').select('*').eq('project_id', projectId).maybeSingle()

  // Anonymous CLI previews never had a chance to fill the brief — penalising
  // them for missing Phase 2 sections is structurally unfair (the user never
  // saw the form). Tag the run so Claude can adjust its scoring rubric:
  // skip "tampering -10" + "Phase 2 missing" deductions, frame missing
  // sections as "not yet provided · audition to add" instead.
  const isCliPreview = project.status === 'preview' && !project.creator_id && !brief

  // Parallel external probes
  const [lh, gh, health, completeness] = await Promise.all([
    project.live_url ? runLighthouse(project.live_url) : Promise.resolve({ performance: 0, accessibility: 0, bestPractices: 0, seo: 0 }),
    project.github_url ? inspectGitHub(project.github_url) : Promise.resolve({ accessible: false, languages: {}, language_pct: {}, stars: 0, forks: 0, file_count_estimate: 0, last_commit_at: null }),
    project.live_url ? liveHealth(project.live_url) : Promise.resolve({ status: 0, ok: false, elapsed_ms: 0 }),
    project.live_url ? inspectCompleteness(project.live_url) : Promise.resolve({
      fetched: false,
      has_og_image: false, has_og_title: false, has_og_description: false,
      has_twitter_card: false, has_apple_touch: false, has_manifest: false,
      has_theme_color: false, has_favicon: false, has_canonical: false,
      has_meta_desc: false,
      score: 0, filled: 0, of: 10,
    }),
  ])

  // Score components
  const lhScore = scoreLighthouse(lh)
  const ghPts = gh.accessible ? 5 : 0
  const stackHints = [
    brief?.features ?? '',
    project.description ?? '',
  ].filter(Boolean) as string[]
  const tech = scoreTechLayers(gh.languages || {}, stackHints)
  const briefScore = scoreBriefIntegrity(brief ?? {})
  const healthPts = health.ok && health.elapsed_ms < 3000 ? 5 : 0

  const score_auto = lhScore.total + ghPts + tech.pts + briefScore.pts + healthPts

  // Fetch parent snapshot BEFORE Claude call — for re-analysis we want Claude
  // to frame deltas against the prior snapshot, not against the brief.
  const { data: parent } = await admin
    .from('analysis_snapshots')
    .select('id, created_at, score_total, axis_scores, rich_analysis, trigger_type')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Claude deep analysis — full evidence pack including structured Build Brief Phase 2.
  // Expert panel is an additive qualitative layer; only runs on triggers where
  // the ~30% extra tokens are worth it. Weekly and applaud triggers reuse the
  // last panel (if any) client-side, since panel content rarely swings week-to-week.
  const panelTriggers: Array<typeof triggerType> = ['initial', 'resubmit', 'season_end']
  const includeExpertPanel = panelTriggers.includes(triggerType)
  const claude = await callClaude({
    is_initial_snapshot: !parent,
    previous_snapshot: parent ? {
      created_at:   parent.created_at,
      score_total:  parent.score_total,
      axis_scores:  parent.axis_scores,
      trigger_type: parent.trigger_type,
      tldr:         (parent.rich_analysis as { tldr?: string } | null)?.tldr ?? null,
      role_title:   (parent.rich_analysis as { role_title?: { current?: string } } | null)?.role_title?.current ?? null,
    } : null,
    project: {
      name: project.project_name,
      description: project.description,
      live_url: project.live_url,
      github_url: project.github_url,
    },
    build_brief_phase_1: {
      problem:     brief?.problem,
      features:    brief?.features,
      target_user: brief?.target_user,
      completeness: `${briefScore.filled}/${briefScore.of}`,
    },
    build_brief_phase_2_pasted: {
      stack_fingerprint:    brief?.stack_fingerprint ?? null,
      failure_log:          brief?.failure_log ?? null,
      decision_archaeology: brief?.decision_archaeology ?? null,
      ai_delegation_map:    brief?.ai_delegation_map ?? null,
      live_proof:           brief?.live_proof ?? null,
      next_blocker:         brief?.next_blocker ?? null,
      integrity_score:      brief?.integrity_score ?? 0,
    },
    lighthouse: lh,
    live_url_health: health,
    completeness_signals: completeness,
    github: gh,
    scoring_so_far: {
      auto_50_breakdown: {
        lighthouse: lhScore,
        github_pts: ghPts,
        tech_pts: tech.pts,
        tech_layers_detected: tech.layers,
        brief_pts: briefScore.pts,
        health_pts: healthPts,
        total: score_auto,
      },
      polish_signals_0_to_5: completeness.score,
    },
    // True when the project was created via `npx commitshow audit` and the
    // creator hasn't run through the /submit brief flow. Claude must NOT
    // apply Phase-2-missing tampering penalties in this mode — the creator
    // never saw the form. See SCORE FORMATION rule 7 in the system prompt.
    is_cli_preview: isCliPreview,
    trigger_type: triggerType,
  }, { includeExpertPanel })

  // Weekly / applaud triggers didn't regenerate the panel — inherit the
  // previous snapshot's panel so the UI keeps rendering a Review Panel.
  // Panels drift slowly; the creator sees the most recent full review.
  if (!includeExpertPanel) {
    const inheritedPanel = (parent?.rich_analysis as { expert_panel?: unknown } | null)?.expert_panel
    if (Array.isArray(inheritedPanel) && inheritedPanel.length > 0) {
      (claude as RichAnalysis).expert_panel = inheritedPanel as RichAnalysis['expert_panel']
    }
  }

  // Prefer Claude's current score (evidence-weighted) but keep auto-50 as floor signal.
  const scoreTotal = claude.score?.current && claude.score.current > 0
    ? Math.round(claude.score.current)
    : score_auto

  // Axis-level delta
  const currentAxisMap: Record<string, number> = {}
  for (const ax of (claude.axis_scores ?? [])) {
    currentAxisMap[ax.axis] = ax.current
  }
  const deltaFromParent: Record<string, number> = {}
  if (parent?.axis_scores && typeof parent.axis_scores === 'object') {
    const prevMap = parent.axis_scores as Record<string, number>
    for (const [axis, curr] of Object.entries(currentAxisMap)) {
      if (typeof prevMap[axis] === 'number') {
        deltaFromParent[axis] = curr - prevMap[axis]
      }
    }
  }
  const scoreTotalDelta = parent ? scoreTotal - (parent.score_total ?? 0) : null

  const { data: snapshot, error: snapErr } = await admin.from('analysis_snapshots').insert([{
    project_id:         projectId,
    trigger_type:       triggerType,
    triggered_by:       triggeredBy,
    score_auto,
    score_forecast:     0,
    score_community:    0,
    score_total:        scoreTotal,
    axis_scores:        currentAxisMap,
    lighthouse:         lh,
    github_signals:     gh.signals,
    // Mix in the completeness signals so the snapshot is self-contained:
    // future reruns / UI ledgers can reference exactly what was checked.
    rich_analysis:      { ...claude, completeness_signals: completeness },
    parent_snapshot_id: parent?.id ?? null,
    delta_from_parent:  Object.keys(deltaFromParent).length ? deltaFromParent : null,
    score_total_delta:  scoreTotalDelta,
    commit_sha:         gh.head_commit_sha,
    brief_sha:          gh.debut_brief?.sha ?? null,
    model_version:      'claude-sonnet-4-5',
  }]).select('id').single()
  if (snapErr) console.error('snapshot insert failed', snapErr)

  // Update denormalized latest on projects
  await admin
    .from('projects')
    .update({
      lh_performance:    lh.performance,
      lh_accessibility:  lh.accessibility,
      lh_best_practices: lh.bestPractices,
      lh_seo:            lh.seo,
      github_accessible: gh.accessible,
      score_auto,
      score_total:       scoreTotal,
      tech_layers:       tech.layers,
      verdict:           claude.tldr || claude.headline || '',
      claude_insight:    claude.honest_evaluation || '',
      unlock_level:      0,
      last_analysis_at:  new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    })
    .eq('id', projectId)

  // MD Discovery moved to a dedicated Edge Function (discover-mds) so this
  // handler finishes under the 150s idle timeout. Client invokes it after
  // analyze-project returns successfully; see src/lib/mdDiscovery.ts.

  return json({
    ok: true,
    snapshot_id: snapshot?.id ?? null,
    trigger_type: triggerType,
    score_auto,
    score_total: scoreTotal,
    score_total_delta: scoreTotalDelta,
    delta_from_parent: Object.keys(deltaFromParent).length ? deltaFromParent : null,
    breakdown: {
      lighthouse: lhScore,
      github_pts: ghPts,
      tech: { pts: tech.pts, layers: tech.layers },
      brief: briefScore,
      health_pts: healthPts,
    },
    lh,
    github: gh,
    rich: claude,
    claude_error: (claude as any).error ?? null,
    health,
  })
})
