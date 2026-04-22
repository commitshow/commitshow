// apply-artifact — v1.5 §15.5 Apply-to-my-repo
//
// Receives a library item + buyer repo choice + variable values, substitutes
// {{VARS}}, and opens a PR on the buyer's GitHub repo using the user's own
// OAuth token (scope: public_repo). Logs the event into
// artifact_applications.
//
// Auth model:
//   - Supabase JWT (access_token) from the caller → verifies member identity.
//   - `github_token` in body is the session's provider_token (lives client-
//     side only). Passed explicitly so we don't need user-scoped session
//     lookup on the server.
//
// Scope (V0):
//   - Writes the PRIMARY file only (content_md → target_path). Multi-file
//     bundles (Skills / Recipes) deferred to V1 — they already ship as a
//     single SKILL.md for the MVP.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

interface ApplyBody {
  md_id:              string
  github_token:       string             // session.provider_token from the client
  owner:              string             // repo owner (user or org)
  repo:               string             // repo name
  target_path:        string             // e.g. "CLAUDE.md" / ".cursorrules" / ".claude/skills/foo/SKILL.md"
  variable_values?:   Record<string, string>
  commit_message?:    string
  pr_title?:          string
  pr_body?:           string
  base_branch?:       string             // overrides repo default
  applied_to_project?: string            // optional FK back to buyer's own project
}

// ── Variable substitution ────────────────────────────────────
// Supports {{VAR}} and {{ VAR }} with surrounding whitespace tolerance.
// Missing variables are left intact so the buyer sees them in the PR.

function substituteVariables(content: string, values: Record<string, string>): string {
  if (!values || Object.keys(values).length === 0) return content
  return content.replace(/\{\{\s*([A-Z][A-Z0-9_]{2,})\s*\}\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  })
}

// ── GitHub API helpers (all use the user's public_repo token) ──

interface GithubError { status: number; message: string }

async function gh<T>(
  method: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<T | GithubError> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = res.statusText
    try { const j = await res.json(); message = j?.message ?? message } catch { /* noop */ }
    return { status: res.status, message }
  }
  return await res.json() as T
}

function isGhError(x: unknown): x is GithubError {
  return typeof x === 'object' && x !== null && 'status' in x && 'message' in x
}

// ── PR-branch creation flow ─────────────────────────────────
// 1. Resolve base branch + its HEAD commit sha
// 2. Create a new branch `commit-show/<slug>-<ts>` pointing at HEAD
// 3. Use `PUT /repos/:owner/:repo/contents/:path` to create or overwrite the
//    target file on the new branch (handles blob + tree + commit in one call)
// 4. Open PR

interface RepoInfo { default_branch: string; permissions?: { push?: boolean } }
interface RefInfo  { object: { sha: string } }
interface ContentInfo { sha: string }
interface CreateCommitResp { commit: { sha: string }; content: { html_url: string } }
interface PullResp { html_url: string; number: number }

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact'
}

