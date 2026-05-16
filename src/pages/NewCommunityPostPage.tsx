// New community post editor · routes:
//   /community/build-logs/new
//   /community/stacks/new
//   /community/asks/new
//
// One component handles all three types with conditional form fields.
// Auth-gated · bounces to Landing with a sign-in prompt when unauth.

import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createPost, STACK_SUBTYPES, ASK_SUBTYPES } from '../lib/community'
import type { CommunityPostType } from '../lib/supabase'
import { CommunityLayout } from '../components/CommunityLayout'
import { TagInput } from '../components/TagInput'

// The route segment → CommunityPostType mapping. Keeps URLs human-readable.
const TYPE_BY_SEGMENT: Record<string, CommunityPostType> = {
  'build-logs': 'build_log',
  'stacks':     'stack',
  'asks':       'ask',
  'open-mic':   'open_mic',
}

const TITLE_MAX: Record<CommunityPostType, number> = {
  build_log: 120,
  stack:     100,
  ask:        60,   // §13-B.5 rule
  office_hours: 120,
  open_mic:   100,  // one-liner format · keep titles tight
}

export function NewCommunityPostPage() {
  const { typeSegment } = useParams<{ typeSegment: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const postType: CommunityPostType = (typeSegment && TYPE_BY_SEGMENT[typeSegment]) || 'build_log'

  // Prefill from URL params · used by AuditCoachPanel's 'Share your
  // climb on Open Mic' link after a successful re-audit climb. Title,
  // body, and tags are seeded from the audit context so the creator
  // just edits a sentence and ships rather than starting from blank.
  const [title,   setTitle]   = useState(() => searchParams.get('title') ?? '')
  const [tldr,    setTldr]    = useState(() => searchParams.get('tldr')  ?? '')
  const [body,    setBody]    = useState(() => searchParams.get('body')  ?? '')
  const [subtype, setSubtype] = useState<string>('')
  const [tags,    setTags]    = useState<string[]>(() => {
    const raw = searchParams.get('tags')
    return raw ? raw.split(',').map(t => t.trim()).filter(Boolean) : []
  })
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Default subtype when entering the stack or ask editor.
  useEffect(() => {
    if (postType === 'stack' && !subtype) setSubtype('recipe')
    if (postType === 'ask'   && !subtype) setSubtype('looking_for')
  }, [postType, subtype])

  if (!authLoading && !user) {
    return (
      <CommunityLayout>
        <div className="card-navy p-6 text-center" style={{ borderRadius: '2px' }}>
          <div className="font-display font-bold text-xl mb-2" style={{ color: 'var(--cream)' }}>
            Sign in to post
          </div>
          <p className="font-mono text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            Creator Community contributions require an account.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 font-mono text-xs tracking-wide"
            style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
          >
            BACK HOME
          </button>
        </div>
      </CommunityLayout>
    )
  }

  const titleLimit = TITLE_MAX[postType]
  const tooLong    = title.length > titleLimit
  const canSubmit  = title.trim().length > 0 && !tooLong && !busy &&
                     (postType !== 'stack' || !!subtype) &&
                     (postType !== 'ask'   || !!subtype)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const result = await createPost({
        type:    postType,
        subtype: subtype || null,
        title:   title.trim(),
        tldr:    tldr.trim() || null,
        body:    body.trim() || null,
        tags,
        status:  'published',
      })
      if (!result) throw new Error('Publish failed')
      navigate(listPathFor(postType))
    } catch (err) {
      setError((err as Error).message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <CommunityLayout>
      <form onSubmit={onSubmit}>
        <div className="card-navy p-6" style={{ borderRadius: '2px' }}>
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // NEW {labelFor(postType).toUpperCase()}
          </div>
          <div className="font-display font-bold text-2xl mb-5" style={{ color: 'var(--cream)' }}>
            {heroTitle(postType)}
          </div>

          {/* Subtype picker (stacks + asks only) */}
          {postType === 'stack' && (
            <Field label="Format" required>
              <SubtypePicker value={subtype} onChange={setSubtype} options={STACK_SUBTYPES} tone="#60A5FA" />
            </Field>
          )}
          {postType === 'ask' && (
            <Field label="Ask type" required>
              <SubtypePicker value={subtype} onChange={setSubtype} options={ASK_SUBTYPES} tone="#A78BFA" />
            </Field>
          )}

          {/* Title */}
          <Field
            label="Title"
            required
            hint={`${title.length}/${titleLimit}`}
            error={tooLong ? `Title must be ${titleLimit} characters or less` : null}
          >
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={placeholderFor(postType)}
              className="w-full font-display text-lg px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${tooLong ? '#F88771' : 'rgba(255,255,255,0.1)'}`,
                color: 'var(--cream)',
                borderRadius: '2px',
                outline: 'none',
              }}
            />
          </Field>

          {/* TL;DR — optional, hidden for asks (their title IS the ask) */}
          {postType !== 'ask' && (
            <Field label="TL;DR" hint="One line someone could retell in Slack">
              <input
                type="text"
                value={tldr}
                onChange={e => setTldr(e.target.value)}
                placeholder="The 10-second pitch for your log / recipe"
                className="w-full font-light text-sm px-3 py-2"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--cream)',
                  borderRadius: '2px',
                  outline: 'none',
                }}
              />
            </Field>
          )}

          {/* Body — optional for asks, encouraged for build_log/stack */}
          <Field
            label={postType === 'ask' ? 'Details' : 'Body (Markdown)'}
            hint={postType === 'ask' ? 'Optional · what they need to know to respond' : 'Code blocks · screenshots · anything goes'}
          >
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={postType === 'ask' ? 4 : 10}
              placeholder={bodyPlaceholder(postType)}
              className="w-full font-mono text-sm px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--cream)',
                borderRadius: '2px',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </Field>

          {/* Tags */}
          <Field label="Tags" hint="Help Scouts and peers find this">
            <TagInput value={tags} onChange={setTags} />
          </Field>

          {error && (
            <div
              className="font-mono text-[11px] mb-4 px-3 py-2"
              style={{
                color: '#F88771',
                background: 'rgba(248,120,113,0.06)',
                border: '1px solid rgba(248,120,113,0.45)',
                borderRadius: '2px',
              }}
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => navigate(listPathFor(postType))}
              className="px-4 py-2 font-mono text-xs tracking-wide"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-5 py-2 font-mono text-xs tracking-wide transition-all"
              style={{
                background: canSubmit ? 'var(--gold-500)' : 'rgba(240,192,64,0.25)',
                color: canSubmit ? 'var(--navy-900)' : 'rgba(248,245,238,0.45)',
                border: 'none',
                borderRadius: '2px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'DM Mono, monospace',
              }}
            >
              {busy ? 'PUBLISHING…' : 'PUBLISH'}
            </button>
          </div>
        </div>
      </form>
    </CommunityLayout>
  )
}

