import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'

type Mode = 'signin' | 'signup'

interface AuthModalProps {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}

export function AuthModal({ open, onClose, initialMode = 'signin' }: AuthModalProps) {
  const { signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setError(null); setMode(initialMode) }
  }, [open, initialMode])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  if (!open) return null

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setBusy(true)
    const fn = mode === 'signin' ? signInWithEmail : signUpWithEmail
    const { error: err } = await fn(email, password)
    setBusy(false)
    if (err) { setError(err.message); return }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(6,12,26,0.8)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy w-full max-w-md p-8"
        style={{ borderRadius: '2px', borderColor: 'rgba(240,192,64,0.25)' }}
      >
        {/* Header */}
        <div className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // {mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </div>
          <h2 className="font-display font-bold text-2xl" style={{ color: 'var(--cream)' }}>
            {mode === 'signin' ? 'Welcome back.' : 'Join the league.'}
          </h2>
        </div>

        {/* Email form (Google OAuth enabled after domain setup) */}
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
            disabled={busy}
            className="w-full mt-4 px-5 py-2.5 font-mono text-sm font-medium tracking-wide transition-all"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
            onMouseEnter={e => !busy && (e.currentTarget.style.background = 'var(--gold-400)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
          >
            {busy ? '...' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>
        </form>

        {/* Toggle mode */}
        <div className="mt-5 text-center">
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
            className="font-mono text-xs tracking-wide transition-colors"
            style={{ color: 'rgba(248,245,238,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.5)')}
          >
            {mode === 'signin' ? "Don't have an account? Sign up →" : 'Already a member? Sign in →'}
          </button>
        </div>
      </div>
    </div>
  )
}
