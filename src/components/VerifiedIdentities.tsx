// Verified-by chip strip · §18.2 Trust Signals (PRD v1.8).
//
// OAuth-linked identities act as informal credentials:
//   + X         → human · follower network · recency
//   + GitHub    → builder history · real commit cadence
//   + LinkedIn  → professional identity (V1.5 recruiting hook)
// Google / Email alone = baseline · no chip (per §18.2, they don't earn a trust boost).
//
// Trust Boost levels (rendered as subtle label next to the chips):
//   0 boost chips = "Soft" (hidden · just absence of chips signals it)
//   1 chip        = "Trust Boost 1"
//   2+ chips      = "Trust Boost 2"
//
// This is a visual signal only. Law/compliance-level verification (Stripe Identity,
// W-9/W-8BEN, OFAC) is a separate axis and lives elsewhere.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { linkGithub } from '../lib/github'

type HighSignalProvider = 'twitter' | 'github' | 'linkedin_oidc'

const PROVIDER_META: Record<HighSignalProvider, { label: string; color: string }> = {
  twitter:       { label: 'X',        color: '#F8F5EE' },
  github:        { label: 'GitHub',   color: '#F8F5EE' },
  linkedin_oidc: { label: 'LinkedIn', color: '#60A5FA' },
}

const HIGH_SIGNAL: HighSignalProvider[] = ['twitter', 'github', 'linkedin_oidc']

export function VerifiedIdentities() {
  const [linkedProviders, setLinkedProviders] = useState<Set<string> | null>(null)
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const idents = data.user?.identities ?? []
      setLinkedProviders(new Set(idents.map(i => i.provider)))
    })
  }, [])

  if (linkedProviders === null) return null

  const linkedHigh = HIGH_SIGNAL.filter(p => linkedProviders.has(p))
  const unlinkedHigh = HIGH_SIGNAL.filter(p => !linkedProviders.has(p))
  const boostLabel = linkedHigh.length >= 2 ? 'Trust Boost 2'
    : linkedHigh.length === 1 ? 'Trust Boost 1'
    : null

  const handleLink = async (provider: HighSignalProvider) => {
    setLinking(provider)
    if (provider === 'github') {
      await linkGithub()
      setLinking(null)
      return
    }
    // twitter / linkedin_oidc — direct linkIdentity call
    const { error } = await supabase.auth.linkIdentity({
      provider: provider as 'twitter' | 'linkedin_oidc',
      options: { redirectTo: window.location.href },
    })
    if (error) setLinking(null)
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
          VERIFIED BY
        </span>
        {linkedHigh.length === 0 && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            — link X or GitHub to boost trust
          </span>
        )}
        {linkedHigh.map(p => (
          <span
            key={p}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide px-2 py-0.5"
            style={{
              background: 'rgba(0,212,170,0.08)',
              color: '#00D4AA',
              border: '1px solid rgba(0,212,170,0.35)',
              borderRadius: '2px',
            }}
            title={`Linked via ${PROVIDER_META[p].label} OAuth`}
          >
            <ProviderGlyph provider={p} />
            {PROVIDER_META[p].label}
          </span>
        ))}
        {boostLabel && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--gold-500)' }}>
            · {boostLabel}
          </span>
        )}
      </div>
      {unlinkedHigh.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Link more:
          </span>
          {unlinkedHigh.map(p => (
            <button
              key={p}
              onClick={() => handleLink(p)}
              disabled={linking === p}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide px-2 py-0.5 transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '2px',
                cursor: linking === p ? 'wait' : 'pointer',
                opacity: linking === p ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (linking === p) return
                e.currentTarget.style.borderColor = 'rgba(240,192,64,0.45)'
                e.currentTarget.style.color = 'var(--gold-500)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
              title={`Link ${PROVIDER_META[p].label} to your account`}
            >
              <ProviderGlyph provider={p} />
              + {PROVIDER_META[p].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderGlyph({ provider }: { provider: HighSignalProvider }) {
  const common = { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }
  if (provider === 'twitter') {
    return (
      <svg {...common}>
        <path d="M17.53 3H21l-7.62 8.71L22 21h-6.84l-5.36-7-6.13 7H0l8.13-9.3L0 3h6.9l4.85 6.4L17.53 3zm-1.2 16h1.92L7.82 5H5.75l10.58 14z" />
      </svg>
    )
  }
  if (provider === 'github') {
    return (
      <svg {...common}>
        <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.4.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.4-4.04-1.4-.55-1.38-1.33-1.76-1.33-1.76-1.08-.74.08-.72.08-.72 1.2.08 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.48.99.1-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0C17.3 4.4 18.3 4.72 18.3 4.72c.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
      </svg>
    )
  }
  // linkedin_oidc
  return (
    <svg {...common}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.03-1.85-3.03-1.85 0-2.13 1.45-2.13 2.94v5.66H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.37 4.28 5.47v6.27zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.21 24 24 23.23 24 22.28V1.72C24 .77 23.21 0 22.22 0z" />
    </svg>
  )
}