async function openPullRequest(
  token: string,
  body: ApplyBody,
  fileContent: string,
  libraryTitle: string,
): Promise<{ pr_url: string; branch: string; file_url: string } | GithubError> {
  const { owner, repo, target_path, base_branch, commit_message, pr_title, pr_body } = body

  // 1. Repo info (for default branch + push permission)
  const repoInfo = await gh<RepoInfo>('GET', token, `/repos/${owner}/${repo}`)
  if (isGhError(repoInfo)) return repoInfo
  const baseBranch = base_branch || repoInfo.default_branch
  if (repoInfo.permissions && repoInfo.permissions.push === false) {
    return { status: 403, message: 'You do not have push access to this repo' }
  }

  // 2. Base ref sha
  const baseRef = await gh<RefInfo>('GET', token, `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`)
  if (isGhError(baseRef)) return baseRef
  const baseSha = baseRef.object.sha

  // 3. New branch name — timestamped so retries don't collide
  const stamp  = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const branch = `commit-show/${slugify(libraryTitle)}-${stamp}`

  const newRef = await gh<RefInfo>('POST', token, `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  })
  if (isGhError(newRef)) return newRef

  // 4. Check if file already exists on base (to include sha for overwrite)
  const existing = await gh<ContentInfo>(
    'GET', token,
    `/repos/${owner}/${repo}/contents/${encodeURI(target_path)}?ref=${encodeURIComponent(baseBranch)}`,
  )
  const existingSha = !isGhError(existing) ? existing.sha : undefined

  // 5. Create / overwrite file on the new branch
  const encoded = b64encodeUtf8(fileContent)
  const commitMsg = commit_message || `chore(commit.show): apply "${libraryTitle}"`

  const put = await gh<CreateCommitResp>(
    'PUT', token,
    `/repos/${owner}/${repo}/contents/${encodeURI(target_path)}`,
    {
      message: commitMsg,
      content: encoded,
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    },
  )
  if (isGhError(put)) return put

  // 6. Open PR
  const prTitle = pr_title || `Apply "${libraryTitle}" from commit.show`
  const prDefaultBody =
    `This PR was opened from **[commit.show](https://commit.show)** — an artifact from the league's Library.\n\n` +
    `- Target path: \`${target_path}\`\n` +
    `- Applied by: commit.show Apply-to-my-repo flow\n\n` +
    `Review the diff, then merge when ready.`
  const pull = await gh<PullResp>('POST', token, `/repos/${owner}/${repo}/pulls`, {
    title: prTitle,
    head:  branch,
    base:  baseBranch,
    body:  pr_body || prDefaultBody,
  })
  if (isGhError(pull)) return pull

  return { pr_url: pull.html_url, branch, file_url: put.content.html_url }
}

// base64 that preserves utf-8 (GitHub requires base64)
function b64encodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // btoa is available in Deno
  return btoa(bin)
}

// ── Handler ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // User identity via their JWT
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Authorization: Bearer <access_token> required' }, 401)
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401)
  const userId = userData.user.id

  let payload: ApplyBody
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const required = ['md_id', 'github_token', 'owner', 'repo', 'target_path'] as const
  for (const k of required) {
    if (!payload[k]) return json({ error: `${k} required` }, 400)
  }

  // Service-role client for trusted reads + artifact_applications insert
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Load library item — guarded by RLS when queried via anon, but we use
  // service role to include `published` items regardless. Verify it's
  // actually published before applying.
  const { data: item, error: itemErr } = await admin
    .from('md_library')
    .select('id, title, content_md, status, target_format, variables')
    .eq('id', payload.md_id)
    .maybeSingle()
  if (itemErr || !item) return json({ error: 'Library item not found' }, 404)
  if (item.status !== 'published') return json({ error: 'Library item is not published' }, 400)
  if (!item.content_md) return json({ error: 'Library item has no content to apply' }, 400)

  const substituted = substituteVariables(item.content_md, payload.variable_values || {})

  const result = await openPullRequest(payload.github_token, payload, substituted, item.title)
  if (isGhError(result)) {
    return json({ error: `GitHub: ${result.message}`, status: result.status }, result.status >= 500 ? 502 : 400)
  }

  // Log the application (best-effort — don't fail the PR if this errors)
  const { error: logErr } = await admin.from('artifact_applications').insert({
    md_id:              payload.md_id,
    applied_by:         userId,
    applied_to_project: payload.applied_to_project ?? null,
    github_pr_url:      result.pr_url,
    variable_values:    payload.variable_values ?? {},
  })
  if (logErr) console.error('artifact_applications insert failed', logErr)

  // Bump downloads_count — "apply" counts as a download-equivalent for AP
  // and discovery signals. Service role bypasses RLS.
  const { data: current } = await admin
    .from('md_library').select('downloads_count').eq('id', payload.md_id).maybeSingle()
  if (current) {
    await admin.from('md_library')
      .update({ downloads_count: (current.downloads_count ?? 0) + 1 })
      .eq('id', payload.md_id)
  }

  return json({
    ok:       true,
    pr_url:   result.pr_url,
    branch:   result.branch,
    file_url: result.file_url,
  })
})
