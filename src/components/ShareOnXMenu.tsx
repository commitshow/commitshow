// ShareOnXMenu · single "Share on X ▼" entry point that opens a
// picker listing every shareable event for the current project state.
// Replaces three separate buttons (audit · graduation · milestone)
// in the project header — cleaner mobile footprint and consistent
// dropdown pattern.
//
// Caller assembles a `ShareOption[]` based on what's currently true:
//   always        · audit_complete
//   if graduated  · graduation
//   per milestone · milestone (N rows)

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shareWithTemplate, type UserShareTemplateId, type SlotMap } from '../lib/userShareTemplate'

function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export interface ShareOption {
  /** Unique key per option (e.g. 'audit' · 'graduation' · 'milestone:first_top_10'). */
  key:        string
  /** What user sees in the picker · e.g. "audit · 82/100" · "graduation · Honors". */
  label:      string
  /** Sublabel / context · "today" · "82/100 · strong" · "first hit". */
  sub?:       string
  /** Visual emphasis · 'primary' lights up gold, 'normal' is default. */
  emphasis?:  'primary' | 'normal'
  templateId: UserShareTemplateId
  slots:      SlotMap
}

interface Props {
  options: ShareOption[]
  url:     string
  /** Render-as variant for the trigger button.
   *  · `default` ghost · `compact` smaller padding for tight rows. */
  variant?: 'default' | 'compact'
}

export function ShareOnXMenu({ options, url, variant = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)
  const wrapRef    = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Position the portal-rendered popover anchored to the trigger button.
  // Recompute on open + on window resize/scroll so it stays glued.
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setCoords({
        top:   r.bottom + 6,
        right: window.innerWidth - r.right,
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll',  recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll',  recompute, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      // Trigger button stays inside the wrap; popover lives in a portal,
      // so we have to check both refs separately.
      if (wrapRef.current?.contains(t))    return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  if (options.length === 0) return null

  const fire = async (opt: ShareOption) => {
    setBusy(true)
    // 2026-05-05 · don't pass url separately. Templates already embed
    // the canonical commit.show/project/{slug} URL inside the body
    // text; passing &url= on top of that produced a duplicate URL in
    // the rendered tweet. Letting X auto-detect from the body keeps
    // the unfurled card behavior without the duplication.
    await shareWithTemplate(opt.templateId, opt.slots)
    setBusy(false)
    setOpen(false)
  }

  // Always open the picker, even for a single option — owners want to
  // see what they're about to tweet before X grabs the tab. Removed the
  // single-option fast path because it surprised owners who expected
  // the menu to be the canonical preview surface.

  const popover = open && coords ? createPortal(
    <div
      ref={popoverRef}
      role="listbox"
      style={{
        position: 'fixed',
        top:      coords.top,
        right:    coords.right,
        zIndex:   1000,                       // above sticky nav (z-50) + project-detail layers
        minWidth: 280,
        maxWidth: 360,
        background: 'var(--navy-800)',
        border:    '1px solid rgba(240,192,64,0.35)',
        borderRadius: 3,
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      <div className="font-mono text-[10px] px-3 py-2"
           style={{ color: 'rgba(248,245,238,0.5)', letterSpacing: 2, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        PICK WHAT TO SHARE
      </div>
      {options.map((opt, i) => (
        <button
          key={opt.key}
          role="option"
          type="button"
          onClick={() => fire(opt)}
          disabled={busy}
          className="w-full text-left px-3 py-2.5 transition-colors"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: busy ? 'wait' : 'pointer',
            borderBottom: i < options.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,192,64,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <div className="font-mono text-[12px]"
               style={{ color: opt.emphasis === 'primary' ? 'var(--gold-500)' : 'var(--cream)' }}>
            {opt.label}
          </div>
          {opt.sub && (
            <div className="font-mono text-[10px] mt-0.5" style={{ color: 'rgba(248,245,238,0.5)' }}>{opt.sub}</div>
          )}
        </button>
      ))}
    </div>,
    document.body,
  ) : null

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide"
        style={{
          background: 'transparent',
          color:      'var(--gold-500)',
          border:     '1px solid rgba(240,192,64,0.45)',
          borderRadius: '2px',
          padding:    variant === 'compact' ? '4px 10px' : '6px 12px',
          cursor:     busy ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Share on X"
      >
        <IconX size={12} />
        {busy ? 'OPENING…' : 'Share on X'}
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>▼</span>
      </button>
      {popover}
    </span>
  )
}
