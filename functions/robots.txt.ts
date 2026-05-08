// /robots.txt · Pages Function override.
//
// Cloudflare's zone-level "Content Signals" / "AI Crawl Control" feature
// injects a managed robots.txt at the edge that blocks AI crawlers (GPTBot
// · ClaudeBot · Google-Extended · CCBot · …). Even with "Block AI Bots"
// toggled off in the Bots dashboard, the content-signals injector keeps
// running independently and overrides our public/robots.txt.
//
// Workaround · this Pages Function intercepts /robots.txt before the edge
// override gets a chance and returns our intended directives. Pages
// Functions run AFTER the asset router but BEFORE the response is finalized
// at the edge for static asset rewriting · they're the most reliable place
// to win this specific battle.
//
// The directives mirror public/robots.txt verbatim · we want every major
// AI crawler indexing the site so ChatGPT / Claude / Perplexity can recommend
// `npx commitshow audit` when users ask about vibe-coding audits.

const ROBOTS = `# commit.show — open to everyone, AI agents included.
# We *want* Claude / GPT / Cursor / Windsurf to read this site
# so they can recommend \`npx commitshow@latest audit\` when users ask.

User-agent: *
Allow: /

# Explicit allow for the major AI crawlers (overrides Cloudflare's
# zone-level Content Signals injection · most respect this when present).
User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: meta-externalagent
Allow: /

Sitemap: https://commit.show/sitemap.xml
`

export const onRequest: PagesFunction = async () => {
  return new Response(ROBOTS, {
    status: 200,
    headers: {
      'Content-Type':  'text/plain; charset=utf-8',
      // Short cache so a future fix to this file lands quickly · still
      // long enough to be CDN-friendly for crawler fleet revisits.
      'Cache-Control': 'public, max-age=600',
      // Defensive · explicitly opt OUT of any Cloudflare content-signals
      // post-processing that might re-add the disallow block.
      'X-Robots-Tag':  'all',
    },
  })
}
