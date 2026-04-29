import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AuthModal } from './AuthModal'
import { IconForecast, IconMenu, IconClose } from './icons'
import { NotificationBell } from './NotificationBell'
import { SCOUT_MONTHLY_VOTES, type ScoutTier } from '../lib/supabase'

const TIER_COLOR: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#C0C0C0', Gold: '#F0C040', Platinum: '#E5E4E2',
}

// Calendar month boundary for vote quota reset. If `votes_reset_at` rolled over
// the month already, treat used as 0 until the backend trigger clears it.
function remainingVotesFor(tier: ScoutTier, used: number, resetAt: string | null): number {
  const quota = SCOUT_MONTHLY_VOTES[tier]
  const now = new Date()
  if (resetAt) {
    const reset = new Date(resetAt)
    const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth()
    const resetMonth   = reset.getUTCFullYear() * 12 + reset.getUTCMonth()
    if (resetMonth < currentMonth) return quota
  }
  return Math.max(0, quota - (used ?? 0))
}

function daysUntilNextReset(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
}

const PRIMARY_LINKS: Array<{ to: string; label: string }> = [
  { to: '/ladder',    label: 'Ladder'    },
  { to: '/projects',  label: 'Projects'  },
  { to: '/community', label: 'Community' },
  { to: '/library',   label: 'Library'   },
  { to: '/scouts',    label: 'Scouts'    },
]

