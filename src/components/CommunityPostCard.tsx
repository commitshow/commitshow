// List card for a Community post (Build Log · Stack · Ask).
// Links into a detail page (wired in P4c); P4a keeps the link as a stub so
// users see the card with no 404 surprises until detail pages land.

import { Link } from 'react-router-dom'
import type { PostWithAuthor } from '../lib/community'
import { STACK_SUBTYPES, ASK_SUBTYPES } from '../lib/community'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'
import { IconComment, IconApplaud } from './icons'

interface Props {
  post: PostWithAuthor
  /** Comment count for this post (from fetchPostCommentCounts in the
   *  list-page useEffect). Hidden when 0 to avoid noisy rows. */
  commentCount?: number
  /** Applaud count for this post (from fetchPostApplaudCounts). Hidden
   *  when 0 for the same reason. */
  applaudCount?: number
}

export function CommunityPostCard({ post, commentCount, applaudCount }: Props) {
  const accent = typeAccent(post.type)
  const subtypeLabel = subtypeOf(post)
  const basePath = basePathFor(post.type)

  return (
    <Link
      to={`${basePath}/${post.id}`}
      className="block card-navy p-5 transition-all"
      style={{
        borderRadius: '2px',
        borderLeft: `3px solid ${accent}`,
        textDecoration: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)'
        e.currentTarget.style.transform   = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = ''
        e.currentTarget.style.transform   = ''
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Type pill · always present so every list card carries the
              same visual taxonomy (CEO: unify open_mic box with other
              types). Subtype pill follows when present so Stack / Ask
              sub-variants are still surfaced. */}
          <span
            className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
            style={{
              background:   `${accent}1A`,
              color:        accent,
              border:       `1px solid ${accent}55`,
              borderRadius: '2px',
            }}
          >
            {typeLabel(post.type)}
          </span>
          {subtypeLabel && (
            <span
              className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
              style={{
                background: `${accent}0F`,
                color:      accent,
                border:     `1px solid ${accent}33`,
                borderRadius: '2px',
              }}
            >
              {subtypeLabel}
            </span>
          )}
          {post.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="font-mono text-[10px] px-1.5 py-0.5"
              style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', borderRadius: '2px' }}
            >
              #{tag.replace(/^#+/, '')}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {formatRelative(post.published_at ?? post.created_at)}
        </span>
      </div>

      <h3 className="font-display font-bold text-lg leading-tight mb-1.5" style={{ color: 'var(--cream)' }}>
        {post.title}
      </h3>
      {post.tldr && (
        <p className="font-light text-sm mb-3" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
          {post.tldr}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{
              width: 18, height: 18,
              background: post.author?.avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
              color: 'var(--navy-900)',
              borderRadius: '2px',
              fontSize: 10, fontWeight: 700,
            }}
          >
            {post.author?.avatar_url
              ? <img src={post.author.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
              : resolveCreatorInitial({ display_name: post.author?.display_name })}
          </span>
          <span className="truncate">{resolveCreatorName({ display_name: post.author?.display_name })}</span>
          {post.author?.creator_grade && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
              <span style={{ color: 'var(--gold-500)' }}>{post.author.creator_grade}</span>
            </>
          )}
        </div>
      </div>

      {/* Engagement strip · dedicated row, always visible so an empty
          card still telegraphs "this is comment-able / applaud-able".
          Reddit/Indie-Hackers pattern · stats live on a bottom row, not
          tucked next to the avatar. Counts default to 0 when undefined
          so we never render a blank row. */}
      <div
        className="mt-3 pt-2 flex items-center gap-4 font-mono text-[11px]"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
      >
        <span
          className="inline-flex items-center gap-1.5"
          title={`${commentCount ?? 0} comment${(commentCount ?? 0) === 1 ? '' : 's'}`}
          style={{ color: (commentCount ?? 0) > 0 ? 'var(--cream)' : 'var(--text-muted)' }}
        >
          <IconComment size={13} />
          <span className="tabular-nums">{commentCount ?? 0}</span>
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title={`${applaudCount ?? 0} applaud${(applaudCount ?? 0) === 1 ? '' : 's'}`}
          style={{ color: (applaudCount ?? 0) > 0 ? 'var(--gold-500)' : 'var(--text-muted)' }}
        >
          <IconApplaud size={13} />
          <span className="tabular-nums">{applaudCount ?? 0}</span>
        </span>
      </div>
    </Link>
  )
}

function typeLabel(type: PostWithAuthor['type']): string {
  switch (type) {
    case 'build_log':    return 'Build Log'
    case 'stack':        return 'Stack'
    case 'ask':          return 'Ask'
    case 'office_hours': return 'Office Hours'
    case 'open_mic':     return 'Open Mic'
  }
}

function typeAccent(type: PostWithAuthor['type']): string {
  switch (type) {
    case 'build_log':    return '#F0C040'   // gold
    case 'stack':        return '#60A5FA'   // blue
    case 'ask':          return '#A78BFA'   // violet
    case 'office_hours': return '#00D4AA'   // teal
    case 'open_mic':     return '#F0C040'   // gold (matches the V1 'this is THE active surface' framing)
  }
}

function basePathFor(type: PostWithAuthor['type']): string {
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
  if (post.type === 'stack') {
    return STACK_SUBTYPES[post.subtype as keyof typeof STACK_SUBTYPES] ?? null
  }
  if (post.type === 'ask') {
    return ASK_SUBTYPES[post.subtype as keyof typeof ASK_SUBTYPES] ?? null
  }
  return null
}

function formatRelative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.floor(s)}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
