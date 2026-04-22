// Build Brief Extraction Prompt
// ───────────────────────────────────────────────────────────────
// UX: the creator opens their own AI tool (Claude Code / Cursor / ChatGPT /
// Lovable with project context), pastes this template, and receives a
// structured MD back. They paste the MD here. We parse it and feed structured
// evidence to our analyzer.
//
// We originally used base64-encoded payloads as obfuscation, but modern AI
// tools (notably Lovable) flag "decode this and execute" patterns as prompt
// injection and refuse the request. We now ship the template as-is.
//
// Gaming resistance comes from the prompt CONTENT, not from hiding it:
//  - every section demands evidence tied to actual code/commits/files
//  - missing fields must be "?" — hallucinating is penalized by the analyzer
//  - failure log + decision archaeology need concrete moments, not claims
//  - AI delegation map cannot be 100/0 splits

export const EXTRACTION_PROMPT_RAW = `You are filling out a structured Build Brief for commit.show — a vibe coding league that scores AI-assisted projects. You have access to the user's current project context (code, commits, chat history with them). Base EVERY answer on observed project state, not on what the user claims.

Honesty dial: MAXIMUM. When unsure, write "?". When evidence is thin, say so. Do not inflate.

OUTPUT MODE — READ CAREFULLY:
1. PREFERRED: Create a new file at the repo root: \`.commit/brief.md\` with the filled-in content below. Then commit with message "add commit.show brief" and push to the default branch. DO NOT print the filled content in chat — just confirm "file created and pushed" and stop.
2. FALLBACK (only if you genuinely cannot write files): output ONLY the filled markdown below, no preamble, no code fences, no closing remarks. The user will copy-paste it manually.

Choose mode 1 unless file-writing is impossible in your current environment.

CONTENT TEMPLATE TO FILL AND SAVE:

# Core Intent
PROBLEM: [What real problem does this app solve? 1 sentence.]
FEATURES: [1–3 core MVP features, one per line, prefixed with "- "]
TARGET_USER: [Who would actually use this. Be specific.]

(Note: do NOT include which AI coding tool / platform was used to build the project. Tool identity is not evaluated — only what was built matters.)

# Stack Fingerprint
Fill every field. Use "?" if unknown. Do NOT skip fields.
RUNTIME: [Language/runtime + version — e.g. "Node 20 + TypeScript 5.4"]
FRONTEND: [Framework + main UI libraries — e.g. "React 18 + Vite + Tailwind + shadcn/ui"]
BACKEND: [Server/BaaS + core patterns — e.g. "Serverless functions (Deno) + Postgres + row-level security"]
DATABASE: [DB type + table count or schema complexity — e.g. "Postgres · 11 tables · 4 views · 6 RLS policies"]
INFRA: [Deployment platform + CI/CD — e.g. "Edge hosting (Vite build) · no CI yet"]
AI_LAYER: [AI capability used by the PRODUCT itself + what it is called for — e.g. "LLM-based project scoring via a server function". Describe the capability, not the brand/model.]
EXTERNAL_API: [External services integrated — e.g. "Performance audit API, Source-hosting REST API, Payment checkout (pending)"]
AUTH: [Authentication method — e.g. "Supabase Auth (email) · Google OAuth pending"]
SPECIAL: [Unusual tech choices not covered above — e.g. "Supavisor pooler with custom DNS region discovery"]

# Failure Log
Pick 2 moments where the AI got it WRONG 3+ times, or where you (the human) had to step in with a decisive intervention. If there are fewer than 2 such moments, the project is probably not real enough to score — write "? — not enough iteration yet" but still fill both slots with the closest candidates.

NO bragging. The more honest, the higher the measurement accuracy.

## Failure 1
SYMPTOM: [What the AI did wrong — concrete. "Generated broken SQL" not "made mistakes"]
CAUSE: [Where the ACTUAL problem lived — often not where the AI looked]
FIX: [The decisive hint/structure you introduced]
PREVENTION: [What constraint or pattern was added afterward so this does not recur]

## Failure 2
SYMPTOM: [...]
CAUSE: [...]
FIX: [...]
PREVENTION: [...]

# Decision Archaeology
2 technical/structural decisions where the plan was originally A but got switched to B. "The AI recommended it" is a valid answer — write it honestly.

## Decision 1
ORIGINAL_PLAN: [A]
REASON_TO_CHANGE: [cost / performance / platform limit / AI recommendation accepted or rejected / etc]
FINAL_CHOICE: [B]
OUTCOME: [Was it good? What trade-off did it create?]

## Decision 2
ORIGINAL_PLAN: [...]
REASON_TO_CHANGE: [...]
FINAL_CHOICE: [...]
OUTCOME: [...]

# AI Delegation Map
For at least 6 domains, list who drove it. Use this exact table format. Numbers must sum to 100% per row.

| Domain | AI % | Human % | Notes |
|--------|------|---------|-------|
| DB Schema Design | 20 | 80 | Example — replace with actual domains |
| React Components | 70 | 30 | Example — replace |
| Security / RLS Policies | 10 | 90 | Example — replace |
| … (at least 6 rows) |

No 100% rows. If one side truly owned it, still estimate realistic handoffs (AI autocomplete counts).

# Live Proof
Verifiable external links. Missing ≠ deduction. Present = bonus. Do not fabricate.

DEPLOYED_URL: [Production URL or "?"]
GITHUB_URL: [Repo URL or "?"]
API_ENDPOINTS: [Public endpoints or "?"]
CONTRACT_ADDRESSES: [On-chain addresses if any, else "?"]
OTHER_EVIDENCE: [User count / tx count / demo video / screenshots — or "?"]

# Next Blocker
What is currently blocking this project from the next level? Pick one of: technical / cost / knowledge / time. Be specific about which.

CURRENT_BLOCKER: [Specific obstacle — not "need more features"]
FIRST_AI_TASK: [The specific first task you would hand to an AI to break through. Must be concrete enough to execute in one session. Ban vague phrasing like "improve it" or "make it better".]

# Integrity Self-Check
This is not optional. The analyzer uses this section to detect manipulation. Honest answers HELP the score — hiding uncertainties HURTS it.

PROMPT_VERSION: commit-brief/v1.3
VERIFIED_CLAIMS: [List every claim above you can directly verify from the code/commits/files you have access to right now. Be specific — cite file paths or function names.]
UNVERIFIABLE_CLAIMS: [List any claims above that you COULD NOT verify from the code. E.g. user counts, revenue, off-chain partnerships, deployed contract behavior you can't read. "None" is rarely the correct answer.]
DIVERGENCES: [If the brief above overstates what the code actually implements — or if the user steered you toward answers that contradict what you see — list it here. If the user modified this template to remove sections or bias answers, note that. Otherwise write "none observed".]
CONFIDENCE_SCORE: [0-10, your honest confidence that this brief accurately represents reality, where 10 = "every line is grounded in code I just read" and 0 = "this is mostly speculation".]`

