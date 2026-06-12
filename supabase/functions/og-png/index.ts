// og-png · server-side SVG→PNG renderer for X / Twitter compatibility.
//
// X rejects SVG og:images, so we keep the SVG-first pipeline (Pages
// Function under /og/project/<id>?kind=tweet) and add this Deno Edge
// Function as the PNG layer on top. Flow:
//
//   1. Caller hits /functions/v1/og-png?id=<uuid>&kind=tweet
//   2. We fetch the SVG from the Pages Function (which already handles
//      DB lookup + variant dispatch)
//   3. resvg-wasm rasterizes to PNG
//   4. Return image/png with edge-cache headers
//
// Cache hits stay cheap · 5min edge cache + project page meta keeps
// twitter:image hot for the hour after a fresh audit lands.
//
// Why Supabase Edge Function (not Pages):
//   · Pages Function bundler broke last time we tried satori / resvg
//     (CLAUDE.md memory · 15-min stuck builds).
//   · Supabase's Deno runtime imports wasm via esm.sh without the
//     bundler getting in the way.

// @ts-nocheck — esm.sh URLs aren't typed; Deno just trusts the
// runtime resolution.
import { initWasm, Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Wasm init is one-shot per cold-start. Reuse the binary across
// requests within the same isolate.
let wasmReady: Promise<void> | null = null
async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const wasmRes = await fetch('https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm')
      if (!wasmRes.ok) throw new Error(`wasm fetch failed: ${wasmRes.status}`)
      const wasmBytes = await wasmRes.arrayBuffer()
      await initWasm(wasmBytes)
    })()
  }
  await wasmReady
}

