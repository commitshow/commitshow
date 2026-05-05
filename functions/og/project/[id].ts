// Dynamic OG image · /og/project/<id>.png
//
// Cloudflare Pages Function · runs at the edge. Generates a 1200×630
// PNG card per project so X / LinkedIn / Discord unfurl shows the
// actual score + name + Encore badge instead of the generic
// /og-image.png that every share previously used.
//
// Pipeline:
//   1. Fetch project from Supabase REST (anon key · public columns
//      only). Cached at the edge for 5 min.
//   2. Build JSX → SVG via satori (fonts loaded from /fonts/).
//   3. Convert SVG → PNG via @resvg/resvg-wasm.
//   4. Return PNG with Cache-Control: 5 min.
//
// satori is React-flavored but doesn't need React itself · we hand it
// plain JSX-shaped objects.

import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
// Pages Functions support binary imports as ArrayBuffers via the
// `?wasm` import suffix. The @resvg/resvg-wasm bundle exposes its
// .wasm at the package's `./index_bg.wasm` subpath.
// @ts-ignore — wasm module import has no TS typing
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm'

// One-time wasm init guard. Pages Function instances are reused for
// many requests, so we initialize on first call and skip thereafter.
let wasmReady: Promise<void> | null = null
async function ensureWasm(): Promise<void> {
  if (wasmReady) return wasmReady
  wasmReady = (async () => { await initWasm(wasmModule as unknown as WebAssembly.Module) })()
  return wasmReady
}

// Cache for font bytes — fetched once per Function instance.
let displayFont: ArrayBuffer | null = null
let bodyFont:    ArrayBuffer | null = null
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

interface ProjectCard {
  project_name: string
  score:        number | null
  band:         string | null
  thumbnail:    string | null
  // Encore is optional — show only when present.
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

interface PagesEnv {
  SUPABASE_URL?:      string
  SUPABASE_ANON_KEY?: string
}

async function loadProject(env: PagesEnv, id: string): Promise<ProjectCard | null> {
  const url     = env.SUPABASE_URL      ?? 'https://tekemubwihsjdzittoqf.supabase.co'
  const anonKey = env.SUPABASE_ANON_KEY ?? ''
  // PUBLIC_PROJECT_COLUMNS subset — only what the card needs.
  const cols = 'id,project_name,score_total,thumbnail_url'
  const projRes = await fetch(`${url}/rest/v1/projects?id=eq.${id}&select=${cols}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!projRes.ok) return null
  const rows = await projRes.json() as Array<{ id: string; project_name: string; score_total: number | null; thumbnail_url: string | null }>
  if (rows.length === 0) return null
  const p = rows[0]

  // Encore (production-track only for the headline · others surface
  // as a sibling chip when we extend the card later).
  const encRes = await fetch(`${url}/rest/v1/encores?project_id=eq.${id}&kind=eq.production&select=kind,serial`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  const encs = encRes.ok ? await encRes.json() as Array<{ kind: string; serial: number }> : []
  const enc  = encs[0] ?? null

  return {
    project_name:  p.project_name,
    score:         p.score_total,
    band:          bandLabel(p.score_total),
    thumbnail:     p.thumbnail_url,
    encore_kind:   enc ? (enc.kind as ProjectCard['encore_kind']) : null,
    encore_serial: enc?.serial ?? null,
  }
}

// JSX element builder — satori reads plain objects shaped like JSX.
// We avoid the React JSX runtime since Pages Functions don't bundle
// React; a manual factory keeps the dependency surface tiny.
function el(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
}

function renderCard(p: ProjectCard): unknown {
  const score   = p.score ?? 0
  const isEncore = score >= 85
  const accent  = isEncore ? '#F0C040' : '#60A5FA'
  // Whole card · navy 950 background with subtle gold rule along the
  // bottom edge. Numbers + name dominate; band + Encore chip recede.
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
    // Top strip · brand + band tag.
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

    // Middle · the score is the headline.
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

    // Bottom · band tag + URL slug.
    el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid rgba(240,192,64,0.25)', paddingTop: '20px' },
    },
      el('span', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.6)', letterSpacing: '4px', textTransform: 'uppercase' },
      }, `band · ${p.band ?? '—'}`),
      el('span', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.45)' },
      }, `every commit, on stage`),
    ),
  )
}

export const onRequestGet: PagesFunction<PagesEnv> = async (ctx) => {
  const { id } = ctx.params as { id: string }
  // Strip a trailing `.png` if X happens to add it.
  const cleanId = (Array.isArray(id) ? id[0] : id).replace(/\.png$/, '')
  if (!/^[0-9a-f-]{8,40}$/i.test(cleanId)) {
    return new Response('bad id', { status: 400 })
  }

  const url    = new URL(ctx.request.url)
  const origin = `${url.protocol}//${url.host}`

  const [card] = await Promise.all([loadProject(ctx.env, cleanId)])
  if (!card) {
    return new Response('not found', { status: 404 })
  }

  await ensureWasm()
  const fonts = await loadFonts(origin)

  const svg = await satori(renderCard(card) as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Playfair Display', data: fonts.display, weight: 900, style: 'normal' },
      { name: 'DM Sans',          data: fonts.body,    weight: 400, style: 'normal' },
    ],
  })

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  }).render().asPng()

  return new Response(png, {
    headers: {
      'Content-Type':  'image/png',
      // Edge cache 5 min · share traffic spikes are bursty so 5 min
      // hits the sweet spot between freshness and origin load.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}
