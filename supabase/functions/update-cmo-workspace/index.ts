// update-cmo-workspace — Claude rewrites the insights or roadmap markdown
// based on a chat message. Admin-only. Used by /admin/cmo "CMO's Room".
//
// Input: { field: 'insights' | 'roadmap', message: string, current_md: string }
// Output: { updated_md: string, summary: string }
//
// Behavior: Claude receives the current markdown + the user's instruction
// ("make the roadmap more aggressive" · "add a note that we hit 200 followers")
// and returns the FULL revised markdown. We don't try to do diffs.

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

const SYSTEM_PROMPT_BASE = `You are M, commit.show's CMO. You're maintaining a strategic workspace doc the CEO sees in the CMO's Room admin surface.

commit.show is the vibe-coding league: AI-assisted projects (Cursor / Claude Code / Lovable / etc.) get audited by an engine and ranked. Tagline: "Every commit, on stage." US launch.

Your job: when the CEO asks you to update the doc, rewrite the FULL markdown reflecting the change. Keep what wasn't asked to change. Preserve markdown structure (headings, bullets). Don't add commentary outside the doc.

Voice rules:
- American English. Lowercase by default for body copy. Headings preserve title case if already titled.
- Be specific · cite numbers · cite usernames · cite dates.
- No emoji 🚀 💯 🎉 ✨ 🤖. Sparingly OK: 🎯 👏 ↑ ↓ ▰ ▱ 🔥.
- Never use "AI" to describe commit.show's offering. Use "audit · audit report · the engine · automated checks · the rubric". Allowed when describing user's stack ("AI-assisted development").
- Use "Audition" (creator action) · "Audit" (engine action) · "Rookie Circle" (not "failed").

Output format: ONLY a JSON object, no preamble or markdown fences.

{
  "updated_md": "the FULL revised markdown",
  "summary": "one sentence describing what you changed"
}
`

function fieldSpecificContext(field: string): string {
  if (field === 'insights') {
    return `\n\nThis doc is the INSIGHTS workspace. It captures what M is observing about audience, performance, opportunities. Sections typically include: Audience snapshot · What's working · What's not · Opportunities this week. Keep it short, scannable, action-oriented.`
  }
  if (field === 'roadmap') {
    return `\n\nThis doc is the ROADMAP workspace. It captures the marketing plan over time. Sections typically include: This week · Next week · Month-1 milestones · Phase progression. Phase progression mirrors CMO.md §6 (Phase 1 draft-only · Phase 2 scheduled queue · Phase 3 autopost low-stakes · Phase 4 autopost full).`
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Authorization header required' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Invalid auth token' }, 401)
  const userId = userData.user.id
  const { data: memberRow } = await admin.from('members').select('is_admin').eq('id', userId).maybeSingle()
  if (!memberRow?.is_admin) return json({ error: 'Admin only' }, 403)

  let body: { field?: string; message?: string; current_md?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const field      = String(body.field ?? '')
  const message    = (body.message ?? '').trim()
  const currentMd  = body.current_md ?? ''
  if (field !== 'insights' && field !== 'roadmap') return json({ error: 'field must be insights or roadmap' }, 400)
  if (!message) return json({ error: 'message required' }, 400)
  if (message.length > 2000) return json({ error: 'message too long (max 2000 chars)' }, 400)

  const systemPrompt = SYSTEM_PROMPT_BASE + fieldSpecificContext(field)
  const userMessage  = `Current ${field} doc:\n\n${currentMd || '(empty)'}\n\n---\n\nCEO request:\n${message}`

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
        max_tokens: 4000,
        system: systemPrompt,
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
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start < 0 || end < 0) return json({ error: 'Claude returned non-JSON', raw: text.slice(0, 800) }, 502)

  let parsed: { updated_md?: string; summary?: string }
  try { parsed = JSON.parse(text.slice(start, end + 1)) }
  catch (e) { return json({ error: 'Failed to parse Claude JSON', detail: (e as Error)?.message, raw: text.slice(0, 800) }, 502) }
  if (typeof parsed.updated_md !== 'string') return json({ error: 'Claude response missing updated_md', raw: text.slice(0, 800) }, 502)

  // Persist the updated md.
  const updateField = field === 'insights' ? { insights_md: parsed.updated_md } : { roadmap_md: parsed.updated_md }
  const { error: upErr } = await admin
    .from('cmo_workspace')
    .update({ ...updateField, updated_by: userId })
    .eq('id', 1)
  if (upErr) {
    // Surface but still return the result so user sees the proposed update.
    return json({ updated_md: parsed.updated_md, summary: parsed.summary ?? '', persist_error: upErr.message })
  }

  return json({ updated_md: parsed.updated_md, summary: parsed.summary ?? '', usage: claudeJson?.usage ?? null })
})
