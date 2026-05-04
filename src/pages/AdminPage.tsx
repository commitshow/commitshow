// AdminPage — 관리자 콘솔 (한국어 전용 · gate: members.is_admin = true)
// 표시 항목: 사용자 통계 · 최근 audit · CLI 사용 현황 · 강제 재감사 도구.
// 인증: 로그인된 멤버의 is_admin 검사 (DB 컬럼). 미인증/일반 사용자엔 가드.
//
// 관리자 전용 작업은 ADMIN_TOKEN (Supabase secret) 헤더로 audit-preview /
// admin-run 등을 호출. 이 페이지는 로컬스토리지에 토큰을 저장 (1회 입력).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invalidateLadderCache } from '../lib/ladder'
import { EmailTemplatesPanel } from './AdminEmailsPage'

const ADMIN_TOKEN_KEY = 'commitshow.admin.token'

interface UserStats {
  total:      number
  newWeek:    number
  activeWeek: number
  byTier:     Record<string, number>
  admins:     number
}

interface UserRow {
  id:              string
  display_name:    string | null
  tier:            string
  creator_grade:   string | null
  activity_points: number
  total_graduated: number
  is_admin:        boolean
  created_at:      string
  // Populated by admin_member_login_methods RPC · provider keys are
  // 'email' · 'google' · 'github' · 'twitter' · 'linkedin_oidc'.
  providers?:      string[]
}

interface AuditStats {
  todayCount:    number
  weekCount:     number
  avgScore:      number | null
  failed24h:     number
  cliPreviewCnt: number
}

interface CliUsage {
  totalToday:        number
  uniqueIps:         number
  topRepos:          Array<{ url: string; count: number }>
  globalRemaining:   number | null
  recentCalls:       Array<{
    id:           string
    project_id:   string | null
    project_name: string
    github_url:   string | null
    score_total:  number
    trigger_type: string
    created_at:   string
  }>
  // From cli_audit_calls · per-call telemetry (source · cli_version ·
  // platform). Distinct from preview_rate_limits which is per-day-counter.
  callsToday:        number          // total CLI hits today (engine + cache)
  cacheHitsToday:    number          // subset that were cache hits
  bySource:          Array<{ source: string; count: number }>
  byCliVersion:      Array<{ version: string; count: number }>
  byPlatform:        Array<{ platform: string; count: number }>
  callsLast7d:       Array<{ day: string; count: number }>
}

interface RecentAudit {
  id:           string
  project_id:   string
  project_name: string
  github_url:   string | null
  score_total:  number
  score_auto:   number
  trigger_type: string
  created_at:   string
  has_error:    boolean
  error_msg:    string | null
}

interface SeasonRow {
  id:               string
  name:             string
  start_date:       string
  end_date:         string
  applaud_end:      string
  graduation_date:  string
  status:           string
}

