// Open Mic — the V1 launch surface of the Creator Community (§13-B + 2026-05-13
// CEO directive). One-liner posts · light tone · no formal subtype taxonomy.
// Build Logs / Stacks / Asks / Office Hours are pinned in the tab strip but
// disabled at launch; they light up in V1.5 once the Open Mic ledger has
// enough density to seed them.

import { useEffect, useState } from 'react'
import { CommunityLayout } from '../components/CommunityLayout'
import { CommunityPostCard } from '../components/CommunityPostCard'
import { CommunityTagFilter } from '../components/CommunityTagFilter'
import { listPosts, type PostWithAuthor } from '../lib/community'
import { useAuth } from '../lib/auth'
import { NewPostButton } from './BuildLogsPage'

export function OpenMicPage() {
  const [tag, setTag] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostWithAuthor[] | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    setPosts(null)
    listPosts({ type: 'open_mic', tag: tag ?? undefined }).then(setPosts)
  }, [tag])

  return (
    <CommunityLayout>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // OPEN MIC
          </div>
          <div className="font-display font-bold text-2xl mt-1" style={{ color: 'var(--cream)' }}>
            Drop a one-liner
          </div>
          <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            What you shipped · what tripped you up · who you're looking for. Short is fine.
          </div>
        </div>
        {user && <NewPostButton to="/community/open-mic/new" label="Open Mic" />}
      </div>

      <CommunityTagFilter active={tag} onChange={setTag} className="mb-5" />

      {posts === null ? (
        <EmptyState label="Loading…" />
      ) : posts.length === 0 ? (
        <EmptyState label={tag ? `Nothing on the mic with #${tag} yet.` : 'Mic is open. Be the first up.'} />
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
