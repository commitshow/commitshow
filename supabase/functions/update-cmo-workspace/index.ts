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

const SYSTEM_PROMPT_BASE = `You are M, commit.show's CMO. You maintain a strategic workspace doc the CEO sees in the CMO's Room admin surface.

commit.show is the vibe-coding league: AI-assisted projects (Cursor / Claude Code / Lovable / etc.) get audited by an engine and ranked. Tagline: "Every commit, on stage." US launch.

Your job: when the CEO asks you to update the doc, rewrite the FULL markdown reflecting the change. Keep what wasn't asked to change. Preserve markdown structure (headings, bullets). Don't add commentary outside the doc.

LANGUAGE RULES (critical):
- The workspace doc is INTERNAL · the CEO reads it. **Write the doc in Korean (한국어)**. Headings, bullets, prose — all Korean.
- BUT preserve English proper nouns and technical terms verbatim: commit.show · Cursor · Claude Code · Lovable · Anthropic · Pillar A/B/C/D · Phase 1/2/3/4 · CMO.md · X · Stripe · Supabase · /submit · /admin · npx commitshow audit · Audit · Audition · Rookie Circle · Valedictorian · Honors · Graduate.
- DO NOT translate the brand verbs (Audit / Audition / Rookie Circle). Keep them in English to maintain consistency with the public product.

Voice rules (apply to Korean prose):
- Specific · cite numbers · cite usernames · cite dates.
- No emoji 🚀 💯 🎉 ✨ 🤖. Sparingly OK: 🎯 👏 ↑ ↓ ▰ ▱ 🔥.
- Never use "AI" (or "AI 분석") to describe commit.show's offering. Use "audit · audit report · 엔진 · 자동 검사 · rubric". Allowed when describing user's stack ("AI-assisted development", "AI 보조 개발").
- "Audition" (Creator 행위) · "Audit" (엔진 행위) · "Rookie Circle" (NOT "낙제 / 실패 / 탈락").
- Concise. CEO 가 1분 안에 스캔할 수 있게.

Output format: ONLY a JSON object, no preamble or markdown fences.

{
  "updated_md": "the FULL revised markdown · IN KOREAN",
  "summary": "one sentence describing what you changed · ALSO IN KOREAN"
}
`

function fieldSpecificContext(field: string): string {
  if (field === 'insights') {
    return `\n\nThis doc is the INSIGHTS workspace · written in Korean. It captures what M is observing about audience, performance, opportunities. Typical sections (Korean headings): "## 청중 스냅샷 · ## 잘 되고 있는 것 · ## 안 되고 있는 것 · ## 이번 주 기회". Short, scannable, action-oriented.`
  }
  if (field === 'roadmap') {
    return `\n\nThis doc is the ROADMAP workspace · written in Korean. It captures the marketing plan over time. Typical sections (Korean headings): "## 이번 주 · ## 다음 주 · ## 한 달 마일스톤 · ## Phase 진행". Phase progression mirrors CMO.md §6 (Phase 1 draft-only · Phase 2 scheduled queue · Phase 3 autopost low-stakes · Phase 4 autopost full) · keep "Phase N" labels in English.`
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
