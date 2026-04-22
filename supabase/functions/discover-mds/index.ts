// discover-mds — v1.5 Artifact Library Discovery (§15.4)
// Detects format-aware candidates (MCP · IDE Rules · Agent Skills · Project
// Rules · Prompt Pack · Patch Recipe) across the repo tree, evaluates each
// on the 4-axis quality rubric, and upserts library-worthy suggestions.
//
// Multi-file bundles (Skills, Recipes) carry sibling file paths in
// bundle_paths so the publish flow can zip them up later.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

// ── Constants ────────────────────────────────────────────────

const FILE_CAP = 14              // total candidates across formats sent to Claude
const BODY_CAP = 6000             // chars per primary file

const EXCLUDE_DIR = /^(node_modules|dist|build|\.next|\.vercel|vendor|coverage|\.git|target|out|\.turbo|\.cache)\//i
const EXCLUDE_MD  = /(^|\/)(README|LICENSE|COPYING|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY|NOTICE|AUTHORS|PATENTS)\.md$/i

type ArtifactFormat =
  | 'mcp_config' | 'ide_rules' | 'agent_skill' | 'project_rules'
  | 'prompt_pack' | 'patch_recipe'

type Category = 'Scaffold' | 'Prompt Library' | 'MCP Config' | 'Project Rules' | 'Backend' | 'Auth/Payment' | 'Playbooks'

// Format → default md_library.category (legacy categorization still in use on UI)
const FORMAT_TO_CATEGORY: Record<ArtifactFormat, Category> = {
  mcp_config:    'MCP Config',
  ide_rules:     'Prompt Library',
  agent_skill:   'Project Rules',
  project_rules: 'Project Rules',
  prompt_pack:   'Prompt Library',
  patch_recipe:  'Auth/Payment',  // overridden by Claude title hint
}

interface Blob { path: string; type: string; sha?: string }

interface FormatCandidate {
  primary_path: string                // file shown to Claude + stored as file_path
  format: ArtifactFormat
  tools: string[]                     // e.g. ['cursor']
  bundle_paths: string[]              // sibling files (for Skills / Recipes / Prompt packs)
  priority: number                    // 0 = highest
}

interface LoadedCandidate extends FormatCandidate {
  body: string                        // primary file content (capped)
  sha: string | null
}

interface ScoredItem {
  candidate: LoadedCandidate
  scores: { iter_depth: number; prod_anchor: number; token_saving: number; distilled: number }
  suggested_category: Category
  suggested_title: string
  suggested_description: string
  detected_variables: Array<{ name: string; occurrences: number }>
  excerpt: string
  library_worthy: boolean
}

// ── Format detectors ────────────────────────────────────────
// Each detector scans the blob list and returns candidates scoped to its
// artifact format. Lower priority = surfaces first.

function detectMcpConfigs(blobs: Blob[]): FormatCandidate[] {
  const out: FormatCandidate[] = []
  const toolHints = (p: string): string[] => {
    const t: string[] = []
    if (/claude_desktop_config/.test(p)) t.push('claude-desktop')
    if (/cursor/i.test(p))                t.push('cursor')
    if (/windsurf/i.test(p))              t.push('windsurf')
    if (/cline/i.test(p))                 t.push('cline')
    return t.length > 0 ? t : ['claude-desktop']  // sensible default
  }
  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p)) continue
    if (/(^|\/)(mcp\.json|\.mcp\.json|claude_desktop_config\.json)$/i.test(p)) {
      out.push({ primary_path: p, format: 'mcp_config', tools: toolHints(p), bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.mcp\/[^/]+\.json$/i.test(p)) {
      out.push({ primary_path: p, format: 'mcp_config', tools: toolHints(p), bundle_paths: [], priority: 1 })
    } else if (/(^|\/)mcp-servers?\/[^/]+\/(index\.(ts|js|mjs)|server\.(ts|js|mjs)|package\.json)$/i.test(p)) {
      // Custom MCP server code — register the primary entry file
      out.push({ primary_path: p, format: 'mcp_config', tools: toolHints(p), bundle_paths: [], priority: 2 })
    }
  }
  return out
}

function detectIdeRules(blobs: Blob[]): FormatCandidate[] {
  const out: FormatCandidate[] = []
  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p)) continue
    if (/(^|\/)\.cursorrules$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['cursor'], bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.cursor\/rules\/[^/]+\.(mdc|md)$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['cursor'], bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.windsurfrules$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['windsurf'], bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.windsurf\/rules\/[^/]+\.(md|mdc)$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['windsurf'], bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.continuerules$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['continue'], bundle_paths: [], priority: 0 })
    } else if (/(^|\/)\.cline\/rules\/.+\.(md|mdc)$/i.test(p)) {
      out.push({ primary_path: p, format: 'ide_rules', tools: ['cline'], bundle_paths: [], priority: 0 })
    }
  }
  return out
}

