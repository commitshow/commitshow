// ShareToXModal — score-jump prompt that surfaces when a re-audit lands
// a meaningful positive delta. The CEO ask: "특정 행위시 (점수가 많이 오른
// 경우 카드 제공등) 연결해서 올리게 하려해" — turn the moment of
// discovery (audit completed, score went up) into a one-tap X share.
//
// Lives outside ProjectDetailPage's render tree via portal so the modal
// can float above sticky nav / scan strip / section grid without z-index
// fights with each. Backdrop click + Escape both dismiss; the Share
// button hands off to the ShareToXButton's intent flow.

import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { ShareToXButton } from './ShareToXButton'

interface Props {
  open:        boolean
  onClose:     () => void
  projectName: string
  /** Current (post-re-audit) score · headline number in the card. */
  score:       number
  /** Round-over-round delta · positive only — the modal only fires on
   *  positive jumps, but we still take a number so the copy can render
   *  the exact magnitude ("+8" reads better than "your score went up"). */
  delta:       number
  /** Project detail URL · what gets unfurled into a card on X. */
  url:         string
  /** First strength bullet · prepended to the tweet body for context. */
  takeaway?:   string | null
}

export function ShareToXModal({
  open, onClose, projectName, score, delta, url, takeaway,
}: Props) {
  // Esc to close · standard modal affordance
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(6,12,26,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card-navy"
        style={{
          maxWidth: '440px', width: '100%',
          border: '1px solid rgba(240,192,64,0.4)',
          borderRadius: '2px',
          padding: '28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // SCORE JUMP · +{delta}
        </div>

        <div className="font-display font-bold text-2xl mb-2" style={{ color: 'var(--cream)', lineHeight: 1.2 }}>
          {projectName} · {score}/100
        </div>

        <p className="font-light text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Your build is up <strong style={{ color: '#00D4AA' }}>+{delta}</strong> points
          since the last audit. Drop the new score on X — your followers can see
          the receipt.
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] tracking-wide px-3 py-2"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
              cursor: 'pointer',
              minHeight: '36px',
            }}
          >
            Maybe later
          </button>
          <ShareToXButton
            projectName={projectName}
            score={score}
            url={url}
            takeaway={takeaway}
            variant="gold"
            label="Share on X"
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
