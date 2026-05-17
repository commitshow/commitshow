// BackstageCurtainArt · full-bleed near-closed stage-curtain SVG used
// as the placeholder visual on every BACKSTAGE surface that doesn't
// have (or chooses to override) a thumbnail.
//
// 2026-05-18 simplified (CEO 피드백) · removed top valance + tassel
// trim · curtain panels swept inward so they nearly meet in the
// centre (small gap only, reads as "almost closed · about to open").
// Stays on brand: navy base + gold accent edge + cream caption.
//
// Scales to any aspect ratio (viewBox + preserveAspectRatio slice
// keeps the centre caption visible across phone / desktop crops).

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
        {/* Stage backdrop · deep plum-burgundy that gets darker toward
            the centre so the caption reads as lit from a hidden source.
            2026-05-18 (CEO 피드백) · was navy, swapped to burgundy
            for the classic theater-curtain palette (crimson velvet with
            gold trim). */}
        <radialGradient id="bsc-stage" cx="50%" cy="50%" r="55%">
          <stop offset="0%"  stopColor="#2A0F22" />
          <stop offset="65%" stopColor="#150511" />
          <stop offset="100%" stopColor="#08020A" />
        </radialGradient>
        {/* Curtain pleat · deep burgundy/aubergine velvet · darker
            palette (2026-05-18 CEO 피드백 · 커튼 좀 더 어둡게). Spine
            still light enough to read as a 3D fold. */}
        <linearGradient id="bsc-pleat" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor="#1A0613" />
          <stop offset="50%"  stopColor="#3D1226" />
          <stop offset="100%" stopColor="#1A0613" />
        </linearGradient>
        {/* Soft halo behind the caption · warm gold glow on burgundy. */}
        <radialGradient id="bsc-spot" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#F0C040" stopOpacity="0.22" />
          <stop offset="60%"  stopColor="#F0C040" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#F0C040" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Stage backdrop */}
      <rect x="0" y="0" width="1200" height="630" fill="url(#bsc-stage)" />

      {/* Soft halo around the caption position */}
      <ellipse cx="600" cy="315" rx="260" ry="150" fill="url(#bsc-spot)" />

      {/* Left curtain · panels extend inward to ~570 (almost meeting
          the centre). Each pleat is a slim trapezoid with a small
          bottom curve so the fabric reads as falling. */}
      <g>
        {LEFT_PLEATS.map(({ x, w }, i) => (
          <path
            key={`L${i}`}
            d={`M ${x} 0 L ${x + w} 0 L ${x + w + 6} 632 Q ${x + w / 2} 642 ${x - 4} 632 Z`}
            fill="url(#bsc-pleat)"
            opacity={0.94}
          />
        ))}
        {/* Inner edge rim · gold where the curtain meets the open gap.
            Slightly dimmed to match the darker pleat palette. */}
        <path
          d="M 580 0 L 588 0 L 596 632 Q 580 642 558 632 L 562 0 Z"
          fill="#F0C040"
          opacity={0.22}
        />
      </g>

      {/* Right curtain · mirror · panels start at ~625 (small gap of
          about 50px in the centre · reads as 'closed, about to open'). */}
      <g>
        {RIGHT_PLEATS.map(({ x, w }, i) => (
          <path
            key={`R${i}`}
            d={`M ${x} 0 L ${x + w} 0 L ${x + w + 4} 632 Q ${x + w / 2} 642 ${x - 6} 632 Z`}
            fill="url(#bsc-pleat)"
            opacity={0.94}
          />
        ))}
        <path
          d="M 612 0 L 638 0 L 642 632 Q 620 642 604 632 L 608 0 Z"
          fill="#F0C040"
          opacity={0.22}
        />
      </g>

      {/* Caption · enlarged (2026-05-18 CEO 피드백 · text was too small
          to read on cards in the lane). Uses cream + DM Mono with
          wide tracking · marquee letter-card feel. Sub-caption now
          large enough to read at thumbnail scale too. */}
      <g transform="translate(600, 300)">
        <text
          textAnchor="middle"
          x="0"
          y="0"
          fontFamily="DM Mono, monospace"
          fontSize="44"
          fontWeight="600"
          letterSpacing="10"
          fill="#F8F5EE"
          opacity="0.96"
        >
          {caption}
        </text>
        {subCaption && (
          <text
            textAnchor="middle"
            x="0"
            y="56"
            fontFamily="DM Mono, monospace"
            fontSize="22"
            letterSpacing="4"
            fill="#F8F5EE"
            opacity="0.65"
          >
            {subCaption}
          </text>
        )}
      </g>
    </svg>
  )
}

// Pleat geometry · two banks. LEFT runs 0 → ~580 with the last
// pleat acting as the inward sweep · RIGHT mirrors 620 → 1200. The
// 40px central gap is intentional · curtain reads as nearly closed.
const LEFT_PLEATS = [
  { x:   0, w: 120 },
  { x:  95, w: 110 },
  { x: 185, w: 100 },
  { x: 270, w:  95 },
  { x: 350, w:  90 },
  { x: 425, w:  85 },
  { x: 495, w:  75 },
]
const RIGHT_PLEATS = [
  { x: 620, w:  75 },
  { x: 685, w:  85 },
  { x: 760, w:  90 },
  { x: 840, w:  95 },
  { x: 925, w: 100 },
  { x:1010, w: 110 },
  { x:1090, w: 120 },
]
