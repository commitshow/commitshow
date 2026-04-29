// Bottom-of-page casual CTA row for a project detail page.
// Surfaces the two social actions (Applaud + Forecast) one more time after
// the visitor finishes reading, in an emoji-forward treatment that's visually
// distinct from the tight pill row in the hero.
//
// §4 emoji rule carve-out: this component is exempt per the "Forecast /
// Applaud CTA" exception — the emoji IS the brand signal here.

import { ApplaudButton } from './ApplaudButton'
import type { SeasonPhase } from '../lib/season'

interface Props {
  projectId:       string
  viewerMemberId:  string | null
  isOwner:         boolean
  seasonPhase:     SeasonPhase | undefined
  onForecastClick: () => void
}

export function ProjectActionFooter({
  projectId,
  viewerMemberId,
  isOwner,
  seasonPhase,
  onForecastClick,
}: Props) {
  // Owners don't get CTAs on their own project (self-forecast/applaud blocked
  // at DB layer anyway; hiding the row reads cleaner than disabled states).
  if (isOwner) return null

  const isVotingPhase =
    seasonPhase === 'week_1' || seasonPhase === 'week_2' || seasonPhase === 'week_3'

  return (
    <section
      className="mt-12 pt-10 px-6 pb-2 text-center"
      style={{ borderTop: '1px solid rgba(240,192,64,0.15)' }}
    >
      <div
        className="font-mono text-[11px] tracking-widest uppercase mb-2"
        style={{ color: 'var(--text-muted)' }}
      >
        // HOW DO YOU FEEL ABOUT THIS?
      </div>
      <p
        className="font-light mb-6 max-w-md mx-auto"
        style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}
      >
        Send a quick applause, or call the finishing score if you think you see where this lands.
      </p>

      <div className="flex items-center justify-center gap-4 flex-wrap">
        <ApplaudButton
          targetType="product"
          targetId={projectId}
          viewerMemberId={viewerMemberId}
          isOwnContent={isOwner}
          size="lg"
          variant="emoji"
          label="Applaud"
        />

        {isVotingPhase && (
          <button
            type="button"
            onClick={onForecastClick}
            disabled={!viewerMemberId}
            title={viewerMemberId ? 'Forecast the finish' : 'Sign in to forecast'}
            className="font-mono tracking-wide transition-all"
            style={{
              display:      'inline-flex',
              alignItems:   'center',
              gap:          '0.5em',
              padding:      '0.75rem 1.25rem',
              fontSize:     16,
              lineHeight:   1,
              background:   viewerMemberId ? 'rgba(240,192,64,0.1)' : 'transparent',
              color:        viewerMemberId ? 'var(--gold-500)' : 'var(--text-muted)',
              border:       `1px solid ${viewerMemberId ? 'rgba(240,192,64,0.45)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: '2px',
              cursor:       viewerMemberId ? 'pointer' : 'not-allowed',
              fontFamily:   'DM Mono, monospace',
              boxShadow:    viewerMemberId ? '0 0 24px rgba(240,192,64,0.08)' : 'none',
              opacity:      viewerMemberId ? 1 : 0.55,
            }}
            onMouseEnter={e => {
              if (!viewerMemberId) return
              e.currentTarget.style.borderColor = 'rgba(240,192,64,0.65)'
              e.currentTarget.style.boxShadow   = '0 0 32px rgba(240,192,64,0.22)'
            }}
            onMouseLeave={e => {
              if (!viewerMemberId) return
              e.currentTarget.style.borderColor = 'rgba(240,192,64,0.45)'
              e.currentTarget.style.boxShadow   = '0 0 24px rgba(240,192,64,0.08)'
            }}
          >
            <span
              aria-hidden="true"
              style={{
                fontSize: 24, lineHeight: 1, display: 'inline-block',
                filter: 'saturate(1.1)',
              }}
            >
              🎯
            </span>
            <span>Forecast</span>
          </button>
        )}
      </div>

      {!isVotingPhase && (
        <div className="mt-4 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Forecasts open during a quarterly event. The ladder keeps ranking in the meantime.
        </div>
      )}
    </section>
  )
}