// Bundled font · JetBrains Mono Regular (covers Box Drawing unicode
// block, which the ANSI Shadow score glyphs rely on). Cached once per
// isolate just like the wasm.
let fontBytesPromise: Promise<Uint8Array> | null = null
async function loadFont(): Promise<Uint8Array> {
  if (!fontBytesPromise) {
    fontBytesPromise = (async () => {
      // Stable URL · part of Google Fonts' open release.
      const url = 'https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`font fetch failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    })()
  }
  return fontBytesPromise
}

// ── report share card (kind=report&slug=…) — built inline (amber/cream Legit
// look) and rasterized with the same resvg + JetBrains Mono pipeline. One big
// stat + label + title + "according to legit.show", sized 1200×630 for X unfurl.
const SB_URL = Deno.env.get('SUPABASE_URL') ?? 'https://tekemubwihsjdzittoqf.supabase.co'
const SB_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function wrapText(text: string, max: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = ''
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur.trim()); cur = w } else cur += ' ' + w }
  if (cur.trim()) lines.push(cur.trim()); return lines
}
interface RepRow { title: string; coined_term: string | null; hero_stat: { value: number; unit?: string; label: string; n: number } | null; sample: { total: number; as_of: string } | null }
async function fetchReport(slug: string): Promise<RepRow | null> {
  if (!SB_KEY) return null
  const r = await fetch(`${SB_URL}/rest/v1/reports?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=title,coined_term,hero_stat,sample&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  if (!r.ok) return null
  return ((await r.json()) as RepRow[])[0] ?? null
}
function buildReportSvg(rep: RepRow): string {
  const hero = rep.hero_stat || { value: 0, label: '', n: 0 }
  const num = `${hero.value}${hero.unit || '%'}`
  const label = wrapText(hero.label || '', 32).slice(0, 3)
  const year = (rep.sample?.as_of || '').slice(0, 4) || '2026'
  const eyebrow = (rep.coined_term ? rep.coined_term.toUpperCase() + ' · ' : '') + 'LEGIT.SHOW DATA REPORT'
  const labelSvg = label.map((l, i) => `<text x="80" y="${430 + i * 50}" font-family="JetBrains Mono" font-size="38" fill="#2C261D">${xmlEsc(l)}</text>`).join('')
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#FAF7F0"/>
  <rect width="14" height="630" fill="#97600F"/>
  <text x="80" y="96" font-family="JetBrains Mono" font-size="26" font-weight="600" fill="#97600F" letter-spacing="2">${xmlEsc(eyebrow)}</text>
  <text x="76" y="320" font-family="JetBrains Mono" font-size="210" font-weight="700" fill="#211C15">${xmlEsc(num)}</text>
  ${labelSvg}
  <line x1="80" y1="556" x2="1120" y2="556" stroke="#E0D8C8" stroke-width="2"/>
  <text x="80" y="592" font-family="JetBrains Mono" font-size="24" fill="#6F6757">${xmlEsc(rep.title.slice(0, 52))}</text>
  <text x="1120" y="592" text-anchor="end" font-family="JetBrains Mono" font-size="22" fill="#9A9080">according to legit.show · ${year}</text>
</svg>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const id    = url.searchParams.get('id')   ?? ''
  const slug  = url.searchParams.get('slug') ?? ''
  const kind  = url.searchParams.get('kind') ?? 'tweet'
  const width = Number(url.searchParams.get('w') ?? '1200')

  let svgText: string

  if (kind === 'report') {
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) return new Response(JSON.stringify({ error: 'bad slug' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    const rep = await fetchReport(slug).catch(() => null)
    if (!rep) return new Response(JSON.stringify({ error: 'report not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
    svgText = buildReportSvg(rep)
    try { await ensureWasm() } catch (e) { return new Response(JSON.stringify({ error: 'wasm init failed', detail: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
    let fb: Uint8Array
    try { fb = await loadFont() } catch (e) { return new Response(JSON.stringify({ error: 'font load failed', detail: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
    try {
      const resvg = new Resvg(svgText, { font: { fontBuffers: [fb], loadSystemFonts: false, defaultFontFamily: 'JetBrains Mono' }, fitTo: { mode: 'width', value: width } })
      const rendered = resvg.render(); const png = rendered.asPng(); rendered.free(); resvg.free()
      return new Response(png, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300, s-maxage=300', 'x-cs-png-kind': 'report', 'x-cs-png-slug': slug } })
    } catch (e) { return new Response(JSON.stringify({ error: 'rasterize failed', detail: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
  }

  if (!/^[0-9a-f-]{8,40}$/i.test(id)) {
    return new Response(JSON.stringify({ error: 'bad id' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // 1. Fetch the SVG from the Pages Function. Forward an optional
  //    cache-bust query (`t`) through to the SVG URL so we don't get
  //    stuck on Cloudflare's edge-cached SVG when iterating on the
  //    card design.
  const cacheBust = url.searchParams.get('t')
  const svgUrl = cacheBust
    ? `https://commit.show/og/project/${id}?kind=${encodeURIComponent(kind)}&t=${encodeURIComponent(cacheBust)}`
    : `https://commit.show/og/project/${id}?kind=${encodeURIComponent(kind)}`
  try {
    const r = await fetch(svgUrl)
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'svg fetch failed', status: r.status }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    svgText = await r.text()
  } catch (e) {
    return new Response(JSON.stringify({ error: 'svg fetch threw', detail: (e as Error).message }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // 2. Init wasm + load font (both cached per isolate).
  try {
    await ensureWasm()
  } catch (e) {
    return new Response(JSON.stringify({ error: 'wasm init failed', detail: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let fontBytes: Uint8Array
  try {
    fontBytes = await loadFont()
  } catch (e) {
    return new Response(JSON.stringify({ error: 'font load failed', detail: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // 3. Rasterize.
  let pngBytes: Uint8Array
  try {
    const resvg = new Resvg(svgText, {
      font: {
        fontBuffers:        [fontBytes],
        loadSystemFonts:    false,                // determinism · no system fallback
        defaultFontFamily:  'JetBrains Mono',     // fallback when family lookup fails
      },
      fitTo: { mode: 'width', value: width },
    })
    const rendered = resvg.render()
    pngBytes = rendered.asPng()
    rendered.free()
    resvg.free()
  } catch (e) {
    return new Response(JSON.stringify({ error: 'rasterize failed', detail: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(pngBytes, {
    headers: {
      ...CORS,
      'Content-Type':       'image/png',
      'Cache-Control':      'public, max-age=300, s-maxage=300',
      'x-cs-png-source':    'resvg-wasm',
      'x-cs-png-project':   id,
      'x-cs-png-kind':      kind,
      'x-cs-png-width':     String(width),
    },
  })
})
