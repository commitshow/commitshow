// auto-tweet · @commitshow X auto-post.
//
// Fired by analyze-project after a fresh snapshot lands. Runs the
// 4-gate eligibility check, renders one of N tweet templates, posts
// via X API v2 (when COMMITSHOW_X_ACCESS_TOKEN is set), and records
// the outcome in auto_tweets.
//
// Dry-run mode: when COMMITSHOW_X_ACCESS_TOKEN is not configured, the
// function still runs the full eligibility + render path but records
// status='skipped' (reason='no_x_token') instead of actually posting.
// Lets us validate the pipeline end-to-end before the user wires the
// X tokens. Once the secret lands, real posts start automatically —
// no code redeploy needed.
//
// Eligibility gates:
//   1. score_total >= 85         · "wow" rare-event threshold
//   2. status != 'preview'        · platform-auditioned only · CLI walk-ons
//                                   are anonymous third-party audits with
//                                   no consent to be on the brand stage
//   3. cooldown                   · no posted row in last 14 days
//   4. social_share_disabled = false
//
// Templates (4) rotate based on a deterministic hash of project_id +
// score so the same audit always renders the same template (idempotent
// retries don't re-roll content).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const COOLDOWN_DAYS = 14
const SCORE_THRESHOLD = 85

// ── Templates · 4 variants rotate per project. Each takes the same
// shape and produces a tweet body. URL goes at the END so X's link
// unfurler picks up our twitter:image (PNG og card).
type TemplateInput = {
  name:       string
  score:      number
  scope:      string | null
  topStrength: string | null
  topConcern:  string | null
  url:        string
}

function templateA(t: TemplateInput): string {
  // Achievement framing
  const lines: string[] = []
  lines.push(`just audited ${t.name} · ${t.score} / 100`)
  lines.push('')
  if (t.scope) lines.push(`scope: ${t.scope}`)
  lines.push('')
  if (t.topStrength) lines.push(`↑ ${truncate(t.topStrength, 90)}`)
  if (t.topConcern)  lines.push(`↓ ${truncate(t.topConcern,  90)}`)
  lines.push('')
  lines.push(`audit any vibe-coded repo from your terminal:`)
  lines.push(`$ npx commitshow audit github.com/<owner>/<repo>`)
  lines.push('')
  lines.push(t.url)
  return lines.join('\n')
}

function templateB(t: TemplateInput): string {
  // Curiosity hook
  const lines: string[] = []
  lines.push(`${t.score} / 100 — that's the production-readiness audit on ${t.name}.`)
  lines.push('')
  if (t.scope) lines.push(`scope: ${t.scope}`)
  if (t.topConcern) {
    lines.push('')
    lines.push(`one concern stuck out:`)
    lines.push(`↓ ${truncate(t.topConcern, 100)}`)
  }
  lines.push('')
  lines.push(`full breakdown ↗`)
  lines.push(t.url)
  return lines.join('\n')
}

function templateC(t: TemplateInput): string {
  // Question hook
  const lines: string[] = []
  lines.push(`how does ${t.name} score on production-readiness?`)
  lines.push('')
  lines.push(`${t.score} / 100 · strong band`)
  if (t.scope) lines.push(`(${t.scope})`)
  lines.push('')
  lines.push(`curious how your AI-built project compares?`)
  lines.push(`$ npx commitshow audit <github-url>`)
  lines.push('')
  lines.push(t.url)
  return lines.join('\n')
}

function templateD(t: TemplateInput): string {
  // Engagement hook · what they nailed / what they missed
  const lines: string[] = []
  lines.push(`audited ${t.name} today · ${t.score} / 100`)
  lines.push('')
  if (t.topStrength) lines.push(`what they nail · ${truncate(t.topStrength, 100)}`)
  if (t.topConcern)  lines.push(`what they miss · ${truncate(t.topConcern,  100)}`)
  lines.push('')
  lines.push(t.url)
  return lines.join('\n')
}

