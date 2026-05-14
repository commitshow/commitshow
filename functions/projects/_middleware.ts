// /projects/<uuid> middleware · SSR-light wrapper.
//
// Mirror of /project/<slug>/_middleware.ts but keyed by UUID. The
// React app's canonical project URL is `/projects/<uuid>` (plural,
// id-based) — that's the URL users actually share to X / LinkedIn /
// Discord, so we need the per-project og:image + twitter:image meta
// to land here. The singular `/project/<slug>` route stays around
// for SEO-friendly slug links and uses its own slug lookup.
//
// Patches that match the slug variant byte-for-byte:
//   · og:image    → dynamic SVG (commit.show/og/project/<id>) — Discord/Slack/LinkedIn
//   · twitter:image → dynamic PNG (Supabase Edge Function og-png · resvg-wasm)
//   · og:title / twitter:title / og:description / twitter:description

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ResolvedProject {
  id:           string
  project_name: string
  score_total:  number | null
  status:       string | null
}

// §1-A ⑥ public-meta band gate · same rule as the OG image card · only
// reveal the raw digit in og:title / og:description when score >= 85 AND
// status != 'preview'. Below that, surface "band · STRONG" copy so the
// shame trigger (a 67/100 in the social unfurl) goes away. The number
// stays in the project page itself for the creator.
function bandFor(score: number | null | undefined): string {
  if (score == null) return 'unrated'
  if (score >= 85) return 'encore'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'building'
  return 'early'
}
function publicScoreText(score: number | null | undefined, status: string | null | undefined): string {
  return ((score ?? 0) >= 85 && status !== 'preview')
    ? `${score}/100`
    : `band · ${bandFor(score).toUpperCase()}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveById(env: Env, id: string): Promise<ResolvedProject | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null
  const cols = 'id,project_name,score_total,status'
  const res  = await fetch(
    `${url}/rest/v1/projects?id=eq.${id}&select=${cols}&limit=1`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return null
  const rows = await res.json() as ResolvedProject[]
  return rows[0] ?? null
}

class MetaRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    el.setAttribute('content', this.value)
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url   = new URL(ctx.request.url)
  const parts = url.pathname.split('/').filter(Boolean)   // ['projects', '<id>']
  if (parts[0] !== 'projects' || !parts[1]) {
    return ctx.next()
  }
  const id = parts[1].replace(/\.html$/, '')
  if (!UUID_RE.test(id)) {
    // Non-UUID path · let the SPA / 404 handler take it.
    return ctx.next()
  }

  // Fetch the SPA HTML directly so the rewriter has a body to chew on
  // (ctx.next() can fall through opaquely on Pages).
  const indexUrl = new URL('/index.html', ctx.request.url).toString()
  const assetRes = await fetch(indexUrl)
  if (!assetRes.ok) {
    return new Response(`asset fetch failed: ${assetRes.status}`, { status: 500 })
  }

  let project: ResolvedProject | null = null
  try {
    project = await resolveById(ctx.env, id)
  } catch {
    project = null
  }
  if (!project) {
    const passthrough = new Response(assetRes.body, assetRes)
    passthrough.headers.set('x-cs-og-rewrite', 'miss')
    return passthrough
  }

  // Variant routing · ?og=encore | ?og=milestone | ?og=tweet | ?og=trajectory, default 'audit'
  const ogParam   = url.searchParams.get('og')
  const ogKind    = ogParam === 'encore' || ogParam === 'milestone' || ogParam === 'tweet' || ogParam === 'trajectory' ? ogParam : 'audit'
  const milestone = url.searchParams.get('milestone') ?? ''
  const ogQuery   = ogKind === 'audit'
    ? ''
    : ogKind === 'milestone'
      ? `?kind=milestone${milestone ? `&label=${encodeURIComponent(milestone)}` : ''}`
      : `?kind=${ogKind}`
  const ogImageUrl  = `https://commit.show/og/project/${project.id}${ogQuery}`
  // X-facing PNG · default to tweet variant; explicit ?og= overrides.
  const twitterKind = ogKind === 'audit' ? 'tweet' : ogKind
  const twitterPngUrl =
    `https://tekemubwihsjdzittoqf.supabase.co/functions/v1/og-png?id=${project.id}&kind=${encodeURIComponent(twitterKind)}`
  const scoreText   = publicScoreText(project.score_total, project.status)
  const title       = `${project.project_name} · ${scoreText} · commit.show`
  const description = `${project.project_name} on commit.show. Audited by the engine, auditioned for Scouts. ${scoreText}.`

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]',        new MetaRewriter(ogImageUrl))
    .on('meta[property="og:image:alt"]',    new MetaRewriter(title))
    .on('meta[name="twitter:image"]',       new MetaRewriter(twitterPngUrl))
    .on('meta[name="twitter:image:alt"]',   new MetaRewriter(title))
    .on('meta[property="og:title"]',        new MetaRewriter(title))
    .on('meta[name="twitter:title"]',       new MetaRewriter(title))
    .on('meta[property="og:description"]',  new MetaRewriter(description))
    .on('meta[name="twitter:description"]', new MetaRewriter(description))

  const transformed = rewriter.transform(assetRes)
  const out = new Response(transformed.body, transformed)
  out.headers.set('x-cs-og-rewrite',    'hit')
  out.headers.set('x-cs-og-project-id', project.id)
  out.headers.set('x-cs-og-kind',       ogKind)
  return out
}
