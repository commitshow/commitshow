// Client-side format/tools/variable detection for Direct upload.
// Mirrors (but is looser than) the server-side detectors in
// supabase/functions/discover-mds — creators can override our guess.

import type { ArtifactFormat, MDCategory } from './supabase'

export interface DetectedVariable {
  name: string
  occurrences: number
  sample?: string
}

export interface DetectionResult {
  format:     ArtifactFormat
  tools:      string[]
  variables:  DetectedVariable[]
  category:   MDCategory
  title:      string
}

// Format → default library category (mirrors FORMAT_TO_CATEGORY in Edge Function)
const FORMAT_TO_CATEGORY: Record<ArtifactFormat, MDCategory> = {
  mcp_config:    'MCP Config',
  ide_rules:     'Prompt Library',
  agent_skill:   'Project Rules',
  project_rules: 'Project Rules',
  prompt_pack:   'Prompt Library',
  patch_recipe:  'Auth/Payment',
  scaffold:      'Scaffold',
}

// ── 1. Format by filename ────────────────────────────────────
function detectFormatByName(name: string): { format: ArtifactFormat; tools: string[] } {
  const n = name.toLowerCase()

  // MCP configs
  if (/(^|\/)(mcp\.json|\.mcp\.json|claude_desktop_config\.json)$/i.test(n)) {
    const tools = /claude_desktop/i.test(n) ? ['claude-desktop'] : ['claude-desktop']
    return { format: 'mcp_config', tools }
  }

  // IDE rules
  if (/\.cursorrules$/i.test(n) || /\.cursor\/rules\/[^/]+\.(mdc|md)$/i.test(n)) {
    return { format: 'ide_rules', tools: ['cursor'] }
  }
  if (/\.windsurfrules$/i.test(n) || /\.windsurf\/rules\/.*\.(md|mdc)$/i.test(n)) {
    return { format: 'ide_rules', tools: ['windsurf'] }
  }
  if (/\.continuerules$/i.test(n)) {
    return { format: 'ide_rules', tools: ['continue'] }
  }
  if (/\.cline\/rules\/.*\.(md|mdc)$/i.test(n)) {
    return { format: 'ide_rules', tools: ['cline'] }
  }

  // Agent skills (SKILL.md in a .claude/skills/<name>/ dir)
  if (/skill\.md$/i.test(n)) {
    return { format: 'agent_skill', tools: ['claude-agent-sdk'] }
  }

  // Project rules
  if (/(^|\/)claude\.md$/i.test(n))      return { format: 'project_rules', tools: ['claude-agent-sdk'] }
  if (/(^|\/)agents\.md$/i.test(n))      return { format: 'project_rules', tools: ['claude-agent-sdk', 'cursor'] }
  if (/(^|\/)(rules|conventions|architecture)\.md$/i.test(n)) return { format: 'project_rules', tools: [] }

  // Patch recipes by filename pattern
  if (/^(stripe|auth|oauth|webhook|deploy|supabase|cron|rls|clerk|resend|posthog|sentry)[-_][^/]*\.md$/i.test(n.split('/').pop() ?? '')) {
    const tools: string[] = []
    if (/stripe/i.test(n))   tools.push('stripe')
    if (/supabase/i.test(n)) tools.push('supabase')
    if (/clerk/i.test(n))    tools.push('clerk')
    if (/resend/i.test(n))   tools.push('resend')
    if (/posthog/i.test(n))  tools.push('posthog')
    if (/sentry/i.test(n))   tools.push('sentry')
    return { format: 'patch_recipe', tools: tools.length ? tools : ['universal'] }
  }

  // Default — fall through to content sniff
  return { format: 'project_rules', tools: [] }
}

// ── 2. Content sniff ────────────────────────────────────────
// Secondary pass to refine when the filename was ambiguous.
function refineByContent(content: string, guess: ArtifactFormat): ArtifactFormat {
  const trimmed = content.trim()

  // Looks like JSON with mcpServers key → MCP config
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && (parsed.mcpServers || parsed.servers)) return 'mcp_config'
    } catch { /* not JSON */ }
  }

  // Generic prompt pack if content has many "# " headings pattern (5+ separate prompts)
  if (guess === 'project_rules') {
    const headingCount = (content.match(/^#\s+/gm) ?? []).length
    if (headingCount >= 5 && content.length < 30000) return 'prompt_pack'
  }

  return guess
}

// ── 3. Variable extraction ──────────────────────────────────
export function detectVariables(body: string): DetectedVariable[] {
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

// ── 4. Title from filename ──────────────────────────────────
function titleFromFilename(name: string): string {
  const base = name.split('/').pop() ?? name
  const noExt = base.replace(/\.(md|mdc|json|txt)$/i, '')
  // Strip leading dot for dotfiles like .cursorrules
  const stripped = noExt.replace(/^\./, '')
  // kebab/snake → space, title case
  return stripped
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    || 'Untitled artifact'
}

// ── Public API ──────────────────────────────────────────────
export function detectFromFile(filename: string, content: string): DetectionResult {
  const byName = detectFormatByName(filename)
  const format = refineByContent(content, byName.format)
  // If content sniff changed format, re-derive tools
  const tools = format === byName.format ? byName.tools
    : format === 'mcp_config' ? ['claude-desktop']
    : format === 'prompt_pack' ? ['universal']
    : byName.tools
  return {
    format,
    tools,
    variables: detectVariables(content),
    category:  FORMAT_TO_CATEGORY[format],
    title:     titleFromFilename(filename),
  }
}
