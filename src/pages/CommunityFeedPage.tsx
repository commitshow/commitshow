// /community · unified activity feed.
//
// Cold-start fix: instead of dropping users into one of 4 empty
// sub-categories (build-logs, stacks, asks, office-hours), aggregate
// every community_post AND every project comment into one
// time-ordered stream. Comments are by far the most-frequent activity
// today; surfacing them on /community lets the page feel alive while
// build-logs / stacks accrue.
//
// When activity grows past the visibility threshold the category
// sub-nav shows up. Below it, sub-nav stays hidden so a new visitor
// isn't confronted with empty buckets.

import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { resolveCreatorName } from '../lib/creatorName'

interface PostFeedItem {
  kind:        'post'
  id:          string
  created_at:  string
  title:       string
  tldr:        string | null
  type:        string
  subtype:     string | null
  author_id:   string | null
  author_name: string | null
  link:        string
}

interface CommentFeedItem {
  kind:           'comment'
  id:             string
  created_at:     string
  text:           string
  project_id:     string
  project_name:   string | null
  author_id:      string | null
  author_name:    string | null
  author_avatar:  string | null
  // System-generated comments (audit complete · score jump · registered ·
  // etc.) carry kind='system' on the row. We rebrand them as "CS" with
  // the site's mark so the feed doesn't read "Unnamed" for our own
  // automated activity.
  is_system:      boolean
  link:           string
}

interface PostFeedItemWithAvatar extends PostFeedItem {
  author_avatar: string | null
}

type FeedItem = PostFeedItemWithAvatar | CommentFeedItem

const CATEGORY_REVEAL_THRESHOLD = 12   // hide sub-nav below this many posts

