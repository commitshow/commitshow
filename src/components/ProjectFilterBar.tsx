import { useState } from 'react'
import type { GridFilters } from '../lib/projectQueries'

export type ProjectFilters = GridFilters

const GRADES = ['Rookie', 'Builder', 'Maker', 'Architect', 'Vibe Engineer', 'Legend'] as const

const STATUS_TABS: Array<{ value: NonNullable<ProjectFilters['status']>; label: string }> = [
  { value: 'any',       label: 'All'       },
  { value: 'active',    label: 'Active'    },
  { value: 'graduated', label: 'Graduated' },
  { value: 'retry',     label: 'Rookie Circle' },
]

// §11-NEW.1.1 · 7-category use-case taxonomy chip strip (2026-04-30 redesign).
// Form factor (web/mobile/CLI) / stage / pricing are orthogonal filters now.
const CATEGORY_TABS: Array<{ value: NonNullable<ProjectFilters['category']>; label: string }> = [
  { value: 'any',                   label: 'All'                    },
  { value: 'productivity_personal', label: 'Productivity & Personal' },
  { value: 'niche_saas',            label: 'Niche SaaS'             },
  { value: 'creator_media',         label: 'Creator & Media'        },
  { value: 'dev_tools',             label: 'Dev Tools'              },
  { value: 'ai_agents_chat',        label: 'AI Agents & Chat'       },
  { value: 'consumer_lifestyle',    label: 'Consumer & Lifestyle'   },
  { value: 'games_playful',         label: 'Games & Playful'        },
]

const SORTS: Array<{ value: NonNullable<ProjectFilters['sort']>; label: string }> = [
  { value: 'newest',    label: 'Newest'         },
  { value: 'score',     label: 'Top score'      },
  { value: 'forecasts', label: 'Most forecasts' },
]

const SCORE_BANDS: Array<{ value: number; label: string }> = [
  { value: 0,  label: 'Any score' },
  { value: 50, label: '≥ 50'      },
  { value: 70, label: '≥ 70'      },
  { value: 85, label: '≥ 85'      },
]

interface Props {
  value: ProjectFilters
  onChange: (next: ProjectFilters) => void
  totalCount?: number | null
}

export function ProjectFilterBar({ value, onChange, totalCount }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const set = <K extends keyof ProjectFilters>(key: K) =>
    (v: ProjectFilters[K]) => onChange({ ...value, [key]: v })

  const currentStatus   = value.status   ?? 'any'
  const currentCategory = value.category ?? 'any'
  const hasGrade    = !!value.grade
  const hasMinScore = !!value.minScore && value.minScore > 0
  const drawerCount = (hasGrade ? 1 : 0) + (hasMinScore ? 1 : 0)

  return (
    <div>
      {/* ── Category chip strip · primary filter axis (§11-NEW.1.1) ── */}
      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
        {CATEGORY_TABS.map(c => {
          const active = currentCategory === c.value
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => set('category')(c.value)}
              className="font-mono text-[11px] tracking-wide px-2.5 py-1"
              style={{
                background:  active ? 'rgba(240,192,64,0.12)' : 'transparent',
                color:       active ? 'var(--gold-500)' : 'var(--text-secondary)',
                border:      `1px solid ${active ? 'rgba(240,192,64,0.5)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '2px',
                cursor:      'pointer',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* ── Single row · pump.fun-style dense controls ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>⌕</span>
          <input
            type="search"
            value={value.search ?? ''}
            onChange={e => set('search')(e.target.value)}
            placeholder="Search…"
            className="w-full pl-7 pr-2.5 py-1.5 font-mono text-xs"
            style={{ lineHeight: 1.4 }}
          />
        </div>

        {/* Status chips · segmented */}
        <div className="flex items-center gap-0 overflow-hidden" style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '2px',
          background: 'rgba(6,12,26,0.5)',
        }}>
          {STATUS_TABS.map(t => {
            const active = currentStatus === t.value
            return (
              <button
                key={t.value}
                onClick={() => set('status')(t.value)}
                className="px-2.5 py-1.5 font-mono text-[11px] tracking-wide whitespace-nowrap transition-colors"
                style={{
                  background: active ? 'var(--gold-500)' : 'transparent',
                  color:      active ? 'var(--navy-900)' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Sort */}
        <select
          value={value.sort ?? 'newest'}
          onChange={e => set('sort')(e.target.value as ProjectFilters['sort'])}
          className="px-2 py-1.5 font-mono text-[11px]"
          style={{
            background: 'rgba(6,12,26,0.5)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--cream)',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          {SORTS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {/* More filters toggle */}
        <button
          onClick={() => setDrawerOpen(v => !v)}
          className="px-2.5 py-1.5 font-mono text-[11px] tracking-wide"
          style={{
            background: drawerOpen || drawerCount > 0 ? 'rgba(240,192,64,0.1)' : 'transparent',
            color: drawerOpen || drawerCount > 0 ? 'var(--gold-500)' : 'var(--text-secondary)',
            border: `1px solid ${drawerOpen || drawerCount > 0 ? 'rgba(240,192,64,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '2px',
            cursor: 'pointer',
          }}
        >
          {drawerOpen ? 'Less' : 'More'} filters{drawerCount > 0 ? ` · ${drawerCount}` : ''}
        </button>

        {totalCount != null && (
          <span className="font-mono text-[10px] tabular-nums ml-auto" style={{ color: 'var(--text-muted)' }}>
            {totalCount} project{totalCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* ── Drawer · grade + score band · collapsed by default ── */}
      {drawerOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2" style={{
          padding: '8px 10px',
          background: 'rgba(6,12,26,0.35)',
          border: '1px dashed rgba(255,255,255,0.08)',
          borderRadius: '2px',
        }}>
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>MORE</span>
          <Select
            value={value.grade ?? ''}
            options={[{ value: '', label: 'Any grade' }, ...GRADES.map(g => ({ value: g, label: g }))]}
            onChange={v => set('grade')(v || undefined)}
          />
          <Select
            value={String(value.minScore ?? 0)}
            options={SCORE_BANDS.map(b => ({ value: String(b.value), label: b.label }))}
            onChange={v => set('minScore')(Number(v) || undefined)}
          />
          {drawerCount > 0 && (
            <button
              onClick={() => onChange({ ...value, grade: undefined, minScore: undefined })}
              className="font-mono text-[10px] tracking-widest px-2 py-0.5"
              style={{
                background: 'transparent',
                color: 'var(--scarlet)',
                border: '1px solid rgba(200,16,46,0.35)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              RESET ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Select({
  value, options, onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2 py-1.5 font-mono text-[11px]"
      style={{
        background: 'rgba(6,12,26,0.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'var(--cream)',
        borderRadius: '2px',
        cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
