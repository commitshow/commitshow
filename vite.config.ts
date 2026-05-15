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
})
