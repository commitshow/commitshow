// MilestoneShareDropdown · single "Share milestone ▼" button with a popover
// listing each milestone the project has hit. Click a row → share that
// specific milestone via the cmo_templates user_share template.
//
// Replaces the prior "show only the most recent milestone" behavior so
// owners can share any of their accumulated milestones (first top 10,
// 100-day streak, all-categories-top-50, etc.) without losing access
// to older ones.

import { useEffect, useRef, useState } from 'react'
import { shareWithTemplate, type SlotMap } from '../lib/userShareTemplate'

function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export interface MilestoneRow {
  type:        string                 // canonical id from ladder_milestones.milestone_type
  label:       string                 // humanized label ("first top 10")
  category:    string | null
  achievedAt:  string                 // ISO timestamp
}

interface Props {
  milestones:    MilestoneRow[]       // sorted desc by achievedAt by caller
  projectName:   string
  projectId:     string
  rankFallback?: string | number      // current rank (best-effort) or empty
  url:           string
}

function relativeTime(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const day = Math.floor(ms / 86_400_000)
  if (day < 1)   return 'today'
  if (day === 1) return 'yesterday'
  if (day < 7)   return `${day}d ago`
  if (day < 30)  return `${Math.floor(day / 7)}w ago`
  if (day < 365) return `${Math.floor(day / 30)}mo ago`
  return `${Math.floor(day / 365)}y ago`
}

export function MilestoneShareDropdown({
  milestones, projectName, projectId, rankFallback, url,
}: Props) {
  const [open,  setOpen]  = useState(false)
  const [busy,  setBusy]  = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // Outside-click + Escape both close the popover. Standard pattern —
  // attaches once, toggles based on open state.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  if (milestones.length === 0) return null

  const shareOne = async (m: MilestoneRow) => {
    setBusy(true)
    const slots: SlotMap = {
      project_name:    projectName,
      milestone_label: m.label,
      rank:            rankFallback ?? '',
      category:        m.category ?? '',
      project_id:      projectId,
    }
    await shareWithTemplate('milestone', slots, url)
    setBusy(false)
    setOpen(false)
  }

  // Single-milestone fast path · skip the popover, fire the share immediately.
  // Most projects will be in this state for a while after a fresh hit.
  if (milestones.length === 1) {
    return (
      <button
        type="button"
        onClick={() => shareOne(milestones[0])}
        disabled={busy}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide"
        style={{
          background: 'transparent',
          color:      'var(--gold-500)',
          border:     '1px solid rgba(240,192,64,0.45)',
          borderRadius: '2px',
          padding:    '6px 12px',
          cursor:     busy ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
        aria-label="Share milestone on X"
      >
        <IconX size={12} />
        {busy ? 'OPENING…' : 'Share milestone'}
      </button>
    )
  }

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide"
        style={{
          background: 'transparent',
          color:      'var(--gold-500)',
          border:     '1px solid rgba(240,192,64,0.45)',
          borderRadius: '2px',
          padding:    '6px 12px',
          cursor:     busy ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Share milestone on X"
      >
        <IconX size={12} />
        {busy ? 'OPENING…' : `Share milestone · ${milestones.length}`}
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            minWidth: 280,
            maxWidth: 360,
            background: 'var(--navy-800)',
            border: '1px solid rgba(240,192,64,0.35)',
            borderRadius: 3,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          <div className="font-mono text-[10px] px-3 py-2"
               style={{ color: 'rgba(248,245,238,0.5)', letterSpacing: 2, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            PICK A MILESTONE TO SHARE
          </div>
          {milestones.map((m, i) => (
            <button
              key={`${m.type}-${i}`}
              role="option"
              type="button"
              onClick={() => shareOne(m)}
              disabled={busy}
              className="w-full text-left px-3 py-2.5 transition-colors"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                borderBottom: i < milestones.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,192,64,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div className="font-mono text-[12px]" style={{ color: 'var(--cream)' }}>{m.label}</div>
              <div className="font-mono text-[10px] mt-0.5" style={{ color: 'rgba(248,245,238,0.5)' }}>
                {relativeTime(m.achievedAt)}{m.category ? ` · ${m.category}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

// Shared milestone_type → label map · single source of truth so callers
// don't drift. Keys mirror the CHECK constraint on ladder_milestones.
export const MILESTONE_LABELS: Record<string, string> = {
  first_top_100:              'first top 100',
  first_top_10:               'first top 10',
  first_number_one:           'first #1',
  streak_100_days:            '100-day top-50 streak',
  climb_100_steps_in_30_days: '100-step climb in 30 days',
  all_categories_top_50:      'top 50 in every category',
}