const TEMPLATES = [
  { id: 'a', render: templateA },
  { id: 'b', render: templateB },
  { id: 'c', render: templateC },
  { id: 'd', render: templateD },
] as const

// ── Trajectory templates · narrate the climb (start → end · days · band).
// Used when kind='trajectory' (special events like graduation / encore).
// Each takes a richer input shape with the start/end scores + days span.
type TrajectoryInput = {
  name:        string
  startScore:  number
  endScore:    number
  delta:       number
  days:        number
  band:        string
  url:         string
}

function trajectoryA(t: TrajectoryInput): string {
  // Climb narrative
  const lines: string[] = []
  lines.push(`${t.name} · ${t.startScore} → ${t.endScore} on commit.show`)
  lines.push('')
  lines.push(`+${t.delta} pts in ${t.days} day${t.days === 1 ? '' : 's'} · band ${t.band}`)
  lines.push('')
  lines.push(t.url)
  return lines.join('\n')
}

function trajectoryB(t: TrajectoryInput): string {
  // Receipt framing
  const lines: string[] = []
  lines.push(`audition arc · ${t.name}`)
  lines.push('')
  lines.push(`day 0  · ${t.startScore} / 100`)
  lines.push(`day ${t.days} · ${t.endScore} / 100`)
  lines.push('')
  lines.push(`band ${t.band} · audited by the engine, auditioned for Scouts`)
  lines.push(t.url)
  return lines.join('\n')
}

function trajectoryC(t: TrajectoryInput): string {
  // Question / curiosity hook
  const lines: string[] = []
  lines.push(`how does an AI-built project go from ${t.startScore} to ${t.endScore} in ${t.days} day${t.days === 1 ? '' : 's'}?`)
  lines.push('')
  lines.push(`${t.name} · the trajectory ↓`)
  lines.push(t.url)
  return lines.join('\n')
}

function trajectoryD(t: TrajectoryInput): string {
  // Minimal · let the card carry the story
  const lines: string[] = []
  lines.push(`${t.name} · ${t.endScore} / 100 · band ${t.band}`)
  lines.push('')
  lines.push(`+${t.delta} over ${t.days} day${t.days === 1 ? '' : 's'} of audits.`)
  lines.push('')
  lines.push(t.url)
  return lines.join('\n')
}

const TRAJECTORY_TEMPLATES = [
  { id: 'ta', render: trajectoryA },
  { id: 'tb', render: trajectoryB },
  { id: 'tc', render: trajectoryC },
  { id: 'td', render: trajectoryD },
] as const

function pickTemplate(seedString: string): typeof TEMPLATES[number] {
  const idx = Math.abs(djb2(seedString)) % TEMPLATES.length
  return TEMPLATES[idx]
}

function pickTrajectoryTemplate(seedString: string): typeof TRAJECTORY_TEMPLATES[number] {
  const idx = Math.abs(djb2(seedString)) % TRAJECTORY_TEMPLATES.length
  return TRAJECTORY_TEMPLATES[idx]
}

function djb2(s: string): number {
  // Tiny stable hash · djb2-ish. Avoids needing crypto.
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h |= 0
  }
  return h
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).replace(/[\s,;:.\-—]+$/, '') + '…'
}

// ── send-tweet delegation ───────────────────────────────────
// auto-tweet doesn't talk to X directly — it posts a kind='official'
// request to the existing send-tweet Edge Function, which handles
// token lookup from x_official_account, OAuth 2.0 refresh, and the
// X API v2 call. Single source of truth for outbound X mechanics.
async function postViaSendTweet(
  supabaseUrl: string,
  serviceKey:  string,
  text: string,
  dedupeKey:   string,
): Promise<{ ok: true; id: string; tweet_url: string } | { ok: false; status: number; body: string }> {
  const r = await fetch(`${supabaseUrl}/functions/v1/send-tweet`, {
    method: 'POST',
    headers: {
      // apikey + Authorization both required when calling a verify_jwt
      // function from another Edge Function (gateway needs the apikey
      // for routing AND a JWT for caller identification).
      apikey:          serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      kind:         'official',
      text,
      dedupe_key:   dedupeKey,
      trigger_kind: 'auto_tweet',
    }),
  })
  const body = await r.text()
  if (!r.ok) return { ok: false, status: r.status, body }
  try {
    const parsed = JSON.parse(body) as { tweet_id?: string; tweet_url?: string; deduped?: boolean }
    if (!parsed.tweet_id) return { ok: false, status: r.status, body }
    return {
      ok: true,
      id:        parsed.tweet_id,
      tweet_url: parsed.tweet_url ?? `https://x.com/commitshow/status/${parsed.tweet_id}`,
    }
  } catch {
    return { ok: false, status: r.status, body }
  }
}

