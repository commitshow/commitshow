import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AuthModal } from './AuthModal'
import { IconForecast, IconMenu, IconClose } from './icons'
import { NotificationBell } from './NotificationBell'
import { SideNav } from './SideNav'
import { SCOUT_MONTHLY_VOTES, supabase, type ScoutTier } from '../lib/supabase'
import { useFeatureFlag } from '../lib/featureFlags'

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

// Primary nav · 2026-05-05 reorder + rebrand:
//  - Ladder → Products (continuous ranking · "graduation" framing dropped)
//  - Order Products → Scouts → Community → Library reads as
//    "what's shipped → who judges → where talk happens → reusable craft"
//  - /products is the canonical route; /ladder kept as a redirect for
//    external links + tweet history.
// 6 primary links · §Token-maxxing leaderboard added 2026-05-07.
// Tokens sits next to Scouts as the peer leaderboard (Scouts ranks
// judges by activity points · Tokens ranks creators by efficiency).
//
// Tokens link is gated until the admin flips `tokens_public` in
// app_feature_flags · admins always see it (preview path), everyone
// else only after the toggle. The /tokens page itself stays reachable
// by direct URL so admin can share preview links with select users.
const PRIMARY_LINKS_BASE: Array<{ to: string; label: string; flag?: string }> = [
  { to: '/products',  label: 'Products'  },
  { to: '/creators',  label: 'Creators'  },
  { to: '/scouts',    label: 'Scouts'    },
  { to: '/tokens',    label: 'Tokens',    flag: 'tokens_public' },
  { to: '/community', label: 'Community' },
  { to: '/library',   label: 'Library'   },
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
  const tokensPublic = useFeatureFlag('tokens_public', false)
  const isAdmin = !!member?.is_admin

  // Filter the base list against feature flags · admin always sees
  // every link (preview path), non-admins see only links whose flag
  // is undefined (default-on) or `enabled = true`.
  const PRIMARY_LINKS = PRIMARY_LINKS_BASE.filter(link => {
    if (!link.flag) return true
    if (isAdmin)   return true
    if (link.flag === 'tokens_public') return tokensPublic
    return false
  })

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

        {/* PRIMARY_LINKS were here · 2026-05-05 they moved to the
            left SideNav rail (md+). On desktop the top bar now carries
            only logo + search + audition + profile. Mobile slide-down
            panel below still surfaces all primary links inline. */}

        {/* Right · Search + Audition CTA + Auth · desktop */}
        <div className="flex-1 hidden md:flex items-center justify-end gap-4">
          <NavLink
            to="/search"
            aria-label="Search"
            title="Search · products · creators · library"
            className="flex items-center justify-center transition-colors"
            style={{ width: 36, height: 36, color: 'var(--text-secondary)', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--cream)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
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
            Audition
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
                    {/* Tier + grade · both clickable to the corresponding
                        activity detail page. Visually grouped as
                        SCOUT (left, gold-tier-tinted) vs CREATOR (right,
                        muted) so the user can see at a glance which side
                        they're acting from. */}
                    <div className="flex justify-between items-center gap-2 mt-1.5">
                      <NavLink
                        to={`/scouts/${user.id}`}
                        onClick={() => setMenuOpen(false)}
                        className="font-mono text-[10px] flex items-center gap-1.5 px-1.5 py-0.5 transition-colors"
                        style={{
                          color: tierColor,
                          border: `1px solid ${tierColor}40`,
                          borderRadius: '2px',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = `${tierColor}1a`)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ color: 'var(--text-muted)' }}>SCOUT</span>
                        <span>{tier}</span>
                      </NavLink>
                      <NavLink
                        to={`/creators/${user.id}`}
                        onClick={() => setMenuOpen(false)}
                        className="font-mono text-[10px] flex items-center gap-1.5 px-1.5 py-0.5 transition-colors"
                        style={{
                          color: 'var(--cream)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '2px',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                      >
                        <span style={{ color: 'var(--text-muted)' }}>CREATOR</span>
                        <span>{grade}</span>
                      </NavLink>
                    </div>
                  </div>

                  <NavLink
                    to="/products"
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

                  {/* Audition tickets · creator-side balance. Same
                      callout pattern as Forecast Balance above so the
                      two scarcity surfaces (Scout votes vs Creator
                      tickets) sit visually parallel. Click → /me
                      where TicketWalletCard exposes the buy CTA. */}
                  <AuditionTicketsCallout onSelect={() => setMenuOpen(false)} />

                  {/* My Products · creator-side counterpart to the
                      Forecast Balance callout above. Same callout
                      pattern (callout with key info + accent border)
                      so the two roles get equal weight in the menu. */}
                  <MyProductsCallout onSelect={() => setMenuOpen(false)} />

                  {/* Profile dropdown is user-action only. Browsing entry points
                      (Ladder / Library / Community / Scouts) live in the main
                      Nav strip; explanatory pages (Backstage / Rulebook /
                      Terms / Privacy) live in the footer. Keeping this menu
                      to two items removes redundancy + makes Sign out a
                      one-tap target. */}
                  {/* My profile · button + manual navigate (instead of
                      NavLink) because clicking on the same route doesn't
                      always re-fire NavLink's onClick reliably across
                      React-Router-DOM versions, leaving the menu stuck
                      open. Manual handler + setMenuOpen(false) before
                      navigate guarantees the close. */}
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); navigate('/me') }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                    style={{ color: 'rgba(248,245,238,0.7)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
                  >
                    <span className="inline-flex items-center" style={{ color: 'inherit' }}><IconGear /></span>
                    <span>My profile</span>
                  </button>
                  {/* Admin-only entry points · members.is_admin gate. /admin
                      is the operational dashboard; /admin/cmo is the
                      marketing post-studio preview surface. Both hidden
                      from non-admin members so the dropdown stays minimal. */}
                  {member?.is_admin && (
                    <>
                      <DropdownLink to="/admin"        onSelect={() => setMenuOpen(false)} icon={<IconAdmin />}>Admin</DropdownLink>
                      <DropdownLink to="/admin/cmo"    onSelect={() => setMenuOpen(false)} icon={<IconMegaphone />}>CMO's Room</DropdownLink>
                      <DropdownLink to="/admin/emails" onSelect={() => setMenuOpen(false)} icon={<IconMail />}>Email templates</DropdownLink>
                    </>
                  )}
                  {/* Sign out · right-aligned to set it apart from the
                      My profile (left-aligned settings) row · the menu reads
                      as "settings on the left, escape on the right". */}
                  <button
                    onClick={() => { signOut(); setMenuOpen(false) }}
                    className="w-full text-right px-3 py-2 font-mono text-xs tracking-wide transition-colors"
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

      {/* Desktop left sidebar · md+ only. Mobile keeps the slide-down
          panel below for primary navigation. */}
      <SideNav links={PRIMARY_LINKS} />

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
              Audition your product →
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
                    {remaining === 0 ? `Depleted · refills in ${daysUntilNextReset()}d` : 'Cast on any audited product'}
                  </div>
                </div>

                {/* Mobile profile section · synced with the desktop dropdown:
                    My profile (left + gear icon · settings) and Sign out
                    (right-aligned · escape). Backstage / Judging rulebook
                    moved to the footer (App.tsx) — they're explanatory pages
                    and don't belong in the user menu. */}
                <NavLink
                  to="/me"
                  className="mt-2 py-3 font-mono text-xs tracking-widest inline-flex items-center gap-2"
                  style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <IconGear size={14} />
                  MY PROFILE
                </NavLink>
                {member?.is_admin && (
                  <>
                    <NavLink
                      to="/admin"
                      onClick={() => setMobileOpen(false)}
                      className="py-3 font-mono text-xs tracking-widest inline-flex items-center gap-2"
                      style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <IconAdmin size={14} />
                      ADMIN
                    </NavLink>
                    <NavLink
                      to="/admin/cmo"
                      onClick={() => setMobileOpen(false)}
                      className="py-3 font-mono text-xs tracking-widest inline-flex items-center gap-2"
                      style={{ color: 'var(--cream)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <IconMegaphone size={14} />
                      CMO'S ROOM
                    </NavLink>
                  </>
                )}
                <button
                  onClick={() => { signOut(); setMobileOpen(false) }}
                  className="mt-3 w-full py-3 font-mono text-xs tracking-widest text-right"
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

function DropdownLink({ to, onSelect, icon, children }: { to: string; onSelect: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      onClick={onSelect}
      className="flex items-center gap-2 w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
      style={{ color: 'rgba(248,245,238,0.7)', textDecoration: 'none' }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,245,238,0.7)')}
    >
      {icon && <span className="inline-flex items-center" style={{ color: 'inherit' }}>{icon}</span>}
      <span>{children}</span>
    </NavLink>
  )
}

// Inline gear icon · matches the icons.tsx convention (currentColor stroke,
// viewBox 24, no fill). Used as the lead glyph for the "My profile" item
// in the user dropdown to signal "this is settings / your account row".
function IconGear({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// Admin · shield outline. Used for /admin route entry in dropdown.
function IconAdmin({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

// Megaphone · marketing / announcements. Used for /admin/cmo entry.
function IconMegaphone({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M16 8a4 4 0 0 1 0 8" />
      <path d="M19 5a8 8 0 0 1 0 14" />
    </svg>
  )
}

// Envelope · transactional emails / templates. Used for /admin/emails entry.
function IconMail({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

// My Products callout · shows the authed user's product portfolio
// summary (total · Encore count · best score) inside the profile
// dropdown. Routes to /me which lists all the user's audited
// projects. Counts fetch lazily on mount; while loading the box
// shows muted placeholders so the dropdown stays a fixed height.
// AuditionTicketsCallout · creator-side scarcity (mirror of FORECAST
// BALANCE callout). Shows total tickets · breakdown · click → /me
// where TicketWalletCard handles purchase.
function AuditionTicketsCallout({ onSelect }: { onSelect: () => void }) {
  const { user } = useAuth()
  const [bal, setBal] = useState<{ free_remaining: number; paid_credit: number; total_tickets: number } | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    const load = () => {
      void supabase.rpc('ticket_balance', { p_member_id: user.id }).then(({ data, error }) => {
        if (!alive || error) return
        setBal(data as { free_remaining: number; paid_credit: number; total_tickets: number })
      })
    }
    load()
    const onUpdate = () => load()
    window.addEventListener('commitshow:tickets-updated', onUpdate)
    return () => {
      alive = false
      window.removeEventListener('commitshow:tickets-updated', onUpdate)
    }
  }, [user])

  const accent = 'var(--gold-500)'
  const total  = bal?.total_tickets ?? 0
  const tone   = total === 0 ? 'var(--text-muted)' : accent

  return (
    <NavLink
      to="/me"
      onClick={onSelect}
      className="block px-3 py-2 mb-1 transition-colors"
      style={{
        background: total === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(240,192,64,0.08)',
        border:     `1px solid ${total === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(240,192,64,0.4)'}`,
        borderRadius: '2px',
        textDecoration: 'none',
      }}
      onMouseEnter={e => { if (total > 0) e.currentTarget.style.borderColor = 'rgba(240,192,64,0.7)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = total === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(240,192,64,0.4)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
          AUDITION TICKETS
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: tone }}>
          {bal === null
            ? '—'
            : <><strong>{total}</strong><span style={{ color: 'var(--text-muted)' }}> ticket{total === 1 ? '' : 's'}</span></>}
        </span>
      </div>
      <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        {bal === null ? '…' : total === 0 ? (
          'Buy one in /me to put a backstage product on stage'
        ) : (
          <>
            {bal.free_remaining > 0 && <><span style={{ color: 'var(--cream)' }}>{bal.free_remaining} free</span></>}
            {bal.free_remaining > 0 && bal.paid_credit > 0 && <span style={{ color: 'var(--text-faint)' }}> · </span>}
            {bal.paid_credit > 0 && <><span style={{ color: 'var(--cream)' }}>{bal.paid_credit} paid</span></>}
            <span style={{ color: 'var(--text-muted)' }}> · spend on backstage products</span>
          </>
        )}
      </div>
    </NavLink>
  )
}

function MyProductsCallout({ onSelect }: { onSelect: () => void }) {
  const { user } = useAuth()
  const [counts, setCounts] = useState<{ total: number; encore: number; best: number | null }>({ total: 0, encore: 0, best: null })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('score_total')
        .eq('creator_id', user.id)
      if (!alive) return
      const rows = (data ?? []) as Array<{ score_total: number | null }>
      const total = rows.length
      const encore = rows.filter(r => (r.score_total ?? 0) >= 84).length
      const best   = rows.length === 0 ? null : Math.max(0, ...rows.map(r => r.score_total ?? 0))
      setCounts({ total, encore, best })
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [user])

  const accent     = '#A78BFA'   // creator-side violet · matches CreatorsPage
  const hasEncore  = counts.encore > 0
  const headerHint = hasEncore ? `${counts.encore} Encore` : counts.total === 0 ? 'No products yet' : 'Climb to 84+'

  return (
    <NavLink
      to="/me/products"
      onClick={onSelect}
      className="block px-3 py-2 mb-1 transition-colors"
      style={{
        background: `${accent}12`,
        border: `1px solid ${accent}40`,
        borderRadius: '2px',
        textDecoration: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = `${accent}80`)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = `${accent}40`)}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-label)' }}>
          MY PRODUCTS
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: hasEncore ? accent : 'var(--cream)' }}>
          {loaded ? <><strong>{counts.total}</strong><span style={{ color: 'var(--text-muted)' }}> total</span></> : '—'}
        </span>
      </div>
      <div className="font-mono text-[10px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
        <span style={{ color: hasEncore ? accent : 'var(--text-muted)' }}>{headerHint}</span>
        {counts.best != null && counts.best > 0 && (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>best <strong style={{ color: 'var(--cream)' }}>{counts.best}</strong>/100</span>
          </>
        )}
      </div>
    </NavLink>
  )
}
