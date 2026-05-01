// Worker entry · all requests come through this script.
//
// We deploy via Workers Static Assets (wrangler.jsonc · assets binding
// 'ASSETS'). The default behavior is "look up <path> in /dist, fall back
// to /index.html for SPA routing". This entry adds API routes that need
// to run server-side BEFORE the asset lookup — without it, /api/* would
// be SPA-fallback'd to index.html and the agent gets HTML instead of
// the audit response.
//
// Routes:
//   /api/audit?repo=…  → src/api/audit.ts
//   everything else    → env.ASSETS.fetch(request)  (static + SPA fallback)

import { handleAudit, type AuditEnv } from './api/audit'
import { handleOpenAPI } from './api/openapi'

interface Env extends AuditEnv {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/audit' || url.pathname.startsWith('/api/audit/')) {
      return handleAudit(request, env)
    }
    if (url.pathname === '/api/openapi.json' || url.pathname === '/api/openapi') {
      return handleOpenAPI(request)
    }
    return env.ASSETS.fetch(request)
  },
}
