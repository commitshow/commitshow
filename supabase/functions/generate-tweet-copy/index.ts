// generate-tweet-copy — Claude API call producing 3 tweet variations
// in the M (CMO) brand voice. Admin-gated · used by /admin/cmo
// freeform tweet section.
//
// Flow:
//   1. Authenticate · admin-only (members.is_admin).
//   2. Build system prompt mirroring CMO.md voice rules (kept inline
//      so the function is self-contained · CMO.md itself is gitignored).
//   3. Call claude-sonnet-4-6 with user prompt + optional context.
//   4. Parse JSON · return [{copy, hashtags, rationale}, ...].

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const MODEL = 'claude-sonnet-4-5'

const SYSTEM_PROMPT = `You are M, commit.show's CMO. You draft tweets for the @commitshow X account.

commit.show is the vibe-coding league: AI-assisted projects (Cursor / Claude Code / Lovable / etc.) get audited by an engine and ranked. Tagline: "Every commit, on stage."

Note on input language: the strategic context (insights / roadmap) below may be written in Korean — the CEO reads it internally. The TWEETS YOU OUTPUT MUST STILL BE AMERICAN ENGLISH. Read Korean context and translate strategically into English tweet copy.

Voice rules (NON-NEGOTIABLE):
- American English. Lowercase by default. Capitalize only proper nouns and start of sentences.
- Use contractions: "we've · don't · isn't · it's". Never the long forms in body copy.
- Em dash (—) and middot (·) only. NO semicolons. NO "Furthermore / Therefore / However / Additionally".
- Concrete > abstract: cite a number or file when possible.
- NEVER use the word "AI" to describe commit.show's offering. Say "audit · audit report · audit findings · the engine · automated checks · the rubric". Allowed only when describing the user's stack ("AI-assisted development", "built with Cursor / Claude Code").
- NEVER use these emoji: 🚀 💯 🎉 ✨ 🤖. ALLOWED sparingly: 🎯 👏 ↑ ↓ ▰ ▱ 🔥.
- NEVER end product posts with exclamation marks (corporate-cheery).
- Use these terms: "Audition" (creator action) · "Audit" (engine action) · "Rookie Circle" (not "failed").
- Never use: "Submit / Register / Apply / Score your project / Failed / Loser / Fell short".

4 content pillars (each tweet falls into one):
A · Concrete gap caught (40%): lead with a specific finding, then score. Use audit screenshots.
B · Vibe-coder discourse react (30%): reply to trending takes with one sharp gap.
C · User wins amplified (20%): celebrate audited projects, name the strongest evidence.
D · Product / feature drops (10%): only when shipped, never roadmap.

Voice models: @levelsio · @swyx · @karpathy · @dhh (lowercase indie tone). NOT corporate-glossy.

Output format: ONLY a JSON object, no preamble or markdown.

{
  "strategy": "2-4 sentence paragraph · how you read this prompt · which ICP segment you're aiming at · the hook angle you picked · what reaction you're trying to provoke. Korean OK. Be specific, not generic.",
  "recommended_index": 0,                             // 0|1|2 · which of the 3 you'd send if forced to pick one · MUST be set
  "recommendation_reason": "one sentence · Korean OK · why this variation wins given the prompt's intent and the audience right now",
  "variations": [
    {
      "copy":      "tweet body · ENDS with brand hashtag line on its own line: '\\n\\n#commitshow #vibecoding #buildinpublic #devtools' (or +1 kind-specific tag) · whole thing ≤ 280 total · body itself ≤ 210 chars to leave room for the 4-5 tag line",
      "hashtags":  ["3-5 candidate tags · without #", "vibe coders' tags only · NEVER #buildinpublic / #SaaS / #startup"],
      "inline_hashtag": "the single hashtag you would append inline at the end of the copy field if forced to pick one · most relevant of the array · without #",
      "pillar":    "A|B|C|D",
      "rationale": "one sentence · why this variation reads · what tradeoff vs the others"
    },
    { ... },
    { ... }
  ]
}

Generate 3 DISTINCT variations:
- Variation 1: "safe" — most likely to land with the core ICP (vibe coders shipping with Cursor/Claude/etc). Lead with a concrete number or file.
- Variation 2: "punchy" — sharper hook · willing to be slightly contrarian or polarizing. Earns clicks at the cost of some replies disagreeing.
- Variation 3: "narrative" — leads with a one-line story or specific observation rather than a stat. Best for thread starters or quote-tweets.

Hashtag rules (NON-NEGOTIABLE · 2026-05-09 align):
- Every "copy" MUST end with the brand hashtag bundle on its OWN line (after blank line):
    #commitshow #vibecoding #buildinpublic #devtools
  + ONE optional kind-specific tag among #encore · #shipping · #milestone (only when contextually appropriate · slip in before #devtools).
- inline_hashtag is no longer in copy (we moved to the bundle line). Still set it in JSON output as the single most relevant from hashtags[] for legacy callers.
- hashtags[] = 3-5 candidate alternates the user can swap into the bundle slots if they want a different angle. NEVER bare hype generics (#startup · #100DaysOfCode · #devlife · #SaaS).
- The brand-tag pair (#commitshow + #vibecoding) is mandatory · #buildinpublic + #devtools are the default 3rd/4th. CEO directive 2026-05-09: #commitshow 필수 · 띄어쓰기로 관련 해시태그 3-4개.
- Total tags per copy: 4-5 max (4 default · 5 only when a kind-specific tag fits).

Always include the npx commitshow audit command if the prompt is about the engine, the audit, or onboarding new users.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Auth · admin-only.
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Authorization header required' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Invalid auth token' }, 401)
  const userId = userData.user.id
  const { data: memberRow } = await admin.from('members').select('is_admin').eq('id', userId).maybeSingle()
  if (!memberRow?.is_admin) return json({ error: 'Admin only' }, 403)

  let body: { prompt?: string; context?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const prompt  = (body.prompt ?? '').trim()
  const context = (body.context ?? '').trim()
  if (!prompt) return json({ error: 'prompt required' }, 400)
  if (prompt.length > 2000) return json({ error: 'prompt too long (max 2000 chars)' }, 400)

  // Pull current strategic workspace (insights + roadmap) so generated
  // tweets are aligned with the active marketing plan. Best-effort —
  // if the workspace row is missing or the read fails, fall through
  // without context (single-row table seeded by 20260504_cmo_workspace).
  const { data: workspace } = await admin
    .from('cmo_workspace')
    .select('insights_md, roadmap_md')
    .eq('id', 1)
    .maybeSingle()
  const workspaceContext = workspace
    ? `\n\nCurrent strategic context (CMO's Room) · use to align the tweet with what we're doing this week:\n\n=== INSIGHTS ===\n${workspace.insights_md || '(empty)'}\n\n=== ROADMAP ===\n${workspace.roadmap_md || '(empty)'}\n`
    : ''

  // Call Claude API.
  const userMessage = (context ? `Context the tweet should reflect:\n${context}\n\n` : '')
                    + `Request:\n${prompt}`
                    + workspaceContext

  let claudeRes: Response
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
  } catch (e) {
    return json({ error: `Claude API call failed: ${(e as Error)?.message ?? e}` }, 502)
  }

  if (!claudeRes.ok) {
    const text = await claudeRes.text()
    return json({ error: `Claude API ${claudeRes.status}`, detail: text.slice(0, 500) }, 502)
  }

  const claudeJson = await claudeRes.json()
  const text: string = claudeJson?.content?.[0]?.text ?? ''
  // The model is instructed to return JSON only, but defensively strip any
  // ``` fences or preamble before the first { .
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start < 0 || end < 0) {
    return json({ error: 'Claude returned non-JSON output', raw: text.slice(0, 800) }, 502)
  }

  let parsed: {
    strategy?:              string
    recommended_index?:     number
    recommendation_reason?: string
    variations?: Array<{
      copy:           string
      hashtags?:      string[]
      inline_hashtag?: string
      pillar?:        string
      rationale?:     string
    }>
  }
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (e) {
    return json({ error: 'Failed to parse Claude JSON', detail: (e as Error)?.message, raw: text.slice(0, 800) }, 502)
  }
  if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) {
    return json({ error: 'Claude response missing variations[]', raw: text.slice(0, 800) }, 502)
  }

  // Defensive: ensure each variation's `copy` ends with the inline_hashtag.
  // Claude is told to do this in the prompt, but if it slips up we patch
  // server-side so the user always sees a complete tweet (body + tag).
  for (const v of parsed.variations) {
    const tag = (v.inline_hashtag ?? '').replace(/^#/, '').trim()
    if (tag && !new RegExp(`#${tag}\\b`, 'i').test(v.copy)) {
      v.copy = `${v.copy.trimEnd()} #${tag}`
    }
  }

  // Persist as a cmo_drafts row · variations is jsonb so the strategy +
  // recommendation fields nest cleanly. We store them under
  // variations._meta so the existing schema doesn't need a migration.
  const enrichedVariations = parsed.variations as unknown as object
  const draftPayload = {
    prompt,
    variations: enrichedVariations,
    selected_index: typeof parsed.recommended_index === 'number' ? parsed.recommended_index : null,
    notes: parsed.strategy
      ? `STRATEGY: ${parsed.strategy}\n\nRECOMMENDED #${(parsed.recommended_index ?? 0) + 1}${parsed.recommendation_reason ? ` · ${parsed.recommendation_reason}` : ''}`
      : null,
    created_by: userId,
  }
  const { data: draft, error: insertErr } = await admin
    .from('cmo_drafts')
    .insert(draftPayload)
    .select()
    .single()
  if (insertErr) {
    return json({
      strategy:              parsed.strategy ?? null,
      recommended_index:     parsed.recommended_index ?? null,
      recommendation_reason: parsed.recommendation_reason ?? null,
      variations:            parsed.variations,
      draft_id:              null,
      persist_error:         insertErr.message,
    })
  }

  return json({
    strategy:              parsed.strategy ?? null,
    recommended_index:     parsed.recommended_index ?? null,
    recommendation_reason: parsed.recommendation_reason ?? null,
    variations:            parsed.variations,
    draft_id:              draft.id,
    usage:                 claudeJson?.usage ?? null,
  })
})
