// Cloudflare Pages Function · GET https://commit.show/api/audit?repo=<github-url>&format=md|json
//
// Public, fetch-friendly audit endpoint for agents that can't shell out
// (gemini.google.com chat · ChatGPT WebFetch · n8n HTTP node · curl/jq
// in scripts). Wraps the existing Supabase audit-preview Edge Function
// so we don't duplicate audit logic — this layer only handles HTTP
// shape, CORS, and markdown rendering.
//
// Response formats:
//   format=md   (default) — markdown summary the agent can paste into
//                           its reply to the user. Includes score, pillars,
//                           top 3 strengths + 2 concerns, project URL.
//   format=json           — same envelope as the CLI's --json output, so
//                           a downstream tool can parse it programmatically.
//
// Rate limits are inherited from audit-preview (per-IP / per-URL / global
// daily caps · §15-C.1). When the limit is hit we surface the same
// quota_reset envelope.
//
// Cache: short-lived (60s) so an agent that polls a popular repo doesn't
// hammer Claude. The audit-preview function itself does longer caching by
// commit_sha; this is just an HTTP-edge buffer.

interface Env {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

// Pages Function context — typed locally so we don't need to pull in
// @cloudflare/workers-types just for this single file.
interface PagesContext {
  request: Request
  env:     Env
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const GITHUB_RE     = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i
const GITHUB_HOST   = /^github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i
const GITHUB_SLUG   = /^([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/

function canonicalize(input: string): { url: string; slug: string } | null {
  const s = input.trim()
  const m = s.match(GITHUB_RE) ?? s.match(GITHUB_HOST) ?? s.match(GITHUB_SLUG)
  if (!m) return null
  const owner = m[1]
  const repo  = m[2].replace(/\.git$/, '')
  return { url: `https://github.com/${owner}/${repo}`, slug: `${owner}/${repo}` }
}

interface PreviewSnapshot {
  score_total?:    number
  score_auto?:     number
  score_forecast?: number
  score_community?: number
  rich_analysis?: {
    strengths?: Array<{ axis?: string; bullet?: string }>
    concerns?:  Array<{ axis?: string; bullet?: string }>
  }
}

interface PreviewProject {
  id?:         string
  project_name?: string
  github_url?: string
}

interface PreviewEnvelope {
  status?:   'ready' | 'pending' | string
  project?:  PreviewProject
  snapshot?: PreviewSnapshot
  error?:    string
  message?:  string
  reason?:   string
  quota?:    Record<string, unknown>
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status:  init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...CORS, ...(init.headers as Record<string, string> ?? {}) },
  })
}

function textResponse(body: string, contentType: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status:  init.status ?? 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=60', ...CORS, ...(init.headers as Record<string, string> ?? {}) },
  })
}

