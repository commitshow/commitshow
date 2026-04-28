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

async function runLighthouse(url: string, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<LighthouseScores> {
  const key = Deno.env.get('PAGESPEED_API_KEY')
  // PageSpeed Insights v5 runs ONLY the Performance category unless each other
  // category is explicitly requested. Without these params the other three
  // scores come back as null and render as 0.
  const params = new URLSearchParams({ url, strategy })
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
  homepage?: string | null             // GitHub homepage field (used for live_url inference)
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
  contributors_count: number           // ecosystem signal · approx (capped at 100)
  // Form factor — determines weight emphasis (apps weight Lighthouse, libraries
  // weight ecosystem + tests, scaffolds weight reproducibility).
  form_factor: 'app' | 'library' | 'scaffold' | 'unknown'
  // npm registry signals · libraries only (null elsewhere)
  npm: {
    package_name:        string | null   // resolved from package.json `name`
    weekly_downloads:    number | null   // last-week downloads
    has_published:       boolean         // do we even see this on npm
  }
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
    // ── Production maturity signals (NEW · v2 scoring) ──
    ci_workflows: number                 // .github/workflows/*.yml count
    has_ci_config: boolean               // any of: GH actions, gitlab-ci, circleci, vercel.json
    has_lockfile: boolean
    lockfile_kind: 'npm' | 'yarn' | 'pnpm' | 'bun' | null
    observability_libs: string[]         // sentry, datadog, pino, winston, otel, etc.
    has_typescript_strict: boolean       // tsconfig.json compilerOptions.strict === true
    typescript_pct: number               // % bytes that are TS (from language_pct)
    has_license: boolean
    has_contributing: boolean
    has_changelog: boolean
    has_code_of_conduct: boolean
    is_monorepo: boolean                 // workspaces / turbo.json / pnpm-workspace.yaml
    app_root: string                     // detected sub-folder app root ('' when at repo root)
    // ── Responsive design signals (NEW · v3 mobile audit) ──
    tailwind_responsive_count: number    // count of `sm:` `md:` `lg:` `xl:` `2xl:` prefixes
    tailwind_class_total:      number    // total class occurrences sampled (denominator)
    css_media_query_count:     number    // @media in scanned .css files
    has_overflow_x_hidden:     boolean   // body { overflow-x: hidden } in any .css
    has_prefers_dark:          boolean   // @media (prefers-color-scheme: dark) anywhere
    has_prefers_reduced_motion: boolean  // @media (prefers-reduced-motion) anywhere
    // ── Tier-1 completeness checks (NEW · v4) ──
    env_committed:        boolean        // .env / .env.production etc in repo (security violation)
    releases_count:       number         // GitHub Releases tags published
    readme_depth_score:   number         // 0-2 derived from line count + key sections
    readme_line_count:    number         // raw line count of README
    has_readme_install:   boolean        // README has "Installation" / "Install" section
    has_readme_usage:     boolean        // README has "Usage" / "Getting Started" / "Quick Start"
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

// Production-maturity signals — error tracking, structured logging, OTel.
// Prefix-match (e.g. '@sentry/' catches @sentry/node + @sentry/react).
const OBSERVABILITY_LIBS = [
  '@sentry/', 'sentry-', 'datadog-', '@datadog/', 'dd-trace',
  'pino', 'winston', 'bunyan', 'log4js',
  '@opentelemetry/', 'honeybadger', 'rollbar', 'bugsnag',
  '@logtail/', '@axiomhq/', 'newrelic', '@logdna/',
]

// Form factor — picks scoring emphasis. Apps are scored on live deployment
// (Lighthouse heavy); libraries on tests + ecosystem reach; scaffolds on
// reproducibility (clear setup, env templates, runnable). Detection is
// conservative — when ambiguous we return 'unknown' so Claude reasons it out
// from context rather than us forcing a wrong frame.
function detectFormFactor(
  pkg: Record<string, unknown> | null,
  paths: string[],
  readme: string | null,
): 'app' | 'library' | 'scaffold' | 'unknown' {
  const pathSet = new Set(paths)
  const readmeHead = (readme ?? '').toLowerCase().slice(0, 3000)
  const name = typeof pkg?.name === 'string' ? (pkg.name as string) : ''
  const isPrivate = pkg?.private === true
  const hasMain    = !!(pkg && (pkg as { main?: unknown }).main)
  const hasModule  = !!(pkg && (pkg as { module?: unknown }).module)
  const hasExports = !!(pkg && (pkg as { exports?: unknown }).exports)
  const hasBin     = !!(pkg && (pkg as { bin?: unknown }).bin)
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>
  const hasDevStart = !!(scripts.dev || scripts.start)

  // Scaffold indicators (highest priority — they often look like libraries)
  const scaffoldName = /^(create-|@.+\/create-)/.test(name) || /\b(starter|template|boilerplate|scaffold|kit)\b/i.test(name)
  const scaffoldReadme = /(use this template|getting started.+(fork|clone|copy this)|click .?use this template)/i.test(readmeHead)
  if (scaffoldName || scaffoldReadme) return 'scaffold'

  // Library indicators · publishable + monorepo + npm-install-style README
  const monorepo = pathSet.has('turbo.json') || pathSet.has('pnpm-workspace.yaml') ||
    !!(pkg && (pkg as { workspaces?: unknown }).workspaces) ||
    paths.some(p => /^packages\/[^/]+\/package\.json$/.test(p))
  const npmInstallExample = /\b(npm i\s+|yarn add\s+|pnpm add\s+|bun add\s+)\S/.test(readmeHead)
  const libIndicators = [
    !isPrivate && (hasMain || hasModule || hasExports),
    monorepo && paths.some(p => /^packages\//.test(p)),
    npmInstallExample,
    hasBin && npmInstallExample,
  ].filter(Boolean).length
  if (libIndicators >= 2) return 'library'

  // App indicators · runnable + deployment configs
  const deployConfig =
    pathSet.has('vercel.json') || pathSet.has('netlify.toml') ||
    pathSet.has('wrangler.toml') || pathSet.has('wrangler.jsonc') ||
    pathSet.has('railway.json') || pathSet.has('fly.toml') ||
    paths.some(p => /^next\.config\.(js|mjs|ts|cjs)$/.test(p)) ||
    paths.some(p => /^vite\.config\.(js|mjs|ts|cjs)$/.test(p))
  if (hasDevStart || deployConfig) return 'app'

  return 'unknown'
}

// npm registry download lookup — last-week count. Returns null if package
// isn't published / API failed.
async function fetchNpmWeeklyDownloads(pkg: string | null): Promise<number | null> {
  if (!pkg) return null
  try {
    const safeName = encodeURIComponent(pkg)
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${safeName}`)
    if (!res.ok) return null
    const j = await res.json()
    return typeof j.downloads === 'number' ? j.downloads : null
  } catch {
    return null
  }
}

async function inspectGitHub(url: string): Promise<GitHubInfo> {
  const empty: GitHubInfo = {
    accessible: false, languages: {}, language_pct: {},
    stars: 0, forks: 0, open_issues: 0, commit_count_recent: 0,
    head_commit_sha: null,
    file_count_estimate: 0, last_commit_at: null, created_at: null,
    homepage: null,
    contributors_count: 0,
    form_factor: 'unknown',
    npm: { package_name: null, weekly_downloads: null, has_published: false },
    signals: {
      solidity_files: 0, edge_functions: 0, sql_files: 0, create_table_count: 0,
      react_components: 0, page_files: 0, mcp_server_files: 0,
      has_claude_md: false, has_prd_docs: false, has_rls_policies: false, rls_policy_count: 0,
      test_files: 0, uses_web3_libs: [], uses_ai_libs: [], uses_mcp_libs: [],
      package_deps_count: 0,
      ci_workflows: 0, has_ci_config: false,
      has_lockfile: false, lockfile_kind: null,
      observability_libs: [],
      has_typescript_strict: false, typescript_pct: 0,
      has_license: false, has_contributing: false, has_changelog: false, has_code_of_conduct: false,
      is_monorepo: false,
      app_root: '',
      tailwind_responsive_count: 0, tailwind_class_total: 0,
      css_media_query_count: 0,
      has_overflow_x_hidden: false,
      has_prefers_dark: false,
      has_prefers_reduced_motion: false,
      env_committed: false,
      releases_count: 0,
      readme_depth_score: 0,
      readme_line_count: 0,
      has_readme_install: false,
      has_readme_usage: false,
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

  // ── Monorepo / subfolder app root detection ──
  // Many vibe-coded projects live in a sub-folder (e.g. `website/`, `apps/web/`)
  // while CI · LICENSE · README stay at repo root. If there's no root
  // package.json, find the most likely "app root" so subsequent path probes
  // (package.json · tsconfig.json · lockfile) hit the real app instead of
  // returning 404 and dragging the score to the floor. Common subfolder
  // names ranked by convention.
  const _earlyPathSet = new Set(paths)
  const APP_ROOT_PREFERENCE = [
    'website', 'web', 'app', 'apps/web', 'apps/website', 'apps/app',
    'frontend', 'client', 'site', 'packages/web', 'packages/app',
  ]
  let app_root = ''
  if (!_earlyPathSet.has('package.json')) {
    // Candidates = any folder (1 or 2 levels deep) containing package.json.
    const candidates = new Set<string>()
    for (const p of paths) {
      const m1 = p.match(/^([^/]+)\/package\.json$/)
      const m2 = p.match(/^([^/]+\/[^/]+)\/package\.json$/)
      if (m1) candidates.add(m1[1])
      if (m2) candidates.add(m2[1])
    }
    app_root = APP_ROOT_PREFERENCE.find(n => candidates.has(n))
              ?? [...candidates][0]
              ?? ''
  }
  // Prefix used for subsequent /contents/ probes. Empty string → root.
  const appPrefix = app_root ? `${app_root}/` : ''

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

  // Parse package.json for deps + production-maturity signals
  let web3Libs: string[] = [], aiLibs: string[] = [], mcpLibs: string[] = [], depsCount = 0
  let observabilityLibs: string[] = []
  let pkgParsed: Record<string, unknown> | null = null
  let pkgName: string | null = null
  const pkgText = await ghText(`/contents/${appPrefix}package.json?ref=${defBranch}`)
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText)
      pkgParsed = pkg
      pkgName = typeof pkg.name === 'string' ? pkg.name : null
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>
      depsCount = Object.keys(all).length
      web3Libs = WEB3_LIBS.filter(l => l in all || Object.keys(all).some(k => k.startsWith(l)))
      aiLibs   = AI_LIBS.filter(l => l in all || Object.keys(all).some(k => k.startsWith(l)))
      mcpLibs  = MCP_LIBS.filter(l => Object.keys(all).some(k => k === l || k.startsWith('@modelcontextprotocol/')))
      // Observability — error tracking / structured logging / OTel.
      observabilityLibs = OBSERVABILITY_LIBS.filter(prefix =>
        Object.keys(all).some(k => k === prefix || k.startsWith(prefix))
      )
    } catch { /* ignore */ }
  }

  // CI / lockfile / governance signals (root-file presence checks · free)
  const pathSet = new Set(paths)
  const ciWorkflowFiles = paths.filter(p => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p))
  const ci_workflows = ciWorkflowFiles.length
  const has_ci_config = ci_workflows > 0
    || pathSet.has('.gitlab-ci.yml')
    || paths.some(p => /^\.circleci\/config\.ya?ml$/.test(p))
    || pathSet.has('vercel.json')           // Vercel auto-checks count as CI signal
    || pathSet.has('netlify.toml')

  const LOCKFILE_MAP: Record<string, 'npm' | 'yarn' | 'pnpm' | 'bun'> = {
    'package-lock.json': 'npm',
    'yarn.lock':         'yarn',
    'pnpm-lock.yaml':    'pnpm',
    'bun.lockb':         'bun',
    'bun.lock':          'bun',
  }
  let lockfile_kind: 'npm' | 'yarn' | 'pnpm' | 'bun' | null = null
  for (const [file, kind] of Object.entries(LOCKFILE_MAP)) {
    // Accept lockfile at root OR at the detected app root (monorepos).
    if (pathSet.has(file) || (appPrefix && pathSet.has(`${appPrefix}${file}`))) {
      lockfile_kind = kind; break
    }
  }
  const has_lockfile = !!lockfile_kind

  const has_license          = paths.some(p => /^LICENSE(\.[a-zA-Z0-9]+)?$/i.test(p))
  const has_contributing     = paths.some(p => /^CONTRIBUTING\.md$/i.test(p))
  const has_changelog        = paths.some(p => /^CHANGELOG\.md$/i.test(p))
  const has_code_of_conduct  = paths.some(p => /^CODE_OF_CONDUCT\.md$/i.test(p))

  // Monorepo signal — workspaces declared OR turbo/pnpm workspace files OR
  // packages/* presence with a /package.json under it.
  const is_monorepo =
    !!(pkgParsed && (pkgParsed as { workspaces?: unknown }).workspaces) ||
    pathSet.has('turbo.json') ||
    pathSet.has('pnpm-workspace.yaml') ||
    paths.some(p => /^packages\/[^/]+\/package\.json$/.test(p)) ||
    paths.some(p => /^apps\/[^/]+\/package\.json$/.test(p))

  // TypeScript strict mode (strip line/block comments before JSON.parse —
  // tsconfig.json officially supports comments).
  let has_typescript_strict = false
  const tsconfigText = await ghText(`/contents/${appPrefix}tsconfig.json?ref=${defBranch}`)
  if (tsconfigText) {
    try {
      const stripped = tsconfigText
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1)
      const cfg = JSON.parse(stripped)
      has_typescript_strict = cfg?.compilerOptions?.strict === true
    } catch { /* tolerate non-standard tsconfig */ }
  }
  const typescript_pct = (language_pct['TypeScript'] as number | undefined) ?? 0

  // README excerpt for Claude context (loaded BEFORE form_factor detection
  // so the README-based heuristics like "Use this template" can fire).
  const readmeRaw = await ghText(`/readme`)
  const readme_excerpt = readmeRaw ? readmeRaw.slice(0, 2000) : null

  // Form factor — drives Claude's commentary weight (apps care about
  // Lighthouse, libraries care about ecosystem + reach, scaffolds care
  // about reproducibility).
  const form_factor = detectFormFactor(pkgParsed, paths, readmeRaw)

  // Responsive design signals — sample CSS + TSX files for mobile-aware
  // patterns. We don't load every file (budget), just the most likely
  // ones (root index.css, tailwind.config, plus 3-5 random component
  // files for class-name density).
  let css_media_query_count = 0
  let has_overflow_x_hidden = false
  let has_prefers_dark = false
  let has_prefers_reduced_motion = false
  let tailwind_responsive_count = 0
  let tailwind_class_total = 0

  const cssCandidates = paths.filter(p =>
    /\.(css|scss|sass|less)$/i.test(p) && !p.includes('node_modules') && !p.startsWith('dist/')
  ).slice(0, 6)
  for (const cssPath of cssCandidates) {
    const text = await ghText(`/contents/${encodeURI(cssPath)}?ref=${defBranch}`)
    if (!text) continue
    const mediaMatches = text.match(/@media\s*[^{]+\{/gi) || []
    css_media_query_count += mediaMatches.length
    if (/overflow[-:]?x\s*:\s*hidden/i.test(text)) has_overflow_x_hidden = true
    if (/prefers-color-scheme\s*:\s*dark/i.test(text)) has_prefers_dark = true
    if (/prefers-reduced-motion/i.test(text)) has_prefers_reduced_motion = true
  }

  // Tailwind responsive prefix density · sample first 5 TSX/JSX files in
  // src/components or app/. Cheap signal — we only want a ratio, not all.
  const componentCandidates = paths.filter(p =>
    /\.(tsx|jsx)$/i.test(p) &&
    /^(src\/components|src\/pages|app|components|pages)\//.test(p) &&
    !p.includes('node_modules')
  ).slice(0, 5)
  for (const cmpPath of componentCandidates) {
    const text = await ghText(`/contents/${encodeURI(cmpPath)}?ref=${defBranch}`)
    if (!text) continue
    // Count any `sm:`, `md:`, `lg:`, `xl:`, `2xl:` Tailwind responsive prefix.
    // Match in className attributes (rough — we don't AST parse here).
    const responsiveMatches = text.match(/\b(sm|md|lg|xl|2xl):[a-z][a-z0-9-]/gi) || []
    tailwind_responsive_count += responsiveMatches.length
    // Total class-attribute occurrences as denominator (very rough).
    const allMatches = text.match(/className\s*=\s*[`"'{][^`"'}]+/g) || []
    let totalTokens = 0
    for (const block of allMatches) totalTokens += (block.match(/\S+/g)?.length ?? 0)
    tailwind_class_total += totalTokens
  }

  // Ecosystem signals · contributors + npm downloads + release count.
  // All three are extra fetches; we run them in parallel so they don't
  // dominate total inspection time. All fail gracefully (return 0/null).
  const [contributorsResp, weeklyDownloads, releasesResp] = await Promise.all([
    gh('/contributors?per_page=100&anon=1'),
    fetchNpmWeeklyDownloads(pkgName),
    gh('/releases?per_page=30'),
  ])
  const contributors_count = Array.isArray(contributorsResp) ? contributorsResp.length : 0
  const releases_count     = Array.isArray(releasesResp) ? releasesResp.length : 0

  // ── Security violation · committed .env file ──
  // Excludes .env.example / .env.template / .env.sample (those are docs).
  const env_committed = paths.some(p => /(^|\/)\.env(\.[a-z0-9]+)?$/i.test(p) &&
    !/(\.env\.(example|sample|template|local\.example|defaults)|\.env\.tpl)$/i.test(p))

  // ── README depth analysis ── (uses readmeRaw already fetched above)
  const readmeFull = readmeRaw ?? ''
  const readme_line_count = readmeFull.split('\n').length
  // Match common section headers (markdown # / ## / ### + keywords).
  const has_readme_install = /(^|\n)#{1,3}\s*(install|installation|setup|getting started|quick start)/i.test(readmeFull)
  const has_readme_usage   = /(^|\n)#{1,3}\s*(usage|usage example|examples?|how to use|api)/i.test(readmeFull)
  // Depth score 0-2: 1 for substantial length (≥80 lines), +1 for both key sections.
  const readme_depth_score =
    (readme_line_count >= 80 ? 1 : 0) +
    (has_readme_install && has_readme_usage ? 1 : 0)

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
    homepage: typeof repoData.homepage === 'string' && repoData.homepage.length > 0 ? repoData.homepage : null,
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
    contributors_count,
    form_factor,
    npm: {
      package_name:     pkgName,
      weekly_downloads: weeklyDownloads,
      has_published:    weeklyDownloads !== null && weeklyDownloads > 0,
    },
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
      ci_workflows,
      has_ci_config,
      has_lockfile,
      lockfile_kind,
      observability_libs: observabilityLibs,
      has_typescript_strict,
      typescript_pct,
      has_license,
      has_contributing,
      has_changelog,
      has_code_of_conduct,
      is_monorepo,
      app_root,                         // detected sub-folder when no root package.json (e.g. 'website')
      tailwind_responsive_count,
      tailwind_class_total,
      css_media_query_count,
      has_overflow_x_hidden,
      has_prefers_dark,
      has_prefers_reduced_motion,
      env_committed,
      releases_count,
      readme_depth_score,
      readme_line_count,
      has_readme_install,
      has_readme_usage,
    },
    readme_excerpt,
    debut_brief,
  }
}

// ── Security headers probe (Tier-1 completeness · v4) ───────
// Single GET to the live URL · check the response headers for the most
// impactful security headers. Returns presence flags + a 0-1 score so
// downstream scoring stays simple.
interface SecurityHeaders {
  fetched:                boolean
  has_csp:                boolean   // Content-Security-Policy
  has_hsts:               boolean   // Strict-Transport-Security
  has_frame_protection:   boolean   // X-Frame-Options OR frame-ancestors in CSP
  has_content_type_opt:   boolean   // X-Content-Type-Options: nosniff
  has_referrer_policy:    boolean   // Referrer-Policy
  has_permissions_policy: boolean   // Permissions-Policy
  filled:                 number    // 0-6
  of:                     number    // 6
}
async function inspectSecurityHeaders(url: string): Promise<SecurityHeaders> {
  const blank: SecurityHeaders = {
    fetched: false,
    has_csp: false, has_hsts: false, has_frame_protection: false,
    has_content_type_opt: false, has_referrer_policy: false, has_permissions_policy: false,
    filled: 0, of: 6,
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(timer)
    if (!res.ok) return blank
    const h = res.headers
    const csp     = (h.get('content-security-policy') || '').toLowerCase()
    const hsts    = h.get('strict-transport-security') !== null
    const frameH  = h.get('x-frame-options') !== null || /frame-ancestors/.test(csp)
    const ctOpt   = (h.get('x-content-type-options') || '').toLowerCase().includes('nosniff')
    const refPol  = h.get('referrer-policy') !== null
    const permPol = h.get('permissions-policy') !== null
    const flags = {
      has_csp: csp.length > 0,
      has_hsts: hsts,
      has_frame_protection: frameH,
      has_content_type_opt: ctOpt,
      has_referrer_policy: refPol,
      has_permissions_policy: permPol,
    }
    const filled = Object.values(flags).filter(Boolean).length
    return { fetched: true, ...flags, filled, of: 6 }
  } catch {
    return blank
  }
}

// ── Legal pages probe (Tier-1 completeness · v4) ────────────
// Try common variants for /privacy and /terms. Returns presence flags
// based on any variant returning 200 + reasonable body length (>500
// bytes — excludes tiny redirect pages).
interface LegalPages {
  fetched:      boolean
  has_privacy:  boolean
  has_terms:    boolean
}
async function inspectLegalPages(baseUrl: string): Promise<LegalPages> {
  const blank: LegalPages = { fetched: false, has_privacy: false, has_terms: false }
  if (!baseUrl) return blank

  let base: string
  try {
    base = new URL(baseUrl).origin
  } catch {
    return blank
  }

  const variants = {
    privacy: ['/privacy', '/privacy-policy', '/legal/privacy'],
    terms:   ['/terms', '/terms-of-service', '/tos', '/legal/terms'],
  }
  async function probeVariant(path: string): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch(`${base}${path}`, { method: 'GET', signal: ctrl.signal, redirect: 'follow' })
      clearTimeout(timer)
      if (!res.ok) return false
      const text = await res.text()
      // Loose heuristic — substantial body avoids matching SPA fallback.
      return text.length > 500
    } catch {
      return false
    }
  }
  const [privacyHits, termsHits] = await Promise.all([
    Promise.all(variants.privacy.map(probeVariant)).then(arr => arr.some(Boolean)),
    Promise.all(variants.terms.map(probeVariant)).then(arr => arr.some(Boolean)),
  ])
  return { fetched: true, has_privacy: privacyHits, has_terms: termsHits }
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