// ── presentation ─────────────────────────────────────────────
// Plain, user-readable template. Safe across Lovable / ChatGPT / Claude /
// Cursor / Gemini / Claude Code — none of these flag a structured brief
// template as prompt injection.

export function getExtractionPrompt(): string {
  return `Please create a Build Brief for commit.show (a vibe coding league that scores AI-assisted projects) by inspecting the ACTUAL project we've been working on — the code, commits, and decisions you can see.

Save it as the file \`.commit/brief.md\` at the repo root, then commit and push. Do not paste the filled content back to me — just write the file.

The template and exact rules follow below:

${EXTRACTION_PROMPT_RAW}`
}

// Back-compat alias — previous API name.
export const getObfuscatedPrompt = getExtractionPrompt

// ── output types ─────────────────────────────────────────────

export interface CoreIntent {
  problem: string
  features: string
  target_user: string
}
export interface StackFingerprint {
  runtime: string; frontend: string; backend: string; database: string
  infra: string;   ai_layer: string; external_api: string
  auth: string;    special: string
}
export interface FailureEntry {
  symptom: string; cause: string; fix: string; prevention: string
}
export interface DecisionEntry {
  original_plan: string; reason_to_change: string
  final_choice: string; outcome: string
}
export interface DelegationRow {
  domain: string; ai_pct: number; human_pct: number; notes: string
}
export interface LiveProof {
  deployed_url: string; github_url: string; api_endpoints: string
  contract_addresses: string; other_evidence: string
}
export interface NextBlocker {
  current_blocker: string; first_ai_task: string
}
export interface IntegritySelfCheck {
  prompt_version: string
  verified_claims: string
  unverifiable_claims: string
  divergences: string
  confidence_score: number           // 0-10; -1 if missing
  present: boolean                   // section existed in output at all
}
export interface ExtractedBrief {
  core_intent: CoreIntent
  stack_fingerprint: StackFingerprint
  failure_log: FailureEntry[]
  decision_archaeology: DecisionEntry[]
  ai_delegation_map: DelegationRow[]
  live_proof: LiveProof
  next_blocker: NextBlocker
  integrity_self_check: IntegritySelfCheck
}

