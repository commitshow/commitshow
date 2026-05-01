// Project comments · YouTube-mobile pattern applied to ALL viewports.
//
// The component renders ONE thing inline: a collapsed preview card showing
// up to 3 recent comments. Tapping anywhere on the card opens a right-side
// drawer with the full thread + composer.
//   · Mobile (< sm): the drawer is full-screen (true bottom-sheet feel).
//   · Desktop (≥ sm): the drawer slides in from the right, max-w-xl wide,
//     full viewport height. Backdrop dims the rest of the page.
//
// MVP scope: top-level comments only (no nested replies / upvotes / edit yet).
// ApplaudButton on each comment via target_type='comment' (existing
// polymorphic path · self-applaud blocked by trigger).

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { ApplaudButton } from './ApplaudButton'

interface CommentRow {
  id:          string
  text:        string
  member_id:   string | null
  parent_id:   string | null   // null = top-level · uuid = reply to that comment
  created_at:  string
  // Stage Manager system comments — populated by DB triggers (registered ·
  // score_jump · graduated). 'kind' defaults to 'human' on existing rows.
  kind?:       'human' | 'system'
  event_kind?: string | null
  event_meta?: Record<string, unknown> | null
  author?:     { id: string; display_name: string | null; avatar_url: string | null } | null
}

interface ProjectCommentsProps {
  projectId:      string
  viewerMemberId: string | null   // null = unauth
}

const MAX_LEN = 1000
const PREVIEW_COUNT = 3

