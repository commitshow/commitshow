// /sitemap.xml · dynamic sitemap (2026-05-16).
//
// Replaces the static public/sitemap.xml that only listed section
// roots. Pages Functions intercept the path before the static asset
// router, so we keep the static file as a deploy-time safety net but
// this Function is the live source of truth.
//
// What it emits:
//   1. Section roots (homepage, /submit, /products, …) · always present
//   2. /community/<segment>/<id> for every published community_posts row
//   3. /projects/<id> for every project visible in the public ladder
//      (status in 'active'/'graduated'/'valedictorian'/'retry'/'preview')
//
// <lastmod> is computed from published_at (posts) / last_analysis_at
// (projects) so Googlebot knows when to recrawl. <changefreq> +
// <priority> are advisory · Google mostly ignores them but Bing /
// other engines still weight them.
//
// Fallback: if Supabase fetch fails we emit the section-only set so
// Googlebot still sees the canonical surfaces · better than a 500.

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface PostRow {
  id:           string
  type:         'build_log' | 'stack' | 'ask' | 'office_hours' | 'open_mic'
  published_at: string | null
}

interface ProjectRow {
  id:               string
  last_analysis_at: string | null
  updated_at:       string | null
}

const TYPE_TO_SEGMENT: Record<PostRow['type'], string> = {
  build_log:    'build-logs',
  stack:        'stacks',
  ask:          'asks',
  office_hours: 'office-hours',
  open_mic:     'open-mic',
}

// Section URLs · always emit. Mirror of the previous static sitemap
// with /community/open-mic added (was missing) and /me /ladder added
// for completeness. Routes the SPA doesn't expose externally (e.g.
// /admin, /backstage owner pages) stay out.
const SECTION_URLS: Array<{ loc: string; changefreq: string; priority: string }> = [
  { loc: '/',                       changefreq: 'daily',   priority: '1.0' },
  { loc: '/submit',                 changefreq: 'weekly',  priority: '0.9' },
  { loc: '/products',               changefreq: 'daily',   priority: '0.9' },
  { loc: '/projects',               changefreq: 'daily',   priority: '0.9' },
  { loc: '/ladder',                 changefreq: 'daily',   priority: '0.8' },
  { loc: '/leaderboard',            changefreq: 'daily',   priority: '0.7' },
  { loc: '/map',                    changefreq: 'daily',   priority: '0.7' },
  { loc: '/tokens',                 changefreq: 'daily',   priority: '0.7' },
  { loc: '/scouts',                 changefreq: 'daily',   priority: '0.7' },
  { loc: '/creators',               changefreq: 'daily',   priority: '0.7' },
  { loc: '/library',                changefreq: 'daily',   priority: '0.8' },
  { loc: '/community',              changefreq: 'daily',   priority: '0.8' },
  { loc: '/community/open-mic',     changefreq: 'daily',   priority: '0.7' },
  { loc: '/community/build-logs',   changefreq: 'daily',   priority: '0.7' },
  { loc: '/community/stacks',       changefreq: 'daily',   priority: '0.7' },
  { loc: '/community/asks',         changefreq: 'daily',   priority: '0.6' },
  { loc: '/community/office-hours', changefreq: 'weekly',  priority: '0.6' },
  { loc: '/rulebook',               changefreq: 'monthly', priority: '0.7' },
  { loc: '/backstage',              changefreq: 'monthly', priority: '0.6' },
  { loc: '/audit',                  changefreq: 'monthly', priority: '0.7' },
  { loc: '/privacy',                changefreq: 'yearly',  priority: '0.3' },
  { loc: '/terms',                  changefreq: 'yearly',  priority: '0.3' },
]

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function urlEntry(loc: string, lastmod: string | null, changefreq: string, priority: string): string {
  const parts = [
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
  ].filter(Boolean).join('\n')
  return `  <url>\n${parts}\n  </url>`
}

async function fetchPosts(env: Env): Promise<PostRow[]> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return []
  // Limit 10000 · enough for V1, sub-50k Google sitemap budget. If
  // community grows past that we'll split into sitemap-community-1.xml
  // etc. via a sitemap index.
  const res = await fetch(
    `${url}/rest/v1/community_posts?select=id,type,published_at&status=in.(published,resolved,expired)&order=published_at.desc&limit=10000`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return []
  return await res.json() as PostRow[]
}

async function fetchProjects(env: Env): Promise<ProjectRow[]> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return []
  // 'preview' status = CLI walk-on / URL fast-lane row (anonymous,
  // creator_id null) · we still list them because they ARE crawlable
  // public pages with audit findings. 'backstage' is owner-only RLS-
  // gated · excluded · would 404 for Googlebot anyway.
  const res = await fetch(
    `${url}/rest/v1/projects?select=id,last_analysis_at,updated_at&status=in.(active,graduated,valedictorian,retry,preview)&order=last_analysis_at.desc.nullslast&limit=10000`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) return []
  return await res.json() as ProjectRow[]
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const base = 'https://commit.show'

  const sections = SECTION_URLS
    .map(s => urlEntry(`${base}${s.loc}`, null, s.changefreq, s.priority))
    .join('\n')

  // Both fetches in parallel · keep the latency budget tight (sitemap
  // is hit by Googlebot fleet, not humans, but still don't want it
  // serializing two RTs to Supabase).
  let postsXml    = ''
  let projectsXml = ''
  try {
    const [posts, projects] = await Promise.all([
      fetchPosts(ctx.env),
      fetchProjects(ctx.env),
    ])

    postsXml = posts
      .map(p => {
        const segment = TYPE_TO_SEGMENT[p.type]
        if (!segment) return ''
        const loc     = `${base}/community/${segment}/${p.id}`
        const lastmod = p.published_at
        return urlEntry(loc, lastmod, 'weekly', '0.6')
      })
      .filter(Boolean)
      .join('\n')

    projectsXml = projects
      .map(p => {
        const loc     = `${base}/projects/${p.id}`
        const lastmod = p.last_analysis_at ?? p.updated_at
        return urlEntry(loc, lastmod, 'weekly', '0.7')
      })
      .join('\n')
  } catch {
    // Supabase down · serve the section-only sitemap. Googlebot will
    // still get the canonical surfaces and re-crawl posts via internal
    // links from the feed pages.
  }

  const body =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sections}${postsXml ? '\n' + postsXml : ''}${projectsXml ? '\n' + projectsXml : ''}
</urlset>
`

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type':  'application/xml; charset=utf-8',
      // 10-min edge cache · sitemap doesn't need to be realtime ·
      // Googlebot fleet re-fetches multiple times per day and we want
      // those to hit CDN, not Supabase.
      'Cache-Control': 'public, max-age=600, s-maxage=600',
      'X-Robots-Tag':  'all',
    },
  })
}
