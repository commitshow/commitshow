// /project/<slug> · SSR-light wrapper.
// Resolves slug to a project, then patches the SPA HTML's og:image
// + twitter:image meta tags so X / LinkedIn unfurl per-project
// instead of using the generic /og-image.png.

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
  if (!anonKey) return null   // can't query without key
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

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { slug } = ctx.params as { slug: string }
  const cleanSlug = (Array.isArray(slug) ? slug[0] : slug).replace(/\.html$/, '')

  // 1. Pull the SPA HTML directly via fetch · ctx.next() ALSO works
  //    on Pages but errors are silent · raw fetch gives us better
  //    control + diagnostics if something goes wrong.
  const indexUrl = new URL('/index.html', ctx.request.url).toString()
  const assetRes = await fetch(indexUrl)
  if (!assetRes.ok) {
    return new Response(`asset fetch failed: ${assetRes.status}`, { status: 500 })
  }

  // 2. Resolve slug. On miss, return the asset unchanged · the SPA
  //    will handle 'not found' client-side.
  let project: ResolvedProject | null = null
  try {
    project = await resolveSlug(ctx.env, cleanSlug)
  } catch {
    project = null
  }
  if (!project) {
    // Sentinel header so we can tell from curl that the function ran.
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