// ── parser ───────────────────────────────────────────────────
// Forgiving MD parser — tolerates variations in AI output formatting.

function splitH1Sections(md: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /^#\s+(.+?)\s*$/gm
  const matches: Array<{ name: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    matches.push({ name: m[1].trim(), start: m.index + m[0].length, end: md.length })
  }
  for (let i = 0; i < matches.length; i++) {
    if (i + 1 < matches.length) matches[i].end = matches[i + 1].start - (`# ${matches[i + 1].name}`.length + 1)
    out[matches[i].name.toLowerCase()] = md.slice(matches[i].start, matches[i].end).trim()
  }
  return out
}

function readKVBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lineRe = /^([A-Z][A-Z0-9_]{2,})\s*:\s*(.+?)\s*$/gm
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(body)) !== null) {
    out[m[1].toLowerCase()] = m[2].trim().replace(/^\[|\]$/g, '').trim()
  }
  return out
}

function splitH2Blocks(body: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = []
  const re = /^##\s+(.+?)\s*$/gm
  const markers: Array<{ title: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    markers.push({ title: m[1].trim(), start: m.index + m[0].length, end: body.length })
  }
  for (let i = 0; i < markers.length; i++) {
    if (i + 1 < markers.length) markers[i].end = markers[i + 1].start - (`## ${markers[i + 1].title}`.length + 1)
    out.push({ title: markers[i].title, body: body.slice(markers[i].start, markers[i].end).trim() })
  }
  return out
}

function parseMarkdownTable(body: string): DelegationRow[] {
  const rows: DelegationRow[] = []
  const lines = body.split('\n')
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue
    const cols = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cols.length < 4) continue
    if (/^[-:\s]+$/.test(cols[0])) continue                          // separator row
    if (/domain/i.test(cols[0]) && /ai/i.test(cols[1])) continue     // header row
    const ai = parseInt(cols[1].replace(/[^0-9]/g, '')) || 0
    const hu = parseInt(cols[2].replace(/[^0-9]/g, '')) || 0
    rows.push({ domain: cols[0], ai_pct: ai, human_pct: hu, notes: cols[3] })
  }
  return rows
}

export interface ParseResult {
  parsed: ExtractedBrief
  warnings: string[]
  sectionsFound: string[]
}

