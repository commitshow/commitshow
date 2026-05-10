// /pitch-k · investor-facing 한국어 deck.
//
// PitchPage 영문 버전을 1:1 미러링하되 어조와 사례를 한국 VC 의 멘탈
// 모델에 맞춰 재구성. 격식 (합쇼체 -ㅂ니다) 일관, "moat" 같은 영어
// jargon 은 "선점 자산" / "후발주자 진입장벽" 같은 한국어로 풀고,
// "벤치마크" "검증 가능한 평가" 같은 한국 VC 가 자주 쓰는 표현 우선.
// 영어 deck 의 '디자인 락' (navy + gold · Playfair + DM Sans + DM Mono ·
// emoji 0 · 헤딩 trailing period 0) 그대로 유지. 한글 본문은 DM Sans
// 가 한글 글리프 없으므로 system serif 로 폴백되는데, 이건 의도된
// 동작 (영문 wordmark + 한국어 본문 대비가 deck 의 시각 톤).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAVY_950   = '#060C1A'
const NAVY_800   = '#0F2040'
const GOLD       = '#F0C040'
const SCARLET    = '#C8102E'
const PURPLE     = '#A78BFA'
const TEAL       = '#00D4AA'
const BLUE       = '#60A5FA'

interface PitchStats {
  projects:    number | null
  audits:      number | null
  members:     number | null
  audits_7d:   number | null
  cli_7d:      number | null
}

function usePitchStats(): PitchStats {
  const [s, setS] = useState<PitchStats>({
    projects: null, audits: null, members: null, audits_7d: null, cli_7d: null,
  })
  useEffect(() => {
    let alive = true
    ;(async () => {
      const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const [p, a, m, a7, c7] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }),
        supabase.from('members').select('id', { count: 'exact', head: true }),
        supabase.from('analysis_snapshots').select('id', { count: 'exact', head: true }).gt('created_at', sevenAgo),
        supabase.from('cli_audit_calls').select('id', { count: 'exact', head: true }).gt('created_at', sevenAgo),
      ])
      if (!alive) return
      setS({
        projects:  p.count  ?? null,
        audits:    a.count  ?? null,
        members:   m.count  ?? null,
        audits_7d: a7.count ?? null,
        cli_7d:    c7.count ?? null,
      })
    })().catch(() => { /* silent */ })
    return () => { alive = false }
  }, [])
  return s
}

// ──────────────────────────────────────────────────────────────────────
// Section primitives (mirror of PitchPage)
// ──────────────────────────────────────────────────────────────────────

function SectionEyebrow({ n, label, accent = GOLD }: { n: string; label: string; accent?: string }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: accent }}>
      {n} · {label}
    </div>
  )
}

function SectionH({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display font-black mb-5"
        style={{ color: 'var(--cream)', fontSize: 'clamp(1.85rem, 4vw, 3.1rem)', lineHeight: 1.2, letterSpacing: '-0.5px' }}>
      {children}
    </h2>
  )
}

function SectionLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-light mb-8" style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.05rem, 1.6vw, 1.25rem)', lineHeight: 1.65, maxWidth: 880 }}>
      {children}
    </p>
  )
}

