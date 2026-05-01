# CLAUDE.md — commit.show 프로젝트 컨텍스트

> Claude Code가 이 파일을 읽으면 전체 프로젝트를 즉시 이해하고 작업할 수 있다.
> 매 세션 시작 시 이 파일을 먼저 읽을 것.

---

## 1. 프로젝트 정체성

**commit.show** — 바이브코딩(AI 보조 개발) 프로젝트 전용 **커뮤니티 리그 + Creator Community** 플랫폼.

```
한 줄 정의: Every commit, on stage. —
           3주 시즌제 · AI 기술 평가 + Scout 인간 평가 + Creator Community
메인 슬로건: "Every commit, on stage. Audited by the engine, auditioned for Scouts."
이전 브랜드: debut.show (2026-04-20 에 commit.show 로 리브랜딩)
PRD 버전: v2 (2026-04-24) — v1 통합 기획서 (2026-04-19 + Creator Community 추가 2026-04-23) 기반
```

- **레포**: https://github.com/commitshow/commitshow (이전: hans1329/vibe · 2026-05-01 transfer)
- **CLI 레포**: https://github.com/commitshow/cli (분사 · npm `commitshow` 패키지)
- **Supabase URL**: https://tekemubwihsjdzittoqf.supabase.co
- **배포 대상**: Cloudflare Pages (GitHub `commitshow/commitshow` main 자동 빌드 · Pages 프로젝트 `commitshow`)
- **Pages URL**: https://commitshow.pages.dev
- **도메인**: commit.show + www.commit.show (Pages Custom Domain 연결 완료)
- **참고**: 옛 Pages 프로젝트 `vibe` (vibe-cxf.pages.dev) 는 2026-05-01 transfer 후 신규 `commitshow` 프로젝트로 이전 · 옛 프로젝트는 1-2일 보험 후 삭제 예정. `wrangler deploy` 는 사용 안 함.
- **미국 런칭**, 법인 설립 완료 (구조 세부는 INTERNAL.md §1)

### 1-A. v2 (2026-04-24) 핵심 방향 — v1.8 대비 delta 7가지

이번 PRD 재정비의 확정 결정. 이후 전 섹션은 이 7가지 전제 위에 쓰인다.

1. **Vote ≠ Applaud 분리 확정** — Vote 는 무거운 Forecast (Scout 티어별 월 20~80장 · ×N 몰빵 허용 · 졸업 점수 Scout 30% 반영 · 자기 앱 금지). Applaud 는 가벼운 호감 토글 (1 item = 1 applaud · 무제한 · 모든 user-generated content 대상 · 졸업 점수 무영향 · Community 20% 반응 신호로만 약하게 합산). §6 · §7 참조.
2. **졸업 기준 %-based 상대평가** — v1.8 "75점 2주 유지 + Live URL + 3 forecasts + auto 35" **절대 5-AND 게이트 폐기**. 대신 리그 내 상대평가 상위 20% 자동 졸업: Valedictorian ≈0.5% (1명 고정) · Honors 5% · Graduate 14.5% · Rookie Circle 80%. §6 참조.
3. **Applaud polymorphic target** — `applauds` 테이블 (`member_id`, `target_type`, `target_id`) 로 재설계. `target_type` ∈ {product, comment, build_log, stack, brief, recommit}. 기존 `UNIQUE (member_id, season_id)` 제약 제거 → `UNIQUE (member_id, target_type, target_id)`. 자기 콘텐츠 applaud 금지 (이해충돌).
4. **Creator Community 4 메뉴 V1 Day 1 필수** — Build Logs · Stacks · Asks · Office Hours. Reddit/Indie Hackers 이탈 방지 + LinkedIn-for-Vibecoders 장기 비전의 기초 증거. §13-B 신설.
5. **Rookie Circle 톤 엄격 유지** — "낙제 · 실패 · 탈락 · 패자 · 루저 · Loser · Failed · 미달 · 미흡" UI · 코드 · 약관 · 에러 메시지 · Claude 프롬프트 **전 레이어 금지**. 허용: "Rookie Circle · Try Again · 다음 Commit · Retry · Next season".
6. **브랜드 verb 3-체계 (재정정 2026-05-01 · 4-29 통합 롤백)** — 라틴어 audīre 어원 공유, 본질 다른 행위에 다른 verb. **행위 주체로 verb 가른다**:
   - **Audition** (Creator 행위 · 사람이 무대에 오름) — 첫 등록 · 재등판 · CTA · 이벤트 entry. Hero CTA: `Audition your product →` · ProfilePage "No auditions yet · Audition your first product…" · LadderPage `AUDITION YOUR PROJECT →` · 이력 페이지 `Audition Log` · Hall of Fame 메타포 `Audition Archive`.
   - **Audit** (Engine 행위 · 도구가 측정) — analyze-project Edge Function 호출 · `Re-audit →` 버튼 · `Audit report` 출력 · `/audit` 메서드 페이지 · CLI `commitshow audit` · `commitshow-mcp` audit_repo 도구 · `api.commit.show/audit` REST 엔드포인트.
   - **Audited** (passive result) — 측정 완료된 상태. "Audited on commit.show".

   룰: **사용자 시점 = Audition · 엔진 시점 = Audit.** 4-29 에 두 verb 를 "Audit 으로 통합" 시도했다가 5-01 에 잘못된 방향으로 판명, 이전 분리 룰 복구. 같은 폼 안에서도 Creator 가 누르는 버튼은 "Audition", 그 결과로 Engine 이 만드는 출력은 "Audit report" — 자연스럽게 두 단어가 같이 등장.

   "Commit" 은 브랜드 wordmark·도메인·Hall of Fame 메타포로만 유지 ("commit.show" · "Every commit, on stage"). "Submit" / "Register" / "Apply" / "Score your project" UI 금지. **"AI" 단어 사용자 노출 금지** — "AI analysis" → "Audit report" 식으로 치환 (§19 rule 11).
7. **Audit 5+3 비대칭 유지** — 사용자 노출 명칭 "Audit report" (내부 기술 레이어 = Claude 호출 · §3). 장점 5 / 우려 3. 5+5 대칭 형식 **금지** (아첨 인지 편향 + Creator 방어 부담 완화).

### 1-B. 참조 문서

