// /v2 directory SEO/AEO middleware · SSR-light meta + structured data.
//
// The directory's whole value is being found — by search engines AND answer
// engines (LLMs). The SPA alone serves every /v2/s/* page identical generic
// meta, which is invisible to crawlers. This middleware fetches the listing at
// the edge and injects, per page:
//   · <title> · meta description · canonical · og:* · twitter:*
//   · JSON-LD @graph (WebPage + SoftwareApplication + AggregateRating +
//     BreadcrumbList) — the schema.org structured data that drives Google rich
//     results and is parsed by answer engines for citations.
//
// Covers both /v2 (directory index · WebSite + SearchAction) and
// /v2/s/<slug> (a listing). Anything else under /v2 passes through.

interface Env { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }

const SITE = 'https://commit.show'
const supa = (env: Env) => env.SUPABASE_URL ?? 'https://tekemubwihsjdzittoqf.supabase.co'

type Listing = {
  id: string; slug: string; name: string; domain: string; url: string
  platform: string | null; category: string | null
  tagline: string | null; description: string | null
  who_for: string[] | null; features: string[] | null
  pricing: string | null; image_url: string | null; icon_url: string | null
  has_pricing: boolean; info_as_of: string | null
}

async function getListing(env: Env, slug: string): Promise<Listing | null> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  if (!key) return null
  const cols = 'id,slug,name,domain,url,platform,category,tagline,description,who_for,features,pricing,image_url,icon_url,has_pricing,info_as_of'
  const r = await fetch(`${supa(env)}/rest/v1/listings?slug=eq.${encodeURIComponent(slug)}&select=${cols}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) return null
  const rows = await r.json() as Listing[]
  return rows[0] ?? null
}
async function getStats(env: Env, id: string): Promise<{ avg: number; count: number; tickets: number }> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  const h = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const [a, b] = await Promise.all([
      fetch(`${supa(env)}/rest/v1/listing_rating_stats?listing_id=eq.${id}&select=avg_rating,rating_count`, { headers: h }),
      fetch(`${supa(env)}/rest/v1/listing_ticket_stats?listing_id=eq.${id}&select=ticket_count`, { headers: h }),
    ])
    const ar = a.ok ? (await a.json())[0] : null
    const br = b.ok ? (await b.json())[0] : null
    return { avg: ar?.avg_rating ?? 0, count: ar?.rating_count ?? 0, tickets: br?.ticket_count ?? 0 }
  } catch { return { avg: 0, count: 0, tickets: 0 } }
}
async function getAlternatives(env: Env, category: string | null, slug: string): Promise<{ slug: string; name: string; url: string }[]> {
  const key = env.SUPABASE_ANON_KEY ?? ''
  if (!key || !category) return []
  const r = await fetch(`${supa(env)}/rest/v1/listings?category=eq.${encodeURIComponent(category)}&slug=neq.${encodeURIComponent(slug)}&benchmark=not.is.null&select=slug,name,url&limit=12`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) return []
  return await r.json() as { slug: string; name: string; url: string }[]
}

const clean = (s: string | null | undefined, max = 300) =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
// JSON-LD must never break out of the <script> — escape '<'.
const ldSafe = (obj: unknown) => JSON.stringify(obj).replace(/</g, '\\u003c')

class Meta { constructor(private v: string) {} element(e: Element) { e.setAttribute('content', this.v) } }
class Attr { constructor(private a: string, private v: string) {} element(e: Element) { e.setAttribute(this.a, this.v) } }
class Title { constructor(private t: string) {} element(e: Element) { e.setInnerContent(this.t) } }
class HeadInject { constructor(private html: string) {} element(e: Element) { e.append(this.html, { html: true }) } }

function rewrite(res: Response, opts: { title: string; description: string; canonical: string; ogImage?: string; jsonld: unknown[] }): Response {
  const { title, description, canonical, ogImage, jsonld } = opts
  let rw = new HTMLRewriter()
    .on('title', new Title(title))
    .on('meta[name="description"]', new Meta(description))
    .on('link[rel="canonical"]', new Attr('href', canonical))
    .on('meta[property="og:url"]', new Meta(canonical))
    .on('meta[property="og:site_name"]', new Meta('Legit.Show'))
    .on('meta[property="og:title"]', new Meta(title))
    .on('meta[name="twitter:title"]', new Meta(title))
    .on('meta[property="og:description"]', new Meta(description))
    .on('meta[name="twitter:description"]', new Meta(description))
  if (ogImage) {
    rw = rw
      .on('meta[property="og:image"]', new Meta(ogImage))
      .on('meta[property="og:image:alt"]', new Meta(title))
      .on('meta[name="twitter:image"]', new Meta(ogImage))
      .on('meta[name="twitter:image:alt"]', new Meta(title))
  }
  const ld = jsonld.map(o => `<script type="application/ld+json">${ldSafe(o)}</script>`).join('')
  rw = rw.on('head', new HeadInject(ld))
  return rw.transform(res)
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const path = url.pathname.replace(/\.html$/, '')
  const isIndex = path === '/v2' || path === '/v2/'
  const m = path.match(/^\/v2\/s\/([A-Za-z0-9._-]+)\/?$/)
  const ma = path.match(/^\/v2\/alternatives\/([A-Za-z0-9._-]+)\/?$/)
  if (!isIndex && !m && !ma) return ctx.next()

  // Pull the SPA shell directly (ctx.next can fall through opaquely on Pages).
  const assetRes = await fetch(new URL('/index.html', ctx.request.url).toString())
  if (!assetRes.ok) return ctx.next()

  // ── directory index ──
  if (isIndex) {
    const canonical = `${SITE}/v2`
    const title = 'Legit.Show — every launched service, tested'
    const description = 'A directory of launched web apps, SaaS, AI tools, MCP servers and Skills — what each does, who it is for, real ratings, and an objective benchmark.'
    const website = {
      '@context': 'https://schema.org', '@type': 'WebSite', name: 'Legit.Show', url: canonical,
      description,
      potentialAction: { '@type': 'SearchAction', target: `${SITE}/v2?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    }
    const out = rewrite(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [website] })
    const r = new Response(out.body, out); r.headers.set('x-legit-seo', 'index'); return r
  }

  // ── "{X} alternatives" comparison ──
  if (ma) {
    const aslug = ma[1]
    let subject: Listing | null = null
    try { subject = await getListing(ctx.env, aslug) } catch { subject = null }
    if (!subject) { const pt = new Response(assetRes.body, assetRes); pt.headers.set('x-legit-seo', 'miss'); return pt }
    const acat = subject.category || subject.platform || 'service'
    const alts = await getAlternatives(ctx.env, subject.category, aslug)
    const canonical = `${SITE}/v2/alternatives/${subject.slug}`
    const names = alts.map(a => a.name)
    const title = `${subject.name} alternatives — ${names.length} tested options compared | Legit.Show`
    const description = clean(names.length
      ? `${names.length} tested ${acat} alternatives to ${subject.name}, compared on the same objective benchmark: ${names.slice(0, 6).join(', ')}.`
      : `Tested ${acat} alternatives to ${subject.name} on Legit.Show.`, 200)
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CollectionPage', '@id': canonical, url: canonical, name: title, description, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: `${SITE}/v2` } },
        { '@type': 'ItemList', name: `${subject.name} alternatives`, numberOfItems: alts.length,
          itemListElement: alts.map((a, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SoftwareApplication', name: a.name, url: a.url, applicationCategory: acat } })) },
        { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Legit.Show', item: `${SITE}/v2` },
          { '@type': 'ListItem', position: 2, name: acat, item: `${SITE}/v2?cat=${encodeURIComponent(acat)}` },
          { '@type': 'ListItem', position: 3, name: subject.name, item: `${SITE}/v2/s/${subject.slug}` },
          { '@type': 'ListItem', position: 4, name: 'alternatives', item: canonical },
        ] },
      ],
    }
    const out = rewrite(assetRes, { title, description, canonical, ogImage: `${SITE}/og-image.png`, jsonld: [graph] })
    const r = new Response(out.body, out)
    r.headers.set('x-legit-seo', 'alternatives'); r.headers.set('x-legit-slug', subject.slug)
    return r
  }

  // ── listing detail ──
  const slug = m![1]
  let listing: Listing | null = null
  try { listing = await getListing(ctx.env, slug) } catch { listing = null }
  if (!listing) { const pt = new Response(assetRes.body, assetRes); pt.headers.set('x-legit-seo', 'miss'); return pt }
  const stats = await getStats(ctx.env, listing.id)

  const cat = listing.category || listing.platform || 'service'
  const canonical = `${SITE}/v2/s/${listing.slug}`
  const blurb = clean(listing.tagline || listing.description, 160)
  const ratingTxt = stats.count > 0 ? `Rated ${stats.avg}★ by ${stats.count}. ` : ''
  const title = `${listing.name} — ${clean(listing.tagline || cat, 60)} | Legit.Show`
  const description = clean(`${blurb}. ${ratingTxt}Features, pricing, reviews and an objective benchmark on Legit.Show.`, 200)
  const ogImage = listing.image_url || listing.icon_url || `${SITE}/og-image.png`

  // schema.org @graph — WebPage + the service + breadcrumbs.
  const app: Record<string, unknown> = {
    '@type': 'SoftwareApplication', '@id': `${canonical}#app`,
    name: listing.name, url: listing.url, applicationCategory: cat,
    operatingSystem: /apps\.apple\.com/.test(listing.url) ? 'iOS' : 'Web',
    description: clean(listing.description || listing.tagline, 280),
  }
  if (ogImage) app.image = ogImage
  if (Array.isArray(listing.features) && listing.features.length) app.featureList = listing.features.slice(0, 12)
  if (stats.count > 0) app.aggregateRating = { '@type': 'AggregateRating', ratingValue: stats.avg, reviewCount: stats.count, bestRating: 5, worstRating: 1 }
  if (!listing.has_pricing && !clean(listing.pricing)) app.offers = { '@type': 'Offer', price: 0, priceCurrency: 'USD' }

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': canonical, url: canonical, name: title, description, primaryImageOfPage: ogImage, isPartOf: { '@type': 'WebSite', name: 'Legit.Show', url: `${SITE}/v2` } },
      app,
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Legit.Show', item: `${SITE}/v2` },
        { '@type': 'ListItem', position: 2, name: cat, item: `${SITE}/v2?cat=${encodeURIComponent(cat)}` },
        { '@type': 'ListItem', position: 3, name: listing.name, item: canonical },
      ] },
    ],
  }

  const out = rewrite(assetRes, { title, description, canonical, ogImage, jsonld: [graph] })
  const r = new Response(out.body, out)
  r.headers.set('x-legit-seo', 'listing'); r.headers.set('x-legit-slug', listing.slug)
  return r
}
