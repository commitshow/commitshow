// MakerIntroBanner · prompts the project creator to publish a launch
// post as the first comment. Auto-drafts the body from build_briefs +
// project name; owner edits inline and clicks Publish, which inserts
// it as a regular comment. After publish (or if a creator comment
// already exists) the banner stops rendering.
//
// 2026-05-08 · matches Product-Hunt's pattern: every successful
// launch starts with a 'Hey 👋' comment from the maker · drives
// immediate discussion. Auto-draft removes the writer's-block step ·
// owner just confirms / tweaks / publishes.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateMakerIntro } from '../lib/makerIntro'

interface BriefRow {
  problem:        string | null
  features:       string | null
  target_user:    string | null
  ai_tools:       string | null
  one_liner:      string | null
  business_model: string | null
  stage:          string | null
}

interface Props {
  projectId:    string
  projectName:  string
  ownerMemberId: string  // creator_id · we check whether this member already commented
  /** Called after a successful publish so the parent can refetch comments. */
  onPublished?: () => void
}

const DISMISS_KEY_PREFIX = 'maker_intro_dismissed:'

export function MakerIntroBanner({ projectId, projectName, ownerMemberId, onPublished }: Props) {
  const [brief, setBrief]               = useState<BriefRow | null>(null)
  const [loading, setLoading]           = useState(true)
  const [hasOwnerComment, setHasOwner]  = useState<boolean | null>(null)
  const [text, setText]                 = useState<string>('')
  const [editing, setEditing]           = useState(false)
  const [publishing, setPublishing]     = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [dismissed, setDismissed]       = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem(DISMISS_KEY_PREFIX + projectId) === '1' }
    catch { return false }
  })

  // Pull brief + check whether the creator already commented.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [brief, ownerComm] = await Promise.all([
        supabase
          .from('build_briefs')
          .select('problem, features, target_user, ai_tools, one_liner, business_model, stage')
          .eq('project_id', projectId)
          .maybeSingle(),
        supabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .eq('member_id', ownerMemberId),
      ])
      if (!alive) return
      setBrief((brief.data ?? null) as BriefRow | null)
      setHasOwner((ownerComm.count ?? 0) > 0)
      setLoading(false)
    })().catch(err => { console.error('[MakerIntroBanner]', err); setLoading(false) })
    return () => { alive = false }
  }, [projectId, ownerMemberId])

  const draft = useMemo(() => {
    if (!brief) return ''
    return generateMakerIntro({
      projectName,
      oneLiner:      brief.one_liner,
      problem:       brief.problem,
      features:      brief.features,
      targetUser:    brief.target_user,
      aiTools:       brief.ai_tools,
      businessModel: brief.business_model,
      stage:         brief.stage,
    })
  }, [brief, projectName])

  // Seed editable text when draft is ready and user hasn't typed anything.
  useEffect(() => {
    if (!text && draft) setText(draft)
  }, [draft])  // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setDismissed(true)
    try { window.localStorage.setItem(DISMISS_KEY_PREFIX + projectId, '1') } catch {}
  }

  const handlePublish = async () => {
    if (!text.trim()) return
    setPublishing(true); setError(null)
    const { error } = await supabase
      .from('comments')
      .insert({
        project_id: projectId,
        member_id:  ownerMemberId,
        text:       text.trim(),
      })
    setPublishing(false)
    if (error) { setError(error.message); return }
    setHasOwner(true)
    dismiss()
    onPublished?.()
  }

  if (loading) return null
  // Hide once we know there's already a creator comment.
  if (hasOwnerComment) return null
  if (dismissed) return null
  // Need at least some signal to draft from · otherwise the comment
  // would be a generic 'Hey 👋' with no body.
  if (!brief || !draft) return null

  return (
    <div
      className="mt-4 mb-4 p-4 md:p-5"
      style={{
        background:   'linear-gradient(180deg, rgba(167,139,250,0.10) 0%, rgba(167,139,250,0.04) 100%)',
        border:       '1px solid rgba(167,139,250,0.36)',
        borderRadius: '2px',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-mono text-[10px] tracking-widest" style={{ color: '#A78BFA' }}>
          // YOUR LAUNCH POST · DRAFT
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label="Hide for now"
        >
          hide ×
        </button>
      </div>
      <p className="font-display font-bold text-base md:text-lg leading-snug mb-1" style={{ color: 'var(--cream)' }}>
        Kick off the conversation with your launch post
      </p>
      <p className="text-xs md:text-sm font-light mb-3" style={{ color: 'rgba(248,245,238,0.7)', lineHeight: 1.6 }}>
        We auto-drafted the first comment from your brief. Edit it to sound like you, then publish — Product-Hunt-style intro thread starts here.
      </p>

      {editing ? (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={Math.min(20, Math.max(6, text.split('\n').length + 1))}
          className="w-full font-mono text-[12px] p-3 mb-2"
          style={{
            background:   'var(--navy-950)',
            color:        'var(--cream)',
            border:       '1px solid rgba(167,139,250,0.4)',
            borderRadius: '2px',
            resize:       'vertical',
            lineHeight:   1.55,
          }}
        />
      ) : (
        <div
          className="font-mono text-[12px] p-3 mb-2 whitespace-pre-wrap"
          style={{
            background:   'var(--navy-950)',
            color:        'var(--text-primary)',
            border:       '1px solid rgba(255,255,255,0.08)',
            borderRadius: '2px',
            lineHeight:   1.6,
            maxHeight:    320,
            overflow:     'auto',
          }}
        >
          {text}
        </div>
      )}

      {error && (
        <p className="font-mono text-[11px] mb-2" style={{ color: 'rgba(248,120,113,0.85)' }}>
          // {error}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing || !text.trim()}
          className="font-mono text-xs tracking-wide px-4 py-2"
          style={{
            background:   publishing || !text.trim() ? 'rgba(167,139,250,0.25)' : '#A78BFA',
            color:        publishing || !text.trim() ? 'var(--text-muted)' : 'var(--navy-900)',
            border:       'none',
            borderRadius: '2px',
            cursor:       publishing || !text.trim() ? 'not-allowed' : 'pointer',
            fontWeight:   700,
          }}
        >
          {publishing ? 'Publishing…' : 'Publish as my first comment →'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          className="font-mono text-xs tracking-wide px-3 py-2"
          style={{
            background:   'transparent',
            color:        '#A78BFA',
            border:       '1px solid rgba(167,139,250,0.4)',
            borderRadius: '2px',
            cursor:       'pointer',
          }}
        >
          {editing ? 'Preview' : 'Edit text'}
        </button>
        <button
          type="button"
          onClick={() => setText(draft)}
          className="font-mono text-[10px] tracking-wide"
          style={{
            background:   'transparent',
            color:        'var(--text-muted)',
            border:       'none',
            cursor:       'pointer',
            padding:      0,
          }}
        >
          reset to auto-draft
        </button>
      </div>
    </div>
  )
}
