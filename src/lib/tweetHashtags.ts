// Tweet hashtag helper · single source of truth for hashtag bundle.
// Appended to every share/auto-tweet body so the brand hashtag is always
// present and related discovery tags ride along.
//
// Rule (CEO 2026-05-09): #commitshow 필수 · 띄어쓰기로 관련 해시태그 3-4개.
//
// Default bundle (4 tags) targets:
//   #commitshow      · brand · always present · enables timeline mention search
//   #vibecoding      · category · captures the AI-assisted dev community
//   #buildinpublic   · indie maker community · high reshare rate
//   #devtools        · audience overlap with engineers + founders
//
// Optional kind-specific extras get appended (capped at 5 total · X soft
// limit before hashtag stuffing reads spammy):
//   audit / tweet  → no extra
//   encore         → '#encore' (cross-promote graduation moment)
//   trajectory     → '#shipping' (climbed = shipped progress)
//   milestone      → '#milestone'

const DEFAULT_BUNDLE: string[] = ['#commitshow', '#vibecoding', '#buildinpublic', '#devtools']

const KIND_EXTRA: Record<string, string | null> = {
  audit:      null,
  tweet:      null,
  encore:     '#encore',
  trajectory: '#shipping',
  milestone:  '#milestone',
}

/** Build the hashtag suffix string · returns "#a #b #c #d" with optional
 *  kind-specific extra slipped in before #devtools so the brand-tag pair
 *  reads first. Capped at 5. */
export function buildHashtagLine(kind?: string): string {
  const tags = [...DEFAULT_BUNDLE]
  const extra = kind ? KIND_EXTRA[kind] : null
  if (extra && !tags.includes(extra)) tags.splice(3, 0, extra)
  return tags.slice(0, 5).join(' ')
}

/** Append hashtag bundle to a tweet body with `\n\n` separator. */
export function appendHashtags(body: string, kind?: string): string {
  const tags = buildHashtagLine(kind)
  return `${body.replace(/\s+$/, '')}\n\n${tags}`
}