export function ProjectComments({ projectId, viewerMemberId }: ProjectCommentsProps) {
  const [rows, setRows] = useState<CommentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('id, text, member_id, parent_id, created_at, kind, event_kind, event_meta, author:members!comments_member_id_fkey(id, display_name, avatar_url)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(400)
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

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!modalOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [modalOpen])

  // Top-level rows are the thread skeleton; replies hang under their parent.
  const topLevel = useMemo(() => rows.filter(r => !r.parent_id), [rows])
  const count = topLevel.length
  const previews = topLevel.slice(0, PREVIEW_COUNT)
  const repliesByParent = useMemo(() => {
    const m = new Map<string, CommentRow[]>()
    for (const r of rows) {
      if (!r.parent_id) continue
      const arr = m.get(r.parent_id) ?? []
      arr.push(r)
      m.set(r.parent_id, arr)
    }
    // Replies render oldest-first under their parent so the conversation
    // reads top-down even though the parent list is newest-first.
    for (const [k, arr] of m) m.set(k, [...arr].reverse())
    return m
  }, [rows])

  const handlePosted = (row: CommentRow) => {
    setRows(prev => [row, ...prev])
  }
  const handleDeleted = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalOpen(true) }
        }}
        aria-label={`Open comments · ${count} total`}
        className="card-navy text-left transition-colors"
        style={{ borderRadius: '2px', cursor: 'pointer' }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '' }}
      >
        <div className="px-3 py-2 flex items-center"
             style={{ borderBottom: previews.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
          <div className="font-mono text-[11px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>
            COMMENTS · <span className="tabular-nums" style={{ color: 'var(--cream)' }}>{count}</span>
          </div>
        </div>

        {loading ? (
          <div className="px-3 py-5 text-center font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            loading…
          </div>
        ) : count === 0 ? (
          <div className="px-3 py-5 text-center font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
            No comments yet — be the first to weigh in.
          </div>
        ) : (
          <ul>
            {previews.map((r, i) => {
              const sys = isSystem(r)
              return (
                <li
                  key={r.id}
                  className="px-3 py-2 flex items-center gap-2.5"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}
                >
                  {sys
                    ? <StageManagerAvatar />
                    : <Avatar
                        name={(r.author?.display_name || 'Anon').trim()}
                        url={r.author?.avatar_url ?? null}
                      />}
                  <div
                    className="flex-1 min-w-0 font-light text-sm leading-snug truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {r.text}
                  </div>
                  <span
                    className="font-mono text-[10px] shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatRelative(r.created_at)}
                  </span>
                </li>
              )
            })}
            {count > previews.length && (
              <li
                className="px-3 py-1.5 text-center font-mono text-[10px] tracking-wide"
                style={{
                  color: 'var(--text-muted)',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                +{count - previews.length} more
              </li>
            )}
          </ul>
        )}
      </div>

      {modalOpen && createPortal(
        <Drawer
          projectId={projectId}
          viewerMemberId={viewerMemberId}
          topLevel={topLevel}
          repliesByParent={repliesByParent}
          loading={loading}
          onClose={() => setModalOpen(false)}
          onPosted={handlePosted}
          onDeleted={handleDeleted}
        />,
        document.body,
      )}
    </>
  )
}

// ── Drawer · slides in from the right · width-capped on desktop ─────
function Drawer({
  projectId, viewerMemberId, topLevel, repliesByParent, loading,
  onClose, onPosted, onDeleted,
}: {
  projectId:       string
  viewerMemberId:  string | null
  topLevel:        CommentRow[]
  repliesByParent: Map<string, CommentRow[]>
  loading:         boolean
  onClose:         () => void
  onPosted:        (row: CommentRow) => void
  onDeleted:       (id: string) => void
}) {
  // Two-phase mount so the slide-in transition runs after the portal attaches.
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  // When set, the next post from the composer is a reply to this comment.
  const [replyTo, setReplyTo] = useState<{ id: string; displayName: string } | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const requestClose = () => {
    if (closing) return
    setClosing(true)
    setEntered(false)
    setTimeout(onClose, 220) // matches the CSS transition below
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
      style={{
        background: entered ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        transition: 'background 220ms ease',
      }}
    >
      <div
        className="
          flex flex-col
          w-full h-full
          sm:max-w-xl
        "
        style={{
          background:    'var(--navy-950)',
          borderLeft:    '1px solid rgba(255,255,255,0.08)',
          boxShadow:     entered ? '-12px 0 40px rgba(0,0,0,0.45)' : 'none',
          transform:     entered ? 'translateX(0)' : 'translateX(100%)',
          transition:    'transform 220ms cubic-bezier(0.32,0.72,0,1), box-shadow 220ms ease',
        }}
      >
        {/* header */}
        <div
          className="flex items-center px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'var(--navy-900)' }}
        >
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--text-secondary)' }}>
            COMMENTS · <span className="tabular-nums" style={{ color: 'var(--cream)' }}>{topLevel.length}</span>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="ml-auto font-mono text-base"
            style={{
              background: 'transparent',
              border:     'none',
              color:      'var(--text-primary)',
              padding:    '4px 8px',
              cursor:     'pointer',
            }}
            aria-label="Close comments"
          >
            ×
          </button>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <DrawerCommentList
            topLevel={topLevel}
            repliesByParent={repliesByParent}
            loading={loading}
            viewerMemberId={viewerMemberId}
            onDeleted={onDeleted}
            onReply={(id, displayName) => setReplyTo({ id, displayName })}
            activeReplyId={replyTo?.id ?? null}
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
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </div>
      </div>
    </div>
  )
}