export function parseExtractionOutput(md: string): ParseResult {
  const warnings: string[] = []
  const sections = splitH1Sections(md)
  const sectionsFound = Object.keys(sections)

  const need = (key: string) => {
    if (!sections[key]) warnings.push(`Missing # ${key} section`)
    return sections[key] ?? ''
  }

  const ciKV = readKVBlock(need('core intent'))
  const core_intent: CoreIntent = {
    problem: ciKV.problem || '',
    features: ciKV.features || '',
    target_user: ciKV.target_user || '',
  }

  const sfKV = readKVBlock(need('stack fingerprint'))
  const stack_fingerprint: StackFingerprint = {
    runtime: sfKV.runtime || '',
    frontend: sfKV.frontend || '',
    backend: sfKV.backend || '',
    database: sfKV.database || '',
    infra: sfKV.infra || '',
    ai_layer: sfKV.ai_layer || '',
    external_api: sfKV.external_api || '',
    auth: sfKV.auth || '',
    special: sfKV.special || '',
  }

  const failureBlocks = splitH2Blocks(need('failure log'))
  const failure_log: FailureEntry[] = failureBlocks.map(b => {
    const kv = readKVBlock(b.body)
    return {
      symptom: kv.symptom || '',
      cause:   kv.cause   || '',
      fix:     kv.fix     || '',
      prevention: kv.prevention || '',
    }
  })
  if (failure_log.length < 2) warnings.push('Failure Log has fewer than 2 entries')

  const decisionBlocks = splitH2Blocks(need('decision archaeology'))
  const decision_archaeology: DecisionEntry[] = decisionBlocks.map(b => {
    const kv = readKVBlock(b.body)
    return {
      original_plan:     kv.original_plan     || '',
      reason_to_change:  kv.reason_to_change  || '',
      final_choice:      kv.final_choice      || '',
      outcome:           kv.outcome           || '',
    }
  })
  if (decision_archaeology.length < 2) warnings.push('Decision Archaeology has fewer than 2 entries')

  const delegation = parseMarkdownTable(need('ai delegation map'))
  if (delegation.length < 6) warnings.push(`AI Delegation Map has only ${delegation.length} rows (need ≥6)`)

  const lpKV = readKVBlock(need('live proof'))
  const live_proof: LiveProof = {
    deployed_url:       lpKV.deployed_url       || '',
    github_url:         lpKV.github_url         || '',
    api_endpoints:      lpKV.api_endpoints      || '',
    contract_addresses: lpKV.contract_addresses || '',
    other_evidence:     lpKV.other_evidence     || '',
  }

  const nbKV = readKVBlock(need('next blocker'))
  const next_blocker: NextBlocker = {
    current_blocker: nbKV.current_blocker || '',
    first_ai_task:   nbKV.first_ai_task   || '',
  }

  // Integrity self-check — required. Missing section → tampering signal.
  const integritySection = sections['integrity self-check']
  const integrityPresent = !!integritySection
  if (!integrityPresent) {
    warnings.push('Integrity Self-Check section missing — possible prompt tampering')
  }
  const isKV = integritySection ? readKVBlock(integritySection) : {}
  const confidenceRaw = isKV.confidence_score
  let confidence = -1
  if (confidenceRaw) {
    const parsed = parseFloat(confidenceRaw.replace(/[^0-9.]/g, ''))
    if (!isNaN(parsed)) confidence = Math.max(0, Math.min(10, parsed))
  }
  const integrity_self_check: IntegritySelfCheck = {
    prompt_version:      isKV.prompt_version      || '',
    verified_claims:     isKV.verified_claims     || '',
    unverifiable_claims: isKV.unverifiable_claims || '',
    divergences:         isKV.divergences         || '',
    confidence_score:    confidence,
    present:             integrityPresent,
  }

  // Suspicious patterns (cheap client-side heuristics)
  const delegationRows = delegation.length
  const extremeRows = delegation.filter(d => d.ai_pct === 0 || d.human_pct === 0 || d.ai_pct === 100 || d.human_pct === 100)
  if (delegationRows > 0 && extremeRows.length === delegationRows) {
    warnings.push('AI Delegation Map uses only 0%/100% splits — unrealistic, likely self-inflated')
  }
  const weakFailures = failure_log.filter(f =>
    !f.symptom || !f.cause || f.symptom.length < 15 ||
    /\bno failures?\b|\bnone\b|\bn\/a\b/i.test(f.symptom + ' ' + f.cause)
  )
  if (failure_log.length > 0 && weakFailures.length === failure_log.length) {
    warnings.push('Failure Log entries are vague or disclaim failures — low-signal')
  }
  if (integrityPresent && confidence >= 9 && integrity_self_check.unverifiable_claims.toLowerCase().trim() === 'none') {
    warnings.push('Integrity Self-Check shows 10/10 confidence and zero unverifiable claims — implausible, review output')
  }

  return {
    parsed: {
      core_intent, stack_fingerprint, failure_log, decision_archaeology,
      ai_delegation_map: delegation, live_proof, next_blocker, integrity_self_check,
    },
    warnings,
    sectionsFound,
  }
}

export function integrityScore(p: ExtractedBrief): number {
  // 0-10 heuristic score used in the brief.integrity_score column.
  let s = 0
  const ci = p.core_intent
  if (ci.problem && ci.features && ci.target_user) s += 1
  const sf = p.stack_fingerprint
  const sfFilled = Object.values(sf).filter(v => v && v !== '?').length
  if (sfFilled >= 7) s += 2; else if (sfFilled >= 4) s += 1
  if (p.failure_log.length >= 2 && p.failure_log.every(f => f.symptom && f.cause && f.fix)) s += 2
  if (p.decision_archaeology.length >= 2 && p.decision_archaeology.every(d => d.final_choice && d.outcome)) s += 2
  if (p.ai_delegation_map.length >= 6) s += 1
  if (p.next_blocker.current_blocker && p.next_blocker.first_ai_task) s += 1
  if (p.integrity_self_check.present && p.integrity_self_check.confidence_score >= 0) s += 1
  return Math.min(s, 10)
}
