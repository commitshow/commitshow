import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Build-time version stamp · 2026-05-15. Long-lived SPA tabs need to
// know when a new build has shipped so we can prompt a reload. We
// resolve a BUILD_ID at build start (git short SHA, fall back to ms
// timestamp) and:
//   1. inject it as the global `__COMMITSHOW_BUILD_ID__` constant via
//      Vite's `define` so client code can compare against it at runtime
//   2. emit `/version.json` into the output so the runtime poll can
//      fetch the latest server build_id and detect divergence
function resolveBuildId(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || `t${Date.now()}`
  } catch {
    return `t${Date.now()}`
  }
}

function emitVersionJson(buildId: string): PluginOption {
  return {
    name: 'commitshow-version-json',
    apply: 'build',
    closeBundle() {
      // Vite outDir defaults to 'dist'. We hand-roll the write rather
      // than use emitFile because we also want a copy on the local
      // dev/preview path (`public/`) so `vite preview` can serve it.
      const payload = JSON.stringify({ build_id: buildId, built_at: new Date().toISOString() }, null, 2) + '\n'
      const outDir = resolve(process.cwd(), 'dist')
      try {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(resolve(outDir, 'version.json'), payload, 'utf8')
      } catch (err) {
        // Build doesn't fail · /version.json missing just means the
        // update toast never fires. Worse but not catastrophic.
        console.warn('[commitshow-version-json] could not write version.json', err)
      }
    },
  }
}

const BUILD_ID = resolveBuildId()

// @cloudflare/vite-plugin handles Workers Static Assets deployment config
// (SPA fallback via wrangler.jsonc's `not_found_handling`). Having the
// plugin declared here stops Wrangler's deploy-time framework auto-setup
// from running (the one that was injecting a `/* /index.html 200` redirect
// and then failing its own loop validation).
export default defineConfig({
  plugins: [react(), cloudflare(), emitVersionJson(BUILD_ID)],
  define: {
    __COMMITSHOW_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    rollupOptions: {
      output: {
        // 2026-05-15 · prefix every chunk + entry with the BUILD_ID so
        // hashes change on every build even when source content didn't.
        // Why: rolldown/Vite default content-hashing means an unchanged
        // chunk keeps the same hash across deploys (e.g. `xyz.js` →
        // `xyz.js` next build). If at ANY point Cloudflare's edge or a
        // user's browser cached an HTML SPA-fallback response for
        // `/assets/xyz.js` (Pages deploy race, asset not yet uploaded),
        // the immutable cache headers freeze that bad response for a
        // year on every device that hit the bad window. Forcing a new
        // file name every build sidesteps the cache entirely · the
        // user's tab pulls the new index.html and gets fresh URLs that
        // have never been cached as HTML.
        //
        // Cost: every deploy invalidates the CDN/browser cache for
        // every chunk. We trade 2-3 MB extra cold-fetch per deploy for
        // a sticky-cache class of bug that's otherwise unfixable. With
        // 30-day version retention on Pages, returning users still get
        // hash-matched cache hits within the same build's lifetime.
        entryFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        chunkFileNames: `assets/[name]-${BUILD_ID}-[hash].js`,
        assetFileNames: `assets/[name]-${BUILD_ID}-[hash][extname]`,
      },
    },
  },
})
