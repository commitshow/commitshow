import { useState, useEffect } from 'react'
import { useAuth, type OAuthProvider } from '../lib/auth'

type Mode = 'signin' | 'signup'

interface AuthModalProps {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}

export function AuthModal({ open, onClose, initialMode = 'signin' }: AuthModalProps) {
  const { signInWithEmail, signUpWithEmail, signInWithOAuth } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null)
  // Confirmation-pending screen · shown after a signup whose response
  // had no session (Supabase "Confirm email" is enabled). User has
  // to click the link in their inbox before they can sign in. Carries
  // the email so the message can show which inbox to check.
  const [confirmationSent, setConfirmationSent] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      setMode(initialMode)
      setPasswordConfirm('')
      setConfirmationSent(null)
    }
  }, [open, initialMode])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  if (!open) return null

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'signup' && password !== passwordConfirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    if (mode === 'signin') {
      const { error: err } = await signInWithEmail(email, password)
      setBusy(false)
      if (err) { setError(err.message); return }
      onClose()
    } else {
      const res = await signUpWithEmail(email, password)
      setBusy(false)
      if (res.error) { setError(res.error.message); return }
      // When Supabase Auth has "Confirm email" enabled, signUp
      // returns no session — render the check-your-inbox screen
      // instead of closing the modal silently.
      if (res.confirmationPending) {
        setConfirmationSent(email)
        return
      }
      onClose()
    }
  }

  const handleOAuth = async (provider: OAuthProvider) => {
    setError(null)
    setOauthBusy(provider)

    // Safety timeout — if the provider redirect never fires (misconfigured
    // provider, popup blocker, or the Supabase request silently stalls), we
    // need to release the disabled-button state so the modal stays usable.
    const safety = window.setTimeout(() => {
      setOauthBusy(null)
      setError(`${provider} sign-in didn't start. Try again, or check that the provider is configured.`)
    }, 12_000)

    try {
      const { error: err } = await signInWithOAuth(provider)
      if (err) {
        window.clearTimeout(safety)
        setOauthBusy(null)
        setError(err.message)
      }
      // Success case redirects away · the timeout is cancelled on unload.
    } catch (caught) {
      window.clearTimeout(safety)
      setOauthBusy(null)
      setError(caught instanceof Error ? caught.message : 'Sign-in failed.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(6,12,26,0.8)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy w-full max-w-md p-8 max-h-[92vh] overflow-y-auto relative"
        style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.25)' }}
      >
        {/* Close × — always visible, always works even if OAuth is busy */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 font-mono text-xs px-2 py-1 transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--gold-500)'; e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
        >
          ESC ×
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // {confirmationSent
                ? 'CHECK YOUR INBOX'
                : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </div>
          <h2 className="font-display font-bold text-2xl" style={{ color: 'var(--cream)' }}>
            {confirmationSent
              ? 'Confirm your email'
              : mode === 'signin' ? 'Welcome back' : 'Join the league'}
          </h2>
        </div>

        {/* Confirmation-pending screen · skips OAuth + form when an
            email signup just finished but Supabase requires email
            confirmation. Closing returns the user to the closed
            state · they can come back any time and sign in once
            they've clicked the link. */}
        {confirmationSent && (
          <div className="space-y-4">
            <div className="px-4 py-4" style={{
              background: 'rgba(240,192,64,0.05)',
              border: '1px solid rgba(240,192,64,0.25)',
              borderRadius: '2px',
              lineHeight: 1.55,
            }}>
              <p style={{ color: 'var(--cream)' }}>
                We sent a confirmation link to <strong style={{ color: 'var(--gold-500)' }}>{confirmationSent}</strong>.
              </p>
              <p className="mt-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                Click the link in that email to activate your account, then come back here to sign in.
                Check spam / junk if it doesn't arrive within a minute.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setConfirmationSent(null); setMode('signin'); setPassword(''); setPasswordConfirm('') }}
              className="w-full font-mono text-xs tracking-wide py-3"
              style={{
                background: 'var(--gold-500)', color: 'var(--navy-900)',
                border: 'none', borderRadius: '2px', cursor: 'pointer', fontWeight: 600,
              }}
            >
              BACK TO SIGN IN
            </button>
          </div>
        )}

        {/* Hide OAuth + form while the confirmation-pending screen
            is showing · the user already submitted, they're waiting
            on the email link. */}
        {!confirmationSent && <>
        {/* OAuth buttons — fast path */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <OAuthButton
            provider="google"
            label="Google"
            busy={oauthBusy === 'google'}
            disabled={oauthBusy !== null || busy}
            onClick={() => handleOAuth('google')}
          />
          <OAuthButton
            provider="github"
            label="GitHub"
            busy={oauthBusy === 'github'}
            disabled={oauthBusy !== null || busy}
            onClick={() => handleOAuth('github')}
          />
          <OAuthButton
            provider="twitter"
            label="X"
            busy={oauthBusy === 'twitter'}
            disabled={oauthBusy !== null || busy}
            onClick={() => handleOAuth('twitter')}
          />
          <OAuthButton
            provider="linkedin_oidc"
            label="LinkedIn"
            busy={oauthBusy === 'linkedin_oidc'}
            disabled={oauthBusy !== null || busy}
            onClick={() => handleOAuth('linkedin_oidc')}
          />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5" aria-hidden="true">
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
            OR CONTINUE WITH EMAIL
          </span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Email form */}
        <form onSubmit={handleEmail} className="space-y-3">
          <div>
            <label className="font-mono text-xs tracking-wide block mb-1.5" style={{ color: 'rgba(248,245,238,0.5)' }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="font-mono text-xs tracking-wide block mb-1.5" style={{ color: 'rgba(248,245,238,0.5)' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2.5"
              placeholder="• • • • • •"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="font-mono text-xs tracking-wide block mb-1.5" style={{ color: 'rgba(248,245,238,0.5)' }}>
                CONFIRM PASSWORD
              </label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={e => setPasswordConfirm(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2.5"
                placeholder="• • • • • •"
                autoComplete="new-password"
              />
              {passwordConfirm.length > 0 && password !== passwordConfirm && (
                <div className="font-mono text-[10px] mt-1.5" style={{ color: 'rgba(248,120,113,0.85)' }}>
                  Passwords don't match yet.
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="font-mono text-xs px-3 py-2" style={{
              background: 'rgba(200,16,46,0.08)',
              border: '1px solid rgba(200,16,46,0.25)',
              color: 'var(--scarlet)',
              borderRadius: '2px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || oauthBusy !== null}
            className="w-full mt-4 px-5 py-2.5 font-mono text-sm font-medium tracking-wide transition-all"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy || oauthBusy !== null ? 0.5 : 1,
            }}
            onMouseEnter={e => !busy && oauthBusy === null && (e.currentTarget.style.background = 'var(--gold-400)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
          >
            {busy ? '...' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>
        </form>

        {/* Toggle mode */}
        <div className="mt-5 text-center">
          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setPasswordConfirm('')
            }}
            className="font-mono text-xs tracking-wide transition-colors"
            style={{ color: 'rgba(248,245,238,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.5)')}
          >
            {mode === 'signin' ? "Don't have an account? Sign up →" : 'Already a member? Sign in →'}
          </button>
        </div>
        </>}
      </div>
    </div>
  )
}

// ── OAuth button · monochrome brand glyph + label ─────────────
function OAuthButton({ provider, label, busy, disabled, onClick }: {
  provider: OAuthProvider
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 px-3 py-2.5 font-mono text-xs tracking-wide transition-colors"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: 'var(--cream)',
        borderRadius: '2px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !busy ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'rgba(240,192,64,0.45)'
        e.currentTarget.style.color = 'var(--gold-500)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
        e.currentTarget.style.color = 'var(--cream)'
      }}
    >
      {busy ? (
        <span className="font-mono text-xs">...</span>
      ) : (
        <>
          <ProviderGlyph provider={provider} />
          <span>{label}</span>
        </>
      )}
    </button>
  )
}

function ProviderGlyph({ provider }: { provider: OAuthProvider }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }
  if (provider === 'google') {
    return (
      <svg {...common}>
        <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44-3.83 0-7.19-3.02-7.19-7.27 0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z" />
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
  if (provider === 'twitter') {
    return (
      <svg {...common}>
        <path d="M17.53 3H21l-7.62 8.71L22 21h-6.84l-5.36-7-6.13 7H0l8.13-9.3L0 3h6.9l4.85 6.4L17.53 3zm-1.2 16h1.92L7.82 5H5.75l10.58 14z" />
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