// Season date arithmetic (CLAUDE.md §11.2):
//   Week 1-3 = Day 1-21 → end_date = start + 20d (inclusive day 21)
//   Graduation Week = Day 22-28 → applaud_end = start + 27d
//   Graduation Day  = Day 29 → graduation_date = start + 28d
function computeSeasonDates(startISO: string) {
  const start = new Date(startISO + 'T00:00:00Z')
  const addDays = (n: number) => {
    const d = new Date(start.getTime())
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  return {
    end_date:        addDays(20),
    applaud_end:     addDays(27),
    graduation_date: addDays(28),
  }
}

const STATUS_COLORS: Record<string, string> = {
  upcoming:  'rgba(255,255,255,0.55)',
  active:    '#F0C040',
  applaud:   '#A78BFA',
  completed: 'rgba(255,255,255,0.45)',
}

export function AdminPage() {
  const { user, member, loading } = useAuth()
  const navigate = useNavigate()

  const [token, setToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) ?? '')
  const [tokenInput, setTokenInput] = useState('')
  const [tab, setTab] = useState<'overview' | 'users' | 'audits' | 'cli' | 'policy' | 'emails' | 'tools'>('overview')

  const [userStats, setUserStats]   = useState<UserStats   | null>(null)
  const [auditStats, setAuditStats] = useState<AuditStats  | null>(null)
  const [cliUsage, setCliUsage]     = useState<CliUsage    | null>(null)
  const [recent, setRecent]         = useState<RecentAudit[]>([])
  const [userList, setUserList]     = useState<UserRow[]>([])
  const [loadErr, setLoadErr]       = useState<string | null>(null)

  // 강제 재감사 · 글로벌 폼 (Tools 탭) + 행별 진행 상태 (Audits / CLI 탭)
  const [refreshUrl, setRefreshUrl] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshOut, setRefreshOut] = useState<string | null>(null)
  // 행별 in-flight URL set + 결과 메시지 (URL 키 기준).
  // 한 번에 여러 행 재감사 가능하게 Set + Map 으로 분리.
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set())
  const [rowOut, setRowOut]   = useState<Map<string, { kind: 'ok' | 'err' | 'done'; msg: string }>>(new Map())

  // 권한 토글
  const [grantBusyId, setGrantBusyId]     = useState<string | null>(null)
  const [grantOut, setGrantOut]           = useState<string | null>(null)

  // 일괄 재감사 (활성 프로젝트 전부 새 detector 로 refresh)
  const [bulkBusy, setBulkBusy]           = useState(false)
  const [bulkAgeDays, setBulkAgeDays]     = useState<number>(0)  // 0 = all active
  const [bulkLog, setBulkLog]             = useState<Array<{ name: string; status: 'fire' | 'ok' | 'err'; msg: string }>>([])

  // 시즌 관리
  const [seasons, setSeasons]             = useState<SeasonRow[]>([])
  const [seasonName, setSeasonName]       = useState('')
  const [seasonStart, setSeasonStart]     = useState('')   // YYYY-MM-DD
  const [seasonStatus, setSeasonStatus]   = useState<'upcoming' | 'active'>('upcoming')
  const [seasonBusy, setSeasonBusy]       = useState(false)
  const [seasonOut, setSeasonOut]         = useState<string | null>(null)

  const isAdmin = !!member?.is_admin

  useEffect(() => {
    if (loading) return
    if (!user) return                      // 로그인 화면으로 안 보냄 — 토큰 진입로 열려있음
    if (!isAdmin) return
    void loadAll()
  }, [loading, user, isAdmin])

  async function loadAll() {
    setLoadErr(null)
    try {
      await Promise.all([loadUserStats(), loadAuditStats(), loadCliUsage(), loadRecent(), loadUserList(), loadSeasons()])
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e))
    }
  }

  async function loadSeasons() {
    // §11-NEW.8 · read from events (template_type='quarterly'). The shape
    // is mapped back to SeasonRow so the rest of the admin page doesn't
    // care which table is the source of truth.
    const { data } = await supabase
      .from('events')
      .select('id, name, starts_at, ends_at, applaud_end, graduation_date, status')
      .eq('template_type', 'quarterly')
      .order('starts_at', { ascending: false })
      .limit(10)
    type EventRow = {
      id: string; name: string
      starts_at: string | null; ends_at: string | null
      applaud_end: string | null; graduation_date: string | null
      status: 'draft' | 'live' | 'closed' | 'frozen'
    }
    const mapped: SeasonRow[] = (data ?? []).map((r: EventRow) => ({
      id:               r.id,
      name:             r.name,
      start_date:       (r.starts_at ?? '').slice(0, 10),
      end_date:         r.applaud_end ?? (r.ends_at ?? '').slice(0, 10),
      applaud_end:      r.applaud_end ?? '',
      graduation_date:  r.graduation_date ?? '',
      status:
        r.status === 'draft'  ? 'upcoming'  :
        r.status === 'live'   ? 'active'    :
        r.status === 'closed' ? 'completed' :
        r.status === 'frozen' ? 'completed' : 'upcoming',
    }))
    setSeasons(mapped)
  }

  async function loadUserList() {
    const [{ data }, { data: methods }] = await Promise.all([
      supabase
        .from('members')
        .select('id, display_name, tier, creator_grade, activity_points, total_graduated, is_admin, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      // admin_member_login_methods · SECURITY DEFINER · admin-gated RPC
      // (20260504_admin_login_methods migration). Returns user_id +
      // providers[] aggregated from auth.identities.
      supabase.rpc('admin_member_login_methods'),
    ])
    const providerMap = new Map<string, string[]>()
    for (const r of (methods ?? []) as Array<{ user_id: string; providers: string[] }>) {
      providerMap.set(r.user_id, r.providers ?? [])
    }
    const rows = ((data ?? []) as UserRow[]).map(r => ({
      ...r,
      providers: providerMap.get(r.id) ?? [],
    }))
    setUserList(rows)
  }

  async function loadUserStats() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const [allRes, newRes, adminRes] = await Promise.all([
      supabase.from('members').select('id, tier, created_at, is_admin', { count: 'exact', head: false }).limit(2000),
      supabase.from('members').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('is_admin', true),
    ])
    const rows = (allRes.data ?? []) as Array<{ id: string; tier: string; created_at: string; is_admin: boolean }>
    const byTier: Record<string, number> = {}
    for (const r of rows) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1
    // active = members table doesn't have last_active; approximate via recent activity_point_ledger if exists
    let activeWeek = 0
    try {
      const { count } = await supabase
        .from('activity_point_ledger')
        .select('member_id', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo)
      activeWeek = count ?? 0
    } catch { /* table may not exist · ignore */ }
    setUserStats({
      total:      allRes.count ?? rows.length,
      newWeek:    newRes.count ?? 0,
      activeWeek,
      byTier,
      admins:     adminRes.count ?? 0,
    })
  }

  async function loadAuditStats() {
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
    const weekStart  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const [todayRes, weekRes, errRes, scoreRes] = await Promise.all([
      supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('analysis_snapshots')
        .select('id, rich_analysis', { count: 'exact', head: false })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(500),
      supabase.from('analysis_snapshots').select('score_total').gte('created_at', weekStart).limit(500),
    ])
    const errRows = (errRes.data ?? []) as Array<{ id: string; rich_analysis: { error?: unknown } | null }>
    const failed = errRows.filter(r => r.rich_analysis?.error).length
    const scores = (scoreRes.data ?? []).map((r: any) => r.score_total).filter((n: number) => n > 0)
    const avg = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null

    // CLI preview 비율 추정 — projects.status='preview' 의 snapshot
    let cliPreviewCnt = 0
    try {
      const { count } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'preview')
        .gte('last_analysis_at', weekStart)
      cliPreviewCnt = count ?? 0
    } catch { /* ignore */ }

    setAuditStats({
      todayCount:    todayRes.count ?? 0,
      weekCount:     weekRes.count ?? 0,
      avgScore:      avg,
      failed24h:     failed,
      cliPreviewCnt,
    })
  }

  async function loadCliUsage() {
    const today      = new Date().toISOString().slice(0, 10)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [allRes, globalRes, recentRes, callsTodayRes, callsWeekRes] = await Promise.all([
      supabase.from('preview_rate_limits').select('ip_hash, count').eq('day', today).limit(500),
      supabase.from('preview_rate_limits').select('count').eq('ip_hash', 'global').eq('day', today).maybeSingle(),
      // §11-NEW.7 admin · latest 10 CLI calls = snapshots whose project is
      // status='preview' (the walk-on bucket). Inner join via embedded select.
      supabase.from('analysis_snapshots')
        .select('id, project_id, score_total, trigger_type, created_at, projects!inner(project_name, github_url, status)')
        .eq('projects.status', 'preview')
        .order('created_at', { ascending: false })
        .limit(10),
      // Per-call telemetry · today · for source/version/platform breakdown.
      supabase.from('cli_audit_calls')
        .select('source, cli_version, platform, cache_hit')
        .gte('created_at', `${today}T00:00:00Z`)
        .limit(2000),
      // Last 7 days · for the trend chart.
      supabase.from('cli_audit_calls')
        .select('created_at')
        .gte('created_at', sevenDaysAgo)
        .limit(5000),
    ])
    const rows = (allRes.data ?? []) as Array<{ ip_hash: string; count: number }>
    const ips    = rows.filter(r => r.ip_hash.startsWith('ip:'))
    const urls   = rows.filter(r => r.ip_hash.startsWith('url:'))
    const totalToday = ips.reduce((s, r) => s + r.count, 0)
    const topRepos = urls
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(r => ({ url: r.ip_hash.replace(/^url:/, ''), count: r.count }))
    const globalCount = (globalRes.data as { count?: number } | null)?.count ?? 0
    type RecentRaw = {
      id: string; project_id: string | null
      score_total: number | null; trigger_type: string | null; created_at: string
      projects: { project_name: string; github_url: string | null } | null
    }
    const recentCalls = ((recentRes.data as unknown as RecentRaw[]) ?? []).map(r => ({
      id:           r.id,
      project_id:   r.project_id,
      project_name: r.projects?.project_name ?? '(unknown)',
      github_url:   r.projects?.github_url ?? null,
      score_total:  r.score_total ?? 0,
      trigger_type: r.trigger_type ?? '?',
      created_at:   r.created_at,
    }))
    // Aggregate per-call telemetry.
    type CallRow = { source: string | null; cli_version: string | null; platform: string | null; cache_hit: boolean | null }
    const calls = (callsTodayRes.data ?? []) as CallRow[]
    const callsToday     = calls.length
    const cacheHitsToday = calls.filter(c => c.cache_hit === true).length
    const bucketize = (items: Array<string | null | undefined>, fallback: string) => {
      const m = new Map<string, number>()
      for (const v of items) {
        const k = (v && v.toString().trim()) || fallback
        m.set(k, (m.get(k) ?? 0) + 1)
      }
      return Array.from(m, ([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count).slice(0, 10)
    }
    const bySource     = bucketize(calls.map(c => c.source),      '(unknown)').map(x => ({ source:   x.k, count: x.count }))
    const byCliVersion = bucketize(calls.map(c => c.cli_version), '(unknown)').map(x => ({ version:  x.k, count: x.count }))
    const byPlatform   = bucketize(calls.map(c => c.platform),    '(unknown)').map(x => ({ platform: x.k, count: x.count }))

    // Last-7-days trend · group by date.
    const week = (callsWeekRes.data ?? []) as Array<{ created_at: string }>
    const trendMap = new Map<string, number>()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      trendMap.set(d, 0)
    }
    for (const r of week) {
      const d = r.created_at.slice(0, 10)
      if (trendMap.has(d)) trendMap.set(d, (trendMap.get(d) ?? 0) + 1)
    }
    const callsLast7d = Array.from(trendMap, ([day, count]) => ({ day, count }))

    setCliUsage({
      totalToday,
      uniqueIps: ips.length,
      topRepos,
      globalRemaining: 2000 - globalCount,
      recentCalls,
      callsToday,
      cacheHitsToday,
      bySource,
      byCliVersion,
      byPlatform,
      callsLast7d,
    })
  }

  async function loadRecent() {
    const { data } = await supabase
      .from('analysis_snapshots')
      .select('id, project_id, score_total, score_auto, trigger_type, created_at, rich_analysis, projects(project_name, github_url)')
      .order('created_at', { ascending: false })
      .limit(30)
    const rows = (data ?? []) as Array<any>
    const mapped: RecentAudit[] = rows.map(r => {
      const err = r.rich_analysis?.error
      return {
        id:           r.id,
        project_id:   r.project_id,
        project_name: r.projects?.project_name ?? '(unknown)',
        github_url:   r.projects?.github_url ?? null,
        score_total:  r.score_total ?? 0,
        score_auto:   r.score_auto ?? 0,
        trigger_type: r.trigger_type ?? '?',
        created_at:   r.created_at,
        has_error:    !!err,
        error_msg:    err ? String((err as any).message ?? (err as any).type ?? 'error') : null,
      }
    })
    setRecent(mapped)
  }

  async function handleForceRefresh(githubUrl: string, opts?: { perRow?: boolean }) {
    const perRow = opts?.perRow === true
    if (!token) {
      const msg = '관리자 토큰이 필요합니다 · 도구 탭에서 입력'
      if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: 'err', msg }))
      else        setRefreshOut(msg)
      return
    }

    if (perRow) {
      setRowBusy(prev => { const n = new Set(prev); n.add(githubUrl); return n })
      setRowOut(prev => { const n = new Map(prev); n.set(githubUrl, { kind: 'ok', msg: '트리거 중…' }); return n })
    } else {
      setRefreshing(true)
      setRefreshOut(null)
    }

    // Capture baseline · the latest snapshot's created_at for THIS project
    // (matched via github_url ilike) so we can detect when a new snapshot
    // lands. If no project exists yet (first audit), baseline stays null.
    let baselineSnapAt: string | null = null
    let baselineProjectId: string | null = null
    {
      const { data: pj } = await supabase
        .from('projects')
        .select('id')
        .ilike('github_url', `${githubUrl}%`)
        .limit(1)
        .maybeSingle()
      baselineProjectId = (pj as { id?: string } | null)?.id ?? null
      if (baselineProjectId) {
        const { data: snap } = await supabase
          .from('analysis_snapshots')
          .select('created_at')
          .eq('project_id', baselineProjectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        baselineSnapAt = (snap as { created_at?: string } | null)?.created_at ?? null
      }
    }

    try {
      const res = await fetch(`${(supabase as any).supabaseUrl}/functions/v1/audit-preview`, {
        method: 'POST',
        headers: {
          'apikey':         (supabase as any).supabaseKey,
          'Authorization':  `Bearer ${(supabase as any).supabaseKey}`,
          'x-admin-token':  token,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ github_url: githubUrl, force: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = `❌ 실패: ${body.error ?? res.status} · ${body.message ?? ''}`
        if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: 'err', msg }))
        else        setRefreshOut(msg)
        return
      }

      const triggered = `✅ 트리거됨 · pid ${body.project_id?.slice(0, 8) ?? '?'} · 결과 폴링 중…`
      if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: 'ok', msg: triggered }))
      else        setRefreshOut(triggered)

      const projectId = (body.project_id as string | undefined) ?? baselineProjectId
      if (projectId) {
        // Poll up to 150s for a new snapshot strictly newer than baseline.
        // analyze-project takes 60-120s typically.
        const startedAt = Date.now()
        const deadline  = startedAt + 150_000
        let resolved   = false
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 5000))
          const { data: snap } = await supabase
            .from('analysis_snapshots')
            .select('id, created_at, score_total, rich_analysis')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const fresh = snap as { id?: string; created_at?: string; score_total?: number; rich_analysis?: { error?: unknown } } | null
          if (fresh?.created_at && fresh.created_at !== baselineSnapAt) {
            const elapsed = Math.round((Date.now() - startedAt) / 1000)
            const err     = fresh.rich_analysis?.error
            const score   = fresh.score_total ?? 0
            const done    = err
              ? `⚠ 새 snapshot 받았으나 분석 에러 · ${elapsed}s`
              : `✅ 완료 · score ${score}/100 · ${elapsed}s`
            if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: err ? 'err' : 'done', msg: done }))
            else        setRefreshOut(done)
            resolved = true
            // Invalidate ladder cache so next /ladder visit shows the new score
            invalidateLadderCache()
            await loadRecent()
            await loadCliUsage()
            break
          }
        }
        if (!resolved) {
          const msg = '⏰ 폴링 타임아웃 · 백그라운드에서 진행 중일 수 있음 · 새로고침 권장'
          if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: 'err', msg }))
          else        setRefreshOut(msg)
        }
      }
    } catch (e: any) {
      const msg = `❌ 오류: ${String(e?.message ?? e)}`
      if (perRow) setRowOut(prev => new Map(prev).set(githubUrl, { kind: 'err', msg }))
      else        setRefreshOut(msg)
    } finally {
      if (perRow) {
        setRowBusy(prev => { const n = new Set(prev); n.delete(githubUrl); return n })
      } else {
        setRefreshing(false)
      }
    }
  }

  // 일괄 재감사 — 활성 프로젝트 전부 (또는 last_analysis_at 이 N일 이상 된 것만)
  // audit-preview 를 fire-and-forget 으로 트리거. 결과 폴링은 안 함 (각 audit
  // 60-120s · 직렬 폴링하면 4개만 해도 8분). 신규 snapshot 은 Audits 탭에서 확인.
  // 새 detector / migration 배포 직후 한 번 돌리는 게 1차 사용 사례.
  async function handleBulkReaudit() {
    if (!token) { setBulkLog([{ name: '-', status: 'err', msg: '관리자 토큰이 필요합니다' }]); return }
    setBulkBusy(true)
    setBulkLog([])
    try {
      const cutoff = bulkAgeDays > 0
        ? new Date(Date.now() - bulkAgeDays * 86400_000).toISOString()
        : null
      let q = supabase
        .from('projects')
        .select('id, project_name, github_url, last_analysis_at')
        .eq('status', 'active')
        .not('github_url', 'is', null)
        .order('last_analysis_at', { ascending: true, nullsFirst: true })
      if (cutoff) q = q.or(`last_analysis_at.lt.${cutoff},last_analysis_at.is.null`)
      const { data, error } = await q
      if (error) { setBulkLog([{ name: '-', status: 'err', msg: error.message }]); return }
      const rows = (data ?? []) as Array<{ id: string; project_name: string; github_url: string }>
      if (rows.length === 0) { setBulkLog([{ name: '-', status: 'ok', msg: '대상 0개' }]); return }
      for (const p of rows) {
        setBulkLog(prev => [...prev, { name: p.project_name, status: 'fire', msg: '트리거 중…' }])
        try {
          const res = await fetch(`${(supabase as unknown as { supabaseUrl: string }).supabaseUrl}/functions/v1/audit-preview`, {
            method: 'POST',
            headers: {
              'apikey':         (supabase as unknown as { supabaseKey: string }).supabaseKey,
              'Authorization':  `Bearer ${(supabase as unknown as { supabaseKey: string }).supabaseKey}`,
              'x-admin-token':  token,
              'Content-Type':   'application/json',
            },
            body: JSON.stringify({ github_url: p.github_url, force: true }),
          })
          const body = await res.json().catch(() => ({}))
          const ok = res.ok && body.project_id
          setBulkLog(prev => {
            const copy = prev.slice()
            const idx = copy.findIndex(x => x.name === p.project_name && x.status === 'fire')
            if (idx >= 0) copy[idx] = {
              name: p.project_name,
              status: ok ? 'ok' : 'err',
              msg: ok ? `✅ pid ${String(body.project_id).slice(0, 8)} · 결과는 Audits 탭에서` : `❌ ${body.error ?? res.status}`,
            }
            return copy
          })
        } catch (e) {
          setBulkLog(prev => {
            const copy = prev.slice()
            const idx = copy.findIndex(x => x.name === p.project_name && x.status === 'fire')
            if (idx >= 0) copy[idx] = { name: p.project_name, status: 'err', msg: `❌ ${(e as Error).message}` }
            return copy
          })
        }
        // 2s 간격 — Anthropic / Edge concurrency 부담 줄이기
        await new Promise(r => setTimeout(r, 2000))
      }
      invalidateLadderCache()
      await loadRecent()
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleToggleAdmin(target: UserRow) {
    if (!token) { setGrantOut('관리자 토큰이 필요합니다 · 도구 탭에서 입력'); return }
    if (target.id === user?.id) {
      setGrantOut('❌ 자기 자신의 권한은 토글할 수 없습니다 (lock-out 방지)')
      return
    }
    const next = !target.is_admin
    const verb = next ? '부여' : '회수'
    const name = target.display_name ?? target.id.slice(0, 8)
    if (!window.confirm(`${name} 에게 관리자 권한을 ${verb}하시겠습니까?`)) return

    setGrantBusyId(target.id)
    setGrantOut(null)
    try {
      // UUID is parameter-safe (validated by DB) — direct interpolation OK.
      const sql = `update members set is_admin = ${next} where id = '${target.id}' returning id, display_name, is_admin;`
      const res = await fetch(`${(supabase as any).supabaseUrl}/functions/v1/admin-run`, {
        method: 'POST',
        headers: {
          'apikey':         (supabase as any).supabaseKey,
          'Authorization':  `Bearer ${(supabase as any).supabaseKey}`,
          'x-admin-token':  token,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ sql }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setGrantOut(`✅ ${name} 권한 ${verb} 완료`)
        await Promise.all([loadUserList(), loadUserStats()])
      } else {
        setGrantOut(`❌ 실패: ${body.error ?? res.status} · ${body.message ?? ''}`)
      }
    } catch (e: any) {
      setGrantOut(`❌ 오류: ${String(e?.message ?? e)}`)
    } finally {
      setGrantBusyId(null)
    }
  }

  async function handleCreateSeason() {
    if (!token) { setSeasonOut('관리자 토큰이 필요합니다 · 도구 탭 상단에서 입력'); return }
    if (!seasonName.trim()) { setSeasonOut('이름을 입력하세요'); return }
    if (!seasonStart) { setSeasonOut('시작일을 선택하세요'); return }
    setSeasonBusy(true)
    setSeasonOut(null)
    try {
      const { end_date, applaud_end, graduation_date } = computeSeasonDates(seasonStart)
      // Single-quote escape for SQL literal — name comes from admin input.
      const safeName = seasonName.trim().replace(/'/g, "''")
      // §11-NEW.8 · dual-write: every quarterly season is also an event row
      // with the SAME UUID (the v3 ladder/events code reads from `events`,
      // legacy code still reads `seasons`). Atomic via CTE — events INSERT
      // failure rolls back the seasons INSERT, so the two tables can never
      // diverge for newly created seasons.
      const eventStatus =
        seasonStatus === 'upcoming' || seasonStatus === 'active' || seasonStatus === 'applaud' ? 'live'
        : seasonStatus === 'completed' ? 'closed' : 'draft'
      const sql = `
        with new_season as (
          insert into seasons (name, start_date, end_date, applaud_end, graduation_date, status)
          values ('${safeName}', '${seasonStart}', '${end_date}', '${applaud_end}', '${graduation_date}', '${seasonStatus}')
          returning id, name, start_date, end_date, applaud_end, graduation_date, status
        ),
        new_event as (
          insert into events (
            id, template_type, name, slug, status,
            starts_at, ends_at,
            has_graduation, has_hall_of_fame, graduation_tiers, graduation_threshold,
            applaud_end, graduation_date,
            scoring_method, winner_count
          )
          select
            id, 'quarterly', name, name, '${eventStatus}',
            start_date::timestamptz, applaud_end::timestamptz,
            true, true,
            '["valedictorian","honors","graduate","rookie_circle"]'::jsonb,
            'top_20_percent',
            applaud_end, graduation_date,
            'audit_scout_community', 1
          from new_season
          returning id
        )
        select id, name, start_date, end_date, applaud_end, graduation_date, status from new_season;
      `
      const res = await fetch(`${(supabase as any).supabaseUrl}/functions/v1/admin-run`, {
        method: 'POST',
        headers: {
          'apikey':         (supabase as any).supabaseKey,
          'Authorization':  `Bearer ${(supabase as any).supabaseKey}`,
          'x-admin-token':  token,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ sql }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setSeasonOut(`✅ 생성됨 · ${safeName} (${seasonStart} → ${graduation_date})`)
        setSeasonName('')
        setSeasonStart('')
        await loadSeasons()
      } else {
        setSeasonOut(`❌ 실패: ${body.error ?? res.status} · ${body.message ?? ''}`)
      }
    } catch (e: any) {
      setSeasonOut(`❌ 오류: ${String(e?.message ?? e)}`)
    } finally {
      setSeasonBusy(false)
    }
  }

  async function handleAdvanceSeasonStatus() {
    setSeasonOut(null)
    setSeasonBusy(true)
    try {
      const { error } = await supabase.rpc('advance_event_status', { p_event_id: null })
      if (error) {
        setSeasonOut(`❌ RPC 실패: ${error.message}`)
      } else {
        setSeasonOut('✅ advance_event_status 실행 완료')
        await loadSeasons()
      }
    } finally {
      setSeasonBusy(false)
    }
  }

  function saveToken() {
    if (!tokenInput) return
    localStorage.setItem(ADMIN_TOKEN_KEY, tokenInput)
    setToken(tokenInput)
    setTokenInput('')
  }

  // ── 인증 가드 ────────────────────────────────────────────
  if (loading) {
    return <Centered>로딩 중…</Centered>
  }
  if (!user) {
    return (
      <Centered>
        <div className="font-display text-xl mb-2" style={{ color: '#fff' }}>로그인 필요</div>
        <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.88)' }}>관리자 콘솔은 로그인된 관리자 전용입니다.</p>
        <button onClick={() => navigate('/')} className="font-mono text-xs px-4 py-2"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px' }}>
          홈으로
        </button>
      </Centered>
    )
  }
  if (!isAdmin) {
    return (
      <Centered>
        <div className="font-display text-xl mb-2" style={{ color: '#fff' }}>권한 없음</div>
        <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.88)' }}>이 계정은 관리자 권한이 없습니다.</p>
        <button onClick={() => navigate('/')} className="font-mono text-xs px-4 py-2"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px' }}>
          홈으로
        </button>
      </Centered>
    )
  }

  return (
    <section className="admin-shell relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // 관리자 콘솔
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl" style={{ color: '#fff' }}>
            commit.show 운영 대시보드
          </h1>
          <p className="font-light text-sm mt-1" style={{ color: 'rgba(255,255,255,0.88)' }}>
            로그인 계정: {user.email} · is_admin: <span style={{ color: 'var(--gold-500)' }}>true</span>
          </p>
        </header>

        {/* 탭 */}
        <div className="flex gap-1 mb-6 overflow-x-auto" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {([
            ['overview', '대시보드'],
            ['users',    '사용자'],
            ['audits',   'Audit'],
            ['cli',      'CLI 사용'],
            ['policy',   '정책'],
            ['emails',   '이메일'],
            ['tools',    '도구'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="font-mono text-xs tracking-widest uppercase px-4 py-2 whitespace-nowrap"
              style={{
                background:    tab === k ? 'rgba(240,192,64,0.14)' : 'transparent',
                color:         tab === k ? 'var(--gold-500)'        : 'rgba(255,255,255,0.88)',
                borderBottom:  tab === k ? '2px solid var(--gold-500)' : '2px solid transparent',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {loadErr && (
          <div className="mb-4 p-3 font-mono text-xs" style={{ background: 'rgba(200,16,46,0.1)', border: '1px solid rgba(200,16,46,0.3)', color: 'var(--scarlet)' }}>
            로드 실패: {loadErr}
          </div>
        )}

        {tab === 'overview' && <Overview userStats={userStats} auditStats={auditStats} cliUsage={cliUsage} onNavigate={setTab} />}
        {tab === 'users'    && <UsersTab stats={userStats} list={userList} currentUserId={user.id} onToggleAdmin={handleToggleAdmin} grantBusyId={grantBusyId} grantOut={grantOut} hasToken={!!token} />}
        {tab === 'audits'   && <AuditsTab stats={auditStats} recent={recent} onForceRefresh={(u) => handleForceRefresh(u, { perRow: true })} rowBusy={rowBusy} rowOut={rowOut} hasToken={!!token} />}
        {tab === 'cli'      && <CliTab usage={cliUsage} onForceRefresh={(u) => handleForceRefresh(u, { perRow: true })} rowBusy={rowBusy} rowOut={rowOut} hasToken={!!token} />}
        {tab === 'policy'   && <PolicyTab />}
        {tab === 'emails'   && <EmailTemplatesPanel />}
        {tab === 'tools'    && (
          <ToolsTab
            token={token}
            tokenInput={tokenInput}
            setTokenInput={setTokenInput}
            saveToken={saveToken}
            refreshUrl={refreshUrl}
            setRefreshUrl={setRefreshUrl}
            onForceRefresh={() => handleForceRefresh(refreshUrl)}
            refreshing={refreshing}
            refreshOut={refreshOut}
            seasons={seasons}
            seasonName={seasonName}
            setSeasonName={setSeasonName}
            seasonStart={seasonStart}
            setSeasonStart={setSeasonStart}
            seasonStatus={seasonStatus}
            setSeasonStatus={setSeasonStatus}
            onCreateSeason={handleCreateSeason}
            onAdvanceSeason={handleAdvanceSeasonStatus}
            seasonBusy={seasonBusy}
            seasonOut={seasonOut}
            bulkBusy={bulkBusy}
            bulkAgeDays={bulkAgeDays}
            setBulkAgeDays={setBulkAgeDays}
            bulkLog={bulkLog}
            onBulkReaudit={handleBulkReaudit}
          />
        )}
      </div>
    </section>
  )
}

// ── 탭 컴포넌트들 ─────────────────────────────────────────

function Overview({ userStats, auditStats, cliUsage, onNavigate }: {
  userStats: UserStats | null
  auditStats: AuditStats | null
  cliUsage: CliUsage | null
  onNavigate: (tab: 'users' | 'audits' | 'cli' | 'tools') => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Stat label="총 사용자"        value={userStats?.total ?? '—'}        sub={`최근 7일 신규 ${userStats?.newWeek ?? 0}`}
            onClick={() => onNavigate('users')}  hint="사용자 리스트로 이동" />
      <Stat label="활성 사용자 (7일)" value={userStats?.activeWeek ?? '—'} sub={`관리자 ${userStats?.admins ?? 0}명`}
            onClick={() => onNavigate('users')}  hint="사용자 리스트로 이동" />
      <Stat label="오늘 Audit"       value={auditStats?.todayCount ?? '—'} sub={`주간 ${auditStats?.weekCount ?? 0} · 평균 ${auditStats?.avgScore ?? '—'}점`}
            onClick={() => onNavigate('audits')} hint="Audit 탭으로 이동" />
      <Stat label="실패 (24h)"       value={auditStats?.failed24h ?? '—'}  sub={auditStats?.failed24h ? '에러 envelope 발생' : '문제 없음'} tone={(auditStats?.failed24h ?? 0) > 0 ? 'warn' : 'ok'}
            onClick={() => onNavigate('audits')} hint="Audit 탭으로 이동" />
      <Stat label="CLI 호출 (오늘)"  value={cliUsage?.totalToday ?? '—'}    sub={`고유 IP ${cliUsage?.uniqueIps ?? 0}`}
            onClick={() => onNavigate('cli')}    hint="CLI 사용 탭으로 이동" />
      <Stat label="Walk-on 프로젝트" value={auditStats?.cliPreviewCnt ?? '—'} sub="status=preview · 최근 7일"
            onClick={() => onNavigate('audits')} hint="Audit 탭으로 이동" />
      <Stat label="Global quota 남음" value={cliUsage?.globalRemaining ?? '—'} sub="800/일"
            onClick={() => onNavigate('cli')}    hint="CLI 사용 탭으로 이동" />
    </div>
  )
}

function UsersTab({ stats, list, currentUserId, onToggleAdmin, grantBusyId, grantOut, hasToken }: {
  stats: UserStats | null
  list: UserRow[]
  currentUserId: string
  onToggleAdmin: (target: UserRow) => void
  grantBusyId: string | null
  grantOut: string | null
  hasToken: boolean
}) {
  if (!stats) return <Loading />
  const tiers = Object.entries(stats.byTier).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="총 사용자"      value={stats.total}      sub="" />
        <Stat label="신규 (7일)"     value={stats.newWeek}    sub="" />
        <Stat label="활성 (7일)"     value={stats.activeWeek} sub="" />
      </div>

      {grantOut && (
        <div className="p-3 font-mono text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}>
          {grantOut}
        </div>
      )}

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// SCOUT 티어 분포</div>
        <div className="space-y-2">
          {tiers.map(([tier, count]) => (
            <div key={tier} className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase" style={{ width: '6em', color: 'rgba(255,255,255,0.55)' }}>{tier}</span>
              <div className="flex-1 h-5" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                <div style={{
                  width: `${Math.min(100, (count / stats.total) * 100)}%`,
                  height: '100%',
                  background: 'rgba(240,192,64,0.55)',
                  borderRadius: '2px',
                }} />
              </div>
              <span className="font-mono text-xs tabular-nums" style={{ width: '4em', textAlign: 'right', color: '#fff' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // 사용자 리스트 · 최근 가입 50명
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
          <div className="grid grid-cols-[1fr_minmax(0,1fr)_120px_70px_70px_60px_50px_70px_90px] gap-3 px-3 py-2 font-mono text-[10px] tracking-widest uppercase"
               style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)' }}>
            <span>이름</span>
            <span className="hidden sm:block">ID</span>
            <span>로그인</span>
            <span>티어</span>
            <span>등급</span>
            <span className="text-right">AP</span>
            <span className="text-right">졸업</span>
            <span>가입</span>
            <span className="text-right">권한</span>
          </div>
          {list.length === 0 && (
            <div className="px-3 py-4 font-mono text-xs text-center" style={{ color: 'rgba(255,255,255,0.88)' }}>(아직 사용자 없음)</div>
          )}
          {list.map((u, i) => {
            const isSelf = u.id === currentUserId
            const busy   = grantBusyId === u.id
            const disabled = busy || isSelf || !hasToken
            return (
              <div key={u.id}
                   className="grid grid-cols-[1fr_minmax(0,1fr)_120px_70px_70px_60px_50px_70px_90px] gap-3 px-3 py-2 items-center text-xs"
                   style={{
                     background:    u.is_admin ? 'rgba(240,192,64,0.08)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                     borderTop:     '1px solid rgba(255,255,255,0.04)',
                   }}>
                <span className="font-mono truncate" style={{ color: '#fff' }}>
                  {u.display_name ?? '(미설정)'}
                  {u.is_admin && <span className="ml-2 px-1.5 py-0.5" style={{ background: 'rgba(240,192,64,0.2)', color: 'var(--gold-500)', borderRadius: '2px', fontSize: '10px' }}>ADMIN</span>}
                  {isSelf && <span className="ml-2 px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', borderRadius: '2px', fontSize: '10px' }}>본인</span>}
                </span>
                <span className="hidden sm:block font-mono text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>{u.id.slice(0, 8)}</span>
                <span className="flex flex-wrap gap-1">
                  {(u.providers ?? []).length === 0 && (
                    <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>
                  )}
                  {(u.providers ?? []).map(p => <ProviderBadge key={p} provider={p} />)}
                </span>
                <span className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.88)' }}>{u.tier ?? '—'}</span>
                <span className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.88)' }}>{u.creator_grade ?? '—'}</span>
                <span className="font-mono text-[11px] tabular-nums text-right" style={{ color: '#fff' }}>{u.activity_points ?? 0}</span>
                <span className="font-mono text-[11px] tabular-nums text-right" style={{ color: '#fff' }}>{u.total_graduated ?? 0}</span>
                <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {new Date(u.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                </span>
                <button
                  onClick={() => onToggleAdmin(u)}
                  disabled={disabled}
                  className="font-mono text-[10px] tracking-wide px-2 py-1"
                  title={
                    isSelf       ? '자기 자신은 토글 불가 (lock-out 방지)'
                    : !hasToken  ? '도구 탭에서 관리자 토큰을 먼저 저장하세요'
                    : u.is_admin ? '관리자 권한 회수'
                                 : '관리자 권한 부여'
                  }
                  style={{
                    background:  u.is_admin ? 'transparent'                : 'var(--gold-500)',
                    color:       u.is_admin ? 'var(--scarlet)'             : 'var(--navy-900)',
                    border:      u.is_admin ? '1px solid rgba(200,16,46,0.4)' : 'none',
                    borderRadius: '2px',
                    cursor:      disabled ? 'not-allowed' : 'pointer',
                    opacity:     disabled ? 0.4 : 1,
                    whiteSpace:  'nowrap',
                  }}
                >
                  {busy ? '…' : u.is_admin ? '회수' : '부여'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AuditsTab({ stats, recent, onForceRefresh, rowBusy, rowOut, hasToken }: {
  stats: AuditStats | null
  recent: RecentAudit[]
  onForceRefresh: (url: string) => void
  rowBusy: Set<string>
  rowOut: Map<string, { kind: 'ok' | 'err' | 'done'; msg: string }>
  hasToken: boolean
}) {
  if (!stats) return <Loading />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Stat label="오늘"          value={stats.todayCount} sub="" />
        <Stat label="주간"          value={stats.weekCount}  sub="" />
        <Stat label="평균 점수"     value={stats.avgScore ?? '—'} sub="주간" />
        <Stat label="실패 (24h)"    value={stats.failed24h}  sub="" tone={stats.failed24h > 0 ? 'warn' : 'ok'} />
      </div>

      {!hasToken && (
        <div className="p-3 font-mono text-xs" style={{ background: 'rgba(248,120,113,0.08)', border: '1px solid rgba(248,120,113,0.25)', color: '#F88771', borderRadius: '2px' }}>
          ⚠ 관리자 토큰 미저장 — 재감사 버튼은 도구 탭에서 ADMIN_TOKEN 입력 후 사용 가능
        </div>
      )}

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 최근 30 audit</div>
        <div className="space-y-1">
          {recent.length === 0 && <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>(빈 결과)</div>}
          {recent.map(r => {
            const busy = !!r.github_url && rowBusy.has(r.github_url)
            const out  = r.github_url ? rowOut.get(r.github_url) : undefined
            return (
              <div key={r.id} style={{
                background: r.has_error ? 'rgba(200,16,46,0.06)' : 'rgba(255,255,255,0.02)',
                border:     r.has_error ? '1px solid rgba(200,16,46,0.25)' : '1px solid rgba(255,255,255,0.04)',
                borderRadius: '2px',
              }}>
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono truncate" style={{ color: '#fff' }}>
                      {r.project_name}
                      {r.has_error && <span className="ml-2" style={{ color: 'var(--scarlet)' }}>· 에러: {r.error_msg}</span>}
                    </div>
                    <div className="font-mono text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>{r.github_url ?? ''}</div>
                  </div>
                  <span className="font-mono tabular-nums" style={{ color: r.has_error ? 'var(--scarlet)' : '#fff' }}>{r.score_total}</span>
                  <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{r.trigger_type}</span>
                  <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{new Date(r.created_at).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })}</span>
                  <button
                    disabled={busy || !r.github_url || !hasToken}
                    onClick={() => r.github_url && onForceRefresh(r.github_url)}
                    className="font-mono text-[10px] tracking-wide px-2 py-1 inline-flex items-center gap-1.5"
                    style={{
                      background: 'var(--gold-500)', color: 'var(--navy-900)',
                      border: 'none', borderRadius: '2px',
                      cursor: busy || !r.github_url || !hasToken ? 'not-allowed' : 'pointer',
                      opacity: busy || !r.github_url || !hasToken ? 0.4 : 1,
                    }}
                  >
                    {busy && <span className="inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
                    {busy ? '진행중' : '재감사'}
                  </button>
                </div>
                {out && (
                  <div className="px-3 pb-2 font-mono text-[11px]" style={{
                    color: out.kind === 'err' ? '#F88771' : out.kind === 'done' ? '#00D4AA' : 'var(--gold-500)',
                  }}>
                    {out.msg}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CliTab({ usage, onForceRefresh, rowBusy, rowOut, hasToken }: {
  usage: CliUsage | null
  onForceRefresh: (url: string) => void
  rowBusy: Set<string>
  rowOut: Map<string, { kind: 'ok' | 'err' | 'done'; msg: string }>
  hasToken: boolean
}) {
  if (!usage) return <Loading />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="오늘 IP 호출"      value={usage.totalToday}        sub="rate-limit 합산" />
        <Stat label="고유 IP"           value={usage.uniqueIps}          sub="오늘" />
        <Stat label="오늘 CLI 호출"     value={usage.callsToday}         sub={`캐시 ${usage.cacheHitsToday} · 엔진 ${usage.callsToday - usage.cacheHitsToday}`} />
        <Stat label="Global 남은 quota" value={usage.globalRemaining ?? '—'} sub="일 2000 한도" />
        <Stat label="7일 누적"          value={usage.callsLast7d.reduce((s, d) => s + d.count, 0)} sub="cli_audit_calls" />
      </div>

      {/* 7-day trend bars · simple inline visualization */}
      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 7일 호출 추이</div>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {usage.callsLast7d.map(d => {
            const max = Math.max(1, ...usage.callsLast7d.map(x => x.count))
            const h   = Math.max(2, Math.round((d.count / max) * 70))
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div title={`${d.day} · ${d.count}`} style={{ width: '100%', height: h, background: d.count > 0 ? 'var(--gold-500)' : 'rgba(255,255,255,0.08)', borderRadius: 2 }} />
                <div className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{d.day.slice(5)}</div>
                <div className="font-mono text-[10px] tabular-nums" style={{ color: d.count > 0 ? 'var(--gold-500)' : 'rgba(255,255,255,0.4)' }}>{d.count}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Source / version / platform breakdown · 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownList title="// 호출 출처 (--source)"   rows={usage.bySource.map(x => ({ k: x.source,   count: x.count }))} hint="--source flag · 환경변수 COMMITSHOW_SOURCE · 에이전트가 self-report" />
        <BreakdownList title="// CLI 버전"               rows={usage.byCliVersion.map(x => ({ k: x.version,  count: x.count }))} hint="User-Agent 헤더 · npm publish 마다 갱신 권장" />
        <BreakdownList title="// 플랫폼"                 rows={usage.byPlatform.map(x => ({ k: x.platform, count: x.count }))} hint="Node 런타임 환경 · darwin / linux / win32" />
      </div>
      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 가장 자주 audit 된 repo (오늘)</div>
        <div className="space-y-1">
          {usage.topRepos.length === 0 && <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>(아직 없음)</div>}
          {usage.topRepos.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 text-xs" style={{
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '2px',
            }}>
              <span className="font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.55)', width: '3em' }}>#{i + 1}</span>
              <span className="font-mono truncate flex-1" style={{ color: '#fff' }}>url 해시: {r.url}</span>
              <span className="font-mono tabular-nums" style={{ color: 'var(--gold-500)' }}>{r.count}회</span>
            </div>
          ))}
        </div>
        <div className="font-mono text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
          ※ url 은 djb2 해시로 익명화 저장 (원본 URL 비노출)
        </div>
      </div>

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 최근 CLI 호출 10개 (walk-on)</div>
        {!hasToken && (
          <div className="mb-2 p-2 font-mono text-[11px]" style={{ background: 'rgba(248,120,113,0.08)', border: '1px solid rgba(248,120,113,0.2)', color: '#F88771', borderRadius: '2px' }}>
            ⚠ 재감사는 ADMIN_TOKEN 필요 · 도구 탭에서 입력
          </div>
        )}
        <div className="space-y-1">
          {usage.recentCalls.length === 0 && <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>(아직 없음)</div>}
          {usage.recentCalls.map(r => {
            const busy = !!r.github_url && rowBusy.has(r.github_url)
            const out  = r.github_url ? rowOut.get(r.github_url) : undefined
            return (
              <div key={r.id} style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: '2px',
              }}>
                <div className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="font-mono tabular-nums whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {fmtRelative(r.created_at)}
                  </span>
                  <span className="font-mono truncate flex-1 min-w-0" style={{ color: '#fff' }} title={r.github_url ?? r.project_name}>
                    {r.project_name}
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {r.trigger_type}
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap" style={{ color: 'var(--gold-500)' }}>
                    {r.score_total}/100
                  </span>
                  <button
                    disabled={busy || !r.github_url || !hasToken}
                    onClick={() => r.github_url && onForceRefresh(r.github_url)}
                    className="font-mono text-[10px] tracking-wide px-2 py-1 inline-flex items-center gap-1.5 whitespace-nowrap"
                    style={{
                      background: 'var(--gold-500)', color: 'var(--navy-900)',
                      border: 'none', borderRadius: '2px',
                      cursor: busy || !r.github_url || !hasToken ? 'not-allowed' : 'pointer',
                      opacity: busy || !r.github_url || !hasToken ? 0.4 : 1,
                    }}
                  >
                    {busy && <span className="inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
                    {busy ? '진행중' : '재감사'}
                  </button>
                </div>
                {out && (
                  <div className="px-3 pb-2 font-mono text-[11px]" style={{
                    color: out.kind === 'err' ? '#F88771' : out.kind === 'done' ? '#00D4AA' : 'var(--gold-500)',
                  }}>
                    {out.msg}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

// ── PolicyTab ──────────────────────────────────────────────────────────────
// 가격·무료할당량 등 admin 이 코드 deploy 없이 켜고 끌 수 있는 런타임 정책 토글.
// app_settings 테이블에서 read · set_app_setting RPC (admin 가드) 로 write.
// 변경 즉시 모든 클라이언트의 다음 eligibility check 부터 반영 (per-page-load
// cache TTL 60s · 최악 60초 후엔 모두에게 반영).
function PolicyTab() {
  const [loaded, setLoaded] = useState(false)
  const [busy,   setBusy]   = useState(false)
  const [free,   setFree]   = useState<number>(3)
  const [feeCents, setFeeCents] = useState<number>(9900) // read-only display for now
  const [meta,   setMeta]   = useState<{ updated_at: string | null; updated_by: string | null }>({ updated_at: null, updated_by: null })
  const [out,    setOut]    = useState<string | null>(null)

  const load = async () => {
    setOut(null)
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value, updated_at, updated_by')
      .in('key', ['free_audits_per_member'])
    if (error) { setOut(`로드 실패: ${error.message}`); setLoaded(true); return }
    const row = (data ?? []).find(r => r.key === 'free_audits_per_member')
    const parsed = typeof row?.value === 'number' ? row.value
                 : typeof row?.value === 'string' ? Number(row.value)
                 : NaN
    if (Number.isFinite(parsed) && parsed >= 0) setFree(Math.floor(parsed))
    setMeta({ updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null })
    setLoaded(true)
  }
  useEffect(() => { void load() }, [])

  const save = async () => {
    if (!Number.isFinite(free) || free < 0 || free > 100) {
      setOut('0 ~ 100 사이의 정수만 입력하세요'); return
    }
    if (!confirm(`free_audits_per_member 를 ${free} 로 설정할까요?\n\n· 0 = 모든 신규 audit 이 $99 paid (default policy)\n· 3 = 런칭 프로모 (member 당 첫 3건 무료)\n\n이미 audit 한 사용자에는 영향 없음 · 새로운 4번째 시도부터 적용`)) return
    setBusy(true)
    setOut(null)
    const { data, error } = await supabase.rpc('set_app_setting', {
      p_key:   'free_audits_per_member',
      p_value: free,
    })
    setBusy(false)
    if (error) { setOut(`실패: ${error.message}`); return }
    setOut(`저장됨 → free_audits_per_member = ${free}`)
    if (Array.isArray(data) && data[0]) {
      setMeta({ updated_at: data[0].updated_at, updated_by: data[0].updated_by })
    } else if (data && typeof data === 'object') {
      const r = data as { updated_at?: string; updated_by?: string }
      setMeta({ updated_at: r.updated_at ?? null, updated_by: r.updated_by ?? null })
    }
  }

  return (
    <div className="space-y-6">
      {/* Free quota card */}
      <section className="p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}>
        <h3 className="font-display text-lg mb-1" style={{ color: 'var(--cream)' }}>회원당 무료 audit 횟수</h3>
        <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
          기본 정책은 유료 (audit 1건당 $99). 이 값이 N &gt; 0 이면 회원당 첫 N 건이 무료, N+1 번째부터 결제 게이트가 뜸.
          <br />0 으로 두면 가입과 동시에 모든 audit 이 paid.
        </p>
        <div className="flex items-end gap-3 mb-3">
          <div>
            <label className="block font-mono text-[11px] tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>FREE_AUDITS_PER_MEMBER</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={loaded ? free : ''}
              onChange={e => setFree(Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10))))}
              disabled={!loaded || busy}
              className="font-mono text-2xl px-3 py-2 w-32 text-center"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(240,192,64,0.4)', color: 'var(--gold-500)', borderRadius: '2px' }}
            />
          </div>
          <div className="flex gap-2 mb-2">
            {[0, 1, 3, 5, 10].map(n => (
              <button
                key={n}
                onClick={() => setFree(n)}
                disabled={!loaded || busy}
                className="px-2 py-1 font-mono text-[11px]"
                style={{ background: free === n ? 'rgba(240,192,64,0.18)' : 'rgba(255,255,255,0.04)', color: free === n ? 'var(--gold-500)' : 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px', cursor: 'pointer' }}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={save}
            disabled={!loaded || busy}
            className="ml-auto px-4 py-2 font-mono text-xs tracking-widest"
            style={{ background: busy ? 'rgba(240,192,64,0.4)' : 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
        <div className="font-mono text-[11px] space-y-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {meta.updated_at && <div>last updated: {new Date(meta.updated_at).toLocaleString('ko-KR')} · by {meta.updated_by ? meta.updated_by.slice(0,8) : '—'}</div>}
          {out && <div style={{ color: out.startsWith('실패') || out.startsWith('로드 실패') || out.startsWith('0 ~ 100') ? 'var(--scarlet)' : 'var(--gold-500)' }}>{out}</div>}
          <div>변경 즉시 모든 client 의 다음 eligibility check 부터 반영 (페이지당 60초 cache).</div>
        </div>
      </section>

      {/* Pricing card · read-only display */}
      <section className="p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}>
        <h3 className="font-display text-lg mb-1" style={{ color: 'var(--cream)' }}>Audit 가격</h3>
        <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
          audit_fee_cents — Stripe Checkout 의 단가. 현재는 Edge Function (create-checkout-session) 의 코드 상수에서 읽어옴 ·
          향후 admin 토글이 필요해지면 같은 app_settings 테이블에 키 추가.
        </p>
        <div className="font-mono text-2xl" style={{ color: 'rgba(255,255,255,0.7)' }}>${(feeCents / 100).toFixed(0)}</div>
      </section>
    </div>
  )
}

function ToolsTab({
  token, tokenInput, setTokenInput, saveToken,
  refreshUrl, setRefreshUrl, onForceRefresh, refreshing, refreshOut,
  seasons, seasonName, setSeasonName, seasonStart, setSeasonStart,
  seasonStatus, setSeasonStatus, onCreateSeason, onAdvanceSeason,
  seasonBusy, seasonOut,
  bulkBusy, bulkAgeDays, setBulkAgeDays, bulkLog, onBulkReaudit,
}: {
  token: string; tokenInput: string; setTokenInput: (s: string) => void; saveToken: () => void
  refreshUrl: string; setRefreshUrl: (s: string) => void
  onForceRefresh: () => void; refreshing: boolean; refreshOut: string | null
  seasons: SeasonRow[]
  seasonName: string; setSeasonName: (s: string) => void
  seasonStart: string; setSeasonStart: (s: string) => void
  seasonStatus: 'upcoming' | 'active'; setSeasonStatus: (s: 'upcoming' | 'active') => void
  onCreateSeason: () => void; onAdvanceSeason: () => void
  seasonBusy: boolean; seasonOut: string | null
  bulkBusy: boolean
  bulkAgeDays: number; setBulkAgeDays: (n: number) => void
  bulkLog: Array<{ name: string; status: 'fire' | 'ok' | 'err'; msg: string }>
  onBulkReaudit: () => void
}) {
  const computed = seasonStart ? computeSeasonDates(seasonStart) : null
  return (
    <div className="space-y-8">
      <section>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 관리자 토큰</div>
        <p className="font-light text-sm mb-3" style={{ color: 'rgba(255,255,255,0.88)' }}>
          ADMIN_TOKEN (Supabase secret 으로 설정된 값) — 강제 재감사·rate limit 우회용. 토큰은 localStorage 에 저장되며 이 브라우저에만 유지됩니다.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            placeholder={token ? '저장됨 (재입력해서 교체)' : '토큰 붙여넣기'}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            className="flex-1 px-3 py-2 font-mono text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px' }}
          />
          <button onClick={saveToken} className="font-mono text-xs px-4 py-2"
                  style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
            저장
          </button>
        </div>
        <div className="font-mono text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
          현재 상태: {token ? '✅ 저장됨' : '⚠ 미저장 — 강제 재감사 사용 불가'}
        </div>
      </section>

      <section>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 강제 재감사</div>
        <p className="font-light text-sm mb-3" style={{ color: 'rgba(255,255,255,0.88)' }}>
          rate limit 을 우회하고 새 audit 을 트리거. URL cap / IP cap / global cap 모두 무시됩니다.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="github.com/owner/repo"
            value={refreshUrl}
            onChange={e => setRefreshUrl(e.target.value)}
            className="flex-1 px-3 py-2 font-mono text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px' }}
          />
          <button
            onClick={onForceRefresh}
            disabled={refreshing || !refreshUrl || !token}
            className="font-mono text-xs px-4 py-2"
            style={{
              background: 'var(--gold-500)', color: 'var(--navy-900)',
              border: 'none', borderRadius: '2px',
              cursor: refreshing || !refreshUrl || !token ? 'not-allowed' : 'pointer',
              opacity: refreshing || !refreshUrl || !token ? 0.4 : 1,
            }}
          >
            {refreshing ? '진행중…' : '트리거'}
          </button>
        </div>
        {refreshOut && (
          <div className="mt-3 p-3 font-mono text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}>
            {refreshOut}
          </div>
        )}
      </section>

      <section>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 일괄 재감사</div>
        <p className="font-light text-sm mb-3" style={{ color: 'rgba(255,255,255,0.88)' }}>
          활성(active) 프로젝트 전부에 새 audit 을 트리거. 새 detector / migration 배포 직후 한 번 돌리는 용도.
          폴링 안 함 · 결과는 Audits 탭에서 확인 (각 audit ~60-120s · 4-20개면 수 분 소요).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
            마지막 감사 ≥
          </label>
          <input
            type="number"
            min={0}
            value={bulkAgeDays}
            onChange={e => setBulkAgeDays(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className="px-2 py-1.5 font-mono text-xs w-16"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px' }}
          />
          <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
            일 전 (0 = 전부)
          </span>
          <button
            onClick={onBulkReaudit}
            disabled={bulkBusy || !token}
            className="font-mono text-xs px-4 py-2 ml-auto"
            style={{
              background: 'var(--gold-500)', color: 'var(--navy-900)',
              border: 'none', borderRadius: '2px',
              cursor: bulkBusy || !token ? 'not-allowed' : 'pointer',
              opacity: bulkBusy || !token ? 0.4 : 1,
            }}
          >
            {bulkBusy ? '진행중…' : '일괄 트리거'}
          </button>
        </div>
        {bulkLog.length > 0 && (
          <div className="mt-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {bulkLog.map((row, i) => (
              <div key={i} className="px-3 py-1.5 font-mono text-[11px] flex items-center gap-3"
                   style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ width: '14em', color: 'rgba(255,255,255,0.88)' }}>{row.name}</span>
                <span style={{
                  color: row.status === 'ok'   ? 'var(--gold-500)'
                       : row.status === 'err'  ? 'var(--scarlet)'
                                               : 'rgba(255,255,255,0.55)',
                }}>{row.msg}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--gold-500)' }}>// 시즌 관리</div>
          <button
            onClick={onAdvanceSeason}
            disabled={seasonBusy}
            className="font-mono text-[11px] tracking-wide px-3 py-1.5"
            style={{
              background: 'transparent', color: 'rgba(255,255,255,0.88)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '2px',
              cursor: seasonBusy ? 'not-allowed' : 'pointer',
            }}
            title="advance_event_status() RPC 실행 — draft→live→closed (events table)"
          >
            상태 자동 전환 실행
          </button>
        </div>
        <p className="font-light text-sm mb-3" style={{ color: 'rgba(255,255,255,0.88)' }}>
          새 시즌 row 를 생성합니다. 시작일을 정하면 종료/Applaud/졸업일이 CLAUDE.md §11.2 기준 (Day 21 / 28 / 29) 으로 자동 계산됩니다.
          상태는 보통 <code style={{ color: 'var(--gold-500)' }}>upcoming</code> 으로 두고 시작일 도래 후 "상태 자동 전환" 으로 active 로 진행합니다.
        </p>

        {/* 기존 시즌 리스트 */}
        <div className="mb-4" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
          <div className="grid grid-cols-[1fr_90px_90px_90px_90px_90px] gap-2 px-3 py-2 font-mono text-[10px] tracking-widest uppercase"
               style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)' }}>
            <span>이름</span>
            <span>시작</span>
            <span>종료(D21)</span>
            <span>Applaud(D28)</span>
            <span>졸업(D29)</span>
            <span>상태</span>
          </div>
          {seasons.length === 0 && (
            <div className="px-3 py-4 font-mono text-xs text-center" style={{ color: 'rgba(255,255,255,0.88)' }}>(시즌 없음)</div>
          )}
          {seasons.map((s, i) => (
            <div key={s.id}
                 className="grid grid-cols-[1fr_90px_90px_90px_90px_90px] gap-2 px-3 py-2 items-center text-xs"
                 style={{
                   background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                   borderTop:  '1px solid rgba(255,255,255,0.04)',
                 }}>
              <span className="font-mono truncate" style={{ color: '#fff' }}>{s.name}</span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>{s.start_date}</span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>{s.end_date}</span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>{s.applaud_end}</span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.88)' }}>{s.graduation_date}</span>
              <span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: STATUS_COLORS[s.status] ?? 'rgba(255,255,255,0.55)' }}>{s.status}</span>
            </div>
          ))}
        </div>

        {/* 생성 폼 */}
        <div className="p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-widest uppercase mb-3" style={{ color: 'rgba(255,255,255,0.55)' }}>새 시즌 생성</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_140px] gap-2 mb-3">
            <input
              type="text"
              placeholder="이름 (예: season_one)"
              value={seasonName}
              onChange={e => setSeasonName(e.target.value)}
              className="px-3 py-2 font-mono text-xs"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px' }}
            />
            <input
              type="date"
              value={seasonStart}
              onChange={e => setSeasonStart(e.target.value)}
              className="px-3 py-2 font-mono text-xs"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px', colorScheme: 'dark' }}
            />
            <select
              value={seasonStatus}
              onChange={e => setSeasonStatus(e.target.value as 'upcoming' | 'active')}
              className="px-3 py-2 font-mono text-xs"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '2px' }}
            >
              <option value="upcoming">upcoming</option>
              <option value="active">active (즉시)</option>
            </select>
          </div>

          {computed && (
            <div className="mb-3 px-3 py-2 font-mono text-[11px]" style={{ background: 'rgba(240,192,64,0.06)', border: '1px solid rgba(240,192,64,0.2)', borderRadius: '2px', color: 'rgba(255,255,255,0.88)' }}>
              자동 계산: 종료 <span style={{ color: '#fff' }}>{computed.end_date}</span> ·
              Applaud 종료 <span style={{ color: '#fff' }}>{computed.applaud_end}</span> ·
              졸업일 <span style={{ color: '#fff' }}>{computed.graduation_date}</span>
            </div>
          )}

          <button
            onClick={onCreateSeason}
            disabled={seasonBusy || !seasonName || !seasonStart || !token}
            className="font-mono text-xs px-4 py-2"
            style={{
              background: 'var(--gold-500)', color: 'var(--navy-900)',
              border: 'none', borderRadius: '2px',
              cursor: seasonBusy || !seasonName || !seasonStart || !token ? 'not-allowed' : 'pointer',
              opacity: seasonBusy || !seasonName || !seasonStart || !token ? 0.4 : 1,
            }}
          >
            {seasonBusy ? '진행중…' : '시즌 생성'}
          </button>
          {!token && (
            <span className="ml-3 font-mono text-[11px]" style={{ color: 'var(--scarlet)' }}>※ 관리자 토큰 미저장</span>
          )}
        </div>

        {seasonOut && (
          <div className="mt-3 p-3 font-mono text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}>
            {seasonOut}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, tone, onClick, hint }: {
  label: string
  value: number | string
  sub: string
  tone?: 'ok' | 'warn'
  onClick?: () => void
  hint?: string
}) {
  const valColor = tone === 'warn' ? 'var(--scarlet)' : tone === 'ok' ? '#00D4AA' : '#fff'
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={hint}
      className="text-left p-4 transition-all"
      style={{
        background:    'rgba(255,255,255,0.03)',
        border:        '1px solid rgba(255,255,255,0.08)',
        borderRadius:  '2px',
        cursor:        interactive ? 'pointer' : 'default',
        color:         'inherit',
      }}
      onMouseEnter={interactive ? e => {
        e.currentTarget.style.borderColor = 'rgba(240,192,64,0.45)'
        e.currentTarget.style.background  = 'rgba(255,255,255,0.05)'
      } : undefined}
      onMouseLeave={interactive ? e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
        e.currentTarget.style.background  = 'rgba(255,255,255,0.03)'
      } : undefined}
    >
      <div className="text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>{label}</div>
      <div className="font-bold text-2xl mt-1" style={{ color: valColor }}>{value}</div>
      {sub && <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>{sub}</div>}
      {interactive && hint && (
        <div className="text-[10px] mt-2" style={{ color: 'rgba(240,192,64,0.7)' }}>{hint} →</div>
      )}
    </button>
  )
}

function Loading() {
  return <div className="font-mono text-xs py-8 text-center" style={{ color: 'rgba(255,255,255,0.55)' }}>로딩 중…</div>
}

// Provider badge · 사용자 표 의 로그인 방식 컬럼.
// Supabase Auth provider keys: 'email' · 'google' · 'github' ·
// 'twitter' (= X) · 'linkedin_oidc'. Branded inline SVG icons so the
// column scans visually without reading labels.
const PROVIDER_LABEL: Record<string, string> = {
  email:         'Email',
  google:        'Google',
  github:        'GitHub',
  twitter:       'X (Twitter)',
  linkedin_oidc: 'LinkedIn',
}

function ProviderIcon({ provider, size = 14 }: { provider: string; size?: number }) {
  const sz = { width: size, height: size, display: 'block' as const }
  switch (provider) {
    case 'google':
      // Multi-color Google G · keeps brand recognition.
      return (
        <svg viewBox="0 0 48 48" style={sz} aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.3 35 26.8 36 24 36c-5.3 0-9.6-3.4-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4 5.7l6.3 5.2c-.4.4 6.7-4.9 6.7-14.9 0-1.3-.1-2.4-.4-3.5z" />
        </svg>
      )
    case 'github':
      return (
        <svg viewBox="0 0 24 24" style={sz} fill="#fff" aria-hidden="true">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.95 10.95 0 0 1 5.74 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.14v3.18c0 .31.2.67.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5z" />
        </svg>
      )
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" style={sz} fill="#fff" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'linkedin_oidc':
      return (
        <svg viewBox="0 0 24 24" style={sz} fill="#0A66C2" aria-hidden="true">
          <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.25 6.5 1.75 1.75 0 0 1 6.5 8.25zM19 19h-3v-4.5c0-1.07-.93-2-2-2s-2 .93-2 2V19h-3v-9h3v1.4a3.5 3.5 0 0 1 6 2.4z" />
        </svg>
      )
    case 'email':
    default:
      return (
        <svg viewBox="0 0 24 24" style={sz} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      )
  }
}

function ProviderBadge({ provider }: { provider: string }) {
  const label = PROVIDER_LABEL[provider] ?? provider
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{
        width: 24, height: 24,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 3,
        color: 'rgba(255,255,255,0.55)',
      }}
      title={`Signed in via ${label}`}
      aria-label={`Provider: ${label}`}
    >
      <ProviderIcon provider={provider} size={14} />
    </span>
  )
}

// Top-N breakdown list · used for source/version/platform splits in /admin > CLI.
function BreakdownList({ title, rows, hint }: {
  title: string
  rows:  Array<{ k: string; count: number }>
  hint?: string
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div>
      <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>{title}</div>
      <div className="space-y-1">
        {rows.length === 0 && <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>(아직 없음)</div>}
        {rows.map(r => (
          <div key={r.k} className="px-3 py-2 text-xs" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 2 }}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono truncate" style={{ color: '#fff' }} title={r.k}>{r.k}</span>
              <span className="font-mono tabular-nums" style={{ color: 'var(--gold-500)' }}>{r.count}</span>
            </div>
            <div style={{ marginTop: 4, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((r.count / max) * 100)}%`, height: '100%', background: 'var(--gold-500)' }} />
            </div>
          </div>
        ))}
      </div>
      {hint && <div className="font-mono text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>{hint}</div>}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <section className="admin-shell relative z-10 pt-32 pb-16 px-4 min-h-screen text-center">
      <div className="max-w-md mx-auto">{children}</div>
    </section>
  )
}
