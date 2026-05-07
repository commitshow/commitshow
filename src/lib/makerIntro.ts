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
  const lines: string[] = []

  lines.push(`Hey commit.show 👋`)
  lines.push('')

  // Opening · what it is, who it's for.
  if (s.oneLiner) {
    lines.push(`I'm building **${s.projectName}** — ${firstSentence(s.oneLiner, 180)}`)
  } else if (s.problem) {
    lines.push(`I'm building **${s.projectName}** to solve this: ${firstSentence(s.problem, 200)}`)
  } else {
    lines.push(`I just shipped **${s.projectName}** and dropped it on commit.show for an audit.`)
  }

  if (s.targetUser) {
    lines.push('')
    lines.push(`It's for ${s.targetUser.trim()}.`)
  }

  // Why · pulled from problem if no one_liner used it.
  if (s.problem && s.oneLiner) {
    lines.push('')
    lines.push(`**Why I built it:** ${firstSentence(s.problem, 240)}`)
  }

  // What it does · bullets.
  const feats = topFeatures(s.features, 3)
  if (feats.length > 0) {
    lines.push('')
    lines.push(`**What it does today:**`)
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
    lines.push(`Built with ${tools.join(', ')}.`)
  }

  // Closing CTA · invite for feedback.
  lines.push('')
  lines.push(`Happy to answer anything — what should we audit deeper next?`)

  return lines.join('\n').trim()
}
