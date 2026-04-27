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

export function AdminPage() {
  const { user, member, loading } = useAuth()
  const navigate = useNavigate()

  const [token, setToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) ?? '')
  const [tokenInput, setTokenInput] = useState('')
  const [tab, setTab] = useState<'overview' | 'users' | 'audits' | 'cli' | 'tools'>('overview')

  const [userStats, setUserStats]   = useState<UserStats   | null>(null)
  const [auditStats, setAuditStats] = useState<AuditStats  | null>(null)
  const [cliUsage, setCliUsage]     = useState<CliUsage    | null>(null)
  const [recent, setRecent]         = useState<RecentAudit[]>([])
  const [userList, setUserList]     = useState<UserRow[]>([])
  const [loadErr, setLoadErr]       = useState<string | null>(null)

  // 강제 재감사 폼
  const [refreshUrl, setRefreshUrl] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshOut, setRefreshOut] = useState<string | null>(null)

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
      await Promise.all([loadUserStats(), loadAuditStats(), loadCliUsage(), loadRecent(), loadUserList()])
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e))
    }
  }

  async function loadUserList() {
    const { data } = await supabase
      .from('members')
      .select('id, display_name, tier, creator_grade, activity_points, total_graduated, is_admin, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    setUserList((data ?? []) as UserRow[])
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
    const today = new Date().toISOString().slice(0, 10)
    const [allRes, globalRes] = await Promise.all([
      supabase.from('preview_rate_limits').select('ip_hash, count').eq('day', today).limit(500),
      supabase.from('preview_rate_limits').select('count').eq('ip_hash', 'global').eq('day', today).maybeSingle(),
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
    setCliUsage({
      totalToday,
      uniqueIps: ips.length,
      topRepos,
      globalRemaining: 800 - globalCount,
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

  async function handleForceRefresh(githubUrl: string) {
    if (!token) { setRefreshOut('관리자 토큰이 필요합니다 · 도구 탭에서 입력'); return }
    setRefreshing(true)
    setRefreshOut(null)
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
      if (res.ok) {
        setRefreshOut(`✅ 트리거됨 · status: ${body.status} · project_id: ${body.project_id?.slice(0, 8)}`)
        // 60초 후 자동 새로고침
        setTimeout(() => { void loadRecent() }, 60_000)
      } else {
        setRefreshOut(`❌ 실패: ${body.error ?? res.status} · ${body.message ?? ''}`)
      }
    } catch (e: any) {
      setRefreshOut(`❌ 오류: ${String(e?.message ?? e)}`)
    } finally {
      setRefreshing(false)
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
        <div className="font-display text-xl mb-2" style={{ color: 'var(--cream)' }}>로그인 필요</div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-primary)' }}>관리자 콘솔은 로그인된 관리자 전용입니다.</p>
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
        <div className="font-display text-xl mb-2" style={{ color: 'var(--cream)' }}>권한 없음</div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-primary)' }}>이 계정은 관리자 권한이 없습니다.</p>
        <button onClick={() => navigate('/')} className="font-mono text-xs px-4 py-2"
                style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px' }}>
          홈으로
        </button>
      </Centered>
    )
  }

  return (
    <section className="relative z-10 pt-20 pb-16 px-4 md:px-6 lg:px-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="font-mono text-xs tracking-widest mb-2" style={{ color: 'var(--gold-500)' }}>
            // 관리자 콘솔
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl" style={{ color: 'var(--cream)' }}>
            commit.show 운영 대시보드
          </h1>
          <p className="font-light text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
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
            ['tools',    '도구'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="font-mono text-xs tracking-widest uppercase px-4 py-2 whitespace-nowrap"
              style={{
                background:    tab === k ? 'rgba(240,192,64,0.14)' : 'transparent',
                color:         tab === k ? 'var(--gold-500)'        : 'var(--text-primary)',
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

        {tab === 'overview' && <Overview userStats={userStats} auditStats={auditStats} cliUsage={cliUsage} />}
        {tab === 'users'    && <UsersTab stats={userStats} list={userList} />}
        {tab === 'audits'   && <AuditsTab stats={auditStats} recent={recent} onForceRefresh={handleForceRefresh} refreshing={refreshing} refreshOut={refreshOut} />}
        {tab === 'cli'      && <CliTab usage={cliUsage} />}
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
          />
        )}
      </div>
    </section>
  )
}

// ── 탭 컴포넌트들 ─────────────────────────────────────────

function Overview({ userStats, auditStats, cliUsage }: {
  userStats: UserStats | null; auditStats: AuditStats | null; cliUsage: CliUsage | null
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Stat label="총 사용자"        value={userStats?.total ?? '—'}        sub={`최근 7일 신규 ${userStats?.newWeek ?? 0}`} />
      <Stat label="활성 사용자 (7일)" value={userStats?.activeWeek ?? '—'} sub={`관리자 ${userStats?.admins ?? 0}명`} />
      <Stat label="오늘 Audit"       value={auditStats?.todayCount ?? '—'} sub={`주간 ${auditStats?.weekCount ?? 0} · 평균 ${auditStats?.avgScore ?? '—'}점`} />
      <Stat label="실패 (24h)"       value={auditStats?.failed24h ?? '—'}  sub={auditStats?.failed24h ? '에러 envelope 발생' : '문제 없음'} tone={(auditStats?.failed24h ?? 0) > 0 ? 'warn' : 'ok'} />
      <Stat label="CLI 호출 (오늘)"  value={cliUsage?.totalToday ?? '—'}    sub={`고유 IP ${cliUsage?.uniqueIps ?? 0}`} />
      <Stat label="Walk-on 프로젝트" value={auditStats?.cliPreviewCnt ?? '—'} sub="status=preview · 최근 7일" />
      <Stat label="Global quota 남음" value={cliUsage?.globalRemaining ?? '—'} sub="800/일" />
    </div>
  )
}

function UsersTab({ stats, list }: { stats: UserStats | null; list: UserRow[] }) {
  if (!stats) return <Loading />
  const tiers = Object.entries(stats.byTier).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="총 사용자"      value={stats.total}      sub="" />
        <Stat label="신규 (7일)"     value={stats.newWeek}    sub="" />
        <Stat label="활성 (7일)"     value={stats.activeWeek} sub="" />
      </div>

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// SCOUT 티어 분포</div>
        <div className="space-y-2">
          {tiers.map(([tier, count]) => (
            <div key={tier} className="flex items-center gap-3">
              <span className="font-mono text-xs uppercase" style={{ width: '6em', color: 'var(--text-label)' }}>{tier}</span>
              <div className="flex-1 h-5" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                <div style={{
                  width: `${Math.min(100, (count / stats.total) * 100)}%`,
                  height: '100%',
                  background: 'rgba(240,192,64,0.55)',
                  borderRadius: '2px',
                }} />
              </div>
              <span className="font-mono text-xs tabular-nums" style={{ width: '4em', textAlign: 'right', color: 'var(--cream)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>
          // 사용자 리스트 · 최근 가입 50명
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
          <div className="grid grid-cols-[1fr_minmax(0,1fr)_80px_70px_70px_50px_90px] gap-3 px-3 py-2 font-mono text-[10px] tracking-widest uppercase"
               style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-label)' }}>
            <span>이름</span>
            <span className="hidden sm:block">ID</span>
            <span>티어</span>
            <span>등급</span>
            <span className="text-right">AP</span>
            <span className="text-right">졸업</span>
            <span>가입</span>
          </div>
          {list.length === 0 && (
            <div className="px-3 py-4 font-mono text-xs text-center" style={{ color: 'var(--text-primary)' }}>(아직 사용자 없음)</div>
          )}
          {list.map((u, i) => (
            <div key={u.id}
                 className="grid grid-cols-[1fr_minmax(0,1fr)_80px_70px_70px_50px_90px] gap-3 px-3 py-2 items-center text-xs"
                 style={{
                   background:    u.is_admin ? 'rgba(240,192,64,0.08)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                   borderTop:     '1px solid rgba(255,255,255,0.04)',
                 }}>
              <span className="font-mono truncate" style={{ color: 'var(--cream)' }}>
                {u.display_name ?? '(미설정)'}
                {u.is_admin && <span className="ml-2 px-1.5 py-0.5" style={{ background: 'rgba(240,192,64,0.2)', color: 'var(--gold-500)', borderRadius: '2px', fontSize: '10px' }}>ADMIN</span>}
              </span>
              <span className="hidden sm:block font-mono text-[10px] truncate" style={{ color: 'var(--text-label)' }}>{u.id.slice(0, 8)}</span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{u.tier ?? '—'}</span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{u.creator_grade ?? '—'}</span>
              <span className="font-mono text-[11px] tabular-nums text-right" style={{ color: 'var(--cream)' }}>{u.activity_points ?? 0}</span>
              <span className="font-mono text-[11px] tabular-nums text-right" style={{ color: 'var(--cream)' }}>{u.total_graduated ?? 0}</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-label)' }}>
                {new Date(u.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AuditsTab({ stats, recent, onForceRefresh, refreshing, refreshOut }: {
  stats: AuditStats | null
  recent: RecentAudit[]
  onForceRefresh: (url: string) => void
  refreshing: boolean
  refreshOut: string | null
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

      {refreshOut && (
        <div className="p-3 font-mono text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--cream)' }}>
          {refreshOut}
        </div>
      )}

      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 최근 30 audit</div>
        <div className="space-y-1">
          {recent.length === 0 && <div className="font-mono text-xs" style={{ color: 'var(--text-label)' }}>(빈 결과)</div>}
          {recent.map(r => (
            <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-3 py-2 text-xs" style={{
              background: r.has_error ? 'rgba(200,16,46,0.06)' : 'rgba(255,255,255,0.02)',
              border:     r.has_error ? '1px solid rgba(200,16,46,0.25)' : '1px solid rgba(255,255,255,0.04)',
              borderRadius: '2px',
            }}>
              <div className="min-w-0">
                <div className="font-mono truncate" style={{ color: 'var(--cream)' }}>
                  {r.project_name}
                  {r.has_error && <span className="ml-2" style={{ color: 'var(--scarlet)' }}>· 에러: {r.error_msg}</span>}
                </div>
                <div className="font-mono text-[10px] truncate" style={{ color: 'var(--text-label)' }}>{r.github_url ?? ''}</div>
              </div>
              <span className="font-mono tabular-nums" style={{ color: r.has_error ? 'var(--scarlet)' : 'var(--cream)' }}>{r.score_total}</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-label)' }}>{r.trigger_type}</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-label)' }}>{new Date(r.created_at).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })}</span>
              <button
                disabled={refreshing || !r.github_url}
                onClick={() => r.github_url && onForceRefresh(r.github_url)}
                className="font-mono text-[10px] tracking-wide px-2 py-1"
                style={{
                  background: 'var(--gold-500)', color: 'var(--navy-900)',
                  border: 'none', borderRadius: '2px',
                  cursor: refreshing || !r.github_url ? 'not-allowed' : 'pointer',
                  opacity: refreshing || !r.github_url ? 0.4 : 1,
                }}
              >
                재감사
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CliTab({ usage }: { usage: CliUsage | null }) {
  if (!usage) return <Loading />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="오늘 호출"        value={usage.totalToday}      sub="모든 IP 합산" />
        <Stat label="고유 IP"          value={usage.uniqueIps}        sub="오늘" />
        <Stat label="Global 남은 quota" value={usage.globalRemaining ?? '—'} sub="일 800 한도" />
      </div>
      <div>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 가장 자주 audit 된 repo (오늘)</div>
        <div className="space-y-1">
          {usage.topRepos.length === 0 && <div className="font-mono text-xs" style={{ color: 'var(--text-label)' }}>(아직 없음)</div>}
          {usage.topRepos.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 text-xs" style={{
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '2px',
            }}>
              <span className="font-mono tabular-nums" style={{ color: 'var(--text-label)', width: '3em' }}>#{i + 1}</span>
              <span className="font-mono truncate flex-1" style={{ color: 'var(--cream)' }}>url 해시: {r.url}</span>
              <span className="font-mono tabular-nums" style={{ color: 'var(--gold-500)' }}>{r.count}회</span>
            </div>
          ))}
        </div>
        <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--text-label)' }}>
          ※ url 은 djb2 해시로 익명화 저장 (원본 URL 비노출)
        </div>
      </div>
    </div>
  )
}

function ToolsTab({
  token, tokenInput, setTokenInput, saveToken,
  refreshUrl, setRefreshUrl, onForceRefresh, refreshing, refreshOut,
}: {
  token: string; tokenInput: string; setTokenInput: (s: string) => void; saveToken: () => void
  refreshUrl: string; setRefreshUrl: (s: string) => void
  onForceRefresh: () => void; refreshing: boolean; refreshOut: string | null
}) {
  return (
    <div className="space-y-8">
      <section>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 관리자 토큰</div>
        <p className="font-light text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
          ADMIN_TOKEN (Supabase secret 으로 설정된 값) — 강제 재감사·rate limit 우회용. 토큰은 localStorage 에 저장되며 이 브라우저에만 유지됩니다.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            placeholder={token ? '저장됨 (재입력해서 교체)' : '토큰 붙여넣기'}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            className="flex-1 px-3 py-2 font-mono text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--cream)', borderRadius: '2px' }}
          />
          <button onClick={saveToken} className="font-mono text-xs px-4 py-2"
                  style={{ background: 'var(--gold-500)', color: 'var(--navy-900)', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
            저장
          </button>
        </div>
        <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--text-label)' }}>
          현재 상태: {token ? '✅ 저장됨' : '⚠ 미저장 — 강제 재감사 사용 불가'}
        </div>
      </section>

      <section>
        <div className="font-mono text-xs tracking-widest mb-3" style={{ color: 'var(--gold-500)' }}>// 강제 재감사</div>
        <p className="font-light text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
          rate limit 을 우회하고 새 audit 을 트리거. URL cap / IP cap / global cap 모두 무시됩니다.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="github.com/owner/repo"
            value={refreshUrl}
            onChange={e => setRefreshUrl(e.target.value)}
            className="flex-1 px-3 py-2 font-mono text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--cream)', borderRadius: '2px' }}
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
          <div className="mt-3 p-3 font-mono text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--cream)' }}>
            {refreshOut}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, tone }: {
  label: string; value: number | string; sub: string; tone?: 'ok' | 'warn'
}) {
  const valColor = tone === 'warn' ? 'var(--scarlet)' : tone === 'ok' ? '#00D4AA' : 'var(--cream)'
  return (
    <div className="card-navy p-4" style={{ borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="font-display font-bold text-2xl mt-1" style={{ color: valColor }}>{value}</div>
      {sub && <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-primary)' }}>{sub}</div>}
    </div>
  )
}

function Loading() {
  return <div className="font-mono text-xs py-8 text-center" style={{ color: 'var(--text-label)' }}>로딩 중…</div>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative z-10 pt-32 pb-16 px-4 min-h-screen text-center">
      <div className="max-w-md mx-auto">{children}</div>
    </section>
  )
}
