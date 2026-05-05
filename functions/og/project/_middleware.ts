// /og/project/* middleware · per-project OG card PNG.
//
// Returns a 1200×630 PNG composed via satori (JSX→SVG) + resvg-wasm
// (SVG→PNG). Both libraries are imported from esm.sh CDN — Pages
// Functions support URL imports, and the npm install path tripped
// the bundler in earlier attempts (commit a181a60 reverted that).
//
// Using middleware (not [id].ts) for the same reason /project uses
// middleware: dynamic [param] functions race with the SPA fallback.

// @ts-ignore — esm.sh URL imports have no local TS types
import satori from 'https://esm.sh/satori@0.10.13?bundle'
// @ts-ignore
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2'

interface Env {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

interface ProjectCard {
  id:           string
  project_name: string
  score:        number | null
  band:         string
  encore_kind:  'production' | 'streak' | 'climb' | 'spotlight' | null
  encore_serial: number | null
}

const ENCORE_LABEL: Record<string, { label: string; symbol: string }> = {
  production: { label: 'Encore',    symbol: '★' },
  streak:     { label: 'Streak',    symbol: '⟳' },
  climb:      { label: 'Climb',     symbol: '↗' },
  spotlight:  { label: 'Spotlight', symbol: '✦' },
}

function bandLabel(score: number | null | undefined): string {
  if (score == null) return 'unrated'
  if (score >= 85) return 'encore'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'building'
  return 'early'
}

async function loadProject(env: Env, id: string): Promise<ProjectCard | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  if (!anonKey) return null

  const cols = 'id,project_name,score_total'
  const projRes = await fetch(`${url}/rest/v1/projects?id=eq.${id}&select=${cols}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!projRes.ok) return null
  const rows = await projRes.json() as Array<{ id: string; project_name: string; score_total: number | null }>
  if (rows.length === 0) return null
  const p = rows[0]

  const encRes = await fetch(`${url}/rest/v1/encores?project_id=eq.${id}&kind=eq.production&select=kind,serial`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  const encs = encRes.ok ? await encRes.json() as Array<{ kind: string; serial: number }> : []
  const enc  = encs[0] ?? null

  return {
    id:            p.id,
    project_name:  p.project_name,
    score:         p.score_total,
    band:          bandLabel(p.score_total),
    encore_kind:   enc ? (enc.kind as ProjectCard['encore_kind']) : null,
    encore_serial: enc?.serial ?? null,
  }
}

// Cached resources · function instance is reused across requests.
let wasmReady: Promise<void> | null = null
let displayFont: ArrayBuffer | null = null
let bodyFont:    ArrayBuffer | null = null

async function ensureWasm(): Promise<void> {
  if (wasmReady) return wasmReady
  // Fetch the wasm binary from esm.sh's static file route. Initializing
  // once per Function instance.
  wasmReady = (async () => {
    const wasmRes = await fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm')
    const buf = await wasmRes.arrayBuffer()
    await initWasm(buf)
  })()
  return wasmReady
}

async function loadFonts(origin: string): Promise<{ display: ArrayBuffer; body: ArrayBuffer }> {
  if (!displayFont) {
    const r = await fetch(`${origin}/fonts/PlayfairDisplay-Black.ttf`)
    displayFont = await r.arrayBuffer()
  }
  if (!bodyFont) {
    const r = await fetch(`${origin}/fonts/DMSans-Regular.ttf`)
    bodyFont = await r.arrayBuffer()
  }
  return { display: displayFont!, body: bodyFont! }
}

// JSX-shaped object factory. satori reads plain objects, no React runtime.
function el(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
}

function renderCard(p: ProjectCard): unknown {
  const score    = p.score ?? 0
  const isEncore = score >= 85
  const accent   = isEncore ? '#F0C040' : '#60A5FA'

  return el('div', {
    style: {
      width:  '1200px',
      height: '630px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: 'linear-gradient(135deg, #060C1A 0%, #0F2040 100%)',
      padding: '64px 72px',
      fontFamily: 'DM Sans',
      color: '#F8F5EE',
    },
  },
    el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' },
    },
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        el('span', {
          style: { fontFamily: 'Playfair Display', fontSize: '28px', color: '#F0C040', letterSpacing: '-0.5px' },
        }, 'commit.show'),
        el('span', {
          style: { fontSize: '14px', color: 'rgba(248,245,238,0.5)', letterSpacing: '3px', textTransform: 'uppercase' },
        }, 'audit · audition · encore'),
      ),
      p.encore_kind ? el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: 'rgba(240,192,64,0.12)',
          border: '2px solid rgba(240,192,64,0.55)',
          borderRadius: '4px',
        },
      },
        el('span', { style: { fontSize: '24px', color: '#F0C040' } }, ENCORE_LABEL[p.encore_kind].symbol),
        el('span', {
          style: { fontFamily: 'Playfair Display', fontSize: '22px', color: '#F0C040', letterSpacing: '2px', textTransform: 'uppercase' },
        }, `${ENCORE_LABEL[p.encore_kind].label}${p.encore_serial != null ? ` #${p.encore_serial}` : ''}`),
      ) : el('div', {}),
    ),

    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('span', {
        style: { fontFamily: 'Playfair Display', fontSize: '64px', color: '#F8F5EE', letterSpacing: '-1px', lineHeight: '1.05' },
      }, p.project_name),
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '20px' } },
        el('span', {
          style: { fontFamily: 'Playfair Display', fontSize: '160px', color: accent, lineHeight: '1', letterSpacing: '-4px' },
        }, p.score == null ? '—' : `${p.score}`),
        el('span', {
          style: { fontSize: '36px', color: 'rgba(248,245,238,0.4)', fontFamily: 'Playfair Display' },
        }, '/100'),
      ),
    ),

    el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid rgba(240,192,64,0.25)', paddingTop: '20px' },
    },
      el('span', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.6)', letterSpacing: '4px', textTransform: 'uppercase' },
      }, `band · ${p.band}`),
      el('span', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.45)' },
      }, `every commit, on stage`),
    ),
  )
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  // Match /og/project/<id>(.png) — anything else passes through.
  const m = url.pathname.match(/^\/og\/project\/([^\/]+?)(?:\.png)?\/?$/)
  if (!m) return ctx.next()
  const id = m[1]
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response('bad id', { status: 400 })
  }

  const card = await loadProject(ctx.env, id)
  if (!card) {
    return new Response('not found', { status: 404 })
  }

  try {
    await ensureWasm()
    const fonts = await loadFonts(`${url.protocol}//${url.host}`)

    const svg = await satori(renderCard(card), {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Playfair Display', data: fonts.display, weight: 900, style: 'normal' },
        { name: 'DM Sans',          data: fonts.body,    weight: 400, style: 'normal' },
      ],
    })

    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()

    return new Response(png, {
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'x-cs-og-source': 'satori',
      },
    })
  } catch (e) {
    // Fall back to the static og-image so X / LinkedIn don't get a 500.
    // The error reason rides as a header for diagnostics.
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://commit.show/og-image.png',
        'x-cs-og-source': 'fallback',
        'x-cs-og-error': String((e as Error).message ?? e).slice(0, 200),
      },
    })
  }
}
