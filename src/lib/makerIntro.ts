// Generates a casual maker's launch comment from available project
// signals. Reads like a Product-Hunt-style first comment from the
// creator: "Hey commit.show 👋 / I'm building X for Y / why we built
// it / what's next." All sections are optional and stitched together
// only when their source field exists, so a thin project gets a
// shorter draft instead of fabricated filler.
//
// Pure function · no Claude call · no DB write. The banner caller
// re-runs this on each render so brief edits reflect in real time.

interface IntroSources {
  projectName:    string
  oneLiner:       string | null
  problem:        string | null
  features:       string | null   // free text · multi-line bullets
  targetUser:     string | null
  aiTools:        string | null   // free text
  businessModel:  string | null
  stage:          string | null
  /** Stable seed for deterministic variant selection (typically project_id).
      Same project → same draft. Different projects → different variants. */
  seed?:          string
}

// ── Variant pools ────────────────────────────────────────────────
// Same input → same output (seeded). Across projects, each surface
// shuffles which line gets picked so the feed isn't 50 'Hey commit.show 👋'
// posts in a row.

const GREETING_POOL = [
  `Hey commit.show 👋`,
  `gm commit.show ☀️`,
  `Hi everyone 👋`,
  `What's up commit.show`,
  `Long-time lurker, first time poster 👋`,
  `New around here · saying hi 👋`,
] as const

const ONELINER_TEMPLATES = [
  (name: string, oneLiner: string) => `I'm building **${name}** — ${oneLiner}`,
  (name: string, oneLiner: string) => `Just shipped **${name}** · ${oneLiner}`,
  (name: string, oneLiner: string) => `Putting **${name}** up for audit today · ${oneLiner}`,
  (name: string, oneLiner: string) => `Working on **${name}** for the last few weeks. ${oneLiner}`,
] as const

const PROBLEM_TEMPLATES = [
  (name: string, problem: string) => `I'm building **${name}** to solve this: ${problem}`,
  (name: string, problem: string) => `**${name}** is my take on this: ${problem}`,
  (name: string, problem: string) => `Started **${name}** because: ${problem}`,
] as const

const NO_BRIEF_TEMPLATES = [
  (name: string) => `I just shipped **${name}** and dropped it on commit.show for an audit.`,
  (name: string) => `Putting **${name}** up here for an honest audit.`,
  (name: string) => `**${name}** is live · curious what folks here think.`,
] as const

const WHY_PREFIX = [
  `**Why I built it:**`,
  `**The why:**`,
  `**Backstory:**`,
  `**What sparked it:**`,
] as const

const FEATURES_PREFIX = [
  `**What it does today:**`,
  `**Current features:**`,
  `**What's working now:**`,
  `**What's in v1:**`,
] as const

const TOOLS_TEMPLATES = [
  (tools: string) => `Built with ${tools}.`,
  (tools: string) => `Made with ${tools}.`,
  (tools: string) => `Stack: ${tools}.`,
  (tools: string) => `Mostly built with ${tools}.`,
] as const

const CLOSING_POOL = [
  `Happy to answer anything — what should we audit deeper next?`,
  `Open to honest feedback · what looks off?`,
  `Roast it gently · what's the weakest spot?`,
  `Where would you push back?`,
  `What would make this 10× better?`,
  `What's the first thing you'd change?`,
] as const

// djb2 hash · same algo we use elsewhere · ASCII-safe.
function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function pick<T>(seed: string, salt: string, pool: readonly T[]): T {
  const idx = djb2(seed + ':' + salt) % pool.length
  return pool[idx]
}

const STAGE_LINES: Record<string, string> = {
  idea:     "It's still in idea / sketch phase — feedback now is when it shapes the most.",
  mvp:      "It's at MVP — working build, looking for first real users.",
  live:     "It's live now and stable. Curious to hear what you think.",
  traction: "Real usage is rolling in — sharing here to find more like-minded folks.",
  scaling:  "We're scaling now — looking for partners and contributors.",
}

