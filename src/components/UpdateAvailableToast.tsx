// UpdateAvailableToast — non-intrusive new-version banner · 2026-05-15.
//
// When useUpdateAvailable() flips true (server shipped a build different
// from the one this tab booted with), this toast surfaces at the bottom-
// right of the viewport. Two affordances:
//
//   · "Reload" (primary)  → actually replaces window.location with a
//                            cache-busted URL so the browser fetches the
//                            new index.html + new hashed chunks. Real
//                            reload, not just a toast dismissal.
//   · "Later" (secondary) → hides the toast for the rest of this tab's
//                            lifetime · the user explicitly opted out of
//                            updating now. No nag re-appearance on
//                            visibility-change · they decided.
//
// The Reload button is the headline because the toast exists only when
// there's something to reload to — a user who clicks the toast almost
// certainly wants the new version (per CEO ask: "단순 알림만 하지말고
// 누르면 새버전으로 실재 리로드 하도록").

import { useState } from 'react'
import { useUpdateAvailable, reloadForNewVersion } from '../lib/buildVersion'

export function UpdateAvailableToast() {
  const updateAvailable = useUpdateAvailable()
  const [dismissed, setDismissed] = useState(false)

  if (!updateAvailable || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[200] flex items-center gap-3 px-4 py-3"
      style={{
        background:   'rgba(15,32,64,0.95)',
        border:       '1px solid rgba(240,192,64,0.45)',
        borderRadius: '2px',
        boxShadow:    '0 6px 24px rgba(6,12,26,0.6)',
        maxWidth:     'calc(100vw - 32px)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        aria-hidden="true"
        style={{
          width: 24, height: 24,
          background: 'rgba(240,192,64,0.15)',
          color: 'var(--gold-500)',
          border: '1px solid rgba(240,192,64,0.45)',
          borderRadius: '2px',
          fontSize: 13,
        }}
      >
        ↻
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
          NEW VERSION
        </div>
        <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
          Reload to pick up the latest fixes.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reloadForNewVersion}
          className="px-3 py-1.5 font-mono text-[11px] font-medium tracking-widest"
          style={{
            background:   'var(--gold-500)',
            color:        'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       'pointer',
            whiteSpace:   'nowrap',
          }}
        >
          RELOAD
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss · don't reload now"
          title="Dismiss · I'll reload later"
          className="font-mono text-[11px]"
          style={{
            background:   'transparent',
            color:        'var(--text-muted)',
            border:       'none',
            cursor:       'pointer',
            padding:      '6px 8px',
          }}
        >
          Later
        </button>
      </div>
    </div>
  )
}