// ── Scoring (v2 · 2026-04-27) ─────────────────────────────────
//
// 50-point Audit pillar redistribution:
//   Lighthouse              20 (was 30) · Performance 8 · A11y 5 · BP 4 · SEO 3
//   Production Maturity     10 (NEW)    · tests · CI · observability · TS strict · lockfile
//   Source Hygiene           5 (was 5)  · GitHub accessible · LICENSE · monorepo discipline
//   Live URL Health          5 (was 5)  · 200+SSL · response time · real content
//   Completeness Signals     2 (NEW slot · was hidden in Best Practices)
//   Tech Layer Diversity     3 (was 5)
//   Build Brief Integrity    5 (unchanged · 0 for walk-on · effective ceiling 45)
//   ────────────────────────
//   Total                   50
//
// Soft bonuses (cap 50 + 5):
//   Ecosystem Signal         +3 max     · stars / contributors / npm downloads
//   Activity Recency         +2 max     · recent commits / triage active
//
// Walk-on note: Brief Integrity slot (5) is structurally inaccessible. CLI
// renders walk-on score normalized against 45 (50 - 5). See render.ts.
function scoreLighthouse(lh: LighthouseScores) {
  // Step buckets (v3 calibration · 2026-04-27 restored). Linear interpolation
  // tried in v4 to absorb PageSpeed ±5pt measurement noise but caused
  // overall deflation across all projects (perf 91 dropped 8→7 etc).
  // Stepwise calibration was already field-validated on the v3 set.
  // -1 "not assessed" → neutral midpoint (no bonus, no penalty).
  // Legit 0 still takes the harshest bucket (bad signal).
  const p = lh.performance   === LH_NOT_ASSESSED ? 4
           : lh.performance   >= 90 ? 8
           : lh.performance   >= 70 ? 6
           : lh.performance   >= 50 ? 3 : 0
  const a = lh.accessibility === LH_NOT_ASSESSED ? 3
           : lh.accessibility >= 90 ? 5
           : lh.accessibility >= 70 ? 3 : 1
  const b = lh.bestPractices === LH_NOT_ASSESSED ? 2
           : lh.bestPractices >= 90 ? 4
           : lh.bestPractices >= 70 ? 2 : 0
  const s = lh.seo           === LH_NOT_ASSESSED ? 2
           : lh.seo           >= 90 ? 3
           : lh.seo           >= 70 ? 2 : 0
  return { performance: p, accessibility: a, bestPractices: b, seo: s, total: p + a + b + s }
}

