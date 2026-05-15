// PostCommentThread — full CRUD on community post comments · 2026-05-15.
//
// Sits at the bottom of CommunityPostDetailPage. Implements R / C / U / D:
//   · Read   — flat chronological list (oldest first)
//   · Create — single textarea + post button below the thread; signed-in only
//   · Update — author can flip a row into edit mode (textarea + save/cancel)
//   · Delete — author can remove their comment with a native-confirm guard
//
// Design notes:
//   · Flat structure for V1 · threaded replies stay in the schema
//     (parent_id column ready) but we don't render them yet — keeps
//     the UI simple while the platform decides whether threading is
//     worth the moderation cost. Adding the threaded view later is a
//     pure-render change, no schema migration.
//   · No optimistic insert · we wait for the server roundtrip and
//     refetch so the new row carries the FK-joined author profile.
//     Latency is < 200ms in practice; UX cost negligible vs the
//     complexity of optimistic rollback on insert failure.
//   · Soft 16px textarea baseline so iOS Safari doesn't zoom on focus
//     (frame 12 mobile_input_zoom).

import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import {
  listPostComments, createPostComment, updatePostComment, deletePostComment,
  type PostCommentWithAuthor,
} from '../lib/community'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'
import { IconTrash } from './icons'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)         return 'just now'
  if (ms < 3_600_000)      return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)     return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function PostCommentThread({ postId }: { postId: string }) {
  const { user } = useAuth()
  const [comments, setComments] = useState<PostCommentWithAuthor[]>([])
  const [loading,  setLoading]  = useState(true)
  const [body,     setBody]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listPostComments(postId).then(rows => {
      if (alive) {
        setComments(rows)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [postId])

  async function refresh() {
    const rows = await listPostComments(postId)
    setComments(rows)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const trimmed = body.trim()
    if (trimmed.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await createPostComment({ post_id: postId, body: trimmed })
      setBody('')
      await refresh()
    } catch (err) {
      setError((err as Error).message || 'Comment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8">
      <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--gold-500)' }}>
        // COMMENTS {comments.length > 0 && <span style={{ color: 'var(--text-muted)' }}>· {comments.length}</span>}
      </div>

      {loading ? (
        <div className="font-mono text-xs py-3" style={{ color: 'var(--text-muted)' }}>
          loading comments…
        </div>
      ) : comments.length === 0 ? (
        <div
          className="px-4 py-3 mb-4 font-mono text-xs"
          style={{
            background:   'rgba(255,255,255,0.02)',
            border:       '1px dashed rgba(255,255,255,0.08)',
            color:        'var(--text-muted)',
            borderRadius: '2px',
          }}
        >
          No comments yet · be the first to reply.
        </div>
      ) : (
        <ul className="space-y-3 mb-5">
          {comments.map(c => (
            <CommentRow
              key={c.id}
              comment={c}
              viewerId={user?.id ?? null}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {/* Compose · signed-in only · soft prompt when not */}
      {user ? (
        <form onSubmit={handleSubmit} className="card-navy p-3" style={{ borderRadius: '2px' }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Add a comment · what stood out, what you'd try next…"
            rows={2}
            className="w-full px-2 py-1.5 font-mono"
            style={{
              background:   'transparent',
              color:        'var(--cream)',
              border:       '1px solid rgba(255,255,255,0.08)',
              borderRadius: '2px',
              resize:       'vertical',
              fontSize:     '16px',  // iOS zoom prevention · frame 12
              minHeight:    44,
              fontFamily:   'DM Mono, monospace',
            }}
            disabled={busy}
          />
          {error && (
            <div className="mt-2 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>
              {error}
            </div>
          )}
          <div className="flex items-center justify-between mt-2 gap-2">
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {body.length > 0 && `${body.trim().length} char${body.trim().length === 1 ? '' : 's'}`}
            </div>
            <button
              type="submit"
              disabled={busy || body.trim().length === 0}
              className="px-4 py-1.5 font-mono text-xs font-medium tracking-wide"
              style={{
                background:   body.trim().length === 0 ? 'transparent' : 'var(--gold-500)',
                color:        body.trim().length === 0 ? 'var(--text-muted)' : 'var(--navy-900)',
                border:       body.trim().length === 0 ? '1px solid rgba(248,245,238,0.15)' : 'none',
                borderRadius: '2px',
                cursor:       busy ? 'wait' : body.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity:      busy ? 0.6 : 1,
              }}
            >
              {busy ? 'POSTING…' : 'POST COMMENT'}
            </button>
          </div>
        </form>
      ) : (
        <div
          className="px-4 py-3 font-mono text-xs"
          style={{
            background:   'rgba(255,255,255,0.02)',
            border:       '1px solid rgba(255,255,255,0.08)',
            color:        'var(--text-secondary)',
            borderRadius: '2px',
          }}
        >
          Sign in to comment.
        </div>
      )}
    </section>
  )
}

function CommentRow({
  comment, viewerId, onChanged,
}: {
  comment:  PostCommentWithAuthor
  viewerId: string | null
  onChanged: () => Promise<void>
}) {
  const [editing,   setEditing]   = useState(false)
  const [draft,     setDraft]     = useState(comment.body)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const isOwn = !!viewerId && viewerId === comment.author_id
  const edited = comment.updated_at && comment.updated_at !== comment.created_at

  async function saveEdit() {
    if (busy) return
    const trimmed = draft.trim()
    if (trimmed.length === 0 || trimmed === comment.body) {
      setEditing(false)
      setDraft(comment.body)
      return
    }
    setBusy(true)
    setError(null)
    const ok = await updatePostComment(comment.id, trimmed)
    setBusy(false)
    if (!ok) {
      setError('Edit failed · try again')
      return
    }
    setEditing(false)
    await onChanged()
  }

  async function confirmDelete() {
    if (busy) return
    if (!window.confirm('Delete this comment? This can\'t be undone.')) return
    setBusy(true)
    setError(null)
    const ok = await deletePostComment(comment.id)
    setBusy(false)
    if (!ok) {
      setError('Delete failed · try again')
      return
    }
    await onChanged()
  }

  return (
    <li
      className="px-3 py-2.5"
      style={{
        background:   'rgba(15,32,64,0.4)',
        border:       '1px solid rgba(255,255,255,0.06)',
        borderRadius: '2px',
      }}
    >
      {/* Author + time + actions */}
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span
            className="inline-flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{
              width:        20, height: 20,
              background:   comment.author?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
              color:        'var(--navy-900)',
              borderRadius: '2px',
              fontSize:     11, fontWeight: 700,
            }}
          >
            {comment.author?.avatar_url
              ? <img src={comment.author.avatar_url} alt="" loading="lazy" className="w-full h-full" style={{ objectFit: 'cover' }} />
              : resolveCreatorInitial({ display_name: comment.author?.display_name })}
          </span>
          <span style={{ color: 'var(--cream)' }}>
            {resolveCreatorName({ display_name: comment.author?.display_name })}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>· {timeAgo(comment.created_at)}</span>
          {edited && (
            <span style={{ color: 'var(--text-faint)' }} title={`edited ${timeAgo(comment.updated_at)}`}>
              · edited
            </span>
          )}
        </div>
        {isOwn && !editing && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setEditing(true); setDraft(comment.body) }}
              disabled={busy}
              className="px-2 py-0.5 font-mono text-[10px] tracking-widest"
              style={{
                background:   'transparent',
                color:        'var(--text-muted)',
                border:       '1px solid rgba(248,245,238,0.15)',
                borderRadius: '2px',
                cursor:       busy ? 'wait' : 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold-500)'; e.currentTarget.style.color = 'var(--gold-500)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(248,245,238,0.15)'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              EDIT
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              aria-label="Delete comment"
              title="Delete this comment"
              className="inline-flex items-center justify-center"
              style={{
                width:        22, height: 22,
                background:   'transparent',
                color:        'var(--text-muted)',
                border:       '1px solid rgba(248,245,238,0.15)',
                borderRadius: '2px',
                cursor:       busy ? 'wait' : 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--scarlet)'; e.currentTarget.style.color = 'var(--scarlet)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(248,245,238,0.15)'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <IconTrash size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Body · display vs edit */}
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 font-mono"
            style={{
              background:   'rgba(6,12,26,0.5)',
              color:        'var(--cream)',
              border:       '1px solid rgba(240,192,64,0.35)',
              borderRadius: '2px',
              resize:       'vertical',
              fontSize:     '16px',
              minHeight:    40,
              fontFamily:   'DM Mono, monospace',
            }}
            disabled={busy}
            autoFocus
          />
          {error && <div className="mt-1 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{error}</div>}
          <div className="flex items-center gap-2 mt-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(comment.body); setError(null) }}
              disabled={busy}
              className="px-2.5 py-1 font-mono text-[10px] tracking-widest"
              style={{
                background:   'transparent',
                color:        'var(--text-muted)',
                border:       '1px solid rgba(248,245,238,0.15)',
                borderRadius: '2px',
                cursor:       busy ? 'wait' : 'pointer',
              }}
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={busy || draft.trim().length === 0}
              className="px-2.5 py-1 font-mono text-[10px] tracking-widest font-medium"
              style={{
                background:   'var(--gold-500)',
                color:        'var(--navy-900)',
                border:       'none',
                borderRadius: '2px',
                cursor:       busy ? 'wait' : 'pointer',
                opacity:      busy || draft.trim().length === 0 ? 0.6 : 1,
              }}
            >
              {busy ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </div>
      ) : (
        <p
          className="font-light text-sm whitespace-pre-wrap"
          style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}
        >
          {comment.body}
        </p>
      )}
      {error && !editing && (
        <div className="mt-1 font-mono text-xs" style={{ color: 'var(--scarlet)' }}>{error}</div>
      )}
    </li>
  )
}
