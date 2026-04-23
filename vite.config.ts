import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// @cloudflare/vite-plugin handles Workers Static Assets deployment config
// (SPA fallback via wrangler.jsonc's `not_found_handling`). Having the
// plugin declared here stops Wrangler's deploy-time framework auto-setup
// from running (the one that was injecting a `/* /index.html 200` redirect
// and then failing its own loop validation).
export default defineConfig({
  plugins: [react(), cloudflare()],
})
