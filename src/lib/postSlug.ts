// Slug-prefix URL helpers for community posts (2026-05-16).
//
// Pattern: /community/<segment>/<slug>-<uuid>
//   e.g.   /community/open-mic/3am-one-more-feature-ship-7ba0c865-34af-4db5-b208-870ba77ce331
//
// The slug is decorative · the UUID at the end is the routing key. Older
// URLs that lack a slug (`/community/<segment>/<uuid>`) keep resolving
// because extractPostUuid() looks for a UUID at the end of whatever
// param it receives. Title edits never break links — the UUID is stable
// and the slug can drift safely.
//
// SEO wins:
//   · Search snippets show the keywords in the URL
//   · Click-through rate on X / Slack / Discord goes up because the
//     link reads as the post topic, not an opaque id
//   · Google indexes the keywords in the URL alongside title + body
//
// Mirrored on the edge in functions/community/_middleware.ts so the
// SEO meta + noscript article see the same slug pattern Googlebot
// follows. Keep the regex and slug rules in sync between both files.
import type { CommunityPostType } from './supabase'

// UUID v4 / v1 style · 8-4-4-4-12. Must match what gen_random_uuid()
// in Postgres produces. The /i flag handles upper- or lower-case in
// case some legacy share copied with capitals.
export const POST_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

const TYPE_TO_SEGMENT: Record<CommunityPostType, string> = {
  build_log:    'build-logs',
  stack:        'stacks',
  ask:          'asks',
  office_hours: 'office-hours',
  open_mic:     'open-mic',
}

/** Build the URL-safe slug portion from a post title.
 *  · lowercase
 *  · decompose Unicode accents, drop diacritics
 *  · replace anything not a-z 0-9 with a single hyphen
 *  · trim leading/trailing hyphens
 *  · cap at 60 chars (Google starts truncating URL slugs past ~80)
 *  Returns '' when the title has zero indexable chars (emoji-only,
 *  CJK-only without transliteration etc.). Callers fall back to the
 *  bare-UUID URL in that case. */
export function buildPostSlug(title: string | null | undefined): string {
  if (!title) return ''
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/** Compose the canonical /community/<segment>/<slug>-<uuid> path.
 *  Falls back to /community/<segment>/<uuid> if the slug came out
 *  empty (e.g. emoji-only title). */
export function buildPostHref(type: CommunityPostType, id: string, title: string | null | undefined): string {
  const segment = TYPE_TO_SEGMENT[type]
  const slug    = buildPostSlug(title)
  return slug ? `/community/${segment}/${slug}-${id}` : `/community/${segment}/${id}`
}

/** Pull the UUID off the end of an :id route param. Handles both
 *  legacy bare-UUID params and the new slug-prefixed ones. Returns
 *  null if no UUID is at the end (i.e. the param is malformed and
 *  the page should 404). */
export function extractPostUuid(idParam: string | undefined | null): string | null {
  if (!idParam) return null
  const m = idParam.match(POST_UUID_RE)
  return m ? m[1] : null
}