function StatCell({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="px-3 py-3"
         style={{ background: 'rgba(15,32,64,0.45)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
      <div className="font-mono text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-display font-bold tabular-nums" style={{ color: 'var(--cream)', fontSize: 28, lineHeight: 1.05 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint && <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</div>}
    </div>
  )
}

function PillarCard({ tone, title, weight, lead, items }: { tone: string; title: string; weight: string; lead: string; items: string[] }) {
  return (
    <div className="px-5 py-5"
         style={{ background: `${tone}10`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>{title}</div>
        <div className="font-mono tabular-nums text-xl" style={{ color: tone }}>{weight}</div>
      </div>
      <p className="mb-3" style={{ color: 'var(--cream)', fontSize: '0.9rem', lineHeight: 1.55 }}>
        <strong style={{ fontWeight: 600 }}>{lead}</strong>
      </p>
      <ul className="space-y-1 list-none" style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.55 }}>
        {items.map((t, i) => <li key={i}>· {t}</li>)}
      </ul>
    </div>
  )
}

function ProblemCard({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}30`, borderRadius: '2px' }}>
      <div className="font-display font-bold text-lg mb-2" style={{ color: 'var(--cream)' }}>{title}</div>
      <p className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{body}</p>
    </div>
  )
}

function LaneCard({ tone, num, title, sub, body }: { tone: string; num: string; title: string; sub: string; body: React.ReactNode }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>Lane {num}</div>
      <div className="font-display font-black text-xl mb-1" style={{ color: 'var(--cream)' }}>{title}</div>
      <div className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>{sub}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

function FlowCard({ tone, label, edges, body }: { tone: string; label: string; edges: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px' }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>{label}</div>
      <div className="font-mono text-[11px] mb-3" style={{ color: 'var(--text-secondary)' }}>{edges}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

function RevenueRow({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="mb-4 pl-3" style={{ borderLeft: `2px solid ${tone}` }}>
      <div className="font-display font-bold text-base mb-1" style={{ color: 'var(--cream)' }}>{title}</div>
      <div className="font-light text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

function RoadCol({ tone, phase, title, items }: { tone: string; phase: string; title: string; items: string[] }) {
  return (
    <div className="px-4 py-4" style={{ background: `${tone}08`, border: `1px solid ${tone}40`, borderRadius: '2px', minHeight: 280 }}>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-1" style={{ color: tone }}>{phase}</div>
      <div className="font-display font-bold text-base mb-3" style={{ color: 'var(--cream)' }}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2" style={{ color: 'var(--text-primary)' }}>
            <span className="font-mono text-xs" style={{ color: tone }}>·</span>
            <span className="font-light text-[13px]" style={{ lineHeight: 1.5 }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhyNowCard({ tone, t, body }: { tone: string; t: string; body: string }) {
  return (
    <div className="px-5 py-5" style={{ background: `${tone}08`, border: `1px solid ${tone}30`, borderRadius: '2px' }}>
      <div className="font-display font-bold text-base mb-2" style={{ color: tone }}>{t}</div>
      <p className="font-light text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>{body}</p>
    </div>
  )
}

function MoatRow({ n, t, body }: { n: string; t: string; body: string }) {
  return (
    <div className="px-4 py-3 flex gap-3" style={{ background: 'rgba(15,32,64,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '2px' }}>
      <div className="font-mono text-2xl flex-shrink-0" style={{ color: GOLD, fontFamily: 'Playfair Display, serif', lineHeight: 1, paddingTop: 2 }}>{n}</div>
      <div>
        <div className="font-display font-bold mb-1" style={{ color: 'var(--cream)', fontSize: '1rem' }}>{t}</div>
        <div className="font-light text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  )
}

function CompRow({ s, what, win }: { s: string; what: string; win: string }) {
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <td className="py-3 pr-4 font-mono align-top" style={{ color: 'var(--cream)' }}>{s}</td>
      <td className="py-3 pr-4 align-top" style={{ color: 'var(--text-secondary)' }}>{what}</td>
      <td className="py-3 align-top" style={{ color: 'var(--text-primary)' }}>{win}</td>
    </tr>
  )
}

function Divider() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16">
      <div style={{ height: 1, background: 'rgba(240,192,64,0.12)' }} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────

export function PitchKPage() {
  const stats = usePitchStats()
  const fmt = (n: number | null) => n == null ? '—' : n.toLocaleString()

  return (
    <main className="relative z-10 min-h-screen pb-20">
      {/* ─── Hero ─── */}
      <section className="px-4 md:px-8 lg:px-16 pt-24 pb-20 max-w-6xl mx-auto">
        <SectionEyebrow n="00" label="Investor Brief · Pre-Seed · 한국어" accent={GOLD} />
        <h1 className="font-display font-black mb-5"
            style={{ color: 'var(--cream)', fontSize: 'clamp(2.4rem, 5.8vw, 5rem)', lineHeight: 1.1, letterSpacing: '-1px' }}>
          모든 커밋,<br/>
          <span style={{ color: GOLD }}>무대 위로</span>
        </h1>
        <p className="font-light mb-8" style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.1rem, 2vw, 1.4rem)', lineHeight: 1.6, maxWidth: 880 }}>
          AI 는 코드를 빠르게 만듭니다. 그리고 동시에 빈 곳도 만듭니다.{' '}
          <span style={{ color: 'var(--cream)' }}>commit.show</span> 는 바이브코딩 세대를 위한 검증 레이어입니다. Cursor · Claude Code · Lovable 로 제품을 만드는 전 세계 3,000만 명의 빌더에게 <strong>재현 가능한 품질 증거</strong>를 제공합니다.
        </p>
        <div className="flex flex-wrap gap-3 mb-12">
          <Link to="/" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ background: GOLD, color: NAVY_950, borderRadius: '2px' }}>
            제품 직접 보기 →
          </Link>
          <Link to="/rulebook" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'var(--cream)', borderRadius: '2px' }}>
            심사 룰북 읽기
          </Link>
          <Link to="/pitch" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)', borderRadius: '2px' }}>
            English version →
          </Link>
        </div>

        {/* Live traction strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCell label="감사된 프로젝트"  value={fmt(stats.projects)} hint="누적" />
          <StatCell label="감사 리포트"      value={fmt(stats.audits)}   hint="스냅샷" />
          <StatCell label="회원 수"          value={fmt(stats.members)}  hint="Creator + Scout" />
          <StatCell label="최근 7일 감사"    value={fmt(stats.audits_7d)} hint="주간 가동률" />
          <StatCell label="CLI 호출"         value={fmt(stats.cli_7d)}    hint="npx commitshow" />
        </div>
        <div className="font-mono text-[10px] mt-3" style={{ color: 'var(--text-faint)' }}>
          위 수치는 production DB 에서 페이지 로드 시점에 직접 조회됩니다 · pre-launch (Season Zero)
        </div>
      </section>

      <Divider />

      {/* ─── Problem ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="01" label="시장 기회" accent={SCARLET} />
        <SectionH>코드를 짜지 않고 코드를 시키는 사람이 3,000만 명</SectionH>
        <SectionLead>
          Cursor 는 2025년 유료 사용자 100만 명을 돌파했습니다. Lovable 은 8주 만에 매출 0 → ARR 200억 원에 도달했습니다. Claude Code 는 Anthropic 의 엔터프라이즈 계약에 기본 포함되고 있습니다. 앞으로 투자하실 모든 제품 팀이 이 레이어 위에서 더 빠르게 출시할 것입니다.
        </SectionLead>
        <SectionLead>
          그런데 이 흐름과 함께 세 가지 새로운 문제가 동시에 등장했고, 아직 어떤 디폴트 도구도 자리잡지 못한 상태입니다:
        </SectionLead>
        <div className="grid md:grid-cols-3 gap-4 mt-2">
          <ProblemCard tone={SCARLET} title="품질 신호의 부재"
            body="AI 가 6시간 만에 만든 랜딩 페이지와, 6개월간 운영해온 제품이 URL 만으로는 구분되지 않습니다. 투자자도, 채용 담당자도, 사용자도 무엇이 진짜인지 가릴 방법이 없습니다." />
          <ProblemCard tone={SCARLET} title="AI 도구 간 분절"
            body="같은 프롬프트도 도구마다 결과가 다릅니다. 'Cursor 에서 이 룰이 작동했다' '이 Claude Skill 이 정확했다' 같은 노하우가 사적인 디스코드 스크린샷에 갇혀 있습니다. 공유 가능한 자산으로 굳어지지 못하고 있습니다." />
          <ProblemCard tone={SCARLET} title="신뢰 마켓의 부재"
            body="훌륭한 제품을 만드는 1인 빌더는 많지만 자기 포트폴리오를 보여줄 표준 surface 가 없습니다. 채용·인수 담당자는 결국 GitHub stars (틀린 신호) 나 VC 투자 이력 (편향된 필터) 으로 회귀합니다." />
        </div>
      </section>

      <Divider />

      {/* ─── Solution ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="02" label="우리가 만든 것" accent={GOLD} />
        <SectionH>바이브코딩 제품을 위한 검증 레이어</SectionH>
        <SectionLead>
          commit.show 는 모든 출시 제품을 100점 만점의 투명한 루브릭으로 측정합니다. 결정론적인 기술 신호 (Lighthouse · 저장소 위생 · 보안 헤더 · 딥프로브) 와 두 개의 사람 신호 (Scout 예측 · Community 반응) 를 결합합니다. 결과는 <strong>이동 가능한 검증 점수</strong>입니다 — 사이트에서 추출되는 게 아니라 사이트와 함께 따라다니는 자산입니다.
        </SectionLead>

        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <LaneCard
            tone={BLUE}
            num="01"
            title="URL Fast Lane"
            sub="저장소 없이도 가능 · 30초"
            body="배포된 URL 만 붙이면 됩니다. 모바일·데스크톱 Lighthouse 병렬 실행, 다중 라우트 reachability 검사, Cloudflare Browser Rendering 으로 hydration 후 HTML 까지 분석합니다. 비공개 SaaS 창업자도 소스 노출 없이 검증을 받습니다."
          />
          <LaneCard
            tone={TEAL}
            num="02"
            title="CLI Walk-on"
            sub="익명 저장소 감사 · npx 한 줄"
            body={<>터미널 명령 한 줄 — <code style={{ color: 'var(--cream)', fontFamily: 'DM Mono, monospace', fontSize: '0.85em' }}>npx commitshow@latest audit github.com/owner/repo</code> — 이 점수와 개선 항목을 즉시 반환합니다. 결과는 그대로 Cursor·Claude Code 의 다음 프롬프트 컨텍스트로 들어가 개발 루프를 가속합니다.</>}
          />
          <LaneCard
            tone={PURPLE}
            num="03"
            title="Member Audition"
            sub="풀 감사 · 3주 시즌"
            body="Creator 가 제품과 Build Brief 를 제출하고, 감사 엔진이 정밀 측정을 수행하며, Scout (등급제 예측가) 가 투표권을 행사하고, Community 반응으로 마무리됩니다. 시즌은 3주이며 상위 20% 는 영구 Hall of Fame 에 등재됩니다."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Scoring ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="03" label="평가 방법론" accent={GOLD} />
        <SectionH>50 · 30 · 20 — 공개되고, 방어 가능하며, 보정된 기준</SectionH>
        <SectionLead>
          루브릭 전체가 <code style={{ color: GOLD, fontFamily: 'DM Mono, monospace' }}>/rulebook</code> 페이지에서 공개됩니다. 보정 베이스라인은 supabase · cal.com · shadcn-ui · vercel/ai 등 프로덕션급 오픈소스 5개입니다. 엔진이 이들을 매번 상위권에 위치시키는지 prompt 변경마다 자동 검증합니다.
        </SectionLead>

        <div className="grid md:grid-cols-3 gap-4 mb-10">
          <PillarCard tone={GOLD} title="Audit (감사)" weight="50"
            lead="엔진이 직접 측정합니다. 같은 입력은 항상 같은 점수가 나옵니다."
            items={[
              'Lighthouse — 사용자 체감 품질 20점 (구글 공식 진단 도구 · 모바일 + 데스크톱 평균)',
              '실제 작동 여부 — 5점 (URL 살아있는지 · SSL · 응답속도 · 내부 페이지 도달성)',
              '운영 성숙도 — 12점 (테스트 · CI · 모니터링 · 라이센스 · 반응형 등 7가지 신호)',
              '소스 위생 — 5점 (저장소 공개성 · 거버넌스 문서)',
              '기술 다양성 — 3점 (프론트 + 백엔드 + DB + AI 풀스택 증거)',
              '빌드 브리프 충실도 — 5점 (자기소개서 진정성 · AI 자동생성 입력 필터)',
              '소프트 보너스 — +0~10점 (상위 1% OSS · 활성 commit · 성장 momentum)',
            ]} />
          <PillarCard tone={PURPLE} title="Scout (예측가)" weight="30"
            lead="실력 검증된 사람이 본인 평판을 걸고 예측합니다."
            items={[
              '등급제 월별 투표권 (Bronze 20장 · Silver 40 · Gold 60 · Platinum 80)',
              '적중률을 공개 프로필에 누적 기록',
              '자기 프로젝트 투표는 DB 트리거로 차단',
              'Early Spotter 보너스 (Week 1 이전 정확 예측)',
              '활동량 OR 적중률 — 두 경로로 등급 승급 가능',
            ]} />
          <PillarCard tone={TEAL} title="Community" weight="20"
            lead="네트워크가 만드는 신호. 양보다 질로 가중합니다."
            items={[
              '댓글 깊이 (판단 근거 댓글 우선 · 단순 +1 제외)',
              '재방문율 가중',
              'Applaud 토글 (1 항목 1 박수 · 무제한)',
              '본인 콘텐츠 자가 반응 필터링',
              '코사인 유사도 봇 패턴은 silent zero-out',
            ]} />
        </div>

        <div className="px-5 py-5"
             style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-2" style={{ color: GOLD }}>왜 룰북을 공개하는가</div>
          <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.7 }}>
            App Store · ProductHunt 같은 폐쇄 평가 시스템은 사용자가 점수가 자의적이라고 느끼는 순간 신뢰를 잃습니다. 우리는 슬롯 가중치, bucket 임계값, 보정 reference set 까지 모두 공개합니다. 빌더는 제출 전에 자기 점수를 시뮬레이션할 수 있고, 우리가 점수를 임의로 조작하지 않는다는 사실을 누구나 검증할 수 있습니다. <strong>이 급진적 투명성 자체가 카테고리 리더 자리의 조건</strong>입니다 — 후발주자가 우리 루브릭을 그대로 베껴도, 결국 우리 벤치마크 위에서 우리와 경쟁하게 됩니다.
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Network effects ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="04" label="네트워크 효과" accent={GOLD} />
        <SectionH>3 면이 하나의 플라이휠로</SectionH>
        <SectionLead>
          매 감사가 세 개의 재사용 가능한 자산을 동시에 생성합니다 — 공개 점수 (Creator 측), 예측 적중 트랙 레코드 (Scout 측), Library 아티팩트 (감사된 저장소가 실제로 사용한 Cursor 룰 · Claude Skill · MCP 설정). 각 아티팩트는 그것을 사용해 졸업한 프로젝트를 역참조 합니다. 채택이 감사를 부르고, 감사가 다시 아티팩트를 만들어내는 구조입니다.
        </SectionLead>

        <div className="grid md:grid-cols-3 gap-4 mt-2">
          <FlowCard
            tone={GOLD}
            label="Creator"
            edges="감사 + 랭킹 → 영구 Hall of Fame 등재"
            body="1인 빌더가 제품을 출시합니다. 엔진이 점수를 매기고, 상위 20% 가 졸업합니다. 이 졸업 배지가 AI 네이티브 빌더를 위해 처음으로 만들어진 이동 가능한 자격 증명입니다."
          />
          <FlowCard
            tone={PURPLE}
            label="Scout"
            edges="예측 트랙 → 등급 승급 → 채용 시그널"
            body="시니어 엔지니어와 PM 이 어떤 감사된 제품이 끝까지 갈지 투표합니다. 적중률이 공개되고 누적됩니다. 상위 Scout 는 'Verified by commit.show' 배지를 획득해 채용·인수 검토에 활용됩니다."
          />
          <FlowCard
            tone={TEAL}
            label="Library"
            edges="자동 발굴 → PR 한 번으로 적용 → 졸업 인용"
            body="감사된 저장소가 자동 스캔되어 재사용 가능한 아티팩트 (Cursor 룰 · MCP 설정 · 프롬프트 팩) 가 발굴됩니다. apply-to-my-repo 는 GitHub OAuth 로 PR 한 번에 적용됩니다. 채택 통계가 곧 신뢰도이며, 별점이나 다운로드 수가 아닙니다."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Business model ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="05" label="비즈니스 모델" accent={GOLD} />
        <SectionH>B2C 는 가동 중 · B2B 는 같은 데이터 위에 적층</SectionH>
        <SectionLead>
          감사 엔진이 진입 쐐기입니다. 동일한 평가 인프라가 소비자 자격증명 레이어 (현재) 와 엔터프라이즈 / 채용 / 스폰서십 레이어 (V1.5+) 를 동시에 가동시킵니다. 파이프라인 하나, 매출 surface 네 개입니다.
        </SectionLead>

        <div className="grid md:grid-cols-2 gap-5 mt-4">
          {/* B2C */}
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${GOLD}40`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: GOLD }}>B2C — V1 운영 중</div>
            <div className="font-display font-black text-2xl mb-4" style={{ color: 'var(--cream)' }}>소비자 자격증명 레이어</div>
            <RevenueRow tone={GOLD} title="Audition 등록비"
              body="Creator 별 영구 3회 무료, 4회차부터 유료. Stripe Live 가 2026-05-09 부로 가동 중입니다. 졸업 시 Encore credit 으로 보정되는 구조 — Steam Direct 모델 차용 · 인센티브가 정렬되어 있어 자연스럽게 전환됩니다."/>
            <RevenueRow tone={GOLD} title="Library 마켓플레이스"
              body="프리미엄 아티팩트 판매 시 Creator 80 / 플랫폼 20 분배. 프리 티어는 출시 첫 날부터 공급을 부트스트랩하고, 유료 티어는 졸업 프로젝트가 인용한 아티팩트만 잠금 해제됩니다. V1.5 출시 예정." />
            <RevenueRow tone={GOLD} title="장식 + 영속성"
              body="Hall of Fame 업그레이드, 커스텀 배지 디자인, 시즌 기념품. 빈도는 낮지만 마진이 높은 surface — 자격증명 위에 얹는 Steam 식 모델." />
          </div>

          {/* B2B */}
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${PURPLE}40`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: PURPLE }}>B2B — V1.5 / V2</div>
            <div className="font-display font-black text-2xl mb-4" style={{ color: 'var(--cream)' }}>엔터프라이즈 + 생태계 레이어</div>
            <RevenueRow tone={PURPLE} title="Audit API"
              body="동일 엔진을 metered REST 엔드포인트로 노출. 타깃 — VC 의 포트폴리오 검토팀, 코드 리뷰 SaaS 의 'shipping readiness' 모듈, ATS 벤더의 후보자 저장소 검증. $0.05~$0.50 per audit · 볼륨 티어." />
            <RevenueRow tone={PURPLE} title="GitHub Marketplace Action"
              body="commitshow/audit-action 이 PR-gating 을 이미 제공 중입니다. OSS 는 무료, 프라이빗 monorepo 는 시트당 월정액 (무제한 PR 감사 + 커스텀 룰 오버레이). 이미 GitHub Marketplace 에 등록 완료." />
            <RevenueRow tone={PURPLE} title="채용사 액세스"
              body="채용팀을 위한 ATS 형 티어. 졸업 Creator 를 Audit pillar · Stack Fingerprint · Scout 추천 등으로 필터링합니다. 시트당 구독 — §01 의 'GitHub stars 는 잘못된 신호' 문제를 직접 해결합니다." />
            <RevenueRow tone={PURPLE} title="툴 스폰서십 + Sponsored Showcase"
              body="Cursor · Anthropic · Vercel 같은 도구 회사가 자사 스택 기반 시즌 Showcase 를 후원합니다. 스폰서가 상금 풀 + 브랜드 이벤트 retainer 를 부담. /admin/events 에 6 템플릿이 이미 템플릿화되어 있습니다." />
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Roadmap ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="06" label="로드맵" accent={GOLD} />
        <SectionH>쐐기에서 생태계까지 18개월</SectionH>
        <SectionLead>
          현재 V1 빌드 마무리 단계입니다. 공개 출시는 주 단위가 아니라 일 단위로 임박해 있습니다. 이번 라운드 자금은 아래 4단계에 사용됩니다.
        </SectionLead>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mt-4">
          <RoadCol tone={GOLD} phase="V1 · 현재" title="감사 + Audition"
            items={[
              '3개 감사 lane 라이브 (URL · CLI · 회원)',
              'Stripe Live 결제 가동',
              'Season Zero 일반 공개 임박',
              'GitHub Action Marketplace 등록 완료',
              'CLI npm 배포 — npx commitshow@latest audit',
            ]} />
          <RoadCol tone={PURPLE} phase="V1.5 · 2026 Q3" title="Library 마켓플레이스"
            items={[
              'Cursor 룰 · Claude Skill · MCP 설정 · 프롬프트 팩',
              '졸업 저장소 자동 스캔 발굴',
              'apply-to-my-repo · PR 한 번으로 적용',
              '80/20 유료 티어 + Stripe 정산',
              '채택 통계 → 졸업 provenance',
            ]} />
          <RoadCol tone={TEAL} phase="V1.8 · 2026 Q4" title="엔터프라이즈 + 채용"
            items={[
              'Metered Audit API',
              '채용사 ATS 티어',
              'GitHub App 으로 프라이빗 저장소 감사',
              'SOC 2 준비',
              '툴 스폰서십 파이프라인 (Cursor · Anthropic · Vercel)',
            ]} />
          <RoadCol tone={BLUE} phase="V2 · 2027" title="생태계 레이어"
            items={[
              'MCP 서버 (Claude Desktop · Cursor · Windsurf 통합)',
              'Open Bounty 호스팅 (스폰서 펀딩)',
              '인수 / Fund-of-Funds 디스커버리 surface',
              '다지역 보정',
              '코드리뷰 벤더용 white-label',
            ]} />
        </div>

        <div className="mt-8 px-5 py-4" style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: '2px' }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: GOLD }}>자본 효율성</div>
          <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.7 }}>
            V1 은 공개 출시까지 총 5,000만 원 미만의 운영비 (Claude API · Stripe · Cloudflare · Supabase) 만으로 빌드되었습니다. 감사 점수를 산출하는 파이프라인이 곧 API 티어를 가동하는 파이프라인입니다 — 보정에 투자한 1원이 두 제품을 동시에 강화합니다.
          </div>
        </div>
      </section>

      <Divider />

      {/* ─── Why now ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="07" label="왜 지금인가" accent={GOLD} />
        <SectionH>세 개의 창이 동시에 열렸습니다</SectionH>
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          <WhyNowCard
            tone={GOLD}
            t="바이브코딩이 메인스트림 진입"
            body="Cursor 유료 100만+, Lovable 8주 200억 ARR, Claude Code 가 Anthropic 엔터프라이즈에 디폴트 탑재. 18개월 만에 net-new 빌더 수천만 명이 surface 에 진입했습니다."
          />
          <WhyNowCard
            tone={PURPLE}
            t="LLM-as-judge 가 신뢰선 통과"
            body="Claude Sonnet 4.6 + structured tool-use 로 결정론적이고 감사 가능한 평가가 대규모로 가능해졌습니다. 'AI 가 AI 를 채점한다' 는 루프가 실제로 작동하며, 보정 drift 는 분기가 아니라 prompt 변경 단위로 측정됩니다."
          />
          <WhyNowCard
            tone={TEAL}
            t="기존 디스커버리 surface 의 붕괴"
            body="GitHub Trending 은 stars, ProductHunt 는 출시일 트래픽, awesome-list 는 작성자 권위에 최적화됐습니다. '오늘 production 에서 작동한다' 를 surface 하는 곳은 어디에도 없습니다. 카테고리 자체가 비어 있습니다."
          />
        </div>
      </section>

      <Divider />

      {/* ─── Moat ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="08" label="진입장벽" accent={GOLD} />
        <SectionH>후발주자가 따라잡을 수 없는 6개 자산</SectionH>
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <MoatRow n="1" t="보정 데이터셋"
            body="prompt 변경마다 5개 reference 프로젝트의 점수를 재산출. 6개월치 drift 데이터 누적. 신규 진입자는 이 데이터를 가지고 시작할 수 없습니다." />
          <MoatRow n="2" t="Scout 트랙 레코드"
            body="모든 Scout 의 적중률이 시즌별로 공개 누적됩니다. 두 시즌 깊이의 Scout 평판은 fast-follow 가 불가능합니다." />
          <MoatRow n="3" t="졸업 provenance"
            body="Library 아티팩트가 그것을 사용해 졸업한 프로젝트를 인용. '채택 → 졸업' 의 닫힌 루프는 경쟁자가 데이터 자체를 갖고 있지 않습니다." />
          <MoatRow n="4" t="apply-to-my-repo PR"
            body="아티팩트에서 사용자 저장소로의 one-click PR. GitHub OAuth + 변수 치환 + 멀티파일 Skill 번들. Wappalyzer · awesome-cursorrules 는 read-only — 우리는 코드를 직접 ship 합니다." />
          <MoatRow n="5" t="3-side 플라이휠"
            body="Creator 감사 → Scout 예측 → Library 채택 — 3 면이 서로 강화. 단면 경쟁자 (Lighthouse only · 채용 only · 마켓 only) 는 cross-side 복리를 점화하지 못합니다." />
          <MoatRow n="6" t="브랜드 선점"
            body="'모든 커밋, 무대 위로' 슬로건과 'Hall of Fame · Audition · Audit' 어휘 체계가 이미 우리에게 귀속됐습니다. 후발주자는 어휘부터 새로 만들어야 하지만 우리는 이미 도메인을 갖고 있습니다." />
        </div>
      </section>

      <Divider />

      {/* ─── Competitive ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="09" label="경쟁 환경" accent={GOLD} />
        <SectionH>우리가 무엇이고 무엇이 아닌가</SectionH>
        <div className="overflow-x-auto mt-4">
          <table className="w-full font-mono text-[12px]" style={{ minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${GOLD}30` }}>
                <th className="text-left py-3 pr-4 font-mono text-[10px] tracking-widest uppercase" style={{ color: GOLD }}>Surface</th>
                <th className="text-left py-3 pr-4 font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>현재 역할</th>
                <th className="text-left py-3 font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>우리가 이기는 이유</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text-primary)' }}>
              <CompRow s="GitHub Trending"          what="Star 가중 랭킹"            win="Star ≠ production 작동성. 우리는 실제로 ship 된 것을 측정합니다." />
              <CompRow s="ProductHunt"              what="출시일 어텐션 surface"      win="하루 스파이크 후 follow-up 감사 없음. 우리는 주 단위 craft 변화를 측정합니다." />
              <CompRow s="awesome-cursorrules"      what="큐레이티드 copy-paste 리스트" win="Read-only · provenance 없음. 우리 아티팩트는 졸업 저장소 인용 + one-click PR." />
              <CompRow s="Wappalyzer · BuiltWith"   what="기술 스택 감지"             win="감지만 가능. 우리는 점수 · 랭킹 · 자격증명까지." />
              <CompRow s="Lighthouse 단독"          what="성능 감사"                  win="단일 신호. 우리는 LH + 저장소 + scout + community 를 하나의 루브릭으로 결합." />
              <CompRow s="LinkedIn / 채용 ATS"      what="프로필 기반 채용 필터"      win="엔지니어링 신호 없음. 우리는 '감사 + 졸업' 을 이동 가능한 craft 증거로 surface 합니다." />
            </tbody>
          </table>
        </div>
      </section>

      <Divider />

      {/* ─── Team / Ask ─── */}
      <section className="px-4 md:px-8 lg:px-16 py-20 max-w-6xl mx-auto">
        <SectionEyebrow n="10" label="팀과 라운드" accent={GOLD} />
        <SectionH>누가 만드는가, 무엇을 모으는가</SectionH>
        <div className="grid md:grid-cols-2 gap-5 mt-2">
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-3" style={{ color: GOLD }}>팀</div>
            <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.7 }}>
              <p className="mb-3">파운딩 팀이 end-to-end 빌드합니다 — 감사 엔진 · React surface · Stripe 연동 · GitHub Action · CLI 까지 동일한 손이 작성합니다. V1 출시까지 헤드카운트 확장 없이 도달했습니다.</p>
              <p style={{ color: 'var(--text-muted)' }}>
                창업자 상세 이력은 첫 미팅에서 공유드립니다. 공개 페이지에는 보존하지 않습니다.
              </p>
            </div>
          </div>
          <div className="px-5 py-5" style={{ background: 'rgba(15,32,64,0.55)', border: `1px solid ${GOLD}50`, borderRadius: '2px' }}>
            <div className="font-mono text-[10px] tracking-widest uppercase mb-3" style={{ color: GOLD }}>라운드</div>
            <div className="font-light" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.7 }}>
              <p className="mb-3">Pre-seed 라운드입니다. 자금 용도 — V1 공개 출시 → V1.5 Library 마켓플레이스 출시 → V1.8 Audit API 티어 가동.</p>
              <p className="mb-3">자금 배분: <span style={{ color: 'var(--cream)' }}>40% 엔지니어링</span> (3명 채용) · <span style={{ color: 'var(--cream)' }}>30% 그로스</span> (도구 생태계 outreach + 스폰서십 파이프라인) · <span style={{ color: 'var(--cream)' }}>20% 보정</span> (Claude API 스케일 + 평가 인프라) · <span style={{ color: 'var(--cream)' }}>10% 법무 · 운영</span>.</p>
              <p style={{ color: 'var(--text-muted)' }}>라운드 사이즈와 밸류에이션은 첫 미팅에서 논의드립니다.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Closing ─── */}
      <section className="px-4 md:px-8 lg:px-16 pt-12 pb-32 max-w-6xl mx-auto">
        <div className="px-6 md:px-10 py-10"
             style={{
               background: `linear-gradient(135deg, ${NAVY_800} 0%, ${NAVY_950} 100%)`,
               border: `1px solid ${GOLD}40`,
               borderRadius: '2px',
             }}>
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: GOLD }}>맺음말</div>
          <div className="font-display font-black mb-4"
               style={{ color: 'var(--cream)', fontSize: 'clamp(1.5rem, 3.2vw, 2.4rem)', lineHeight: 1.25, letterSpacing: '-0.5px' }}>
            다음 3,000만 명의 개발자에게 필요한 것은 또 하나의 IDE 가 아닙니다. <span style={{ color: GOLD }}>'이건 진짜 작동한다'</span> 라고 증명해주는 무대입니다
          </div>
          <p className="font-light mb-6" style={{ color: 'var(--text-primary)', fontSize: '1.05rem', lineHeight: 1.7, maxWidth: 880 }}>
            현재 Season Zero 입니다. 감사가 가동 중이며, CLI 가 npm 에 배포되어 있고, GitHub Action 이 Marketplace 에 등록되었으며, Stripe 가 라이브입니다. 제품은 오늘 작동하고, 진입장벽은 매 스냅샷마다 복리로 강화됩니다. 같은 파동을 보고 계신 투자자분들과 대화하고 싶습니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="mailto:hans@commit.show?subject=Investor%20intro%20%C2%B7%20commit.show%20(KR)"
               className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
               style={{ background: GOLD, color: NAVY_950, borderRadius: '2px' }}>
              파운더에게 이메일 →
            </a>
            <Link to="/" className="inline-block px-5 py-2.5 font-mono text-[12px] tracking-widest uppercase"
                  style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'var(--cream)', borderRadius: '2px' }}>
              제품 직접 보기
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
