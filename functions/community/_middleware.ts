// /community/<segment>/<uuid> middleware · SSR-light wrapper.
//
// Mirrors functions/projects/_middleware.ts. The React app is a SPA so
// Googlebot only sees a static index.html with brand-default title +
// description on every community URL. This middleware intercepts each
// /community/<segment>/<uuid> request, fetches the post from Supabase
// REST (anon key + RLS = public published posts only), and:
//
//   1. Swaps <title>, <meta description>, og:*, twitter:*, canonical
//      so SERP snippets + social unfurls show post-specific content
//   2. Appends a <noscript><article>...</article></noscript> block to
//      the end of <body> with the post title + tldr + body so Googlebot
//      can index the actual content without JS render
//
// For paths under /community that aren't a single-post URL
// (/community, /community/<segment> feed pages), we ctx.next() so the
// SPA shell flows through untouched. Future phase can extend this to
// inject feed-page metadata too.
//
// Cloaking-safe · the swapped meta + injected noscript represent the
// same content the SPA renders for humans (just rendered statically
// for crawlers). Per Google's policy on dynamic rendering: identical
// semantics → no penalty.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ResolvedPost {
  id:           string
  type:        'build_log' | 'stack' | 'ask' | 'office_hours' | 'open_mic'
  title:        string
  tldr:         string | null
  body:         string | null
  status:       string | null
  published_at: string | null
  tags:         string[] | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Canonical mapping mirrors src/pages/CommunityPostDetailPage.tsx
// SEGMENT_TO_TYPE. Must stay in sync · adding a new community type
// means adding the segment here too.
const SEGMENT_TO_TYPE: Record<string, ResolvedPost['type']> = {
  'build-logs':   'build_log',
  'stacks':       'stack',
  'asks':         'ask',
  'office-hours': 'office_hours',
  'open-mic':     'open_mic',
}

// Human label used in title / og:title alongside the post title so the
// SERP snippet reads "{title} · Open Mic · commit.show" instead of
// the cryptic '{title} · commit.show'.
const TYPE_LABEL: Record<ResolvedPost['type'], string> = {
  build_log:    'Build Log',
  stack:        'Stack',
  ask:          'Ask',
  office_hours: 'Office Hours',
  open_mic:     'Open Mic',
}

async function resolveById(env: Env, id: string, type: ResolvedPost['type']): Promise<ResolvedPost | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null
  const cols = 'id,type,title,tldr,body,status,published_at,tags'
  const res  = await fetch(
    `${url}/rest/v1/community_posts?id=eq.${id}&type=eq.${type}&select=${cols}&limit=1`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return null
  const rows = await res.json() as ResolvedPost[]
  const row  = rows[0]
  if (!row) return null
  // RLS already filters status, but be defensive · drafts shouldn't
  // leak through even if RLS gets relaxed by mistake.
  if (row.status && !['published', 'resolved', 'expired'].includes(row.status)) return null
  return row
}

// HTML escape for any value we inject into raw HTML (noscript body).
// setAttribute() in Cloudflare HTMLRewriter handles attribute-context
// escaping itself, so MetaRewriter doesn't need to call this. Element
// .append({html: true}) DOES insert raw, so anything we hand it must
// already be safe.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

class MetaRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    el.setAttribute('content', this.value)
  }
}

class HrefRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    el.setAttribute('href', this.value)
  }
}

class TitleTextRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    // Default html=false → treats value as text content, HTMLRewriter
    // serializes with proper escaping. Safe even if title contains &<>".
    el.setInnerContent(this.value)
  }
}

class BodyAppender {
  constructor(private html: string) {}
  element(el: Element): void {
    el.append(this.html, { html: true })
  }
}