// Production-maturity slot · max 12 pts (was 10 before responsive add).
// The single biggest calibration lever for separating greenfield-polish
// (vibe-style) from production-shipping (shadcn / cal.com style). A
// project with zero tests + zero CI + zero observability cannot exceed
// ~3 pts here, which appropriately limits its overall walk-on ceiling.
function scoreProductionMaturity(
  s: GitHubInfo['signals'],
  lhMobile: LighthouseScores,
  lhDesktop: LighthouseScores,
): {
  pts: number
  breakdown: { tests: number; ci: number; observability: number; ts_strict: number; lockfile: number; license: number; responsive: number }
} {
  // Tests · 0=0, 1-9=1, 10-49=2, 50+=3
  const tests = s.test_files >= 50 ? 3 : s.test_files >= 10 ? 2 : s.test_files >= 1 ? 1 : 0
  // CI · GH Actions / GitLab / CircleCI / Vercel · binary 2pt
  const ci = s.has_ci_config ? 2 : 0
  // Observability · 1+ libs in package.json earns 2 pts (binary signal)
  const observability = s.observability_libs.length >= 1 ? 2 : 0
  // TS strict · half point
  const ts_strict = s.has_typescript_strict ? 1 : 0
  // Lockfile · binary 1 pt (signal of dependency hygiene)
  const lockfile = s.has_lockfile ? 1 : 0
  // LICENSE · binary 1 pt (legal hygiene)
  const license = s.has_license ? 1 : 0
  // Responsive design · NEW · max 2 pts.
  //   +1: project shows responsive intent — Tailwind responsive prefixes
  //       used substantially (≥10% of class tokens) OR ≥5 CSS media queries.
  //   +1: mobile Lighthouse perf doesn't tank vs desktop. Either the
  //       mobile perf is decent on its own (≥70) OR the gap to desktop
  //       is small (<15 points). Pure greenfield desktop-first projects
  //       fail this; mobile-aware ones pass.
  const responsiveStrategy =
    (s.tailwind_class_total > 0 && s.tailwind_responsive_count / s.tailwind_class_total >= 0.10) ||
    s.css_media_query_count >= 5
  const lhM = lhMobile.performance
  const lhD = lhDesktop.performance
  const mobilePerfHealthy = lhM >= 70 || (lhM >= 0 && lhD >= 0 && Math.abs(lhD - lhM) < 15)
  const responsive = (responsiveStrategy ? 1 : 0) + (mobilePerfHealthy ? 1 : 0)
  const pts = Math.min(12, tests + ci + observability + ts_strict + lockfile + license + responsive)
  return { pts, breakdown: { tests, ci, observability, ts_strict, lockfile, license, responsive } }
}

