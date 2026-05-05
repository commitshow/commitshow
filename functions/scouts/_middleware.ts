// /scouts/<id> middleware · SSR-light wrapper for scout pages.
// Swaps og:image / og:title / og:description meta on the SPA HTML
// so social crawlers carry the scout's data into the unfurl card.
//
// Pairs with /og/scouts/<id> SVG (functions/og/scouts/_middleware.ts).
//
// Why _middleware.ts (not [id].ts):
//   The Pages dynamic [param] convention silently races with the SPA
//   fallback · middleware always wins.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ResolvedScout {
  id:           string
  display_name: string
  tier:         string
}

async function loadScout(env: Env, id: string): Promise<ResolvedScout | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null
  const res = await fetch(`${url}/rest/v1/members?id=eq.${id}&select=id,display_name,tier`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string; display_name: string | null; tier: string | null }>
  if (rows.length === 0) return null
  return {
    id:           rows[0].id,
    display_name: rows[0].display_name ?? 'Scout',
    tier:         rows[0].tier ?? 'Bronze',
  }
}

class MetaRewriter {
  constructor(private value: string) {}
  element(el: Element): void {
    el.setAttribute('content', this.value)
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url   = new URL(ctx.request.url)
  const parts = url.pathname.split('/').filter(Boolean)   // ['scouts', '<id>']
  if (parts[0] !== 'scouts' || !parts[1]) return ctx.next()
  const id = parts[1]

  // Only resolve canonical UUIDs · everything else (handle, leaderboard
  // etc.) passes through to the SPA without an extra Supabase query.
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) return ctx.next()

  // Pull the SPA HTML.
  const indexUrl = new URL('/index.html', ctx.request.url).toString()
  const assetRes = await fetch(indexUrl)
  if (!assetRes.ok) {
    return new Response(`asset fetch failed: ${assetRes.status}`, { status: 500 })
  }

  let scout: ResolvedScout | null = null
  try {
    scout = await loadScout(ctx.env, id)
  } catch {
    scout = null
  }
  if (!scout) {
    const passthrough = new Response(assetRes.body, assetRes)
    passthrough.headers.set('x-cs-og-rewrite', 'miss')
    return passthrough
  }

  // og:image points at the dynamic SVG endpoint. twitter:image
  // stays static (X rejects SVG og:image).
  const ogImageUrl  = `https://commit.show/og/scouts/${scout.id}`
  const title       = `${scout.display_name} · ${scout.tier} Scout · commit.show`
  const description = `${scout.display_name} (${scout.tier} Scout) on commit.show. Forecasts · applauds · spotter hits.`

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]',        new MetaRewriter(ogImageUrl))
    .on('meta[property="og:image:alt"]',    new MetaRewriter(title))
    .on('meta[property="og:title"]',        new MetaRewriter(title))
    .on('meta[name="twitter:title"]',       new MetaRewriter(title))
    .on('meta[property="og:description"]',  new MetaRewriter(description))
    .on('meta[name="twitter:description"]', new MetaRewriter(description))

  const transformed = rewriter.transform(assetRes)
  const out = new Response(transformed.body, transformed)
  out.headers.set('x-cs-og-rewrite',  'hit')
  out.headers.set('x-cs-og-scout-id', scout.id)
  return out
}
