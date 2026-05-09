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
import { enforceRateLimit, isAdmin } from '../_shared/rateLimit.ts'
import { fetchGithubHead, slugFromGithubUrl } from '../_shared/github.ts'

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
  // §15-E.3 Tier B mining · pulled from Lighthouse audits[] (free, already
  // fetched). null = audit didn't run or wasn't applicable. PageSpeed
  // already runs Chromium against the URL — these are signals we were
  // throwing away by only consuming the 4 category scores.
  console_errors_count?:   number | null    // # of `console.error` events captured during the run
  network_failures_count?: number | null    // # of resources with status >= 400 (or no response)
  uses_https?:             boolean | null   // page served over HTTPS
  no_doc_write?:           boolean | null   // didn't call document.write
  total_byte_weight_kb?:   number | null    // total page transfer size
  dom_size?:               number | null    // # of DOM elements (>1500 = warning territory)
}

const LH_NOT_ASSESSED = -1

function lhScoreOrNA(raw: number | null | undefined): number {
  if (raw == null) return LH_NOT_ASSESSED
  return Math.round(raw * 100)
}

// Lighthouse audit results have a `score` (0-1 or null) and `details`.
// We use score==1 as "clean" for boolean audits and details.items.length
// as a count for items-style audits (errors-in-console etc.).
function lhAuditPasses(audit: any): boolean | null {
  if (!audit) return null
  if (audit.score == null) return null
  return audit.score >= 0.9
}

