// BackstageCurtainArt · full-bleed stage-curtain SVG used as the
// placeholder visual on every BACKSTAGE surface that doesn't have
// (or chooses to override) a thumbnail. Replaces the earlier tiny-
// icon-on-gradient placeholder with a recognizable theater curtain
// metaphor (vertical pleats sweeping from left + right, gold
// valance + tassels at top, spotlight circle in the gap, caption
// inside the spotlight) so a backstage card reads at a glance as
// "stage prep · not opened yet" rather than "image failed to load".
//
// On brand: navy base + gold accents (no red velvet · CLAUDE.md §4
// reserves scarlet for warnings). The curtain still parses as a
// theater curtain through the silhouette + tassels + spotlight.
//
// Scales to any aspect ratio thanks to viewBox + preserveAspectRatio
// (slice for thumbnails so the spotlight stays centered).

interface Props {
  /** Caption inside the spotlight · defaults to BEHIND THE CURTAIN. */
  caption?: string
  /** Sub-line under the caption · small mono text · optional. */
  subCaption?: string
}

export function BackstageCurtainArt({
  caption = 'BEHIND THE CURTAIN',
  subCaption,
}: Props) {
  return (
    <svg
      viewBox="0 0 1200 630"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={caption}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        {/* Stage background gradient · deepest in the centre so the
            spotlight reads as actual light. */}
        <radialGradient id="bsc-stage" cx="50%" cy="55%" r="65%">
          <stop offset="0%"  stopColor="#0F2040" />
          <stop offset="60%" stopColor="#070D1C" />
          <stop offset="100%" stopColor="#03060F" />
        </radialGradient>
        {/* Curtain pleat gradient · alternates light → dark band so
            each "pleat" looks 3D without needing per-pleat fills. */}
        <linearGradient id="bsc-pleat" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor="#0F2040" />
          <stop offset="50%"  stopColor="#1B2F58" />
          <stop offset="100%" stopColor="#0F2040" />
        </linearGradient>
        {/* Spotlight beam · soft yellow → fades to nothing. */}
        <radialGradient id="bsc-spot" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#F0C040" stopOpacity="0.28" />
          <stop offset="55%"  stopColor="#F0C040" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#F0C040" stopOpacity="0" />
        </radialGradient>
        {/* Valance shimmer · top trim gradient. */}
        <linearGradient id="bsc-valance" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="#C49126" />
          <stop offset="50%"  stopColor="#F0C040" />
          <stop offset="100%" stopColor="#8B6418" />
        </linearGradient>
      </defs>

      {/* Stage backdrop */}
      <rect x="0" y="0" width="1200" height="630" fill="url(#bsc-stage)" />

      {/* Spotlight beam centered on the gap */}
      <ellipse cx="600" cy="320" rx="420" ry="260" fill="url(#bsc-spot)" />

      {/* Left curtain · 7 pleats sweeping in. Each pleat is a quad
          with a small inward bottom curve. The whole left panel
          covers the leftmost ~38% of the canvas. */}
      <g>
        {LEFT_PLEATS.map(({ x, w }, i) => (
          <path
            key={`L${i}`}
            d={`M ${x} 0 L ${x + w} 0 L ${x + w + 8} 600 Q ${x + w / 2} 620 ${x - 4} 600 Z`}
            fill="url(#bsc-pleat)"
            opacity={0.92}
          />
        ))}
        {/* Inner edge highlight on the left panel · gold rim where
            curtain meets spotlight gap. */}
        <path
          d="M 455 0 L 460 600 Q 440 620 425 600 L 420 0 Z"
          fill="#F0C040"
          opacity={0.22}
        />
      </g>

      {/* Right curtain · mirror of left, sweeping in from the right. */}
      <g>
        {RIGHT_PLEATS.map(({ x, w }, i) => (
          <path
            key={`R${i}`}
            d={`M ${x} 0 L ${x + w} 0 L ${x + w + 4} 600 Q ${x + w / 2} 620 ${x - 8} 600 Z`}
            fill="url(#bsc-pleat)"
            opacity={0.92}
          />
        ))}
        <path
          d="M 740 0 L 745 0 L 780 600 Q 765 620 740 600 Z"
          fill="#F0C040"
          opacity={0.22}
        />
      </g>

      {/* Gold valance + tassel rod · sits over the top edge to lock
          in the theater feel. */}
      <rect x="0" y="0" width="1200" height="44" fill="url(#bsc-valance)" opacity={0.95} />
      <rect x="0" y="44" width="1200" height="4" fill="#8B6418" opacity={0.85} />
      {/* Tassel beads · 5 evenly spaced */}
      {[120, 360, 600, 840, 1080].map(cx => (
        <g key={cx}>
          <line x1={cx} y1="48" x2={cx} y2="78" stroke="#C49126" strokeWidth="2" />
          <circle cx={cx} cy="82" r="6" fill="#F0C040" />
        </g>
      ))}

      {/* Caption block sits inside the spotlight */}
      <g transform="translate(600, 305)">
        {/* Subtle drop-glow behind the caption · lifts the text
            against the dark stage. */}
        <circle cx="0" cy="0" r="180" fill="#F0C040" opacity="0.04" />
        <text
          textAnchor="middle"
          x="0"
          y="-4"
          fontFamily="DM Mono, monospace"
          fontSize="24"
          letterSpacing="6"
          fill="#F8F5EE"
          opacity="0.92"
        >
          {caption}
        </text>
        {subCaption && (
          <text
            textAnchor="middle"
            x="0"
            y="32"
            fontFamily="DM Mono, monospace"
            fontSize="14"
            letterSpacing="3"
            fill="#F8F5EE"
            opacity="0.55"
          >
            {subCaption}
          </text>
        )}
      </g>
    </svg>
  )
}

// Pleat geometry · two banks of vertical panels, each slightly
// trapezoidal so they read as fabric falling toward the floor.
// Tweaking the x/w pairs reshapes the curtain without code change.
const LEFT_PLEATS = [
  { x:   0, w: 110 },
  { x:  85, w: 100 },
  { x: 165, w:  95 },
  { x: 240, w:  90 },
  { x: 310, w:  80 },
  { x: 375, w:  60 },
  { x: 420, w:  40 },
]
const RIGHT_PLEATS = [
  { x: 740, w:  40 },
  { x: 770, w:  60 },
  { x: 815, w:  80 },
  { x: 880, w:  90 },
  { x: 950, w:  95 },
  { x:1020, w: 100 },
  { x:1090, w: 110 },
]
