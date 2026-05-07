// OwnerNextStepBanner · top-of-page coach for project owners.
//
// User feedback 2026-05-07: 'fix prompt 수정 섹션도 맨위로올리라고 했는데
// 아직도 아래에 있네. 코멘트 영역 위 정도에 위치 시키자.' The coach used
// to live deep inside AnalysisResultCard's ScoutBriefSection · owners had
// to scroll past hero + comments + section nav + overview + analysis
// header before they hit the actionable next step. Now it sits right
// above the comments preview, so 'what do I fix?' is the first thing a
// returning owner sees.
//
// Dismissal: localStorage-backed (`coach.fixPrompt.dismissed`) so once
// the owner copies the prompt OR explicitly closes it, the banner stops
// appearing. The header-level Copy fix prompt button inside the analysis
// section stays available for repeat use.

import { useState } from 'react'
import { buildFixPrompt } from '../lib/fixPrompt'
import type { ScoutBriefBullet } from '../lib/analysis'

interface Props {
  projectName:    string | null
  githubUrl:      string | null
  scoreTotal:     number | null
  scoreAuto:      number | null
  scoreForecast:  number | null
  scoreCommunity: number | null
  tldr:           string | null
  strengths:      ScoutBriefBullet[]
  weaknesses:     ScoutBriefBullet[]
}

export function OwnerNextStepBanner(props: Props) {
  const { weaknesses } = props

  const [copied, setCopied]         = useState(false)
  const [dismissed, setDismissed]   = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try { return window.localStorage.getItem('coach.fixPrompt.dismissed') === '1' }
    catch { return false }
  })

  const dismiss = () => {
    setDismissed(true)
    try { window.localStorage.setItem('coach.fixPrompt.dismissed', '1') } catch {}
  }

  if (weaknesses.length === 0) return null   // nothing to fix · nothing to coach
  if (dismissed) return null

  const handleCopy = async () => {
    const prompt = buildFixPrompt(props)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
      // Implicit dismissal · once they've copied, the coach has done its job.
      // The header-level Copy button inside the analysis section stays.
      dismiss()
    } catch (e) {
      console.error('[copy fix prompt] failed', e)
    }
  }

  return (
    <div
      className="mt-4 mb-4 p-4 md:p-5"
      style={{
        background:   'linear-gradient(180deg, rgba(240,192,64,0.08) 0%, rgba(240,192,64,0.03) 100%)',
        border:       '1px solid rgba(240,192,64,0.32)',
        borderRadius: '2px',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--gold-500)' }}>
          // NEXT STEP · 30 SEC
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="font-mono text-[10px] tracking-wide"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label="Hide this guide"
        >
          hide ×
        </button>
      </div>
      <p className="font-display font-bold text-base md:text-lg leading-snug mb-1" style={{ color: 'var(--cream)' }}>
        Score landed. Now ship the fixes.
      </p>
      <p className="text-xs md:text-sm font-light mb-4" style={{ color: 'rgba(248,245,238,0.7)', lineHeight: 1.6 }}>
        Copy the fix prompt, paste it into Cursor / Claude Code / your AI tool of choice. It already lists the {weaknesses.length} concern{weaknesses.length === 1 ? '' : 's'} below with rules of engagement. Re-audit once patches land.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleCopy}
          className="font-mono text-xs tracking-wide px-4 py-2"
          style={{
            background:   copied ? 'rgba(63,168,116,0.18)' : 'var(--gold-500)',
            color:        copied ? '#3FA874'              : 'var(--navy-900)',
            border:       copied ? '1px solid rgba(63,168,116,0.45)' : 'none',
            borderRadius: '2px',
            cursor:       'pointer',
            fontWeight:   700,
          }}
        >
          {copied ? '✓ Copied · paste in your AI tool' : 'Copy fix prompt →'}
        </button>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          then ⌘V in Cursor
        </span>
      </div>
    </div>
  )
}
