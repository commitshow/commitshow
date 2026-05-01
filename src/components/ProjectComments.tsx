// Project comments · YouTube-mobile pattern.
//
// Mobile (< sm): collapsed preview row showing count + top comment teaser.
// Tap → full-screen bottom sheet (portal) with the thread + composer.
//
// Desktop (≥ sm): inline thread, always expanded, composer below.
//
// MVP scope: top-level comments only (no nested replies, upvotes, edit/delete
// yet — schema supports them, can layer in later). Self-comment applaud is
// blocked by the existing trigger; we render the ApplaudButton anyway and let
// the trigger reject when relevant.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { ApplaudButton } from './ApplaudButton'

interface CommentRow {
  id:         string
  text:       string
  member_id:  string | null
  created_at: string
  author?:    { id: string; display_name: string | null; avatar_url: string | null } | null
}

interface ProjectCommentsProps {
  projectId:      string
  viewerMemberId: string | null   // null = unauth
}

const MAX_LEN = 1000

export function ProjectComments({ projectId, viewerMemberId }: ProjectCommentsProps) {
  const [rows, setRows] = useState<CommentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('id, text, member_id, created_at, author:members(id, display_name, avatar_url)')
        .eq('project_id', projectId)
        .is('parent_id', null)        // top-level only for now
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (error) {
        console.error('[comments] load failed', error)
        setRows([])
      } else {
        setRows((data ?? []) as unknown as CommentRow[])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId])

  const count = rows.length
  const top = rows[0] ?? null

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const handlePosted = (newRow: CommentRow) => {
    // Optimistic prepend; real refetch happens implicitly on remount.
    setRows(prev => [newRow, ...prev])
  }

  const handleDeleted = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  return (
    <>
      {/* ── Mobile collapsed preview row · only < sm ── */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="sm:hidden w-full text-left card-navy px-4 py-3 flex items-start gap-3"
        style={{ borderRadius: '2px', cursor: 'pointer' }}
        aria-label="Open comments"
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            COMMENTS · {count}
          </div>
          {loading ? (
            <div className="font-light text-sm" style={{ color: 'var(--text-faint)' }}>
              loading…
            </div>
          ) : top ? (
            <CommentPreviewLine row={top} />
          ) : (
            <div className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
              Be the first to weigh in.
            </div>
          )}
        </div>
        <div className="font-mono text-base shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true">
          →
        </div>
      </button>

      {/* ── Desktop inline thread · only ≥ sm ── */}
      <div className="hidden sm:block">
        <CommentList
          rows={rows}
          loading={loading}
          viewerMemberId={viewerMemberId}
          onDeleted={handleDeleted}
        />
        <div className="mt-4">
          <Composer
            projectId={projectId}
            viewerMemberId={viewerMemberId}
            onPosted={handlePosted}
          />
        </div>
      </div>

      {/* ── Mobile bottom sheet portal ── */}
      {mobileOpen && createPortal(
        <MobileSheet
          projectId={projectId}
          viewerMemberId={viewerMemberId}
          rows={rows}
          loading={loading}
          onClose={() => setMobileOpen(false)}
          onPosted={handlePosted}
          onDeleted={handleDeleted}
        />,
        document.body,
      )}
    </>
  )
}

// ── Mobile preview line · author + 1-line teaser ────────────────────
function CommentPreviewLine({ row }: { row: CommentRow }) {
  const name = row.author?.display_name?.trim() || 'Anon'
  return (
    <div className="font-light text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
      <span className="font-mono text-[11px]" style={{ color: 'var(--gold-500)' }}>@{name}</span>
      <span className="mx-1.5" style={{ color: 'var(--text-faint)' }}>·</span>
      <span className="line-clamp-1">{row.text}</span>
    </div>
  )
}

// ── Comment list ────────────────────────────────────────────────────
function CommentList({
  rows, loading, viewerMemberId, onDeleted,
}: {
  rows:           CommentRow[]
  loading:        boolean
  viewerMemberId: string | null
  onDeleted:      (id: string) => void
}) {
  if (loading) {
    return (
      <div className="card-navy px-4 py-8 text-center font-mono text-xs"
           style={{ borderRadius: '2px', color: 'var(--text-muted)' }}>
        loading comments…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="card-navy px-4 py-8 text-center"
           style={{ borderRadius: '2px' }}>
        <div className="font-mono text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          NO COMMENTS YET
        </div>
        <div className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
          Be the first to weigh in on this build.
        </div>
      </div>
    )
  }
  return (
    <ul className="card-navy" style={{ borderRadius: '2px', overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <CommentItem
          key={r.id}
          row={r}
          isFirst={i === 0}
          viewerMemberId={viewerMemberId}
          onDeleted={onDeleted}
        />
      ))}
    </ul>
  )
}

