// Tweet hashtag helper · Deno mirror of src/lib/tweetHashtags.ts.
// Both modules MUST stay in sync · CEO directive 2026-05-09:
//   #commitshow 필수 · 띄어쓰기로 관련 해시태그 3-4개

const DEFAULT_BUNDLE: string[] = ['#commitshow', '#vibecoding', '#buildinpublic', '#devtools']

const KIND_EXTRA: Record<string, string | null> = {
  audit:      null,
  tweet:      null,
  encore:     '#encore',
  trajectory: '#shipping',
  milestone:  '#milestone',
}

export function buildHashtagLine(kind?: string): string {
  const tags = [...DEFAULT_BUNDLE]
  const extra = kind ? KIND_EXTRA[kind] : null
  if (extra && !tags.includes(extra)) tags.splice(3, 0, extra)
  return tags.slice(0, 5).join(' ')
}

export function appendHashtags(body: string, kind?: string): string {
  const tags = buildHashtagLine(kind)
  return `${body.replace(/\s+$/, '')}\n\n${tags}`
}
