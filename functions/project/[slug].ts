// /project/<slug> · SSR-light wrapper.
//
// The SPA serves a single index.html for every route, with static
// og:image meta. When X / LinkedIn / Discord crawlers fetch this URL
// to build the link unfurl card, they read those static metas and
// every share looks identical.
//
// This Function intercepts /project/<slug>, fetches the underlying
// index.html, resolves the slug to a project id, then rewrites the
// og:image / twitter:image / og:title / og:description meta tags so
// the unfurl card carries that specific project's data.
//
// Browser users hit the same path but their UI is still the SPA — the
// HTMLRewriter modifications are head-only, so the React mount
// behaves identically.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

async function resolveSlug(env: Env, slug: string): Promise<{
  id: string
  project_name: string
  score_total: number | null
} | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  // Slug is name-derived (projectSlug() · diacritics stripped, non-
  // alnum collapsed). Resolution: pull projects with a matching
  // canonical name, prefer the most-recent created_at on collision.
  // PostgREST doesn't support our custom slug fn, so we ilike-match a
  // pattern that maps loosely back. Cheaper alternative: pull active
  // projects, slugify client-side, match in JS. Active set is small
  // enough that this is fine.
  const cols = 'id,project_name,score_total,created_at,status'
  const res  = await fetch(
    `${url}/rest/v1/projects?status=in.(active,graduated,valedictorian)&select=${cols}&order=created_at.desc&limit=200`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string; project_name: string; score_total: number | null; created_at: string }>
  const slugify = (s: string) => s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const want = slugify(slug)
  const match = rows.find(r => slugify(r.project_name) === want)
  return match ?? null
}

class MetaContentRewriter {
  constructor(private newValue: string, private attr: 'content' = 'content') {}
  element(el: Element): void {
    el.setAttribute(this.attr, this.newValue)
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { slug } = ctx.params as { slug: string }
  const cleanSlug = Array.isArray(slug) ? slug[0] : slug

  // 1. Pull the static SPA HTML the way the Pages asset server would.
  const assetReq = new Request(new URL('/index.html', ctx.request.url).toString(), ctx.request)
  let assetRes: Response
  try {
    assetRes = await ctx.env.ASSETS?.fetch(assetReq) ?? await ctx.next()
  } catch {
    assetRes = await ctx.next()
  }

  // 2. Resolve slug · if no match, leave the response unmodified
  //    (browser SPA handles 'not found' anyway).
  const project = await resolveSlug(ctx.env, cleanSlug)
  if (!project) return assetRes

  const ogImageUrl  = `https://commit.show/og/project/${project.id}.png`
  const title       = `${project.project_name} · ${project.score_total ?? '—'}/100 · commit.show`
  const description = `${project.project_name} on commit.show. Audited by the engine, auditioned for Scouts. Score ${project.score_total ?? '—'}/100.`

  // 3. Swap meta tags · keep absolute URLs so social crawlers don't
  //    have to resolve relative paths.
  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]',        new MetaContentRewriter(ogImageUrl))
    .on('meta[property="og:image:alt"]',    new MetaContentRewriter(title))
    .on('meta[name="twitter:image"]',       new MetaContentRewriter(ogImageUrl))
    .on('meta[property="og:title"]',        new MetaContentRewriter(title))
    .on('meta[name="twitter:title"]',       new MetaContentRewriter(title))
    .on('meta[property="og:description"]',  new MetaContentRewriter(description))
    .on('meta[name="twitter:description"]', new MetaContentRewriter(description))

  return rewriter.transform(assetRes)
}
