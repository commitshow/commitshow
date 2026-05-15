// Asks list — lightweight message board (§13-B.5).
// Subtypes: looking_for | available | feedback. 60-char title cap, 30d TTL,
// and "resolved" marking are enforced once the write flow lands (P4b).

import { useEffect, useState } from 'react'
import { CommunityLayout } from '../components/CommunityLayout'
import { CommunityPostCard } from '../components/CommunityPostCard'
import { NewPostButton } from './BuildLogsPage'
import { listPosts, ASK_SUBTYPES, type PostWithAuthor } from '../lib/community'
import { useCommunityListEnriched } from '../lib/useCommunityListEnriched'
import { useAuth } from '../lib/auth'

type Subtype = keyof typeof ASK_SUBTYPES | 'all'

export function AsksPage() {
  const [subtype, setSubtype] = useState<Subtype>('all')
  const [posts, setPosts]     = useState<PostWithAuthor[] | null>(null)
  const { user } = useAuth()
  const { commentCounts, applaudCounts } = useCommunityListEnriched(posts)

  useEffect(() => {
    setPosts(null)
    listPosts({ type: 'ask' }).then(rows => {
      setPosts(subtype === 'all' ? rows : rows.filter(r => r.subtype === subtype))
    })
  }, [subtype])

  return (
    <CommunityLayout>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>
            // ASKS
          </div>
          <div className="font-display font-bold text-2xl mt-1" style={{ color: 'var(--cream)' }}>
            Looking for · Available · Feedback
          </div>
          <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            One-line asks with a 30-day TTL
          </div>
        </div>
        {user && <NewPostButton to="/community/asks/new" label="New Ask" />}
      </div>

      <div className="flex items-center gap-1.5 mb-6 flex-wrap">
        <Chip label="All"             tone="#A78BFA" active={subtype === 'all'}         onClick={() => setSubtype('all')} />
        <Chip label="#looking-for"    tone="#F0C040" active={subtype === 'looking_for'} onClick={() => setSubtype('looking_for')} />
        <Chip label="#available"      tone="#00D4AA" active={subtype === 'available'}   onClick={() => setSubtype('available')} />
        <Chip label="#feedback"       tone="#60A5FA" active={subtype === 'feedback'}    onClick={() => setSubtype('feedback')} />
      </div>

      {posts === null ? (
        <Empty label="Loading…" />
      ) : posts.length === 0 ? (
        <Empty label={subtype === 'all'
          ? 'No asks posted yet. Be the first to ask or offer.'
          : `No ${subtype === 'looking_for' ? 'looking-for' : subtype} asks open right now.`} />
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

function Chip({ label, tone, active, onClick }: { label: string; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[11px] tracking-wide px-2.5 py-1 transition-colors"
      style={{
        background:   active ? `${tone}22` : 'transparent',
        color:        active ? tone : 'var(--text-secondary)',
        border:       `1px solid ${active ? `${tone}77` : 'rgba(255,255,255,0.08)'}`,
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