// Source Hygiene · max 5 pts (v3 calibration · 2026-04-27 restored).
// v4 expansion to 7pt with Tier-1 slots (security headers / legal pages /
// README depth) over-penalized library-form-factor projects (supabase
// −17, cal.com −11). Reverted to v3. The Tier-1 SIGNALS are still
// collected (security_headers / legal_pages probes + readme_depth_score)
// and surfaced to Claude as evidence, just not as hard-score sub-slots.
function scoreSourceHygiene(gh: GitHubInfo): {
  pts: number
  breakdown: { github: number; structure: number; governance: number }
} {
  const github = gh.accessible ? 3 : 0
  const structure = gh.signals.is_monorepo ? 1 : 0
  const governanceCount = [
    gh.signals.has_contributing,
    gh.signals.has_changelog,
    gh.signals.has_code_of_conduct,
  ].filter(Boolean).length
  const governance = governanceCount >= 2 ? 1 : 0
  return { pts: Math.min(5, github + structure + governance), breakdown: { github, structure, governance } }
}

// Completeness slot · max 2 pts (renormalized from 0-5 score).
function scoreCompleteness(c: { score: number }): number {
  // c.score is 0-5 from inspectCompleteness · clamp + scale to 0-2.
  return Math.min(2, Math.round((Math.max(0, Math.min(5, c.score)) / 5) * 2))
}

// Ecosystem signal — soft bonus capped +3, library reach signal.
// Stars are log-scale: each 10× lifts +1 (cap at 10K+ stars = +3).
// Releases (semver tags published) added in v4 — counts toward same cap.
function scoreEcosystem(gh: GitHubInfo): {
  pts: number
  breakdown: { stars: number; contributors: number; downloads: number; releases: number }
} {
  const stars = gh.stars >= 10000 ? 2 : gh.stars >= 1000 ? 2 : gh.stars >= 100 ? 1 : 0
  const contributors = gh.contributors_count >= 50 ? 1 : 0
  const dl = gh.npm.weekly_downloads ?? 0
  // Library only: weekly downloads 1K+ +1, 100K+ already implied by stars
  const downloads = dl >= 1000 ? 1 : 0
  // Releases · 5+ semver tags = release discipline = +1
  const releases = gh.signals.releases_count >= 5 ? 1 : 0
  const pts = Math.min(3, stars + contributors + downloads + releases)
  return { pts, breakdown: { stars, contributors, downloads, releases } }
}