function buildNoscriptArticle(post: ResolvedPost, canonicalUrl: string, typeLabel: string): string {
  const title = escapeHtml(post.title)
  const tldr  = post.tldr ? escapeHtml(post.tldr) : ''
  // Cap body at 4000 chars · plenty for indexing, prevents HTML bloat
  // on long Build Log posts. Body is markdown source · we don't render
  // formatting, just escape and emit text with paragraph breaks on
  // double-newline so Googlebot reads it as structured prose.
  const bodySrc = post.body ? truncate(post.body, 4000) : ''
  const bodyHtml = bodySrc
    ? escapeHtml(bodySrc).split(/\n\n+/).map(p =>
        `<p>${p.replace(/\n/g, '<br>')}</p>`
      ).join('')
    : ''
  const dateAttr = post.published_at ? new Date(post.published_at).toISOString() : ''
  // Tags are stored without '#' by spec (TagInput normalizes that
  // out) but historic rows can still hold '#vibe-life' from before the
  // fix. Strip any leading '#' chars and prepend exactly one so the
  // indexed output is always '#vibe-life #all-nighter' regardless of
  // stored shape · matches the React render behaviour for visual
  // consistency between crawled HTML and live SPA.
  const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
    ? `<p>${post.tags.map(t => `#${escapeHtml(String(t).replace(/^#+/, ''))}`).join(' ')}</p>`
    : ''
  // Crawlers (and JS-disabled visitors) get the full article. React's
  // hydration into #root sits above this block · once JS boots, the
  // SPA layout owns the viewport. We don't hide the noscript with CSS
  // because <noscript> is already invisible to JS-enabled browsers by
  // spec — no extra style needed.
  return `<noscript><article itemscope itemtype="https://schema.org/Article">
    <h1 itemprop="headline">${title}</h1>
    ${dateAttr ? `<time itemprop="datePublished" datetime="${dateAttr}">${dateAttr.slice(0, 10)}</time>` : ''}
    <p><em>${typeLabel} · commit.show</em></p>
    ${tldr ? `<p itemprop="description"><strong>${tldr}</strong></p>` : ''}
    <div itemprop="articleBody">${bodyHtml}</div>
    ${tagsHtml}
    <p><a href="${escapeHtml(canonicalUrl)}">Read on commit.show</a></p>
  </article></noscript>`
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url   = new URL(ctx.request.url)
  const parts = url.pathname.split('/').filter(Boolean)   // ['community', '<segment>', '<id>']

  // Only intercept /community/<segment>/<id> · feed pages
  // (/community, /community/<segment>) and unmatched paths fall through
  // to the SPA shell unchanged.
  if (parts[0] !== 'community' || parts.length < 3 || !parts[1] || !parts[2]) {
    return ctx.next()
  }

  const segment = parts[1]
  const type    = SEGMENT_TO_TYPE[segment]
  if (!type) {
    return ctx.next()
  }

  const id = parts[2].replace(/\.html$/, '')
  if (!UUID_RE.test(id)) {
    return ctx.next()
  }

  // Fetch the SPA HTML so HTMLRewriter has a stream to transform.
  // ctx.next() can fall through opaquely on Pages · explicit fetch of
  // /index.html keeps the rewrite path deterministic.
  const indexUrl = new URL('/index.html', ctx.request.url).toString()
  const assetRes = await fetch(indexUrl)
  if (!assetRes.ok) {
    return new Response(`asset fetch failed: ${assetRes.status}`, { status: 500 })
  }

  let post: ResolvedPost | null = null
  try {
    post = await resolveById(ctx.env, id, type)
  } catch {
    post = null
  }
  if (!post) {
    // Post not found (deleted, draft, wrong type for segment) · pass
    // the unmodified SPA shell. The React route will 404 client-side.
    const passthrough = new Response(assetRes.body, assetRes)
    passthrough.headers.set('x-cs-community-rewrite', 'miss')
    return passthrough
  }

  const typeLabel    = TYPE_LABEL[post.type]
  const canonicalUrl = `https://commit.show/community/${segment}/${post.id}`
  // SERP title pattern · keep under ~60 chars when the post title is
  // short so the suffix lands. Falls naturally to truncation when long.
  const title        = `${post.title} · ${typeLabel} · commit.show`
  // Description prefers tldr (one-line summary) · falls back to body
  // start. Cap at 160 chars (Google SERP snippet limit). Body is markdown
  // source · plain truncation is fine, Google strips remaining markdown.
  const descSrc      = post.tldr?.trim() || post.body?.trim() || `${typeLabel} on commit.show`
  const description  = truncate(descSrc.replace(/\s+/g, ' '), 160)

  // og:image / twitter:image · phase 1 keeps the brand default. A future
  // phase can swap in a per-post OG card (similar to og-png for projects)
  // once we have demand · the meta + body indexing wins are independent
  // of the social card so this stays out of scope for v1.
  const noscriptHtml = buildNoscriptArticle(post, canonicalUrl, typeLabel)

  const rewriter = new HTMLRewriter()
    .on('title',                            new TitleTextRewriter(title))
    .on('meta[name="description"]',         new MetaRewriter(description))
    .on('link[rel="canonical"]',            new HrefRewriter(canonicalUrl))
    .on('meta[property="og:url"]',          new MetaRewriter(canonicalUrl))
    .on('meta[property="og:title"]',        new MetaRewriter(title))
    .on('meta[property="og:description"]',  new MetaRewriter(description))
    .on('meta[property="og:type"]',         new MetaRewriter('article'))
    .on('meta[name="twitter:title"]',       new MetaRewriter(title))
    .on('meta[name="twitter:description"]', new MetaRewriter(description))
    .on('body',                             new BodyAppender(noscriptHtml))

  const transformed = rewriter.transform(assetRes)
  const out = new Response(transformed.body, transformed)
  out.headers.set('x-cs-community-rewrite', 'hit')
  out.headers.set('x-cs-community-post-id', post.id)
  out.headers.set('x-cs-community-type',    post.type)
  // Short edge cache · titles/bodies update via edit flow, so we don't
  // want to serve stale meta for too long. 60s strikes the balance —
  // fast enough that an edit propagates within a minute, slow enough
  // that Googlebot's repeat fetches dedupe at the edge.
  out.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60')
  return out
}