function detectAgentSkills(blobs: Blob[]): FormatCandidate[] {
  // Skills are directory-based. Primary: `.claude/skills/<name>/SKILL.md`.
  // Bundle: all files under the same `<name>/` directory (up to 12 files).
  const out: FormatCandidate[] = []
  const skillDirs = new Map<string, { primary: string; siblings: string[] }>()

  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p)) continue
    const match = p.match(/^(.+?\.claude\/skills\/[^/]+)\//i) || p.match(/^(.claude\/skills\/[^/]+)\//i)
    if (!match) continue
    const dir = match[1]
    const rel = p.slice(dir.length + 1)
    const entry = skillDirs.get(dir) ?? { primary: '', siblings: [] }
    if (/^SKILL\.md$/i.test(rel)) entry.primary = p
    else                          entry.siblings.push(p)
    skillDirs.set(dir, entry)
  }

  for (const { primary, siblings } of skillDirs.values()) {
    if (!primary) continue
    out.push({
      primary_path: primary,
      format:       'agent_skill',
      tools:        ['claude-agent-sdk'],
      bundle_paths: siblings.slice(0, 12),
      priority:     0,
    })
  }
  return out
}

function detectProjectRules(blobs: Blob[]): FormatCandidate[] {
  // CLAUDE.md · AGENTS.md · RULES.md · CONVENTIONS.md at root or docs/
  const priority = new Map<string, number>([
    ['CLAUDE.md', 0],
    ['AGENTS.md', 0],
    ['RULES.md', 1],
    ['CONVENTIONS.md', 1],
    ['ARCHITECTURE.md', 2],
  ])
  const out: FormatCandidate[] = []
  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p) || EXCLUDE_MD.test(p)) continue
    const base = p.split('/').pop() ?? ''
    const pri = priority.get(base)
    if (pri === undefined) continue
    // Limit to root or docs/ depth — deeper .md with same name is probably stale
    const depth = p.split('/').length
    if (depth > 2 && !p.startsWith('docs/')) continue
    const tools = base === 'AGENTS.md' ? ['claude-agent-sdk', 'cursor'] : base === 'CLAUDE.md' ? ['claude-agent-sdk'] : []
    out.push({ primary_path: p, format: 'project_rules', tools, bundle_paths: [], priority: pri })
  }
  return out
}

function detectPromptPacks(blobs: Blob[]): FormatCandidate[] {
  // A "pack" = 5+ .md files under a prompts-like directory.
  const groups = new Map<string, string[]>()
  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p) || EXCLUDE_MD.test(p)) continue
    if (!/\.md$/i.test(p)) continue
    const m = p.match(/^(.*?\/?prompts?)\//i)
    if (!m) continue
    const dir = m[1]
    const arr = groups.get(dir) ?? []
    arr.push(p)
    groups.set(dir, arr)
  }
  const out: FormatCandidate[] = []
  for (const [dir, files] of groups.entries()) {
    if (files.length < 5) continue  // quality floor — prompt packs need >= 5 prompts
    const sorted = files.sort()
    out.push({
      primary_path: sorted[0],      // representative file for preview
      format:       'prompt_pack',
      tools:        ['universal'],
      bundle_paths: sorted,
      priority:     1,
    })
    // Only register one pack per directory
    void dir
  }
  return out
}

function detectPatchRecipes(blobs: Blob[]): FormatCandidate[] {
  const rootPat = /^(stripe|auth|oauth|webhook|deploy|supabase|cron|rls|clerk|resend|posthog|sentry)[-_][^\/]*\.md$/i
  const dirPat  = /^(integrations?|recipes?|runbooks?|guides?)\/.*\.md$/i

  const out: FormatCandidate[] = []
  for (const b of blobs) {
    const p = b.path
    if (EXCLUDE_DIR.test(p) || EXCLUDE_MD.test(p)) continue
    if (!/\.md$/i.test(p)) continue
    if (rootPat.test(p) || dirPat.test(p)) {
      // Tools inferred from filename hints
      const tools: string[] = []
      if (/stripe/i.test(p))   tools.push('stripe')
      if (/supabase/i.test(p)) tools.push('supabase')
      if (/clerk/i.test(p))    tools.push('clerk')
      if (/resend/i.test(p))   tools.push('resend')
      if (/posthog/i.test(p))  tools.push('posthog')
      if (/sentry/i.test(p))   tools.push('sentry')
      out.push({
        primary_path: p,
        format:       'patch_recipe',
        tools:        tools.length ? tools : ['universal'],
        bundle_paths: [],
        priority:     dirPat.test(p) ? 1 : 2,
      })
    }
  }
  return out
}

