// Build Logs list — shipping-journey archive (§13-B.3).
// P4a read-only. Editor lands in P4b, auto-seed lands with Season-end engine (P8).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CommunityLayout } from '../components/CommunityLayout'
import { CommunityPostCard } from '../components/CommunityPostCard'
import { CommunityTagFilter } from '../components/CommunityTagFilter'
import { listPosts, type PostWithAuthor } from '../lib/community'
import { useAuth } from '../lib/auth'

export function BuildLogsPage() {
  const [tag, setTag] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostWithAuthor[] | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    setPosts(null)
    listPosts({ type: 'build_log', tag: tag ?? undefined }).then(setPosts)
  }, [tag])

  return (
    <CommunityLayout>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // BUILD LOGS
          </div>
          <div className="font-display font-bold text-2xl mt-1" style={{ color: 'var(--cream)' }}>
            Shipping journeys
          </div>
          <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Auto-seeded on graduation · open to WIP logs too
          </div>
        </div>
        {user && <NewPostButton to="/community/build-logs/new" label="New Build Log" />}
      </div>

      <CommunityTagFilter active={tag} onChange={setTag} className="mb-5" />

      {posts === null ? (
        <EmptyState label="Loading…" />
      ) : posts.length === 0 ? (
        <EmptyState label={tag ? `No Build Logs tagged #${tag} yet.` : 'No Build Logs yet. Encore Week seeds the first batch.'} />
      ) : (
        <div className="grid gap-3">
          {posts.map(p => <CommunityPostCard key={p.id} post={p} />)}
        </div>
      )}
    </CommunityLayout>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      className="font-mono text-xs flex items-center justify-center py-16 text-center"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
        color: 'var(--text-muted)',
        borderRadius: '2px',
      }}
    >
      {label}
    </div>
  )
}

export function NewPostButton({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="px-4 py-2 font-mono text-xs tracking-wide transition-all"
      style={{
        background: 'var(--gold-500)',
        color: 'var(--navy-900)',
        border: 'none',
        borderRadius: '2px',
        textDecoration: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
    >
      + {label}
    </Link>
  )
}
