// Shared monochrome line icons (CLAUDE.md §4 design rule).
// All icons use `stroke="currentColor"` so CSS `color` tints them. No emoji,
// no boxed tiles. Size defaults to 16px — callers override via `size` prop.

import type { SVGProps } from 'react'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'fill' | 'stroke'> {
  size?: number
}

function BaseIcon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

// ── Indicator icons ─────────────────────────────────────────
// Used inline next to stat numbers, provenance strips, etc.

export function IconGraduation(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <path d="M2 9l10-4 10 4-10 4L2 9z" />
      <path d="M6 11v4c0 1 2 2 6 2s6-1 6-2v-4" />
      <path d="M22 9v4" />
    </BaseIcon>
  )
}

export function IconWand(p: IconProps) {
  // Magic wand · "applied to repo" indicator
  return (
    <BaseIcon {...p}>
      <path d="M15 4V2M15 10V8M19 6h2M9 6h2" />
      <path d="M17.7 8.3L19 7 17.3 5.3" />
      <path d="M5 21l10-10 3 3L8 24" transform="translate(0, -3)" />
    </BaseIcon>
  )
}

export function IconLock(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <rect x="5" y="11" width="14" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </BaseIcon>
  )
}

export function IconForecast(p: IconProps) {
  // Bullseye · scout forecast indicator
  return (
    <BaseIcon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </BaseIcon>
  )
}

export function IconGift(p: IconProps) {
  // Gift / free-share button
  return (
    <BaseIcon {...p}>
      <path d="M3 9h18v4H3z" />
      <path d="M4 13v8h16v-8" />
      <path d="M12 9v12" />
      <path d="M12 9c-2-2-5-3-6-2s0 4 3 4c1 0 2 0 3-2z" />
      <path d="M12 9c2-2 5-3 6-2s0 4-3 4c-1 0-2 0-3-2z" />
    </BaseIcon>
  )
}

export function IconMenu(p: IconProps) {
  // Hamburger — three short lines, mobile nav toggle.
  return (
    <BaseIcon {...p}>
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </BaseIcon>
  )
}

export function IconClose(p: IconProps) {
  // × · close panel / dismiss
  return (
    <BaseIcon {...p}>
      <line x1="6"  y1="6"  x2="18" y2="18" />
      <line x1="18" y1="6"  x2="6"  y2="18" />
    </BaseIcon>
  )
}

export function IconBell(p: IconProps) {
  // Notifications — matches the rest of the line-icon family, no badge drawn.
  return (
    <BaseIcon {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </BaseIcon>
  )
}

export function IconLink(p: IconProps) {
  // Chain link · OAuth / external connect
  return (
    <BaseIcon {...p}>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </BaseIcon>
  )
}

export function IconApplaud(p: IconProps) {
  // Stylised clap / recognition burst
  return (
    <BaseIcon {...p}>
      <path d="M12 3v3" />
      <path d="M6 7l2 2" />
      <path d="M18 7l-2 2" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M8 15a4 4 0 1 0 8 0" />
      <path d="M10 19v2M14 19v2" />
    </BaseIcon>
  )
}

// ── Format icons (Library · Discovery) ──────────────────────
// Each format gets its own metaphor so they're distinguishable at a glance.

export function IconMcpConfig(p: IconProps) {
  // Plug · MCP connector
  return (
    <BaseIcon {...p}>
      <path d="M8 2v4M16 2v4" />
      <rect x="6" y="6" width="12" height="6" rx="1" />
      <path d="M12 12v4" />
      <path d="M9 16h6v4a3 3 0 0 1-6 0z" />
    </BaseIcon>
  )
}

export function IconIdeRules(p: IconProps) {
  // Document with lines · .cursorrules / .windsurfrules
  return (
    <BaseIcon {...p}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h7M9 16h7M9 8h3" />
    </BaseIcon>
  )
}

export function IconAgentSkill(p: IconProps) {
  // Sparkle · agent skill · learned capability
  return (
    <BaseIcon {...p}>
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3L12 3z" />
      <path d="M19 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </BaseIcon>
  )
}

export function IconProjectRules(p: IconProps) {
  // Scroll · CLAUDE.md / AGENTS.md project-level rules
  return (
    <BaseIcon {...p}>
      <path d="M4 5c0-1.1.9-2 2-2h11v16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M17 3c1.1 0 2 .9 2 2v14a3 3 0 0 1-3 3" />
      <path d="M8 8h5M8 12h5" />
    </BaseIcon>
  )
}

export function IconPromptPack(p: IconProps) {
  // Chat bubble · prompt library
  return (
    <BaseIcon {...p}>
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-4 4v-4H6a2 2 0 0 1-2-2z" />
      <path d="M8 9h8M8 12h5" />
    </BaseIcon>
  )
}

export function IconPatchRecipe(p: IconProps) {
  // Puzzle piece · integration recipe
  return (
    <BaseIcon {...p}>
      <path d="M10 3h4v3a1.5 1.5 0 1 0 3 0V3h4v4h-3a1.5 1.5 0 1 0 0 3h3v4h-3a1.5 1.5 0 1 1 0 3h3v4h-4v-3a1.5 1.5 0 1 0-3 0v3H3v-4h3a1.5 1.5 0 1 0 0-3H3v-4h3a1.5 1.5 0 1 0 0-3H3V3h4v3a1.5 1.5 0 1 0 3 0z" />
    </BaseIcon>
  )
}

export function IconScaffold(p: IconProps) {
  // Blueprint grid · forkable starter
  return (
    <BaseIcon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </BaseIcon>
  )
}

export function IconArtifactGeneric(p: IconProps) {
  // Generic document · legacy / unknown format
  return (
    <BaseIcon {...p}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
    </BaseIcon>
  )
}

// ── Role icons (Analysis expert panel) ──────────────────────

export function IconStaffEngineer(p: IconProps) {
  // Wrench · code execution lens
  return (
    <BaseIcon {...p}>
      <path d="M15 4a5 5 0 0 0-5 7l-7 7 3 3 7-7a5 5 0 0 0 7-5l-3 3-3-3z" />
    </BaseIcon>
  )
}

export function IconSecurityOfficer(p: IconProps) {
  // Shield · security lens
  return (
    <BaseIcon {...p}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </BaseIcon>
  )
}

export function IconDesigner(p: IconProps) {
  // Brush · design / UX lens
  return (
    <BaseIcon {...p}>
      <path d="M14 4l6 6-9 9-3-3z" />
      <path d="M10 18l-4 1 1-4" />
      <path d="M18 2l4 4" />
    </BaseIcon>
  )
}

export function IconCeo(p: IconProps) {
  // Trending up · product / positioning lens
  return (
    <BaseIcon {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h6v6" />
    </BaseIcon>
  )
}