function detectAllFormats(blobs: Blob[]): FormatCandidate[] {
  const collected: FormatCandidate[] = []
  collected.push(...detectMcpConfigs(blobs))
  collected.push(...detectIdeRules(blobs))
  collected.push(...detectAgentSkills(blobs))
  collected.push(...detectProjectRules(blobs))
  collected.push(...detectPromptPacks(blobs))
  collected.push(...detectPatchRecipes(blobs))

  // De-dup by primary_path (a file shouldn't appear under two formats)
  const seen = new Set<string>()
  const unique: FormatCandidate[] = []
  for (const c of collected) {
    if (seen.has(c.primary_path)) continue
    seen.add(c.primary_path)
    unique.push(c)
  }

  // Rank: format ordering · priority · path length
  const formatOrder: Record<ArtifactFormat, number> = {
    mcp_config: 0, ide_rules: 0, agent_skill: 0,
    project_rules: 1, patch_recipe: 2, prompt_pack: 3,
  }
  unique.sort((a, b) => {
    const fa = formatOrder[a.format]
    const fb = formatOrder[b.format]
    if (fa !== fb) return fa - fb
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.primary_path.length - b.primary_path.length
  })

  return unique.slice(0, FILE_CAP)
}

// Scan body for `{{VARIABLE}}` placeholders. Returns unique var names +
// occurrence counts.
function detectVariables(body: string): Array<{ name: string; occurrences: number }> {
  const re = /\{\{\s*([A-Z][A-Z0-9_]{2,})\s*\}\}/g
  const counts = new Map<string, number>()
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1]
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 12)
}

// ── Tree fetch + content load ───────────────────────────────

