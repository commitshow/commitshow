import { openTweetIntent } from '../lib/shareTweet'

// X glyph · clean monochrome SVG, currentColor so it inherits the button's
// text color. Matches the rest of icons.tsx style (line / fill mix kept
// minimal — X's wordmark is pure fill, no strokes).
function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

interface Props {
  projectName: string
  score:       number
  /** Project detail URL — what gets unfurled into a card on X. */
  url:         string
  /** Optional one-line takeaway (a strength bullet) prepended to the body. */
  takeaway?:   string | null
  /** Visual variant — `gold` for primary CTA placement, `ghost` for
   *  secondary placement next to other gold actions. */
  variant?:    'gold' | 'ghost'
  /** Override the rendered label · default "Share". */
  label?:      string
}

export function ShareToXButton({
  projectName, score, url, takeaway,
  variant = 'ghost', label = 'Share',
}: Props) {
  const handleClick = () => openTweetIntent({ projectName, score, url, takeaway })

  if (variant === 'gold') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide px-3 py-1.5"
        style={{
          background:   'var(--gold-500)',
          color:        'var(--navy-900)',
          border:       'none',
          borderRadius: '2px',
          cursor:       'pointer',
          fontWeight:   600,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-400)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--gold-500)')}
        aria-label="Share this audit on X"
      >
        <IconX size={12} />
        {label}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide px-3 py-1.5"
      style={{
        background:     'rgba(6,12,26,0.8)',
        color:          'var(--gold-500)',
        border:         '1px solid rgba(240,192,64,0.4)',
        borderRadius:   '2px',
        cursor:         'pointer',
        backdropFilter: 'blur(4px)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-500)'; e.currentTarget.style.color = 'var(--navy-900)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(6,12,26,0.8)'; e.currentTarget.style.color = 'var(--gold-500)' }}
      aria-label="Share this audit on X"
    >
      <IconX size={12} />
      {label}
    </button>
  )
}
