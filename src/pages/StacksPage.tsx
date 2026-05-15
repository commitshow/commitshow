// Stacks list — reusable tech assets (§13-B.4).
// 3 subtypes: Stack Recipe · Prompt Card · Tool Review.
// P4a read-only; editor lands in P4b.

import { useEffect, useState } from 'react'
import { CommunityLayout } from '../components/CommunityLayout'
import { CommunityPostCard } from '../components/CommunityPostCard'
import { CommunityTagFilter } from '../components/CommunityTagFilter'
import { NewPostButton } from './BuildLogsPage'
import { listPosts, STACK_SUBTYPES, type PostWithAuthor } from '../lib/community'
import { useCommunityListEnriched } from '../lib/useCommunityListEnriched'
import { useAuth } from '../lib/auth'

type Subtype = keyof typeof STACK_SUBTYPES | 'all'

export function StacksPage() {
  const [subtype, setSubtype] = useState<Subtype>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostWithAuthor[] | null>(null)
  const { user } = useAuth()
  const { commentCounts, applaudCounts } = useCommunityListEnriched(posts)

  useEffect(() => {
    setPosts(null)
    listPosts({ type: 'stack', tag: tag ?? undefined }).then(rows => {
      setPosts(subtype === 'all' ? rows : rows.filter(r => r.subtype === subtype))
    })
  }, [subtype, tag])

  return (
    <CommunityLayout>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // STACKS
          </div>
          <div className="font-display font-bold text-2xl mt-1" style={{ color: 'var(--cream)' }}>
            Recipes · prompts · tool reviews
          </div>
          <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Reusable combos that stopped working around you
          </div>
        </div>
        {user && <NewPostButton to="/community/stacks/new" label="New Stack" />}
      </div>

      {/* Subtype pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <SubtypeChip label="All"     active={subtype === 'all'}    onClick={() => setSubtype('all')} />
        <SubtypeChip label="Recipes" active={subtype === 'recipe'} onClick={() => setSubtype('recipe')} />
        <SubtypeChip label="Prompts" active={subtype === 'prompt'} onClick={() => setSubtype('prompt')} />
        <SubtypeChip label="Reviews" active={subtype === 'review'} onClick={() => setSubtype('review')} />
      </div>

      <CommunityTagFilter active={tag} onChange={setTag} className="mb-5" />

      {posts === null ? (
        <Empty label="Loading…" />
      ) : posts.length === 0 ? (
        <Empty label={tag || subtype !== 'all'
          ? 'No Stacks match that filter yet.'
          : 'No Stacks yet. Publish your first combo.'} />
      ) : (
        <div className="grid gap-3">
          {posts.map(p => (
            <CommunityPostCard
              key={p.id}
              post={p}
              commentCount={commentCounts[p.id]}
              applaudCount={applaudCounts[p.id]}
            />
          ))}
        </div>
      )}
    </CommunityLayout>
  )
}

function SubtypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[11px] tracking-wide px-2.5 py-1 transition-colors"
      style={{
        background:   active ? 'rgba(96,165,250,0.14)' : 'transparent',
        color:        active ? '#60A5FA' : 'var(--text-secondary)',
        border:       `1px solid ${active ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: '2px',
        cursor:       'pointer',
      }}
    >
      {label}
    </button>
  )
}

function Empty({ label }: { label: string }) {
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
