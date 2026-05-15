// lazyWithReload — defensive React.lazy wrapper · 2026-05-15.
//
// commit.show is a long-lived SPA · users keep the tab open across deploys,
// and client-side routing never re-fetches index.html. Their in-memory
// bundle points at hashed chunk paths (e.g. CommunityLayout-Bar24oGn.js)
// that don't exist on the server after we ship a new build — every chunk
// gets a fresh content-hash. The first dynamic `import()` that tries to
// fetch the old chunk gets a 404 / network error → React throws → the
// page goes white.
//
// This helper wraps React.lazy + catches the import failure once + does a
// single-shot full-page reload. The reload bypasses bfcache via `?_v=<ts>`
// query bust on a sentinel sessionStorage flag so we don't loop reload-
// reload-reload if the actual chunk-load failure is the user's network.
//
// Why session-flag instead of always-reload-on-error: legitimate flaky
// network would otherwise reload until the user can fetch the chunk,
// which is a worse UX than showing the React error boundary once. After
// one auto-reload we trust the user to manually retry if it still fails.

import { lazy } from 'react'
import type { ComponentType } from 'react'

// 2026-05-15 · backoff-tracked retries instead of one-shot.
// First version used a single sessionStorage flag · once flipped, every
// subsequent chunk failure propagated. Real symptom: a user with a stale
// tab where the chunk graph references a deleted main bundle hits
// failure → reload → still on same in-memory bundle (lazy lib loaded
// once at app boot) → fails again → propagates. The lib needs to retry
// a couple of times so the browser actually picks up the fresh
// index.html on one of the attempts.
//
// New strategy: track reload TIMESTAMPS in sessionStorage. Allow up to 3
// reloads in a session, with at least 8 seconds between attempts (avoids
// a tight loop if Cloudflare is genuinely down). After 3 attempts the
// error propagates so the ErrorBoundary takes over.
const RELOAD_LOG_KEY = 'cs:chunk-reload-log'
const MAX_RELOADS    = 3
const MIN_GAP_MS     = 8_000

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: unknown; name?: unknown }
  const msg  = typeof e.message === 'string' ? e.message : ''
  const name = typeof e.name    === 'string' ? e.name    : ''
  // Chrome: "Failed to fetch dynamically imported module"
  // Firefox: "error loading dynamically imported module"
  // Safari: "Importing a module script failed."
  // Generic chunk errors also include "Loading chunk N failed"
  return (
    /failed to fetch dynamically imported module/i.test(msg) ||
    /loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /loading chunk \d+ failed/i.test(msg) ||
    name === 'ChunkLoadError'
  )
}

function loadReloadLog(): number[] {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_LOG_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'number') : []
  } catch { return [] }
}

function saveReloadLog(log: number[]): void {
  try { window.sessionStorage.setItem(RELOAD_LOG_KEY, JSON.stringify(log)) } catch { /* private mode */ }
}

/** Decide whether the chunk-load failure can trigger another reload.
 *  Three limits stack: max attempts in session · min gap between
 *  attempts · session boundary (closing the tab resets). */
function canReloadNow(): boolean {
  const log = loadReloadLog()
  if (log.length >= MAX_RELOADS) return false
  const last = log[log.length - 1] ?? 0
  if (Date.now() - last < MIN_GAP_MS) return false
  return true
}

function recordReload(): void {
  const log = loadReloadLog()
  log.push(Date.now())
  saveReloadLog(log)
}

/** Drop-in React.lazy replacement that auto-reloads on chunk-load failure.
 *
 *  Usage stays identical:
 *      const Page = lazyWithReload(() => import('./pages/Page').then(m => ({ default: m.Page })))
 *
 *  Behavior:
 *   · success         → the imported component renders as usual
 *   · chunk 404 once  → auto-reload the page with a cache-bust query
 *   · chunk 404 twice → let the error propagate (React error boundary
 *                       takes over) so we don't loop on a real network
 *                       failure */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (!isChunkLoadError(err)) throw err
      if (!canReloadNow()) throw err
      recordReload()
      // bfcache + service worker + CDN can all serve the stale shell ·
      // adding a cache-buster query forces a real network hit. The
      // `_v=<timestamp>` is parsed only by us (Cloudflare ignores it).
      const url = new URL(window.location.href)
      url.searchParams.set('_v', String(Date.now()))
      window.location.replace(url.toString())
      // Return a promise that never resolves so React stops trying to
      // render until the reload completes.
      return new Promise<{ default: T }>(() => {})
    }),
  )
}