// Activity recency — soft bonus capped +2.
function scoreActivity(gh: GitHubInfo): {
  pts: number
  breakdown: { recent_commit: number; momentum: number }
} {
  const last = gh.last_commit_at ? new Date(gh.last_commit_at).getTime() : 0
  const ageDays = last > 0 ? (Date.now() - last) / (1000 * 60 * 60 * 24) : Infinity
  // Recent commit (≤ 30d) +1
  const recent_commit = ageDays <= 30 ? 1 : 0
  // Momentum — ≥ 20 commits in last 100 (i.e. > 1 commit/wk on default branch)
  const momentum = gh.commit_count_recent >= 20 ? 1 : 0
  const pts = Math.min(2, recent_commit + momentum)
  return { pts, breakdown: { recent_commit, momentum } }
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
  // v2 weights: Frontend+Backend+DB = 2, +AI = +0.5 (rounded), +Chain/MCP = +0.5 (cap 3)
  let pts = 0
  if (L.has('frontend') && L.has('backend') && L.has('database')) pts += 2
  if (L.has('ai')) pts += 1
  if (L.has('chain')) pts += 1
  return { pts: Math.min(pts, 3), layers: [...L] }
}

function scoreBriefIntegrity(brief: Record<string, unknown>) {
  const required = ['problem', 'features', 'target_user']
  const filled = required.filter(k => typeof brief[k] === 'string' && (brief[k] as string).trim().length >= 10).length
  // 3 sections → 5 pts when all filled. Missing sections zero out proportionally.
  const pts = filled === required.length ? 5 : filled >= 2 ? 3 : filled >= 1 ? 1 : 0
  return { pts, filled, of: required.length }
}

// Walk-on partial credit for the Brief Integrity slot.
// Walk-ons (CLI track) can't submit a Phase 1 brief, so the 5pt slot
// historically locked at 0 — capping walk-on at /47 of /52 (~90% ceiling).
// For elite OSS that already ship rich READMEs and a working live URL,
// give partial credit (up to 3pt) so the walk-on track ceiling rises
// to /50. Real Brief still beats this when properly submitted.
function walkOnBriefSubstitute(
  gh: GitHubInfo,
  health: { ok: boolean; elapsed_ms: number },
): { pts: number; reason: string } {
  const liveOk = health.ok && health.elapsed_ms < 3000
  if (!liveOk) return { pts: 0, reason: 'no live URL or live URL too slow' }
  const install = !!gh.signals.has_readme_install
  const usage   = !!gh.signals.has_readme_usage
  const lines   = gh.signals.readme_line_count || 0
  if (install && usage && lines >= 80) {
    return { pts: 3, reason: 'live URL OK + README has Install + Usage + ≥80 lines' }
  }
  if (install && usage) {
    return { pts: 2, reason: 'live URL OK + README has Install + Usage' }
  }
  if (install || usage) {
    return { pts: 1, reason: 'live URL OK + README has Install OR Usage' }
  }
  return { pts: 0, reason: 'README missing Install/Usage sections' }
}