- `supabase/schema.sql` — 현재 DB 스키마 (v2 마이그레이션 대상)
- v1 통합 기획서 (2026-04-19 + 2026-04-23 Creator Community 추가) — 본 CLAUDE.md 와 1:1 대응. 기획서는 외부 문서로 관리, CLAUDE.md 는 Claude Code 가 repo 에서 바로 실행 가능한 레벨의 운영 지침·요약.
- **`INTERNAL.md`** (gitignored · 비공개) — 가격/환불 · 법적 검토 노트 · 어뷰징 방어 4층 상세 · audit calibration baseline · admin secrets · TODO. CLAUDE.md 의 슬림 stub 들이 가리키는 원본.
- **공개 페이지 (사용자 노출)**:
  - [/rulebook](https://commit.show/rulebook) — 리그 심사 철학 + Score 100pt 분배 · graduation 등급
  - [/backstage](https://commit.show/backstage) — Phase 2 brief (failure_log/decisions/delegation) 의 가치 · earn-status 마케팅
- **로그인 회원 전용 (내부 자료)**:
  - [/audit](https://commit.show/audit) — Audit pillar 점수 산출 로직 16 섹션 deep-dive (회원 가드)
- **관리자 전용**:
  - [/admin](https://commit.show/admin) — 한국어 대시보드 · 5 탭 · members.is_admin 가드 · §15-D 참조

> **공개 repo 주의**: github.com/commitshow/commitshow 는 public. 따라서 CLAUDE.md 자체는
> 인덱싱됨. 민감 정보는 모두 INTERNAL.md (gitignored) 로 옮겼고, 2026-04-28 history rewrite
> 로 옛 leak 도 정리됨. 2026-05-01 hans1329/vibe → commitshow/commitshow transfer 완료
> (GitHub 자동 redirect 작동 중).

---

## 2. 핵심 설계 원칙 (변경 불가)

법적 검토 + v2 재정비 거친 확정 결정. 임의 변경 금지.

**회원·역할**
- 단일 회원제: 모든 사용자는 Member. 역할은 행위 레이블 (Creator · Scout/Forecaster · Commenter · Contributor · MD Seller)
- 유료 회원제 없음: 전원 무료 가입. 수익 = 등록비 + 마켓 수수료 + 스폰서십
- Creator 첫 3 Commits 무료 · 4번째부터 유료 (가격·법무 디테일은 INTERNAL.md §1 참조)

**용어 금칙**
- Forecast 용어만: Predict · Bet · Wager · Gamble 금지 (CFTC · 도박법 리스크)
- "리그 진척률" 표현만: Bonding Curve 언급 금지 (Pump.fun 연상)
- Rookie Circle 톤: 낙제 · 실패 · 탈락 · 패자 · Loser · Failed · 미달 전 레이어 금지 (§1-A ⑤)
- 브랜드 verb 3-체계 (§1-A ⑥ 2026-04-29): **Audit** (ladder default) · **Audition** (event entry) · **Audited** (passive result). 라틴어 audīre 어원 공유 · 본질 다른 행위에 다른 verb. AI 레이어 = "Audit". "Commit" 은 도메인·브랜드 메타포만. "Submit" / "Register" / "Apply" / "Score your project" UI 금지.
- **"AI" 단어 사용자 노출 금지**: "AI analysis" / "AI score" / "AI feedback" 전부 → **Audit / Audit report / Audit findings** 로 치환. 이유: 슬롭 연상 + 제품 본질과 거리 + Audit 이 더 정확. 예외: Creator 가 빌드에 쓴 도구를 묘사할 때 "AI-assisted development" · "with Cursor · Claude · Lovable" 같은 서술은 허용 (바이브코딩 맥락). 내부 코드·함수·주석엔 "AI" 사용 무관.
- 수익·금융 연상 금지: 배당 · ROI · 베팅 · 투자수익 · 본드 커브 · Paid Membership (§17 §20.6)

**점수·졸업**
- Audit 50% + Scout Forecast 30% + Community 20% = 100 (가중 변경 금지)
- 졸업 = 리그 내 상위 20% 상대평가 (§1-A ② · §6) · 어느 한 축만으로 졸업 불가
- Applaud 는 졸업 점수 무영향. Community 20% 의 반응 신호로만 약하게 합산
- Audit = 장점 5 + 우려 3 비대칭 (§1-A ⑦) · 사용자 노출 명칭 "Audit report" (내부적으로는 AI 호출)
- 심사 룰북 공개 (/rulebook) — 중립 리그 포지션의 증거

**Community**
- Creator Community 4 메뉴 (Build Logs · Stacks · Asks · Office Hours) 상시 활성. 리그 휴식기에도 활동 공간이 비지 않도록.
- 판단 근거형 코멘트 유도: 감정 태그 허용 (🙌 🎯 🔥 🤔 💡) · 길이 강요 X · 한 줄 OK · AI 티 나는 댓글 필터 (V1.5+)
- 단 CLAUDE.md §4 디자인 시스템의 emoji 금지 원칙은 **UI 아이콘·지표·버튼 라벨** 한정. Comment 입력 중 사용자가 찍는 감정 태그는 예외 허용.

**결제·페이아웃**
- 등록비 결제: Stripe (카드 + Apple Pay + Google Pay)
- Creator 환급 + 상금 페이아웃: **Wise Business** (1사분) / **Trolley** (2사분 백엔드) · USDC 제거 (v1.7)
- Community Award 는 비현금 기본 · 필요 시 Tremendous gift card (법무 검증 후)

**약관·운영**
- 심사 룰북 공개 유지
- 어뷰징 대응: 의심 계정 삭제·공개 망신 < 조용한 영향력 0 처리 (§18.4)

---

## 3. 기술 스택 (확정)

```
Frontend:    React 18 + Vite + TypeScript + Tailwind CSS
Backend:     Supabase (PostgreSQL + Auth + Edge Functions + Realtime)
Audit 엔진:  Claude API · claude-sonnet-4-6 (현재) — 점수 산출 + 인사이트
             (내부 기술 레이어 명칭 · 사용자 UI 에는 "Audit" 만 노출 · §19 rule 11)
Lighthouse:  Google PageSpeed Insights API (무료 키 or VITE_PAGESPEED_KEY)
GitHub 분석: GitHub REST API (공개 레포 파싱)
배포:        Cloudflare Pages (GitHub main 자동 빌드 · git push 만으로 반영)
결제:        Stripe (등록비 · V1 런칭 필수 · 금액은 INTERNAL.md §1)
페이아웃:    Wise Business (1사분) / Trolley (2사분 백엔드) · USDC 제거
```

### 환경변수 (.env)

```
VITE_SUPABASE_URL=https://tekemubwihsjdzittoqf.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_PAGESPEED_KEY=  # 선택사항
```

### 아키텍처 원칙

```
- Supabase Cron → Edge Function → DB 상태머신 → React 읽기
- 함수가 함수를 호출하는 패턴 금지 (동시 실행 한계)
- pipeline_health 뷰를 첫 번째로 구현 (관찰 가능성 우선)
- API 안전: while(true) 금지 · offset DB 저장 · 일일 한도 상수 하드코딩
```

---

## 4. 디자인 시스템 (아이비리그 스쿨)

```
테마:     네이비 + 골드. 학교·리그·졸업 메타포.
배경:     --navy-950: #060C1A (최어둠)
표면:     --navy-800: #0F2040
골드:     --gold-500: #F0C040 (메인 액센트)
크림:     --cream: #F8F5EE (텍스트)
스칼렛:   --scarlet: #C8102E (경고·수석)

텍스트 계층 (하드코딩된 rgba 금지 · 의미 기반 토큰 사용):
  --text-primary:   95% (본문)
  --text-label:     75% (카드·필드 라벨 · 기본 가시도 보장)
  --text-secondary: 55% (부연 설명)
  --text-muted:     35% (메타 · 타임스탬프)
  --text-faint:     20% (placeholder · 장식)

폰트:
  Display: Playfair Display (헤드라인 · 점수 · 등급)
  Body:    DM Sans (본문)
  Mono:    DM Mono (레이블 · 코드 · 태그)

자간 (Playfair Display 타이트닝 금지 · 세리프 뭉침 방지):
  Hero 초대형 (clamp 3.5~8rem): -1.5px 만 허용 · 그 이상 타이트 금지
  h2 4xl/5xl (2.25~3rem):       letter-spacing 미지정 (브라우저 기본)
  h1 3xl/4xl (1.875~2.25rem):   letter-spacing 미지정
  h2 2xl 이하 (≤1.5rem):         letter-spacing 미지정
  레거시 값 발견 시 리팩토링하며 -2px·-1.5px·-1px·-0.5px 모두 제거

타이틀 문장부호 (Heading punctuation):
  h1·h2·h3 등 타이틀 / headline / section heading / empty-state heading /
  dialog heading 에 **trailing period "." 사용 금지**. 한 문장 스타일의 타이틀이라도
  마침표 안 찍음. (예: "Earn your grade" ✓ · "Earn your grade." ✗)
  예외: 브랜드 wordmark "commit." (Hero gold-shimmer 및 logo 계열) — 도메인
  commit.show 의 시각적 연장으로 의도된 디자인이므로 유지.
  본문·subtitle·바디 카피는 문법적 마침표 허용 (단 한 줄짜리 강조 bold 헤딩은 제외).

Iconography (전체 페이지 공통 규칙 · 강제 사항):
  - 아이콘은 **inline SVG line icon** 만 사용 · `stroke="currentColor"` 로 CSS `color` 틴팅
  - **emoji 사용 원칙적 금지** (📊 🤖 🎁 🔗 🪄 🎓 🔒 등)
    · 버튼 라벨·지표·제목·장식 대부분의 위치에서 금지
    · 이유: OS 가 컬러로 강제 렌더해서 네이비/골드 단색 통제 불가 · 플랫폼별 렌더 편차 큼 · 디자인 톤 파괴
  - **박스/배경 타일 없이** 단색 인라인으로 · fixed width/height 에 background · border · rounded 배지 감싸지 말 것
  - 크기는 SVG `width`/`height`, 색은 `color`, 강조는 opacity
  - **예외: 아바타 타일** (프로필 이미지 / 이니셜) 은 identity carrier 이므로 박스 허용 · 이건 icon 이 아님
  - **예외: Forecast / Applaud CTA 버튼** (프로젝트 상세 페이지 상단·하단 한정) · 👏 박수 · 🎯 타겟 이모지 허용 · 이유: "감정 유도 액션" 이라 기능 아이콘과 차별화 필요 · 카나니컬 구현 [ApplaudButton.tsx variant='emoji'](src/components/ApplaudButton.tsx) · [ProjectActionFooter.tsx](src/components/ProjectActionFooter.tsx). 다른 위치에서 임의 사용 금지 — 이 두 CTA 만 예외.
  - **예외: Community Comment 입력 필드** · 감정 태그 프리셋 (🙌 🎯 🔥 🤔 💡) · §2 Community 에 별도 정의 · 사용자 입력 컨텐츠이지 UI 아이콘 아님
  - 좋은 예:
    ```tsx
    <svg viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         style={{ color: tone }} aria-hidden="true">
      <path d="M4 20V10" /> ...
    </svg>

    <span className="inline-flex items-center gap-1.5">
      <IconForecast size={12} /> FORECAST
    </span>
    ```
  - 나쁜 예 1 (emoji 지표): `<span>📊 Score</span>`
  - 나쁜 예 2 (emoji 버튼): `<button>🎯 FORECAST</button>`
  - 나쁜 예 3 (boxed): `<div style={{ width: 36, height: 36, background, border }}>...icon...</div>`
  - Canonical reference: [src/components/icons.tsx](src/components/icons.tsx) · Landing 의 `GRADE_ICONS` · GraduationStanding 의 tier 아이콘 (v2 · §6.2)
  - 새 아이콘 필요하면 **icons.tsx 에 먼저 추가**하고 import · 즉흥 emoji 삽입 금지

절대 금지:
  - Inter, Roboto, Arial (제네릭 폰트)
  - 보라색 그라디언트 on 흰 배경 (슬롭 패턴)
  - 둥근 버튼 (border-radius: 2px 유지)
  - **emoji 아이콘 사용 기본 금지** (지표·버튼 라벨·타이틀·장식 · icons.tsx SVG 로 교체) · 예외 2종은 Iconography 섹션 참조
  - 아이콘을 박스/타일/원형 배경 안에 감싸기 (위 Iconography 규칙 참조)
```

---

## 5. 현재 파일 구조

```
vibe/
├── src/
│   ├── components/
│   │   ├── Nav.tsx          # 네비게이션 (스크롤 시 배경 등장)
│   │   ├── Hero.tsx         # 히어로 (gold shimmer 타이포)
│   │   ├── SubmitForm.tsx   # 4단계 제출폼 + 분석 + 결과카드
│   │   └── ProjectFeed.tsx  # Supabase 실시간 피드
│   ├── lib/
│   │   ├── supabase.ts      # DB 클라이언트 + Project 타입
│   │   └── analysis.ts      # PageSpeed + GitHub + Claude 파이프라인
│   ├── App.tsx              # 전체 페이지 레이아웃
│   └── index.css            # 디자인 토큰 + 전역 스타일
├── supabase/
│   └── schema.sql           # DB 스키마 + RLS 정책 (Supabase에 실행 필요)
├── public/
│   ├── favicon.svg
│   └── hero-bg.webp         # 히어로 애니메이션 배경
├── wrangler.jsonc           # 잔존 Workers 설정 (실사용 X · Pages 로 이전됨)
├── CLAUDE.md                # 이 파일
├── .env                     # 로컬 환경변수 (gitignore됨)
├── .env.example             # 환경변수 템플릿
└── package.json
```

---

## 6. 점수 체계 (100점 · v3 calibration · 2026-04-27 확정)

> 공개 기술 문서: [/audit](https://commit.show/audit) — 사용자가 자기 점수 예측 가능.
> 내부 진실 소스: `supabase/functions/analyze-project/index.ts`.

### 6.1 종합 점수 = Audit 50 + Scout 30 + Community 20

**Audit pillar (52pt cap · v3.1 form-aware · 2026-04-28)** — v3 calibration 복귀 + form_factor 별 slot 의미 재해석. 슬롯 WEIGHT 는 모든 form 동일 (52pt 천장 통일), 슬롯 SEMANTICS 만 적응 — 로컬 CLI/library 가 URL 없다고 27pt 자동 깎이는 구조적 페널티 제거.

| 슬롯 (가중치) | App / web 형식 | Library/CLI/Scaffold 형식 |
|---|---|---|
| Lighthouse-equiv 20 | Perf 8 · A11y 5 · BP 4 · SEO 3 | Tests 8 · Docs 7 · TS-strict 3 · License 2 |
| Live-equiv 5 | HTTP 200 + SSL + <3000ms | npm published 4 + weekly dl ≥1k +1 |
| Completeness-equiv 2 | og · meta · favicon · apple-touch · … | releases ≥5 +1 · has_changelog +1 |
| Production Maturity 12 | tests · CI · observability · TS strict · lockfile · LICENSE · responsive (form 무관) |
| Source Hygiene 5 | github · monorepo · governance docs (form 무관) |
| Tech Diversity 3 | frontend+backend+DB +2 · AI +1 · Web3/MCP +1 cap 3 |
| Brief Integrity 5 | Phase 1 제출 시 5 · walk-on substitute 0-3 (live OK + README install/usage/depth) |

`form_factor` 감지: app · library · cli · scaffold · unknown. `app` 또는 `unknown` 은 web slot · 그 외는 lib slot 으로 평가.

```
Audit pillar (52pt hard cap · form-aware slot semantics):

  ── App / web form ──
  Lighthouse mobile         20  Performance 8 · A11y 5 · BP 4 · SEO 3
                                step buckets: Perf 90+=8 · 70-89=6 · 50-69=3 · <50=0
                                              A11y 90+=5 · 70-89=3 · <70=1
                                              BP   90+=4 · 70-89=2 · <70=0
                                              SEO  90+=3 · 70-89=2 · <70=0
                                not assessed → neutral midpoint
  Live URL Health            5  HTTP 200 + SSL + < 3000ms · 모두 만족 시 5, 아니면 0
  Completeness signals       2  10 신호 (og:image · twitter · manifest · apple-touch ·
                                theme-color · favicon · canonical · meta-desc 등)
                                round((filled/5)*2)

  ── Library / CLI / scaffold form (substituted) ──
  Lighthouse-equiv          20  Tests: 50+=8 · 10-49=6 · 1-9=3 · 0=0
                                Docs (cap 7): install +1 · usage +1 · ≥80 lines +2
                                              changelog +1 · contributing +1 · CoC +1
                                TS strict 3
                                LICENSE 2
  Live-equiv                 5  npm published 4 + weekly dl ≥1k +1
  Completeness-equiv         2  releases ≥5 +1 · has_changelog +1

  ── Common slots (form 무관) ──
  Production Maturity       12  tests 0-3 · CI +2 · observability +2 · TS strict +1 ·
                                lockfile +1 · LICENSE +1 · responsive 0-2
                                · App form: Polish×Maturity coupling factor 0.6+0.4×(maturity/10)
                                  scales LH+Live+Compl+Tech polish slots
                                · Non-app form: Polish×Maturity factor = 1.0 (polish IS maturity)
  Source Hygiene             5  github accessible 3 · monorepo +1 · governance docs +1
  Tech Layer Diversity       3  frontend+backend+DB +2 · AI layer +1 · Web3/MCP +1 (cap 3)
  Build Brief Integrity      5  Phase 1 · 3/3 → 5 · 2/3 → 3 · 1/3 → 1 · 0/3 → 0
                                walk-on track substitute (no Brief): up to 3 of 5
                                — live URL OK + README has Install AND Usage AND
                                ≥80 lines → 3 · 2 of those → 2 · 1 → 1 · else 0
                                (분모 50 정규화 · 52 hard - 2 unattainable brief pts)

Soft bonuses (cap +10 total · v3 elite tier added 2026-04-28):
  Ecosystem soft           +0-3 stars 100/1K/10K (cap 2) + contributors 50+ (1) +
                                npm dl 1K+ (1) + releases 5+ (1) — all to cap 3
  Activity soft            +0-2 recent commit ≤30d +1 · momentum (≥20 commits / last 100) +1
  Elite OSS soft           +0-5 production-scale triple threshold —
                                10K+ stars AND 1M+ weekly npm downloads AND 100+
                                contributors → 5. Any 2 of 3 → 2. Else 0.
                                Designed for the supabase / cal.com / shadcn-ui
                                tier so calibration ceiling reaches 90+.

Hard penalty (deterministic · pre-cap):
  env_committed             -5  paths 에 .env / .env.production 등 발견 시
                                (.env.example/.env.template 등은 제외)
                                보안 위반은 명백 — polish 로 상쇄 불가

Tier-1 evidence (수집만 · 슬롯 점수 영향 X · Claude prompt 에 evidence 로 surface):
  security_headers              CSP · HSTS · X-Frame · X-Content-Type · Referrer · Permissions
  legal_pages                   /privacy /terms 도달 가능성 (3+4 path variants probe)
  readme_depth_score            README line count + Install/Usage 섹션
  form_factor                   app · library · scaffold · unknown
  has_prefers_dark              CSS @media (prefers-color-scheme: dark)
  has_prefers_reduced_motion    CSS @media (prefers-reduced-motion)
  npm_downloads                 last-week downloads (libraries only)

Total cap: 52pt + 10 soft = 62. score_auto cap 65.

CLI walk-on score = score_auto / 50 × 100 (52 hard - 2 brief unattainable
                    · partial Brief substitute up to 3pt available).
League score      = Claude.score.current (qualitative bonuses + deductions adjusted).

엔진 모델: claude-sonnet-4-6 (사용자 노출 명칭 = "Audit" / "Audit report").

검증 baseline: 내부 reference set 5개 (supabase / shadcn-ui / cal.com /
vercel ai / vibe) 의 점수 분포로 calibration 검증. 정확한 점수는
`INTERNAL.md` §4 참조 (점수 gaming 방지 위해 비공개).

자세한 점수 산출 로직은 [/audit](https://commit.show/audit) (logged-in 회원 전용).
```

**Scout Forecast (30점 · 인간 평가)**

```
  - Vote 1장 = 1장 가치 (가중치 없음 · v1.7 확정)
  - 티어는 월 발급 장수만 차등:
      Bronze 20 · Silver 40 · Gold 60 · Platinum 80 votes/월
  - 한 프로젝트에 ×N 몰빵 허용 (확신 표현)
  - 자기 앱 Vote 금지 (이해충돌)
  - 누적 Vote 수 + 적중률로 30점 환산
```

**Community Signal (20점)**

```
  - 조회수 · 댓글 깊이 · 공유 · 재방문율 (품질 가중)
  - Applaud 는 여기 반응 신호로만 약하게 합산 (졸업 게이트 아님 · §7.5 참조)
  - 자기 콘텐츠 applaud/share/comment 제외 (§4 어뷰징 방어)
```

### 6.2 졸업 기준 — %-based 상대평가 (v2 변경 · §1-A ②)

**v1.8 의 절대 5-AND 게이트는 폐기**. 시즌 종료 시 리그 내 종합 점수 순위로 자동 상대평가.

| 등급           | 비율             | 자격                                      |
|----------------|------------------|-------------------------------------------|
| Valedictorian  | ≈0.5% (1명 고정) | 리그 내 종합 점수 1위                     |
| Honors         | 상위 5%          | Valedictorian 제외 · 점수 상위 5% 이내    |
| Graduate       | 상위 14.5%       | 상위 20% 중 위 두 등급 제외               |
| Rookie Circle  | 나머지 80%       | 자동 졸업 기준 미달 · 다음 Commit 대상    |

### 6.3 기본 자격 필터 (상위 20% 안에 들어도 어기면 Rookie Circle)

- Live URL HTTP 200 + SSL 정상 (production readiness 최소선)
- AI 자동 분석 시행 완료 (시즌 중 최소 2회 snapshot)
- 시즌 중 어뷰징 판정 없음 (§18.4)
- 시즌 중 Brief Core Intent 제출 완료

### 6.4 Applaud 는 졸업 점수 무영향

- 무제한 · 1 item = 1 applaud · 모든 user-generated content 대상 (§7.5)
- Community Signal 20% 의 "반응 존재 신호" 로만 약하게 반영
- 졸업 순위는 자동 + Scout + Community (Applaud 外) 합산으로 결정

---

## 7. 졸업 등급 · 혜택 · Applaud 정의

### 7.1 등급별 혜택 (졸업 기준은 §6.2 %-based)

비금전 혜택만 공개 — 환급률·상금 액수는 비공개 (INTERNAL.md §1).

```
Valedictorian  (≈0.5%, 1명 고정):
  Hall of Fame 영구 등재 · 미디어 10,000 노출 보장
  공식 @commitshow X 영상 게재
  홈 1주 피처드 · 특별 NFT
  Brief Phase 2 자동 공개

Honors  (상위 5%, Valedictorian 제외):
  Hall of Fame · 인증 배지 · 피처드 · NFT

Graduate  (상위 14.5% · 상위 20% 중 위 두 등급 제외):
  졸업 배지 · Build Brief 전체 공개 · MD 마켓 판매 자격

Rookie Circle  (나머지 80%):
  Audit report + Scout 판단 근거 코멘트 요약
  Brief 비공개 선택 가능 · 다음 Commit 재도전
  Rookie Circle 전용 커뮤니티 (Build Logs 에 "Try Again" 섹션)
  Alumni 와 별개 섹션으로 연결 (격려 톤)
```

### 7.2 Rookie Circle 톤 (§1-A ⑤ 재확인)

- **전 레이어 금지 어휘**: 낙제 · 실패 · 탈락 · 패자 · 루저 · Loser · Failed · 미달 · 미흡 · Fell short
- **허용 어휘**: Rookie Circle · Try Again · 다음 Commit · Retry · Next season · Keep building
- 범위: UI 카피 · 컴포넌트 라벨 · 에러/상태 메시지 · Supabase 에러 문구 · Claude API 프롬프트 · 이메일 템플릿 · 약관 · README
- Rookie Circle = "다음 Commit 을 향해 가는 동료 그룹" 포지션 · 낙오 라벨 아님

### 7.3 상금·환급 페이아웃 (§2 재확인)

- 결제: Stripe — 가격·장부 구조는 INTERNAL.md §1 참조
- 페이아웃 레일·세무 (W-9 / W-8) 등 비공개 — INTERNAL.md §1 참조
- 제재 대상 심사 등 컴플라이언스 절차 (세부는 INTERNAL.md §2)

### 7.4 Early Spotter (Scout 명예)

- 리그 진척률 20% 미만 시점(대략 Week 1)에 정답 근처로 Vote 한 Scout
- Activity Point +30 가산
- 프로필에 `Early Spotter Hit × N` 기록
- X 연동 시 공유 카드 자동 생성

### 7.5 Applaud 정의 (v2 변경 · §1-A ① · §1-A ③)

**무엇**: 무대에 보내는 보편 호감 신호. 1 item = 1 applaud 토글. 한 번 더 누르면 꺼진다.

**무거움·영향**
- 무게: 가벼움 (vs Vote 무거움)
- 졸업 점수 영향: **없음** — Community 20% 의 "반응 존재 신호" 로만 약하게 합산 (§6.1)
- 비용: 무제한 (월/일 한도 없음)
- Vote 권(티어별 20~80) 과 완전 별개 축

**대상 · polymorphic target**
```
applauds (member_id, target_type, target_id, created_at)
target_type ∈ {product, comment, build_log, stack, brief, recommit}
UNIQUE (member_id, target_type, target_id)   -- 1 item 1 applaud
```

| target_type | 의미                                           |
|-------------|------------------------------------------------|
| product     | 프로젝트 자체에 "이 무대에 박수"                  |
| comment     | 좋은 댓글 · 좋은 판단 근거에 박수                  |
| build_log   | Community Build Logs 게시물에 박수 (§13-B)        |
| stack       | Community Stack 카드에 박수 (§13-B)               |
| brief       | Core Intent / Phase 2 브리프에 박수                |
| recommit    | Week 2·3 재분석 시 Creator 변화 기록에 박수       |

**금지**
- 자기 콘텐츠 applaud 금지 (이해충돌 · DB 트리거로 강제)
- Vote 권·Point 차감 없음 (무료)

**AP 반영** (§12 Activity Point)
- 보낸 쪽: +0.1 AP/건 (아주 가벼움)
- 받은 쪽: +0.5 AP/건 (본인 콘텐츠가 박수 받음)

**어뷰징 방어** (§18)
- IP/ASN 클러스터 검사
- 코사인 유사 패턴 감지 → 영향력 0 처리
- 봇 의심 계정의 applaud 는 Community Signal 에서 제외

---

## 8. Creator 그레이드

```
Rookie        → 등록 1개+, 졸업 0
Builder       → 졸업 1개, 평균 60+
Maker         → 졸업 2개, 평균 70+
Architect     → 졸업 3개, 평균 75+, 기술 다양성
Vibe Engineer → 졸업 5개, 박수 20+, 평균 80+
Legend        → 졸업 10개+, 커뮤니티 영향력
```

### 8-A. Grade Recalculation at Analysis Completion

모든 `analysis_snapshots` INSERT 직후 자동 호출되는 서버 훅. Creator 가 새 결과·재분석·졸업 전환 직후 항상 최신 등급으로 동기화.

```
Trigger:  analysis_snapshots INSERT (initial · resubmit · weekly · season_end)
          -- v2: applaud 트리거 제거 (Applaud 는 재분석 트리거 아님 · §10-B)
Function: recalculate_creator_grade(creator_id) → members.grade UPDATE
Inputs:
  - projects WHERE creator_id AND status IN ('graduated','valedictorian','honors')
      → 졸업 카운트
  - AVG(snapshots.score_total) per graduated project (latest)
      → 평균 점수
  - DISTINCT tech_layers across graduated projects
      → 기술 다양성
  - applauds WHERE target_type='product'
                AND target_id IN (그 Creator 의 프로젝트)
      → 받은 박수 합계 (polymorphic · §7.5)
  - md_library WHERE creator_id AND verified_badge
      → Library 기여 (Architect+ 가산점)
Rules:
  - §8 테이블 그대로
  - MD Library 기여는 Architect → Vibe Engineer 승급 시
    "기술 다양성" 조건의 대체 증거로 인정
Output:
  - members.grade
  - members.grade_recalc_at timestamptz
  - 등급 변경 시 audit log (members_grade_history)
```

---

## 9. Scout 티어 (Activity Point 또는 Forecast 적중 · OR 조건)

```
Vote 가중치 없음. Vote 1장의 가치는 모든 티어 동일.
티어 차등은 ① 월 Vote 권 수량  ② 분석 선공개 시점  ③ 기타 명예 배지.
Applaud 가중치 없음 (v2 · §1-A ① · §7.5 토글로 단순화).

Bronze   → AP 0~499         (또는 승급 조건 미충족)
            월 20 votes
Silver   → AP 500~1,999     또는 Forecast 적중 30회+
            월 40 votes · 보안분석 12h 선공개
Gold     → AP 2,000~4,999   또는 Forecast 적중 120회+
            월 60 votes · 보안분석 24h 선공개 · Community Award 연동
Platinum → 상위 3% AP       또는 상위 3% Forecast 적중
            월 80 votes · 전체 분석 선공개 · 룰북 미리보기
            LinkedIn/X 공개 인증 · First Spotter 타이틀

* OR 조건: Forecast 실력자(정확도)도 승급 경로 확보.
  순수 활동량(AP)만으론 "묵묵히 적중시킨 Scout" 가 묻히는 문제 방지.

구현 상태:
  ✅ UI — ScoutsPage TierCell 에 threshold · monthly votes · analysis preview · extras 노출
  ⚠ v2 변경: TierCell 의 "Applaud weight" 표시 컬럼 제거 필요 (§1-A ①)
  ☐  DB — update_scout_tier() 트리거 현재 AP-only. OR 승급(Forecast 적중) 은
         votes.is_correct 집계가 필요하고 적중 판정은 졸업식 이후 project.score_total
         기준 사후 계산 → Season-end engine 에 포함 (크론 최후 구현 정책).
```

---

## 10. 분석 언락 트리 (Vote 누적)

Vote 가 쌓일수록 Audit 깊이가 확장. "정보가 드러날수록 Scout 가 더 의견을 낸다" 사이클.

```
등록 즉시  → GitHub 구조 · Lighthouse 4지표 · Brief 무결성 · Live URL
Vote 1~3  → 코드 품질 스냅샷 (복잡도 · 중복 패턴)
Vote 5    → 보안 레이어 (RLS · 환경변수 · API 인증) — Silver+ 선공개 12h
Vote 10   → 프로덕션 레디 체크 (CWV · 취약점)
Vote 20   → Scout 심층 코멘트 인터페이스 (Platinum+)
```

v2 주의: "Vote 10 = 졸업 필수 조건" 은 v1.8 에서 %-based 로 전환하며 **제거**.
Vote 10 은 이제 Platinum+ 선공개 해제 레벨 정도의 의미. 졸업 자격은 §6.2 참조.

---

## 10-B. Re-analysis Loop & Score History (PRD v1.3 신규 · Audition Loop)

크리에이터가 시즌 동안 수정·보완하고, Scout와 주고받으며 점수가 변동되는 오디션 루프.
단발 분석 → 시계열 스냅샷 체계로 전환.

### 트리거 4종 (v8 restore · applaud 재평가 제거)
```
initial       → 최초 등록 시 1회 (Edge Function이 snapshot INSERT)
resubmit      → Creator "Re-analyze" 버튼 · 24h cooldown · 시즌 중 무료
weekly        → 매주 월요일 Supabase Cron · 전 active 프로젝트 1회
season_end    → 졸업식 직전 최종 스냅샷 확정 (Day 28 23:59)
```

Applaud 는 재평가 트리거 아님 — §7.5 v2 polymorphic 토글로 상시 활성 · 졸업 점수 무영향.

### DB 구조
```
analysis_snapshots
  id · project_id · created_at · trigger_type · triggered_by
  score_auto · score_forecast · score_community · score_total
  axis_scores jsonb · lighthouse jsonb · github_signals jsonb
  rich_analysis jsonb
  parent_snapshot_id · delta_from_parent jsonb · score_total_delta int
  commit_sha · brief_sha         -- 분석 시점 Git HEAD/brief SHA (불변 증거)
  model_version                   -- 'claude-sonnet-4-6' 등 (현재 · 2026-04-27)

applauds (v2 재설계 · polymorphic · §7.5)
  id · member_id · target_type · target_id · created_at
  target_type ∈ {product, comment, build_log, stack, brief, recommit}
  UNIQUE (member_id, target_type, target_id)   -- 1 item 1 applaud
  -- v1.8 의 season_id / weight / scout_tier / verified_at 컬럼은 전부 제거
```

### 졸업 기준 (§6.2 참조 · %-based)
- v1.8 의 5-AND 게이트 (75점 2주 + auto 35 + 3 forecasts + Live URL) **폐기**
- 리그 내 상위 20% 자동 상대평가 (Valedictorian / Honors / Graduate)
- 기본 자격 필터: Live URL + 분석 2회 + 어뷰징 무 + Brief Core Intent
- Applaud 는 졸업 기준 영향 없음 (§7.5)

### 구현 Phase
- **V0.5 (완료):** analysis_snapshots · Edge Function snapshot INSERT · "Re-analyze" · cooldown
- **V1:** Scout dashboard · Growth chart · Weekly Cron · Build Log 자동 씨앗 (§13-B)
- **V1 끝:** season_end 상대평가 엔진 · Hall of Fame 자동 등재 (Cron 최후 구현)

---

## 11-NEW. Ladder + Events (시즌 통합 단일 시스템 · 2026-04-29 PRD v3 lock)

§11 (3-week season) 단독 구조 폐기. 모든 리그 단위는 **events** 의 한 row 로 통합 — `template_type='quarterly'` 가 시즌. 사용자에겐 "season" 단어 마케팅으로 유지 가능, 코드/스키마/문서는 events 일원화.

### 11-NEW.1 Ladder (Layer 1 · 영구)

모든 등록 프로젝트 자동 진입 · 카테고리 ranking + 시간 윈도우 · 영구 milestone.

#### 11-NEW.1.1 카테고리 분류 (hybrid)
- `business_category` enum: `saas · tool · ai_agent · game · library · other`
- Hybrid 정책:
  - 자동 detection (form_factor + tech_layers + AI lib 휴리스틱) → `detected_category` 컬럼
  - Creator 수동 선택 → `business_category` (override 가능, 일 1회 cap)
  - Lock 정책: event entry 시점에 freeze · event 종료 후 다시 변경 가능
- "Other" 함정 차단:
  - Other 선택 시 추가 설명 텍스트 필수
  - Detector confidence 높을 때 Other 선택 → admin review queue 자동 진입
  - UI 에서 "Misc / Experimental" 라벨 (정통 카테고리보다 시각 무게 ↓)

#### 11-NEW.1.2 시간 윈도우
- `today` · `week` · `month` · `all-time` 4종
- URL: `/ladder?cat=saas&window=week`
- 기본값: `cat=saas&window=week`

#### 11-NEW.1.3 정렬 + 5단 tiebreaker
```
1. score_total desc
2. commit_sha 의 가장 최근 commit 날짜 desc (실제 코드 변화)
3. score_auto desc (deterministic 부분 우선)
4. audit_count asc (적은 audit 으로 도달 = "효율" 시그널)
5. project.created_at asc (선등록 우대)
```
audit_count 가 핵심 — 무제한 re-audit 으로 운빨 점수 짜내는 어뷰징 자연 차단.

#### 11-NEW.1.4 Live ranking (audit 종료 즉시 · M3 tier 1)
audit 종료 trigger 안에서 atomic:
- `projects.score_total` UPDATE
- 해당 (category, window) ranking 1건 즉시 재계산
- `ladder_streaks` UPDATE (top_n 변동 시)
- `ladder_milestones` INSERT (UNIQUE 제약으로 이중 발급 차단)
- 본인 `/me` · `/projects/<own-id>` · audit result 페이지는 **실시간** (projects 직접 query)

#### 11-NEW.1.5 Materialized view (타인 view · M3 tier 2)
```
ladder_rankings_mv
  refresh: 5min (today/week) · 1h (month/all-time)
  cols: project_id · category · window · rank · score · last_audit_at
```
다른 사용자가 보는 leaderboard / 남의 profile / admin dashboard 는 mv (5분 지연 OK).

### 11-NEW.2 Streak + Milestone 배지

#### 11-NEW.2.1 Schema
```sql
ladder_streaks
  project_id · category · window
  current_streak_start · current_top_n · longest_streak_days · longest_top_n
  total_days_in_top_50 · last_calculated_at

ladder_milestones
  project_id · milestone_type · achieved_at
  milestone_type enum:
    'first_top_100' · 'first_top_10' · 'first_number_one'
    'streak_100_days' · 'climb_100_steps_in_30_days'
    'all_categories_top_50'
  UNIQUE (project_id, milestone_type)  -- 이중 발급 차단
```

#### 11-NEW.2.2 Streak 정의
- **3일 grace period**: Top 50 이탈 후 3일 이내 재진입 → streak 유지. 그 이상 → reset.
- 변경 시에만 update (저장 비용 0). 변동 없으면 row 그대로.
- 일별 cron 이 rank 변동 감지 시 trigger.

### 11-NEW.3 Events (Layer 2 · 단일 events 테이블)

#### 11-NEW.3.1 events schema
template_type 으로 6 종류 분기:
```
quarterly · tool_challenge · theme_sprint · quality_bar · sponsored_showcase · open_bounty
```

#### 11-NEW.3.2 6 템플릿 + 변수 surface
```
Quarterly (시즌 흡수)
  duration: 3 weeks (default)
  has_graduation: true · has_hall_of_fame: true
  graduation_tiers: [valedictorian · honors · graduate]
  graduation_threshold: top_20_percent
  scoring_method: audit + scout_vote + community_signal

Tool Challenge
  duration: 30 days (default)
  tool_filter: ['cursor' · 'claude-code' · 'lovable' · ...]
  has_graduation: false · winner_count: 3
  scoring_method: audit_only

Theme Sprint
  duration: 7 days (default)
  theme_md (markdown 주제 설명)
  scoring_method: audit + community_signal

Quality Bar
  min_score_threshold: 80 (default)
  vibe_concerns_required: [webhook_idempotency · rls_coverage · ...]
  scoring_method: audit_only · 자동 검증

Sponsored Showcase
  sponsor_name · sponsor_logo_url · prize_pool
  eligible_categories · entry_criteria
  has_hall_of_fame: false (default · admin 승인 필요 · §11-NEW.7.4)
  scoring_method: audit + scout_vote

Open Bounty (§11-NEW.6 별도)
  bounty_md · acceptance_criteria · reward_amount · first_to_solve
  bounty_funded_by: commit_show / sponsor_direct / credits
  verification_method: auto / manual_admin / sponsor_review / community_vote
```

#### 11-NEW.3.3 3-tier entry 시스템
| Tier | 누가 | 효과 |
|---|---|---|
| **Ladder** | 모든 등록 프로젝트 (자동) | 카테고리 ranking |
| **Eligible** | event 매칭 자동 후보 (자동) | 알림만 · ranking/우승 후보 X |
| **Entered** | Creator 명시 클릭 | 정식 참가 · ranking + 우승 후보 |

손해 시나리오 (sponsor 풀이 작아짐) 차단 + privacy 보존.

#### 11-NEW.3.4 Eligibility 알림 정책
```
event_notifications jsonb {
  in_app: 'all' | 'sponsored_only' | 'none'    -- 기본값 all
  email:  'all' | 'sponsored_only' | 'none'    -- 기본값 sponsored_only
  push:   'all' | 'sponsored_only' | 'none'    -- 기본값 none (V1.5)
}
milestone_notifications jsonb (같은 구조 · 별도)
weekly_digest boolean (기본 true)
```

#### 11-NEW.3.5 Single-snapshot freeze + UI hierarchy
- entry 시점의 `frozen_snapshot_id` 박음 · 종료까지 변경 불가
- "freeze 는 freeze, 다음 이벤트 노려" — 비교 가능성 > 개별 유연성
- UI: Live ladder = 골드 (큰 영역), Frozen = 은색/회색 (보조 카드), "locked Apr 22" 시간 표시

#### 11-NEW.3.6 종료 + 우승자
- `status: live → closed` (자동 · ends_at 도달)
- scoring_method 따라 평가 → 결과 freeze
- 영구 배지 자동 부여 + X 자동 공유 카드

### 11-NEW.4 Scout in ladder vs events

#### 11-NEW.4.1 Ladder 점수
**Audit 70% + Community 30%** (Scout 30% 없음). Ladder 는 "자동 평가" 무대.

#### 11-NEW.4.2 Event scoring_method 옵션
```
audit_only             — Quality Bar · Tool Challenge · Open Bounty (auto verify)
audit + scout_vote     — Quarterly · Sponsored Showcase
audit + community_signal — Theme Sprint
audit + scout + community — Quarterly default (전통적 100pt 분배)
```

#### 11-NEW.4.3 Scout ballot wallet
- 월별 quota (Bronze 20 · Silver 40 · Gold 60 · Platinum 80)
- 각 이벤트마다 별도 할당 (한 이벤트에 몰빵 허용 · ×N)

#### 11-NEW.4.4 Scout 적중률
- event 종료 후 `votes.is_correct` 산정
- 적중률 → AP + Scout tier 승급 (§9 기존 정책 유지)

### 11-NEW.5 Quarterly 템플릿 디테일 (시즌 흡수)

#### 11-NEW.5.1 기본 attribute
```
duration: 3 weeks
has_graduation: true · has_hall_of_fame: true
graduation_tiers: [valedictorian · honors · graduate · rookie_circle]
graduation_threshold: top_20_percent
scoring_method: audit + scout_vote + community_signal (100pt 전통적)
```

#### 11-NEW.5.2 Hall of Fame 시즌별 계층화
- "Hall of Fame · Spring 2026" 처럼 cohort 별
- Quarterly 우승자 자동 등재 (1년 4명 페이스)
- 인플레이션 방지 + 정서적 무게 보존 (Olympic gold 메타포)

#### 11-NEW.5.3 기존 §11 메커니즘 보존
- Week 1 수치 숨김 · Week 2 percentile reveal · Week 3 구체 수치
- Day 22-28 graduation week · Day 29 graduation day
- 환급 정책 (INTERNAL.md §1) · Build Log 자동 씨앗

### 11-NEW.6 Open Bounty 정책

#### 11-NEW.6.1 Funding (V1)
```
bounty_funded_by enum:
  'commit_show'    — Hans 부담 · 내부 promotion 용 · 작은 bounty
  'sponsor_direct' — sponsor → winner 직접 송금 · commit.show 매개 X
  'credits'        — commit.show internal credit · 다음 audit · promo 코드 등 (V1 추가)
```
Escrow (Stripe 매개) 는 V2 (KYC + tax 인프라 같이).

#### 11-NEW.6.2 Verification method
```
verification_method enum:
  'auto'           — detector 가 7 framework 자동 검증 (예: webhook idempotency)
  'manual_admin'   — Hans 가 직접 검증
  'sponsor_review' — sponsor 가 직접 검증
  'community_vote' — Scout 들이 vote (Quality Bar 와 유사)
```
각 bounty 마다 명시 필수.

#### 11-NEW.6.3 acceptance_criteria · first_to_solve
- text[] 명시
- first_to_solve: true → 선착순 1명만 / false → 충족자 전부

### 11-NEW.7 Admin 운영 (/admin/events)

#### 11-NEW.7.1 Template 별 cookie-cutter form
- Step 1: Template 선택 (6 카드 grid)
- Step 2: Template 별 변수 form · 기본값 prefilled
- Step 3: Preview (사용자가 보게 될 이벤트 페이지)
- Step 4: Publish (status: draft → live)

#### 11-NEW.7.2 진행 모니터링 dashboard
- 진행 중 events 의 entry 수 · participant rank · 분쟁 신호

#### 11-NEW.7.3 결과 freeze + 우승 발표 + X 카드
- ends_at 도달 → status flip cron
- 우승자 결정 (scoring_method) → 결과 freeze
- X 자동 공유 카드 (winner + sponsor 로고 · 30초 지연 OK · 별도 worker)

#### 11-NEW.7.4 Sponsored has_hall_of_fame 승인 게이트
- Sponsored event 의 sponsor 가 has_hall_of_fame 요청 시 Hans 명시 승인 필요
- Hall of Fame 의 commit.show 정체성과 일치하는 경우만 (큰 sponsor 1회성 OK · 작은 sponsor X)

### 11-NEW.8 Migration · seasons → events

#### 11-NEW.8.1 Migration A (now)
- events 테이블 생성 (seasons 의 superset)
- INSERT INTO events SELECT FROM seasons (id 보존 · template_type='quarterly')
- FK 컬럼들 rename: season_id → event_id (analysis_snapshots · votes · hall_of_fame 등)
- 코드 PR 동시 deploy (`from('seasons')` → `from('events').eq('template_type','quarterly')`)

#### 11-NEW.8.2 Migration B (1주 모니터링 후)
- seasons 테이블 DROP
- 별도 migration 으로 분리 · 문제 시 rollback 가능

### 11-NEW.9 Phasing (6 단계)
```
P1 (1.5w) · 영구 ladder + 카테고리 + tiebreaker + Live ranking + MV
P2 (1w)   · streak/milestone + 배지 발급 (3일 grace · UNIQUE 제약)
P3 (1.5w) · Quality Bar 단일 템플릿 (자동 검증 · 가장 단순)
P4 (1.5w) · Tool Challenge + Theme Sprint (수동 평가 추가)
P5 (1.5w) · Sponsored Showcase + Open Bounty (외부 연동)
P6 (1w)   · Quarterly 흡수 (가장 무거움 · 마지막 · 다른 5 운영 경험 후)
```

P1 은 §11-NEW.1 + §11-NEW.2 minimal viable. P6 가 §11-NEW.5 (시즌 흡수) — 가장 늦게.

---

## 12. Build Brief 구조

```
Phase 1 (시즌 중 공개):
  - 해결하는 문제
  - 핵심 기능 1~3가지
  - 사용한 AI 도구
  - 타겟 유저

Phase 2 (졸업 후 공개 — v2 구조화 프롬프트):
  ① Stack Fingerprint: RUNTIME/FRONTEND/BACKEND/DB/INFRA/AI_LAYER 형식 강제
  ② Failure Log: AI가 3회+ 틀린 순간 2가지 (증상·원인·해결·재발방지)
  ③ Decision Archaeology: "A 대신 B 선택" 2가지
  ④ AI Delegation Map: 영역별 AI vs 본인 비중 (6개 영역 이상)
  ⑤ Live Proof: 배포 URL · GitHub · API · 컨트랙트 주소
  ⑥ Next Blocker: 다음 장벽 + AI에게 시킬 첫 번째 작업
```

---

## 13. DB 핵심 테이블 (v2)

### 13.1 리그·Creator·Scout 코어

```sql
members             -- 회원 (tier · activity_points · creator_grade · x_handle · github_handle · trust_level)
                       auth.users 트리거로 자동 생성
                       · event_notifications jsonb · milestone_notifications jsonb (§11-NEW.3.4)
events              -- v3 신규 · seasons 흡수 · 모든 리그 단위
                       · template_type ∈ {quarterly · tool_challenge · theme_sprint ·
                                          quality_bar · sponsored_showcase · open_bounty}
                       · status ∈ {draft · live · closed · frozen}
                       · has_graduation · has_hall_of_fame · graduation_tiers jsonb
                       · sponsor_name · sponsor_logo_url · prize_pool
                       · bounty_funded_by · verification_method · acceptance_criteria
                       · created_by · created_at
event_entries       -- v3 신규 · 3-tier entry (§11-NEW.3.3)
                       · project_id · event_id · entry_status (eligible|entered)
                       · frozen_snapshot_id · entered_at
projects            -- 앱 등록 · 최신 점수/상태 (denormalized latest)
                       · business_category · detected_category · category_locked_until
build_briefs        -- Phase 1 (공개) + Phase 2 (v1.2 구조화 6섹션)
analysis_snapshots  -- 모든 분석 시점 시계열 (initial · resubmit · weekly · season_end)
                       · commit_sha · brief_sha · model_version (불변 증거)
                       · event_id (was season_id · §11-NEW.8 rename)
ballot_wallets      -- 월별 Vote 권 지갑 (member_id · month · total · used · reserved)
                       · event_allocations jsonb (이벤트별 할당 · §11-NEW.4.3)
votes               -- Scout Forecast (member_id · project_id · count · event_id)
                       · ×N 몰빵 허용 · 가중치 없음 · 자기 앱 금지
applauds            -- polymorphic (member_id · target_type · target_id)
                       · target_type ∈ {product, comment, build_log, stack, brief, recommit}
                       · UNIQUE (member_id, target_type, target_id)
                       · 자기 콘텐츠 금지 (DB 트리거)
comments            -- 댓글 (member_id · project_id · parent_id · text · upvote_count · simhash)
comment_upvotes     -- 댓글 업보트 (comment_id · member_id · UNIQUE)
hall_of_fame        -- 영구 아카이브 · event_id (시즌별 계층화 · §11-NEW.5.2)
members_grade_history -- Creator grade 변경 audit log

ladder_rankings_mv  -- v3 신규 · Materialized view (§11-NEW.1.5)
                       · refresh: 5min (today/week) · 1h (month/all-time)
                       · cols: project_id · category · window · rank · score · last_audit_at
                       · PK: (category, window, rank)
ladder_streaks      -- v3 신규 · streak 추적 (§11-NEW.2.1)
                       · project_id · category · window
                       · current_streak_start · current_top_n
                       · longest_streak_days · longest_top_n
                       · total_days_in_top_50 · last_calculated_at
                       · 변경 시에만 update (저장 비용 0)
ladder_milestones   -- v3 신규 · 영구 milestone 발급 기록 (§11-NEW.2.1)
                       · project_id · milestone_type · achieved_at
                       · milestone_type ∈ {first_top_100 · first_top_10 · first_number_one ·
                                           streak_100_days · climb_100_steps_in_30_days ·
                                           all_categories_top_50}
                       · UNIQUE (project_id, milestone_type)  -- 이중 발급 차단
```

### 13.2 Activity Point · 정산

```sql
activity_point_ledger  -- v2 명칭 통일 (기존 ap_events) · AP 이벤트 로그 12차원
                          (forecast · early_spotter · applaud_sent · applaud_received ·
                           build_log · stack · ask · office_hours · comment · creator · x_mention · brief)
awards_ledger          -- v2 신규 · Community Award + 상금 + 환급 통합 정산
                          (member_id · month · tier · type · amount · vendor · vendor_ref · paid_at)
                          vendor ∈ {internal, wise, trolley, tremendous, stripe_refund}
x_mentions             -- v2 신규 · X 에서 @commitshow · #commitshow 감지 기록
                          (member_id · tweet_id · mentioned_at · points_granted)
```

### 13.3 Creator Community (§13-B 참조)

```sql
community_posts        -- v2 신규 · Build Logs · Stacks · Asks · Office Hours 통합
                          (author_id · type · subtype · title · tldr · body · tags jsonb ·
                           linked_project_id · status · published_at)
                          type ∈ {build_log, stack, ask, office_hours}
post_tags              -- v2 신규 · 태그 인덱스 (post_id · tag)
                          tag ∈ {frontend, backend, ai-tool, saas, agents, rag, design, devops, …}
office_hours_events    -- v2 신규 · Office Hours 메타
                          (host_id · scheduled_at · format · attendees · recording_url · summary_post_id)
```

### 13.4 MD Library (§15)

```sql
md_library             -- MD 아티팩트 (target_format · target_tools · variables · bundle_files · stack_tags)
md_purchases           -- 구매 내역 · 80/20 분배
md_discoveries         -- 프로젝트 repo 자동 스캔 후보
artifact_applications  -- Apply-to-my-repo PR 기록
```

전체 스키마: `supabase/schema.sql` 참조. **v2 delta 는 별도 migration 파일로** (§20 TODO).

---

## 13-B. Creator Community — 4 메뉴 (V1 Day 1 필수)

### 13-B.1 존재 이유

리그는 3주 단위 무대 — 등록·졸업 사이클로만 돌면 **리그 휴식기에 활동 공간이 빈다**. 사용자가 Reddit · Indie Hackers · Discord 로 이탈하면 그곳에서 발견되는 가치가 외부에 쌓인다. commit.show 내부에서 재현해야 **진짜 생태계**가 된다.

또한 Creator 신뢰도는 **league 결과 + community 기여** 두 축으로 쌓여야 LinkedIn-for-Vibecoders 방향 (§15 장기) 진입이 가능.

### 13-B.2 4 메뉴 구성

```
[ Live (league) ]   [ Build Logs ]   [ Stacks ]   [ Asks ]   [ Office Hours ]
```

| 메뉴             | 정체성                       | 핵심 사용 케이스 |
|------------------|------------------------------|-----------------|
| **Build Logs**   | 빌딩 여정 아카이브           | "I built X over Y weeks. Here's the trail." |
| **Stacks**       | 재사용 가능한 기술 자산      | 스택 레시피 · 프롬프트 라이브러리 · 툴 비교 리뷰 |
| **Asks**         | 가벼운 게시판 (Q&A + 분류 관계) | `#looking-for` · `#available` · `#feedback` |
| **Office Hours** | 이벤트성·라이브성            | Alumni AMA · Tool maker 게스트 · Pair Building |

### 13-B.3 Build Logs 세부

- **자동 씨앗** (V1 must-have): 졸업 확정 시 Recommit Note + AI eval 변화 + Brief Phase 2 를 합쳐 Build Log **초안 자동 생성** → Creator 는 편집·다듬기·게시 (3-tap)
- 게시 시 "Verified by League" 배지 자동 (실제 졸업 project 기반 = 진짜 있음 증거)
- 일반 Build Log 도 가능 (태그 X 아무나 · WIP 플래그 지원)
- 포맷: TITLE · TL;DR · Body(Markdown/code/screenshot) · Tags · Linked project

### 13-B.4 Stacks 세부

- **3 서브 포맷**:
  1. Stack Recipe — 도구 조합 ("Cursor + Supabase + Vercel for SaaS MVP under $20/mo")
  2. Prompt Card — 잘 동작한 프롬프트 + 결과 + 재현법
  3. Tool Review — 최신성 평가 (6개월 지나면 "may be outdated" 자동 배지)
- MD Library 와의 연결 (V1.5+): 무료 Stack 글이 다듬어지면 **유료 MD 로 승격** ("Promote to MD")
- Recommit Note → Stack 자동 추천 (Creator recommit 시 "이번엔 이 프롬프트" 메모 → "Stack 카드로 게시할래?" 제안)

### 13-B.5 Asks 세부

- 3 서브타입: `#looking-for` (모집) · `#available` (제공) · `#feedback` (검증)
- 제목 60자 제한 · 만료 30일 · 응답 받은 후 "resolved" 마킹
- (V1.5) Asks 매칭되면 다음 시즌 등록 시 "공동 Creator" 모드 자동 활성

### 13-B.6 Office Hours 세부

- 3 포맷: Alumni AMA · Tool Maker Session · Pair Building
- V1 시작 기반: **Discord voice chat + 빔** (X Space 연동은 V1.5+)
- 종료 후 녹화·요약 자동으로 Build Logs 에 게시 (cross-link)

### 13-B.7 League ↔ Community 연결 5 메커니즘

| 흐름                          | 동작                                                                  | 버전 |
|-------------------------------|-----------------------------------------------------------------------|------|
| 졸업 → Build Log 자동 씨앗   | Graduation Week 에 자동 초안 생성 + Creator 편집 게시                  | V1   |
| Recommit Note → Stack 추천   | Creator recommit 시 "이번 프롬프트" 메모 → Stack 게시 제안              | V1   |
| Comment → Build Log 확장     | 댓글 글이 50+ 박수 받으면 작성자에게 "Build Log 으로 확장할래?" 제안    | V1   |
| Asks 매칭 → 공동 Creator     | co-builder 매칭 후 다음 리그 등록 시 공동 Creator 모드 자동 활성        | V1.5 |
| Office Hours → 자연 멘토링   | Alumni 호스트 · Rookie/Maker 청중 → 다음 시즌 친분 형성                | V1   |

### 13-B.8 게이트·모더레이션

| 행위                      | 조건                              |
|---------------------------|-----------------------------------|
| 읽기                      | 공개 (비로그인도 가능 · SEO)       |
| Applaud · Save            | 로그인 필요                        |
| 게시 (Build Log · Stack · Ask) | 회원 가입 즉시 가능             |
| Office Hours 호스팅       | Creator status (1+ commit) + Builder+ 등급 |
| Build Log 피처드 신청     | Maker+ 등급                        |
| Stack → MD 승격           | Builder+ 등급 (V1.5+)              |

모더레이션: 알고리즘 우선. Mod 경찰 톤 X. SimHash · 4층 어뷰징 검증 (§18) 동일 적용. 신고 → Gold+ Scout 3인 자동 배석.

### 13-B.9 AP 반영 (§12 에 통합)

```
Build Log 게시         → +20 AP (월 5건 상한)
Stack 게시             → +15 AP (월 5건 상한)
Asks 게시              → +5 AP  (월 10건 상한)
Office Hours 호스트     → +50 AP/회
Office Hours 참석      → +5 AP  (월 10회 상한)
Build Log/Stack 박수 받음 → 0.5 AP/applaud (§7.5)
```

### 13-B.10 V1 구현 우선순위

**V1 Day 1 필수**
- Build Logs 게시·읽기·박수·댓글 (자동 씨앗 포함)
- Stacks 게시·읽기 (Stack Recipe + Prompt Card 2 포맷)
- Asks 3 서브타입 (`#looking-for` · `#available` · `#feedback`)
- 태그 시스템 8 기본 (frontend · backend · ai-tool · saas · agents · rag · design · devops)
- Creator 프로필에 Community 피드 통합 노출

**V1 1개월 내**
- Office Hours (Discord voice · 주 1회)
- Weekly Picks 휴리스틱 (편집팀 + Alumni)
- Tool Review 포맷 추가

**V1.5+**
- X Space 연동
- Stack → MD 승격 funnel
- Asks 매칭 → 공동 Creator 모드
- AI 티 나는 게시물 필터

---

## 14. 수익 구조

> **민감 정보 — 공개 비공개 처리 (2026-04-28).** 가격 · 환불 비율 · 페이아웃 레일 ·
> 장부 분리 · 부가 수익 계획 등은 **`INTERNAL.md` §1** 참조 (gitignored).

요약 (공개 가능 부분만):
- 등록비 영구 3회 무료, 4번째부터 유료
- 졸업 등급별 환급 차등 (§7 참조)
- 수석 상금 + 부가 수익 (Library 수수료 · 스폰서십 · 구인 마켓) 은 V1.5+ 단계적 도입

---

## 15. Artifact Library (PRD v2 · Intent-first · GitHub Trending UX)

> **v2 업데이트 (2026-04-24)**: **Intent 축을 1차**로 전환. 사용자가 마켓을 찾는 실제 멘탈 모델은
> "뭐 만들지 / 뭐 붙이지 / AI 튜닝하지 / 시작하지" 이지 "어느 포맷 찾지" 가 아님 — 포맷(MCP · IDE
> Rules · Skill 등) 은 2차 필터로 내림. UI 레이아웃도 grid → **GitHub Trending 형 리스트**로
> 전환 (시간 축 Today/Week/Month/All · 밀도 우선 · 우측 핵심 액션 1~2개). 용어는 유지 —
> "Artifact Library · Artifact" 그대로.
>
> **v1.8 업데이트 (2026-04-21)**: 품질 신호를 **파일 자동검사(Claude 4축 rubric)** → **커뮤니티 신호**
> (Creator 등급 + 다운로드 + Adoption + 졸업 provenance) 로 전환. 4축 스코어링은 내부 advisory
> 로만 유지, 유료 허용·랭킹 어느 쪽도 gate 하지 않음. 랭킹은 `reputation_score` 합성치로 결정.
>
> **v1.7 배경 (2026-04-20)**: v1.6 free-only pivot 을 롤백, 유료 판매 복귀 (Creator 80 / 플랫폼 20 ·
> Stripe) + Trophy 자산 (Provenance · Adoption stats · Apply-to-my-repo) 병존.

### 15.0 포지셔닝

```
commit.show Artifact Library ≠ "또 하나의 공짜 마켓"
commit.show Artifact Library = "졸업 증거 + 커뮤니티 신호 기반 · Intent-first 로 검색 · 추적
                                가능한 바이브코딩 아티팩트 생태계 (무료+유료 공존)"

경쟁: Cursor Directory · awesome-cursorrules · GitHub gists · gstack · PromptingGuide
    → 무료지만 익명 · 적용·졸업 추적 없음 · 자동 점수만 있는 게이트키퍼형 · 포맷 중심 구조
우리 moat 6종:
  - Graduation provenance ("score 82 로 졸업한 프로젝트가 실제 쓴 rules")
  - Auto-discovery (크리에이터가 몰랐던 가치도 자동 발굴 · 경쟁자 없음)
  - Apply-to-my-repo · one-click PR (최대 moat · 경쟁자 아무도 없음)
  - Adoption trophy ("내 artifact 가 12개 프로젝트에 적용되었고 3개가 졸업")
  - **Intent-first UX** (v2 · "지금 뭐 하려고 해?" 검색 · 포맷 아닌 목적으로 진입)
  - Social-signal reputation (등급 + 다운로드 + Adoption 합성 랭킹 · v1.8 pivot)
    ↳ 유료 허용은 Creator 등급만 gate (파일 검사 X) · 품질 시그널은 커뮤니티 사용량
```

### 15.1 Intent · 1차 축 (v2 · 사용자 멘탈 모델)

사용자는 마켓을 열 때 **"뭘 하고 싶어"** 로 검색함. 4개 상위 Intent 로 모든 artifact 분류.
최상단 chip strip 에 노출. DB 에 `md_library.intent text` 컬럼 추가 (V2 migration).

| Intent | 사용자 한 줄 | 주로 어떤 artifact 가 여기 들어오나 | 예시 |
|---|---|---|---|
| **Build a feature** | "서비스에 기능 하나 더 붙이자" | Patch Recipe · MCP Config · Project Rules · Prompt Pack | Stripe + Supabase 결제 · RAG 검색 · 이메일 발송 · 대시보드 |
| **Connect a service** | "외부 서비스 물려서 바로 써보자" | MCP Config · Patch Recipe | Slack / Linear / Notion / GitHub / Google Drive MCP · Webhook recipe |
| **Tune your coding AI** | "Cursor/Claude 더 잘 돌려야지" | IDE Rules · Agent Skills · Project Rules · Prompt Pack | `.cursorrules` · Claude Skill · CLAUDE.md template · code-review 프롬프트 세트 |
| **Start a project** | "새 프로젝트 scaffold 부터 얹자" | Scaffold / BKit · Project Rules · 번들 | React SaaS Starter · Next+Supabase 템플릿 · Vibe Starter Kit |

**폴백**: Intent 분류가 모호한 경우 Discovery 는 기본값 `build_feature` 로 태그하고 Creator
가 publish 시 확인·변경. 기본값 1개보다 빈칸이 sort 를 망가뜨리므로 `not null` 강제.

### 15.1.5 Format · 2차 축 (tool target 기준 · 필터)

1차 Intent 를 고른 뒤 **툴/적용 난이도** 로 좁히고 싶을 때 사이드 필터. GitHub Trending 의
"Language" 필터 위치에 상응. v1.8 의 7 포맷 그대로 유지.

| 순위 | Format | 포함되는 것 | Target tools | 즉시 적용 난이도 |
|---|---|---|---|---|
| 1 | **MCP Config** | `mcp.json` · `.mcp/*` · `claude_desktop_config.json` · service connectors | Claude Desktop · Cursor · Windsurf · Cline | 70% 자동 (API 키 수동) |
| 2 | **IDE Rules** | `.cursorrules` · `.cursor/rules/*.mdc` · `.windsurfrules` · `.continuerules` · VSCode snippets | Cursor · Windsurf · Continue · Cline | Drop-in |
| 3 | **Agent Skills** | `.claude/skills/<name>/SKILL.md` + 보조 스크립트 · 디렉토리 번들 | Claude Agent SDK (ADK) · `~/.claude/skills/` | 1-step unzip |
| 4 | **Project Rules** | `CLAUDE.md` · `AGENTS.md` · `RULES.md` (with `{{VARIABLES}}`) | 툴-agnostic · ADK-first | Drop-in + var 치환 |
| 5 | **Prompt Pack** | copy-paste 프롬프트 모음 · 5개 미만 금지 | Universal | Trivial |
| 6 | **Scaffold / BKit** | Forkable runnable starter repo (V1.5) | Universal git hosting | Fork → install → run |
| — | **Patch Recipe** | 특정 integration ("Stripe + Supabase 연결") multi-file | 혼합 | 복합 |

**3차 축 · Domain tags** (필터용): auth · payment · db · ai · web3 · observability · infra · testing · etc.

### 15.1.9 시간 축 · 시간대별 트렌딩 (v2 · GitHub Trending 직영향)

정렬 드롭다운 위치에 **Today / This week / This month / All time** 토글. 각 시간 윈도우
내 `md_library_feed.reputation_score` 기준 정렬. 디폴트는 "This week" (GitHub Trending 기본).

내부 구현: `md_library_feed` 뷰에 `downloads_week`, `applications_week` 등 윈도우별 집계
컬럼 추가 (P9b migration 에 포함).

### 15.2 Publish 정책 · Free-default + 등급별 상한 (v1.8 social-signal)

```
Free-default: 누구나 $0 publish 가능 · UI 기본값 $0.
유료: 가격 입력 시 자동 Paid · Creator 등급이 허용 범위를 결정 (파일 검사 없음).

| Tier           | 가격      | 조건 (등급만 · 파일 품질 gate 없음)                                                |
| Free (default) | $0        | 모든 Creator (Rookie 포함) · 다운로드당 AP 적립 · Adoption trophy 누적            |
| Basic Paid     | $1-30     | Creator ≥ Builder (1 graduated) · Format ≠ prompt_pack                           |
| Premium        | $30-100   | Creator ≥ Maker (2 graduated)                                                    |
| Scaffold/BKit  | $100-500  | Creator ≥ Architect (3 graduated) · support commit · V1.5 워크플로우             |
```

**항상 무료 (판매 금지)**:
- Prompt pack (commoditized) · Rookie 의 모든 publish

**DB 트리거 강제** (`enforce_md_library_rules` · v1.8 반영):
```
price_cents > 0 AND creator_grade = 'Rookie'                → EXCEPTION
price_cents > 0 AND target_format = 'prompt_pack'           → EXCEPTION
price_cents > 2999 AND creator_grade NOT IN ('Maker'+)      → EXCEPTION
price_cents > 9999 AND creator_grade NOT IN ('Architect'+)  → EXCEPTION

(v1.7 에 존재하던 discovery_total_score < 16 gate 는 v1.8 에서 제거 ·
 파일 검사는 랭킹·유료 어느 쪽도 gate 하지 않음.)
```

**UI · DiscoveryPanel Publish Dialog (v1.8)**:
- 단일 `$` 가격 입력 · default `0` → Free, 양수 → Paid
- Rookie/Builder/Maker/Architect 에 맞춘 실시간 상한 힌트 문구
- 4축 ScoreLine 카드 제거 (내부 advisory 이므로 UI 노출 안 함)

### 15.3 수익 + Trophy 이중 보상

```
[유료 판매 시 크리에이터 수익]:
  판매액의 80% · 플랫폼 20%
  결제: Stripe (카드 + Apple Pay + Google Pay)
  페이아웃: Wise Business (1사분) / Trolley (2사분)
  최저가: $1 (price_cents = 0 OR >= 100)

[무료 아티팩트 AP 보상 · Trophy 축]:
  다운로드 1건          → +2 AP
  Apply-to-my-repo 1건  → +5 AP + artifact_applications 기록
  적용 프로젝트 졸업 시 → +25 AP · "graduated with this" 카운트 공개

[공통 Trophy 지표 (무료·유료 모두 surface)]:
  Library 카드·상세·프로필에 3개 카운트 표시:
    · projects_applied_count  (PR 열린 수)
    · projects_graduated_count (적용 중 졸업까지 간 수)
    · downloads_count          (다운로드 누적)
  = 수익 없더라도 공개 트로피로 기능 · 수익 있는 아티팩트는 이중 가치
```

**Reputation Score · 랭킹 합성치 (v1.8 신규)**

`md_library_feed` view 가 아래 공식으로 합성 컬럼을 계산하고, 기본 정렬 키로 사용.
LibraryPage 기본 정렬 = "Reputation" (파일 검사 대신 사람/사용 신호로 순위 결정).

```
reputation_score =
    grade_weight
      ( Legend 60 · Vibe Engineer 40 · Architect 25 · Maker 15 · Builder 8 · Rookie 0 )
  + projects_graduated_count × 5
  + projects_applied_count   × 2
  + downloads_count          × 1
  + (verified_badge ? 10 : 0)
```

가중 의미:
- **Grade weight** = "Creator 의 축적된 증거" · 한 번 올라간 등급은 쉽게 안 떨어지므로 안정 시그널
- **graduated × 5** = "내 아티팩트로 실제 졸업까지 간 프로젝트" · 가장 귀한 증거
- **applied × 2**   = "내 아티팩트를 본인 repo 에 PR 로 적용" · 의향 시그널
- **downloads × 1** = "다운로드" · 가장 약한 단일 시그널이지만 수량으로 존재감 표현
- **verified +10**  = "졸업 Creator 가 올린 아티팩트" · provenance 가점

### 15.4 Discovery 자동 발굴 · Format별 스캔 확장

기존 MD-only 스캐너를 **Format 별 패턴** 으로 확장. `discover-mds` Edge Function 을
`discover-artifacts` 로 리네이밍하고 각 format 별 디렉토리/파일 구조 인식.

**스캔 범위 (Format 별)**

| Format | 파일 패턴 |
|---|---|
| MCP Config | `**/mcp.json` · `**/.mcp/*.json` · `**/claude_desktop_config.json` · `**/mcp-servers/**/*.json` |
| IDE Rules | `.cursorrules` · `.cursor/rules/**/*.mdc` · `.windsurfrules` · `.windsurf/rules/**/*.md` · `.continuerules` · `.cline/rules/*` |
| Agent Skills | `.claude/skills/**/SKILL.md` + 같은 디렉토리 내 스크립트 (번들) |
| Project Rules | `CLAUDE.md` · `AGENTS.md` · `RULES.md` · `CONVENTIONS.md` (root 또는 docs/) |
| Prompt Pack | `prompts/**/*.md` · `**/prompts.md` (5+개 모아야 인정) |
| Patch Recipe | `integrations/**/*.md` · `stripe-*.md` · `auth-*.md` · `deploy-*.md` + 관련 config 번들 |
| 제외 | `README.md` (root), `LICENSE.md`, `CHANGELOG.md`, `node_modules/**`, `dist/**` |

**4축 품질 스코어 (advisory-only · v1.8)**

Claude tool_use 로 여전히 4축 점수를 산출하지만, **랭킹·유료 어느 쪽도 gate 하지 않음**.
Discovery 에 감지된 후보는 전부 surface (v1.8 에서 `library_worthy` 필터 제거).
품질 시그널은 커뮤니티(§15.3 reputation_score)가 대체.

```
Iteration Depth (0-10):   실패·반복·재설계 흔적
Production Anchor (0-10): 실제 배포 URL·컨트랙트·실측 숫자와 연결
Token-Saving Rules (0-10):규칙·제약·금기 형식 (decision-shortening)
Distilled Wisdom (0-10):  압축된 원칙 · 토큰 대비 정보 밀도
```

**보존 이유**: title/description 자동 생성에 Claude call 을 재사용 + 내부 품질 관측용.
UI 에서는 제거 (DiscoveryPanel ScoreLine 카드 삭제 · LibraryPage 4축 정렬 옵션 없음).

**Discovery UX · 축하 톤 (유지)**
```
"We found N files worth sharing."
"Other vibe coders could save hours with these."
"Publish free · earn +2 AP per download · no strings attached."
 (Builder+ 일 때: "Or set a paid price — you've earned that privilege.")
```

### 15.5 Apply-to-my-repo · 차별화 최상위 moat (V1)

경쟁자의 copy-paste 에 대응하는 **one-click PR 생성** 플로우. 이거 하나가 우리 최대 moat.

```
아티팩트 상세 페이지 → [Apply to my repo ↗]
  ↓ (최초 한 번) GitHub OAuth · read+write public_repo scope
  ↓ repo 선택 드롭다운 (사용자의 public repos)
  ↓ {{VAR}} 있으면 값 입력 폼 (변수 치환)
  ↓ 파일 경로 확인 + commit 메시지 편집
  ↓ [Create PR] · 백엔드 Edge Function 이 GitHub API로 branch 생성 → blob 추가 → PR open
  ↓ PR URL 반환 · in-app 확인
```

**구현**:
- `apply-artifact` Edge Function · GitHub App OAuth flow
- Single-file artifact 는 직접 commit · Skills/Bundle 은 여러 파일
- Variable substitution: `{{VAR_NAME}}` 스캔 → 구매자 입력 → 치환 후 commit
- Use tracking: PR 생성 시 `artifact_applications` 테이블에 기록 (feedback loop 핵심)

### 15.6 Stack combo 개인화 (Hybrid auto + override)

라이브러리 필터링을 "내 스택" 기준으로 자동 맞춤.

```
기본 (auto):     members 의 projects.tech_layers 합집합 자동 추출
override:       /me 프로필 · preferred_stack 수동 편집 (chip add/remove)
fallback 순서:  preferred_stack (if set) → auto-inferred → no filter
```

**DB**:
- `members.preferred_stack jsonb` (array of strings, nullable)
- View `member_stack_auto` · creator_id 별 tech_layers union

**Library UI**:
- 상단 "Your stack" chip strip · 편집 버튼 → /me 로 딥링크
- 필터 토글: "Show all" vs "Matches my stack"
- 추천 섹션: "Works well with your stack" (auto + tag 매칭)

### 15.6.5 UI Layout · GitHub Trending 기반 (v2)

**레이아웃 철학**: grid card 대신 **dense row list**. 1 row = 1 artifact. Scan 성·정보 밀도
우선. GitHub Trending 의 검증된 formula 를 차용하되 가격·provenance·apply CTA 를 overlay.

```
┌────────────────────────────────────────────────────────────────────┐
│ Artifact Library                                                    │
│                                                                     │
│ [Today] [This week*] [This month] [All time]    Tool: [Any ▼]     │  ← 시간 + 툴
│                                                                     │
│ Intent:                                                             │
│ [All]  [Build a feature]  [Connect a service]  [Tune your AI]      │
│        [Start a project]                                            │  ← §15.1 chip strip
│                                                                     │
│ Format: [All · MCP · IDE Rules · Skills · Rules · Prompts · …]     │  ← §15.1.5 2차 필터
│                                                                     │
│ Your stack: [react] [supabase] [next] [+ edit]   Match my stack ☐ │  ← §15.6
│ ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ [format-icon]  stripe-supabase-recipe                 👏 23  [→]││
│ │                by @dana · Architect · Verified                   ││
│ │                Wire Stripe Checkout into a Supabase project      ││
│ │                in 12 minutes. API-safe variable templating.      ││
│ │                #build-feature  #payment  #supabase               ││
│ │                ↓ 892 · ⚯ 12 applied · ★ 3 graduated · FREE      ││
│ └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ [format-icon]  claude-saas-cursorrules                👏 14  [→]││
│ │                by @minji · Vibe Engineer                          ││
│ │                Turn Cursor into a senior SaaS engineer …          ││
│ │                #tune-ai  #cursor  #saas                           ││
│ │                ↓ 1,238 · ⚯ 47 applied · ★ 11 graduated · $29    ││
│ └─────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
```

**Row 구조 (sort key: reputation_score desc within time window)**

| 영역 | 내용 | 비고 |
|---|---|---|
| Left icon | format 별 SVG (icons.tsx · IconMcpConfig · IconIdeRules · IconAgentSkill 등) | 단색 · 박스 X |
| Title | Playfair bold · 18~20px · 링크 | 상세 페이지로 |
| Author line | Avatar + display_name + creator_grade · "Verified" 배지 (졸업자) | font-mono 12px |
| Description | tldr 1~2줄 · DM Sans regular · text-primary | 말줄임 |
| Tag strip | Intent tag (gold) + Format tag + Domain tags | monospace 10px |
| Stats row | Downloads · Applied · Graduated-with-this · 가격 | font-mono · tabular-nums · Provenance 가장 시각적으로 강조 |
| Right actions | 👏 Applaud count (toggle) · `→` Apply-to-my-repo 버튼 (primary gold) | GitHub Trending 의 Star 위치 |
| 유료 행 | 우측 하단 "$29" 표시 + Apply 대신 "Get $29 → Apply" 2-step CTA | 구매 후 Apply 자동 |

**정렬/필터 상호작용**

```
URL: /library?t=week&intent=build-feature&format=mcp&tool=cursor&match=stack
                ├ t: today|week|month|all       (default week)
                ├ intent: all|build-feature|connect-service|tune-ai|start-project
                ├ format: all|mcp|ide-rules|skill|rules|prompt|scaffold|recipe
                ├ tool:   any|cursor|claude|windsurf|cline|continue
                └ match:  stack (boolean)
```

모든 필터는 query param 으로 공유·북마크 가능. URL 자체가 discovery deep-link.

**Empty / Low signal states**

- 필터 교차로 0건 나오면 → "No artifacts match right now. Relax filters or browse all." CTA
- 신규 시즌 직후처럼 전체가 희박하면 → 시간 축을 "All time" 으로 자동 확장 안내

### 15.7 경쟁 우위 요약 (Moats)

| 차원 | 경쟁 (무료 마켓) | commit.show |
|---|---|---|
| **Provenance** | 익명 · 별점 only | 졸업 프로젝트 + 점수 + 크리에이터 grade 직접 연결 |
| **발견 방식** | 수동 기여 | 자동 발굴 + 크리에이터 승인 |
| **검색 멘탈 모델** | 포맷 카테고리 (awesome-list) | **Intent-first** ("뭐 하려고 해?") · 시간 트렌딩 (v2) |
| **Credential** | GitHub stars (도메인 무관) | Vibe coding 특화 등급 (Architect · Vibe Engineer) |
| **적용** | copy-paste | **Apply-to-my-repo · one-click PR** |
| **개인화** | 범용 awesome-list | Intent × Format × Tool × Stack 교차 필터 + preferred_stack |
| **랭킹 시그널** | 별점 · 다운로드 | **Reputation composite** (grade + adopted + graduated + downloads) · 시간 윈도우 |
| **동기** | 순수 기여 | 다운로드당 AP → Scout 승급 → 투표 권한 |
| **Feedback** | 다운로드 카운터 | "이 artifact 적용한 프로젝트 중 M개 졸업" |
| **번들** | 단일 파일 | MD + config + schema + env template multi-file |

### 15.8 DB 스키마 (v1.7 · 유료 복귀 + Trophy 공존)

```sql
-- md_library v1.5 포맷 컬럼 (유지)
alter table md_library
  add column if not exists target_format text check (target_format in (
    'mcp_config', 'ide_rules', 'agent_skill', 'project_rules',
    'prompt_pack', 'patch_recipe', 'scaffold'
  )),
  add column if not exists target_tools jsonb default '[]'::jsonb,
  add column if not exists variables    jsonb default '[]'::jsonb,
  add column if not exists bundle_files jsonb default '[]'::jsonb,
  add column if not exists stack_tags   jsonb default '[]'::jsonb;

-- v1.7 유료 복귀 마이그레이션 (v1.6 free-only pivot 롤백 · 별도 migration):
--   RESTORE columns: price_cents · platform_fee_pct · is_free (generated) · purchase_count · revenue_cents
--   RESTORE table:   md_purchases
--   RESTORE trigger: enforce_md_library_rules (가격 규칙 + verified_badge/author_grade 스탬핑 통합)
--   KEEP view:       md_library_adoption (projects_applied · projects_graduated · total_applications)
--   UPDATE view:     md_library_feed 에 price + adoption 컬럼 둘 다 노출
--   KEEP:            artifact_applications 테이블 · stamp_md_library_badges 기능은 enforce 트리거에 흡수

-- v1.8 social-signal pivot (20260421_library_social_signal.sql):
--   DROP rule:  enforce_md_library_rules 의 discovery_total_score >= 16 gate (rule E) 삭제
--   ADD column (in view): md_library_feed.reputation_score
--                (grade_weight + graduated×5 + applied×2 + downloads×1 + verified×10)
--   REORDER:    md_library_feed 기본 ORDER BY reputation_score DESC, created_at DESC
--   (discover-mds Edge Function 은 library_worthy 필터 제거 · 4축 점수는 advisory-only)

-- Discovery 확장 (유지)
alter table md_discoveries
  add column if not exists detected_format    text,
  add column if not exists detected_tools     jsonb default '[]'::jsonb,
  add column if not exists detected_variables jsonb default '[]'::jsonb,
  add column if not exists bundle_paths       jsonb default '[]'::jsonb;

-- Apply 추적 (유지 · trophy stats 의 데이터 원천)
create table if not exists artifact_applications (
  id uuid primary key default gen_random_uuid(),
  md_id uuid references md_library(id) on delete cascade not null,
  applied_by uuid references members(id) on delete set null,
  applied_to_project uuid references projects(id) on delete set null,
  github_pr_url text,
  variable_values jsonb,
  created_at timestamptz default now()
);

alter table members
  add column if not exists preferred_stack jsonb;
```

### 15.9 구현 로드맵 (v2)

```
V0.5 (완료 · v1.8 social-signal pivot)
  ✅ DB: md_library 스키마 확장 (format × tool)
  ✅ DB: artifact_applications 테이블 · members.preferred_stack
  ✅ Discovery scanner: format 별 패턴 · variable 감지
  ✅ Library UI v1: Format × Tool 1차 카테고리 · grid
  ✅ Library 카드: provenance 배지 · adoption stats
  ✅ Apply-to-my-repo · GitHub OAuth + apply-artifact Edge Function
  ✅ Stack combo 자동 감지 + /me override
  ✅ md_library_adoption 뷰 + feed 뷰에 adoption 카운트 노출
  ✅ v1.7 유료 복귀 migration (price_cents · md_purchases · enforce trigger 복원)
  ✅ DiscoveryPanel 단일 $ 가격 입력
  ✅ v1.8 social-signal pivot · reputation_score composite · 기본 정렬 = reputation

V1 Phase A · P9a (2026-04-24 · 이 CLAUDE.md 업데이트)
  ✅ Intent primary 스펙 · 4 카테고리 (§15.1)
  ✅ Format 2차 필터로 격하 (§15.1.5)
  ✅ GitHub Trending list UI 스펙 (§15.6.5)
  ✅ 시간 축 스펙 (Today/Week/Month/All · §15.1.9)

V1 Phase B · P9b (코드 변경)
  ☐ Migration: md_library.intent 컬럼 추가 · 기존 행 backfill (format→intent 휴리스틱)
  ☐ Migration: md_library_feed 뷰에 downloads_week / applications_week 집계 추가
  ☐ LibraryPage grid → row list · Intent chip strip + 시간 토글 + Tool/Format 사이드 필터
  ☐ LibraryPackRow.tsx 컴포넌트 (format icon + title + author + tldr + tags + stats + 우측 액션)
  ☐ URL query param 상호작용 (?t=week&intent=build-feature&format=mcp&tool=cursor&match=stack)
  ☐ DiscoveryPanel: Intent 선택 필수 입력 추가 · 기본값 build_feature
  ☐ LibraryDetailPage 헤더에 Intent 배지 · 나머지는 유지

V1 (결제·공유·직접 업로드)
  ☐ Stripe 결제 flow (V1 런칭 필수 · 등록비와 같이 배포 · 금액은 INTERNAL.md §1)
  ☐ Claude Skills 멀티파일 번들 zip 업로드·다운로드
  ☐ Variable substitution preview (apply 시 실시간 diff)
  ☐ Share card: "내 artifact 가 N개 프로젝트 졸업시켰다" X/LinkedIn 카드
  ☐ Top Contributors 랭킹 페이지 (reputation · adoption 기반)
  ☐ Scout dashboard: "내가 내 repo 에 적용한 artifact 목록"
  ☐ Direct upload (등급 인증된 Creator 가 프로젝트 없이 파일 직접 업로드)

V1.5 (Bundle 큐레이션 + 더 파고들기)
  ☐ Bundle 큐레이션 도입 · Editor's Picks 컬렉션 (§15 사용자 결정 2026-04-24)
      · 재료(개별 artifact) 충분히 쌓인 후 시작
      · Creator 제작 번들 + commit.show 에디토리얼 번들 병존 (γ 옵션)
  ☐ Scaffold / BKit 워크플로우 (support commitment + forkable template)
  ☐ Creator subscription · new version 알림
  ☐ "applied → graduated" 전환율 시각화 · moat 증거
  ☐ Hall of Fame artifact (가장 많이 졸업시킨 Top 10)
  ☐ Premium tier buyer 뷰 추가 (구매자 대시보드)
```

---

## 15-B. 구인 마켓 (PRD v1.2 섹션 8, V1.5 오픈)

```
바이브코딩 크리에이터 채용 플랫폼 연계
졸업 배지 = "프로덕션 레디 검증" 필터
그레이드·기술 스택·졸업 프로젝트 수로 필터링
계약 성사 수수료: 10~15%
수석 졸업자: 프리미엄 노출 (최상단 고정)
```

---

## 15-C. `commitshow` CLI (V1.5 · spec 2026-04-25)

### 15-C.0 Positioning

**바이브코딩 사용자가 사는 곳 = 터미널·Cursor·Claude Code.** commit.show 의
Audit 엔진을 웹 버튼 뒤에만 두면 이들의 AI-coding iteration 루프 안에 못
들어간다. CLI 는 Audit 을 **에이전트의 개발 루프 한 턴**으로 끌어들인다.

```
코드 한 번 수정 → `npx commitshow audit` → 결과 .commitshow/audit.md 저장 →
  다음 AI 턴에 그 파일 읽혀 개선 아이디어 → 수정 → 다시 audit …

또는 URL 한 줄로: `npx commitshow audit github.com/owner/repo`. cwd 무관 ·
남의 레포도 감사 · X 공유 → 원클릭 복제 가능.
```

**바이럴 매체로서도 강함** — 한 장짜리 터미널 스크린샷은 X 에서 반복적으로
터진 포맷 (gh · vercel · npm · Postiz). Score 숫자 + 3-axis bar + 랭킹 +
delta + URL 워드마크가 한 화면에 들어가면 "82 / 100 · Honors track" 류
공유가 무마찰로 일어난다.

### 15-C.1 Subcommand surface (V1.5 런칭 세트)

```
commitshow audit     [<target>] [--refresh] [--json] [--watch]
  Run Audit on a target. Polls analyze-project Edge Function, renders
  the report inline, and writes .commitshow/audit.md for AI re-read.
  Walk-on track: status="preview" project · score_total = score_auto/50*100
  (deterministic, Brief slot inaccessible · normalized to /100 display).

  Flags:
    --refresh         bypass 7-day cache, force fresh analyze-project run
                      (counts against IP rate cap)
    --json            stable JSON for agents (schema_version "1")

  <target> forms (auto-detected, defaults to cwd):
    · (omitted)                       → cwd (reads `git remote get-url origin`)
    · ./path/to/repo                  → local dir (same git-remote inference)
    · github.com/owner/repo           → remote URL
    · https://github.com/owner/repo   → remote URL

  Remote URL mode is the viral path — "audit anyone's repo, paste result
  in X" — and works from any directory without `cd`. Local mode additionally
  ships Brief Core Intent + recent commit metadata from the working tree.

  Rate limits (anonymous):
    · IP cap          20/day (authed via Supabase anon key)
    · per-URL         5/day  (defends against same-repo billing abuse)
    · global          800/day (caps total Claude spend)
  Cache hit (< 7d) returns immediately, no rate cost.

commitshow submit    [<target>]
  First-time auditioning a project — prompts Core Intent + uploads repo
  URL + screenshots, equivalent to the web /submit flow. Creates the
  projects row + triggers the initial snapshot. Same <target> forms as audit.

commitshow install   <pack-id | @creator/pack-slug>
  Download a Library Pack (§15) into the cwd. For MCP/IDE/Project Rules
  formats it writes the canonical file location (.cursorrules /
  ~/.claude/skills/<name>/ / etc.). Runs the `{{VARIABLES}}` substitution
  prompt locally so no secrets leave the machine.

commitshow status
  Latest score · 3-axis breakdown · rank in season · projected tier ·
  delta since last audit. Same render as `audit` without re-running.

commitshow login     [--browser | --token <t>]
  One-time auth. Device-flow opens a browser to commit.show/cli/link,
  token lands in ~/.commitshow/config.json. `--token` accepts a pasted
  token for headless environments (CI).

commitshow whoami
  Prints the linked account (display_name · grade · projects count).
```

### 15-C.2 `commitshow audit` · canonical output spec (2026-04-25)

**Screenshot goal**: 한 컷에 스토리 완결. 700×500px 이내 고정폭 터미널
캡처를 상정.

```
  ┌──────────────────────────────────────────────────────────┐
  │  commit.show · Audit report                               │
  └──────────────────────────────────────────────────────────┘

    maa-website                     austinpw-cloud/maa-website

                         ╔══════════════╗
                         ║   82 / 100   ║
                         ╚══════════════╝

      Audit  42/50  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱
      Scout  26/30  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱
      Comm.  14/20  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱

    ┌───────────────────────────────────────────────────────┐
    │ ↑ 80+ edge functions · LCP 1.4s · 50 RLS policies     │
    │ ↑ Brief integrity 9/10 · all 6 sections answered      │
    │ ↑ Tech layers 6 · full-stack evidence                 │
    │ ↓ Accessibility 72 · buttons missing aria-labels      │
    │ ↓ No API rate limiting on /auth endpoint              │
    └───────────────────────────────────────────────────────┘

      Ranked    #3 of 47   Season Zero
      Tier      Honors     (top 5%)
      Δ         +12        since yesterday's audit

    → commit.show/projects/bfe11d75-dc67-…
                                                       commit.show
```

**Content contract** (decided 2026-04-25):
- Strengths / Concerns = **3 strengths + 2 concerns** (`rich_analysis.strengths[0..2]` + `rich_analysis.concerns[0..1]`). 5+3 풀 리스트는 웹에만.
- 비교 축 = **self-delta only** (`score_total_delta` vs parent snapshot). Peer-vs-peer drama 는 V1.5+ 이후 (비교 오류 리스크).
- `audit` 실행 때마다 `.commitshow/audit.md` 에 동일 내용을 markdown 헤더 + 불릿 포맷으로 저장 → Claude/Cursor 가 다음 턴 읽을 수 있게.

### 15-C.3 Data contract

CLI 는 **새 엔드포인트 추가 없이** 기존 리소스만 읽어서 조립:

| 데이터 | 소스 |
|---|---|
| 점수 (total / auto / forecast / community) | `projects.score_total` / `score_auto` / `score_forecast` / `score_community` |
| 3+2 strengths/concerns | `analysis_snapshots.rich_analysis.strengths[0..2]` + `.concerns[0..1]` (최신 snapshot) |
| delta | `analysis_snapshots.score_total_delta` (최신 snapshot) |
| rank · total_in_season · projected_tier | `season_standings` 뷰 (§6.2 이미 존재) |
| 프로젝트 URL | `https://commit.show/projects/<id>` |

새 Audit 을 **트리거**할 때는 기존 `/functions/v1/analyze-project` Edge
Function 호출 (`trigger_type: 'resubmit'`). 24h cooldown 은 그대로 적용 ·
위반 시 CLI 가 "cooldown: 18h remaining" 안내하고 최신 snapshot 만 렌더.

### 15-C.4 Auth & distribution

**인증 · device-flow**
- `commitshow login` 이 로컬에 short-lived code 생성 → 브라우저 `commit.show/cli/link?code=XYZ` 오픈
- 사용자가 로그인된 세션에서 Approve 누르면 서버가 member_id ↔ code 매핑에 JWT 발급
- CLI 가 code 로 JWT 폴링 · 받으면 `~/.commitshow/config.json` 에 저장
- 이후 모든 CLI 호출은 `Authorization: Bearer <jwt>` 헤더
- 웹쪽에 `/cli/link` 페이지 하나 추가 필요 (V1.5 런칭 때)

**배포**
- 주 경로: **`npx commitshow@latest <cmd>`** (Postiz 스타일 · 설치 0 · 바이럴 포스트 쉬움). 마케팅 카피 · README · Hero 의 모든 데모 명령어는 반드시 `@latest` 박아두기 — npx 가 사용자 머신에 캐시한 옛 버전이 영영 안 갱신되는 사례가 있음 (0.2.0 → 0.2.2 사이 발생).
- 보조: `npm i -g commitshow` (글로벌 · 자주 쓰는 유저용 · `commitshow` 바로 실행)
- 패키지: `@commitshow/cli` (npm) · 소스는 `packages/cli/` monorepo 서브패스 or 별도 레포 (V1.5 결정)
- Node 스펙: **Node 20+** · ESM · CommonJS fallback 불필요 (최신 바이브코더 타겟)
- 크기 목표: < 1 MB 번들 · 의존성은 `kleur`(색) + `ora`(스피너) + `prompts`(인터랙티브) 만. 별도 SDK 없이 `fetch` 로 Supabase REST 직접 호출.

**버전 bump 규율 (2026-04-28 추가)**
사용자 노출 출력 — render.ts · score 정규화 상수 · `--json` schema · CLI 메시지 — 가 변경되면 **반드시 patch bump + npm publish** 해야 함. 안 그러면 `~/.npm/_npx/` 에 캐시된 옛 빌드를 무한히 재사용하는 사용자가 생김 (예: 0.2.0 publish 후 v3 calibration 되돌렸지만 version 그대로 둬서 npm 의 0.2.0 이 /49 cap 으로 굳음 → 0.2.1 강제 bump 로 해결).
허용 예외: 내부 typing · 주석 · 테스트 · 빌드 산출물 (사용자 출력 영향 0) 은 bump 없이 merge OK.

### 15-C.5 Rollout

```
V1 (완료 2026-04-25)  · packages/cli/ 구현 · v0.1 read-only (audit · status)
                      · `--json` 안정 출력 (§15-C.7 agent contract)
                      · target 자동 감지 (cwd | path | URL | owner/repo | ssh)
                      · .commitshow/audit.{md,json} sidecar 로 AI 루프 완결
                      · 코드는 merge 됨 · npm publish 는 사용자 작업 (npm 계정)
V1 후반      · `/cli/link` 웹 페이지 + device-flow 서버 엔드포인트 (Edge Function)
V1.5 런칭    · @commitshow/cli v0.2 npm 공개 · login · submit · --watch · CI 게이팅
              · X 런칭 포스트 실탄 (터미널 스크린샷 3장) · README 에 `npx commitshow audit` demo GIF
V1.5 후      · `install <pack>` 구현 · MCP 서버 버전 (§15-C.6 future)

V1.5 전환 조건:
  ☐ Season-end 엔진 (P8) 완료 — 랭킹이 실시간 의미를 가지려면 필요
  ☐ Stripe 결제 (P7) 완료 — paid auditions 가 CLI 에서도 가능해야
  ☐ OAuth flow (P7) 완료 — device-flow 가 Supabase Auth 에 붙어야
```

### 15-C.7 Agent contract — `--json` (v0.1 이미 라이브)

**철학**: SDK · MCP 없이도 **CLI + 안정 JSON** 이 범용 에이전트 생태계와의 공통 레이어. 어떤 에이전트든 shell subprocess + JSON 파싱만 하면 commit.show 와 통합된다.

```
┌──────────────┐    --json     ┌──────────────┐
│ commitshow   │ ──────────→   │ stdout JSON  │
└──────────────┘               └───────┬──────┘
                                       │ jq / parse
                                       ▼
      Claude Code · Cursor · Windsurf · AutoGPT · n8n · Zapier
      GitHub Actions · crewAI · LangChain · bash · Python · Go …
```

**Stable shape (schema_version: "1")**:
- `project { id · name · github_url · live_url · status · creator · url }`
- `score { total · total_max · audit · audit_max · scout · scout_max · community · community_max · delta_since_last · band }`
- `standing { rank · total_in_season · percentile · projected_tier · live_url_ok · snapshots_ok · brief_ok } | null`
- `strengths [{ axis · bullet }]` (3개)
- `concerns [{ axis · bullet }]` (2개)
- `snapshot { id · created_at · trigger_type } | null`
- 에러: `{ error: 'not_found' | 'bad_target' | …, message, target }`

**Rules**:
- 추가 필드는 schema_version 유지 (additive-only)
- 필드 제거/이름 변경은 schema_version 2 로 bump
- `--json` 모드에서 stdout 에는 JSON 만 출력 (로그·스피너 금지 · pipe-friendly)
- 종료 코드: 0 성공 · 1 not_found/unauthenticated · 2 bad input · 3+ network/server

**표준 워크플로우 (user request: "80점 미만 항목 고쳐줘")**:
```bash
json=$(commitshow audit github.com/owner/repo --json)
band=$(echo "$json" | jq -r .score.band)
[ "$band" != "strong" ] && echo "$json" | jq -r '.concerns[0].bullet'
# 에이전트 가 concerns[0].bullet 읽고 edit → re-audit → band 체크 반복
```

### 15-C.6 Future (post V1.5)

- **MCP 서버** — Claude Desktop / Cursor 가 commit.show 를 tool 로 호출 ("run audit on this repo" · "fetch my standings"). 우리 Library 자체가 MCP Config 아티팩트를 많이 가지고 있어 생태계 정합 강함
- **공개 REST API** — CLI/MCP 위의 공통 레이어. rate-limit + auth + metered billing 설계 필요 (V2+)
- **Watch mode** — `commitshow audit --watch` · 파일 변경 감지 → commit → audit 자동 반복 (개발 루프 순환 가속)

---

## 15-D. 관리자 콘솔 (`/admin` · 2026-04-27 신설)

### 15-D.1 Positioning

`commit.show/admin` — 운영자 전용 대시보드. 한국어 전체 작성. 5개 탭:

| 탭 | 내용 |
|---|---|
| 대시보드 | 사용자/Audit/CLI 핵심 지표 stat 카드 7종 |
| 사용자 | 총/신규/활성 + Scout 티어 분포 + 최근 가입 50명 리스트 (ADMIN 배지 표시) |
| Audit | 오늘/주간/평균/실패 + 최근 30 audit 표 (실패 케이스 빨강 강조 · 행마다 [재감사] 버튼) |
| CLI 사용 | preview_rate_limits 의 오늘 호출 + 가장 자주 audit 된 repo top 10 (djb2 해시로 익명) |
| 도구 | ADMIN_TOKEN 입력/저장 (localStorage), 강제 재감사 도구 |

### 15-D.2 인증

- Supabase Auth + `members.is_admin` 컬럼 (migration 20260427150000)
- 첫 admin = `1@1.com`
- 추가 admin 지정 SQL 등은 `INTERNAL.md` §6 참조

### 15-D.3 운영 도구 (관리자 토큰 + admin-run SQL endpoint)

비공개. `INTERNAL.md` §6 참조. 외부 노출 시 보안 위험.

---

## 16. 개발 로드맵 (v2)

### 16.1 완료 (V0 · V0.5)

```
V0:
  ✅ 랜딩 페이지 (Ivy League 디자인)
  ✅ 프로젝트 제출 4단계 폼
  ✅ Supabase 프로젝트 피드
  ✅ Cloudflare Pages 배포 (GitHub main 자동 빌드 · push 만으로 반영)
  ✅ DB 스키마 v1 (11 tables + 4 views)
  ✅ Supabase Auth (Email) · members 자동 생성 트리거
  ✅ 분석 파이프라인 Edge Function (PageSpeed + GitHub + Claude + 점수)

V0.5 (리브랜딩 · 기본 UX 완성):
  ✅ 등록 gate 로직 (영구 3회 무료 · 4회차부터 유료 · 금액은 INTERNAL.md §1)
  ✅ Scout 티어 시스템 + Activity Point
  ✅ Vote (Forecast) UI · uniform weight
  ✅ 3주 시즌 상태머신 + Progress Bar UI
  ✅ §8-A Grade Recalculation 훅 + members_grade_history
  ✅ §15 Artifact Library (format × tool × stack · provenance · Apply-to-my-repo · social-signal)
  ✅ Audition Loop (initial · resubmit · weekly · season_end)
  ✅ Profile page (/me)
  ✅ Library public feed (/library)
  ✅ Scout leaderboard (/scouts)
  ✅ Judging Rulebook (/rulebook)
  ✅ Routes split (/ · /projects · /projects/:id · /submit · /me · /library · /scouts · /rulebook)
  ✅ Hero WebP animated background · 4-tile live stats (§Hero)
  ✅ Applaud UI (v2 polymorphic 토글 · ApplaudButton · icon + emoji variants)
  ✅ Commit wordmark terminal cursor
```

### 16.2 V1 Must-have — 3분 소화 UI (v2 재정의 · §1-A 기반)

v1.8 의 "V1 = 시즌 엔진 + Craft Award Week" 는 **폐기**. 새 V1 은 **Attention span 짧은 사용자도 리그 흐름을 3분 안에 파악**할 수 있는 UX + Creator Community + 스키마 재설계.

```
Schema migration (P1 · 2026-04-24 · 완료)
  ✅ applauds polymorphic 재설계 (target_type/target_id · UNIQUE 교체)
  ✅ community_posts + post_tags + office_hours_events 신설
  ✅ comment_upvotes 신설
  ✅ ballot_wallets 신설 (월 Vote 지갑 · 트리거 wiring 은 P2 후속)
  ✅ awards_ledger 신설 (Award + 상금 + 환급 통합 정산)
  ✅ x_mentions 신설
  ✅ activity_point_ledger (ap_events rename)
  ✅ v1.8 legacy (applauds.season_id/weight/scout_tier) 컬럼 DROP
  ✅ season_standings view (§6.2 %-based 상대평가 · P2)
  ☐ activity_point_ledger kind CHECK 에 audition_climb / audition_streak 보강 (follow-up migration · Re-audition 시 트리거 violation 방지)

Applaud 재구축 (P3 · 완료)
  ✅ ApplaudButton 컴포넌트 polymorphic (product/comment/build_log/stack/brief/recommit)
  ✅ 1 토글 = 1 applaud · 무제한 · 자기 콘텐츠 금지 (DB trigger)
  ✅ ProjectDetail · Community post · LiveActivityPanel 에서 호출
  ✅ 레거시 "Craft Award Week" UI 삭제

Graduation %-based UI (P2 · 완료)
  ✅ GraduationStanding 카드 · rank / percentile / projected_tier
  ✅ season_standings view 기반 live 순위 표시
  ✅ GraduationChecklist 5-AND 버전 폐기

Creator Community 4 메뉴 (P4 · V1 Day 1 · 완료)
  ✅ Build Logs 게시·읽기·상세 (자동 씨앗은 Season-end engine 대기 · P8)
  ✅ Stacks (Recipe + Prompt Card 2 포맷)
  ✅ Asks 3 서브타입 (looking-for · available · feedback)
  ✅ Office Hours 리스트 · Upcoming / Past
  ✅ 태그 8 기본 (frontend · backend · ai-tool · saas · agents · rag · design · devops)
  ✅ 통합 에디터 (NewCommunityPostPage) · TagInput · 상세 페이지 (CommunityPostDetailPage)
  ☐ Creator 프로필 Community 피드 통합 노출 (ProfilePage 에 build_log 탭)
  ☐ Comment 시스템 (Community post 에) · V1.5
  ☐ Build Log 자동 씨앗 (졸업 시 · P8)

Library v2 · Intent-first + Trending UX (P9)
  ✅ P9a · CLAUDE.md §15 spec 재정렬 (Intent primary · Format 격하 · 시간 축 · list layout)
  ☐ P9b · Migration: md_library.intent 컬럼 + md_library_feed 시간 윈도우 집계
  ☐ P9b · LibraryPage row list + Intent chip strip + 시간 토글
  ☐ P9b · LibraryPackRow 컴포넌트 · URL query param 와이어
  ☐ P9b · DiscoveryPanel Intent 입력 + LibraryDetailPage Intent 배지

3분 소화 UX · 기타 (P6)
  ☐ 이번 주 하이라이트 카드 (Top 3 변화 · Audit 요약 자동 생성)
  ☐ 푸시 위젯 Vote (알림에서 앱 안 열고도 투표)
  ☐ 맞춤 다이제스트 (Creator/Scout 별 주간 이메일/푸시 요약)
  ☐ 감정 태그 코멘트 입력 프리셋 (🙌🎯🔥🤔💡 · §2)
  ☐ 리그 리더보드 비주얼 (X=Audit 점수 · Y=Scout 점수 · 2D 지도)
  ☐ 궤적 공유 카드 (3주 애니메이션 GIF 자동 생성 · X/LinkedIn 바이럴)

Vote 트리거 마무리 (P2 후속)
  ✅ 자기 앱 Vote 금지 DB 트리거 (P1 migration)
  ✅ weight 1.0 uniform stamp
  ✅ ScoutsPage TierCell "Applaud weight" 컬럼 제거
  ☐ ballot_wallets 기반 월 Vote 권 지갑 wiring (현재는 members.monthly_votes_used 가 카운트)

Brand verb 전역 교체 (P5)
  ✅ ProjectDetailPage · ApplaudButton · ProjectActionFooter (emoji CTA + Audition 톤)
  ☐ Hero CTA: "Score your project →" → "Audition your product →"
  ☐ Nav "Apply" 버튼 · Submit 플로우 카피 전반 Audition 통일
  ☐ Claude API 프롬프트에 "Audit report" / 영어 prose "AI" 제거 명시
  ☐ "AI 분석 리포트" 잔존 카피 전수 검색·치환

결제·OAuth (P7 · V1 런칭 필수)
  ☐ Supabase Auth Google + X OAuth — 도메인 확정 후
  ☐ Stripe 결제 flow (등록비 + Library 유료 tier · 금액은 INTERNAL.md §1)

리그 종료 엔진 (P8 · 크론 최후 정책 · V1 끝)
  ☐ Season-end engine — §6.2 %-based 상위 20% 자동 등급 전환 (Supabase Cron)
  ☐ Scout 티어 OR 승급 (votes.is_correct 집계 · 적중률 경로)
  ☐ Hall of Fame 자동 등재 · SSR
  ☐ Graduation Day 영상 자동 게재 (@commitshow)
  ☐ Creator 환급 페이아웃 (rail · 세무 양식은 INTERNAL.md §1)
  ☐ Build Log 자동 씨앗 (recommit + Audit 변화 + Brief Phase 2 → 초안)
```

### 16.3 V1.5 — Library Scaffold · Community 성숙 · Bundle 큐레이션 · CLI

```
  ☐ @commitshow/cli v0.1 런칭 (npm · §15-C 전체 spec 확정됨 · 2026-04-25)
      · subcommands: audit / submit / install / status / login / whoami
      · 터미널 스크린샷 = X 바이럴 실탄 (headline score + 3-axis bar + delta)
      · 전제: /cli/link 웹 페이지 + device-flow 서버 엔드포인트 (V1 후반)
  ☐ Bundle 큐레이션 도입 (§15 · 2026-04-24 결정 · Creator 번들 + 에디토리얼 번들 병존)
  ☐ Scaffold / BKit 워크플로우 · support commitment · "Use this template"
  ☐ Bundle upload (multi-file MD + config + env template)
  ☐ Forkable template flow
  ☐ Creator subscription · new version 알림
  ☐ Use tracking feedback · "applied → graduated" 전환율 시각화
  ☐ Office Hours X Space 연동
  ☐ Stack → MD 승격 funnel
  ☐ Asks 매칭 → 공동 Creator 모드
  ☐ 합성 생성 댓글·게시물 필터 (Perplexity + Burstiness) — 사용자 문구에선 "AI" 금칙이지만 내부 기술 용어로는 허용
  ☐ 구인 마켓 (졸업 배지 기반 채용 필터)
  ☐ Season Partner (툴사 스폰서십 — Cursor · Claude · Lovable 등)
  ☐ Community post Comment 시스템 (B)
  ☐ ProfilePage Community 피드 탭 통합 (B)
  ☐ MCP 서버 (§15-C.6 · post V1.5)
```

---

## 17. 법적 주의사항

> **민감 정보 — 비공개 처리 (2026-04-28).** Counsel 확인 사항, 1099 분류, contest 구조 노트 등은 **`INTERNAL.md` §2** 참조.

요약: 서비스 오픈 전 외부 Counsel 확인 필수.

---

## 18. 어뷰징 방어 체계

> **민감 정보 — 비공개 처리 (2026-04-28).** 4층 방어 (하드게이트 / 신뢰 시그널 / 자동 검증 /
> 사회 검증 무력화) 의 구체적 임계값 · 지표 · 무력화 수단은 **`INTERNAL.md` §3** 참조.
> 공개 시 어뷰징 시도자가 정확한 우회 경로 설계 가능 → 비공개 유지.

요약:
- 다층 방어 — 가입·등록 단계 하드게이트 + OAuth 신뢰 시그널 + 자동 봇 탐지 + 사회 검증
- 무력화 철학: 의심 계정 삭제/공개 망신 X · 조용히 영향력 0 처리

3대 운영 원칙 (공개 안전):
1. 회원 자기 베팅 금지 (이해충돌)
2. Point·Award 2차 시장 금지
3. 플랫폼이 평가 내용 관리 금지 (중립 심판 포지션)

---

## 18-B. OAuth + X 통합 (v1.7 신규)

### 18-B.1 OAuth 4종

```
Google / Email+SMS / X / GitHub (신규 2종 추가)
1개로 가입 가능 · 연동 많을수록 신뢰·표현 상승 (§18.2)
연동 시 Scout 시장 진입 시 "Verified by X/GitHub" 배지 표시

Supabase Auth Dashboard 설정 필요:
  · X (Twitter) OAuth 2.0 · scope: tweet.read offline.access
  · GitHub OAuth · scope: public_repo (기존 Apply-to-my-repo 와 공용)
```

### 18-B.2 X.com 양방향 통합

```
commit.show → X:
  · Creator 앱 등록 시 "Commit · show" 자동 포스트 템플릿 (opt-in)
  · Scout 발견 → 인용 공유 템플릿 (Forecast 적중 · Early Spotter · 추천)
  · 졸업식 영상 자동 게재 (공식 @commitshow 계정)
  · 매주 "This Week in Commit" X 포스트 시리즈 (Top 졸업자 · 수석 발표 · Scout Of The Week 소개)

X → commit.show:
  · 앱 등록 시 해시태그·프로젝트명 입력 → 관련 X 포스트 자동 수집 → 앱 상세 페이지 타임라인 블록으로 표시
  · 유저가 X 에서 `@commitshow` 언급 / `#commitshow` 해시태그 → 기여도 Point 자동 가산 (일 3건 상한)

구현:
  · X API v2 · OAuth 2.0 · Tweet 발송·리스너
  · x_mentions 테이블 (member_id · tweet_id · mentioned_at · points_granted)
  · cron: 매일 @commitshow mentions fetch → AP 적립
```

### 18-B.3 Share & Viral Hooks

| Hook | 트리거 | 효과 |
|---|---|---|
| 데뷔 완료 자동 포스트 | Creator 앱 등록 | Creator 팔로워 타고 바이럴 |
| Scout 발견 인용 공유 | Forecast 적중·Early Spotter | Scout 본인 팔로워에게 발견 서사 |
| This Week in Commit | 공식 @commitshow 매주 | Top 졸업자·상금 발표·Scout Of The Week |
| 앱 상세 타임라인 | X 포스트 자동 수집 | 방문자 체류 증가·발견 경로 확장 |
| 졸업식 영상 공식 게재 | 졸업 확정 | 미디어 연계·외부 노출 |

---

## 19. Claude Code 작업 가이드

### 19.1 코드 작성 시 반드시 지킬 것

```
1.  디자인 토큰은 index.css CSS 변수만 사용 (하드코딩 금지)
2.  폰트는 Playfair Display / DM Sans / DM Mono 만
3.  border-radius: 2px 기본 (둥근 버튼 금지)
4.  Supabase 쿼리는 항상 error 처리 포함
5.  분석 API 실패 시 fallback 값 반드시 제공
6.  컴포넌트는 src/components/ 에만 생성
7.  비즈니스 로직은 src/lib/ 에만 작성
8.  환경변수는 반드시 import.meta.env.VITE_* 형식
9.  ALL UI strings MUST be American English. commit.show 는 미국 런칭 제품이다.
    - 버튼 라벨 · placeholder · 에러 메시지 · 툴팁 · 섹션 헤더 · 플로우 안내 · 배지 · 상태 — 전부 영어
    - Claude API 프롬프트에도 "All prose fields MUST be American English" 명시
    - 사용자 대화는 한글, 제품 UI 는 영어. 혼동 금지
    - 한글 리터럴 발견 시 리팩토링 중 즉시 영어로 교체
10. 브랜드 verb (v2 · §1-A ⑥ · 4-29 통합 시도 후 5-01 분리 복구 · canonical 룰)
    - **행위 주체로 가른다**: Creator 행위 = **Audition** · Engine 행위 = **Audit** · 둘은 형제어 (라틴어 audīre)
    - Hero CTA: "Audition your product →" (기존 "Score your project" / "Commit your product" 모두 폐기)
    - "Auditioning in Season Zero" · "Audition Archive" · "Now auditioning" 식 표현
    - "Submit" · "Register" · "Registration" · "Apply" · "Application" · "Commit your product" 전부 CTA 에서 금지
    - "application/entry fee" → "audition fee" (금액 언급은 UI/카피에서 INTERNAL.md §1 참조)
    - Audit = AI 레이어 내부/외부 명칭 · "Audit report" "Audit findings" (아래 rule 11 참조)
    - 재평가 = "Re-audition" (Creator 가 개선 후 다시 올림) · 재분석 자체는 "Re-audit"
    - 이력 페이지 = "Audition Log" (profile)
    - 명예의 전당 = "Audition Archive"
    - "Commit" 은 도메인·브랜드 wordmark·Hall of Fame 메타포로만 유지 ("commit.show" wordmark · "Every commit, on stage" tagline)
    - 내부 함수/상수 이름은 영향 없음 — UI 레이어만 통일
11. **"AI" 단어 사용자 노출 금지** (§2 용어 금칙)
    - "AI analysis" / "AI score" / "AI feedback" / "AI 50%" / "AI evaluation" → **Audit / Audit report / Audit findings / Audit 50% / Technical audit**
    - Claude API 프롬프트에도 출력에 "AI" 단어 안 나오게 명시 · 영어 prose 필드는 audit 계열로 통일
    - 허용: Creator 의 빌드 맥락 설명 ("AI-assisted development" · "built with Cursor · Claude · Lovable") · 이건 바이브코딩 생태계 지칭이지 우리 서비스 지칭 X
    - 내부 코드·DB 컬럼·함수명엔 "ai" 사용 무관 (claude_insight 같은 기존 이름 유지)
12. Rookie Circle 톤 (§1-A ⑤ 재확인)
    - UI · 에러 · Claude 프롬프트 · 약관 전 레이어에서 "낙제·실패·탈락·Loser·Failed·미달" 금칙
    - "Rookie Circle · Try Again · Next audition · Retry · Next season" 만 허용
13. Applaud vs Vote 분리 (§1-A ①)
    - Vote = 무거운 Forecast (티어별 월 권 · ×N 몰빵 · 졸업 Scout 30% 반영)
    - Applaud = 가벼운 토글 (무제한 · 1 item 1 applaud · 졸업 점수 무영향 · §7.5 polymorphic)
    - 둘을 같은 UI 에서 섞어 부르지 말 것. "CAST CRAFT AWARD" 같은 v1.8 UI 는 v2 에서 제거
14. 감정 태그 코멘트 (§2 Community)
    - 댓글 입력 UI 에 감정 태그 프리셋 (🙌 🎯 🔥 🤔 💡) 허용 — 한 줄 + 태그 OK
    - §4 의 "emoji 금지" 는 UI 아이콘·지표·버튼 라벨 기본 규칙. 사용자 입력 comment 내용 + ProjectActionFooter Forecast/Applaud CTA 2종은 예외 (§4 Iconography 섹션 참조).
15. 제목 · 헤딩에 trailing period 금지 (§4 Heading punctuation)
    - "Earn your grade" ✓  ·  "Earn your grade." ✗
    - 예외: 브랜드 wordmark "commit." (domain 시각 연장)
16. 아이콘은 inline SVG line icon 만 (§4 Iconography)
    - [src/components/icons.tsx](src/components/icons.tsx) 캐노니컬 · 즉흥 emoji 삽입 금지
    - 아이콘 박스/타일 배경 감싸기 금지 (아바타 타일 제외)
    - Forecast/Applaud CTA 2종만 예외적으로 emoji 허용 (§4)
```

### 19.2 자주 쓰는 커맨드

```bash
npm run dev            # Vite dev server (port 5173)
npm run build          # tsc && vite build → dist/ (로컬 검증용 · Pages 가 서버에서 동일하게 실행)
npm run preview        # 빌드 미리보기
npx tsc --noEmit       # 타입 체크 (push 전 필수)
git add -A && git commit -m "..." && git push origin main
                       # ↑ push 만으로 Cloudflare Pages 자동 빌드·배포 (commit.show 반영 2~4분)
```

**"배포해줘" 트리거** (사용자 자동 트리거): tsc → commit → push → 새 번들 해시 curl 로 확인. **`wrangler deploy` 호출 금지** (Pages 가 서버에서 빌드함). Pages 프로젝트 Settings → Environment variables 에 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 가 설정돼 있어야 번들이 정상 동작.

### 19.3 Supabase 테이블 업데이트 시

```
1. supabase/schema.sql 수정 (migration 라인 추가)
2. Supabase 대시보드 → SQL Editor 에서 실행
3. src/lib/supabase.ts 의 타입 업데이트
4. 관련 쿼리·RPC 호출부 타입 의존 점검
```

**v2 마이그레이션 주의**: applauds 테이블은 polymorphic 으로 전면 재설계 (§1-A ③ · §13.1). 기존 데이터는 product 타겟으로 백필 + season_id/weight/scout_tier 컬럼 DROP. RLS 정책도 자기 콘텐츠 금지 포함해서 재작성 필요.

---

## 20. 진행 현황 (v2 · 2026-04-24 정비)

### 20.1 완료된 v2 마일스톤

```
✅ PRD v2 재정비 (CLAUDE.md · 2026-04-24 commit 20515c1)
✅ P1  Schema migration — polymorphic applauds + 7 신규 테이블 + activity_point_ledger
       (supabase/migrations/20260424_v2_prd_realignment.sql · commit dc8bd0c · SQL 실행 완료)
✅ P2  Graduation %-based UI — GraduationStanding + season_standings view (commit d3271fc)
✅ P3  Applaud UI polymorphic 재구축 (commit 4a1af31 + fe56c41 emoji variant)
✅ P4  Creator Community 4 메뉴 V1 Day 1 — Build Logs · Stacks · Asks · Office Hours
       (commits 68abbe0 · 4815a4c · 5ad036b)
✅ P5 (부분) ProjectDetail Audition/Audit 톤 · 이모지 CTA · ProjectActionFooter (fe56c41)
✅ P9a Library v2 spec — Intent-first + Trending list + 시간 축 (CLAUDE.md §15 · commit ac3c9d1)
✅ hotfix · auditionStreak ap_events → activity_point_ledger (commit c6988bc)
```

### 20.2 진행 대기 (우선순위 순)

```
P5b · Brand verb 전역 마무리
  Hero CTA "Score your project" → "Audition your product"
  Nav Apply 버튼 · Submit 플로우 · 기타 카피 전반
  Claude API 프롬프트에 "Audit" / "AI" 제거 명시

P9b · Library v2 UI 실구현
  md_library.intent 컬럼 migration + 기존 행 backfill
  md_library_feed 뷰 · 시간 윈도우 집계 (downloads_week · applications_week)
  LibraryPage grid → row list + Intent chip strip + 시간 토글
  LibraryPackRow 컴포넌트 + URL query param 와이어
  DiscoveryPanel Intent 입력 · LibraryDetailPage Intent 배지

P6 · 3분 소화 UX
  이번 주 하이라이트 카드 · X/Y 2D 리더보드 · 궤적 공유 카드
  감정 태그 코멘트 프리셋 · 맞춤 다이제스트

P7 · 결제·OAuth (V1 런칭 필수)
  Supabase Auth Google + X OAuth
  Stripe 결제 flow (audition fee + Library 유료 · 금액은 INTERNAL.md §1)

P8 · Season-end 엔진 (크론 최후 · V1 끝)
  §6.2 %-based 상대평가 자동 실행 · Scout 티어 OR 승급
  Hall of Fame 자동 등재 · Graduation Day 영상 자동 게재
  Creator 환급 페이아웃 (Wise / Trolley)
  Build Log 자동 씨앗 (recommit + Audit 변화 + Brief Phase 2 → 초안)

Follow-up · 작은 정리
  activity_point_ledger kind CHECK 에 audition_climb / audition_streak 추가
  ProfilePage 에 Community 피드 탭
  Community post Comment 시스템 (V1.5)
```

---

*이 파일은 프로젝트가 진행될수록 업데이트한다.*
*마지막 업데이트: 2026-04-24 · **commit.show PRD v2** (통합 기획서 2026-04-19 + Creator Community 2026-04-23 기반 재정비 + §15 Intent-first/Trending UX)*

*v2 핵심 delta (§1-A)*:
*① Vote ≠ Applaud 분리 확정 · ② 졸업 %-based 상대평가 (Valedictorian 1 · Honors 5% · Graduate 14.5% · Rookie Circle 80%) · ③ Applaud polymorphic target (product/comment/build_log/stack/brief/recommit · UNIQUE target 기준) · ④ Creator Community 4 메뉴 V1 Day 1 필수 (Build Logs · Stacks · Asks · Office Hours) · ⑤ Rookie Circle 톤 엄격 유지 · ⑥ 브랜드 verb 페어 = Creator Audition + Engine Audit (라틴어 audīre 공통 어원) · "AI" 사용자 노출 금지 · ⑦ Audit 5+3 비대칭 유지*

*v2 추가 (2026-04-24)*:
*⑧ Library §15 Intent-first — 4 카테고리 (Build feature · Connect service · Tune coding AI · Start project) primary · Format 격하 · 시간 축 (Today/Week/Month/All) · GitHub Trending row list UI · 번들 큐레이션 V1.5+ · 용어 "Artifact/Artifact Library" 유지*

*이전 버전: 2026-04-21 v1.8 · 2026-04-20 v1.7 · 2026-04-19 v0.1 debut.show*
