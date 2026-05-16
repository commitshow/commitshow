// Detail view for any Community post (build_log · stack · ask).
// Route: /community/:typeSegment/:id
// - Header strip: type + subtype + tags
// - Body rendered via PostBody (code fences · auto-link URLs · whitespace preserved)
// - ApplaudButton polymorphic, target_type = post.type
// - Author + linked project pulls (project link at footer when present)

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CommunityLayout } from '../components/CommunityLayout'
import { ApplaudButton } from '../components/ApplaudButton'
import { IconTrash } from '../components/icons'
import { PostBody } from '../components/PostBody'
import { PostCommentThread } from '../components/PostCommentThread'
import { getPost, deletePost, STACK_SUBTYPES, ASK_SUBTYPES, type PostWithAuthor } from '../lib/community'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { ApplaudTargetType, Project } from '../lib/supabase'

const SEGMENT_TO_TYPE: Record<string, PostWithAuthor['type']> = {
  'build-logs':   'build_log',
  'stacks':       'stack',
  'asks':         'ask',
  'office-hours': 'office_hours',
  'open-mic':     'open_mic',
}

export function CommunityPostDetailPage() {
  const { typeSegment, id } = useParams<{ typeSegment: string; id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [post, setPost] = useState<PostWithAuthor | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [linkedProject, setLinkedProject] = useState<Pick<Project, 'id' | 'project_name' | 'thumbnail_url'> | null>(null)
  // 2026-05-15 · own-post delete affordance · icon-only with native
  // confirm() guard (CEO ask · simplify to single trash icon). Cascades
  // via the existing community_posts delete RLS policy + applaud cascade
  // trigger; tag join rows go FK-on-delete.
  const [deleting,    setDeleting]    = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    getPost(id).then(p => {
      if (!p) { setNotFound(true); setLoading(false); return }
      // Guard against someone deep-linking /community/stacks/:id to a build_log row.
      const wantedType = typeSegment ? SEGMENT_TO_TYPE[typeSegment] : null
      if (wantedType && p.type !== wantedType) {
        navigate(`${listPathFor(p.type)}/${p.id}`, { replace: true })
        return
      }
      setPost(p)
      setLoading(false)
      if (p.linked_project_id) {
        supabase
          .from('projects')
          .select('id, project_name, thumbnail_url')
          .eq('id', p.linked_project_id)
          .maybeSingle()
          .then(({ data }) => setLinkedProject(data ?? null))
      }
    })
  }, [id, typeSegment, navigate])

  if (loading) {
    return (
      <CommunityLayout>
        <div className="font-mono text-xs text-center py-10" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      </CommunityLayout>
    )
  }
  if (notFound || !post) {
    return (
      <CommunityLayout>
        <div className="card-navy p-6 text-center" style={{ borderRadius: '2px' }}>
          <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>Post not found</div>
          <p className="font-mono text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            It may have been removed or the URL is wrong.
          </p>
          <button
            type="button"
            onClick={() => navigate('/community')}
            className="px-4 py-2 font-mono text-xs tracking-wide"
            style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
          >
            BACK TO COMMUNITY
          </button>
        </div>
      </CommunityLayout>
    )
  }

  const subtypeLabel = subtypeOf(post)
  const isOwnPost    = !!user && user.id === post.author_id

  async function handleDelete() {
    if (!post) return
    setDeleting(true)
    setDeleteError(null)
    const ok = await deletePost(post.id)
    if (!ok) {
      setDeleting(false)
      setDeleteError('Delete failed · try again in a moment.')
      return
    }
    // Navigate back to the list view (Open Mic / Build Logs / etc.) ·
    // matches the pattern after a successful publish.
    navigate(listPathFor(post.type))
  }
  // 2026-05-15 · applauds widened to cover every community post type
  // (CHECK constraint + ApplaudTargetType union extended in the same
  // batch). target_type maps 1:1 with post.type now — no fallback
  // gymnastics, every type is applaudable.
  const applaudType: ApplaudTargetType = post.type
  const applaudable = true

  return (
    <CommunityLayout>
      {/* Back link */}
      <button
        onClick={() => navigate(listPathFor(post.type))}
        className="mb-4 font-mono text-xs tracking-wide"
        style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold-500)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
      >
        ← BACK TO {labelFor(post.type).toUpperCase()}S
      </button>

      <article className="card-navy p-6 md:p-8" style={{ borderRadius: '2px', borderLeft: `3px solid ${typeAccent(post.type)}` }}>
        {/* Type + subtype + tags strip */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span
            className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
            style={{
              background: `${typeAccent(post.type)}1A`,
              color:      typeAccent(post.type),
              border:     `1px solid ${typeAccent(post.type)}55`,
              borderRadius: '2px',
            }}
          >
            {labelFor(post.type)}
          </span>
          {subtypeLabel && (
            <span className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', borderRadius: '2px' }}>
              {subtypeLabel}
            </span>
          )}
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {new Date(post.published_at ?? post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        {/* Title + TL;DR */}
        <h1 className="font-display font-black text-3xl md:text-4xl leading-tight mb-3" style={{ color: 'var(--cream)', letterSpacing: '-0.01em' }}>
          {post.title}
        </h1>
        {post.tldr && (
          <p className="font-light text-base mb-6" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>
            {post.tldr}
          </p>
        )}

        {/* Author row + Applaud */}
        <div className="flex items-center justify-between gap-3 mb-6 pb-4 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span
              className="inline-flex items-center justify-center overflow-hidden"
              style={{
                width: 24, height: 24,
                background: post.author?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                color: 'var(--navy-900)',
                borderRadius: '2px',
                fontSize: 12, fontWeight: 700,
              }}
            >
              {post.author?.avatar_url
                ? <img src={post.author.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                : resolveCreatorInitial({ display_name: post.author?.display_name })}
            </span>
            <span>by <strong style={{ color: 'var(--cream)' }}>{resolveCreatorName({ display_name: post.author?.display_name })}</strong></span>
            {post.author?.creator_grade && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
                <span style={{ color: 'var(--gold-500)' }}>{post.author.creator_grade}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {applaudable && (
              <ApplaudButton
                targetType={applaudType}
                targetId={post.id}
                viewerMemberId={user?.id ?? null}
                isOwnContent={isOwnPost}
                size="sm"
              />
            )}
            {/* Own-post delete · icon-only · native confirm() guard so the
                author doesn't fat-finger the kill on a Build Log they
                spent 20 min on. Cascade trigger handles applauds; tag
                join rows go FK-on-delete. */}
            {isOwnPost && (
              <button
                type="button"
                onClick={() => {
                  if (deleting) return
                  if (window.confirm('Delete this post? This can\'t be undone.')) {
                    handleDelete()
                  }
                }}
                disabled={deleting}
                aria-label={deleting ? 'Deleting post' : 'Delete this post'}
                title={deleting ? 'Deleting…' : 'Delete this post'}
                className="inline-flex items-center justify-center"
                style={{
                  width:  28,
                  height: 28,
                  background:   'transparent',
                  color:        deleting ? 'var(--text-faint)' : 'var(--text-muted)',
                  border:       '1px solid rgba(248,245,238,0.15)',
                  borderRadius: '2px',
                  cursor:       deleting ? 'wait' : 'pointer',
                  opacity:      deleting ? 0.6 : 1,
                }}
                onMouseEnter={e => {
                  if (!deleting) {
                    e.currentTarget.style.borderColor = 'var(--scarlet)'
                    e.currentTarget.style.color = 'var(--scarlet)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(248,245,238,0.15)'
                  e.currentTarget.style.color = 'var(--text-muted)'
                }}
              >
                <IconTrash size={14} />
              </button>
            )}
          </div>
        </div>
        {deleteError && (
          <div
            className="mb-4 px-3 py-2 font-mono text-xs"
            style={{
              background:   'rgba(200,16,46,0.08)',
              border:       '1px solid rgba(200,16,46,0.4)',
              borderRadius: '2px',
              color:        'var(--scarlet)',
            }}
          >
            {deleteError}
          </div>
        )}

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-5">
            {post.tags.map(tag => (
              <span
                key={tag}
                className="font-mono text-[10px] px-2 py-0.5"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '2px',
                }}
              >
                {/* Defensive strip · existing rows from before the
                    TagInput fix may still have a leading '#' (e.g.
                    '#vibe-life'). Strip + re-prepend so display is
                    always exactly one '#' regardless of stored shape. */}
                #{tag.replace(/^#+/, '')}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        {post.body && <PostBody source={post.body} />}

        {/* Linked project */}
        {linkedProject && (
          <div className="mt-8 pt-5" style={{ borderTop: '1px solid rgba(240,192,64,0.12)' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'var(--gold-500)' }}>
              // BUILT THIS FOR
            </div>
            <Link
              to={`/projects/${linkedProject.id}`}
              className="flex items-center gap-3 p-3"
              style={{
                background: 'rgba(240,192,64,0.04)',
                border: '1px solid rgba(240,192,64,0.2)',
                borderRadius: '2px',
                textDecoration: 'none',
              }}
            >
              {linkedProject.thumbnail_url && (
                <img
                  src={linkedProject.thumbnail_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: '2px' }}
                />
              )}
              <span className="font-display font-bold text-base" style={{ color: 'var(--cream)' }}>
                {linkedProject.project_name}
              </span>
              <span className="ml-auto font-mono text-xs" style={{ color: 'var(--gold-500)' }}>View product ↗</span>
            </Link>
          </div>
        )}

        {/* Comment thread · full CRUD per CEO's basic-CRUD pattern.
            R/U/D author-only, C signed-in. Sits at the bottom of the
            article so the post body reads top-down before threading. */}
        <PostCommentThread postId={post.id} />
      </article>
    </CommunityLayout>
  )
}

function typeAccent(type: PostWithAuthor['type']): string {
  switch (type) {
    case 'build_log':    return '#F0C040'
    case 'stack':        return '#60A5FA'
    case 'ask':          return '#A78BFA'
    case 'office_hours': return '#00D4AA'
    case 'open_mic':     return '#F0C040'
  }
}

function labelFor(type: PostWithAuthor['type']): string {
  switch (type) {
    case 'build_log':    return 'Build Log'
    case 'stack':        return 'Stack'
    case 'ask':          return 'Ask'
    case 'office_hours': return 'Office Hours'
    case 'open_mic':     return 'Open Mic'
  }
}

function listPathFor(type: PostWithAuthor['type']): string {
  switch (type) {
    case 'build_log':    return '/community/build-logs'
    case 'stack':        return '/community/stacks'
    case 'ask':          return '/community/asks'
    case 'office_hours': return '/community/office-hours'
    case 'open_mic':     return '/community/open-mic'
  }
}

function subtypeOf(post: PostWithAuthor): string | null {
  if (!post.subtype) return null
  if (post.type === 'stack') return STACK_SUBTYPES[post.subtype as keyof typeof STACK_SUBTYPES] ?? null
  if (post.type === 'ask')   return ASK_SUBTYPES[post.subtype as keyof typeof ASK_SUBTYPES] ?? null
  return null
}
