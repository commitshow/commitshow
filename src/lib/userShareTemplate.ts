// User-share template runtime · reads cmo_templates (audience='user_share')
// rows, fills {slot} placeholders, and opens X intent URL pre-filled with
// the user's first-person tweet copy.
//
// CMO's Room (admin /admin/cmo) is where these templates are EDITED.
// This module is where they are CONSUMED on user-facing pages
// (ProjectDetailPage, ProfilePage, ScoutsPage, etc.).
//
// One-button flow: user clicks "Share on X" on their own audit / graduation
// / milestone result → we fetch the latest copy_template, substitute slots,
// and open twitter.com/intent/tweet?text=...&url=... in a new tab. X auto-
// embeds an unfurled card if the linked URL has og:image meta tags.

import { supabase } from './supabase'
import { appendHashtags } from './tweetHashtags'

// Fixed enum mirroring cmo_templates seed rows.
// audit_complete    · /project/:slug  (own audit · creator share)
// encore            · /project/:slug  (own project earned an Encore — any track)
// milestone         · /project/:slug  (own project hit milestone)
// early_spotter     · /scouts/:id · /me  (Scout Forecast hit)
//
// 'graduation' was the v1 name; renamed to 'encore' in v2 (the
// graduation tier system was replaced by the single Encore threshold
// at score ≥ 85 + the 4-track Encore extensions). cmo_templates row
// id was migrated · this enum mirrors it.
export type UserShareTemplateId =
  | 'audit_complete'
  | 'encore'
  | 'milestone'
  | 'early_spotter'

export type SlotMap = Record<string, string | number | null | undefined>

// Module-level cache · templates change rarely (admin edit only) so a 5min
// TTL is fine. Avoids round-tripping cmo_templates on every page render.
const TTL_MS = 5 * 60_000
const cache  = new Map<string, { copy: string; at: number }>()

export async function fetchUserShareTemplate(id: UserShareTemplateId): Promise<string | null> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.copy
  const { data, error } = await supabase
    .from('cmo_templates')
    .select('copy_template')
    .eq('id', id)
    .eq('audience', 'user_share')
    .maybeSingle()
  if (error || !data) return null
  cache.set(id, { copy: data.copy_template, at: Date.now() })
  return data.copy_template
}

/** Replace {slot_name} placeholders with values from the slot map.
 *  Missing slots collapse to empty strings — a missing concern bullet
 *  shouldn't render `{top_concern_1}` as visible literal in the tweet. */
export function fillSlots(template: string, slots: SlotMap): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = slots[key]
    return v === null || v === undefined ? '' : String(v)
  }).replace(/\n{3,}/g, '\n\n').trim()
}

/** Build the X intent URL · X eats 23 chars for the URL slot, so keep
 *  the assembled `text` under ~250 chars to stay safely within 280. */
export function buildIntentUrl(text: string, url?: string): string {
  const params = new URLSearchParams()
  params.set('text', text)
  if (url) params.set('url', url)
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

// Map a template id → ?og=<kind> query our project middleware reads
// to pick the right OG card variant. Dropping the parameter (audit
// = default) keeps the URL short for the templates that don't need
// a special card.
const OG_KIND_BY_TEMPLATE: Record<UserShareTemplateId, string | null> = {
  audit_complete: null,         // default 'audit' card · no query needed
  encore:         'encore',
  milestone:      'milestone',
  early_spotter:  'spotter',    // /scouts/<id> · spotter card variant
}

/** Append `?og=<kind>` to any commit.show/project/<slug> or
 *  commit.show/scouts/<id> URLs found in the tweet text. We touch
 *  the URL in the body (X auto-unfurls from there) instead of the
 *  intent's separate &url= because most of our templates embed the
 *  link directly and don't pass a separate url. */
function injectOgQuery(text: string, templateId: UserShareTemplateId, slots: SlotMap): string {
  const kind = OG_KIND_BY_TEMPLATE[templateId]
  if (!kind) return text

  // For milestone, also ride the milestone label so the OG card can
  // render it in the headline.
  const milestoneLabel = templateId === 'milestone'
    ? (slots.milestone_label ?? slots.milestone ?? '')
    : null

  return text.replace(
    /commit\.show\/(project|scouts)\/([^\s?#]+)/g,
    (match, _section, _slug) => {
      const params = new URLSearchParams({ og: kind })
      if (milestoneLabel) params.set('milestone', String(milestoneLabel))
      return `${match}?${params.toString()}`
    },
  )
}

/** End-to-end: load template by id, fill slots, open the intent URL.
 *  Returns false if the template couldn't be loaded (caller decides
 *  whether to surface a fallback / error toast). */
// Map template id → tweetHashtags kind (drives extra hashtag selection).
// audit_complete · milestone share inline a project URL with no kind suffix
// for the brand+vibecoding+buildinpublic+devtools default · encore tags
// '#encore' as 4th alongside the brand · early_spotter is generic share.
const HASHTAG_KIND_BY_TEMPLATE: Record<UserShareTemplateId, string> = {
  audit_complete: 'audit',
  encore:         'encore',
  milestone:      'milestone',
  early_spotter:  'tweet',
}

export async function shareWithTemplate(
  id:   UserShareTemplateId,
  slots: SlotMap,
  url?: string,
): Promise<boolean> {
  const template = await fetchUserShareTemplate(id)
  if (!template) return false
  const filled = fillSlots(template, slots)
  const text   = injectOgQuery(filled, id, slots)
  // Append hashtag bundle · CEO 2026-05-09 · #commitshow + 3-4 related.
  const withTags = appendHashtags(text, HASHTAG_KIND_BY_TEMPLATE[id])
  window.open(buildIntentUrl(withTags, url), '_blank', 'noopener,noreferrer')
  return true
}