async function fetchRepoTree(githubUrl: string): Promise<{ owner: string; repo: string; defaultBranch: string; blobs: Blob[] } | null> {
  const m = githubUrl.match(/github\.com\/([^/]+)\/([^/\s?#]+)/i)
  if (!m) return null
  const owner = m[1], repo = m[2].replace(/\.git$/, '')

  const token = Deno.env.get('GITHUB_TOKEN')
  const headers: Record<string, string> = { 'User-Agent': 'commit.show-mds', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!repoRes.ok) return null
  const repoData = await repoRes.json()
  const defaultBranch = repoData.default_branch || 'HEAD'

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, { headers })
  if (!treeRes.ok) return { owner, repo, defaultBranch, blobs: [] }
  const treeJson = await treeRes.json()
  const blobs: Blob[] = (treeJson.tree ?? []).filter((b: { type: string }) => b.type === 'blob')
  return { owner, repo, defaultBranch, blobs }
}

async function loadCandidateContent(
  candidate: FormatCandidate,
  owner: string,
  repo: string,
  branch: string,
  blobShaMap: Map<string, string | null>,
): Promise<LoadedCandidate | null> {
  const token = Deno.env.get('GITHUB_TOKEN')
  const headers: Record<string, string> = { 'User-Agent': 'commit.show-mds' }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(candidate.primary_path)}`, { headers })
    if (!res.ok) return null
    const body = await res.text()
    if (!body.trim()) return null
    return {
      ...candidate,
      body: body.slice(0, BODY_CAP),
      sha: blobShaMap.get(candidate.primary_path) ?? null,
    }
  } catch { return null }
}

// ── Claude scoring ──────────────────────────────────────────

async function scoreWithClaude(candidates: LoadedCandidate[], claudeKey: string): Promise<ScoredItem[]> {
  if (candidates.length === 0) return []

  const tool = {
    name: 'score_artifact_candidates',
    description: 'Score each candidate artifact on four axes and suggest library metadata. The format and target tools have already been detected — your job is to rate quality and propose a clear title + description.',
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
              suggested_title:       { type: 'string', maxLength: 80 },
              suggested_description: { type: 'string', maxLength: 280 },
            },
          },
        },
      },
    },
  }

  const system = `You evaluate candidate artifacts in a vibe-coded project for commit.show's Artifact Library. Each candidate has already been classified by format (MCP config · IDE rules · Agent skill · Project rules · Prompt pack · Patch recipe).

Your job per file:

Score 0-10 on FOUR quality axes:
- iter_depth: shows real iteration (failures · v2-after-X notes · "breaking change" · debug stories · lessons learned). 10 = multiple concrete iteration cycles. 0 = pristine / untouched prose.
- prod_anchor: ties claims to real production evidence (deploy URLs · measured numbers · real SDK versions). 10 = anchored throughout. 0 = abstract only.
- token_saving: dense rules/constraints/gotchas that SHORTEN a reader's decision. 10 = a rule-set that saves hours of trial-and-error. 0 = narrative-only.
- distilled: information density. Does every line pull weight? 10 = ruthlessly distilled (CLAUDE.md / RULES.md style). 0 = bloated / template filler.

Suggest:
- suggested_category: map to what a buyer would look for (Scaffold · Prompt Library · MCP Config · Project Rules · Backend · Auth/Payment · Playbooks).
- suggested_title (≤ 80 chars): concrete · describes what it does · NO brand names (no Cursor/Claude/Windsurf/v0/Bolt/Lovable/Cline).
- suggested_description (≤ 280 chars): who it's for, what problem it solves, what makes it reusable.

Rules:
- American English only · no Korean · no Korean punctuation.
- Do NOT name AI coding tool brands in title/description.
- Score strictly on file content. Don't invent claims for files you haven't seen.
- Return ONE tool call containing "items" — ONE object per input file.`

  const userMsg = candidates.map((c, i) => {
    const header = `=== FILE ${i + 1}: ${c.primary_path} · format=${c.format} · tools=${c.tools.join(',')}${c.bundle_paths.length ? ` · bundle=${c.bundle_paths.length} files` : ''} ===`
    return `${header}\n${c.body}`
  }).join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 3500,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'score_artifact_candidates' },
      messages: [{ role: 'user', content: userMsg }],
    }),
  })
  if (!res.ok) {
    console.error('Discovery Claude error', res.status, await res.text())
    return []
  }
  const data = await res.json()
  const block = (data.content || []).find((b: { type: string }) => b.type === 'tool_use')
  const items: Array<{
    file_path: string
    scores: ScoredItem['scores']
    suggested_category: Category
    suggested_title: string
    suggested_description: string
  }> = block?.input?.items ?? []

  return items
    .map(it => {
      const cand = candidates.find(c => c.primary_path === it.file_path)
      if (!cand) return null
      return {
        candidate:             cand,
        scores:                it.scores,
        suggested_category:    it.suggested_category ?? FORMAT_TO_CATEGORY[cand.format],
        suggested_title:       it.suggested_title,
        suggested_description: it.suggested_description,
        detected_variables:    detectVariables(cand.body),
        excerpt:               cand.body.slice(0, 500),
        // v1.7 · 4-axis no longer gates surface; everything scored gets shown.
        // Quality signal comes from community (downloads · adoption · grade).
        library_worthy:        true,
      } satisfies ScoredItem
    })
    .filter((x): x is ScoredItem => x !== null)
}

// ── Handler ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let payload: { project_id?: string }
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const projectId = payload.project_id
  if (!projectId) return json({ error: 'project_id required' }, 400)

  const { data: project } = await admin
    .from('projects')
    .select('id, github_url, creator_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project?.github_url) return json({ ok: true, discoveries_found: 0, reason: 'no_github_url' })

  const { data: latest } = await admin
    .from('analysis_snapshots')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const tree = await fetchRepoTree(project.github_url)
  if (!tree) return json({ ok: true, discoveries_found: 0, reason: 'bad_github_url' })

  const { owner, repo, defaultBranch, blobs } = tree
  if (blobs.length === 0) return json({ ok: true, discoveries_found: 0, candidates_scanned: 0, reason: 'empty_tree' })

  const blobShaMap = new Map<string, string | null>()
  blobs.forEach(b => blobShaMap.set(b.path, b.sha ?? null))

  const candidates = detectAllFormats(blobs)
  if (candidates.length === 0) return json({ ok: true, discoveries_found: 0, candidates_scanned: 0, reason: 'no_candidates' })

  const loaded = (await Promise.all(
    candidates.map(c => loadCandidateContent(c, owner, repo, defaultBranch, blobShaMap))
  )).filter((x): x is LoadedCandidate => x !== null)

  const claudeKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!claudeKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY not set' }, 500)

  const scored = await scoreWithClaude(loaded, claudeKey)

  if (scored.length > 0) {
    const rows = scored.map(s => ({
      project_id:            projectId,
      snapshot_id:           latest?.id ?? null,
      creator_id:            project.creator_id,
      file_path:             s.candidate.primary_path,
      sha:                   s.candidate.sha,
      claude_scores:         s.scores,
      suggested_category:    s.suggested_category,
      suggested_title:       s.suggested_title,
      suggested_description: s.suggested_description,
      excerpt:               s.excerpt,
      status:                'suggested',
      // v1.5 format-aware fields
      detected_format:       s.candidate.format,
      detected_tools:        s.candidate.tools,
      detected_variables:    s.detected_variables,
      bundle_paths:          s.candidate.bundle_paths,
    }))
    const { error: discErr } = await admin.from('md_discoveries').upsert(rows, { onConflict: 'project_id,file_path,snapshot_id' })
    if (discErr) console.error('md_discoveries insert failed', discErr)
  }

  return json({
    ok: true,
    candidates_scanned: loaded.length,
    discoveries_found:  scored.length,
    formats_by_candidate: loaded.map(c => ({ path: c.primary_path, format: c.format, tools: c.tools })),
  })
})
