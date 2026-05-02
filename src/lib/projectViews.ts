// Project view tracking · client-side helper for the record_project_view RPC.
// The DB function (supabase/migrations/20260502_project_views.sql) handles
// dedupe at read time, so this helper only has to (1) emit a stable session
// hash so returning-visitor stats work, (2) suppress trivial double-fires
// from React StrictMode / hot remounts within the same tab.
//
// Privacy posture: we never send the raw localStorage session id. We hash
// it to SHA-256 hex client-side, so the value persisted server-side cannot
// be correlated back to anything else stored in the browser.

import { supabase } from './supabase'

const SESSION_KEY = 'commitshow.session_id'

function ensureRawSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = (typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // Storage blocked (Safari private mode, etc.) — fall back to an in-memory
    // id that lasts for the current page; returning-visitor stats won't
    // resolve, but the single-view count still works.
    return `mem-${Math.random().toString(36).slice(2)}`
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function deriveReferrerHost(): string | null {
  try {
    if (!document.referrer) return null
    const host = new URL(document.referrer).hostname
    return host || null
  } catch {
    return null
  }
}

// Suppress double-fire within a single page lifetime. We don't want to fight
// the server's day-bucket dedupe — that's its job — we just want React
// StrictMode and back-button remounts not to inflate today's view count.
const firedThisPageLoad = new Set<string>()

export async function recordProjectView(projectId: string): Promise<void> {
  if (!projectId) return
  if (firedThisPageLoad.has(projectId)) return
  firedThisPageLoad.add(projectId)

  try {
    const sessionHash = await sha256Hex(ensureRawSessionId())
    await supabase.rpc('record_project_view', {
      p_project_id:      projectId,
      p_session_hash:    sessionHash,
      p_user_agent_hash: null,            // V1 deferred — needs UA family bucket logic
      p_referrer_host:   deriveReferrerHost(),
    })
  } catch {
    // View recording is fire-and-forget. Never let a failure here block
    // anything user-facing — we'd rather miss a view than break the page.
  }
}