export function CommunityFeedPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<FeedItem[]>([])
  const [postCount, setPostCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Pull recent posts + recent comments in parallel, then merge.
      // Limit each side conservatively · client-side sort + slice for
      // the unified feed.
      const [postsRes, commentsRes, postCountRes] = await Promise.all([
        supabase
          .from('community_posts')
          .select('id, created_at, type, subtype, title, tldr, author_id')
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('comments')
          .select('id, created_at, text, project_id, member_id, kind')
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('community_posts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published'),
      ])
      if (!alive) return
      const posts    = (postsRes.data    ?? []) as Array<{ id: string; created_at: string; type: string; subtype: string | null; title: string; tldr: string | null; author_id: string | null }>
      const comments = (commentsRes.data ?? []) as Array<{ id: string; created_at: string; text: string; project_id: string; member_id: string | null; kind: string | null }>

      // Resolve author display_names AND avatars for both sides. avatar
      // shows up in the feed puck so user-authored items get a face.
      const authorIds = Array.from(new Set([
        ...posts.map(p => p.author_id).filter(Boolean) as string[],
        ...comments.map(c => c.member_id).filter(Boolean) as string[],
      ]))
      const { data: members } = authorIds.length > 0
        ? await supabase.from('members').select('id, display_name, avatar_url').in('id', authorIds)
        : { data: [] as Array<{ id: string; display_name: string | null; avatar_url: string | null }> }
      const memberMap = new Map<string, { display_name: string | null; avatar_url: string | null }>(
        ((members as Array<{ id: string; display_name: string | null; avatar_url: string | null }>) ?? [])
          .map(m => [m.id, { display_name: m.display_name, avatar_url: m.avatar_url }]),
      )

      // Resolve project names for the comments side.
      const projectIds = Array.from(new Set(comments.map(c => c.project_id).filter(Boolean) as string[]))
      const { data: pjRows } = projectIds.length > 0
        ? await supabase.from('projects').select('id, project_name').in('id', projectIds)
        : { data: [] as Array<{ id: string; project_name: string }> }
      const pjMap = new Map<string, string>(
        ((pjRows as Array<{ id: string; project_name: string }>) ?? []).map(p => [p.id, p.project_name]),
      )

      // Map type → URL segment for community-post links.
      const typeSegment = (t: string) => {
        switch (t) {
          case 'build_log':    return 'build-logs'
          case 'stack':        return 'stacks'
          case 'ask':          return 'asks'
          case 'office_hours': return 'office-hours'
          default:             return 'build-logs'
        }
      }

      const postItems: PostFeedItemWithAvatar[] = posts.map(p => {
        const m = p.author_id ? memberMap.get(p.author_id) : null
        return {
          kind:          'post',
          id:            p.id,
          created_at:    p.created_at,
          title:         p.title,
          tldr:          p.tldr,
          type:          p.type,
          subtype:       p.subtype,
          author_id:     p.author_id,
          author_name:   m?.display_name ?? null,
          author_avatar: m?.avatar_url   ?? null,
          link:          `/community/${typeSegment(p.type)}/${p.id}`,
        }
      })
      const commentItems: CommentFeedItem[] = comments.map(c => {
        const m = c.member_id ? memberMap.get(c.member_id) : null
        return {
          kind:          'comment',
          id:            c.id,
          created_at:    c.created_at,
          text:          c.text,
          project_id:    c.project_id,
          project_name:  pjMap.get(c.project_id) ?? null,
          author_id:     c.member_id,
          author_name:   m?.display_name ?? null,
          author_avatar: m?.avatar_url   ?? null,
          // member_id NULL OR kind === 'system' both indicate platform-
          // authored events (registered · score_jump · etc.). Either
          // signal flips into the CS branded puck below.
          is_system:     !c.member_id || c.kind === 'system',
          // #comments hash · ProjectComments auto-opens its modal when
          // present, so users land directly on the thread instead of
          // hunting for it on the project page.
          link:          `/projects/${c.project_id}#comments`,
        }
      })

      const merged: FeedItem[] = [...postItems, ...commentItems]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50)
      setItems(merged)
      setPostCount(postCountRes.count ?? 0)
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [])

  const showCategories = postCount >= CATEGORY_REVEAL_THRESHOLD

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>// COMMUNITY</div>
            <h1 className="font-display font-black text-3xl md:text-4xl mb-1" style={{ color: 'var(--cream)' }}>
              What people are saying
            </h1>
            <p className="font-light text-sm" style={{ color: 'var(--text-secondary)' }}>
              Posts and project comments in one feed — newest first.
            </p>
          </div>
          {user && (
            <Link
              to="/community/build-logs/new"
              className="font-mono text-xs tracking-wide px-3 py-2 flex-shrink-0"
              style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', textDecoration: 'none' }}
            >POST →</Link>
          )}
        </header>

        {/* Category sub-nav · hidden until activity threshold met */}
        {showCategories && (
          <div className="flex gap-1.5 mb-5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {[
              { to: '/community',                label: 'All' },
              { to: '/community/build-logs',     label: 'Build Logs' },
              { to: '/community/stacks',         label: 'Stacks' },
              { to: '/community/asks',           label: 'Asks' },
              { to: '/community/office-hours',   label: 'Office Hours' },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/community'}
                className="font-mono text-[11px] tracking-wide px-3 py-1.5 flex-shrink-0 whitespace-nowrap"
                style={({ isActive }) => ({
                  background: isActive ? 'rgba(240,192,64,0.12)' : 'transparent',
                  color:      isActive ? 'var(--gold-500)' : 'var(--text-secondary)',
                  border:     `1px solid ${isActive ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '2px',
                  textDecoration: 'none',
                })}
              >{label}</NavLink>
            ))}
          </div>
        )}

        {/* Feed */}
        {!loaded && <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>loading feed…</div>}
        {loaded && items.length === 0 && (
          <div className="card-navy p-8 text-center" style={{ borderRadius: '2px' }}>
            <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--text-muted)' }}>Quiet on the feed</div>
            <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
              First post from anyone (a build log, a stack, even a single comment on a project) lights this up.
            </p>
          </div>
        )}
        {loaded && items.length > 0 && (
          <ol>
            {items.map(item => <FeedRow key={`${item.kind}-${item.id}`} item={item} />)}
          </ol>
        )}
      </div>
    </section>
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  const isSystem = item.kind === 'comment' && item.is_system
  // Author label: system rows render as "CS" (commit.show) regardless
  // of whether member_id was set; human rows fall through to the
  // resolver. Avoids the 'Unnamed' fallback from leaking into our own
  // automated feed entries.
  const author = isSystem ? 'CS' : resolveCreatorName({ display_name: item.author_name })
  const ago = relAgo(item.created_at)
  const accent  = isSystem ? 'var(--gold-500)' : (item.kind === 'comment' ? '#00D4AA' : 'var(--gold-500)')
  const avatar  = !isSystem ? item.author_avatar : null
  const initial = avatar ? '' : author.slice(0, 1).toUpperCase()
  // Comment rows · render as a rounded card so they read as discrete
  // bubbles · matches the inbox metaphor and softens the run-on look
  // of stacked rows. Posts stay on the divider-only treatment so the
  // feed mixes rhythm: large cards for back-and-forth comments, lean
  // dividers for editorial posts.
  const isComment = item.kind === 'comment'
  return (
    <li>
      <Link
        to={item.link}
        className={isComment ? 'block px-4 py-3 mb-2 transition-colors' : 'block py-3'}
        style={isComment ? {
          background:    'rgba(15,32,64,0.45)',
          border:        '1px solid rgba(255,255,255,0.07)',
          borderRadius:  '14px',
          textDecoration: 'none',
        } : {
          borderBottom:   '1px solid rgba(255,255,255,0.06)',
          textDecoration: 'none',
        }}
        onMouseEnter={isComment ? e => (e.currentTarget.style.borderColor = 'rgba(0,212,170,0.35)') : undefined}
        onMouseLeave={isComment ? e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)') : undefined}
      >
        <div className="flex items-start gap-3">
          {/* Avatar puck · three render modes:
                · system event   → favicon (the "C." brand mark) on a
                                    gold-tinted navy background
                · user w/avatar  → uploaded avatar img
                · user w/o avatar → gradient initial circle
              All three use the same 32-px puck so the row rhythm holds. */}
          <span
            aria-hidden="true"
            className="flex-shrink-0 flex items-center justify-center font-mono text-xs font-bold overflow-hidden"
            style={{
              width: 32, height: 32,
              background:  isSystem ? 'rgba(240,192,64,0.10)' : 'var(--navy-800)',
              color:       isSystem ? 'var(--gold-500)' : 'var(--cream)',
              border:      isSystem ? '1px solid rgba(240,192,64,0.55)' : `1px solid ${accent}55`,
              borderRadius: '50%',
              padding:     isSystem ? 4 : 0,
            }}
          >
            {avatar ? (
              <img src={avatar} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
            ) : isSystem ? (
              <img src="/favicon.svg" alt="commit.show" className="w-full h-full" style={{ objectFit: 'contain' }} />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0 flex-1">
            {/* Header line · author · type chip · time */}
            <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: isSystem ? 'var(--gold-500)' : 'var(--cream)' }}>{author}</strong>
              <span className="px-1.5 py-0.5 text-[9px] tracking-widest uppercase" style={{
                color: accent, border: `1px solid ${accent}55`, borderRadius: '2px',
              }}>
                {isSystem
                  ? 'event'
                  : item.kind === 'comment'
                    ? 'comment'
                    : (item.subtype ?? item.type ?? 'post').replace('_', ' ')}
              </span>
              {item.kind === 'comment' && item.project_name && (
                <span>on <span style={{ color: 'var(--cream)' }}>{item.project_name}</span></span>
              )}
              <span>·</span>
              <span>{ago}</span>
            </div>
            {/* Body */}
            {item.kind === 'post' ? (
              <div className="mt-1">
                <div className="font-display font-bold text-base" style={{ color: 'var(--cream)' }}>{item.title}</div>
                {item.tldr && <p className="font-light text-sm mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.tldr}</p>}
              </div>
            ) : (
              <p className="font-light text-sm mt-1" style={{ color: 'var(--cream)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.text}</p>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}

function relAgo(iso: string): string {
  const t = new Date(iso).getTime()
  const ms = Date.now() - t
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}