// ── Comment list inside the drawer ──────────────────────────────────
function DrawerCommentList({
  topLevel, repliesByParent, loading, viewerMemberId, onDeleted, onReply, activeReplyId,
}: {
  topLevel:        CommentRow[]
  repliesByParent: Map<string, CommentRow[]>
  loading:         boolean
  viewerMemberId:  string | null
  onDeleted:       (id: string) => void
  onReply:         (id: string, displayName: string) => void
  activeReplyId:   string | null
}) {
  if (loading) {
    return (
      <div className="px-4 py-12 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        loading comments…
      </div>
    )
  }
  if (topLevel.length === 0) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="font-mono text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          THE ROOM IS QUIET
        </div>
        <div className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
          Drop the first read on this build.
        </div>
      </div>
    )
  }
  return (
    <ul>
      {topLevel.map((r, i) => {
        const replies = repliesByParent.get(r.id) ?? []
        return (
          <li key={r.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
            <CommentItem
              row={r}
              isFirst={true}
              viewerMemberId={viewerMemberId}
              onDeleted={onDeleted}
              onReply={onReply}
              isReplying={activeReplyId === r.id}
            />
            {replies.length > 0 && (
              <ul className="pl-8" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                {replies.map((rep, j) => (
                  <li key={rep.id} style={{ borderTop: j === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
                    <CommentItem
                      row={rep}
                      isFirst={true}
                      viewerMemberId={viewerMemberId}
                      onDeleted={onDeleted}
                      onReply={onReply}
                      isReplying={activeReplyId === rep.id}
                      isReply
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function CommentItem({
  row, isFirst, viewerMemberId, onDeleted, onReply, isReplying = false, isReply = false,
}: {
  row:            CommentRow
  isFirst:        boolean
  viewerMemberId: string | null
  onDeleted:      (id: string) => void
  onReply?:       (id: string, displayName: string) => void
  isReplying?:    boolean
  isReply?:       boolean
}) {
  const [busy, setBusy] = useState(false)
  const sys = isSystem(row)
  const isOwn = !sys && !!viewerMemberId && row.member_id === viewerMemberId
  const name = sys ? 'Stage Manager' : (row.author?.display_name || 'Anon').trim()
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
      className="px-2 py-3 flex items-start gap-3"
      style={{
        borderTop: isFirst ? 'none' : '1px solid rgba(255,255,255,0.06)',
        background: sys ? 'rgba(240,192,64,0.03)' : 'transparent',
      }}
    >
      {sys
        ? <StageManagerAvatar />
        : <Avatar name={name} url={row.author?.avatar_url ?? null} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <span
            className="font-mono text-[11px] tracking-wide"
            style={{ color: sys ? 'var(--cream)' : 'var(--gold-500)' }}
          >
            {sys ? 'Stage Manager' : '@' + name}
          </span>
          {sys && (
            <span
              className="font-mono text-[9px] tracking-widest px-1.5 py-0.5"
              style={{
                color: 'var(--gold-500)',
                border: '1px solid rgba(240,192,64,0.4)',
                borderRadius: '2px',
              }}
            >
              STAGE
            </span>
          )}
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
              onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = 'var(--scarlet)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              delete
            </button>
          )}
        </div>
        <div className="font-light text-sm leading-relaxed whitespace-pre-wrap break-words"
             style={{ color: 'var(--text-primary)' }}>
          {row.text}
        </div>
        {sys && row.event_meta && <SystemEventChips meta={row.event_meta} kind={row.event_kind ?? null} />}
        <div className="mt-2 flex items-center gap-3">
          <ApplaudButton
            targetType="comment"
            targetId={row.id}
            viewerMemberId={viewerMemberId}
            isOwnContent={isOwn}
            size="sm"
            variant="icon"
            label="Applaud"
          />
          {/* Reply only on top-level rows so threads stay 1 level deep
              (keeps the visual model simple · matches YouTube mobile). */}
          {!isReply && onReply && (
            <button
              type="button"
              onClick={() => onReply(row.id, name)}
              className="font-mono text-[11px] tracking-wide"
              style={{
                background: 'transparent',
                border:     'none',
                padding:    0,
                cursor:     'pointer',
                color:      isReplying ? 'var(--gold-500)' : 'var(--text-muted)',
                fontWeight: isReplying ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (!isReplying) e.currentTarget.style.color = 'var(--cream)' }}
              onMouseLeave={(e) => { if (!isReplying) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              reply
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

// Reaction primer chips · §2 Community exception (emoji allowed in comment
// input). Tap → prepend the glyph + space to the textarea + focus. Lowers
// the path from 'blank → paragraph' to 'tap → 5 words' on first comment.
const REACTION_PRIMERS = [
  { glyph: '🙌', label: 'nailed it' },
  { glyph: '🎯', label: 'sharp' },
  { glyph: '🔥', label: 'hot take' },
  { glyph: '🤔', label: 'not sure' },
  { glyph: '💡', label: 'idea' },
] as const

// Empty / general placeholder rotations — the textarea hint nudges the user
// without prescribing what to write.
const COMPOSER_PLACEHOLDERS = [
  'What jumped out in the audit?',
  'What would you ship next?',
  'Give the creator a note.',
  'First take from the room?',
  'Add to the discussion…',
] as const

// ── Composer ────────────────────────────────────────────────────────
function Composer({
  projectId, viewerMemberId, onPosted, autoFocus = false,
  replyTo = null, onCancelReply,
}: {
  projectId:      string
  viewerMemberId: string | null
  onPosted:       (row: CommentRow) => void
  autoFocus?:     boolean
  /** When set, the next post is a reply to this comment. */
  replyTo?:       { id: string; displayName: string } | null
  onCancelReply?: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Pick a placeholder once per mount so it doesn't flicker mid-type.
  const placeholder = useMemo(() => {
    if (replyTo) return `Replying to @${replyTo.displayName}…`
    return COMPOSER_PLACEHOLDERS[Math.floor(Math.random() * COMPOSER_PLACEHOLDERS.length)]
  }, [replyTo])

  useEffect(() => {
    if (autoFocus || replyTo) ref.current?.focus()
  }, [autoFocus, replyTo])

  if (!viewerMemberId) {
    return (
      <div
        className="px-4 py-3 font-mono text-xs flex items-center gap-2"
        style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '2px',
          color: 'var(--text-muted)',
          background: 'var(--navy-800)',
        }}
      >
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

  const insertPrimer = (glyph: string, label: string) => {
    const newPrefix = `${glyph} ${label} — `
    setText(prev => {
      // Strip any existing primer prefix so back-to-back taps swap cleanly.
      let stripped = prev
      for (const p of REACTION_PRIMERS) {
        const pp = `${p.glyph} ${p.label} — `
        if (stripped.startsWith(pp)) {
          stripped = stripped.slice(pp.length)
          break
        }
      }
      return newPrefix + stripped
    })
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      const pos = el.value.length
      el.setSelectionRange(pos, pos)
    })
  }

  const handleSubmit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setErr(null)
    const insertPayload: Record<string, unknown> = {
      project_id: projectId,
      member_id:  viewerMemberId,
      text:       trimmed,
    }
    if (replyTo) insertPayload.parent_id = replyTo.id
    const { data, error } = await supabase
      .from('comments')
      .insert(insertPayload)
      .select('id, text, member_id, parent_id, created_at, kind, event_kind, event_meta, author:members!comments_member_id_fkey(id, display_name, avatar_url)')
      .single()
    setBusy(false)
    if (error || !data) {
      console.error('[comments] post failed', error)
      setErr(error?.message ?? 'Could not post that comment.')
      return
    }
    onPosted(data as unknown as CommentRow)
    setText('')
    if (onCancelReply) onCancelReply()
  }

  return (
    <div
      className="px-3 py-3"
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '2px',
        background: 'var(--navy-800)',
      }}
    >
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px]"
             style={{ color: 'var(--text-secondary)' }}>
          <span>Replying to <span style={{ color: 'var(--gold-500)' }}>@{replyTo.displayName}</span></span>
          <button
            type="button"
            onClick={onCancelReply}
            className="ml-auto"
            style={{
              background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', color: 'var(--text-muted)',
            }}
            aria-label="Cancel reply"
          >
            × cancel
          </button>
        </div>
      )}

      {/* Reaction primer chips · §2 Community exception · emoji allowed in
          comment input */}
      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
        {REACTION_PRIMERS.map(p => (
          <button
            key={p.glyph}
            type="button"
            onClick={() => insertPrimer(p.glyph, p.label)}
            className="font-mono text-[11px] tracking-wide px-2 py-1 inline-flex items-center gap-1.5"
            style={{
              background:   'transparent',
              color:        'var(--text-secondary)',
              border:       '1px solid rgba(255,255,255,0.08)',
              borderRadius: '2px',
              cursor:       'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(240,192,64,0.45)'
              e.currentTarget.style.color = 'var(--cream)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            aria-label={`Insert ${p.label} reaction`}
          >
            <span aria-hidden="true">{p.glyph}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        maxLength={MAX_LEN}
        className="w-full font-light text-sm leading-relaxed resize-none commit-bare-textarea"
        style={{
          background: 'transparent',
          border:     'none',
          outline:    'none',
          boxShadow:  'none',
          color:      'var(--text-primary)',
          padding:    0,
          WebkitAppearance: 'none',
          WebkitTapHighlightColor: 'transparent',
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
              background:   valid && !busy ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)',
              color:        valid && !busy ? 'var(--navy-900)' : 'var(--text-muted)',
              border:       'none',
              borderRadius: '2px',
              cursor:       valid && !busy ? 'pointer' : 'not-allowed',
              fontWeight:   600,
            }}
          >
            {busy ? 'Posting…' : (replyTo ? 'Reply' : 'Post')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── System-comment helpers ──────────────────────────────────────────
function isSystem(r: CommentRow): boolean {
  return r.kind === 'system'
}

// Stage Manager glyph · gold line icon on navy tile · §4 OK because this
// IS the identity carrier for the agent (parallel to a user avatar).
function StageManagerAvatar() {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{
        width: 28, height: 28,
        background: 'var(--navy-700)',
        border: '1px solid rgba(240,192,64,0.4)',
        borderRadius: '2px',
      }}
      aria-label="Stage Manager"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" strokeWidth="1.5"
           strokeLinecap="round" strokeLinejoin="round"
           style={{ color: 'var(--gold-500)' }}
           aria-hidden="true">
        {/* curtain rod + two curtain folds — the "stage manager" mark */}
        <path d="M3 5h18" />
        <path d="M6 5v14c0 0 1.5-2 3-2s3 2 3 2" />
        <path d="M18 5v14c0 0 -1.5-2 -3-2s-3 2 -3 2" />
      </svg>
    </div>
  )
}

// Optional event chips below system messages: '↑ +12 · Round 3 · 82/100' etc.
// Only rendered when the trigger gave us structured meta; gracefully no-ops
// otherwise.
function SystemEventChips({ meta, kind }: { meta: Record<string, unknown>; kind: string | null }) {
  const items: string[] = []

  if (kind === 'score_jump') {
    const delta = typeof meta.delta === 'number' ? meta.delta : null
    const score = typeof meta.score_total === 'number' ? meta.score_total : null
    const round = typeof meta.round === 'number' ? meta.round : null
    if (delta !== null) items.push(`${delta > 0 ? '↑' : '↓'} ${delta > 0 ? '+' : ''}${delta}`)
    if (round !== null) items.push(`Round ${round}`)
    if (score !== null) items.push(`${score}/100`)
  } else if (kind === 'graduated') {
    const grade = typeof meta.grade === 'string' ? meta.grade : null
    const score = typeof meta.final_score === 'number' ? meta.final_score : null
    const season = meta.season != null ? String(meta.season) : null
    if (grade)  items.push(grade.toUpperCase())
    if (score !== null) items.push(`${score}/100`)
    if (season) items.push(`Season ${season}`)
  } else if (kind === 'registered') {
    const score = typeof meta.initial_score === 'number' ? meta.initial_score : null
    if (score !== null) items.push(`First read · ${score}/100`)
  }

  if (items.length === 0) return null

  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap font-mono text-[10px] tracking-wide"
         style={{ color: 'var(--text-muted)' }}>
      {items.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>·</span>}
          <span className="tabular-nums">{s}</span>
        </span>
      ))}
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