function Field({
  label, required, hint, error, children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--text-label)' }}>
          {label}
          {required && <span style={{ color: 'var(--gold-500)', marginLeft: 4 }}>*</span>}
        </label>
        {hint && (
          <span className="font-mono text-[10px]" style={{ color: error ? '#F88771' : 'var(--text-muted)' }}>
            {error ?? hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function SubtypePicker({
  value, onChange, options, tone,
}: {
  value: string
  onChange: (next: string) => void
  options: Record<string, string>
  tone: string
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Object.entries(options).map(([key, label]) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
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
      })}
    </div>
  )
}

function heroTitle(type: CommunityPostType): string {
  switch (type) {
    case 'build_log':    return 'Log a shipping journey'
    case 'stack':        return 'Share a stack recipe, prompt, or review'
    case 'ask':          return 'Post a quick ask'
    case 'office_hours': return 'Host an Office Hours session'
    case 'open_mic':     return 'Drop a one-liner on the mic'
  }
}

function labelFor(type: CommunityPostType): string {
  switch (type) {
    case 'build_log':    return 'Build Log'
    case 'stack':        return 'Stack'
    case 'ask':          return 'Ask'
    case 'office_hours': return 'Office Hours'
    case 'open_mic':     return 'Open Mic'
  }
}

function listPathFor(type: CommunityPostType): string {
  switch (type) {
    case 'build_log':    return '/community/build-logs'
    case 'stack':        return '/community/stacks'
    case 'ask':          return '/community/asks'
    case 'office_hours': return '/community/office-hours'
    case 'open_mic':     return '/community/open-mic'
  }
}

function placeholderFor(type: CommunityPostType): string {
  switch (type) {
    case 'build_log':    return 'How I shipped X over Y weeks with Cursor + Claude'
    case 'stack':        return 'Cursor + Supabase + Vercel for SaaS MVPs under $20/mo'
    case 'ask':          return 'Looking for a designer for 2 weeks (paid)'
    case 'office_hours': return 'Cursor AMA with the Cursor team'
    case 'open_mic':     return 'Shipped a Stripe → Supabase webhook in 40 min. Worth it.'
  }
}

function bodyPlaceholder(type: CommunityPostType): string {
  switch (type) {
    case 'build_log':    return '## Overview\n\n## What worked\n\n## What didn\'t\n\n## Next'
    case 'stack':        return 'Paste the config / prompt / review here.\nMarkdown + code blocks supported.'
    case 'ask':          return 'Give responders enough to act — scope, constraint, link.'
    case 'office_hours': return 'Intro the session, the guest, and what folks should bring.'
    case 'open_mic':     return 'Optional · one short paragraph if there\'s more to it.'
  }
}