export function Nav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [menuOpen, setMenuOpen] = useState(false)        // desktop profile dropdown
  const [mobileOpen, setMobileOpen] = useState(false)    // mobile slide-down panel
  const menuRef = useRef<HTMLDivElement>(null)
  const { user, member, signOut } = useAuth()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  // Close mobile panel on route change so it never sticks across navigation.
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Lock body scroll while the mobile panel is open — full-height overlay
  // shouldn't let the page beneath scroll.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const handleApply = () => {
    setMobileOpen(false)
    if (!user) { setAuthMode('signup'); setAuthOpen(true); return }
    navigate('/submit')
  }

  const tier = (member?.tier ?? 'Bronze') as ScoutTier
  const grade = member?.creator_grade ?? 'Rookie'
  const initial = (member?.display_name || user?.email || '?').slice(0, 1).toUpperCase()
  const quota     = SCOUT_MONTHLY_VOTES[tier]
  const used      = member?.monthly_votes_used ?? 0
  const remaining = remainingVotesFor(tier, used, member?.votes_reset_at ?? null)
  const tierColor = TIER_COLOR[tier]
  const voteColor = remaining === 0 ? 'var(--text-muted)' : tierColor

  const linkStyle = (active: boolean) => ({
    color: 'var(--cream)',
    background: 'none',
    border: 'none',
    textDecoration: 'none',
    cursor: 'pointer',
    borderBottom: active ? '2px solid var(--gold-500)' : '2px solid transparent',
    paddingBottom: '2px',
    transition: 'color 0.2s, border-color 0.2s',
  })

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 md:px-8 h-16 transition-all duration-300"
        style={{
          background: scrolled || mobileOpen ? 'rgba(6, 12, 26, 0.95)' : 'transparent',
          backdropFilter: scrolled || mobileOpen ? 'blur(16px)' : 'none',
          borderBottom: scrolled || mobileOpen ? '1px solid rgba(240,192,64,0.1)' : 'none',
        }}
      >
        {/* Left · Logo */}
        <div className="flex-1 flex items-center">
          <NavLink to="/" className="flex items-center" style={{ textDecoration: 'none' }} onClick={() => setMobileOpen(false)}>
            <span className="font-display font-bold text-xl tracking-tight" style={{ color: 'var(--cream)' }}>
              Commit<span style={{ color: 'var(--gold-500)' }}>.Show</span>
            </span>
          </NavLink>
        </div>

        {/* Center · 4 primary menus · desktop only */}
        <div className="hidden md:flex items-center gap-8 flex-shrink-0">
          {PRIMARY_LINKS.map(link => (
            <NavLink key={link.to} to={link.to} className="text-sm font-mono tracking-wide"
              style={({ isActive }) => linkStyle(isActive)}>
              {link.label}
            </NavLink>
          ))}
        </div>

        {/* Right · Audition CTA + Auth · desktop */}
        <div className="flex-1 hidden md:flex items-center justify-end gap-4">
          <button
            onClick={handleApply}
            className="px-5 py-2 text-sm font-medium tracking-wide transition-all"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontFamily: 'DM Mono, monospace',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
          >
            Audit
          </button>

          {user && <NotificationBell recipientId={user.id} />}

          {!user ? (
            <button
              onClick={() => { setAuthMode('signin'); setAuthOpen(true) }}
              className="text-sm font-mono tracking-wide transition-colors"
              style={{ color: 'rgba(248,245,238,0.7)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
            >
              Sign in
            </button>
          ) : (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 px-2 py-1 transition-colors"
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '2px', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,192,64,0.4)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                title={`${remaining} of ${quota} forecasts left this month`}
              >
                <span
                  className="flex items-center justify-center w-6 h-6 font-mono text-xs font-bold overflow-hidden"
                  style={{ background: member?.avatar_url ? 'var(--navy-800)' : tierColor, color: 'var(--navy-900)', borderRadius: '2px' }}
                >
                  {member?.avatar_url ? (
                    <img src={member.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                  ) : (
                    initial
                  )}
                </span>
                <span className="font-mono text-xs tracking-wide" style={{ color: 'var(--cream)' }}>{tier}</span>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 p-2"
                  style={{
                    background: 'rgba(6,12,26,0.98)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(240,192,64,0.2)',
                    borderRadius: '2px',
                  }}
                >
                  <div className="px-3 py-2 mb-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="font-display font-bold text-sm leading-tight truncate" style={{ color: 'var(--gold-500)' }}>
                      {member?.display_name || user.email?.split('@')[0] || 'Member'}
                    </div>
                    <div className="font-mono text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {user.email}
                    </div>
                    <div className="flex justify-between items-center mt-1.5">
                      <span className="font-mono text-[10px]" style={{ color: tierColor }}>{tier}</span>
                      <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{grade}</span>
                    </div>
                  </div>

                  <NavLink
                    to="/projects"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 mb-1 transition-colors"
                    style={{
                      background: remaining === 0 ? 'rgba(255,255,255,0.02)' : `${tierColor}12`,
                      border: `1px solid ${remaining === 0 ? 'rgba(255,255,255,0.06)' : `${tierColor}40`}`,
                      borderRadius: '2px',
                      textDecoration: 'none',
                    }}
                    onMouseEnter={e => { if (remaining > 0) e.currentTarget.style.borderColor = `${tierColor}80` }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = remaining === 0 ? 'rgba(255,255,255,0.06)' : `${tierColor}40` }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
                        FORECAST BALANCE
                      </span>
                      <span className="font-mono text-[10px] tabular-nums" style={{ color: voteColor }}>
                        <IconForecast size={10} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 3 }} />
                        <strong>{remaining}</strong>
                        <span style={{ color: 'var(--text-muted)' }}> / {quota}</span>
                      </span>
                    </div>
                    {remaining === 0 ? (
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        Depleted · refills in {daysUntilNextReset()}d
                      </div>
                    ) : (
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        Cast on any audited project
                      </div>
                    )}
                  </NavLink>
                  <DropdownLink to="/me" onSelect={() => setMenuOpen(false)}>My profile</DropdownLink>
                  <DropdownLink to="/projects" onSelect={() => setMenuOpen(false)}>Browse projects</DropdownLink>
                  <DropdownLink to="/backstage" onSelect={() => setMenuOpen(false)}>Backstage</DropdownLink>
                  <DropdownLink to="/rulebook" onSelect={() => setMenuOpen(false)}>Judging rulebook</DropdownLink>
                  <button
                    onClick={() => { signOut(); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                    style={{ color: 'rgba(248,245,238,0.7)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--scarlet)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right · mobile (bell + hamburger) */}
        <div className="flex md:hidden items-center gap-2">
          {user && <NotificationBell recipientId={user.id} />}
          <button
            onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="flex items-center justify-center"
            style={{
              width: 36, height: 36,
              background: mobileOpen ? 'rgba(240,192,64,0.12)' : 'transparent',
              color: mobileOpen ? 'var(--gold-500)' : 'var(--cream)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            {mobileOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </nav>

      {/* Mobile slide-down panel · slides from below the nav bar, fills viewport */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-x-0 z-40 overflow-y-auto"
          style={{
            top: 64,
            bottom: 0,
            background: 'rgba(6, 12, 26, 0.98)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(240,192,64,0.1)',
          }}
        >
          <div className="flex flex-col px-6 py-6 gap-1">
            {PRIMARY_LINKS.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) => `font-display font-bold text-2xl py-3 transition-colors`}
                style={({ isActive }) => ({
                  color: isActive ? 'var(--gold-500)' : 'var(--cream)',
                  textDecoration: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                })}
              >
                {link.label}
              </NavLink>
            ))}

            {/* Audition CTA — full width on mobile so it's easy to tap */}
            <button
              onClick={handleApply}
              className="mt-6 w-full py-4 font-mono text-sm font-medium tracking-wide"
              style={{
                background: 'var(--gold-500)',
                color: 'var(--navy-900)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              Audit your product →
            </button>

            {/* Auth area · mobile */}
            {!user ? (
              <button
                onClick={() => { setMobileOpen(false); setAuthMode('signin'); setAuthOpen(true) }}
                className="mt-3 w-full py-3 font-mono text-xs tracking-widest"
                style={{
                  background: 'transparent',
                  color: 'var(--cream)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                SIGN IN
              </button>
            ) : (
              <>
                {/* Profile summary */}
                <div className="mt-6 px-3 py-3 flex items-center gap-3" style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '2px',
                }}>
                  <span
                    className="flex items-center justify-center w-9 h-9 font-mono text-sm font-bold overflow-hidden"
                    style={{ background: member?.avatar_url ? 'var(--navy-800)' : tierColor, color: 'var(--navy-900)', borderRadius: '2px' }}
                  >
                    {member?.avatar_url ? (
                      <img src={member.avatar_url} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                    ) : initial}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-sm truncate" style={{ color: 'var(--gold-500)' }}>
                      {member?.display_name || user.email?.split('@')[0] || 'Member'}
                    </div>
                    <div className="font-mono text-[10px] flex gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span style={{ color: tierColor }}>{tier}</span>
                      <span>·</span>
                      <span>{grade}</span>
                    </div>
                  </div>
                </div>

                {/* Forecast wallet card */}
                <div className="mt-2 px-3 py-2.5" style={{
                  background: remaining === 0 ? 'rgba(255,255,255,0.02)' : `${tierColor}10`,
                  border: `1px solid ${remaining === 0 ? 'rgba(255,255,255,0.06)' : `${tierColor}40`}`,
                  borderRadius: '2px',
                }}>
                  <div className="flex justify-between mb-0.5">
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
                      FORECAST BALANCE
                    </span>
                    <span className="font-mono text-[11px] tabular-nums" style={{ color: voteColor }}>
                      <IconForecast size={11} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }} />
                      <strong>{remaining}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> / {quota}</span>
                    </span>
                  </div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {remaining === 0 ? `Depleted · refills in ${daysUntilNextReset()}d` : 'Cast on any audited project'}
                  </div>
                </div>

                <NavLink
                  to="/me"
                  className="mt-2 py-3 font-mono text-xs tracking-widest"
                  style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  MY PROFILE
                </NavLink>
                <NavLink
                  to="/backstage"
                  className="py-3 font-mono text-xs tracking-widest"
                  style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  BACKSTAGE
                </NavLink>
                <NavLink
                  to="/rulebook"
                  className="py-3 font-mono text-xs tracking-widest"
                  style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  JUDGING RULEBOOK
                </NavLink>
                <button
                  onClick={() => { signOut(); setMobileOpen(false) }}
                  className="mt-3 w-full py-3 font-mono text-xs tracking-widest text-left"
                  style={{ background: 'none', color: 'var(--scarlet)', border: 'none', cursor: 'pointer' }}
                >
                  SIGN OUT
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </>
  )
}

function DropdownLink({ to, onSelect, children }: { to: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      onClick={onSelect}
      className="block w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
      style={{ color: 'rgba(248,245,238,0.7)', textDecoration: 'none' }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
    >
      {children}
    </NavLink>
  )
}