// ── Main handler ────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Token presence check · the table is the source of truth (set by
  // the X OAuth admin link flow in /admin). We don't read the token
  // here — send-tweet does — but we want to know whether to skip
  // the call vs land in dry-run mode.
  const { data: tokRow } = await admin
    .from('x_official_account')
    .select('access_token')
    .eq('singleton', true)
    .maybeSingle()
  const hasToken = !!(tokRow && (tokRow as { access_token?: string }).access_token)

  let payload: { project_id?: string; kind?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const projectId = payload.project_id
  if (!projectId) return json({ error: 'project_id required' }, 400)
  // Card kind · 'tweet' (default · static score card · score-cross trigger)
  // or 'trajectory' (climb arc card · special events like graduation /
  // encore). Determines BOTH the og:image variant we point X at AND
  // which template family renders the tweet body.
  const kind = (payload.kind === 'trajectory' ? 'trajectory' : 'tweet') as 'tweet' | 'trajectory'

  // Load project + latest snapshot.
  const { data: project, error: pErr } = await admin
    .from('projects')
    .select('id, project_name, score_total, status, github_url, social_share_disabled, creator_id')
    .eq('id', projectId)
    .maybeSingle()
  if (pErr || !project) return json({ error: 'project not found', detail: pErr?.message }, 404)

  // Gate 1 · score
  const score = project.score_total ?? 0
  if (score < SCORE_THRESHOLD) {
    return json({ skipped: true, reason: 'score_below_threshold', score, threshold: SCORE_THRESHOLD })
  }

  // Gate 2 · only platform-auditioned projects (consent implicit · the
  // creator submitted via web). CLI walk-ons (status='preview') are
  // anonymous third-party audits — no consent to be on the brand stage,
  // so they get a score reveal in the terminal but stay off X.
  if (project.status === 'preview') {
    return json({ skipped: true, reason: 'walk_on_no_consent', status: project.status })
  }

  // Gate 3 · cooldown · 14 days
  const cooldownStart = new Date(Date.now() - COOLDOWN_DAYS * 86400_000).toISOString()
  const { data: recent } = await admin
    .from('auto_tweets')
    .select('id, posted_at')
    .eq('project_id', projectId)
    .eq('status', 'posted')
    .gte('posted_at', cooldownStart)
    .limit(1)
  if (recent && recent.length > 0) {
    return json({ skipped: true, reason: 'cooldown', last_posted_at: recent[0].posted_at })
  }

  // Gate 4 · opt-out
  if (project.social_share_disabled) {
    return json({ skipped: true, reason: 'social_share_disabled' })
  }

  // Pull strengths + concerns + scanned_scope from the latest snapshot.
  const { data: snap } = await admin
    .from('analysis_snapshots')
    .select('rich_analysis, github_signals')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const rich = snap?.rich_analysis as { scout_brief?: { strengths?: Array<{ bullet?: string }>; weaknesses?: Array<{ bullet?: string }> } } | null
  const ghSig = snap?.github_signals as { scanned_scope?: string } | null
  const topStrength = rich?.scout_brief?.strengths?.[0]?.bullet ?? null
  const topConcern  = rich?.scout_brief?.weaknesses?.[0]?.bullet ?? null
  const scope       = ghSig?.scanned_scope ?? null

  // URL the tweet links to · ?og=trajectory swaps the page's og:image
  // to the trajectory PNG (via /functions/projects/_middleware.ts), so
  // X unfurls the climb arc card instead of the static score card.
  const shareUrl = kind === 'trajectory'
    ? `https://commit.show/projects/${project.id}?og=trajectory`
    : `https://commit.show/projects/${project.id}`

  // Render template · stable per (project_id, score, kind) so retries
  // don't reroll. Trajectory kind uses richer input pulled from the
  // snapshot timeline (start, end, days, delta).
  let templateId: string
  let tweetText: string
  if (kind === 'trajectory') {
    // Pull the full snapshot arc to compute start/end/delta/days.
    const { data: arc } = await admin
      .from('analysis_snapshots')
      .select('created_at, score_total')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(30)
    const pts = (arc ?? []) as Array<{ created_at: string; score_total: number }>
    if (pts.length < 2) {
      return json({ skipped: true, reason: 'trajectory_needs_2_snapshots', snapshot_count: pts.length })
    }
    const startScore = pts[0].score_total
    const endScore   = pts[pts.length - 1].score_total
    const t0 = new Date(pts[0].created_at).getTime()
    const tN = new Date(pts[pts.length - 1].created_at).getTime()
    const days  = Math.max(0, Math.round((tN - t0) / 86400_000))
    const delta = endScore - startScore
    const band  = score >= 85 ? 'encore' : score >= 70 ? 'strong' : score >= 50 ? 'building' : 'early'
    const tpl   = pickTrajectoryTemplate(`${projectId}:${endScore}`)
    templateId  = tpl.id
    tweetText   = tpl.render({ name: project.project_name, startScore, endScore, delta, days, band, url: shareUrl })
  } else {
    const tpl  = pickTemplate(`${projectId}:${score}`)
    templateId = tpl.id
    tweetText  = tpl.render({
      name:        project.project_name,
      score,
      scope,
      topStrength,
      topConcern,
      url:         shareUrl,
    })
  }

  // Truncate to 280 chars (X hard limit). Templates are ~250 chars
  // headroom but a long project name + concern can push over.
  const finalText = tweetText.length <= 280 ? tweetText : tweetText.slice(0, 277) + '...'

  // Post · or skip if no token in x_official_account.
  if (!hasToken) {
    await admin.from('auto_tweets').insert({
      project_id:    projectId,
      score_at_post: score,
      template_used: templateId,
      status:        'skipped',
      error_message: 'no_x_token',
      payload:       { tweet_text: finalText, scope, topStrength, topConcern, kind },
    })
    return json({
      skipped:    true,
      reason:     'no_x_token',
      dry_run:    true,
      kind,
      template:   templateId,
      tweet_text: finalText,
    })
  }

  // Idempotent dedupe key · includes kind so the same project can have
  // both a tweet card (score-cross) and a trajectory card (encore) post
  // without colliding. send-tweet's x_share_log unique check converts
  // duplicates to a no-op return.
  const dedupeKey = `auto:${projectId}:${kind}:${score}`
  const post = await postViaSendTweet(SUPABASE_URL, SERVICE_KEY, finalText, dedupeKey)
  if (!post.ok) {
    await admin.from('auto_tweets').insert({
      project_id:    projectId,
      score_at_post: score,
      template_used: templateId,
      status:        'failed',
      error_message: `send-tweet ${post.status}: ${post.body.slice(0, 500)}`,
      payload:       { tweet_text: finalText, scope, topStrength, topConcern, kind },
    })
    return json({ error: 'send_tweet_failed', status: post.status, body: post.body }, 502)
  }

  await admin.from('auto_tweets').insert({
    project_id:    projectId,
    score_at_post: score,
    template_used: templateId,
    status:        'posted',
    tweet_id:      post.id,
    tweet_url:     post.tweet_url,
    payload:       { tweet_text: finalText, scope, topStrength, topConcern, kind },
  })

  return json({
    ok:        true,
    kind,
    tweet_id:  post.id,
    tweet_url: post.tweet_url,
    template:  templateId,
  })
})
