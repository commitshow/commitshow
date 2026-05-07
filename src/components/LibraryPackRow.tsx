// Library row component · v2 Trending-style list (§15.6.5).
// One row per artifact · dense · scan-first.
// Left: format icon. Title row with right-aligned Applaud + Apply.
// Bottom: provenance + tags + stats + price.

import { Link } from 'react-router-dom'
import {
  ARTIFACT_FORMAT_LABELS,
  ARTIFACT_INTENT_LABELS,
  type ArtifactFormat,
  type ArtifactIntent,
  type CreatorGrade,
  type MDLibraryFeedItem,
} from '../lib/supabase'
import {
  IconMcpConfig,
  IconIdeRules,
  IconAgentSkill,
  IconProjectRules,
  IconPromptPack,
  IconPatchRecipe,
  IconScaffold,
  IconArtifactGeneric,
  IconGraduation,
  IconWand,
} from './icons'
import { resolveCreatorName, resolveCreatorInitial } from '../lib/creatorName'

const GRADE_COLORS: Record<CreatorGrade, string> = {
  Rookie: '#6B7280', Builder: '#60A5FA', Maker: '#00D4AA',
  Architect: '#A78BFA', 'Vibe Engineer': '#F0C040', Legend: '#C8102E',
}

const INTENT_TONE: Record<ArtifactIntent, string> = {
  build_feature:   '#F0C040',   // gold
  connect_service: '#60A5FA',   // blue
  tune_ai:         '#A78BFA',   // violet
  start_project:   '#00D4AA',   // teal
}

const FORMAT_ICON: Record<ArtifactFormat, (p: { size?: number }) => React.ReactElement> = {
  mcp_config:    IconMcpConfig,
  ide_rules:     IconIdeRules,
  agent_skill:   IconAgentSkill,
  project_rules: IconProjectRules,
  prompt_pack:   IconPromptPack,
  patch_recipe:  IconPatchRecipe,
  scaffold:      IconScaffold,
}

interface Props {
  item: MDLibraryFeedItem
}

