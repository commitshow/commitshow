// Pretendard font loader · scoped to .pitch-deck-root.
//
// Both /pitch and /pitch-k call usePretendardFont() at mount. We inject
// the CDN <link> for Pretendard Variable into <head> the first time
// (browser dedupes if the page is re-mounted) and a single <style> tag
// that overrides every font-family declaration inside .pitch-deck-root
// — including Tailwind's font-display / font-mono utility classes — so
// the entire deck reads in Pretendard while the rest of the site keeps
// its Playfair Display + DM Sans + DM Mono identity.
//
// Why class-scoped + !important:
//   · Tailwind utilities like `font-display` / `font-mono` apply
//     font-family at the same specificity as ours; the !important is
//     the only way to win without rewriting every JSX node.
//   · Class-scoped means the rule never leaks past the deck. Landing /
//     ladder / project pages remain on the Ivy League stack.

import { useEffect } from 'react'

const LINK_ID  = 'pitch-pretendard-link'
const STYLE_ID = 'pitch-pretendard-style'

const FONT_STACK = `'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`

const SCOPED_CSS = `
.pitch-deck-root,
.pitch-deck-root * {
  font-family: ${FONT_STACK} !important;
}
/* Keep tabular-nums for stat cells — Pretendard Variable supports it */
.pitch-deck-root .tabular-nums {
  font-variant-numeric: tabular-nums;
}
/* Code and pre still get monospace inside Pretendard for readability */
.pitch-deck-root code,
.pitch-deck-root pre {
  font-family: 'Pretendard Variable', Pretendard, ui-monospace, SFMono-Regular, Menlo, monospace !important;
}
`

export function usePretendardFont(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return

    if (!document.getElementById(LINK_ID)) {
      const link = document.createElement('link')
      link.id   = LINK_ID
      link.rel  = 'stylesheet'
      link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css'
      document.head.appendChild(link)
    }

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id           = STYLE_ID
      style.textContent  = SCOPED_CSS
      document.head.appendChild(style)
    }

    // No cleanup · once loaded the font is cached and the scoped CSS
    // is harmless on other pages (only matches .pitch-deck-root).
  }, [])
}