function lhAuditItemCount(audit: any): number | null {
  if (!audit) return null
  const items = audit.details?.items
  if (!Array.isArray(items)) return null
  return items.length
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
    // §15-E.3 mine the audits[] for runtime-evidence signals (free · CF
    // Chromium already ran the page · these are byproducts of the same call).
    const a = data.lighthouseResult?.audits ?? {}
    const consoleErrCount  = lhAuditItemCount(a['errors-in-console'])
    const netFailuresCount = lhAuditItemCount(a['network-requests']) != null
      ? (Array.isArray(a['network-requests']?.details?.items)
          ? a['network-requests'].details.items.filter((it: any) =>
              typeof it?.statusCode === 'number' && (it.statusCode >= 400 || it.statusCode === 0)
            ).length
          : null)
      : null
    const totalByteKb = a['total-byte-weight']?.numericValue != null
      ? Math.round(a['total-byte-weight'].numericValue / 1024)
      : null
    const domSize = a['dom-size']?.numericValue != null
      ? Math.round(a['dom-size'].numericValue)
      : null
    return {
      performance:           lhScoreOrNA(c.performance?.score),
      accessibility:         lhScoreOrNA(c.accessibility?.score),
      bestPractices:         lhScoreOrNA(c['best-practices']?.score),
      seo:                   lhScoreOrNA(c.seo?.score),
      console_errors_count:  consoleErrCount,
      network_failures_count: netFailuresCount,
      uses_https:            lhAuditPasses(a['is-on-https']),
      no_doc_write:          lhAuditPasses(a['no-document-write']),
      total_byte_weight_kb:  totalByteKb,
      dom_size:              domSize,
    }
  } catch (e) {
    console.error('runLighthouse failed', e)
    // Network/API failure — everything unassessed (not 0)
    return {
      performance: LH_NOT_ASSESSED, accessibility: LH_NOT_ASSESSED,
      bestPractices: LH_NOT_ASSESSED, seo: LH_NOT_ASSESSED,
      console_errors_count: null, network_failures_count: null,
      uses_https: null, no_doc_write: null,
      total_byte_weight_kb: null, dom_size: null,
    }
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
  form_factor: 'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown'
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
    is_monorepo: boolean                 // workspaces / turbo.json / pnpm-watch / yarn-workspaces
    app_root: string                     // detected sub-folder app root ('' when at repo root)
    scanned_scope: string                // human-readable description for transparency (monorepo big-repo case)
    form_factor: string                  // mirror of gh.form_factor for snapshot persistence (B18)
    is_saas: boolean                     // SaaS sub-form (app + api routes + db + auth) · 2026-04-29
    has_auth_signals: boolean            // auth lib / middleware / sign-in routes detected
    has_db_layer: boolean                // db lib in deps OR migrations OR RLS detected
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
    // ── Native-app distribution + permissions ──
    has_permissions_manifest: boolean    // AndroidManifest / Info.plist / entitlements.plist
    has_app_store:        boolean        // apps.apple.com or itunes.apple.com link in README
    has_play_store:       boolean        // play.google.com link in README
    has_test_flight:      boolean        // testflight.apple.com/join link
    has_f_droid:          boolean        // f-droid.org/packages link
    has_release_binary:   boolean        // README mentions APK / DMG / MSI / etc
    has_privacy_policy:   boolean        // privacy-policy URL in README
    // ── Native-app footguns (extension · 2026-04-30) ──
    native_permissions_overreach: {       // sensitive perms requested without justification
      android_count:   number             // number of <uses-permission> entries
      android_dangerous: string[]         // CAMERA · LOCATION · CONTACTS · etc
      ios_keys:        string[]           // NS*UsageDescription keys present
      ios_missing_descriptions: string[]  // entries used but no description
    }
    native_secrets_in_bundle: {           // API keys / tokens hardcoded in client native source
      samples: Array<{ file: string; pattern: string }>
      total:   number
    }
    has_privacy_manifest:  boolean       // iOS PrivacyInfo.xcprivacy (App Store 2024 gate)
    // ── Skill-form signals (form_factor='skill') ──
    has_skill_md:            boolean     // SKILL.md at root or .claude/skills/<name>/SKILL.md
    has_skill_canonical:     boolean     // canonical .claude/skills/<name>/SKILL.md layout
    has_plugin_manifest:     boolean     // .claude-plugin/marketplace.json or plugin.json
    skill_frontmatter_valid: boolean     // SKILL.md has both `name` and `description` YAML fields
    skill_description_chars: number      // length of `description` field — useful trigger detail
    // ── Vibe Coder Checklist · 7-category framework (2026-04-28) ──
    // The systematic failure modes that ~70% of AI-coded projects miss
    // and generic linters / Cursor reviews don't catch. Surfaced as
    // structured signals so the UI can render a 7-card status panel
    // and Claude can speak to specific concerns instead of generic ones.
    vibe_concerns: {
      // Core 7 Frames · the signature framework
      webhook_idempotency: { handlers_seen: number; idempotency_signal_seen: number; signature_verified_seen?: number; gap: boolean; sample_files: string[] }
      rls_gaps:            { tables: number; policies: number; writable_table_signals: number; gap_estimate: number; tables_uncovered?: string[]; has_rls_intent: boolean }
      secret_exposure:     { client_violations: Array<{ file: string; pattern: string; reason?: string }>; total: number }
      db_indexes:          { fk_columns_seen: number; indexes_seen: number; gap_estimate: number; unindexed_samples?: Array<{ file: string; column: string; references?: string }> }
      observability:       { libs: string[]; detected: boolean; checked_subpackages?: number }
      rate_limit:          { lib_detected: string | null; middleware_detected: boolean; has_api_routes: boolean; needs_attention: boolean }
      prompt_injection:    { uses_ai_sdk: boolean; ai_evidence_files?: string[]; raw_input_to_prompt_files: string[]; sanitization_detected?: boolean; suspicious: boolean }
      // Extension frames (8-11) · added 2026-04-30 · AI-template-copy footguns
      hardcoded_urls:      { samples: Array<{ file: string; pattern: string }>; total: number }
      mock_data:           { samples: Array<{ file: string; collection: string }>; total: number }
      webhook_signature:   { handlers_seen: number; verified_seen: number; gap: boolean; sample_files: string[] }
      cors_permissive:     { samples: Array<{ file: string; pattern: string }>; total: number }
      // Frame 12 · 2026-05-01 · iOS Safari zoom-on-focus when input/textarea
      // font-size < 16px. Common Tailwind text-sm pitfall on mobile-first.
      mobile_input_zoom:   { samples: Array<{ file: string; pattern: string }>; total: number; needs_attention: boolean }
      // Frame 13 · 2026-05-03 · column-level GRANT SELECT mismatch — when a
      // table is configured with column-level grants (privacy pattern hiding
      // PII like email) and a later migration adds a new column without
      // GRANTing it, PostgREST returns 42501 'permission denied for table X'
      // for any client query that includes the new column. Silent fail in
      // supabase-js (error treated as no row), masks production-critical
      // bugs (Stripe webhook polling, scout leaderboards, profile pages).
      column_grant_mismatch: { samples: Array<{ table: string; column: string; sql_file: string }>; total: number; needs_attention: boolean }
      // Frame 14 · 2026-05-03 · Stripe API write call without Idempotency-Key
      // header. Distinct from webhook idempotency (#1, which protects the
      // INBOUND event). This protects OUTBOUND POSTs to Stripe — without it
      // a network retry or double-clicked Pay button can create two
      // Checkout sessions / two Charges / two Customers.
      stripe_api_idempotency: { call_sites: number; idempotent_call_sites: number; gap: boolean; samples: Array<{ file: string; pattern: string }> }
    }
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
): 'app' | 'library' | 'scaffold' | 'native_app' | 'skill' | 'unknown' {
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
  const allDeps = Object.assign({},
    (pkg?.dependencies as Record<string, unknown>) ?? {},
    (pkg?.devDependencies as Record<string, unknown>) ?? {})

  // Native app indicators (highest priority — must come before scaffold/lib).
  // Detection sources, any one is enough:
  //   1. JS native frameworks in package.json deps:
  //      react-native · expo · @capacitor/core · @ionic/* · electron ·
  //      @tauri-apps/* · nativescript
  //   2. Platform project files:
  //      ios/ + android/ folders (RN / Cap) · *.xcodeproj · Podfile ·
  //      AndroidManifest.xml · build.gradle · MainActivity.java/.kt
  //   3. Flutter (no JS package.json — pubspec.yaml + lib/ + dart code)
  //   4. Capacitor / Cordova config files: capacitor.config.* · config.xml
  //   5. Tauri/Electron build configs: tauri.conf.json · electron-builder.json
  const nativeJsFrameworks = !!(
    'react-native' in allDeps || 'expo' in allDeps ||
    '@capacitor/core' in allDeps || '@ionic/angular' in allDeps ||
    '@ionic/react' in allDeps || 'nativescript' in allDeps ||
    '@nativescript/core' in allDeps ||
    'electron' in allDeps || '@tauri-apps/api' in allDeps ||
    Object.keys(allDeps).some(d => d.startsWith('@tauri-apps/'))
  )
  const platformPaths = (
    paths.some(p => /^ios\//.test(p)) ||
    paths.some(p => /^android\//.test(p)) ||
    paths.some(p => /\.xcodeproj/.test(p)) ||
    pathSet.has('Podfile') ||
    paths.some(p => /AndroidManifest\.xml$/.test(p)) ||
    paths.some(p => /MainActivity\.(java|kt)$/.test(p))
  )
  const flutterPath = pathSet.has('pubspec.yaml') ||
    paths.some(p => /\.dart$/.test(p))
  const nativeBuildConfig = (
    pathSet.has('capacitor.config.json') || pathSet.has('capacitor.config.ts') ||
    pathSet.has('capacitor.config.js')   || pathSet.has('config.xml') ||
    pathSet.has('tauri.conf.json')       || pathSet.has('electron-builder.json') ||
    pathSet.has('electron-builder.yml')
  )
  if (nativeJsFrameworks || platformPaths || flutterPath || nativeBuildConfig) {
    return 'native_app'
  }

  // Claude Code skill indicators (high priority — comes before scaffold and
  // library because a skill repo can have a package.json or look library-ish
  // and we don't want it misclassified). Distribution path for skills is
  // `npx skills add owner/repo` or `/plugin marketplace add` — NOT npm
  // publish — so penalizing them on npm signals is wrong.
  // Signals (any one is enough):
  //   1. SKILL.md at root (single-skill repo)
  //   2. .claude/skills/<name>/SKILL.md (canonical multi-skill layout)
  //   3. .claude-plugin/marketplace.json or plugin.json (declares as plugin)
  //   4. README install pattern matching `npx skills add` or `/plugin marketplace add`
  const hasRootSkillMd     = pathSet.has('SKILL.md')
  const hasCanonicalSkill  = paths.some(p => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p))
  const hasPluginManifest  = paths.some(p => /^\.claude-plugin\/(marketplace|plugin)\.json$/.test(p))
  const readmeMentionsInstall = /\bnpx\s+(?:-y\s+)?skills(?:@[\w.-]+)?\s+add\b|\/plugin\s+marketplace\s+add\b/i.test(readmeHead)
  if (hasRootSkillMd || hasCanonicalSkill || hasPluginManifest || readmeMentionsInstall) {
    return 'skill'
  }

  // Scaffold indicators (highest priority — they often look like libraries)
  const scaffoldName = /^(create-|@.+\/create-)/.test(name) || /\b(starter|template|boilerplate|scaffold|kit)\b/i.test(name)
  const scaffoldReadme = /(use this template|getting started.+(fork|clone|copy this)|click .?use this template)/i.test(readmeHead)
  if (scaffoldName || scaffoldReadme) return 'scaffold'

  // Library indicators · publishable + monorepo + npm-install-style README
  const monorepo = pathSet.has('turbo.json') || pathSet.has('pnpm-workspace.yaml') ||
    !!(pkg && (pkg as { workspaces?: unknown }).workspaces) ||
    paths.some(p => /^packages\/[^/]+\/package\.json$/.test(p))
  const packageCount = paths.filter(p => /^packages\/[^/]+\/package\.json$/.test(p)).length
  const npmInstallExample = /\b(npm i\s+|yarn add\s+|pnpm add\s+|bun add\s+)\S/.test(readmeHead)

  // Strong library signal · monorepo with 3+ published-shape packages.
  // The workspace root for vercel/ai · @anthropic-ai/sdk-monorepo style
  // has no main/exports/module of its own (each sub-package does), so the
  // existing libIndicators check undercounted. Counting sub-packages
  // captures these workspaces directly. Single-package monorepos (1-2
  // packages — common in apps that vendor one shared lib) still go
  // through libIndicators.
  if (monorepo && packageCount >= 3) return 'library'

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

async function inspectGitHub(url: string | null, explicitWorkspace: string | null = null): Promise<GitHubInfo> {
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
      scanned_scope: 'fallback · github fetch failed (rate limit or repo unreachable)',
      form_factor: 'unknown',
      is_saas: false,
      has_auth_signals: false,
      has_db_layer: false,
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
      has_permissions_manifest: false,
      has_app_store: false,
      has_play_store: false,
      has_test_flight: false,
      has_f_droid: false,
      has_release_binary: false,
      has_privacy_policy: false,
      native_permissions_overreach: {
        android_count: 0, android_dangerous: [],
        ios_keys: [], ios_missing_descriptions: [],
      },
      native_secrets_in_bundle: { samples: [], total: 0 },
      has_privacy_manifest: false,
      has_skill_md: false,
      has_skill_canonical: false,
      has_plugin_manifest: false,
      skill_frontmatter_valid: false,
      skill_description_chars: 0,
      vibe_concerns: {
        webhook_idempotency: { handlers_seen: 0, idempotency_signal_seen: 0, gap: false, sample_files: [] },
        rls_gaps:            { tables: 0, policies: 0, writable_table_signals: 0, gap_estimate: 0, has_rls_intent: false },
        secret_exposure:     { client_violations: [], total: 0 },
        db_indexes:          { fk_columns_seen: 0, indexes_seen: 0, gap_estimate: 0 },
        observability:       { libs: [], detected: false },
        rate_limit:          { lib_detected: null, middleware_detected: false, has_api_routes: false, needs_attention: false },
        prompt_injection:    { uses_ai_sdk: false, raw_input_to_prompt_files: [], suspicious: false },
        hardcoded_urls:      { samples: [], total: 0 },
        mock_data:           { samples: [], total: 0 },
        webhook_signature:   { handlers_seen: 0, verified_seen: 0, gap: false, sample_files: [] },
        cors_permissive:     { samples: [], total: 0 },
        mobile_input_zoom:   { samples: [], total: 0, needs_attention: false },
        column_grant_mismatch: { samples: [], total: 0, needs_attention: false },
        stripe_api_idempotency: { call_sites: 0, idempotent_call_sites: 0, gap: false, samples: [] },
      },
    },
    readme_excerpt: null,
    debut_brief: { found: false, path: null, raw: null, last_commit_at: null, sha: null },
    md_candidates: [],
  }
  if (!url) return empty                                              // §15-E URL-only fast lane: no repo → full empty shape (signals etc.)
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

  // Signal extraction. `rootPaths` is preserved for root-level checks
  // (CI workflows, LICENSE, lockfile at repo root, supabase edge funcs);
  // `paths` is potentially shadowed to a workspace subset further down
  // when this is a monorepo and we pick a primary sub-app to audit.
  const rootPaths: string[] = blobs.map(b => b.path)
  const rootPathSet = new Set(rootPaths)
  let paths: string[] = rootPaths
  // pathSet is also shadowed downstream when paths gets re-scoped.

  // ── Monorepo / subfolder app root detection ──
  // Many vibe-coded projects live in a sub-folder (e.g. `website/`, `apps/web/`)
  // while CI · LICENSE · README stay at repo root. If there's no root
  // package.json, find the most likely "app root" so subsequent path probes
  // (package.json · tsconfig.json · lockfile) hit the real app instead of
  // returning 404 and dragging the score to the floor. Common subfolder
  // names ranked by convention.
  const APP_ROOT_PREFERENCE = [
    'website', 'web', 'app', 'apps/web', 'apps/website', 'apps/app',
    'frontend', 'client', 'site', 'packages/web', 'packages/app',
  ]
  let app_root = ''
  if (!rootPathSet.has('package.json')) {
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

  // ── Monorepo workspace-root selection (NEW · 2026-05-06) ──
  // Big monorepos (supabase/supabase, vercel/next.js, cal.com/cal.com)
  // mash 20+ sub-apps (dashboard + marketing + docs + examples + …) into
  // one tree, and detector hits in any sub-app read like core-service
  // findings. Auto-pick the largest sub-app by file count and shadow
  // `paths` to that subtree — same code-scanning detectors then operate
  // on a coherent unit instead of the union.
  //
  // CLI / web caller can override later via an explicit workspace arg
  // (plumbed through analyze() request body as `workspace`); for now
  // the auto-pick alone removes 95% of the false positives.
  const looksMonorepoEarly = rootPathSet.has('turbo.json') ||
    rootPathSet.has('pnpm-workspace.yaml') ||
    rootPathSet.has('lerna.json') ||
    rootPathSet.has('nx.json') ||
    rootPaths.some(p => /^apps\/[^/]+\/package\.json$/.test(p)) ||
    rootPaths.some(p => /^packages\/[^/]+\/package\.json$/.test(p))

  // Workspace pick reason · surfaced in scanned_scope so the reader knows
  // why we landed on this sub-app (priority-name match · repo-name match ·
  // file-count fallback · explicit override). null when not a monorepo.
  let workspace_pick_reason: string | null = null

  // ── Phase 0 · explicit caller override ──
  // CLI `--workspace apps/web` (or inline `github.com/o/r/apps/web`)
  // ships through audit-preview as the `workspace` param. Validate
  // against the actual repo tree so a typo/non-existent path falls
  // through to auto-pick rather than producing an empty audit.
  if (explicitWorkspace) {
    const wsClean = explicitWorkspace.replace(/^\/+/, '').replace(/\/+$/, '')
    // Accept if at least one file lives under that prefix.
    const exists = rootPaths.some(p => p === wsClean || p.startsWith(`${wsClean}/`))
    if (exists) {
      app_root = wsClean
      workspace_pick_reason = 'explicit override'
    }
    // If !exists, we silently fall through to auto-pick. The CLI side
    // does its own existence check before sending; this is the
    // server-side safety net that prevents an empty audit.
  }

  if (looksMonorepoEarly && !app_root) {
    // ── Phase 1 · canonical name priority ──
    // Names commonly used for the "main user-facing" app. A repo with
    // apps/studio matches "studio" (supabase) · apps/web matches "web"
    // (cal.com / many Next.js monorepos). Order roughly by frequency.
    const NAME_PRIORITY = [
      'web', 'app', 'studio', 'dashboard', 'main', 'server', 'api',
      'frontend', 'website', 'site', 'console', 'admin', 'client',
    ]
    for (const dir of ['apps', 'services'] as const) {
      for (const name of NAME_PRIORITY) {
        if (rootPathSet.has(`${dir}/${name}/package.json`)) {
          app_root = `${dir}/${name}`
          workspace_pick_reason = `priority name '${name}'`
          break
        }
      }
      if (app_root) break
    }

    // ── Phase 2 · repo-name match (with suffix variants) ──
    // Many monorepos name a workspace after the repo itself
    // (e.g. vercel/next.js → packages/next · denoland/deno-ts → packages/deno).
    // Strip common suffixes so vercel/next.js still matches packages/next.
    if (!app_root) {
      const repoNameRaw = String(repoData?.name ?? '').toLowerCase()
      if (repoNameRaw) {
        const variants = new Set<string>([repoNameRaw])
        // Strip common JS-ecosystem suffixes
        for (const suffix of ['.js', '.ts', '-js', '-ts', '.io', '.dev']) {
          if (repoNameRaw.endsWith(suffix)) {
            variants.add(repoNameRaw.slice(0, -suffix.length))
          }
        }
        outer: for (const variant of variants) {
          for (const dir of ['packages', 'apps', 'services'] as const) {
            if (rootPathSet.has(`${dir}/${variant}/package.json`)) {
              app_root = `${dir}/${variant}`
              workspace_pick_reason = variant === repoNameRaw
                ? `repo-name match`
                : `repo-name match (stripped suffix)`
              break outer
            }
          }
        }
      }
    }

    // ── Phase 3 · file-count fallback (absolute · no tier preference) ──
    // No name-based winner. Pick the workspace with the most code BY
    // ABSOLUTE FILE COUNT. The earlier "apps/* always wins" rule was
    // wrong for repos like vercel/next.js where apps/* contains a
    // sprinkle of tiny example apps and packages/next is the actual
    // 5000-file framework. Tier preference is a tiebreaker only.
    if (!app_root) {
      const wsCount = new Map<string, number>()
      for (const p of rootPaths) {
        const m = p.match(/^(apps|packages|services|examples)\/([^/]+)\//)
        if (m) {
          const key = `${m[1]}/${m[2]}`
          wsCount.set(key, (wsCount.get(key) ?? 0) + 1)
        }
      }
      if (wsCount.size > 0) {
        const tierOf = (k: string) =>
          k.startsWith('apps/')     ? 0 :
          k.startsWith('packages/') ? 1 :
          k.startsWith('services/') ? 2 : 3
        const sorted = [...wsCount.entries()].sort((a, b) => {
          // Absolute file count first · tier as tiebreaker
          if (a[1] !== b[1]) return b[1] - a[1]
          return tierOf(a[0]) - tierOf(b[0])
        })
        app_root = sorted[0][0]
        workspace_pick_reason = `largest of ${sorted.length} by file count`
      }
    }
  }

  // Prefix used for subsequent /contents/ probes. Empty string → root.
  const appPrefix = app_root ? `${app_root}/` : ''

  // Shadow `paths` to the workspace subset so code-scanning detectors
  // (49 paths.filter / paths.some sites below) operate on a coherent
  // unit. Path prefix is stripped so existing regexes (`^components/`,
  // `(pages|app|routes)/`) still match. Root-level checks (CI workflows,
  // license at root, lockfile at root) keep using `rootPaths` /
  // `rootPathSet`.
  if (appPrefix) {
    paths = rootPaths
      .filter(p => p.startsWith(appPrefix))
      .map(p => p.slice(appPrefix.length))
  }
  const pathSet = appPrefix ? new Set(paths) : rootPathSet

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
  // Cache fetched SQL text so the vibe_concerns block (rls writable detection,
  // FK index gap detection) can reuse it without re-fetching from GitHub.
  const sqlSampleCache = new Map<string, string>()
  for (const sql of sqlSample) {
    const text = await ghText(`/contents/${encodeURI(sql)}?ref=${defBranch}`)
    if (!text) continue
    sqlSampleCache.set(sql, text)
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
  // CI workflows live at REPO ROOT in monorepos (.github/workflows/*) —
  // they're org-wide. Use rootPaths/rootPathSet so we don't miss them
  // after `paths` was workspace-scoped above. Same applies to vercel.json
  // / netlify.toml / lockfile / LICENSE / governance docs.
  const ciWorkflowFiles = rootPaths.filter(p => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p))
  const ci_workflows = ciWorkflowFiles.length
  const has_ci_config = ci_workflows > 0
    || rootPathSet.has('.gitlab-ci.yml')
    || rootPaths.some(p => /^\.circleci\/config\.ya?ml$/.test(p))
    || rootPathSet.has('vercel.json')      // Vercel auto-checks count as CI signal
    || rootPathSet.has('netlify.toml')

  const LOCKFILE_MAP: Record<string, 'npm' | 'yarn' | 'pnpm' | 'bun'> = {
    'package-lock.json': 'npm',
    'yarn.lock':         'yarn',
    'pnpm-lock.yaml':    'pnpm',
    'bun.lockb':         'bun',
    'bun.lock':          'bun',
  }
  let lockfile_kind: 'npm' | 'yarn' | 'pnpm' | 'bun' | null = null
  for (const [file, kind] of Object.entries(LOCKFILE_MAP)) {
    // Accept lockfile at REPO ROOT (most common in monorepos) OR at the
    // detected app root (single-package projects in subfolders).
    if (rootPathSet.has(file) || (appPrefix && rootPathSet.has(`${appPrefix}${file}`))) {
      lockfile_kind = kind; break
    }
  }
  const has_lockfile = !!lockfile_kind

  const has_license          = rootPaths.some(p => /^LICENSE(\.[a-zA-Z0-9]+)?$/i.test(p))
  const has_contributing     = rootPaths.some(p => /^CONTRIBUTING\.md$/i.test(p))
  const has_changelog        = rootPaths.some(p => /^CHANGELOG\.md$/i.test(p))
  const has_code_of_conduct  = rootPaths.some(p => /^CODE_OF_CONDUCT\.md$/i.test(p))

  // Skill-form signals · used by form_factor='skill' branch in slot math.
  // Detection mirrors detectFormFactor() — kept in sync but evaluated again
  // here so the booleans land in `signals` for both Claude evidence and
  // deterministic scoring. SKILL.md / .claude-plugin live at root.
  const has_skill_canonical = rootPaths.some(p => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p))
  const has_skill_md        = rootPathSet.has('SKILL.md') || has_skill_canonical
  const has_plugin_manifest = rootPaths.some(p => /^\.claude-plugin\/(marketplace|plugin)\.json$/.test(p))
  // Frontmatter validity: read the canonical or root SKILL.md (whichever we
  // find first) and check for both `name` and `description` YAML fields.
  // description length is surfaced as a separate signal — short descriptions
  // (<100 chars) tend to mean weak triggering, which Claude can flag.
  let skill_frontmatter_valid = false
  let skill_description_chars = 0
  if (has_skill_md) {
    const skillPath = rootPaths.find(p => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p)) ?? (rootPathSet.has('SKILL.md') ? 'SKILL.md' : null)
    if (skillPath) {
      const skillText = await ghText(`/contents/${skillPath}?ref=${defBranch}`)
      if (skillText) {
        const fmMatch = skillText.match(/^---\s*\n([\s\S]+?)\n---/)
        if (fmMatch) {
          const fm = fmMatch[1]
          const nameLine = fm.match(/^\s*name\s*:\s*(.+)$/m)
          const descLine = fm.match(/^\s*description\s*:\s*(.+)$/m)
          skill_frontmatter_valid = !!(nameLine && descLine)
          if (descLine) {
            // Strip surrounding quotes if present (YAML allows both forms).
            skill_description_chars = descLine[1].replace(/^["']|["']$/g, '').trim().length
          }
        }
      }
    }
  }

  // Monorepo signal — workspaces declared OR turbo/pnpm workspace files OR
  // packages/* presence with a /package.json under it.
  // Use rootPathSet/rootPaths because workspace files are at repo root,
  // not in the scoped workspace.
  const is_monorepo =
    !!(pkgParsed && (pkgParsed as { workspaces?: unknown }).workspaces) ||
    rootPathSet.has('turbo.json') ||
    rootPathSet.has('pnpm-workspace.yaml') ||
    rootPaths.some(p => /^packages\/[^/]+\/package\.json$/.test(p)) ||
    rootPaths.some(p => /^apps\/[^/]+\/package\.json$/.test(p))

  // ── Scanned scope · transparency for monorepos ──
  // After auto-pick, we audited ONE workspace not all 22. Surface that
  // explicitly so the reader sees we didn't mash the whole monorepo
  // together. The scope string lands in CLI output, web hero chip,
  // and audit.md sidecar (commit b40fb77+).
  let scanned_scope: string
  if (!is_monorepo) {
    scanned_scope = app_root ? `single project · root at ${app_root}/` : 'single project · root'
  } else {
    // Count files per workspace dir at repo root (not the scoped paths).
    const workspaceCount = new Map<string, number>()
    for (const p of rootPaths) {
      const m = p.match(/^(apps|packages|services|examples)\/([^/]+)\//)
      if (m) {
        const key = `${m[1]}/${m[2]}`
        workspaceCount.set(key, (workspaceCount.get(key) ?? 0) + 1)
      }
    }
    const sorted = [...workspaceCount.entries()].sort((a, b) => b[1] - a[1])
    if (sorted.length === 0) {
      scanned_scope = 'monorepo · root only (no apps/* or packages/* workspaces detected)'
    } else if (app_root) {
      // We auto-picked one workspace · the reason chosen above
      // (priority name · repo-name match · largest by file count)
      // is surfaced so the reader can sanity-check the selection.
      const ourFiles = sorted.find(([k]) => k === app_root)?.[1] ?? 0
      const reason = workspace_pick_reason ?? 'auto-pick'
      scanned_scope = `monorepo · audited ${app_root}/ (${ourFiles} files · ${reason} · ${sorted.length} sub-app${sorted.length === 1 ? '' : 's'} total)`
    } else {
      const top = sorted.slice(0, 3).map(([k]) => k)
      const more = sorted.length > 3 ? ` + ${sorted.length - 3} more` : ''
      scanned_scope = `monorepo · ${sorted.length} sub-app${sorted.length === 1 ? '' : 's'} · audit covers ${top.join(' + ')}${more}`
    }
  }

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
  // Excludes (false positives we've actually hit on supabase / vite /
  // big monorepos):
  //   1. .env.example / .env.template / .env.sample / .env.tpl (docs)
  //   2. .env.development / .env.staging / .env.preview / .env.production
  //      with these names alone (Next.js convention — public NEXT_PUBLIC_*
  //      build-time defaults, no real secrets). The actual sensitive
  //      override is .env.local which is gitignored.
  //   3. anything inside examples/, demo/, sample/, demos/, fixtures/,
  //      test/, tests/, e2e/, playground/, cookbook/, docs/ subtrees
  //   4. monorepo workspace .env at apps/<name>/ or packages/<name>/
  //      (per-workspace public defaults, no production secret pattern)
  //   5. dotenvx-style paths (encrypted-env tool with public keys
  //      intentionally committed)
  const ENV_FILE_RE      = /(^|\/)\.env(\.[a-z0-9]+)?$/i
  const ENV_DOC_RE       = /\.env\.(example|sample|template|local\.example|defaults|development|staging|preview|production)$|\.env\.tpl$/i
  const ENV_SKIP_DIR     = /(^|\/)(examples?|demo|demos|sample|samples|fixtures?|tests?|e2e|playground|cookbook|docs)\//i
  const ENV_MONOREPO_RE  = /^(apps|packages)\/[^/]+\//i
  const ENV_DOTENVX_RE   = /dotenvx/i
  // env_committed scans the FULL repo (rootPaths), not the workspace
  // shadow. Reason: ENV_MONOREPO_RE excludes apps/<ws>/.env files as
  // "per-workspace public defaults, no production secret pattern" —
  // but the path-shadow strips the apps/<ws>/ prefix so that exclusion
  // would no longer trigger. Scanning rootPaths preserves the original
  // intent: a committed real .env at repo root or in a non-workspace
  // dir = secret leak; same file inside a recognized workspace dir =
  // tolerated.
  const env_committed = rootPaths.some(p =>
    ENV_FILE_RE.test(p) &&
    !ENV_DOC_RE.test(p) &&
    !ENV_SKIP_DIR.test(p) &&
    !ENV_MONOREPO_RE.test(p) &&
    !ENV_DOTENVX_RE.test(p)
  )

  // ── Vibe Coder Checklist · 7-category framework (Phase 2 · deep code reading) ──
  // Each category does:
  //   1) Identify a small set of HIGH-LEVERAGE files (regex on path).
  //   2) Fetch the source (cached if shared with other categories).
  //   3) Cross-reference patterns inside the file (not just path/dep scan).
  //   4) Produce both a status flag AND specific evidence file paths.
  //
  // Cost: ~10-20 extra ghText fetches per audit (~50-150 KB of source).
  // Cached per-fetch — duplicate paths counted once.
  const fileCache = new Map<string, string>()
  async function readFile(p: string): Promise<string | null> {
    const hit = fileCache.get(p)
    if (hit !== undefined) return hit
    const t = await ghText(`/contents/${encodeURI(p)}?ref=${defBranch}`)
    fileCache.set(p, t ?? '')
    return t || null
  }

  // 1. WEBHOOK IDEMPOTENCY ·
  // Detect: stripe.webhooks.constructEvent (signature verify) AND
  //         a dedup mechanism (idempotency key check before side effect ·
  //         processedEvents table · redis SET NX · already_processed flag).
  // Mark `pass` only when BOTH appear; `fail` when handler is found but
  // dedup is missing.
  const webhookFiles = paths.filter(p =>
    /(^|\/)(webhooks?|api\/webhook|stripe|payments?)\/[^/]+\.(ts|tsx|js|jsx|mjs|py|go|rs)$/i.test(p) ||
    /(^|\/)api\/.*(webhook|stripe|paypal|payment).*\.(ts|js|tsx|jsx|mjs)$/i.test(p)
  ).slice(0, 6)
  let webhook_handlers_seen = 0
  let webhook_signed_verified = 0
  let webhook_idempotency_seen = 0
  const webhook_evidence_files: string[] = []
  for (const f of webhookFiles) {
    const text = await readFile(f)
    if (!text) continue
    webhook_handlers_seen++
    if (webhook_evidence_files.length < 4) webhook_evidence_files.push(f)
    if (/stripe\.webhooks\.constructEvent|verifyWebhookSignature|svix|stripe-signature|x-hub-signature|x-slack-signature/i.test(text)) {
      webhook_signed_verified++
    }
    // Strong dedup signals (any of these):
    //   - idempotency key referenced
    //   - processedEvents / event_log table check
    //   - redis NX SETNX (atomic dedup)
    //   - "already_processed" / "alreadyProcessed" boolean
    //   - event.id check vs DB
    if (
      /idempotency[_-]?key|Idempotency-Key/i.test(text) ||
      /processed[_-]?events|event[_-]?log/i.test(text) ||
      /SETNX|set\(.+,.+,\s*['"]NX['"]|setIfNotExists/i.test(text) ||
      /already[_-]?processed|alreadyProcessed/i.test(text) ||
      /event\.id\s*[=,]\s*event_id|webhook_id\s*=\s*event\.id/i.test(text)
    ) {
      webhook_idempotency_seen++
    }
  }
  const webhook_gap = webhook_handlers_seen > 0 && webhook_idempotency_seen < webhook_handlers_seen

  // 2. RLS GAPS · per-table coverage
  // Build sets of:
  //   - tables created (CREATE TABLE <name>)
  //   - tables with RLS toggled on (alter table <name> enable row level security)
  //   - tables with at least one policy (CREATE POLICY ... ON <name>)
  // Gap = tables that lack BOTH the toggle AND any policy. State-changing
  // tables (those referenced by INSERT/UPDATE/DELETE) bias the gap as
  // "high impact" — anything writable without RLS is open to all signed-in.
  const tablesCreated   = new Set<string>()
  const tablesWithRls   = new Set<string>()
  const tablesWithPol   = new Set<string>()
  for (const text of sqlSampleCache.values()) {
    const ct = text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.|"public"\.)?\s*"?(\w+)"?/gi)
    for (const m of ct) tablesCreated.add(m[1].toLowerCase())
    const rls = text.matchAll(/alter\s+table\s+(?:public\.|"public"\.)?\s*"?(\w+)"?\s+enable\s+row\s+level\s+security/gi)
    for (const m of rls) tablesWithRls.add(m[1].toLowerCase())
    const pol = text.matchAll(/create\s+policy\s+[^;]*?\bon\s+(?:public\.|"public"\.)?\s*"?(\w+)"?/gi)
    for (const m of pol) tablesWithPol.add(m[1].toLowerCase())
  }
  const tables_uncovered: string[] = []
  for (const t of tablesCreated) {
    if (!tablesWithRls.has(t) && !tablesWithPol.has(t)) tables_uncovered.push(t)
  }
  const rls_gap_count = tables_uncovered.length

  // 3. SECRET CLIENT EXPOSURE · stricter regex + Next.js "use client" boost
  // Reduce noise: only regex match if the line ALSO references env access
  // (process.env.X · import.meta.env.X) or a literal token starting with
  // sk_live_ etc.
  const SECRET_PATTERNS = [
    { re: /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY)/g, label: 'env var' },
    { re: /sk_live_[a-zA-Z0-9]{16,}/g,  label: 'stripe live key' },
    { re: /sk_test_[a-zA-Z0-9]{16,}/g,  label: 'stripe test key' },
    { re: /sk-ant-[a-zA-Z0-9_-]{40,}/g, label: 'anthropic key' },
    { re: /sk-[a-zA-Z0-9]{32,}/g,        label: 'openai key' },
    { re: /AKIA[A-Z0-9]{16}/g,           label: 'aws access key' },
    { re: /github_pat_[A-Za-z0-9_]{20,}|gh[ps]_[A-Za-z0-9_]{30,}/g, label: 'github token' },
  ]
  const clientPaths = paths.filter(p =>
    /\.(ts|tsx|js|jsx|svelte|vue|astro)$/.test(p) &&
    /(^|\/)(src\/(components|pages|app|features|views|screens)|app|pages|components)\//.test(p) &&
    !/(^|\/)(api|server|backend|edge|functions|middleware)\//.test(p) &&
    !/\.(test|spec|stories)\./i.test(p) &&
    !/\.d\.ts$/.test(p)
  ).slice(0, 30)
  const secret_violations: Array<{ file: string; pattern: string; reason: string }> = []
  for (const f of clientPaths) {
    const text = await readFile(f)
    if (!text) continue
    // Skip if file is explicitly server-side ("use server" directive)
    if (/^['"]use server['"]/m.test(text)) continue
    for (const { re, label } of SECRET_PATTERNS) {
      const m = text.match(re)
      if (m && m[0]) {
        const useClient = /^['"]use client['"]/m.test(text)
        secret_violations.push({
          file: f,
          pattern: m[0].slice(0, 40),
          reason: useClient ? `${label} in 'use client' file (definitive bundle leak)` : label,
        })
        break
      }
    }
    if (secret_violations.length >= 6) break
  }

  // 4. DB MISSING INDEXES · per-FK column check within the same SQL file
  // For each migration file, extract:
  //   - FK columns:    `<col_name> ... references <table>(<col>)` or `_id <type>` patterns
  //   - INDEX columns: `create index ... on <table> (<col>)`
  // Per-file gap = FK columns not covered by an index.
  const index_unindexed_columns: Array<{ file: string; column: string; references?: string }> = []
  for (const [filePath, text] of sqlSampleCache) {
    const fkMatches: Array<{ col: string; ref?: string }> = []
    const fkPattern = /(\w+)\s+(?:uuid|integer|bigint|int|serial|text|varchar)[^,)]*?references\s+(\w+)/gi
    for (const m of text.matchAll(fkPattern)) fkMatches.push({ col: m[1], ref: m[2] })
    // _id columns also (common implicit FK convention)
    const idColPattern = /\b(\w+_id)\s+(?:uuid|integer|bigint|int|serial)\b/gi
    for (const m of text.matchAll(idColPattern)) {
      const col = m[1]
      if (!fkMatches.some(x => x.col.toLowerCase() === col.toLowerCase())) fkMatches.push({ col })
    }
    // Indexes in same file: create index ... on <table> (<col>)
    const indexedCols = new Set<string>()
    const ixPattern = /create\s+(?:unique\s+)?index[^;]*?\(\s*"?(\w+)"?/gi
    for (const m of text.matchAll(ixPattern)) indexedCols.add(m[1].toLowerCase())
    // PRIMARY KEY columns get an implicit index — skip
    const pkPattern = /\bprimary\s+key\b[^,)]*?(?:\(\s*(\w+)|(\w+))/gi
    for (const m of text.matchAll(pkPattern)) {
      const col = (m[1] || m[2] || '').toLowerCase()
      if (col) indexedCols.add(col)
    }
    for (const fk of fkMatches) {
      if (!indexedCols.has(fk.col.toLowerCase())) {
        index_unindexed_columns.push({ file: filePath, column: fk.col, references: fk.ref })
        if (index_unindexed_columns.length >= 25) break
      }
    }
    if (index_unindexed_columns.length >= 25) break
  }
  const fk_columns_seen = (() => {
    let n = 0
    for (const text of sqlSampleCache.values()) {
      n += (text.match(/references\s+\w+/gi) || []).length
      n += (text.match(/\b\w+_id\s+(uuid|integer|bigint|int|serial)\b/gi) || []).length
    }
    return n
  })()
  const indexes_seen = (() => {
    let n = 0
    for (const text of sqlSampleCache.values()) n += (text.match(/create\s+(unique\s+)?index/gi) || []).length
    return n
  })()

  // 5. OBSERVABILITY · root + monorepo sub-package package.json scan
  // Re-check observabilityLibs but also check packages/<name>/package.json
  // for monorepo workspaces (root often empty in those).
  const subPackageJsons = paths.filter(p => /^packages\/[^/]+\/package\.json$/.test(p)).slice(0, 6)
  const monorepoObs = new Set<string>(observabilityLibs)
  for (const subPath of subPackageJsons) {
    const text = await readFile(subPath)
    if (!text) continue
    try {
      const sub = JSON.parse(text)
      const subDeps = { ...(sub.dependencies || {}), ...(sub.devDependencies || {}) } as Record<string, string>
      for (const prefix of OBSERVABILITY_LIBS) {
        if (Object.keys(subDeps).some(k => k === prefix || k.startsWith(prefix))) {
          monorepoObs.add(prefix)
        }
      }
    } catch { /* ignore */ }
  }
  const observability_libs_full = [...monorepoObs]

  // 6. RATE LIMIT · package.json libs + middleware presence + bypass detect
  const RATE_LIMIT_LIBS = ['@upstash/ratelimit', 'express-rate-limit', 'rate-limiter-flexible', 'next-rate-limit', 'hono-rate-limiter']
  const allDeps = pkgParsed
    ? { ...((pkgParsed as { dependencies?: Record<string, string> }).dependencies ?? {}), ...((pkgParsed as { devDependencies?: Record<string, string> }).devDependencies ?? {}) }
    : {}
  const rate_limit_lib = RATE_LIMIT_LIBS.find(l => Object.keys(allDeps).some(k => k === l || k.startsWith(l))) ?? null
  // Check sub-packages too
  let rate_limit_lib_in_subpkg: string | null = null
  if (!rate_limit_lib) {
    for (const subPath of subPackageJsons) {
      const text = await readFile(subPath)
      if (!text) continue
      try {
        const sub = JSON.parse(text)
        const subDeps = { ...(sub.dependencies || {}), ...(sub.devDependencies || {}) } as Record<string, string>
        const found = RATE_LIMIT_LIBS.find(l => Object.keys(subDeps).some(k => k === l || k.startsWith(l)))
        if (found) { rate_limit_lib_in_subpkg = found; break }
      } catch { /* ignore */ }
    }
  }
  const middleware_files = paths.filter(p =>
    /(^|\/)(middleware|rate[-_]?limit|throttle)/i.test(p) &&
    /\.(ts|tsx|js|jsx|mjs)$/.test(p)
  ).slice(0, 4)
  let rate_limit_middleware_detected = false
  for (const f of middleware_files) {
    const text = await readFile(f)
    if (text && /rate[_-]?limit|RateLimiter|throttle\(|requestLimit|@upstash\/ratelimit/i.test(text)) {
      rate_limit_middleware_detected = true
      break
    }
  }
  // Monorepo-aware: also matches `apps/<x>/app/api/...`,
  // `packages/<x>/src/api/...`, etc. so cal.com / vercel-ai / supabase-style
  // workspaces don't get 0 detection just because their API lives one
  // level deeper than the conventional repo root.
  const has_api_routes = paths.some(p =>
    /^(?:[^/]+\/)?(app\/api|src\/api|pages\/api|api)\//.test(p) ||
    /^(?:apps|packages)\/[^/]+\/(app\/api|src\/api|pages\/api|api)\//.test(p) ||
    /^supabase\/functions\//.test(p)
  )
  const rate_limit_lib_effective = rate_limit_lib ?? rate_limit_lib_in_subpkg
  const rate_limit_needs_attention = has_api_routes && !rate_limit_lib_effective && !rate_limit_middleware_detected

  // 7. PROMPT INJECTION · improved detection
  // Detect AI usage three ways:
  //   a) npm SDK in package.json (existing)
  //   b) direct fetch to api.anthropic.com / openai.com / api.groq.com
  //   c) `messages: [{ role: 'user', content: ... }]` literal
  // Then check if user input flows in.
  const apiHandlerFiles = paths.filter(p =>
    /^(app\/api|src\/api|pages\/api|api|supabase\/functions)\//.test(p) &&
    /\.(ts|tsx|js|jsx|mjs)$/.test(p)
  ).slice(0, 8)
  const ai_evidence_files: string[] = []
  let direct_ai_fetch_detected = false
  let raw_input_to_prompt_files: string[] = []
  let sanitization_detected = false
  for (const f of apiHandlerFiles) {
    const text = await readFile(f)
    if (!text) continue
    const aiSignals =
      /from\s+['"](?:@anthropic-ai\/sdk|openai|@google\/generative|langchain|llamaindex|ai\b)/i.test(text) ||
      /api\.anthropic\.com|api\.openai\.com|api\.groq\.com|api\.cohere\.ai|generativelanguage\.googleapis\.com/i.test(text) ||
      /messages\s*:\s*\[\s*\{\s*role\s*:\s*['"](?:user|system|assistant)['"]/i.test(text)
    if (!aiSignals) continue
    if (ai_evidence_files.length < 4) ai_evidence_files.push(f)
    if (/api\.(anthropic|openai|groq|cohere)/i.test(text)) direct_ai_fetch_detected = true
    const inlinesUserInput =
      /(prompt|content|messages?)\s*[:=][^\n]*?(req\.body|request\.body|params\.|searchParams\.get|body\.|payload\.|input\.|message\.)/i.test(text) ||
      /\$\{(?:req\.body|request\.body|body|params|input|message|userMessage|userInput)\b[^}]*\}/i.test(text)
    if (inlinesUserInput) raw_input_to_prompt_files.push(f)
    // Sanitization heuristic: zod / yup parse, .slice() length cap, replace control chars
    if (
      /(zod|z\.object|z\.string\(\)\.\w+|yup\.|joi\.|validator\.|sanitize|escape)/i.test(text) ||
      /\.slice\(0,\s*\d{2,5}\)|\.substring\(0,\s*\d{2,5}\)/i.test(text)
    ) {
      sanitization_detected = true
    }
    if (raw_input_to_prompt_files.length >= 4) break
  }
  const uses_ai_sdk = aiLibs.length > 0 || direct_ai_fetch_detected || ai_evidence_files.length > 0
  const prompt_injection_suspicious = raw_input_to_prompt_files.length > 0 && !sanitization_detected

  // ── Extension frames 8-11 (added 2026-04-30) · AI-template-copy footguns
  // We piggyback on apiHandlerFiles + a small additional scan set to keep
  // network cost low. Each frame returns top-3 evidence samples.
  const extScanFiles = paths.filter(p =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) &&
    !/\b(node_modules|\.next|dist|build|coverage|\.test\.|\.spec\.|__tests__|fixtures?|mocks?|scripts?\/)\b/i.test(p)
  ).slice(0, 30)

  // 8. HARDCODED URLs · localhost · 127.0.0.1 · explicit production API
  // bases that should be env-driven.
  const hardcoded_url_samples: Array<{ file: string; pattern: string }> = []
  // 9. MOCK DATA · arrays of inline object literals in app paths.
  const mock_data_samples: Array<{ file: string; collection: string }> = []
  // 10. WEBHOOK SIGNATURE · separate from idempotency. Webhook handlers
  // present but no signature verification.
  let webhook_sig_handlers = 0
  let webhook_sig_verified = 0
  const webhook_sig_evidence: string[] = []
  // 11. CORS PERMISSIVE · `origin: '*'` or `Access-Control-Allow-Origin: *`.
  const cors_perm_samples: Array<{ file: string; pattern: string }> = []
  // 12. MOBILE INPUT ZOOM · iOS Safari auto-zooms a focused input/textarea
  //     whose computed font-size is below 16px. Catches the common
  //     `<input className="text-sm">` Tailwind pattern + inline
  //     `style={{ fontSize: '14px' }}`. False-positive guard: ignore
  //     classNames that contain a sm:/md:/lg: escape hatch upgrading the
  //     font on larger viewports — that's intentional.
  const mobile_zoom_samples: Array<{ file: string; pattern: string }> = []

  for (const f of extScanFiles) {
    if (
      hardcoded_url_samples.length >= 3 &&
      mock_data_samples.length >= 3 &&
      cors_perm_samples.length >= 3 &&
      mobile_zoom_samples.length >= 3
    ) break
    const text = await readFile(f)
    if (!text) continue

    if (hardcoded_url_samples.length < 3) {
      const hcMatch = text.match(/['"](https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^'"\s]*)['"]/i)
      if (hcMatch) hardcoded_url_samples.push({ file: f, pattern: hcMatch[1] })
    }
    if (mock_data_samples.length < 3) {
      // Pattern: `const <name> = [{ ... }, { ... }, { ... }]` (3+ object literals)
      const mdMatch = text.match(/const\s+(\w+)\s*=\s*\[\s*\{[^}]+\}\s*,\s*\{[^}]+\}\s*,\s*\{/i)
      if (mdMatch) mock_data_samples.push({ file: f, collection: mdMatch[1] })
    }
    if (cors_perm_samples.length < 3) {
      const corsMatch = text.match(/cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/i)
                     ?? text.match(/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/i)
                     ?? text.match(/cors\s*\(\s*\{[^}]*origin\s*:\s*true\b/i)
      if (corsMatch) cors_perm_samples.push({ file: f, pattern: corsMatch[0].slice(0, 80) })
    }
    if (mobile_zoom_samples.length < 3) {
      // (a) inline style fontSize < 16px on input/textarea
      const inlineRe = /<\s*(?:input|textarea)\b[^>]*style\s*=\s*\{\{[^}]*fontSize\s*:\s*['"]?(\d+)\s*px/gi
      let im: RegExpExecArray | null
      let added = false
      while ((im = inlineRe.exec(text)) !== null) {
        const px = parseInt(im[1], 10)
        if (px < 16) {
          mobile_zoom_samples.push({ file: f, pattern: `inline ${px}px` })
          added = true
          break
        }
      }
      // (b) Tailwind text-xs / text-sm on input/textarea without a sm:/md:/lg:
      // base+/lg/xl override (those signal an intentional mobile-first bump).
      if (!added) {
        const twRe = /<\s*(?:input|textarea)\b[^>]*className\s*=\s*['"]([^'"]+)['"]/gi
        let cm: RegExpExecArray | null
        while ((cm = twRe.exec(text)) !== null) {
          const cls = cm[1]
          const small = cls.match(/\btext-(xs|sm)\b/)
          const mobileEscape = /\b(?:sm|md|lg|xl):text-(?:base|lg|xl|2xl|3xl)\b/.test(cls)
          if (small && !mobileEscape) {
            mobile_zoom_samples.push({ file: f, pattern: `class .text-${small[1]}` })
            break
          }
        }
      }
    }
  }

  // Webhook signature: scan webhook handler files for HMAC / lib verifier patterns.
  for (const f of webhook_evidence_files.slice(0, 6)) {
    const text = await readFile(f)
    if (!text) continue
    webhook_sig_handlers++
    const hasSig =
      /constructEvent|stripeWebhook|verifyWebhookSignature/i.test(text) ||
      /createHmac\s*\(\s*['"](?:sha256|sha1)/i.test(text) ||
      /x-hub-signature|x-slack-signature|x-github-(?:event|delivery|signature)|stripe-signature/i.test(text)
    if (hasSig) {
      webhook_sig_verified++
      if (webhook_sig_evidence.length < 3) webhook_sig_evidence.push(f)
    }
  }
  const webhook_sig_gap = webhook_sig_handlers > 0 && webhook_sig_verified === 0

  // 13. COLUMN GRANT MISMATCH · table uses column-level GRANT SELECT (privacy
  // pattern · 'GRANT SELECT (col1, col2, ...) ON tbl TO anon, authenticated')
  // and a later migration ADD COLUMN'd a column without granting it. The
  // matching SELECT will return 42501 'permission denied for table' from
  // PostgREST · supabase-js silently treats it as no row · production-
  // critical bugs land masked. We scan ALL sql sample files (cached during
  // RLS scan above) twice: first pass collects (table → set of cols ever
  // granted), second pass extracts ADD COLUMN events; gap = column added
  // to a known column-grant table whose grant set never received it.
  const column_grant_samples: Array<{ table: string; column: string; sql_file: string }> = []
  {
    const grantedCols   = new Map<string, Set<string>>()           // table → cols ever GRANTed
    const addedCols     : Array<{ table: string; column: string; sql_file: string }> = []
    const grantPattern  = /grant\s+(?:select|all)\s*(?:\(\s*([^)]+)\))?\s+on\s+(?:public\.|"public"\.)?\s*"?(\w+)"?/gi
    // Match ADD COLUMN explicitly so that ADD CONSTRAINT / ADD PRIMARY KEY /
    // ADD FOREIGN KEY etc. don't masquerade as new columns. The 'column'
    // keyword is mandatory — implicit-column form (`ADD foo type`) is rare
    // enough in practice that we'd rather miss it than flood with false
    // positives on every constraint statement.
    const addColPattern = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.|"public"\.)?\s*"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi
    for (const [filePath, text] of sqlSampleCache) {
      let gm: RegExpExecArray | null
      while ((gm = grantPattern.exec(text)) !== null) {
        const cols = (gm[1] ?? '').split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean)
        const tbl  = gm[2].toLowerCase()
        // No column list = table-level grant · we only flag tables that have
        // *at least one* column-level grant (i.e. the privacy pattern). A
        // table-level grant later means the privacy pattern was abandoned;
        // record an empty marker just so we know the table appears in grants.
        if (!grantedCols.has(tbl)) grantedCols.set(tbl, new Set())
        if (cols.length > 0) for (const c of cols) grantedCols.get(tbl)!.add(c)
      }
      let am: RegExpExecArray | null
      while ((am = addColPattern.exec(text)) !== null) {
        addedCols.push({ table: am[1].toLowerCase(), column: am[2].toLowerCase(), sql_file: filePath })
      }
    }
    // Tables that use column-level pattern: at least one column-level GRANT
    // statement seen (set has any column). Tables with empty set = table-
    // level grant only · don't flag those.
    const columnLevelTables = new Set<string>()
    for (const [tbl, cols] of grantedCols) if (cols.size > 0) columnLevelTables.add(tbl)
    for (const ev of addedCols) {
      if (!columnLevelTables.has(ev.table)) continue
      const grants = grantedCols.get(ev.table) ?? new Set()
      if (grants.has(ev.column)) continue
      // Skip privacy-intent column names (email-like) · these are commonly
      // intentionally restricted. Conservative — false negative is safer
      // than false positive for a public-readable column claim.
      if (/(email|password|secret|token|provider_id|hash)$/.test(ev.column)) continue
      column_grant_samples.push(ev)
      if (column_grant_samples.length >= 12) break
    }
  }

  // 14. STRIPE API IDEMPOTENCY · outbound POST to Stripe (Checkout sessions,
  // PaymentIntents, Charges, Customers, Subscriptions, Refunds, Transfers,
  // SetupIntents) without an Idempotency-Key. Network retry or a double-
  // clicked Pay button can spawn a duplicate session → duplicate charge.
  // The Stripe SDK accepts `{ idempotencyKey }` as a second-arg request
  // option · curl/fetch impls use the `Idempotency-Key` header. Both forms
  // count as protected.
  const stripe_api_samples: Array<{ file: string; pattern: string }> = []
  let stripe_api_call_sites = 0
  let stripe_api_idempotent = 0
  {
    const stripeWriteRe = /\bstripe\.[A-Za-z][A-Za-z0-9_.]*\.(?:create|update|cancel|retrieve|list)\s*\(/g
    // Match the protected forms:
    //   1. SDK option object property:           `idempotencyKey: 'foo'` or shorthand `{ idempotencyKey }`
    //   2. HTTP header string (raw fetch / curl): `'Idempotency-Key': 'foo'`
    // Both forms count — we don't need to distinguish at this granularity.
    const idempotencyRe = /\bidempotency[Kk]ey\b|['"]Idempotency-Key['"]/
    const stripeFiles = paths.filter(p =>
      /\.(ts|tsx|js|jsx|mjs|py|go|rs)$/.test(p) &&
      !/\.(test|spec|stories)\./i.test(p),
    ).slice(0, 40)
    for (const f of stripeFiles) {
      if (stripe_api_samples.length >= 6 && stripe_api_call_sites > 8) break
      const text = await readFile(f)
      if (!text) continue
      const writes: string[] = []
      let wm: RegExpExecArray | null
      while ((wm = stripeWriteRe.exec(text)) !== null) {
        // Only count meaningful writes — `.retrieve(`, `.list(` are reads
        // and don't need idempotency. Filter the regex result on suffix.
        if (/\.(create|update|cancel)\s*\($/.test(wm[0])) writes.push(wm[0])
      }
      if (writes.length === 0) continue
      stripe_api_call_sites += writes.length
      const fileHasIdempotency = idempotencyRe.test(text)
      if (fileHasIdempotency) {
        stripe_api_idempotent += writes.length
      } else if (stripe_api_samples.length < 6) {
        stripe_api_samples.push({ file: f, pattern: writes[0].slice(0, 40) })
      }
    }
  }
  const stripe_api_gap = stripe_api_call_sites > 0 && stripe_api_idempotent < stripe_api_call_sites

  // Aggregate vibe_concerns object — surfaced both to Claude evidence pack
  // and persisted in github_signals for UI rendering. Each category now
  // ships an `evidence_files` array so the UI can show specific paths.
  const vibe_concerns = {
    webhook_idempotency: {
      handlers_seen: webhook_handlers_seen,
      idempotency_signal_seen: webhook_idempotency_seen,
      signature_verified_seen: webhook_signed_verified,
      gap: webhook_gap,
      sample_files: webhook_evidence_files,
    },
    rls_gaps: {
      tables: createTableCount,
      policies: rlsPolicyCount,
      writable_table_signals: 0,                 // legacy field · kept for back-compat (UI ignores)
      gap_estimate: rls_gap_count,
      tables_uncovered: tables_uncovered.slice(0, 12),
      has_rls_intent: hasRls,
    },
    secret_exposure: {
      client_violations: secret_violations,
      total: secret_violations.length,
    },
    db_indexes: {
      fk_columns_seen,
      indexes_seen,
      gap_estimate: index_unindexed_columns.length,
      unindexed_samples: index_unindexed_columns.slice(0, 8),
    },
    observability: {
      libs: observability_libs_full,
      detected: observability_libs_full.length > 0,
      checked_subpackages: subPackageJsons.length,
    },
    rate_limit: {
      lib_detected: rate_limit_lib_effective,
      middleware_detected: rate_limit_middleware_detected,
      has_api_routes,
      needs_attention: rate_limit_needs_attention,
    },
    prompt_injection: {
      uses_ai_sdk,
      ai_evidence_files,
      raw_input_to_prompt_files,
      sanitization_detected,
      suspicious: prompt_injection_suspicious,
    },
    // Extension frames (8-11) · 2026-04-30
    hardcoded_urls: {
      samples: hardcoded_url_samples,
      total:   hardcoded_url_samples.length,
    },
    mock_data: {
      samples: mock_data_samples,
      total:   mock_data_samples.length,
    },
    webhook_signature: {
      handlers_seen: webhook_sig_handlers,
      verified_seen: webhook_sig_verified,
      gap:           webhook_sig_gap,
      sample_files:  webhook_sig_evidence,
    },
    cors_permissive: {
      samples: cors_perm_samples,
      total:   cors_perm_samples.length,
    },
    mobile_input_zoom: {
      samples:         mobile_zoom_samples,
      total:           mobile_zoom_samples.length,
      needs_attention: mobile_zoom_samples.length > 0,
    },
    column_grant_mismatch: {
      samples:         column_grant_samples,
      total:           column_grant_samples.length,
      needs_attention: column_grant_samples.length > 0,
    },
    stripe_api_idempotency: {
      call_sites:           stripe_api_call_sites,
      idempotent_call_sites: stripe_api_idempotent,
      gap:                  stripe_api_gap,
      samples:              stripe_api_samples,
    },
  }

  // ── SaaS form detection (sub-form of 'app') ──
  // Lighthouse on a SaaS landing page measures the marketing slice, not
  // the auth-walled product. So for SaaS we shift weight away from LH
  // toward Production Maturity + a new Backend Signals slot derived
  // from vibe_concerns (RLS · webhook · indexes · rate-limit · secrets).
  //
  // Heuristic: app-form + has API routes + has DB layer + has auth
  // boundary signals. Conservative — we'd rather miss SaaS detection
  // than misclassify a marketing site.
  const has_db_layer = (() => {
    const allDeps = pkgParsed
      ? { ...((pkgParsed as { dependencies?: Record<string, string> }).dependencies ?? {}),
          ...((pkgParsed as { devDependencies?: Record<string, string> }).devDependencies ?? {}) }
      : {} as Record<string, string>
    const dbLibs = ['@supabase/supabase-js', '@prisma/client', 'prisma', 'drizzle-orm',
                    'kysely', '@neondatabase/serverless', 'mongodb', 'pg', 'mysql2',
                    '@planetscale/database', 'firebase']
    return dbLibs.some(l => Object.keys(allDeps).some(k => k === l || k.startsWith(l)))
        || sqlFiles.length >= 2
        || hasRls
  })()
  const has_auth_signals = (() => {
    const allDeps = pkgParsed
      ? { ...((pkgParsed as { dependencies?: Record<string, string> }).dependencies ?? {}),
          ...((pkgParsed as { devDependencies?: Record<string, string> }).devDependencies ?? {}) }
      : {} as Record<string, string>
    const authLibs = ['next-auth', '@auth/', 'clerk', '@clerk/', '@supabase/auth-helpers',
                       'lucia', 'iron-session', 'jose', 'passport']
    if (authLibs.some(l => Object.keys(allDeps).some(k => k === l || k.startsWith(l)))) return true
    // Path-based: middleware.ts at root or app · auth/ subdirs
    return paths.some(p =>
      /^(app\/middleware|src\/middleware|middleware)\.(ts|js|tsx|jsx)$/.test(p) ||
      /(^|\/)(auth|sign-in|signin|login|signup)\/[^/]+\.(ts|tsx|js|jsx)$/.test(p)
    )
  })()
  const is_saas = has_api_routes && has_db_layer && has_auth_signals

  // ── Native-app distribution + permissions signals ──
  // Detected once and surfaced through gh.signals so the slot scorer
  // (outside fetchGithub) can use them without re-walking paths.
  const has_permissions_manifest =
    paths.some(p => /AndroidManifest\.xml$/.test(p)) ||
    paths.some(p => /Info\.plist$/.test(p)) ||
    paths.some(p => /entitlements\.plist$/.test(p))
  const has_app_store      = /apps\.apple\.com|itunes\.apple\.com\/[a-z]{2}\/app/i.test(readmeRaw ?? '')
  const has_play_store     = /play\.google\.com\/store\/apps/i.test(readmeRaw ?? '')
  const has_test_flight    = /testflight\.apple\.com\/join/i.test(readmeRaw ?? '')
  const has_f_droid        = /f-droid\.org\/packages/i.test(readmeRaw ?? '')
  const has_release_binary = /\.(apk|aab|dmg|exe|msi|pkg|deb|rpm|appimage)\b/i.test(readmeRaw ?? '')
  const has_privacy_policy = /privacy[\s-]*policy|개인정보\s*처리방침/i.test(readmeRaw ?? '') &&
    /https?:\/\//.test(readmeRaw ?? '')

  // ── Native-app footguns (extension · 2026-04-30) ──
  // Three checks specific to mobile / desktop apps. Conservative scan
  // budget: read at most one AndroidManifest + one Info.plist + a few
  // native source files for hardcoded keys.
  let android_perm_count = 0
  const android_dangerous_perms: string[] = []
  const ios_usage_keys:        string[] = []
  const ios_missing_descs:     string[] = []
  const native_secret_samples: Array<{ file: string; pattern: string }> = []

  // AndroidManifest.xml — count <uses-permission> + flag dangerous ones
  const androidManifestPath = paths.find(p => /AndroidManifest\.xml$/.test(p))
  if (androidManifestPath) {
    const xml = await readFile(androidManifestPath)
    if (xml) {
      const matches = xml.match(/<uses-permission[^>]+android:name="[^"]+"/g) ?? []
      android_perm_count = matches.length
      const DANGEROUS = [
        'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
        'READ_CONTACTS', 'READ_CALL_LOG', 'READ_SMS', 'READ_MEDIA_IMAGES',
        'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'BLUETOOTH_SCAN',
        'BLUETOOTH_CONNECT', 'POST_NOTIFICATIONS', 'BODY_SENSORS',
        'READ_PHONE_STATE', 'CALL_PHONE', 'SYSTEM_ALERT_WINDOW',
      ]
      for (const m of matches) {
        const nameMatch = m.match(/android:name="([^"]+)"/)
        if (nameMatch) {
          const perm = nameMatch[1].split('.').pop() ?? ''
          if (DANGEROUS.includes(perm) && !android_dangerous_perms.includes(perm)) {
            android_dangerous_perms.push(perm)
          }
        }
      }
    }
  }

  // iOS Info.plist — list NS*UsageDescription keys; flag entries that
  // look used elsewhere but missing description string.
  const iosPlistPath = paths.find(p => /Info\.plist$/.test(p))
  if (iosPlistPath) {
    const plist = await readFile(iosPlistPath)
    if (plist) {
      const keyMatches = plist.match(/<key>NS\w+UsageDescription<\/key>\s*<string>([^<]*)<\/string>/g) ?? []
      for (const km of keyMatches) {
        const k = km.match(/<key>(NS\w+UsageDescription)<\/key>/)?.[1]
        const v = km.match(/<string>([^<]*)<\/string>/)?.[1] ?? ''
        if (k) {
          ios_usage_keys.push(k)
          if (v.trim().length === 0) ios_missing_descs.push(k)
        }
      }
    }
  }

  // Privacy manifest (PrivacyInfo.xcprivacy) · iOS 17+ App Store gate (2024).
  const has_privacy_manifest = paths.some(p => /PrivacyInfo\.xcprivacy$/.test(p))

  // Hardcoded API keys / secrets in native source files (Swift / Kotlin /
  // Java / Dart). Common AI footgun: Stripe live key, Google Maps key,
  // Firebase API key embedded in source. We scan a small budget.
  const nativeSourceFiles = paths.filter(p =>
    /\.(swift|kt|java|dart|m|mm)$/.test(p) &&
    !/\b(test|tests|__tests__|build|generated|node_modules)\b/i.test(p)
  ).slice(0, 12)
  for (const f of nativeSourceFiles) {
    if (native_secret_samples.length >= 3) break
    const text = await readFile(f)
    if (!text) continue
    // Patterns: pk_live_ · sk_live_ · sk_test_ · AKIA[A-Z0-9]{16} · AIza[0-9A-Za-z_-]{35} · "Bearer ey" jwt-style · googleAPIKey="…"
    const m =
      text.match(/(sk_(?:live|test)_[A-Za-z0-9]{20,})/) ||
      text.match(/(pk_live_[A-Za-z0-9]{20,})/) ||
      text.match(/(AKIA[A-Z0-9]{16})/) ||
      text.match(/(AIza[0-9A-Za-z_-]{35})/) ||
      text.match(/(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/) ||
      text.match(/["'](?:googleAPIKey|apiKey|API_KEY|stripeKey|firebaseApiKey)["']\s*[:=]\s*["']([^"'\s]{20,})["']/i)
    if (m) native_secret_samples.push({ file: f, pattern: m[1].slice(0, 20) + '…' })
  }

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
      scanned_scope,                    // human-readable description of what was actually audited (transparency for monorepos)
      form_factor,                      // mirror of gh.form_factor so snapshot.github_signals retains it (B18)
      is_saas,                          // SaaS sub-form (app + api routes + db + auth) · 2026-04-29
      has_auth_signals,
      has_db_layer,
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
      has_permissions_manifest,
      has_app_store,
      has_play_store,
      has_test_flight,
      has_f_droid,
      has_release_binary,
      has_privacy_policy,
      native_permissions_overreach: {
        android_count:            android_perm_count,
        android_dangerous:        android_dangerous_perms,
        ios_keys:                 ios_usage_keys,
        ios_missing_descriptions: ios_missing_descs,
      },
      native_secrets_in_bundle: {
        samples: native_secret_samples,
        total:   native_secret_samples.length,
      },
      has_privacy_manifest,
      has_skill_md,
      has_skill_canonical,
      has_plugin_manifest,
      skill_frontmatter_valid,
      skill_description_chars,
      vibe_concerns,
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
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: BROWSER_PROBE_HEADERS,
    })
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
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        signal: ctrl.signal,
        redirect: 'follow',
        headers: BROWSER_PROBE_HEADERS,
      })
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

// Browser-like headers for outbound site probes. Without a real UA, many
// hosts (Vercel/Cloudflare bot-fight · WAF rules · firewall preset 'block
// non-browser') return 0 / 403 even though the site is healthy. blockbuster
// lab.com → curl gets 200, edge fn got 0 → -5pt unfair penalty. Match
// modern Chrome-on-Linux closely.
const BROWSER_PROBE_HEADERS: Record<string, string> = {
  'user-agent':       'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language':  'en-US,en;q=0.9',
  'accept-encoding':  'gzip, deflate, br',
  'cache-control':    'no-cache',
  'pragma':           'no-cache',
  'sec-ch-ua':        '"Chromium";v="126", "Not(A:Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest':   'document',
  'sec-fetch-mode':   'navigate',
  'sec-fetch-site':   'none',
  'sec-fetch-user':   '?1',
  'upgrade-insecure-requests': '1',
}

// ── Live URL health ───────────────────────────────────────────
async function liveHealth(url: string) {
  const t0 = performance.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: BROWSER_PROBE_HEADERS,
    })
    clearTimeout(timer)
    return { status: res.status, ok: res.ok, elapsed_ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { status: 0, ok: false, elapsed_ms: Math.round(performance.now() - t0), error: String(e) }
  }
}

// ── Multi-route probe (§15-E.2 · Tier A) ──────────────────────
// homepage 200 만 보던 Live URL Health 슬롯이 form_factor='app' 의
// 진짜 "사용자가 클릭하는 라우트들" 상태를 못 본다는 한계 → sitemap.xml
// 또는 homepage <a> 에서 같은 origin internal route 6개를 추가 probe.
// /pricing 이 500, /signup 이 404 같은 실패를 잡아낸다 (vibe coding
// 흔한 패턴 — homepage 만 잘 만들고 나머지 placeholder).
//
// Cost: 6 × HEAD/GET (4s timeout each) = ~3-5s wall · 인프라 0.
// Playwright (Tier B) 없이도 라우팅 살아있나는 검증 가능.

interface RouteHealthItem {
  path: string
  status: number
  ttfb_ms: number
  ok: boolean
}
interface RoutesHealth {
  probed:             number
  reachable:          number
  broken:             number
  reachable_rate:     number   // 0-1 · 슬롯 fold-in 용
  items:              RouteHealthItem[]
  broken_paths:       string[]   // Claude evidence prompt surface
  sitemap_present:    boolean
  sitemap_url_count:  number
}

const PRIORITY_ROUTE_PATHS = [
  '/pricing', '/signup', '/sign-up', '/login', '/sign-in',
  '/docs', '/documentation', '/about', '/blog', '/features',
  '/contact', '/dashboard', '/app',
]

async function probeOneRoute(url: string): Promise<RouteHealthItem> {
  const t0 = performance.now()
  const path = (() => { try { return new URL(url).pathname || '/' } catch { return url } })()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    // Some hosts 405 on HEAD (e.g. Vercel SSR routes) — GET is the safer
    // probe. Body discarded; we only need status + timing.
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: BROWSER_PROBE_HEADERS,
    })
    clearTimeout(timer)
    try { res.body?.cancel() } catch { /* ignore */ }
    return {
      path,
      status: res.status,
      ttfb_ms: Math.round(performance.now() - t0),
      ok: res.ok,
    }
  } catch {
    return { path, status: 0, ttfb_ms: Math.round(performance.now() - t0), ok: false }
  }
}

async function discoverRoutes(baseUrl: string): Promise<{ routes: string[]; sitemap_present: boolean; sitemap_url_count: number }> {
  let origin: string
  try { origin = new URL(baseUrl).origin }
  catch { return { routes: [], sitemap_present: false, sitemap_url_count: 0 } }

  const found = new Set<string>()
  let sitemap_present = false
  let sitemap_url_count = 0

  // 1) sitemap.xml 우선 — owner-declared source of truth
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${origin}/sitemap.xml`, {
      method: 'GET', signal: ctrl.signal, redirect: 'follow',
      headers: BROWSER_PROBE_HEADERS,
    })
    clearTimeout(timer)
    if (res.ok) {
      const xml = (await res.text()).slice(0, 200_000)
      sitemap_present = true
      // 빠른 정규식 추출 — XML parser 끌어들이면 Edge runtime 무거움.
      const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || []
      sitemap_url_count = matches.length
      for (const m of matches.slice(0, 40)) {
        const u = m.replace(/<\/?loc>/g, '').trim()
        try {
          const parsed = new URL(u)
          if (parsed.origin === origin && parsed.pathname !== '/') {
            found.add(parsed.pathname)
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore — fall back to <a href> below */ }

  // 2) homepage <a href> · sitemap 없거나 부족하면 보강
  if (found.size < 6) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(origin, {
        method: 'GET', signal: ctrl.signal, redirect: 'follow',
        headers: BROWSER_PROBE_HEADERS,
      })
      clearTimeout(timer)
      if (res.ok) {
        // 64KB · head + 첫 화면 영역의 nav 만 잡으면 충분
        const reader = res.body?.getReader()
        let html = ''
        if (reader) {
          const dec = new TextDecoder()
          let total = 0
          while (total < 65_536) {
            const { value, done } = await reader.read()
            if (done) break
            html += dec.decode(value, { stream: true })
            total += value.byteLength
          }
          try { reader.cancel() } catch { /* ignore */ }
        } else {
          html = (await res.text()).slice(0, 65_536)
        }
        const hrefMatches = html.match(/href\s*=\s*["']([^"']+)["']/gi) || []
        for (const raw of hrefMatches) {
          const m = raw.match(/href\s*=\s*["']([^"']+)["']/i)
          if (!m) continue
          const href = m[1]
          // 같은 origin internal route 만
          let path: string | null = null
          try {
            if (href.startsWith('/') && !href.startsWith('//')) {
              path = href.split('#')[0].split('?')[0]
            } else if (href.startsWith(origin)) {
              path = new URL(href).pathname
            } else if (/^https?:\/\//i.test(href)) {
              continue
            }
          } catch { continue }
          if (!path || path === '/' || path.length > 80) continue
          // 자산 경로 제외
          if (/\.(css|js|map|json|xml|ico|svg|png|jpe?g|webp|gif|mp4|woff2?|ttf|pdf|txt)(\?|$)/i.test(path)) continue
          if (path.startsWith('/api/') || path.startsWith('/assets/') || path.startsWith('/_')) continue
          found.add(path)
        }
      }
    } catch { /* ignore */ }
  }

  // 3) Priority 정렬 — /pricing /signup 같은 핵심 라우트 우선
  const prioritized: string[] = []
  for (const p of PRIORITY_ROUTE_PATHS) if (found.has(p)) { prioritized.push(p); found.delete(p) }
  for (const p of Array.from(found).slice(0, 12)) prioritized.push(p)

  return { routes: prioritized.slice(0, 6), sitemap_present, sitemap_url_count }
}

// ── Tier B · Playwright deep probe via deep-probe Edge Function ─────
// (§15-E.3) Calls the deep-probe Edge Function which invokes Cloudflare
// Browser Rendering for post-hydration HTML + hydration framework
// detection + runtime meta tag recovery. Used to defeat bot protection
// (CF bot fight · Akamai · DataDome) that blocks our static `fetch` and
// to surface SPA content that's only visible after JS hydrates.
//
// V1 cost-control: only runs on URL Fast Lane projects (no github_url) ·
// repo-lane projects already have rich Tier A signals + repo evidence.
// Falls through gracefully when CF credentials aren't set on the server.

interface DeepProbeMetaTags {
  has_og_title:       boolean
  has_og_image:       boolean
  has_og_description: boolean
  has_twitter_card:   boolean
  has_canonical:      boolean
  has_meta_desc:      boolean
  has_h1:             boolean
  h1_text:            string | null
  og_image_url:       string | null
}
interface DeepProbeResult {
  fetched:                    boolean
  via:                       'cf-browser-rendering' | 'skipped' | 'failed'
  html_length:                number
  post_hydration_text_length: number
  hydration_framework:        string | null
  hydration_markers_found:    string[]
  meta_tags:                  DeepProbeMetaTags
  proven_reachable:           boolean
  screenshot_url:             string | null     // §15-E.3 wave 5 · uploaded to audit-screenshots bucket
  error:                      string | null
}
const DEEP_PROBE_BLANK: DeepProbeResult = {
  fetched: false, via: 'skipped',
  html_length: 0, post_hydration_text_length: 0,
  hydration_framework: null, hydration_markers_found: [],
  meta_tags: {
    has_og_title: false, has_og_image: false, has_og_description: false,
    has_twitter_card: false, has_canonical: false, has_meta_desc: false,
    has_h1: false, h1_text: null, og_image_url: null,
  },
  proven_reachable: false,
  screenshot_url: null,
  error: null,
}

async function callDeepProbeOne(url: string): Promise<DeepProbeResult> {
  if (!url) return DEEP_PROBE_BLANK
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return DEEP_PROBE_BLANK

  try {
    // Hard 18s ceiling · analyze-project total wall is 150s · parallel with
    // Lighthouse (~60s) and Claude (~90s) follow-up. Fail-soft to BLANK.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 18_000)
    const res = await fetch(`${supabaseUrl}/functions/v1/deep-probe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body:    JSON.stringify({ url }),
      signal:  ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ...DEEP_PROBE_BLANK, via: 'failed', error: `http_${res.status}` }
    const data = await res.json() as DeepProbeResult
    return data && typeof data === 'object' ? data : DEEP_PROBE_BLANK
  } catch (e) {
    return { ...DEEP_PROBE_BLANK, via: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

// §15-E.3 deep probe · homepage only (2026-05-09 reverted from multi-page
// to fit CF Browser Rendering free-tier 10/min cap). The deep-probe
// Edge Function makes /content + /screenshot in parallel = 2 CF calls
// per audit. With multi-page (3 /content × N pages + 1 /screenshot) we
// hit CF rate limit "cf_429: Rate limit exceeded" within 2-3 audits/min.
// 2-call sustainable: 5 audits/min on free tier.
//
// Trade-off: lose meta UNION across /pricing /about. For most sites this
// is fine — homepage meta + Tier A static fetch UNION already covers
// the typical case. Multi-page can return when CF is upgraded to paid
// (Workers Paid plan has 6× higher Browser Rendering quota).
async function callDeepProbe(homepageUrl: string): Promise<DeepProbeResult> {
  if (!homepageUrl) return DEEP_PROBE_BLANK
  return callDeepProbeOne(homepageUrl)
}

async function inspectMultiRoutes(baseUrl: string): Promise<RoutesHealth> {
  const blank: RoutesHealth = {
    probed: 0, reachable: 0, broken: 0, reachable_rate: 0,
    items: [], broken_paths: [],
    sitemap_present: false, sitemap_url_count: 0,
  }
  if (!baseUrl) return blank

  let origin: string
  try { origin = new URL(baseUrl).origin }
  catch { return blank }

  const { routes, sitemap_present, sitemap_url_count } = await discoverRoutes(baseUrl)
  if (routes.length === 0) {
    return { ...blank, sitemap_present, sitemap_url_count }
  }

  const items = await Promise.all(routes.map(p => probeOneRoute(`${origin}${p}`)))
  const reachable = items.filter(i => i.ok).length
  const broken    = items.length - reachable

  return {
    probed: items.length,
    reachable,
    broken,
    reachable_rate: items.length ? reachable / items.length : 0,
    items,
    broken_paths: items.filter(i => !i.ok).map(i => i.path),
    sitemap_present,
    sitemap_url_count,
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
  // §15-E.6 wave 6 · resolved og:image URL · used as thumbnail fallback for
  // BOTH repo audits and URL fast lane (Tier A only call · cheap regex
  // on the already-fetched head HTML · no extra fetch).
  og_image_url:      string | null
}

async function inspectCompleteness(url: string): Promise<CompletenessSignals> {
  const blank: CompletenessSignals = {
    fetched: false,
    has_og_image: false, has_og_title: false, has_og_description: false,
    has_twitter_card: false, has_apple_touch: false, has_manifest: false,
    has_theme_color: false, has_favicon: false, has_canonical: false,
    has_meta_desc: false,
    score: 0, filled: 0, of: 10,
    og_image_url: null,
  }
  if (!url) return blank
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      method: 'GET', signal: ctrl.signal, redirect: 'follow',
      headers: BROWSER_PROBE_HEADERS,
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
      og_image_url: null,
    }

    // §15-E.6 wave 6 · og:image URL extraction (Tier A · free · same head HTML)
    // Same fallback chain as Tier B: og:image:url → og:image → twitter:image.
    // Resolves relative URLs against the page URL so consumers (ProjectDetail
    // hero thumbnail) can use the result directly.
    const ogPatterns: RegExp[] = [
      /<meta\s+(?:[^>]*\s+)?property=["']og:image:url["'][^>]*\s+content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*\s+)?content=["']([^"']+)["'][^>]*\s+property=["']og:image:url["']/i,
      /<meta\s+(?:[^>]*\s+)?property=["']og:image["'][^>]*\s+content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*\s+)?content=["']([^"']+)["'][^>]*\s+property=["']og:image["']/i,
      /<meta\s+(?:[^>]*\s+)?name=["']twitter:image["'][^>]*\s+content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*\s+)?content=["']([^"']+)["'][^>]*\s+name=["']twitter:image["']/i,
    ]
    for (const re of ogPatterns) {
      const m = head.match(re)
      if (m && m[1]) {
        try {
          const resolved = new URL(m[1], url).toString()
          if (/^https?:\/\//i.test(resolved)) {
            signals.og_image_url = resolved
            break
          }
        } catch { /* malformed src · try next pattern */ }
      }
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
// Average raw mobile + desktop scores per axis BEFORE bucketing (2026-05-10).
// If only one strategy is assessed, fall through to that one — never penalize
// for a missing surface. Bucketing AFTER averaging is intentional: a 50/95
// split (avg 72) lands in the 70-89 bucket, not the 0pt cliff that the 50
// alone would hit. That's the calibration we want — real users hit both
// surfaces and the slot score should reflect what's actually achievable.
function combineLh(m: LighthouseScores, d: LighthouseScores): LighthouseScores {
  const avg = (a: number, b: number) => {
    if (a === LH_NOT_ASSESSED && b === LH_NOT_ASSESSED) return LH_NOT_ASSESSED
    if (a === LH_NOT_ASSESSED) return b
    if (b === LH_NOT_ASSESSED) return a
    return Math.round((a + b) / 2)
  }
  return {
    ...m,  // keep mobile-only audit byproducts (console errors / network failures / dom size · only collected on mobile run)
    performance:   avg(m.performance,   d.performance),
    accessibility: avg(m.accessibility, d.accessibility),
    bestPractices: avg(m.bestPractices, d.bestPractices),
    seo:           avg(m.seo,           d.seo),
  }
}

function scoreLighthouse(lh: LighthouseScores) {
  // Step buckets (v3 calibration · 2026-04-27 restored). Linear interpolation
  // tried in v4 to absorb PageSpeed ±5pt measurement noise but caused
  // overall deflation across all projects (perf 91 dropped 8→7 etc).
  // Stepwise calibration was already field-validated on the v3 set.
  // -1 "not assessed" → neutral midpoint (no bonus, no penalty).
  // Legit 0 still takes the harshest bucket (bad signal).
  // Input lh is mobile+desktop AVERAGED via combineLh (2026-05-10).
  // Perf cliff softened 2026-05-10 (same rationale as BP) · the old <50 → 0
  // was punitive for image-heavy luxury / marketing sites (omegawatches /
  // luxury brand pages routinely score mobile 30-50 because of hero photo
  // weight) where a11y · SEO · BP are all exemplary. Adds a 30-49 → 1
  // partial-credit bucket so a single perf weakness doesn't fully nuke 8pt.
  // 50+ ranges unchanged · 90+ still earns full 8.
  const p = lh.performance   === LH_NOT_ASSESSED ? 4
           : lh.performance   >= 90 ? 8
           : lh.performance   >= 70 ? 6
           : lh.performance   >= 50 ? 3
           : lh.performance   >= 30 ? 1 : 0
  const a = lh.accessibility === LH_NOT_ASSESSED ? 3
           : lh.accessibility >= 90 ? 5
           : lh.accessibility >= 70 ? 3 : 1
  // BP cliff softened 2026-05-10 · the old <70 → 0 was too punitive for
  // marketing sites that ship ~3 MB of JS (Stripe / Vercel / etc · BP
  // dragged down by 'avoid-multiple-page-redirects' / 'csp-xss' / 'image
  // size on heavy WebGL hero'). Adds a 50-69 → 1 partial-credit bucket so
  // a single weak BP signal doesn't fully nuke the slot. 70+ ranges
  // unchanged · 90+ still earns full 4.
  const b = lh.bestPractices === LH_NOT_ASSESSED ? 2
           : lh.bestPractices >= 90 ? 4
           : lh.bestPractices >= 70 ? 2
           : lh.bestPractices >= 50 ? 1 : 0
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
  isLibrary: boolean = false,   // form-aware (B follow-up): library mode neutralizes
                                 // app-only sub-slots (responsive design + observability libs)
                                 // since libraries don't have UIs and provide hooks
                                 // rather than ship internal observability.
): {
  pts: number
  breakdown: { tests: number; ci: number; observability: number; ts_strict: number; lockfile: number; license: number; responsive: number }
} {
  // Tests · 0=0, 1-9=1, 10-49=2, 50+=3
  const tests = s.test_files >= 50 ? 3 : s.test_files >= 10 ? 2 : s.test_files >= 1 ? 1 : 0
  // CI · GH Actions / GitLab / CircleCI / Vercel · binary 2pt
  const ci = s.has_ci_config ? 2 : 0
  // Observability · 1+ libs in package.json earns 2 pts. Library mode:
  // libraries provide observability (sentry/winston ARE libraries), they
  // don't necessarily ship internal telemetry — give 1pt baseline if no
  // libs detected so they're not penalized for the form-factor mismatch.
  const observabilityRaw = s.observability_libs.length >= 1 ? 2 : 0
  const observability    = (observabilityRaw === 0 && isLibrary) ? 1 : observabilityRaw
  // TS strict · half point
  const ts_strict = s.has_typescript_strict ? 1 : 0
  // Lockfile · binary 1 pt (signal of dependency hygiene)
  const lockfile = s.has_lockfile ? 1 : 0
  // LICENSE · binary 1 pt (legal hygiene)
  const license = s.has_license ? 1 : 0
  // Responsive design · max 2 pts. Library mode: not relevant (libs have
  // no UI surface), award neutral 1pt baseline rather than penalize.
  let responsive: number
  if (isLibrary) {
    responsive = 1
  } else {
    const responsiveStrategy =
      (s.tailwind_class_total > 0 && s.tailwind_responsive_count / s.tailwind_class_total >= 0.10) ||
      s.css_media_query_count >= 5
    const lhM = lhMobile.performance
    const lhD = lhDesktop.performance
    const mobilePerfHealthy = lhM >= 70 || (lhM >= 0 && lhD >= 0 && Math.abs(lhD - lhM) < 15)
    responsive = (responsiveStrategy ? 1 : 0) + (mobilePerfHealthy ? 1 : 0)
  }
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
// Stars are log-scale: each 10× lifts +1 — 100/1K/10K → 1/2/3 pts.
// Releases (semver tags published) added in v4 — counts toward same cap.
function scoreEcosystem(gh: GitHubInfo): {
  pts: number
  breakdown: { stars: number; contributors: number; downloads: number; releases: number }
} {
  // Fixed B1 (was: 10K and 1K both yielding 2pt — 10K threshold dead).
  const stars = gh.stars >= 10000 ? 3 : gh.stars >= 1000 ? 2 : gh.stars >= 100 ? 1 : 0
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

// §11-NEW.1.1 · auto-detect a SUGGESTED ladder category. As of 2026-04-30
// this writes ONLY to detected_category — the user picks the canonical
// business_category at audit-result time (or via the project EDIT form).
// Use-case taxonomy (7): productivity_personal · niche_saas · creator_media
// · dev_tools · ai_agents_chat · consumer_lifestyle · games_playful.
// Order matters · specific detectors first, generic fallbacks last.
type LadderCategory =
  | 'productivity_personal'
  | 'niche_saas'
  | 'creator_media'
  | 'dev_tools'
  | 'ai_agents_chat'
  | 'consumer_lifestyle'
  | 'games_playful'

// Description-first scoring detector. The Creator's pitch text is the
// strongest single signal of intent — a user who writes 'a 5-step game
// quiz that types your gamer DNA' has explicitly told us what this is,
// and the detector should not override that with a stack/form-factor
// guess. Each category has a keyword bundle (English + Korean surface
// forms) and a hard-signal pattern. We tally hits and pick the highest
// score; form factor / tech stack only break ties or fill in the void
// when description is too thin to score anything.
//
// Hard signals (engine names, runtime SDK presence) get a +5 boost —
// these are facts about the artifact, not authorial claims, and should
// outweigh ambiguous description language.

interface CategoryRule {
  cat:        LadderCategory
  /** Pattern that, when matched, gives a strong baseline score (the
   *  presence of an engine library, SDK, or domain-specific term that's
   *  unlikely to appear by accident). */
  hard?:      RegExp
  /** Bundle of softer keywords. Each match contributes +1. */
  soft:       RegExp
  /** Form-factor / stack rule that, when true, contributes +2. Used to
   *  break ties when description is mute. */
  stack?:     (input: { formFactor: string; isSaas: boolean; layers: Set<string> }) => boolean
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    cat:  'games_playful',
    hard: /\bphaser\b|\bbabylonjs?\b|three\.js|godot|unity\b|@react-three|playerinput|gamedev|gameplay|interactive\s+fiction/,
    soft: /\bgame[s]?\b|\bgamer[s]?\b|\barcade\b|\brpg\b|\bmmorpg\b|\bplatformer\b|\bshooter\b|\bmultiplayer\b|\bleaderboard\b|\bplayable\b|\bgaming\b|\bplay\s+(?:against|with|the)\b|\btournament\b|\bquiz\b|\bpuzzle\b|게임|\b겜\b|플레이어|보드게임|아케이드/,
  },
  {
    cat:  'ai_agents_chat',
    hard: /\bagent\b|\bassistant\b|\bchatbot\b|\bchat\s*bot\b|\brag\b|\bllm\b|conversational|autopilot|copilot|automation\s+worker|agentic|에이전트|챗봇|어시스턴트/,
    soft: /\bai\b|\bartificial\s+intelligence\b|\bgpt\b|\bclaude\b|\bgemini\b|\bllama\b|\bvector\s+(?:store|search|db)\b|\bembeddings?\b|\bprompt\b|\bautocomplete\b|인공지능/,
    stack: ({ layers }) => layers.has('ai'),
  },
  {
    cat:  'creator_media',
    hard: /\bgenerative\s+(?:art|image|video|audio|design)\b|\bportfolio\b|\billustration\b|\bcontent\s+creation\b/,
    soft: /\bdesign\b|\bvideo[s]?\b|\bimage\s+(?:gen|editor|maker)\b|\bphoto[s]?\b|\bart\b|\bmusic\b|\baudio\b|\bwriting\b|\bblog\b|\bnewsletter\b|\bmedia\b|\bcreator\b|\bpublishing\b|\bgallery\b|\bcanvas\b|디자인|영상|이미지|음악|콘텐츠|크리에이터/,
  },
  {
    cat:  'dev_tools',
    hard: /\bcli\b|\bcommand[- ]line\b|\bscaffold(?:ing)?\b|\bstarter\s+(?:kit|template)\b|\bboilerplate\b|\bide\s+(?:plugin|extension)\b|\bsdk\b|\bapi\s+client\b|coding\s+(?:agent|assistant)|\bdebugger\b|\blinter\b|\bbundler\b|\bdevtools?\b|\bcompiler\b/,
    soft: /\blibrary\b|\bframework\b|\bplugin\b|\btemplate\b|\bdeveloper[s]?\b|\bdev\b|\bopen\s+source\b|\bnpm\b|\bpackage\b|\bgithub\s+action\b|\b개발자\b|\b개발\s*도구\b/,
    stack: ({ formFactor }) =>
      formFactor === 'library' || formFactor === 'cli' || formFactor === 'scaffold',
  },
  {
    cat:  'niche_saas',
    hard: /\bcrm\b|\berp\b|\bhr\s+tech\b|\bfintech\b|\blegal\s+tech\b|\bedtech\b|\bhealth\s*tech\b|\bprop\s*tech\b|\bb2b\b|\bsaas\b|\bworkspace\b|\btenant\b|\badmin\s+panel\b/,
    soft: /\bauth\b|\bsignup\b|\bsignin\b|\bsign-in\b|\blogin\b|\bbilling\b|\bsubscription\b|\bdashboard\b|\bteam[s]?\b|\bworkflow\b|\bservice\b|\bplatform\b|관리자|구독|결제|대시보드/,
    stack: ({ formFactor, isSaas, layers }) =>
      isSaas ||
      (formFactor === 'app' && layers.has('backend') && layers.has('database')),
  },
  {
    cat:  'consumer_lifestyle',
    hard: /\be-?commerce\b|\bsocial\s+(?:network|app)\b|\bdating\b|\blanguage\s+learning\b/,
    soft: /\bhealth\b|\bfitness\b|\bwellness\b|\bmedical\b|\bfinance\b|\bbudget\b|\binvest\b|\bbanking\b|\btravel\b|\btourism\b|\blearning\b|\beducation\b|\bcooking\b|\brecipe\b|\bshopping\b|\blifestyle\b|\bnews\b|\breading\b|\bpodcast\b|\bk-beauty\b|\bbeauty\b|\bskincare\b|건강|쇼핑|여행|뷰티|학습|요리/,
  },
  {
    cat:  'productivity_personal',
    hard: /\binternal\s+tool\b|\bquick\s+look\b/,
    soft: /\bnotes?\b|\btodo\b|\btask\b|\bdashboard\b|\bautomation\b|\bworkflow\b|\bpersonal\b|\bproductivity\b|\bcalendar\b|\bplanner\b|\btracker\b|\bclipboard\b|\butility\b|\bsearch\b|\bbookmark\b|\b생산성\b|\b노트\b|\b일정\b|\b자동화\b/,
  },
]

function countMatches(re: RegExp, text: string): number {
  // Force a global flag clone so .matchAll works across the same input.
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g')
  return [...text.matchAll(g)].length
}

function detectBusinessCategory(input: {
  formFactor:  string
  isSaas:      boolean
  techLayers:  string[]
  pkgName:     string
  description: string
}): LadderCategory {
  const desc   = input.description.toLowerCase()
  const name   = input.pkgName.toLowerCase()
  const layers = new Set(input.techLayers)
  // Description is weighted 2× since it's the Creator's explicit pitch;
  // package name often is just a slug and 'name + desc' would let a
  // single repo-name match shout over richer prose.
  const blob   = `${desc} ${desc} ${name}`

  let best: { cat: LadderCategory; score: number } | null = null
  for (const rule of CATEGORY_RULES) {
    let score = 0
    if (rule.hard && rule.hard.test(blob)) score += 5
    score += countMatches(rule.soft, blob)
    if (rule.stack && rule.stack({ formFactor: input.formFactor, isSaas: input.isSaas, layers })) {
      score += 2
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { cat: rule.cat, score }
    }
  }

  // Description gave us a confident pick — honor it. Threshold of 2
  // means at least one hard hit, two soft hits, or one soft + one
  // stack signal. Below that, fall through to the form-factor /
  // stack-based fallbacks so we don't misclassify on a single
  // accidental keyword.
  if (best && best.score >= 2) return best.cat
  if (best && best.score >= 1 && best.cat !== 'productivity_personal') {
    // Single soft hit — accept only if the rule isn't the catch-all
    // 'productivity' bucket (to avoid a stray 'note' word stealing).
    return best.cat
  }

  // Stack-only fallbacks (description was thin or mute).
  if (input.formFactor === 'library' || input.formFactor === 'cli' || input.formFactor === 'scaffold') {
    return 'dev_tools'
  }
  if (input.isSaas) return 'niche_saas'
  if (input.formFactor === 'app' && layers.has('ai')) return 'ai_agents_chat'
  if ((input.formFactor === 'unknown' || input.formFactor === 'app') &&
      layers.has('frontend') && !layers.has('database')) {
    return 'dev_tools'
  }
  return 'productivity_personal'
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
  // Fixed B4 — only mark AI layer when the project is BUILT WITH an AI
  // SDK / model API at runtime, not when text just mentions an AI coding
  // tool used during development. Tools like cursor/lovable/v0/replit
  // produce code; they don't ship in the runtime stack.
  if (/anthropic[-_/.]ai|@anthropic|openai\b|@openai|gemini[-_]api|@google\/generative|langchain|llama[._-]?index|vercel[-_]?ai/.test(s)) L.add('ai')
  // Web3/chain — drop bare "base" (false-positive prone) and "mcp" (not
  // a chain — MCP is the AI agent protocol). Keep Ethereum/Solana
  // ecosystem terms that signal real on-chain integration.
  if (/ethereum|solana|polygon|arbitrum|optimism|wagmi|viem|ethers|web3\.js|@solana|hardhat|foundry|nft\b/.test(s)) L.add('chain')
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
// We accept either a healthy live URL OR a published npm package as
// "live proof" (so library / CLI form factors can also reach the
// substitute), then layer README depth on top.
//
// Fixed B5 — earlier this required liveOk and never gave libraries
// without a public URL any substitute pts.
function walkOnBriefSubstitute(
  gh: GitHubInfo,
  health: { ok: boolean; elapsed_ms: number },
): { pts: number; reason: string } {
  const liveOk     = health.ok && health.elapsed_ms < 3000
  const npmOk      = gh.npm.weekly_downloads != null   // published & resolvable
  const proof      = liveOk ? 'live URL'
                   : npmOk  ? 'npm package'
                   : null
  if (!proof) return { pts: 0, reason: 'no live URL and not npm-published' }
  const install = !!gh.signals.has_readme_install
  const usage   = !!gh.signals.has_readme_usage
  const lines   = gh.signals.readme_line_count || 0
  if (install && usage && lines >= 80) {
    return { pts: 3, reason: `${proof} + README has Install + Usage + ≥80 lines` }
  }
  if (install && usage) {
    return { pts: 2, reason: `${proof} + README has Install + Usage` }
  }
  if (install || usage) {
    return { pts: 1, reason: `${proof} + README has Install OR Usage` }
  }
  // Fallback for npm-only libraries with thin READMEs but published
  // releases — at least 1pt for being a real, resolvable package.
  if (npmOk && lines >= 40) {
    return { pts: 1, reason: 'npm package + README ≥40 lines' }
  }
  return { pts: 0, reason: 'README missing Install/Usage sections' }
}

// Elite ecosystem bonus — a separate +5 cap on top of the regular +3
// ecosystem soft. Designed for production-scale OSS (supabase, cal.com,
// shadcn-ui) so calibration ceiling lifts toward 90+ without inflating
// mid-tier projects.
//
// Fixed B6 — earlier tiering had hard cliffs (9999 stars + 999K dl +
// 99 contrib all just-under → 0pt; 10K + 1M + 0 contrib → 2pt).
// Replaced with per-axis 0/1/2 buckets: 1pt at "near-elite" threshold,
// 2pt at "elite" threshold. Sum of three axes capped at 5.
function eliteEcosystem(gh: GitHubInfo): {
  pts: number
  reason: string
  breakdown: { stars: number; downloads: number; contributors: number }
} {
  // Stars · 5K = +1, 10K = +2
  const starsPts = gh.stars >= 10_000 ? 2 : gh.stars >= 5_000 ? 1 : 0
  // Weekly npm downloads · 100K = +1, 1M = +2
  const dl = gh.npm.weekly_downloads ?? 0
  const downloadsPts = dl >= 1_000_000 ? 2 : dl >= 100_000 ? 1 : 0
  // Contributors · 50 = +1, 100 = +2
  const contributorsPts = gh.contributors_count >= 100 ? 2
                       : gh.contributors_count >= 50  ? 1 : 0
  const raw = starsPts + downloadsPts + contributorsPts
  const pts = Math.min(5, raw)
  const reason = pts >= 5 ? `elite tier · ${gh.stars.toLocaleString()} stars + ${dl.toLocaleString()} weekly dl + ${gh.contributors_count}+ contributors`
              : pts >= 3 ? `production-scale · raw ${raw}/6 (capped 5) — ${gh.stars.toLocaleString()} stars / ${dl.toLocaleString()} dl / ${gh.contributors_count} contributors`
              : pts >= 1 ? `near-elite gradient · raw ${raw}/6 — ${gh.stars.toLocaleString()} stars / ${dl.toLocaleString()} dl / ${gh.contributors_count} contributors`
              : 'below near-elite thresholds (5K stars / 100K dl / 50 contrib)'
  return { pts, reason, breakdown: { stars: starsPts, downloads: downloadsPts, contributors: contributorsPts } }
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

interface EngineUsage {
  input_tokens:        number
  output_tokens:       number
  cache_create_tokens: number
  cache_read_tokens:   number
  model_version:       string
}

interface RichAnalysis {
  // Internal-only · stripped before persisting to analysis_snapshots ·
  // forwarded into audit_token_usage by the caller for cost tracking.
  _engine_usage?: EngineUsage | null

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
  creator_brief_en?: {                // §19 rule 9 · English translation of build_briefs (Korean → English)
    headline:    string
    target_user: string
    features:    string[]
  }
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
commit.show is a league where creators audit their apps, get objectively scored across multiple axes, and earn the Encore badge once the total score crosses 85 (Audit 50 + Scout 30 + Community 20).
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
- verdict_label ∈ {ship, iterate, block}. "ship" = strong enough to clear the Encore line on this dimension today. "iterate" = clear path but notable gaps. "block" = would fail this lens in a real launch review.
- Verdicts can DISAGREE with the numeric score on that axis — this is the POINT. A high Lighthouse score doesn't make a Security Officer say "ship".
- NEVER name brand tools (Cursor, Claude Code, Lovable, etc.). Describe findings in product terms.
- All four experts MUST be present; don't skip one because evidence is thin — if evidence is thin, confidence drops and verdict_summary says so.
- American English, no Korean.` : ''}

VIBE CODER FAILURE-MODE FRAMEWORK (priority lens for weaknesses):
The structured signal block input.github.signals.vibe_concerns lists the
failure modes that ~70% of AI-assisted projects ship without:

  1. webhook_idempotency  — Stripe / payment retry safety. .gap=true means
     handler files were found but no idempotency-key check pattern.
  2. rls_gaps             — Supabase row-level-security coverage. Compare
     tables vs policies; gap_estimate > 0 means writable tables likely
     unprotected.
  3. secret_exposure      — Service-role / API keys in client-side files.
     client_violations > 0 = immediate takeover risk.
  4. db_indexes           — FK columns vs CREATE INDEX count. gap_estimate
     > 0 means likely query-perf cliff at scale.
  5. observability        — sentry / datadog / pino / winston / otel libs
     in package.json. detected=false = production blind.
  6. rate_limit           — needs_attention=true means project has API
     routes but no rate-limit lib or middleware → DoS / bill shock.
  7. prompt_injection     — uses_ai_sdk=true + raw_input_to_prompt_files
     non-empty = user input flowing unsanitized into a model prompt.
  8. hardcoded_urls       — localhost:port leaks in shipped code. Will 404
     in production for end users.
  9. mock_data            — inline arrays of object literals in app paths.
     Real backend was promised but not wired.
 10. webhook_signature    — handlers present but no HMAC / Stripe-Signature /
     X-Hub-Signature verification. Anyone can POST forged events.
 11. cors_permissive      — Access-Control-Allow-Origin: * on auth endpoints.
     Cross-site exfiltration risk.
 12. mobile_input_zoom    — input/textarea font-size <16px. iOS Safari
     auto-zooms on focus, breaking mobile UX.
 13. column_grant_mismatch — Postgres table uses column-level GRANT SELECT
     (privacy pattern hiding email/PII) but a later migration ADD COLUMN'd
     a column without granting it. Result: 42501 'permission denied for
     table' on every PostgREST read that includes the new column. Silent
     fail in supabase-js. samples list (table, column, sql_file) tuples.
 14. stripe_api_idempotency — outbound POST to Stripe (Checkout sessions,
     Charges, PaymentIntents, Customers) without { idempotencyKey }. Network
     retry or double-clicked Pay button can spawn duplicate sessions →
     duplicate charges. .gap=true when call_sites > idempotent_call_sites.

When a vibe_concerns flag is set, weaknesses[] MUST surface it before
generic concerns. Use exact phrasing the user can act on:
  Good: "Stripe webhook handler at api/webhook/stripe.ts — no idempotency
         key check (85% of vibe-coded projects miss this)."
  Good: "5 FK columns across migrations · only 1 CREATE INDEX — query perf
         cliff likely at >100K rows."
  Bad:  "Could improve security." / "Some performance concerns."

Generic axes ("Security", "Code", "UX", etc.) still apply for OTHER
findings, but the vibe_concerns signals are the lead concerns when present.

SCOUT BRIEF — MANDATORY on every analysis (not just when expert_panel runs):
Scouts forecast on these projects but most don't have Platinum clearance to read the full audit. Distill the review into a list they can read in 10 seconds.

- strengths: exactly 5 items. Each = the single strongest thing you'd point a Scout at.
- weaknesses: exactly 5 items. Each = the single thing most likely to keep this project below the Encore line (85).

Ordering matters:
- Order by IMPORTANCE for scouting, most decision-moving first. Position 1 = the bullet a Scout would want to see before any other.
- ANY vibe_concerns flag (gap=true / suspicious=true / needs_attention=true / total>0 / detected=false) takes precedence over generic concerns for weakness positions 1-3.
- For weaknesses, items 4 and 5 are the deepest/most sensitive issues — only Platinum Scouts will see them. Put surface-level issues first (positions 1-3) and structural/hidden issues last (positions 4-5).

Format per bullet:
- axis: one of "Security", "Infrastructure", "Code", "UX", "Product", "Web3", "Ops", "AI" — pick the best fit.
- bullet: ≤120 chars. Must cite a concrete number, file, or signal. No hedging. No brand names.
  Good: "RLS policies on every state-changing table; no anon writes possible."
  Good: "6 Solidity contracts on Base mainnet, no audit trail or test suite in repo."
  Bad:  "Good security posture overall."
  Bad:  "Could improve UX."

- All 10 bullets MUST be present in every analysis regardless of trigger_type. American English. No Korean.

URL FAST LANE OVERRIDE (when is_url_fast_lane=true · §15-E):
- The audit ran with NO repo access. github_signals.accessible=false and every repo-derived slot (tests · CI · LICENSE · Brief · Tech Diversity · Source Hygiene · Production Maturity sub-slots) is structurally 0 because the engine couldn't see the source. Those zeros are NOT faults of the project — they're dimensions we couldn't measure.
- Weaknesses MUST focus ONLY on URL-OBSERVABLE issues:
  · Lighthouse breakdowns (perf · a11y · BP · SEO bucket regressions)
  · routes_health (broken paths · 4xx/5xx · slow TTFB)
  · meta tag gaps (missing og:image · no canonical · sparse twitter card)
  · live_url_health failures (3s+ TTFB · cert issues)
  · security_headers absence (CSP · HSTS missing)
  · legal_pages absence (no /privacy /terms reachable)
- FORBIDDEN weakness patterns when is_url_fast_lane=true:
  · "0 commits / 0 contributors / 0 files / no source code evaluable"
  · "no tests / no CI / no observability / no lockfile / no TS strict"
  · "no LICENSE / no governance docs / no monorepo signal"
  · "no Brief / Phase 1 missing / no audition story"
  · "Tech Diversity 0 / Maturity 0 / Hygiene 0"
  Any bullet that says "no [repo signal] detected" → DROP IT. The user already knows we can't see the repo. Listing it as a weakness reads as an indictment of the project, not a description of the audit's scope.
- If you genuinely can't find 5 URL-side weaknesses (e.g., a pristine site like google.com), output FEWER. 0-2 weaknesses is acceptable for a top-tier site under URL Fast Lane. Don't pad.
- DO surface, in any open spot, ONE bullet of axis:"Ops" framed as: "Repo signals not visible — link a public repo to unlock tests, CI, governance, and Brief integrity scoring." This is the upsell hook, not a weakness. Place it as the LAST weakness only when fewer than 5 URL-side weaknesses exist.`

  const userPrompt = `Evaluate this project using ONLY the evidence below. Every axis score must be backed by a specific number from the evidence.

========= EVIDENCE PACK =========
${JSON.stringify(input, null, 2)}
==================================

OUTPUT RULES
- Return ONLY valid JSON. No markdown, no prose outside JSON.
- ALL prose fields (tldr, headline, role_title reasoning, delta_reasoning, sublabels, findings detail, open_questions, honest_evaluation, tampering signal detail, scout_brief bullets, creator_brief_en) MUST be written in American English. Do not use Korean, Korean characters, or Korean phrasing anywhere in the output.
- creator_brief_en: even when build_brief_phase_1.problem / features / target_user arrive in Korean (or any non-English), TRANSLATE them into a clean American English summary in this field. headline = one-line product summary (≤120 chars). target_user = audience description (≤180 chars · empty string if unknown). features = 1-6 short bullets (≤140 chars each). The UI uses creator_brief_en in the public "About this project" section when present — never the raw build_brief row — so any Korean here would leak directly to user-facing surfaces.
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

     Tier-1 EVIDENCE inputs — STRICT NO-DEDUCT (mention in scout_brief
     weaknesses if relevant; NEVER add a 'minus' chip for these):
       security_headers   — CSP / HSTS / X-Frame / X-Content-Type / Referrer / Permissions
       legal_pages        — /privacy and /terms reachability
       readme_depth_score — README length + Install/Usage section presence
       routes_health      — multi-route probe (§15-E.2 · Tier A). Probed paths +
                            broken_paths array. ALREADY priced into
                            scoring_so_far.auto_50_breakdown.health_pts via the
                            Live URL Health slot fold-in. Mention broken paths
                            (e.g. "/pricing → 500 · /signup → 404") as a
                            CONCERN bullet in scout_brief if reachable_rate < 0.8,
                            but do NOT add a separate minus chip — the slot
                            already reflects it. If reachable_rate >= 0.8 with
                            sitemap_present, it's a STRENGTH-worthy signal
                            ("multi-route routing intact").
       runtime_evidence   — §15-E.3 wave 5 · mined from Lighthouse audits[].
                            Catches the "looks polished but console is on fire"
                            failure mode static probes can't see.
                            Fields: console_clean (zero console.error events) ·
                            network_clean (no 4xx/5xx resource) · console_errors_count ·
                            network_failures_count · uses_https · no_doc_write ·
                            total_byte_weight_kb · dom_size. ALREADY priced into
                            scoring_so_far.auto_50_breakdown.runtime_evidence_pts (0-2).
                            Use console_errors_count > 0 OR network_failures_count > 0
                            as a CONCERN bullet ("12 console errors fired during
                            page load · uncaught TypeError in /assets/main.js"). Use
                            both clean as a STRENGTH bullet ("zero console errors,
                            no network failures during render"). Don't add a separate
                            minus chip — the slot already reflects it.
       deep_probe         — Tier B (§15-E.3) Playwright via Cloudflare Browser
                            Rendering · post-hydration HTML + hydration framework
                            detection + runtime meta tags. Surfaces SPA content
                            and recovers signals when basic Tier A fetch was
                            bot-blocked (CF bot fight · Akamai · DataDome).
                            Fields: hydration_framework (next/nuxt/sveltekit/
                            remix/react/vue/angular/null) · hydration_markers_found ·
                            post_hydration_text_length · meta_tags · proven_reachable.
                            STRICT NO-DEDUCT — slot eligibility already reflects it.
                            Use as STRENGTH evidence when proven_reachable AND
                            hydration_framework is a real one ("React app
                            hydrated cleanly · Next 14 SSR shell"). When
                            via='skipped' or 'failed', the engine fell back to
                            Tier A signals — don't penalize for absence; treat
                            as 'not assessed'.
     If you write a chip like "Security headers sparse (1 of 6)" with
     points: -3, that is a RULE VIOLATION. The hard slots above already
     calibrate. Only the explicit deductions in section (2) below are
     allowed; everything else is informational.
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
       · "committed .env"     — already deducted -5 deterministically;
         scoring_so_far.auto_50_breakdown.env_penalty shows the -5.
         NEVER add another 'minus' chip naming .env / env_committed /
         "committed dotfile" / "secret in repo". The deduction is in
         the baseline already; chipping again is double-counting.
       · "security headers sparse"  — Tier-1 evidence, no-deduct (above)
       · "no privacy/terms pages"   — Tier-1 evidence, no-deduct
       · "thin readme"              — Tier-1 evidence, no-deduct
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
       · 'skill'     — Claude Code / agentic skill repo. SKILL.md frontmatter quality,
                       trigger description detail, plugin manifest presence (.claude-plugin/),
                       and 'When NOT to invoke' / companion-skills sections are first-class.
                       DO NOT fault for missing npm package / 0 releases / no lockfile —
                       skills distribute via 'npx skills add' or '/plugin marketplace add',
                       not npm publish. DO NOT fault for missing tests on the skill repo
                       itself (tests on the consuming code matter, not the skill author's).
                       If the SKILL.md exists with valid name + description frontmatter and
                       at least one of (canonical .claude/skills/ layout · .claude-plugin/
                       manifest · README install command), the skill IS shippable.
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
  },
  "creator_brief_en": {
    "headline":    "One-line product summary in American English (≤120 chars).",
    "target_user": "Audience description in American English (≤180 chars). Empty string if unknown.",
    "features":    [ "Feature 1 in American English (≤140 chars)", "Feature 2", "Feature 3" ]
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
                 'tampering_signals', 'scout_brief', 'creator_brief_en',
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
        // §19 rule 9 enforcement · creator brief may be Korean (or any
        // non-English) when submitted · we render an English-translated
        // version in user-facing surfaces (AboutProjectSection · share
        // cards). Never user the raw build_briefs row directly in UI.
        creator_brief_en: {
          type: 'object',
          required: ['headline', 'target_user', 'features'],
          properties: {
            headline:    { type: 'string', maxLength: 200 },
            target_user: { type: 'string', maxLength: 220 },
            features:    {
              type: 'array', minItems: 0, maxItems: 6,
              items: { type: 'string', minLength: 5, maxLength: 160 },
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
    // Stash usage on the rich analysis so the caller (analyze-project main
    // handler) can persist it to audit_token_usage with source='audit_engine'.
    // Cost monitoring backbone — this is OUR cost per audit, not the user's
    // tool spend. The leaderboard ignores audit_engine rows.
    const usage = data.usage as {
      input_tokens?:                number
      output_tokens?:               number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?:     number
    } | undefined
    return {
      ...RICH_ANALYSIS_FALLBACK,
      ...block.input,
      _engine_usage: usage ? {
        input_tokens:        usage.input_tokens                ?? 0,
        output_tokens:       usage.output_tokens               ?? 0,
        cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_tokens:   usage.cache_read_input_tokens     ?? 0,
        model_version:       'claude-sonnet-4-6',
      } : null,
    } as RichAnalysis
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

// Re-analysis cooldown window for creator-initiated resubmits. 24h is the
// abuse defence — without it, a Creator (or a bot using their JWT) could
// burn arbitrary Claude budget by clicking Re-audit in a tight loop.
//
// Bypass: when the repo's HEAD commit SHA differs from the last snapshot's
// SHA, we skip the cooldown entirely. The vibe-coding workflow is "edit →
// push → audit → improve"; punishing real new code with a 24h wait would
// break that loop. Same-SHA resubmits (no real change) still pay the
// cooldown, which is exactly what we want spam-defended.
//
// SHA probe failure (rate-limit / private / network) falls through to
// time-based cooldown — fail-safe, slightly stricter than ideal but never
// over-permissive.
const RESUBMIT_COOLDOWN_MS = 24 * 60 * 60 * 1000  // 24h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let payload: {
    project_id?:   string
    trigger_type?: TriggerType
    triggered_by?: string
    workspace?:    string | null
  }
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const projectId = payload.project_id
  if (!projectId) return json({ error: 'project_id required' }, 400)
  const triggerType: TriggerType = payload.trigger_type ?? 'initial'
  const triggeredBy = payload.triggered_by ?? null
  // Explicit workspace override · normalized + length-capped at the
  // audit-preview boundary, so by the time it reaches us it's a clean
  // path string or null. null = let analyze() use its 3-tier auto-pick.
  const explicitWorkspace = (payload.workspace ?? null) || null

  // Cooldown gate for creator-initiated re-runs · sha-aware bypass.
  if (triggerType === 'resubmit') {
    const { data: lastSnap } = await admin
      .from('analysis_snapshots')
      .select('created_at, commit_sha')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSnap?.created_at) {
      const elapsed = Date.now() - new Date(lastSnap.created_at).getTime()
      if (elapsed < RESUBMIT_COOLDOWN_MS) {
        // Cooldown active · check if the repo has new commits since the
        // last snapshot. If yes, the resubmit is auditing genuinely
        // different code and we skip the wait.
        const { data: projRow } = await admin
          .from('projects')
          .select('github_url')
          .eq('id', projectId)
          .maybeSingle()
        const slug = projRow?.github_url ? slugFromGithubUrl(projRow.github_url) : null
        const lastSha = (lastSnap as { commit_sha?: string | null }).commit_sha ?? null
        const headSha = slug ? await fetchGithubHead(slug) : null
        const shaChanged = !!(lastSha && headSha && lastSha !== headSha)

        if (!shaChanged) {
          // Same code (or sha probe failed) · honor the 24h cooldown.
          const hoursRemaining = Math.ceil((RESUBMIT_COOLDOWN_MS - elapsed) / 3600000)
          return json({
            error: 'cooldown',
            message: lastSha && headSha
              ? `Re-audit available in ${hoursRemaining}h · push new code to bypass.`
              : `Re-audit available in ${hoursRemaining}h.`,
            retry_after_hours: hoursRemaining,
            commit_sha_unchanged: !!lastSha && !!headSha,
          }, 429)
        }
        // shaChanged · fall through · proceed with the resubmit.
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
    .select('id, project_name, description, github_url, live_url, creator_id, status, business_category, audit_count')
    .eq('id', projectId)
    .single()
  if (projErr || !project) return json({ error: 'project not found' }, 404)

  // ── Rate-limit gate ────────────────────────────────────────────────
  // audit-preview already enforces 3-tier limits before fanning out to
  // analyze-project with SERVICE_KEY auth · don't double-charge that path.
  // Direct callers (web /submit, /me re-audit, MCP, REST API) hit this
  // gate fresh and pay the same Claude-spend defence audit-preview pays.
  // The slug from github_url is the URL bucket key, matching audit-preview
  // so retries via either entrypoint share the same per-target cap.
  const authHeader = req.headers.get('authorization') ?? ''
  const isServiceRole = authHeader === `Bearer ${SERVICE_KEY}`
  if (!isServiceRole && !isAdmin(req)) {
    const slugMatch = project.github_url?.match(/github\.com[:/]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i)
    const slug = slugMatch ? `${slugMatch[1]}/${slugMatch[2]}`.toLowerCase() : projectId
    const rl = await enforceRateLimit(admin, req, slug, /*willCostClaude*/ true)
    if (!rl.ok) {
      return json({
        error:   'rate_limited',
        reason:  rl.reason,
        message: rl.message,
        limit:   rl.limit,
        count:   rl.count,
        quota:   rl.quota,
      }, 429)
    }
  }

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
  // Lighthouse: mobile + desktop in parallel (2026-05-10). Earlier note
  // claimed dual-LH pushed wall time past 150s, but that was wrong —
  // running in Promise.all means total wait = max(mobile, desktop)
  // ≈ one LH call (60s ceiling), not the sum. Real users hit both
  // surfaces and SaaS dashboards (cal.com / supabase studio) score very
  // different on mobile vs desktop — averaging the two before bucket
  // scoring is more honest than a mobile-only view that punishes
  // desktop-first products. Desktop also re-feeds the responsive slot's
  // mobile/desktop gap signal that v4 had wired then orphaned.
  const isUrlFastLane = !project.github_url && !!project.live_url
  // §15-E.3 Tier B gate · URL Fast Lane only (no repo). Repo-lane projects
  // already have rich evidence; spending Browser Rendering credits on them
  // is unnecessary. Cost-control gate · graceful fall-through when CF
  // credentials aren't set on the server (deep-probe returns BLANK).

  const [lh, lhDesktop, gh, health, completeness, securityHeaders, legalPages, routesHealth, deepProbe] = await Promise.all([
    project.live_url ? runLighthouse(project.live_url, 'mobile')  : Promise.resolve({ performance: 0, accessibility: 0, bestPractices: 0, seo: 0 }),
    project.live_url ? runLighthouse(project.live_url, 'desktop') : Promise.resolve({ performance: LH_NOT_ASSESSED, accessibility: LH_NOT_ASSESSED, bestPractices: LH_NOT_ASSESSED, seo: LH_NOT_ASSESSED }),
    inspectGitHub(project.github_url, explicitWorkspace),  // null URL → returns full empty shape (incl. signals) · §15-E URL-only safe
    project.live_url ? liveHealth(project.live_url) : Promise.resolve({ status: 0, ok: false, elapsed_ms: 0 }),
    project.live_url ? inspectCompleteness(project.live_url) : Promise.resolve({
      fetched: false,
      has_og_image: false, has_og_title: false, has_og_description: false,
      has_twitter_card: false, has_apple_touch: false, has_manifest: false,
      has_theme_color: false, has_favicon: false, has_canonical: false,
      has_meta_desc: false,
      og_image_url: null,
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
    project.live_url ? inspectMultiRoutes(project.live_url) : Promise.resolve({
      probed: 0, reachable: 0, broken: 0, reachable_rate: 0,
      items: [], broken_paths: [],
      sitemap_present: false, sitemap_url_count: 0,
    } satisfies RoutesHealth),
    // Tier B · only fires on URL Fast Lane projects (cost gate)
    isUrlFastLane ? callDeepProbe(project.live_url!) : Promise.resolve(DEEP_PROBE_BLANK),
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
  const isSkillForm  = gh.form_factor === 'skill'
  // Native-app sub-form (mobile / desktop binary) gets its own slot
  // semantics. Web checks (Lighthouse / live URL probe) don't apply —
  // the runtime is the user's device, not a server. We score on
  // build / distribution evidence instead (app store · TestFlight ·
  // GH releases · platform configs · permissions discipline).
  const isNativeApp  = gh.form_factor === 'native_app'
  // SaaS sub-form OVERRIDES library detection · cal.com / supabase
  // Studio etc. are monorepos that publish library packages but the
  // user-visible product is the auth-walled SaaS. When is_saas is
  // detected (api + db + auth) AND live URL is reachable, treat as
  // SaaS — Lighthouse only lands on the marketing slice, so slot
  // weights shift: LH ↓, Production Maturity ↑, Source Hygiene ↑,
  // Live URL Health ↓, NEW Backend Signals slot (RLS / webhook /
  // indexes / rate-limit / secrets in vibe_concerns).
  // §15-E bot-block fallback — sites with aggressive bot protection
  // (Cloudflare bot fight · Akamai · DataDome) return 403 to our
  // `liveHealth` probe, but Lighthouse (Google's infra) and our
  // sitemap-derived multi-route probe usually still get through. claude.ai
  // is the canonical case: liveHealth 403 → fell to library slots → 0/52
  // even though Lighthouse a11y 97 + 6/6 routes reachable were both
  // evidence the site is real. Treat ANY of FOUR positive signals as
  // proof the site is reachable for slot purposes:
  //   1. liveHealth.ok                — happy path · most projects
  //   2. routesHealth.reachable >= 1  — sitemap routes returned 2xx
  //   3. lh.performance > 0           — PageSpeed actually scored the page
  //   4. deepProbe.proven_reachable   — Tier B (CF Browser Rendering) got through
  // Live URL Health POINTS still depend on health.ok (we don't pretend
  // the homepage is up when it isn't); only slot eligibility broadens.
  const lighthouseSucceeded =
    lh.performance > 0 || lh.accessibility > 0 || lh.bestPractices > 0 || lh.seo > 0 ||
    lhDesktop.performance > 0 || lhDesktop.accessibility > 0 || lhDesktop.bestPractices > 0 || lhDesktop.seo > 0
  const siteEffectivelyReachable = health.ok || routesHealth.reachable >= 1 || lighthouseSucceeded || deepProbe.proven_reachable
  const isSaasForm   = gh.signals.is_saas && siteEffectivelyReachable && !isNativeApp
  // useWebSlots true if web app OR SaaS (both want LH/Live signals,
  // just rescaled differently). Library/CLI/scaffold/native_app
  // without is_saas stay on non-web slots.
  const useWebSlots  = (isAppForm && siteEffectivelyReachable && !isNativeApp) || isSaasForm

  const stackHints = [
    brief?.features ?? '',
    project.description ?? '',
  ].filter(Boolean) as string[]
  const tech       = scoreTechLayers(gh.languages || {}, stackHints)           //  0-3
  const briefScore = scoreBriefIntegrity(brief ?? {})                          //  0-5  (0 for walk-on without substitute)
  // Library-form maturity (B): pass !isAppForm so responsive + observability
  // slots get neutralized for libraries / CLIs / scaffolds (they don't have
  // UIs and don't necessarily ship internal observability — penalizing on
  // these slots was conflating app criteria onto library form factors).
  // Native apps fall under the same "no-web" track as libraries for
  // maturity scoring · their responsive-CSS / web-observability signals
  // are noise (the runtime is a binary, not a browser).
  const maturity   = scoreProductionMaturity(gh.signals, lh, lhDesktop, !isAppForm || isNativeApp)  //  0-12
  const hygiene    = scoreSourceHygiene(gh)                                    //  0-5  (v3 restored)
  const ecosystem  = scoreEcosystem(gh)                                        //  0-3 soft
  const activity   = scoreActivity(gh)                                         //  0-2 soft

  // ── Web slots (only meaningful for app form) ──
  // lh = mobile raw · lhDesktop = desktop raw · lhCombined = avg per axis.
  // Slot score uses combined; raw mobile/desktop kept in evidence.
  const lhCombined     = combineLh(lh, lhDesktop)
  const lhScore        = scoreLighthouse(lhCombined)                           //  0-20 (raw; only used if isAppForm)
  // Live URL Health · binary 5/0 (v3 calibration restored) · §15-E.2 multi-route fold-in:
  // homepage 200 + SSL + <3000ms 가 base. routes_health 가 있으면 multi-route
  // reachable_rate 로 추가 modulation — homepage 만 잘 만들고 /pricing /signup
  // 죽어있는 vibe coding 흔한 패턴을 잡는다. probed===0 (라우트 발견 실패) 면
  // 기존 binary 그대로 유지 (regression 방지 — 작은 단일-페이지 프로젝트에 불리).
  const liveHomepageOk = health.ok && health.elapsed_ms < 3000
  const liveHealthPts  = (() => {
    if (!liveHomepageOk) return 0
    if (routesHealth.probed === 0) return 5     // 라우트 추출 실패 → 기존 동작
    const r = routesHealth.reachable_rate
    if (r >= 0.8) return 5
    if (r >= 0.6) return 3
    return 1                                     // homepage 200 인데 다른 라우트 다 깨진 케이스
  })()
  // Tier A + Tier B completeness UNION (§15-E.3 · 2026-05-09 fix).
  // Earlier version only fell back to Tier B when Tier A failed entirely.
  // That missed the common case where Tier A returned 200 but with sparse
  // meta (the SPA shell has no og:image at static-fetch time, only after
  // hydration). UNION the two sources signal-by-signal — best of both.
  // 6 signals transit through deep_probe (og_title · og_image · og_desc ·
  // twitter · canonical · meta_desc); 4 are Tier A only (favicon · manifest ·
  // apple_touch · theme_color).
  const mergedCompleteness = (completeness.fetched || deepProbe.fetched) ? (() => {
    const has_og_title       = completeness.has_og_title       || deepProbe.meta_tags.has_og_title
    const has_og_image       = completeness.has_og_image       || deepProbe.meta_tags.has_og_image
    const has_og_description = completeness.has_og_description || deepProbe.meta_tags.has_og_description
    const has_twitter_card   = completeness.has_twitter_card   || deepProbe.meta_tags.has_twitter_card
    const has_canonical      = completeness.has_canonical      || deepProbe.meta_tags.has_canonical
    const has_meta_desc      = completeness.has_meta_desc      || deepProbe.meta_tags.has_meta_desc
    const has_apple_touch    = completeness.has_apple_touch
    const has_manifest       = completeness.has_manifest
    const has_theme_color    = completeness.has_theme_color
    const has_favicon        = completeness.has_favicon
    const filled = (has_og_title?1:0) + (has_og_image?1:0) + (has_og_description?1:0)
                 + (has_twitter_card?1:0) + (has_canonical?1:0) + (has_meta_desc?1:0)
                 + (has_apple_touch?1:0) + (has_manifest?1:0) + (has_theme_color?1:0)
                 + (has_favicon?1:0)
    // og_image_url precedence · Tier B (real Chromium) > Tier A static
    // fetch · because deep_probe sees post-hydration meta tags injected
    // by next-seo etc. that the static fetch may miss.
    const og_image_url = deepProbe.meta_tags.og_image_url || completeness.og_image_url || null
    return {
      fetched: true,
      has_og_title, has_og_image, has_og_description, has_twitter_card,
      has_apple_touch, has_manifest, has_theme_color, has_favicon,
      has_canonical, has_meta_desc,
      og_image_url,
      score:  Math.round((filled / 10) * 5),                           // 0-5 score on the canonical /10 scale
      filled,
      of:     10,
    }
  })() : completeness
  const completenessRawPts = scoreCompleteness(mergedCompleteness)               //  0-2

  // ── Runtime evidence slot · §15-E.3 wave 5 ──
  // Mined from Lighthouse audits[] (free · already fetched). Catches the
  // "looks polished but console is on fire / API calls 500" failure mode
  // that static probes can't detect. 0-2pt · only fires for app form with
  // a successful Lighthouse run · null counts treated as "not assessed"
  // (no penalty, just no bonus). Folded into Production Maturity slot
  // for app form so existing 12pt cap doesn't shift.
  const consoleClean = lh.console_errors_count != null && lh.console_errors_count <= 0
  const networkClean = lh.network_failures_count != null && lh.network_failures_count <= 0
  const runtimeEvidencePts = (consoleClean ? 1 : 0) + (networkClean ? 1 : 0)   // 0-2

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

  // ── Native-app equivalent slots ──
  // Distribution evidence · 0-5 (replaces Live URL Health for native_app).
  // App Store / Play Store / TestFlight / F-Droid / GitHub Release
  // binary signatures · the only valid "is it shipped to users?" signal
  // for a mobile / desktop app. Detected during fetchGithub from
  // README content (signals.has_*). Each source counts; cap 5.
  const distributionPts = Math.min(5,
    (gh.signals.has_app_store      ? 2 : 0) +
    (gh.signals.has_play_store     ? 2 : 0) +
    (gh.signals.has_test_flight    ? 1 : 0) +
    (gh.signals.has_f_droid        ? 1 : 0) +
    (gh.signals.has_release_binary ? 1 : 0)
  )
  // Native completeness · 0-2 (replaces web completeness for native_app).
  // Privacy policy URL + platform permissions manifest presence — both
  // are App / Play Store rejection gates and have no web analogue.
  const nativeComplPts =
    (gh.signals.has_privacy_policy        ? 1 : 0) +
    (gh.signals.has_permissions_manifest  ? 1 : 0)

  // ── Skill-form equivalent slots (form_factor='skill') ──
  // Distribution path is `npx skills add owner/repo` or `/plugin marketplace
  // add` — NOT npm publish. Library substitution penalizes skills for
  // missing npm package · 0 releases · no lockfile · no tests, all of which
  // are irrelevant to a skill's actual quality. Skill quality = SKILL.md
  // depth + frontmatter discipline + plugin manifest + canonical layout.
  //
  // Slots (parallel cap structure to lib · 20+5+2 = 27 base):
  //   skillLhEquivPts   0-20  · SKILL.md presence + frontmatter + canonical
  //                             layout + README quality + LICENSE
  //   skillLiveEquivPts 0-5   · plugin manifest OR README install command
  //   skillComplEquiv   0-2   · changelog + contributing
  // SKILL.md exists                          → 6  (it has to exist or the skill literally can't be used)
  // canonical .claude/skills/<name>/ layout  → 2  (single root SKILL.md is OK but multi-skill layout is convention)
  // frontmatter has both name + description  → 4
  // description ≥ 150 chars (good triggering)→ 4  (Anthropic's claude-api skill is ~1000 chars · we're not that strict)
  // README has install + usage sections      → 2  (1 each)
  // LICENSE present                          → 2
  const skillLhEquivPts =
    (gh.signals.has_skill_md            ? 6 : 0) +
    (gh.signals.has_skill_canonical     ? 2 : 0) +
    (gh.signals.skill_frontmatter_valid ? 4 : 0) +
    (gh.signals.skill_description_chars >= 150 ? 4 : gh.signals.skill_description_chars >= 50 ? 2 : 0) +
    (gh.signals.has_readme_install ? 1 : 0) +
    (gh.signals.has_readme_usage   ? 1 : 0) +
    (gh.signals.has_license        ? 2 : 0)
  // Distribution: plugin manifest is the strongest signal · README install
  // command is weaker but still indicates the author thought about how
  // users get the skill.
  const skillLiveEquivPts =
    (gh.signals.has_plugin_manifest ? 3 : 0) +
    // README install command (npx skills add / /plugin marketplace add)
    (/\bnpx\s+(?:-y\s+)?skills(?:@[\w.-]+)?\s+add\b|\/plugin\s+marketplace\s+add\b/i.test(gh.readme_excerpt ?? '') ? 2 : 0)
  // Completeness: light · just changelog + contributing.
  const skillComplEquivPts =
    (gh.signals.has_changelog    ? 1 : 0) +
    (gh.signals.has_contributing ? 1 : 0)

  // Pick the right slot values based on form factor.
  // - useWebSlots (web app / SaaS) · Lighthouse · live URL probe · web meta
  // - native_app · lib-style code-quality slot + distribution + permissions
  // - skill · SKILL.md depth + plugin manifest + frontmatter discipline
  // - library / cli / scaffold · lib-style across the board
  const lhPts          = useWebSlots   ? lhScore.total
                       : isSkillForm   ? skillLhEquivPts
                       :                 libLhEquivPts                            //  0-20
  const healthPts      = useWebSlots   ? liveHealthPts
                       : isNativeApp   ? distributionPts
                       : isSkillForm   ? skillLiveEquivPts
                       :                 libLiveEquiv                             //  0-5
  const completenessPts = useWebSlots  ? completenessRawPts
                        : isNativeApp  ? nativeComplPts
                        : isSkillForm  ? skillComplEquivPts
                        :                libComplEquiv                            //  0-2
  // Walk-on Brief substitute · 0-3 pts when no Brief is submitted (CLI
  // track) but README is rich AND the live URL is healthy. Lifts the
  // walk-on ceiling from /47 toward /50 for projects that ship real
  // documentation. Real Brief.pts always wins when present.
  const briefSubst = brief ? { pts: 0, reason: 'Encore track · brief required' }
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
  // maturity.pts cap is 12 (responsive slot added 2pt above the original 10);
  // dividing by 10 used to push factor to 1.08 at perfect maturity, inflating
  // the polish slots beyond raw value. Cap ratio at 1.0 explicitly.
  const maturityRatio  = Math.min(1.0, maturity.pts / 10)
  // §15-E URL Fast Lane override · Polish×Maturity coupling assumes Maturity
  // is MEASURABLE. For URL-only audits (no github_url) the entire Maturity slot
  // is structurally unmeasurable — it's not "low maturity", it's "we can't see
  // the dimension at all". Applying the 0.6 floor here was double-penalizing
  // URL-lane audits (LH 14pt → effective 8.4pt for anthropic.com et al.,
  // landing the Polish Score in single digits). Set factor = 1.0 for URL lane
  // so polish slots score on raw Lighthouse + meta merit instead.
  const maturityFactor = !useWebSlots                  ? 1.0    // libraries / native apps — slots ARE maturity evidence
                       : isUrlFastLane                 ? 1.0    // URL lane — Maturity unmeasurable, don't deflate Polish
                       : (0.6 + 0.4 * maturityRatio)            // standard web app · 0.6-1.0 coupled to measurable maturity
  const polishSubtotal = lhPts + healthPts + completenessPts + tech.pts
  const scaledPolish   = Math.round(polishSubtotal * maturityFactor)

  // ── Backend Signals slot · 0-5 (SaaS form only · 2026-04-29) ──
  // Reads from vibe_concerns to score the auth-walled product surface
  // that Lighthouse can't reach. Only contributes for is_saas; for
  // non-SaaS this stays 0 (signals still surface as concerns in scout
  // brief, just not double-scored).
  let backendSignalsPts = 0
  let backendBreakdown: Record<string, number> = {}
  if (isSaasForm) {
    const vc = gh.signals.vibe_concerns
    // Webhook · 0-2 · pass=2 partial=1 fail=0 NA=skip
    let webhookPt = 0
    if (vc.webhook_idempotency.handlers_seen > 0) {
      const w = vc.webhook_idempotency
      webhookPt = w.gap ? 0 : (w.idempotency_signal_seen >= w.handlers_seen ? 2 : 1)
    }
    // RLS · 0-2 · all covered=2 · small gap=1 · large gap=0
    let rlsPt = 0
    if (vc.rls_gaps.tables > 0) {
      const r = vc.rls_gaps
      rlsPt = r.gap_estimate === 0 ? 2 : r.gap_estimate <= 2 ? 1 : 0
    }
    // Secret exposure · 0-2 · clean=2 · violations=0 · NA=2 (no client violations is the safe state)
    const secretsPt = vc.secret_exposure.total === 0 ? 2 : 0
    // DB indexes · 0-2 · full=2 · partial=1 · gap=0 · NA=skip
    let indexPt = 0
    if (vc.db_indexes.fk_columns_seen > 0) {
      indexPt = vc.db_indexes.gap_estimate === 0 ? 2
              : vc.db_indexes.gap_estimate <= 3 ? 1 : 0
    }
    // Rate limit · 0-1 · present=1 · attention=0 · NA=skip
    let ratePt = 0
    if (vc.rate_limit.has_api_routes) {
      ratePt = (vc.rate_limit.lib_detected || vc.rate_limit.middleware_detected) ? 1 : 0
    }
    backendBreakdown = { webhook: webhookPt, rls: rlsPt, secrets: secretsPt, indexes: indexPt, rate_limit: ratePt }
    backendSignalsPts = Math.min(5, webhookPt + rlsPt + secretsPt + indexPt + ratePt)
  }

  // Hard 52-cap pillar · slot weights vary by form factor:
  //   web/lib (default): LH 20 · PM 12 · SH 5 · Live 5 · Compl 2 · Tech 3 · Brief 5 = 52
  //   SaaS  (auth-walled product, LH only sees marketing landing):
  //          LH 10 · PM 18 · SH 7  · Live 2 · Compl 2 · Tech 3 · Brief 5 · Backend 5 = 52
  //
  // briefEffective = max(real brief, walk-on substitute) · soft bonuses
  // stack on top capped +10. SaaS scaling for the LH slot specifically
  // uses scaledPolish-style coupling but rebalances multipliers.
  let auto_hard: number
  if (isSaasForm) {
    // SaaS: rescale slot contributions while keeping totals in 52pt envelope.
    // Multipliers chosen so ceiling sums match SaaS distribution above.
    const lhSaas      = Math.round((lhScore.total      / 20) * 10) // 20→10
    const healthSaas  = Math.round((liveHealthPts      /  5) *  2) // 5→2
    const matSaas     = Math.round((maturity.pts       / 12) * 18) // 12→18
    const hygSaas     = Math.round((hygiene.pts        /  5) *  7) // 5→7
    // Tech, Compl, Brief unchanged (3 / 2 / 5).
    // Polish×Maturity coupling still applies to LH+Live+Compl+Tech for SaaS
    // (these are still polish slots), with SaaS-rescaled values.
    const polishSaas  = lhSaas + healthSaas + completenessPts + tech.pts
    const scaledSaas  = Math.round(polishSaas * maturityFactor)
    auto_hard = scaledSaas + matSaas + hygSaas + briefEffective + backendSignalsPts + runtimeEvidencePts
  } else {
    auto_hard = scaledPolish + maturity.pts + hygiene.pts + briefEffective + runtimeEvidencePts
  }
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
    audit_kind: isUrlFastLane ? 'url_fast_lane' : 'full',
    is_url_fast_lane: isUrlFastLane,
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
    routes_health: routesHealth,
    deep_probe: deepProbe,
    completeness_signals: mergedCompleteness,
    security_headers: securityHeaders,
    legal_pages: legalPages,
    github: gh,
    scoring_so_far: {
      auto_50_breakdown: {
        is_app_form:          isAppForm,
        is_native_app:        isNativeApp,
        use_web_slots:        useWebSlots,
        slot_evaluation_mode: useWebSlots ? 'web' : isNativeApp ? 'native_app' : 'library',
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
        runtime_evidence_pts: runtimeEvidencePts,      //  0-2 console_clean + network_clean (from Lighthouse audits[])
        runtime_evidence: {
          console_clean:           consoleClean,
          network_clean:           networkClean,
          console_errors_count:    lh.console_errors_count ?? null,
          network_failures_count:  lh.network_failures_count ?? null,
          uses_https:              lh.uses_https ?? null,
          no_doc_write:            lh.no_doc_write ?? null,
          total_byte_weight_kb:    lh.total_byte_weight_kb ?? null,
          dom_size:                lh.dom_size ?? null,
        },
        hard_subtotal:        auto_hard,               //  cap 54 (was 52 + runtime evidence 2)
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

  // ── Server-side anti-double-counting validation (B16) ──
  // Claude is instructed not to re-deduct for signals already priced
  // into the auto_50_breakdown slots, but discretion sometimes slips.
  // We scan claude.score.breakdown for forbidden chip patterns,
  // strip them, and recompute score.current. Strengths/weaknesses in
  // scout_brief stay untouched (they're informational, not arithmetic).
  const FORBIDDEN_CHIP_PATTERNS = [
    // env_committed already at -5 deterministic
    /\bcommitted\s*\.?env\b/i, /\benv[_-]?committed\b/i, /\bdotfile\b.*\bsecret/i,
    // Tier-1 evidence (no-deduct)
    /security[\s-]?headers?\s+(sparse|missing|absent|incomplete|none)/i,
    /\b(no|missing|absent)\s+(privacy|terms)\b/i,
    /\bthin\s+readme\b/i, /\breadme\s+(thin|short|sparse)\b/i,
    // Already in production_maturity slot
    /\bno\s+tests?\b/i, /\bzero\s+tests?\b/i,
    /\bno\s+ci\b/i, /\bno\s+ci\/cd\b/i,
    /\bno\s+observability\b/i,
    /\bno\s+typescript\s+strict\b/i, /\bts[\s-]?strict\s+(false|missing|off)\b/i,
    /\bno\s+lockfile\b/i,
    /\bno\s+license\b/i, /\bmissing\s+license\b/i,
    /\bno\s+responsive\b/i, /\bno\s+mobile\b/i,
    // Already in source_hygiene slot
    /\bno\s+monorepo\b/i,
    /\bno\s+governance\s+docs?\b/i,
    // Already in completeness slot
    /\blow\s+completeness\b/i,
    // Already in soft.ecosystem / soft.elite
    /\bno\s+(github\s+)?stars?\b/i,
    /\bno\s+contributors?\b/i,
    /\blow\s+npm\s+downloads\b/i,
    /\bno\s+releases?\b/i,
    /\bbelow\s+elite\s+scale\b/i,
    // Production-scale reach already in soft.elite — don't re-bonus
    /\bproduction[\s-]?scale\s+reach\b/i,
    // Already in soft.activity
    /\bstale\s+repo\b/i,
    // Brief slot is already calibrated in baseline (briefEffective: 0-5,
    // walk-on capped at 3 via substitute). Claude was adding a separate
    // -10 chip "No Build Brief submitted (walk-on ceiling 45/50)" — that
    // is the third deduction for the same fact (slot floor + cap + chip).
    /\bno\s+(build\s+)?brief\b/i,
    /\bbrief\s+(absent|missing|not\s+submitted|empty|unclaimed)/i,
    /\bwalk[\s-]?on\s+ceiling\b/i,
    /\b(no|missing)\s+phase[\s-]?\d+\s+brief\b/i,
  ]
  type Chip = { kind: string; points: number; label?: string; evidence?: string }
  const breakdown = claude.score?.breakdown
  if (Array.isArray(breakdown)) {
    const baselineRow = breakdown.find((c: Chip) => c.kind === 'baseline')
    const finalRow    = breakdown.find((c: Chip) => c.kind === 'final')
    const baseline    = baselineRow?.points ?? 0
    let stripped: Chip[] = []
    let kept: Chip[] = []
    for (const chip of breakdown as Chip[]) {
      if (chip.kind !== 'plus' && chip.kind !== 'minus') { kept.push(chip); continue }
      const label = String(chip.label ?? '')
      const matched = FORBIDDEN_CHIP_PATTERNS.some(p => p.test(label))
      if (matched) stripped.push(chip)
      else kept.push(chip)
    }
    if (stripped.length > 0) {
      // Recompute score.current = baseline + sum(plus/minus kept).
      const adjustedDelta = (kept as Chip[])
        .filter(c => c.kind === 'plus' || c.kind === 'minus')
        .reduce((acc, c) => acc + (c.points ?? 0), 0)
      const newScore = Math.max(0, Math.min(100, baseline + adjustedDelta))
      // Mutate the claude object before persistence so downstream uses
      // the cleaned-up version.
      ;(claude.score as any).current = newScore
      ;(claude.score as any).breakdown = [
        ...kept.filter(c => c.kind !== 'final'),
        ...(finalRow ? [{ ...finalRow, points: newScore, label: 'Score.current (post-validation)' }] : []),
      ]
      ;(claude.score as any).post_validation = {
        original_current: finalRow?.points ?? null,
        original_baseline: baseline,
        stripped_chips: stripped.map(c => ({ kind: c.kind, points: c.points, label: c.label })),
        recomputed_current: newScore,
        rule: 'anti-double-counting · forbidden chip patterns matched',
      }
    }
  }

  // Prefer Claude's current score (evidence-weighted, post-validation) but
  // keep auto-50 as floor signal.
  //
  // Walk-on (CLI preview) bypasses Claude's qualitative score and uses a
  // form-aware deterministic denominator (B19):
  //   - web mode  → /50  (52 hard - 2 brief unattainable for walk-on)
  //   - lib mode  → /48  (lib slot ceilings sum lower in practice — hardest
  //                       slots like docs cap 7 of an "LH 20" slot · without
  //                       this libraries floated to 100 too easily)
  // The hard cap 52 stays the same; only the walk-on normalize denom shifts.
  //
  // WALK_ON_MAX_DISPLAY = 95 (rescale, not cap):
  //   Walk-on evaluates only the Audit pillar (50pt of the 100pt composite).
  //   Scout (30) + Community (20) are structurally unevaluated — full 100
  //   is only achievable via audition (Brief Phase 1/2 + Scout votes +
  //   Community engagement). We rescale so a perfect walk-on lands at 95,
  //   preserving the gradient (e.g. 49/50 → 93, 50/50 → 95). The 5pt
  //   headroom is the audition-only frontier and shows up as 'max 95' in
  //   captions. This is not a cap (no clamping discontinuity) but a
  //   formula-level reservation of headroom.
  // ── Score model · Y · 2026-05-02 ──
  // Walk-on uses Claude.score.current (Audit-pillar quality on 0-100 scale)
  // capped at WALK_ON_MAX_DISPLAY = 95. The 5pt headroom is the audition
  // frontier — Brief Phase 1/2 + Scout/Community signals push past 95.
  //
  // Audition uses the same Claude.score.current as a FLOOR (so registering
  // a project never drops the score below its walk-on number) AND lets the
  // composite (audit*0.5 + scout + community) exceed it once Scout +
  // Community pillars actually start producing signal. Today both pillars
  // are 0 so audition === walk-on; once V1 P8 lands they kick in.
  //
  // Replaces the earlier `score_auto / 50 × 95` deterministic formula
  // which threw away every Claude qualitative bonus and made elite-OSS
  // walk-ons (supabase, etc.) score the same as similar-auto small repos.
  const WALK_ON_MAX_DISPLAY = 95
  const claudeCurrent = (claude.score?.current && claude.score.current > 0)
    ? Math.round(claude.score.current)
    : Math.round(score_auto * 2)        // fallback when Claude couldn't grade

  const walkOnScore = Math.min(WALK_ON_MAX_DISPLAY, claudeCurrent)

  const scoreTotal = isCliPreview
    ? walkOnScore
    : Math.min(100, Math.max(
        walkOnScore,                                                   // floor: never drop below walk-on
        Math.round(claudeCurrent * 0.5) + 0 /* score_forecast */ + 0   /* score_community · TODO V1 P8 */,
      ))

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

  // Strip _engine_usage out of the rich_analysis we persist · the column
  // is meant for the public analysis payload, not internal cost data.
  const { _engine_usage: engineUsage, ...claudeForSnapshot } = (claude ?? {}) as Record<string, unknown> & { _engine_usage?: EngineUsage }

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
    rich_analysis:      { ...claudeForSnapshot, completeness_signals: mergedCompleteness, routes_health: routesHealth, deep_probe: deepProbe },
    parent_snapshot_id: parent?.id ?? null,
    delta_from_parent:  Object.keys(deltaFromParent).length ? deltaFromParent : null,
    score_total_delta:  scoreTotalDelta,
    commit_sha:         gh.head_commit_sha,
    brief_sha:          gh.debut_brief?.sha ?? null,
    model_version:      'claude-sonnet-4-6',
  }]).select('id').single()
  if (snapErr) console.error('snapshot insert failed', snapErr)

  // ── audit_token_usage · capture OUR Claude SDK call cost per snapshot ──
  // source='audit_engine' rows are admin-only cost monitoring · they do NOT
  // count toward the user-facing token leaderboard. Pricing pinned to
  // Sonnet 4.6 today · stored as a cost_usd snapshot so historical pricing
  // changes don't retroactively rewrite reported costs.
  if (snapshot?.id && engineUsage) {
    const inputTok        = engineUsage.input_tokens        ?? 0
    const outputTok       = engineUsage.output_tokens       ?? 0
    const cacheCreateTok  = engineUsage.cache_create_tokens ?? 0
    const cacheReadTok    = engineUsage.cache_read_tokens   ?? 0
    // USD per 1M tokens · Anthropic Sonnet 4.6 · 2026-05 pricing.
    const PRICE_INPUT  = 3.00
    const PRICE_OUTPUT = 15.00
    const PRICE_CACHE_CREATE = 3.75
    const PRICE_CACHE_READ   = 0.30
    const costUsd =
      (inputTok       / 1_000_000) * PRICE_INPUT        +
      (outputTok      / 1_000_000) * PRICE_OUTPUT       +
      (cacheCreateTok / 1_000_000) * PRICE_CACHE_CREATE +
      (cacheReadTok   / 1_000_000) * PRICE_CACHE_READ

    const { error: usageErr } = await admin.from('audit_token_usage').insert({
      project_id:          projectId,
      snapshot_id:         snapshot.id,
      source:              'audit_engine',
      verified:            true,
      input_tokens:        inputTok,
      output_tokens:       outputTok,
      cache_create_tokens: cacheCreateTok,
      cache_read_tokens:   cacheReadTok,
      cost_usd:            Number(costUsd.toFixed(4)),
      model_version:       engineUsage.model_version ?? 'claude-sonnet-4-6',
      first_seen_at:       new Date().toISOString(),
      last_seen_at:        new Date().toISOString(),
      tool_version:        'analyze-project',
      metadata:            { trigger_type: triggerType },
    })
    if (usageErr && usageErr.code !== '23505') {  // 23505 = uniqueness · expected on retry
      console.error('audit_token_usage insert failed', usageErr)
    }
  }

  // ── @commitshow auto-tweet · fire-and-forget background call ──
  // Triggers when a fresh snapshot lands. The auto-tweet Edge Function
  // owns its own gates (score >= 85 · status='preview' · 14d cooldown ·
  // social_share_disabled=false) and is dry-run safe when
  // COMMITSHOW_X_ACCESS_TOKEN is unset (records 'skipped'). We only
  // skip the call entirely for 'weekly' / 'season_end' triggers — those
  // are scheduled re-runs that shouldn't generate tweet noise.
  if (triggerType === 'initial' || triggerType === 'resubmit') {
    const tweetUrl = `${SUPABASE_URL}/functions/v1/auto-tweet`
    const tweetPromise = fetch(tweetUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body:    JSON.stringify({ project_id: projectId }),
    }).catch(e => console.error('auto-tweet trigger failed', e?.message ?? e))
    // @ts-ignore — EdgeRuntime injected by Supabase
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(tweetPromise)
  }

  // §11-NEW.1.1 · auto-detect ladder business_category. Hybrid policy:
  // we always write detected_category; business_category is only stamped
  // if the project has none yet (Creator override wins · respected on
  // re-audits). Thresholds biased toward conservative inference — when
  // uncertain we default to 'other' rather than mis-bucket.
  const detectedCategory = detectBusinessCategory({
    formFactor: gh.form_factor,
    isSaas:     gh.signals.is_saas,
    techLayers: tech.layers,
    pkgName:    project.project_name ?? '',
    description: (project.description ?? '') + ' ' + (claude.headline ?? ''),
  })
  const audit_count_increment = (project.audit_count ?? 0) + 1

  // Update denormalized latest on projects
  const projectUpdate: Record<string, unknown> = {
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
    detected_category: detectedCategory,
    audit_count:       audit_count_increment,
  }
  // 2026-04-30 · auto-detector now writes ONLY to detected_category. The
  // user picks the canonical business_category at audit-result time (or
  // via the project EDIT form). This prevents the detector's wrong guess
  // from sticking and forces a deliberate Creator choice.
  await admin.from('projects').update(projectUpdate).eq('id', projectId)

  // §11-NEW.2 · permanent milestones. Compute the project's all-time
  // category rank from current scores (cheap window-function query),
  // INSERT any newly hit milestones. UNIQUE (project_id, milestone_type)
  // makes this idempotent — re-firing won't duplicate. Failures are
  // swallowed because tables may be missing pre-Migration A.
  try {
    // Compute all-time rank within the new category from current scores.
    // Cheap in practice — projects table is small and score_total > 0 filters
    // out walk-ons that haven't gone through the full audit.
    const { data: peers } = await admin
      .from('projects')
      .select('id, score_total, score_auto, audit_count, created_at')
      .eq('business_category', detectedCategory)
      .gt('score_total', 0)
      // Walk-on previews stay out of milestone ranking · matches MV filter
      .in('status', ['active', 'graduated', 'valedictorian'])
      .order('score_total',  { ascending: false })
      .order('score_auto',   { ascending: false })
      .order('audit_count',  { ascending: true  })
      .order('created_at',   { ascending: true  })
    let allTimeRank: number | null = null
    if (peers && Array.isArray(peers)) {
      const idx = peers.findIndex((p: { id: string }) => p.id === projectId)
      if (idx >= 0) allTimeRank = idx + 1
    }
    if (allTimeRank !== null) {
      const milestones: Array<{ type: string; achieved: boolean; evidence: Record<string, unknown> }> = [
        { type: 'first_top_100',    achieved: allTimeRank <= 100, evidence: { rank: allTimeRank, category: detectedCategory } },
        { type: 'first_top_10',     achieved: allTimeRank <= 10,  evidence: { rank: allTimeRank, category: detectedCategory } },
        { type: 'first_number_one', achieved: allTimeRank === 1,  evidence: { rank: allTimeRank, category: detectedCategory } },
      ]
      for (const m of milestones) {
        if (!m.achieved) continue
        await admin.from('ladder_milestones').insert({
          project_id:     projectId,
          milestone_type: m.type,
          category:       detectedCategory,
          evidence:       m.evidence,
        })  // unique constraint silently rejects re-firings
      }
    }
  } catch (e) {
    console.error('[ladder milestones]', (e as Error)?.message ?? String(e))
  }

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
      is_native_app:       isNativeApp,
      use_web_slots:       useWebSlots,
      live_url_reachable:  health.ok,
      lighthouse:          useWebSlots ? lhScore : { total: libLhEquivPts, equivalent_for: `${gh.form_factor}${health.ok ? '' : '-no-live-url'}`, breakdown: { tests: libTestsPts, docs: libDocsPts, types: libTypesPts, governance: libGovPts } },
      production_maturity: maturity,
      source_hygiene:      hygiene,
      completeness_pts:    completenessPts,
      tech:                { pts: tech.pts, layers: tech.layers },
      brief:               { ...briefScore, effective: briefEffective, substitute: briefSubst },
      health_pts:          healthPts,
      // Native-app specific surface · only populated when isNativeApp.
      // Lets Claude reason on distribution evidence instead of penalizing
      // missing Lighthouse, and lets the UI show a 'Distribution' card.
      native_distribution: isNativeApp ? {
        pts: distributionPts,
        breakdown: {
          app_store:        gh.signals.has_app_store,
          play_store:       gh.signals.has_play_store,
          test_flight:      gh.signals.has_test_flight,
          f_droid:          gh.signals.has_f_droid,
          release_binary:   gh.signals.has_release_binary,
        },
      } : null,
      native_completeness: isNativeApp ? {
        pts: nativeComplPts,
        breakdown: {
          privacy_policy:        gh.signals.has_privacy_policy,
          permissions_manifest:  gh.signals.has_permissions_manifest,
        },
      } : null,
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
