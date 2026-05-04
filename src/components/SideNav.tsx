// Desktop sidebar · 2026-05-05.
//
// PRIMARY_LINKS expanded to 5 (Products / Creators / Scouts / Community
// / Library) so the top nav was getting tight on smaller laptops. The
// sidebar moves the primary navigation off the top bar and gives each
// link more breathing room. Top bar keeps logo · search · Audition CTA
// · profile dropdown; sidebar carries the destinations.
//
// Mobile (below md) doesn't render this sidebar — the existing
// hamburger / slide-down panel inside Nav.tsx handles that case.

import { NavLink } from 'react-router-dom'

interface PrimaryLink { to: string; label: string }

interface Props {
  links: PrimaryLink[]
}

export function SideNav({ links }: Props) {
  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-16 bottom-0 w-[200px] py-5 z-40"
      aria-label="Primary"
      style={{
        background: 'rgba(6, 12, 26, 0.7)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <nav className="flex-1 flex flex-col gap-1 px-3">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className="px-3 py-2.5 font-mono text-sm tracking-wide transition-colors"
            style={({ isActive }) => ({
              color:        isActive ? 'var(--gold-500)' : 'var(--cream)',
              background:   isActive ? 'rgba(240,192,64,0.08)' : 'transparent',
              borderLeft:   `2px solid ${isActive ? 'var(--gold-500)' : 'transparent'}`,
              borderRadius: '2px',
              textDecoration: 'none',
            })}
            onMouseEnter={e => {
              if (!e.currentTarget.style.borderLeftColor.includes('var')) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }
            }}
            onMouseLeave={e => {
              if (!e.currentTarget.style.borderLeftColor.includes('var')) {
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      {/* Footer · brand mark + version anchor for the sidebar.
          Subtle mono caption that the sidebar isn't 'just nav', it's
          identity carrier on the desktop layout. */}
      <div className="px-5 py-3 mt-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
        // commit.show
      </div>
    </aside>
  )
}