// Elite ecosystem bonus — a separate +5 cap on top of the regular +3
// ecosystem soft. Triggers only when a project clears all three
// production-scale thresholds (stars + npm reach + contributor pool).
// Designed for the 100K-star / 1M-download tier — supabase, cal.com,
// shadcn-ui, etc. — so calibration ceiling lifts toward 90+ without
// inflating mid-tier projects.
function eliteEcosystem(gh: GitHubInfo): { pts: number; reason: string } {
  const stars        = gh.stars >= 10_000
  const downloads    = (gh.npm.weekly_downloads ?? 0) >= 1_000_000
  const contributors = gh.contributors_count >= 100
  if (stars && downloads && contributors) {
    return {
      pts: 5,
      reason: `elite tier · ${gh.stars.toLocaleString()} stars + ${(gh.npm.weekly_downloads ?? 0).toLocaleString()} weekly dl + ${gh.contributors_count}+ contributors`,
    }
  }
  // Partial · any 2 of 3 thresholds met → +2 (e.g. high-star + high-dl
  // but contributor count under 100). Keeps the gradient smooth so
  // mid-elite (50K stars · 500K dl) doesn't sit at zero.
  const count = (stars ? 1 : 0) + (downloads ? 1 : 0) + (contributors ? 1 : 0)
  if (count === 2) return { pts: 2, reason: '2 of 3 elite thresholds met' }
  return { pts: 0, reason: 'below elite thresholds' }
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

  SCORE FORMATION — anti-anchoring discipline (critical, v2 · 2026-04-27):
  1) START from auto_baseline = scoring_so_far.auto_50_breakdown.total * 2.
     v3 calibration restored + v3.1 form-aware slot remapping
     (2026-04-28). Slot WEIGHTS stay constant across form factors so the
     /52 hard ceiling is uniform; only slot SEMANTICS adapt:

        ┌──────────────────────┬─────────────────┬───────────────────┐
        │ Slot (weight)        │ App / web       │ Library/CLI/scaff │
        ├──────────────────────┼─────────────────┼───────────────────┤
        │ Lighthouse-equiv 20  │ Perf 8·A11y 5·  │ Tests 8·Docs 7·   │
        │                      │ BP 4·SEO 3      │ TS-strict 3·      │
        │                      │                 │ License 2         │
        │ Live-equiv        5  │ HTTP+SSL+<3000ms│ npm published 4·  │
        │                      │                 │ weekly dl ≥1k +1  │
        │ Completeness-eq   2  │ og·meta·favicon │ releases ≥5 +1·   │
        │                      │ ·apple-touch··· │ has_changelog +1  │
        │ Production Maturity 12 (same: tests · CI · obs · TS strict ·     │
        │                        lockfile · LICENSE · responsive)         │
        │ Source Hygiene    5 (same: github · monorepo · governance docs) │
        │ Tech Diversity    3 (same)                                      │
        │ Brief Integrity   5 (full 5 with submitted Phase 1 Brief;       │
        │                     walk-on track earns 0-3 via README depth    │
        │                     + live URL substitute — capped at 3 of 5)   │
        └──────────────────────┴─────────────────┴───────────────────┘
        Total cap            52

     Tier-1 SIGNALS still collected (security_headers / legal_pages /
     readme_depth) and surface as evidence — they don't move slot scores.
     Walk-on track normalizes against /50 (52 minus the 2 brief points
     unattainable without a real Phase 1 Brief). The substitute lifts the
     walk-on ceiling toward 90+ for projects with rich READMEs. Same /50
     denominator applies regardless of form factor — slot semantics adapt
     but the maximum stays uniform.

     Soft bonuses (capped +10 total):
       Ecosystem  +0-3: stars · contributors · npm dl · releases
       Activity   +0-2: recent commit · momentum
       Elite OSS  +0-5: production-scale triple threshold —
                        10K+ stars AND 1M+ weekly downloads AND 100+ contributors
                        (full 5). Any 2 of 3 thresholds → +2.
                        Designed for the supabase / cal.com / shadcn-ui tier
                        so calibration ceiling reaches 90+.

     Hard penalty (deterministic, applied before cap):
       env_committed: -5 — committed \`.env\` file (security violation, no
         polish offsets it). Surface in delta_reasoning even though the
         deduction is already in score_auto.

     Tier-1 EVIDENCE inputs (don't double-count as deductions, just inform):
       security_headers  — CSP / HSTS / X-Frame / X-Content-Type / Referrer / Permissions
       legal_pages       — /privacy and /terms reachability (SaaS-pattern signal)
       readme_depth_score — README length + Install/Usage section presence
     Mention these in delta_reasoning or strengths/concerns when relevant
     but do NOT deduct points (the hard slots above already calibrate).
     Soft bonus (NOT in 50, stacks on top, capped +10):
        Ecosystem            +0-3  (stars / contributors / npm weekly downloads)
        Activity             +0-2  (recent commit / momentum)
        Elite OSS            +0-5  (10K+ stars · 1M+ weekly dl · 100+ contributors)
     This means a polished tiny app with no tests / no CI / no observability
     gets ≤3 in the Maturity slot, capping its baseline naturally — old rubric
     let such projects climb to 88. The new rubric pulls them back to ~70.
     Conversely a 100K-star library with tests + CI + lockfile + governance
     earns the full Maturity slot + 3 Ecosystem + 5 Elite, lifting it
     toward the 90+ band correctly.
  2) Apply deductions (in addition to baseline):
       · Each tampering_signal: high -10 to -20 · medium -5 · low -2
       · Lighthouse Performance  <50 and not NA: -3 (lighter than v1 since slot is now 8 not 10)
       · Lighthouse BestPractices <50 and not NA: -3
       · Thin GitHub (<50 commits or <3 months active): -3
       · Polish gap (completeness_signals.score < 1.5 AND live_url is web): -3
         "no og:image, no manifest, no apple-touch — looks half-shipped"

  ★ ABSOLUTE ANTI-DOUBLE-COUNTING RULE (critical · v2):
     DO NOT add a "minus" entry for any signal already priced into one of the
     scoring_so_far.auto_50_breakdown slots. Specifically NEVER deduct for:
       · "no tests"           — already in production_maturity.tests
       · "no CI"              — already in production_maturity.ci
       · "no observability"   — already in production_maturity.observability
       · "no TS strict"       — already in production_maturity.ts_strict
       · "no lockfile"        — already in production_maturity.lockfile
       · "no LICENSE"         — already in production_maturity.license
       · "no monorepo"        — already in source_hygiene.structure
       · "no governance docs" — already in source_hygiene.governance
       · "low completeness"   — already in completeness_pts (capped 0-2)
       · "no GitHub stars"    — already in soft.ecosystem.stars (+ soft.elite if elite tier)
       · "no contributors"    — already in soft.ecosystem.contributors (+ soft.elite if elite tier)
       · "low npm downloads"  — already in soft.ecosystem.downloads (+ soft.elite if elite tier)
       · "no releases"        — already in soft.ecosystem.releases
       · "below elite scale"  — already represented by soft.elite = 0
       · also do NOT add a "+production-scale reach" plus chip for 1M+ npm
         downloads or 100K+ stars: those signals already power soft.elite.
         Naming them as a strength in scout_brief is fine; awarding +pts
         in the breakdown is double-counting.
       · "stale repo"         — already in soft.activity.recent_commit
       · "thin README"        — README depth signal is informational only
       · "no responsive design" — already in production_maturity.responsive
       · "no mobile optimization" — already in production_maturity.responsive
       · "committed .env"     — already deducted -5 deterministically
     If a project earned 2/10 in production_maturity, that 8-point gap from
     the ceiling IS the deduction. Adding a "−5 no tests" line on top
     punishes the same fact twice. The new rubric explicitly relocated those
     signals into the additive baseline so that high-maturity projects rise
     and low-maturity projects fall NATURALLY without ad-hoc minus rows.
     If you find yourself writing such a deduction, instead ADD a positive
     comment in delta_reasoning ("production maturity slot landed 2/10
     because of zero tests / no CI") — that surfaces the gap without
     double-deducting.
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
     Cap total positive bonuses at +20 from baseline (was +25; tightened to
     match the Production Maturity slot already capturing major maturity gains).
  4) Resulting score.current must be REPRODUCIBLE from the evidence list above.
     Two different projects with different strength profiles must NOT land on
     the same score by default — avoid the 75-80 "pretty good" anchor.
  5) If the math lands you in 75-85 for a solid-but-not-outstanding project,
     push DOWN. The rookie bar is 75 and it should be hard to cross.

  FORM FACTOR (scoring_so_far.form_factor) — adjust commentary, not numbers:
     The pillar weights above already self-correct across form factors via the
     Production Maturity + Ecosystem slots. But your prose should reflect what
     KIND of project this is so the Creator gets actionable feedback:
       · 'app'       — Lighthouse / live UX / completeness signals are first-class concerns
       · 'library'   — tests / TS strict / docs / npm reach are first-class; Lighthouse perf
                       on a docs site is secondary (don't dwell on perf 56 if a11y 100)
       · 'scaffold'  — reproducibility (env templates, clear setup, demos) is first-class
       · 'unknown'   — reason from context; default to 'app' framing
     Calibration anchor: a polished 3-month-old greenfield app with no tests /
     no CI / no observability should NOT outscore a 100K-star library shipping
     to millions weekly. If your math suggests it does, your bonuses are
     overweight — pull them back.
  CLI-PREVIEW MODE (input.is_cli_preview === true):
     This run was triggered by an anonymous \`npx commitshow audit\` call —
     the creator never reached the /submit form, so the build_brief is empty
     by design. Adjust scoring rules:
       · DO NOT emit a tampering_signal for missing Phase 2 brief sections
         (failure_log, decision_archaeology, ai_delegation_map, etc.). The
         creator never had the chance to fill them.
       · DO NOT apply the integrity_score = 0 penalty under ANY framing
         (not as "tampering_signal", not as "missing brief integrity",
         not as "no Phase 2 self-check"). Walk-ons literally cannot fill
         the brief — penalizing them is unfair and a frequent regression.
       · DO NOT deduct for the +5 "Build Brief integrity" slot inside the
         Audit pillar being empty. That slot is structurally inaccessible
         to walk-ons — treat the Audit pillar effective ceiling as 45/50,
         not 50/50, and renormalize bonuses/penalties accordingly. The
         CLI display normalizes Audit to /100 separately; your job is just
         to score what's evaluable on the 45-point base.
       · You MAY note in delta_reasoning that "Phase 2 brief not yet
         provided · audition (commit.show/submit) unlocks +15 to +20 typical."
       · Score what you can verify objectively (Lighthouse, GitHub signals,
         live URL, completeness). The auto_baseline × 2 still applies, but
         missing brief sections are framed as "not yet provided" not as
         dishonesty.
       · Phase 1 self-claims are also absent in CLI mode — that's expected,
         not suspicious. DO NOT deduct for empty problem/features/target_user.
       · LIBRARY-SHAPED REPOS: when a repo has no live URL even after the
         server tried to infer one (no GitHub homepage field set, or the
         homepage points to a docs/source URL with no Lighthouse-able
         deployment), Lighthouse + completeness signals will be absent.
         That removes ~30 pts of Audit pillar real estate. Score on what
         remains (GitHub accessibility, tech-layer diversity, code-quality
         signals) and renormalize: a polished library with no deployment
         should land in the 30-40/50 range, not 5-10/50. Specifically credit:
         test files present (+evidence), TypeScript ratio > 80% (+evidence),
         monorepo discipline (+evidence), CI workflows (+evidence). Don't
         score a 113K-star library as 8/50 just because it has no homepage.
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
    // Prompt caching · the system prompt + analysisTool definition are
    // byte-identical across audits, so we mark them with `cache_control`
    // so Anthropic caches the prefix. Cache warm path:
    //   - First request after 5+ min idle (or after deploy): cache WRITE
    //     · costs 1.25× normal input price · doesn't count toward TPM
    //   - Subsequent requests within 5 min: cache READ
    //     · 0.1× normal input price · doesn't count toward TPM
    // For ~7K system prompt + ~3K tools schema, this shrinks the
    // TPM-counted portion from ~12K to ~3K (just the per-audit user
    // payload), letting 6+ audits/min through the 30K Anthropic limit.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: includeExpertPanel ? 5600 : 4500,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          { ...analysisTool, cache_control: { type: 'ephemeral' } },
        ],
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
        model: 'claude-sonnet-4-6',
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

  // Defensive top-level try/catch · v4 had silent failures (no new
  // snapshots written) with no obvious cause. Wrap the rest of the
  // handler so any uncaught error gets logged AND surfaces as an
  // analysis_snapshot row with rich_analysis.error so we can debug.
  try {
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

  // Parallel external probes · plus security headers + legal pages
  // (Tier-1 completeness · v4).
  //
  // NOTE: dual mobile+desktop Lighthouse was tried in v4 but pushes
  // total Edge Function wall time past the 150s timeout (each PageSpeed
  // call is 30-60s + Claude call 60-90s + GH fetches). Reverted to
  // mobile-only Lighthouse; responsive slot uses `mobile perf ≥70` as
  // the sole positive signal (mobile/desktop gap comparison removed).
  const lhDesktop: LighthouseScores = { performance: LH_NOT_ASSESSED, accessibility: LH_NOT_ASSESSED, bestPractices: LH_NOT_ASSESSED, seo: LH_NOT_ASSESSED }
  const [lh, gh, health, completeness, securityHeaders, legalPages] = await Promise.all([
    project.live_url ? runLighthouse(project.live_url, 'mobile')  : Promise.resolve({ performance: 0, accessibility: 0, bestPractices: 0, seo: 0 }),
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
    project.live_url ? inspectSecurityHeaders(project.live_url) : Promise.resolve({
      fetched: false, has_csp: false, has_hsts: false, has_frame_protection: false,
      has_content_type_opt: false, has_referrer_policy: false, has_permissions_policy: false,
      filled: 0, of: 6,
    }),
    project.live_url ? inspectLegalPages(project.live_url) : Promise.resolve({
      fetched: false, has_privacy: false, has_terms: false,
    }),
  ])

  // Score components · v3 form-aware (2026-04-28).
  //
  // Web apps and non-web projects (libraries · CLIs · scaffolds · MCP
  // servers) split the 27pt of LH+Live+Completeness slots differently:
  //
  //   isAppForm:  LH 20 (mobile Lighthouse) + Live 5 (HTTP+SSL+latency)
  //               + Completeness 2 (og · meta · manifest · favicon · …)
  //
  //   non-app:    "LH" 20 reinterpreted as code/docs/types polish
  //               "Live" 5 reinterpreted as npm publish + reach
  //               "Completeness" 2 reinterpreted as release discipline
  //
  // This way the /52 hard ceiling stays uniform across forms and a
  // polished CLI tool isn't structurally penalized 27pt for not having
  // a public URL. Slot semantics adapt; the math doesn't.
  // useWebSlots is the actual switch — web slots only meaningful when the
  // project both LOOKS like a web app AND has a reachable live URL we can
  // probe with Lighthouse. Otherwise (no URL · transient outage · desktop
  // app · iOS · Electron · pre-deploy PoC) fall back to library-style
  // slots so we score on what's verifiable in the repo. form_factor stays
  // available to Claude as evidence in the prompt.
  const isAppForm    = gh.form_factor === 'app' || gh.form_factor === 'unknown'
  const useWebSlots  = isAppForm && health.ok

  const stackHints = [
    brief?.features ?? '',
    project.description ?? '',
  ].filter(Boolean) as string[]
  const tech       = scoreTechLayers(gh.languages || {}, stackHints)           //  0-3
  const briefScore = scoreBriefIntegrity(brief ?? {})                          //  0-5  (0 for walk-on without substitute)
  const maturity   = scoreProductionMaturity(gh.signals, lh, lhDesktop)        //  0-12
  const hygiene    = scoreSourceHygiene(gh)                                    //  0-5  (v3 restored)
  const ecosystem  = scoreEcosystem(gh)                                        //  0-3 soft
  const activity   = scoreActivity(gh)                                         //  0-2 soft

  // ── Web slots (only meaningful for app form) ──
  const lhScore        = scoreLighthouse(lh)                                   //  0-20 (raw; only used if isAppForm)
  // Live URL Health · binary 5/0 (v3 calibration restored).
  const liveHealthPts  = health.ok && health.elapsed_ms < 3000 ? 5 : 0
  const completenessRawPts = scoreCompleteness(completeness)                   //  0-2

  // ── Non-web equivalent slots (for library/cli/scaffold/mcp) ──
  // Test depth · 0-8 (replaces ~Lighthouse Performance 8pt for libs)
  const testFiles      = gh.signals.test_files
  const libTestsPts    = testFiles >= 50 ? 8
                       : testFiles >= 10 ? 6
                       : testFiles >= 1  ? 3
                       : 0
  // Docs depth · 0-7 (replaces ~Lighthouse A11y 5 + BP 4 - 2 for libs)
  const libDocsPts     = Math.min(7,
    (gh.signals.has_readme_install ? 1 : 0) +
    (gh.signals.has_readme_usage   ? 1 : 0) +
    (gh.signals.readme_line_count >= 80 ? 2 : 0) +
    (gh.signals.has_changelog          ? 1 : 0) +
    (gh.signals.has_contributing       ? 1 : 0) +
    (gh.signals.has_code_of_conduct    ? 1 : 0)
  )
  // Type discipline · 0-3 (replaces ~LH SEO 3 for libs — "discoverability"
  // for libs = type definitions consumers can rely on)
  const libTypesPts    = gh.signals.has_typescript_strict ? 3 : 0
  // Production safety · 0-2 (LICENSE binary)
  const libGovPts      = gh.signals.has_license ? 2 : 0
  // Total non-app "LH equivalent" · 0-20
  const libLhEquivPts  = libTestsPts + libDocsPts + libTypesPts + libGovPts

  // npm publish + reach · 0-5 (replaces Live URL Health for libs)
  const libNpmPub      = gh.npm.weekly_downloads != null ? 4 : 0
  const libReach       = (gh.npm.weekly_downloads ?? 0) >= 1000 ? 1 : 0
  const libLiveEquiv   = libNpmPub + libReach

  // Release discipline · 0-2 (replaces Completeness for libs)
  const libComplEquiv  = (gh.signals.releases_count >= 5 ? 1 : 0) +
                         (gh.signals.has_changelog ? 1 : 0)

  // Pick the right slot values based on form factor.
  const lhPts          = useWebSlots ? lhScore.total : libLhEquivPts             //  0-20
  const healthPts      = useWebSlots ? liveHealthPts : libLiveEquiv            //  0-5
  const completenessPts = useWebSlots ? completenessRawPts : libComplEquiv     //  0-2
  // Walk-on Brief substitute · 0-3 pts when no Brief is submitted (CLI
  // track) but README is rich AND the live URL is healthy. Lifts the
  // walk-on ceiling from /47 toward /50 for projects that ship real
  // documentation. Real Brief.pts always wins when present.
  const briefSubst = brief ? { pts: 0, reason: 'graduation track · brief required' }
                           : walkOnBriefSubstitute(gh, health)
  const briefEffective = Math.max(briefScore.pts, briefSubst.pts)
  // Elite ecosystem · 0-5 separate cap above the regular +3 ecosystem
  // soft. Triple threshold (10K+ stars · 1M+ weekly downloads · 100+
  // contributors) — production-scale OSS only.
  const elite      = eliteEcosystem(gh)                                        //  0-5 soft

  // Hard security penalty · committed .env file is a categorical security
  // violation that no amount of polish offsets. -5 deterministic, applied
  // before cap so the best a project with .env in repo can score on
  // walk-on (50 normalize) is ~85 even if all else is perfect.
  const env_penalty = gh.signals.env_committed ? -5 : 0

  // Polish + Maturity coupling — a polished greenfield app with no tests /
  // no CI / no observability shouldn't outscore a real production library.
  // We scale the "polish" slots (Lighthouse · Live · Completeness · Tech)
  // by a maturity confidence factor: 0/10 maturity → 60% polish credit,
  // 10/10 maturity → 100% polish credit. Maturity, Hygiene, Brief, and
  // Soft bonuses are NOT scaled — they're the maturity evidence itself.
  // This is the structural fix for the vibe-88 / shadcn-68 inversion.
  //
  // For non-app forms the "polish" slots ARE tests/docs/types/governance —
  // already maturity evidence — so coupling them again would double-deflate
  // libraries with thin coverage. maturityFactor = 1.0 for non-app.
  const maturityRatio  = maturity.pts / 10                               // 0.0 - 1.0
  const maturityFactor = useWebSlots ? (0.6 + 0.4 * maturityRatio) : 1.0  // 0.6-1.0 for web-evaluable · 1.0 for lib-evaluable
  const polishSubtotal = lhPts + healthPts + completenessPts + tech.pts
  const scaledPolish   = Math.round(polishSubtotal * maturityFactor)

  // Hard 50-cap pillar — Lighthouse + Maturity + Hygiene + Completeness +
  // TechDiv + Live + Brief = 20 + 10 + 5 + 2 + 3 + 5 + 5 = 50 (before scaling).
  // briefEffective = max(real brief, walk-on substitute) so walk-on track
  // can reach ~3pt of the brief slot via README depth + live URL.
  const auto_hard = scaledPolish + maturity.pts + hygiene.pts + briefEffective
  // Soft bonus stacks ON TOP. ecosystem(3) + activity(2) + elite(5) = 10
  // max soft. Combined cap raised to 65 to actually let elite OSS land
  // in the 90+ band (60 cap was capping calibration before elite landed).
  const auto_soft = ecosystem.pts + activity.pts + elite.pts
  const score_auto = Math.max(0, Math.min(65, auto_hard + auto_soft + env_penalty))

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
    lighthouse_desktop: lhDesktop,
    lighthouse_mobile_desktop_perf_gap: (lh.performance >= 0 && lhDesktop.performance >= 0)
      ? Math.abs(lhDesktop.performance - lh.performance) : null,
    live_url_health: health,
    completeness_signals: completeness,
    security_headers: securityHeaders,
    legal_pages: legalPages,
    github: gh,
    scoring_so_far: {
      auto_50_breakdown: {
        is_app_form:          isAppForm,
        use_web_slots:        useWebSlots,
        slot_evaluation_mode: useWebSlots ? 'web' : 'library',
        live_url_reachable:   health.ok,
        // web mode  → Lighthouse mobile breakdown
        // library mode (no URL OR non-app form) → libLhEquivPts substitute
        //   (tests + docs + types + governance) · slot weight stays 0-20.
        lighthouse:           useWebSlots ? lhScore : { total: libLhEquivPts, performance: null, accessibility: null, best_practices: null, seo: null, equivalent_for: `${gh.form_factor}${health.ok ? '' : '-no-live-url'}`, breakdown: { tests: libTestsPts, docs: libDocsPts, types: libTypesPts, governance: libGovPts } },
        production_maturity:  maturity,                //  0-12
        source_hygiene:       hygiene,                 //  0-5
        completeness_pts:     completenessPts,         //  0-2 (app: meta tags · lib/cli: release discipline)
        tech_pts:             tech.pts,                //  0-3
        tech_layers_detected: tech.layers,
        brief_pts:            briefEffective,          //  0-5  (walk-on substitute capped at 3)
        brief_substitute:     briefSubst,              //  describes which substitute pts applied if any
        health_pts:           healthPts,               //  0-5 (app: live URL · lib/cli: npm publish + reach)
        env_penalty:          env_penalty,             //  -5 if .env committed
        hard_subtotal:        auto_hard,               //  cap 52
        soft: {
          ecosystem:          ecosystem,               //  +0-3 stars · contributors · npm dl · releases
          activity:           activity,                //  +0-2 recent commit · momentum
          elite:              elite,                   //  +0-5 elite OSS triple threshold (10K stars · 1M dl · 100 contrib)
          subtotal:           auto_soft,               //  +0-10
        },
        total:                score_auto,              //  cap 65 (52 hard + 10 soft + buffer · env penalty applied)
      },
      polish_signals_0_to_5: completeness.score,
      form_factor:           gh.form_factor,
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
  // Walk-on (CLI preview) bypasses Claude's qualitative score because
  // Claude reliably double-counts deductions for signals already priced
  // into the auto_50 slots (production_maturity, source_hygiene,
  // ecosystem). The deterministic score_auto is the source of truth.
  // For walk-on display, the CLI normalizes score_auto / 45 * 100.
  // For league projects (auditioned), Claude's calibration matters
  // because it considers Brief integrity + Phase 1/2 cross-checks.
  const scoreTotal = isCliPreview
    ? Math.min(100, Math.round((score_auto / 50) * 100))    // walk-on: deterministic /50 normalize (52 hard - 2 brief unattainable · partial Brief substitute up to 3pt)
    : (claude.score?.current && claude.score.current > 0
        ? Math.round(claude.score.current)
        : score_auto)

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
    model_version:      'claude-sonnet-4-6',
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
      is_app_form:         isAppForm,
      use_web_slots:       useWebSlots,
      live_url_reachable:  health.ok,
      lighthouse:          useWebSlots ? lhScore : { total: libLhEquivPts, equivalent_for: `${gh.form_factor}${health.ok ? '' : '-no-live-url'}`, breakdown: { tests: libTestsPts, docs: libDocsPts, types: libTypesPts, governance: libGovPts } },
      production_maturity: maturity,
      source_hygiene:      hygiene,
      completeness_pts:    completenessPts,
      tech:                { pts: tech.pts, layers: tech.layers },
      brief:               { ...briefScore, effective: briefEffective, substitute: briefSubst },
      health_pts:          healthPts,
      ecosystem:           ecosystem,
      activity:            activity,
      elite:               elite,
      hard_subtotal:       auto_hard,
      soft_subtotal:       auto_soft,
      form_factor:         gh.form_factor,
    },
    lh,
    github: gh,
    rich: claude,
    claude_error: (claude as any).error ?? null,
    health,
  })
  } catch (e) {
    // v4 silent-failure debug · capture the error to a snapshot so we can
    // see WHERE in the pipeline it crashed without dashboard log access.
    const msg = (e as Error)?.message ?? String(e)
    const stack = (e as Error)?.stack ?? ''
    console.error('[analyze-project FATAL]', msg, stack)
    try {
      await admin.from('analysis_snapshots').insert([{
        project_id:    projectId,
        trigger_type:  triggerType,
        triggered_by:  triggeredBy,
        score_auto:    0,
        score_forecast: 0, score_community: 0, score_total: 0,
        rich_analysis: {
          error: {
            type:    'pipeline_crash',
            message: msg,
            stack:   stack.split('\n').slice(0, 8).join('\n'),
          },
        },
        model_version: 'claude-sonnet-4-6',
      }])
    } catch (saveErr) {
      console.error('[analyze-project FATAL · save error]', saveErr)
    }
    return json({ error: 'analyze_failed', message: msg }, 500)
  }
})
