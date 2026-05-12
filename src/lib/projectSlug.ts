// Project slug helpers · v2 (2026-05-12 · slug_based_project_urls_v1 spec).
//
// Slug rules per dev request:
//   A. Domain-style input (contains '.', e.g. 'meerkats.ai') →
//      keep as-is, lowercased. The dot is preserved.
//   B. GitHub repo input (full URL or owner/repo) → owner-repo
//      (lowercased · slashes → dashes).
//   C. Generic name → lowercase, non-alnum → dash, collapse dashes,
//      trim, ASCII-only 2-50 chars.
//   · Korean / Japanese / non-ASCII names produce '' · caller surfaces
//     an "ASCII alternate required" message at audition time.
//
// Collision resolution lives at the DB layer (uniqueSlug + suffix).
// Reserved-slug check happens at the resolver too so we never collide
// with site routes.

export const RESERVED_SLUGS = new Set([
  // App routes that own a /:something segment
  'admin', 'api', 'audit', 'audition', 'backstage', 'community',
  'creators', 'creator', 'cli', 'docs', 'help', 'faq', 'badge',
  'ladder', 'leaderboard', 'library', 'map', 'me', 'media', 'new',
  'pitch', 'pricing', 'profile', 'projects', 'project', 'rulebook',
  'scouts', 'search', 'settings', 'signup', 'login', 'submit',
  'terms', 'privacy', 'tokens', 'dashboard', 'about', 'blog',
])

const SLUG_MIN_LEN = 2
const SLUG_MAX_LEN = 50

const DOMAIN_RE     = /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i
const GITHUB_URL_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i
const OWNER_REPO_RE = /^([\w.-]+)\/([\w.-]+)$/

/** Strict UUID v4-ish check · 8-4-4-4-12 hex. Used by the resolver
 *  to pick the slug vs uuid branch. */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/** Generic-name normalization · used by route C and as the suffix
 *  fallback for non-conforming inputs. */
function genericNormalize(raw: string): string {
  return raw
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')                        // dash for everything else
    .replace(/-+/g, '-')                                 // collapse multiple dashes
    .replace(/^[-.]+|[-.]+$/g, '')                       // trim leading/trailing dash · dot
    .slice(0, SLUG_MAX_LEN)
}

/** Validate slug shape (post-normalization). Doesn't check uniqueness. */
export function isValidSlug(s: string): boolean {
  if (!s) return false
  if (s.length < SLUG_MIN_LEN || s.length > SLUG_MAX_LEN) return false
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(s)) return false
  if (RESERVED_SLUGS.has(s)) return false
  return true
}

/** Best-effort slug from a project name (or GitHub URL · or domain).
 *  Returns '' when input can't produce a valid ASCII slug. Caller
 *  surfaces a UI ask ("Please pick an ASCII alternate"). */
export function projectSlug(name: string | null | undefined): string {
  if (!name) return ''
  const raw = String(name).trim()
  if (!raw) return ''

  // B. GitHub full URL
  const ghMatch = raw.match(GITHUB_URL_RE)
  if (ghMatch) {
    const owner = ghMatch[1]?.toLowerCase()
    const repo  = ghMatch[2]?.toLowerCase().replace(/\.git$/, '')
    if (owner && repo) {
      const candidate = `${owner}-${repo}`
        .replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-').slice(0, SLUG_MAX_LEN)
      if (isValidSlug(candidate)) return candidate
    }
  }
  // B'. owner/repo shorthand (no spaces, has exactly one slash, no '.')
  const orMatch = raw.match(OWNER_REPO_RE)
  if (orMatch && !raw.includes(' ') && !raw.includes('.')) {
    const candidate = `${orMatch[1].toLowerCase()}-${orMatch[2].toLowerCase()}`
      .replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-').slice(0, SLUG_MAX_LEN)
    if (isValidSlug(candidate)) return candidate
  }

  // A. Domain-style (e.g. meerkats.ai · commit.show)
  const lower = raw.toLowerCase()
  if (DOMAIN_RE.test(lower)) {
    if (isValidSlug(lower)) return lower
  }

  // C. Generic name
  const normalized = genericNormalize(raw)
  return isValidSlug(normalized) ? normalized : ''
}

/** When the base slug collides with an existing one, append -2, -3, ...
 *  Caller passes the Set of existing slugs. */
export function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`) && i < 1000) i++
  return `${base}-${i}`
}

/** Canonical share URL for a project · prefers slug, falls back to uuid.
 *  Note (2026-05-12): canonical path is now /projects/<slug> (not
 *  /project/<slug>). The old /project/:slug route stays as a
 *  client-side redirect for any tweet/share already in the wild. */
export function projectShareUrl(slugOrName: string | null | undefined, fallbackId?: string): string {
  const slug = projectSlug(slugOrName)
  if (slug) return `https://commit.show/projects/${slug}`
  if (fallbackId) return `https://commit.show/projects/${fallbackId}`
  return 'https://commit.show'
}
