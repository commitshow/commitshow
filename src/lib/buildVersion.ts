// buildVersion — long-lived SPA tab update detection · 2026-05-15.
//
// The build emits /version.json containing { build_id } where build_id is
// either the git commit hash (CI builds) or a millisecond timestamp
// (local builds). The bundled BUILD_ID constant is injected at build
// time via Vite `define`. At runtime we periodically fetch /version.json
// and compare to BUILD_ID — when they diverge a new deploy has shipped
// while this tab was open, and we surface a non-intrusive toast asking
// the user if they want to reload.
//
// Polling cadence:
//   · every 15 min while the tab is visible
//   · once when the tab regains visibility after being hidden
//   · once on user-triggered focus events (cheap belt-and-suspenders)
//
// /version.json is served with no-cache (see public/_headers · same
// rules as index.html) so the fetch always hits Cloudflare with a
// MISS-or-revalidate path · we don't read a stale cached copy.

import { useEffect, useState } from 'react'

// Vite `define` rewrites the bare identifier `__COMMITSHOW_BUILD_ID__`
// to a string literal at build time. The declaration lives in
// src/env.d.ts so tsc knows the type. In dev (vite serve), define
// still substitutes the value · for `npm test` or other environments
// without the Vite plugin, the typeof-guard falls back to 'dev' so
// the comparison loop stays quiet.
const BUILD_ID: string =
  typeof __COMMITSHOW_BUILD_ID__ === 'string' ? __COMMITSHOW_BUILD_ID__ : 'dev'

const POLL_MS = 15 * 60 * 1000  // 15 minutes
const FETCH_TIMEOUT_MS = 4000

interface VersionPayload {
  build_id: string
}

async function fetchServerVersion(): Promise<string | null> {
  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res   = await fetch(`/version.json?_=${Date.now()}`, {
      signal: ctrl.signal,
      cache:  'no-store',
      headers: { accept: 'application/json' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const body = await res.json() as VersionPayload
    return typeof body.build_id === 'string' && body.build_id.length > 0
      ? body.build_id
      : null
  } catch {
    // Network blip / offline · don't bother surfacing · next poll will
    // either land or stay quiet. We DON'T want a false-positive update
    // toast from a transient fetch failure.
    return null
  }
}

/** Returns `true` once the server has shipped a build different from
 *  the one this tab booted with. Polls every 15 min while visible, plus
 *  once whenever visibility flips back to visible (catches the "I left
 *  this tab open overnight" case immediately on focus).
 *
 *  Never flips back to `false` once true — the SPA can't go BACKWARD
 *  to the old build, and clearing the flag would let the toast bounce
 *  in and out if the user dismissed it. */
export function useUpdateAvailable(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (BUILD_ID === 'dev') return  // local dev · no version.json deployed
    let alive = true
    let timer: number | null = null

    const check = async () => {
      const server = await fetchServerVersion()
      if (!alive || !server) return
      if (server !== BUILD_ID) setUpdateAvailable(true)
    }

    // Initial check fires almost immediately so a user who lands on
    // /products with an outdated tab gets the toast within 5s.
    const initial = window.setTimeout(check, 5000)

    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      window.clearTimeout(initial)
      if (timer != null) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return updateAvailable
}

export function reloadForNewVersion(): void {
  const url = new URL(window.location.href)
  url.searchParams.set('_v', String(Date.now()))
  window.location.replace(url.toString())
}
