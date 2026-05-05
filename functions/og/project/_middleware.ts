// /og/project/* · per-project OG card PNG via @vercel/og.
//
// @vercel/og is a Vercel-maintained edge-friendly wrapper around
// satori (JSX→SVG) + resvg-wasm (SVG→PNG). It exposes the
// `workerd` export condition that matches Cloudflare Pages
// Functions exactly and bundles its own wasm + a default font.
//
// Earlier attempts to wire satori + @resvg/resvg-wasm directly
// broke the Pages bundler (npm install path) or threw at deploy
// (esm.sh URL imports). @vercel/og works around both because it
// ships pre-bundled assets + has explicit workerd support.
//
// Why _middleware.ts (not [id].ts):
//   The dynamic [param] convention races with the SPA fallback on
//   Pages and the function never gets called. Middleware always
//   runs first.

import { ImageResponse } from '@vercel/og'

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

// JSX-shaped element factory — satori (and ImageResponse) accept plain
// nodes shaped this way without needing a JSX runtime.
function el(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }
}

function card(p: ProjectCard): unknown {
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
      color: '#F8F5EE',
    },
  },
    // Top strip · brand + Encore chip
    el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' },
    },
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        el('div', {
          style: { fontSize: '32px', color: '#F0C040', letterSpacing: '-0.5px' },
        }, 'commit.show'),
        el('div', {
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
        el('div', { style: { fontSize: '24px', color: '#F0C040' } }, ENCORE_LABEL[p.encore_kind].symbol),
        el('div', {
          style: { fontSize: '22px', color: '#F0C040', letterSpacing: '2px', textTransform: 'uppercase' },
        }, `${ENCORE_LABEL[p.encore_kind].label}${p.encore_serial != null ? ` #${p.encore_serial}` : ''}`),
      ) : el('div', { style: { display: 'flex' } }),
    ),

    // Center · headline
    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('div', {
        style: { fontSize: '64px', color: '#F8F5EE', letterSpacing: '-1px', lineHeight: '1.05' },
      }, p.project_name),
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '20px' } },
        el('div', {
          style: { fontSize: '180px', color: accent, lineHeight: '1', letterSpacing: '-4px' },
        }, p.score == null ? '—' : `${p.score}`),
        el('div', {
          style: { fontSize: '40px', color: 'rgba(248,245,238,0.4)' },
        }, '/100'),
      ),
    ),

    // Bottom · band + tagline
    el('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        borderTop: '1px solid rgba(240,192,64,0.25)',
        paddingTop: '20px',
      },
    },
      el('div', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.6)', letterSpacing: '4px', textTransform: 'uppercase' },
      }, `band · ${p.band}`),
      el('div', {
        style: { fontSize: '20px', color: 'rgba(248,245,238,0.45)' },
      }, 'every commit, on stage'),
    ),
  )
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const m   = url.pathname.match(/^\/og\/project\/([^\/]+?)(?:\.png)?\/?$/)
  if (!m) return ctx.next()
  const id = m[1]
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response('bad id', { status: 400 })
  }

  const proj = await loadProject(ctx.env, id)
  if (!proj) return new Response('not found', { status: 404 })

  try {
    return new ImageResponse(card(proj) as any, {
      width:  1200,
      height: 630,
      headers: {
        'Cache-Control':  'public, max-age=300, s-maxage=300',
        'x-cs-og-source': 'vercel-og',
      },
    })
  } catch (e) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://commit.show/og-image.png',
        'x-cs-og-source': 'fallback',
        'x-cs-og-error':  String((e as Error).message ?? e).slice(0, 200),
      },
    })
  }
}