// ── Single comment row ──────────────────────────────────────────────
function CommentItem({
  row, isFirst, viewerMemberId, onDeleted,
}: {
  row:            CommentRow
  isFirst:        boolean
  viewerMemberId: string | null
  onDeleted:      (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const isOwn = !!viewerMemberId && row.member_id === viewerMemberId
  const name = row.author?.display_name?.trim() || 'Anon'
  const time = useMemo(() => formatRelative(row.created_at), [row.created_at])

  const handleDelete = async () => {
    if (!isOwn || busy) return
    if (!window.confirm('Delete this comment?')) return
    setBusy(true)
    const { error } = await supabase.from('comments').delete().eq('id', row.id)
    setBusy(false)
    if (error) {
      console.error('[comments] delete failed', error)
      window.alert('Could not delete that comment. Try again.')
      return
    }
    onDeleted(row.id)
  }

  return (
    <li
      className="px-4 py-3 flex items-start gap-3"
      style={{
        borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <Avatar name={name} url={row.author?.avatar_url ?? null} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-mono text-[11px] tracking-wide" style={{ color: 'var(--gold-500)' }}>
            @{name}
          </span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {time}
          </span>
          {isOwn && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="ml-auto font-mono text-[10px] tracking-wide"
              style={{
                background: 'transparent',
                border:     'none',
                padding:    0,
                cursor:     busy ? 'wait' : 'pointer',
                color:      'var(--text-muted)',
              }}
              onMouseEnter={e => { if (!busy) e.currentTarget.style.color = 'var(--scarlet)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              delete
            </button>
          )}
        </div>
        <div className="font-light text-sm leading-relaxed whitespace-pre-wrap break-words"
             style={{ color: 'var(--text-primary)' }}>
          {row.text}
        </div>
        <div className="mt-2">
          <ApplaudButton
            targetType="comment"
            targetId={row.id}
            viewerMemberId={viewerMemberId}
            isOwnContent={isOwn}
            size="sm"
            variant="icon"
            label="Applaud"
          />
        </div>
      </div>
    </li>
  )
}

// ── Composer ────────────────────────────────────────────────────────
function Composer({
  projectId, viewerMemberId, onPosted, autoFocus = false,
}: {
  projectId:      string
  viewerMemberId: string | null
  onPosted:       (row: CommentRow) => void
  autoFocus?:     boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  if (!viewerMemberId) {
    return (
      <div className="card-navy px-4 py-3 font-mono text-xs flex items-center gap-2"
           style={{ borderRadius: '2px', color: 'var(--text-muted)' }}>
        <span>Sign in to comment.</span>
        <a
          href="/me"
          className="ml-auto"
          style={{ color: 'var(--gold-500)', textDecoration: 'none' }}
        >
          → Sign in
        </a>
      </div>
    )
  }

  const trimmed = text.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_LEN

  const handleSubmit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase
      .from('comments')
      .insert({ project_id: projectId, member_id: viewerMemberId, text: trimmed })
      .select('id, text, member_id, created_at, author:members(id, display_name, avatar_url)')
      .single()
    setBusy(false)
    if (error || !data) {
      console.error('[comments] post failed', error)
      setErr(error?.message ?? 'Could not post that comment.')
      return
    }
    onPosted(data as unknown as CommentRow)
    setText('')
  }

  return (
    <div className="card-navy px-3 py-3" style={{ borderRadius: '2px' }}>
      <textarea
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a comment…"
        rows={2}
        maxLength={MAX_LEN}
        className="w-full font-light text-sm leading-relaxed resize-none"
        style={{
          background: 'transparent',
          border:     'none',
          outline:    'none',
          color:      'var(--text-primary)',
          padding:    0,
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {trimmed.length}/{MAX_LEN}
        </span>
        <div className="flex items-center gap-2">
          {err && (
            <span className="font-mono text-[10px]" style={{ color: 'var(--scarlet)' }}>
              {err}
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || busy}
            className="font-mono text-[11px] tracking-wide px-3 py-1.5"
            style={{
              background:  valid && !busy ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)',
              color:       valid && !busy ? 'var(--navy-900)' : 'var(--text-muted)',
              border:      'none',
              borderRadius:'2px',
              cursor:      valid && !busy ? 'pointer' : 'not-allowed',
              fontWeight:  600,
            }}
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Mobile bottom sheet (full-screen on phones) ─────────────────────
function MobileSheet({
  projectId, viewerMemberId, rows, loading, onClose, onPosted, onDeleted,
}: {
  projectId:      string
  viewerMemberId: string | null
  rows:           CommentRow[]
  loading:        boolean
  onClose:        () => void
  onPosted:       (row: CommentRow) => void
  onDeleted:      (id: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--navy-950)' }}
    >
      {/* header */}
      <div
        className="flex items-center px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'var(--navy-900)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-base"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', padding: '4px 8px', cursor: 'pointer' }}
          aria-label="Close comments"
        >
          ←
        </button>
        <div className="ml-2 font-mono text-xs tracking-widest" style={{ color: 'var(--text-secondary)' }}>
          COMMENTS · {rows.length}
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <CommentList
          rows={rows}
          loading={loading}
          viewerMemberId={viewerMemberId}
          onDeleted={onDeleted}
        />
      </div>

      {/* composer pinned bottom */}
      <div
        className="shrink-0 px-3 pt-3 pb-4"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'var(--navy-900)' }}
      >
        <Composer
          projectId={projectId}
          viewerMemberId={viewerMemberId}
          onPosted={onPosted}
          autoFocus
        />
      </div>
    </div>
  )
}

// ── Avatar tile (allowed by §4 — identity carrier, not an icon) ─────
function Avatar({ name, url }: { name: string; url: string | null }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{
        width: 28, height: 28,
        background: url ? 'transparent' : 'var(--navy-700)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <img src={url} alt="" width={28} height={28} style={{ objectFit: 'cover', display: 'block' }} />
      ) : (
        <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{initial}</span>
      )}
    </div>
  )
}

// ── relative time ───────────────────────────────────────────────────
function formatRelative(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ''
  const diff = Date.now() - d
  const sec = Math.floor(diff / 1000)
  if (sec < 60)        return 'just now'
  if (sec < 3600)      return `${Math.floor(sec / 60)}m ago`
  if (sec < 86_400)    return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604_800)   return `${Math.floor(sec / 86_400)}d ago`
  return new Date(iso).toLocaleDateString()
}