export function LibraryPackRow({ item }: Props) {
  const format     = item.target_format
  const intent     = item.intent
  const FormatIcon = format ? FORMAT_ICON[format] : IconArtifactGeneric
  const authorName = resolveCreatorName({ display_name: item.author_name })
  const authorGrade = (item.author_grade ?? item.current_author_grade) as CreatorGrade | null
  const gradeColor = authorGrade ? GRADE_COLORS[authorGrade] : '#6B7280'
  const priceLabel = item.is_free
    ? 'FREE'
    : `$${(item.price_cents / 100).toFixed(item.price_cents % 100 === 0 ? 0 : 2)}`
  const applied    = item.projects_applied_count ?? 0
  const graduated  = item.projects_graduated_count ?? 0
  const intentTone = INTENT_TONE[intent] ?? '#F0C040'

  return (
    <Link
      to={`/library/${item.id}`}
      className="block card-navy px-3 py-3 md:px-5 md:py-4 transition-all overflow-hidden"
      style={{
        borderRadius: '2px',
        borderLeft: `3px solid ${intentTone}`,
        textDecoration: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(240,192,64,0.35)'
        e.currentTarget.style.transform   = 'translateY(-1px)'
        e.currentTarget.style.boxShadow   = '0 12px 32px -16px rgba(240,192,64,0.25)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = ''
        e.currentTarget.style.transform   = ''
        e.currentTarget.style.boxShadow   = ''
      }}
    >
      <div className="flex items-start gap-3 md:gap-4">
        {/* Left icon · single color · §4 rule */}
        <span
          aria-hidden="true"
          className="flex-shrink-0 mt-1"
          style={{ color: intentTone, display: 'inline-flex' }}
        >
          <FormatIcon size={24} />
        </span>

        {/* Main content · min-w-0 so the flex parent's width is enforced
            and long titles can truncate instead of expanding the row past
            the card edge on narrow viewports. */}
        <div className="flex-1 min-w-0">
          {/* Title row + right-aligned price + verified badge.
              flex-wrap so the badge can drop below on narrow screens
              instead of pushing the title off-canvas. min-w-0 on the
              title is what actually lets `truncate` clip an overlong name. */}
          <div className="flex items-start justify-between gap-2 mb-0.5 flex-wrap">
            <h3
              className="font-display font-bold leading-tight truncate min-w-0"
              style={{ color: 'var(--cream)', fontSize: '1.05rem', letterSpacing: '-0.005em' }}
            >
              {item.title}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {item.verified_badge && (
                <span
                  className="font-mono text-[10px] tracking-widest px-1.5 py-0.5"
                  style={{
                    color: '#00D4AA',
                    background: 'rgba(0,212,170,0.08)',
                    border: '1px solid rgba(0,212,170,0.3)',
                    borderRadius: '2px',
                  }}
                >
                  VERIFIED
                </span>
              )}
              <span
                className="font-mono text-[11px] md:text-xs tracking-wide px-2 py-0.5 md:px-2.5 md:py-1"
                style={{
                  background: item.is_free ? 'rgba(0,212,170,0.1)' : 'rgba(240,192,64,0.12)',
                  color:      item.is_free ? '#00D4AA' : 'var(--gold-500)',
                  border:     `1px solid ${item.is_free ? 'rgba(0,212,170,0.4)' : 'rgba(240,192,64,0.45)'}`,
                  borderRadius: '2px',
                }}
              >
                {priceLabel}
              </span>
            </div>
          </div>

          {/* Author strip · wraps on narrow screens so a long name +
              grade + "from <source_project>" doesn't push past the card. */}
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap font-mono text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
            <span
              className="inline-flex items-center justify-center overflow-hidden"
              style={{
                width: 18, height: 18,
                background: item.author_avatar_url ? 'var(--navy-800)' : 'var(--gold-500)',
                color: 'var(--navy-900)',
                borderRadius: '2px',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {item.author_avatar_url
                ? <img src={item.author_avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: 'cover' }} />
                : resolveCreatorInitial({ display_name: item.author_name })}
            </span>
            <strong style={{ color: 'var(--cream)' }}>{authorName}</strong>
            {authorGrade && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
                <span style={{ color: gradeColor }}>{authorGrade}</span>
              </>
            )}
            {item.source_project_name && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
                <span className="inline-flex items-center gap-0.5" style={{ color: '#00D4AA' }}>
                  <IconGraduation size={10} />
                  <span className="truncate">from {item.source_project_name}</span>
                </span>
              </>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <p
              className="font-light text-sm mb-2"
              style={{ color: 'var(--text-primary)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {item.description}
            </p>
          )}

          {/* Tag strip — intent + format + stack tags */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span
              className="font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5"
              style={{
                background: `${intentTone}18`,
                color:      intentTone,
                border:     `1px solid ${intentTone}55`,
                borderRadius: '2px',
              }}
            >
              {ARTIFACT_INTENT_LABELS[intent]}
            </span>
            {format && (
              <span
                className="font-mono text-[10px] tracking-wide px-1.5 py-0.5"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '2px',
                }}
              >
                {ARTIFACT_FORMAT_LABELS[format]}
              </span>
            )}
            {(item.stack_tags ?? []).slice(0, 4).map(t => (
              <span
                key={t}
                className="font-mono text-[10px] px-1.5 py-0.5"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '2px',
                }}
              >
                #{t}
              </span>
            ))}
          </div>

          {/* Stats row — downloads · applied · graduated-with-this.
              flex-wrap so a long stack of "graduated" + "applied" + downloads
              + source-score doesn't bleed past the card edge on narrow phones. */}
          <div
            className="flex items-center gap-x-4 gap-y-1 flex-wrap font-mono text-[11px] tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            <span title="Downloads">
              ↓ <span style={{ color: 'var(--text-primary)' }}>{item.downloads_count}</span>
            </span>
            {applied > 0 && (
              <span
                title={`${applied} project${applied === 1 ? '' : 's'} applied this artifact`}
                className="inline-flex items-center gap-1"
              >
                <IconWand size={11} style={{ color: 'var(--gold-500)' }} />
                <span style={{ color: 'var(--gold-500)' }}>{applied}</span> applied
              </span>
            )}
            {graduated > 0 && (
              <span
                title={`${graduated} Encore project${graduated === 1 ? '' : 's'} used this artifact`}
                className="inline-flex items-center gap-1"
              >
                <IconGraduation size={11} style={{ color: '#00D4AA' }} />
                <span style={{ color: '#00D4AA' }}>{graduated}</span> Encore
              </span>
            )}
            {item.source_project_score != null && (
              <span>source score <span style={{ color: 'var(--text-primary)' }}>{item.source_project_score}</span></span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
