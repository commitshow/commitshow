import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AuthModal } from './AuthModal'

const TIER_COLOR: Record<string, string> = {
  Bronze: '#CD7F32', Silver: '#C0C0C0', Gold: '#F0C040', Platinum: '#E5E4E2',
}

export function Nav() {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [menuOpen, setMenuOpen] = useState(false)
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

  const handleApply = () => {
    if (!user) { setAuthMode('signup'); setAuthOpen(true); return }
    navigate('/submit')
  }

  const tier = member?.tier ?? 'Bronze'
  const grade = member?.creator_grade ?? 'Rookie'
  const initial = (member?.display_name || user?.email || '?').slice(0, 1).toUpperCase()

  const linkStyle = (active: boolean) => ({
    color: active ? 'var(--gold-500)' : 'rgba(248,245,238,0.5)',
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
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 h-16 transition-all duration-300"
        style={{
          background: scrolled ? 'rgba(6, 12, 26, 0.92)' : 'transparent',
          backdropFilter: scrolled ? 'blur(16px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(240,192,64,0.1)' : 'none',
        }}
      >
        {/* Logo */}
        <NavLink to="/" className="flex items-center" style={{ textDecoration: 'none' }}>
          <span className="font-display font-bold text-xl tracking-tight" style={{ color: 'var(--cream)' }}>
            Commit<span style={{ color: 'var(--gold-500)' }}>.Show</span>
          </span>
        </NavLink>

        {/* Links */}
        <div className="hidden md:flex items-center gap-8">
          <NavLink to="/projects" className="text-sm font-mono tracking-wide"
            style={({ isActive }) => linkStyle(isActive)}>
            Projects
          </NavLink>
          <NavLink to="/library" className="text-sm font-mono tracking-wide"
            style={({ isActive }) => linkStyle(isActive)}>
            Library
          </NavLink>
          <NavLink to="/scouts" className="text-sm font-mono tracking-wide"
            style={({ isActive }) => linkStyle(isActive)}>
            Scouts
          </NavLink>

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
            Apply
          </button>

          {/* Auth area */}
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
              >
                <span
                  className="flex items-center justify-center w-6 h-6 font-mono text-xs font-bold overflow-hidden"
                  style={{ background: member?.avatar_url ? 'var(--navy-800)' : TIER_COLOR[tier], color: 'var(--navy-900)', borderRadius: '2px' }}
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
                      <span className="font-mono text-[10px]" style={{ color: TIER_COLOR[tier] }}>{tier}</span>
                      <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{grade}</span>
                    </div>
                  </div>
                  <NavLink
                    to="/me"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                    style={{ color: 'rgba(248,245,238,0.7)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
                  >
                    My profile
                  </NavLink>
                  <NavLink
                    to="/projects"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                    style={{ color: 'rgba(248,245,238,0.7)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
                  >
                    Browse projects
                  </NavLink>
                  <NavLink
                    to="/rulebook"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                    style={{ color: 'rgba(248,245,238,0.7)', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
                  >
                    Judging rulebook
                  </NavLink>
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
      </nav>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </>
  )
}