const BMODEL_LINES: Record<string, string> = {
  free:          "It's free to use.",
  open_source:   "It's open-source — code's on GitHub.",
  freemium:      "It's freemium — try the free tier first, paid only for power features.",
  subscription:  "It runs on a subscription model.",
  paid_one_time: "It's a one-time paid product.",
  ad_supported:  "It's ad-supported.",
  marketplace:   "It's a marketplace play.",
  b2b:           "It's a B2B tool.",
  b2c:           "It's a B2C product.",
  unknown:       "Business model is still TBD — feedback there is welcome too.",
}

function firstSentence(s: string, maxLen = 240): string {
  const trimmed = s.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLen) return trimmed
  // Prefer breaking on '. ' near the cap
  const cap = trimmed.slice(0, maxLen)
  const lastStop = Math.max(cap.lastIndexOf('. '), cap.lastIndexOf('? '), cap.lastIndexOf('! '))
  if (lastStop > maxLen / 2) return cap.slice(0, lastStop + 1)
  return cap.replace(/\s+\S*$/, '') + '…'
}

function topFeatures(raw: string | null, max = 3): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*[-*·•·▶◦]\s+/, '').replace(/^\s*\d+[\.\)]\s+/, '').trim())
    .filter(s => s.length > 0)
    .slice(0, max)
}

function topTools(raw: string | null, max = 3): string[] {
  if (!raw) return []
  return raw
    .split(/[,\n]/)
    .map(s => s.replace(/^\s*[-*·•]\s+/, '').trim())
    .filter(s => s.length > 0 && s.length <= 32)
    .slice(0, max)
}

export function generateMakerIntro(s: IntroSources): string {
  // Seed defaults to projectName so callers without project_id still
  // get a stable draft (different across projects with different names).
  const seed = s.seed || s.projectName
  const lines: string[] = []

  // Greeting · pick from the pool deterministically.
  lines.push(pick(seed, 'greet', GREETING_POOL))
  lines.push('')

  // Opening · what it is, who it's for.
  if (s.oneLiner) {
    const tmpl = pick(seed, 'oneliner', ONELINER_TEMPLATES)
    lines.push(tmpl(s.projectName, firstSentence(s.oneLiner, 180)))
  } else if (s.problem) {
    const tmpl = pick(seed, 'problem', PROBLEM_TEMPLATES)
    lines.push(tmpl(s.projectName, firstSentence(s.problem, 200)))
  } else {
    const tmpl = pick(seed, 'nobrief', NO_BRIEF_TEMPLATES)
    lines.push(tmpl(s.projectName))
  }

  if (s.targetUser) {
    lines.push('')
    lines.push(`It's for ${s.targetUser.trim()}.`)
  }

  // Why · pulled from problem if no one_liner used it.
  if (s.problem && s.oneLiner) {
    lines.push('')
    lines.push(`${pick(seed, 'why', WHY_PREFIX)} ${firstSentence(s.problem, 240)}`)
  }

  // What it does · bullets.
  const feats = topFeatures(s.features, 3)
  if (feats.length > 0) {
    lines.push('')
    lines.push(pick(seed, 'feats', FEATURES_PREFIX))
    for (const f of feats) {
      lines.push(`- ${f}`)
    }
  }

  // Stage + business model · single combined line so it doesn't read
  // like a survey response.
  const tail: string[] = []
  if (s.stage && STAGE_LINES[s.stage]) tail.push(STAGE_LINES[s.stage])
  if (s.businessModel && BMODEL_LINES[s.businessModel] && s.businessModel !== 'unknown') {
    tail.push(BMODEL_LINES[s.businessModel])
  }
  if (tail.length > 0) {
    lines.push('')
    lines.push(tail.join(' '))
  }

  // Tools used · short credit line for the AI tools that helped build it.
  const tools = topTools(s.aiTools, 4)
  if (tools.length > 0) {
    lines.push('')
    lines.push(pick(seed, 'tools', TOOLS_TEMPLATES)(tools.join(', ')))
  }

  // Closing CTA · invite for feedback.
  lines.push('')
  lines.push(pick(seed, 'close', CLOSING_POOL))

  return lines.join('\n').trim()
}
