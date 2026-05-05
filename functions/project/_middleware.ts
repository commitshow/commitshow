// /project/* middleware · SSR-light wrapper.
// Resolves the path's slug to a project, then patches the SPA HTML's
// og:image + twitter:image meta tags so X / LinkedIn unfurl per-
// project instead of using the generic /og-image.png.
//
// Why a _middleware.ts instead of [slug].ts:
//   The dynamic [slug] convention silently fell through to the
//   Pages SPA fallback (`not_found_handling: single-page-application`)
//   even though the function file was committed. Middleware is
//   guaranteed to run before any SPA / static-asset fallback for
//   paths under its directory.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ResolvedProject {
  id:           string
  project_name: string
  score_total:  number | null
}

async function resolveSlug(env: Env, slug: string): Promise<ResolvedProject | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null
  const cols = 'id,project_name,score_total,created_at,status'
  const res  = await fetch(
    `${url}/rest/v1/projects?status=in.(active,graduated,valedictorian)&select=${cols}&order=created_at.desc&limit=200`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<ResolvedProject & { created_at: string }>
  const slugify = (s: string) => s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return rows.find(r => slugify(r.project_name) === slugify(slug)) ?? null
}

class MetaRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    el.setAttribute('content', this.value)
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Extract slug from the path · /project/<slug>[/anything]
  const url = new URL(ctx.request.url)
  const parts = url.pathname.split('/').filter(Boolean)   // ['project', '<slug>']
  if (parts[0] !== 'project' || !parts[1]) {
    // Not a /project/<slug> request — let the rest of the chain handle it.
    return ctx.next()
  }
  const slug = parts[1].replace(/\.html$/, '')

  // Pull the SPA HTML directly · raw fetch so errors are observable
  // (ctx.next() of a SPA-fallback path can be opaque on Pages).
  const indexUrl = new URL('/index.html', ctx.request.url).toString()
  const assetRes = await fetch(indexUrl)
  if (!assetRes.ok) {
    return new Response(`asset fetch failed: ${assetRes.status}`, { status: 500 })
  }

  let project: ResolvedProject | null = null
  try {
    project = await resolveSlug(ctx.env, slug)
  } catch {
    project = null
  }
  if (!project) {
    const passthrough = new Response(assetRes.body, assetRes)
    passthrough.headers.set('x-cs-og-rewrite', 'miss')
    return passthrough
  }

  const ogImageUrl  = `https://commit.show/og/project/${project.id}.png`
  const title       = `${project.project_name} · ${project.score_total ?? '—'}/100 · commit.show`
  const description = `${project.project_name} on commit.show. Audited by the engine, auditioned for Scouts. Score ${project.score_total ?? '—'}/100.`

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]',        new MetaRewriter(ogImageUrl))
    .on('meta[property="og:image:alt"]',    new MetaRewriter(title))
    .on('meta[name="twitter:image"]',       new MetaRewriter(ogImageUrl))
    .on('meta[property="og:title"]',        new MetaRewriter(title))
    .on('meta[name="twitter:title"]',       new MetaRewriter(title))
    .on('meta[property="og:description"]',  new MetaRewriter(description))
    .on('meta[name="twitter:description"]', new MetaRewriter(description))

  const transformed = rewriter.transform(assetRes)
  const out = new Response(transformed.body, transformed)
  out.headers.set('x-cs-og-rewrite',   'hit')
  out.headers.set('x-cs-og-project-id', project.id)
  return out
}
