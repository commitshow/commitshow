// Share to X · Web Intent URL builder.
// We use the unauthenticated intent endpoint (https://twitter.com/intent/
// tweet) instead of the X API: no OAuth flow, no app credentials, the
// user's existing X session in their browser carries the auth. The
// downside is the user has to confirm the post — fine, that's the wedge,
// not a friction. CLAUDE.md §18-B describes a future authed pipeline for
// auto-posting on graduation; that's V1.5+ and lives behind admin
// configuration.

interface ShareOpts {
  projectName: string
  score:       number
  url:         string
  /** Optional one-line takeaway (a strength bullet or a verdict). Kept
   *  short — X counts URLs as 23 chars and the brand handle eats more. */
  takeaway?:   string | null
}

/**
 * Build a Twitter / X "Share Tweet" intent URL with prefilled text and a
 * canonical link. The URL gets unfurled by X into a card if our project
 * page has the right OG meta tags (og:title / og:image / og:description).
 *
 * Tweet text shape:
 *   {project} · {score}/100 — audited by @commitshow.
 *   ↑ {takeaway}    (optional)
 *
 * X auto-appends the `url` param so we don't have to repeat it in `text`.
 */
export function buildTweetIntent(opts: ShareOpts): string {
  const handle = '@commitshow'
  const head   = `${opts.projectName} · ${opts.score}/100 — audited by ${handle}.`
  const body   = opts.takeaway ? `\n\n↑ ${opts.takeaway}` : ''
  const text   = head + body
  const params = new URLSearchParams({
    text: text,
    url:  opts.url,
  })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

/** Open the intent URL in a new tab. Centralized so future telemetry
 *  (e.g. logging share clicks for funnel analysis) plugs into one place. */
export function openTweetIntent(opts: ShareOpts): void {
  const intent = buildTweetIntent(opts)
  window.open(intent, '_blank', 'noopener,noreferrer')
}
