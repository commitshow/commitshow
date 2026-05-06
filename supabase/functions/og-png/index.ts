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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const id    = url.searchParams.get('id')   ?? ''
  const kind  = url.searchParams.get('kind') ?? 'tweet'
  const width = Number(url.searchParams.get('w') ?? '1200')

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
  let svgText: string
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
