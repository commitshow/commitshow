// /cli/link?code=XXXXXX · device-flow approval surface.
// User signed in on web sees the code their CLI generated, confirms,
// and clicks Approve. Server marks the cli_link_codes row approved
// with their auth.uid() so the CLI's poll can retrieve the token.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { AuthModal } from '../components/AuthModal'

type Status = 'idle' | 'approving' | 'approved' | 'error'

export function CliLinkPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, member, loading } = useAuth()
  const codeFromUrl = (params.get('code') ?? '').toUpperCase().trim()

  const [code,     setCode]     = useState(codeFromUrl)
  const [status,   setStatus]   = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => { if (codeFromUrl) setCode(codeFromUrl) }, [codeFromUrl])

  const codeValid = /^[0-9A-F]{6}$/.test(code)

  const approve = async () => {
    if (!codeValid) return
    setStatus('approving'); setErrorMsg(null)
    try {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) throw new Error('Sign in expired · refresh the page')
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cli-link-approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setStatus('approved')
    } catch (e) {
      setStatus('error')
      setErrorMsg((e as Error)?.message ?? String(e))
    }
  }

  return (
    <div className="relative z-10 pt-24 pb-16 px-4 min-h-screen flex items-start justify-center" style={{ background: 'var(--navy-950)' }}>
      <div className="w-full max-w-lg">
        <div className="card-navy p-8" style={{ borderRadius: '3px' }}>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// CLI DEVICE LINK</div>
          <h1 className="font-display text-3xl mb-2" style={{ color: 'var(--cream)' }}>Authorize CLI</h1>
          <p className="text-sm mb-6" style={{ color: 'rgba(248,245,238,0.6)' }}>
            Your terminal asked to link to your commit.show account. Confirm the
            6-character code below matches what your CLI is showing, then approve.
            The CLI then mints a 90-day API token signed for your account.
          </p>

          {loading ? (
            <div className="font-mono text-xs" style={{ color: 'rgba(248,245,238,0.55)' }}>loading…</div>
          ) : !user ? (
            <>
              <div className="p-4 mb-4" style={{ background: 'rgba(248,120,113,0.08)', border: '1px solid rgba(248,120,113,0.3)', borderRadius: '2px' }}>
                <div className="font-mono text-xs mb-1" style={{ color: '#F88771' }}>SIGN IN REQUIRED</div>
                <div className="text-sm" style={{ color: 'rgba(248,245,238,0.7)' }}>
                  CLI authorization needs an account · sign in or create one to continue.
                </div>
              </div>
              <button
                onClick={() => setAuthOpen(true)}
                className="w-full py-3 font-mono text-xs tracking-widest"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer', fontWeight: 600 }}
              >
                SIGN IN / CREATE ACCOUNT
              </button>
              <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode="signup" />
            </>
          ) : status === 'approved' ? (
            <div>
              <div className="p-4 mb-4" style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.3)', borderRadius: '2px' }}>
                <div className="font-mono text-xs mb-1" style={{ color: '#00D4AA' }}>APPROVED</div>
                <div className="text-sm" style={{ color: 'rgba(248,245,238,0.85)' }}>
                  Your CLI should pick up the token within 5 seconds. You can close this tab.
                </div>
              </div>
              <button
                onClick={() => navigate('/me')}
                className="w-full py-2 font-mono text-xs tracking-widest"
                style={{ background: 'transparent', color: 'var(--gold-500)', border: '1px solid rgba(240,192,64,0.45)', borderRadius: '2px', cursor: 'pointer' }}
              >
                Go to my profile
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="font-mono text-xs mb-2 block" style={{ color: 'rgba(248,245,238,0.55)' }}>VERIFICATION CODE</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="ABC123"
                  className="w-full px-4 py-3 font-mono text-2xl text-center tabular-nums tracking-[0.5em]"
                  style={{ background: 'rgba(0,0,0,0.4)', border: codeValid ? '1px solid rgba(240,192,64,0.5)' : '1px solid rgba(255,255,255,0.15)', borderRadius: '2px', color: 'var(--cream)' }}
                />
                <div className="font-mono text-[11px] mt-1" style={{ color: 'rgba(248,245,238,0.4)' }}>
                  6 hex characters · 0-9 + A-F · pre-filled from your CLI's URL
                </div>
              </div>

              <div className="text-sm mb-5" style={{ color: 'rgba(248,245,238,0.6)' }}>
                Signed in as <strong style={{ color: 'var(--cream)' }}>{member?.display_name ?? user.email}</strong>.
                Approving authorizes a CLI session for this account.
              </div>

              <button
                onClick={approve}
                disabled={!codeValid || status === 'approving'}
                className="w-full py-3 font-mono text-xs tracking-widest"
                style={{
                  background: codeValid ? 'var(--gold-500)' : 'rgba(240,192,64,0.3)',
                  color: 'var(--navy-900)', border: 'none', borderRadius: '2px',
                  cursor: codeValid && status !== 'approving' ? 'pointer' : 'wait',
                  fontWeight: 600,
                  opacity: codeValid ? 1 : 0.5,
                }}
              >
                {status === 'approving' ? 'AUTHORIZING…' : 'AUTHORIZE CLI'}
              </button>

              {errorMsg && (
                <div className="font-mono text-xs mt-3" style={{ color: 'var(--scarlet)' }}>{errorMsg}</div>
              )}
            </>
          )}
        </div>

        <div className="text-center mt-4 font-mono text-[11px]" style={{ color: 'rgba(248,245,238,0.4)' }}>
          Codes expire 10 minutes after the CLI requests them. Approved codes
          can be retrieved by the CLI within 24 hours.
        </div>
      </div>
    </div>
  )
}