function renderMarkdown(env: PreviewEnvelope, slug: string): string {
  const p     = env.project   ?? {}
  const snap  = env.snapshot  ?? {}
  const total = typeof snap.score_total === 'number' ? snap.score_total : null
  const audit = typeof snap.score_auto === 'number' ? snap.score_auto : null
  const scout = typeof snap.score_forecast === 'number' ? snap.score_forecast : null
  const comm  = typeof snap.score_community === 'number' ? snap.score_community : null
  const strengths = snap.rich_analysis?.strengths?.slice(0, 3) ?? []
  const concerns  = snap.rich_analysis?.concerns?.slice(0, 2) ?? []
  const projectUrl = p.id ? `https://commit.show/projects/${p.id}` : 'https://commit.show'

  const lines: string[] = []
  lines.push(`# commit.show audit · ${slug}`)
  lines.push('')
  if (total !== null) {
    lines.push(`**Score: ${total} / 100**`)
  } else {
    lines.push('Score: not yet computed.')
  }
  lines.push('')
  if (audit !== null || scout !== null || comm !== null) {
    lines.push('| Pillar | Score |')
    lines.push('|---|---|')
    if (audit !== null) lines.push(`| Audit (50%) | ${audit} / 50 |`)
    if (scout !== null) lines.push(`| Scout (30%) | ${scout} / 30 |`)
    if (comm  !== null) lines.push(`| Community (20%) | ${comm} / 20 |`)
    lines.push('')
  }
  if (strengths.length > 0) {
    lines.push('## Strengths')
    strengths.forEach((s, i) => {
      const axis = s.axis ? `[${s.axis}] ` : ''
      lines.push(`${i + 1}. ${axis}${s.bullet ?? ''}`)
    })
    lines.push('')
  }
  if (concerns.length > 0) {
    lines.push('## Concerns')
    concerns.forEach((c, i) => {
      const axis = c.axis ? `[${c.axis}] ` : ''
      lines.push(`${i + 1}. ${axis}${c.bullet ?? ''}`)
    })
    lines.push('')
  }
  lines.push(`[View full audit on commit.show](${projectUrl})`)
  lines.push('')
  lines.push('---')
  lines.push('Powered by commit.show — the audit league for vibe-coded projects. Run `npx commitshow audit ' + slug + '` to re-run from a terminal.')
  return lines.join('\n')
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405 })
  }

  // Parse params from query string (GET) or JSON body (POST).
  const url = new URL(request.url)
  let repo = url.searchParams.get('repo') ?? url.searchParams.get('url') ?? ''
  let format = (url.searchParams.get('format') ?? 'md').toLowerCase()
  if (request.method === 'POST') {
    try {
      const body = await request.json() as { repo?: string; url?: string; format?: string }
      repo   = body.repo ?? body.url ?? repo
      format = (body.format ?? format).toLowerCase()
    } catch {
      // ignore — fall back to query string
    }
  }
  if (!repo) {
    return jsonResponse({
      error:   'missing_repo',
      message: 'Pass ?repo=<github-url> or owner/repo. Example: /api/audit?repo=github.com/cursor/cursor',
    }, { status: 400 })
  }

  const canon = canonicalize(repo)
  if (!canon) {
    return jsonResponse({
      error:   'bad_repo',
      message: 'Not a recognizable GitHub URL or owner/repo slug.',
      input:   repo,
    }, { status: 400 })
  }

  // HEAD pre-flight against github.com — same idea as the CLI: an agent
  // that invented the slug gets a clean not_found before we burn budget.
  try {
    const head = await fetch(canon.url, { method: 'HEAD', redirect: 'follow' })
    if (head.status === 404) {
      return jsonResponse({
        error:   'not_found',
        message: `${canon.slug} doesn't resolve on github.com — wrong owner spelling, private repo, or renamed.`,
        target:  canon.url,
      }, { status: 404 })
    }
  } catch {
    // network blip — let the audit-preview path produce a clearer error
  }

  const SUPABASE_URL = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL
  const ANON_KEY     = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !ANON_KEY) {
    return jsonResponse({ error: 'misconfigured', message: 'Server missing Supabase credentials.' }, { status: 500 })
  }

  // Hand off to the existing audit-preview Edge Function. It handles
  // rate limits, caching, project creation, and Claude orchestration.
  const previewRes = await fetch(`${SUPABASE_URL}/functions/v1/audit-preview`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey':        ANON_KEY,
      // Forward the original requester's IP so audit-preview's per-IP
      // rate limit is correctly attributed.
      'x-forwarded-for': request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? '',
    },
    body: JSON.stringify({ github_url: canon.url }),
  })

  let payload: PreviewEnvelope
  try {
    payload = await previewRes.json() as PreviewEnvelope
  } catch {
    return jsonResponse({ error: 'upstream_invalid_json' }, { status: 502 })
  }

  // Surface upstream rate-limit / explicit error payloads as-is.
  if (!previewRes.ok || payload.error) {
    return jsonResponse(payload, { status: previewRes.status === 200 ? 502 : previewRes.status })
  }

  if (format === 'json') {
    return jsonResponse(payload)
  }

  // Default: markdown
  const md = renderMarkdown(payload, canon.slug)
  return textResponse(md, 'text/markdown; charset=utf-8')
}
