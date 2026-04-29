-- ═══════════════════════════════════════════════════════════════
-- §11-NEW · PRD v3 lock · Ladder + Events 통합 시스템
-- 2026-04-29
--
-- Migration A: events 테이블 생성 + seasons 백필 + 새 ladder 테이블들
--   · seasons 테이블은 그대로 유지 (1주 모니터링 후 Migration B 에서 DROP)
--   · 새 코드는 events 사용 · 기존 코드는 seasons 그대로 동작
--   · id 보존: seasons.id → events.id 동일 UUID
--
-- §11-NEW outline:
--   §11-NEW.1 Ladder (자동 영구)
--   §11-NEW.2 Streak + Milestone
--   §11-NEW.3 Events (단일 events 테이블 · 6 templates)
--   §11-NEW.4 Scout in ladder vs events
--   §11-NEW.5 Quarterly 템플릿 (시즌 흡수)
--   §11-NEW.6 Open Bounty
--   §11-NEW.7 Admin /admin/events
--   §11-NEW.8 Migration (이 파일)
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. events 테이블 (seasons 의 superset)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type        text NOT NULL CHECK (template_type IN (
                         'quarterly',
                         'tool_challenge',
                         'theme_sprint',
                         'quality_bar',
                         'sponsored_showcase',
                         'open_bounty'
                       )),
  name                 text NOT NULL,
  slug                 text UNIQUE NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft', 'live', 'closed', 'frozen'
                       )),
  starts_at            timestamptz,
  ends_at              timestamptz,

  -- Quarterly · graduation 관련 (다른 템플릿은 false/NULL)
  has_graduation       boolean NOT NULL DEFAULT false,
  has_hall_of_fame     boolean NOT NULL DEFAULT false,
  graduation_tiers     jsonb,                            -- e.g. ["valedictorian","honors","graduate","rookie_circle"]
  graduation_threshold text,                             -- e.g. 'top_20_percent'
  graduation_results   jsonb,                            -- final tier assignments
  applaud_end          date,                             -- legacy column (keep for compat)
  graduation_date      date,                             -- legacy column (keep for compat)

  -- 공통 entry 필터
  category_filter      text[],                           -- e.g. ['saas','tool']
  tool_filter          text[],                           -- e.g. ['cursor','claude-code']

  -- Sponsored Showcase
  sponsor_name         text,
  sponsor_logo_url     text,
  prize_pool           int,                              -- USD cents · 표시용
  rules_md             text,
  scoring_method       text NOT NULL DEFAULT 'audit_only' CHECK (scoring_method IN (
                         'audit_only',
                         'audit_scout',
                         'audit_community',
                         'audit_scout_community'
                       )),
  winner_count         int NOT NULL DEFAULT 1,

  -- Open Bounty
  bounty_md            text,
  acceptance_criteria  text[],
  reward_amount        int,                              -- USD cents
  bounty_funded_by     text CHECK (bounty_funded_by IN (
                         'commit_show',
                         'sponsor_direct',
                         'credits'
                       )),
  verification_method  text CHECK (verification_method IN (
                         'auto',
                         'manual_admin',
                         'sponsor_review',
                         'community_vote'
                       )),
  first_to_solve       boolean DEFAULT false,

  created_by           uuid REFERENCES members(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read events" ON events;
CREATE POLICY "Anyone can read events" ON events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role manages events" ON events;
CREATE POLICY "Service role manages events" ON events FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────
-- 2. seasons → events 백필 (id 보존)
-- ─────────────────────────────────────────────────────────────────
INSERT INTO events (
  id, template_type, name, slug, status,
  starts_at, ends_at,
  has_graduation, has_hall_of_fame, graduation_tiers, graduation_threshold, graduation_results,
  applaud_end, graduation_date,
  scoring_method, winner_count,
  created_at
)
SELECT
  s.id,
  'quarterly',
  COALESCE(s.name, 'Season ' || s.id::text),
  COALESCE(s.name, 'season-' || s.id::text),                                 -- name 을 slug 로 (UNIQUE)
  CASE
    WHEN s.status IN ('upcoming','active','applaud') THEN 'live'
    WHEN s.status = 'completed' THEN 'closed'
    ELSE 'draft'
  END,
  s.start_date::timestamptz,
  s.applaud_end::timestamptz,                                                -- end_date 는 applaud_end 와 동일 의미
  true,                                                                       -- has_graduation
  true,                                                                       -- has_hall_of_fame
  '["valedictorian","honors","graduate","rookie_circle"]'::jsonb,
  'top_20_percent',
  s.graduation_results,
  s.applaud_end,
  s.graduation_date,
  'audit_scout_community',                                                    -- 100pt 전통적
  1,
  s.created_at
FROM seasons s
ON CONFLICT (id) DO NOTHING;                                                  -- 멱등 · 재실행 OK

-- ─────────────────────────────────────────────────────────────────
-- 3. event_entries 테이블 (3-tier entry · §11-NEW.3.3)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_status        text NOT NULL CHECK (entry_status IN ('eligible', 'entered')),
  frozen_snapshot_id  uuid REFERENCES analysis_snapshots(id),
  entered_at          timestamptz,
  eligibility_seen_at timestamptz NOT NULL DEFAULT now(),
  notified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, event_id)
);

CREATE INDEX IF NOT EXISTS event_entries_project_idx ON event_entries (project_id);
CREATE INDEX IF NOT EXISTS event_entries_event_idx ON event_entries (event_id);
CREATE INDEX IF NOT EXISTS event_entries_status_idx ON event_entries (entry_status);

ALTER TABLE event_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read event entries" ON event_entries;
CREATE POLICY "Anyone can read event entries" ON event_entries FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role manages event entries" ON event_entries;
CREATE POLICY "Service role manages event entries" ON event_entries FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────
-- 4. ladder_streaks · 변경 시에만 update · 저장 비용 0 (§11-NEW.2.1)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ladder_streaks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category              text NOT NULL,                  -- saas / tool / ai_agent / game / library / other
  time_window           text NOT NULL,                  -- today / week / month / all_time (renamed from `window` · reserved word)
  current_streak_start  timestamptz,
  current_top_n         int,                            -- 10 / 50 / 100 (현재 어느 Top 안)
  longest_streak_days   int NOT NULL DEFAULT 0,
  longest_top_n         int,                            -- 가장 깊이 들어간 Top
  total_days_in_top_50  int NOT NULL DEFAULT 0,
  last_calculated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category, time_window)
);

CREATE INDEX IF NOT EXISTS ladder_streaks_project_idx ON ladder_streaks (project_id);
CREATE INDEX IF NOT EXISTS ladder_streaks_category_window_idx ON ladder_streaks (category, time_window);

ALTER TABLE ladder_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read streaks" ON ladder_streaks;
CREATE POLICY "Anyone can read streaks" ON ladder_streaks FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role manages streaks" ON ladder_streaks;
CREATE POLICY "Service role manages streaks" ON ladder_streaks FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────
-- 5. ladder_milestones · 영구 milestone 발급 기록 (§11-NEW.2.1)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ladder_milestones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_type    text NOT NULL CHECK (milestone_type IN (
                      'first_top_100',
                      'first_top_10',
                      'first_number_one',
                      'streak_100_days',
                      'climb_100_steps_in_30_days',
                      'all_categories_top_50'
                    )),
  category          text,                                -- 카테고리별 milestone 일 때
  achieved_at       timestamptz NOT NULL DEFAULT now(),
  evidence          jsonb,                               -- {rank: 1, prev_rank: 5, etc.}
  UNIQUE (project_id, milestone_type)                    -- 이중 발급 차단
);

CREATE INDEX IF NOT EXISTS ladder_milestones_project_idx ON ladder_milestones (project_id);
CREATE INDEX IF NOT EXISTS ladder_milestones_achieved_idx ON ladder_milestones (achieved_at DESC);

ALTER TABLE ladder_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read milestones" ON ladder_milestones;
CREATE POLICY "Anyone can read milestones" ON ladder_milestones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role manages milestones" ON ladder_milestones;
CREATE POLICY "Service role manages milestones" ON ladder_milestones FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────
-- 6. projects · business_category + audit_count (§11-NEW.1.1, .1.3)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS business_category    text CHECK (business_category IN (
                                                  'saas','tool','ai_agent','game','library','other'
                                                )),
  ADD COLUMN IF NOT EXISTS detected_category    text,                       -- detector 자동 추론 (Creator 가 override 안 한 default)
  ADD COLUMN IF NOT EXISTS category_locked_until timestamptz,                -- event entry 시점에 freeze
  ADD COLUMN IF NOT EXISTS audit_count          int NOT NULL DEFAULT 0;     -- audit 횟수 (tiebreaker)

-- ─────────────────────────────────────────────────────────────────
-- 7. members · event_notifications + milestone_notifications (§11-NEW.3.4)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS event_notifications     jsonb NOT NULL DEFAULT
    '{"in_app":"all","email":"sponsored_only","push":"none"}'::jsonb,
  ADD COLUMN IF NOT EXISTS milestone_notifications jsonb NOT NULL DEFAULT
    '{"in_app":"all","email":"none","push":"none"}'::jsonb,
  ADD COLUMN IF NOT EXISTS weekly_digest          boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────────
-- 8. ladder_rankings_mv · Materialized view (§11-NEW.1.5)
--    Refresh: cron 매 5min (today/week) · 1h (month/all_time)
--    공식: latest snapshot per project · category 별 score_total desc
--          5단 tiebreaker (score_total · commit_sha 최근성 · score_auto · audit_count asc · created_at asc)
-- ─────────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS ladder_rankings_mv;
CREATE MATERIALIZED VIEW ladder_rankings_mv AS
WITH latest_snapshot AS (
  SELECT DISTINCT ON (s.project_id)
    s.project_id, s.score_total, s.score_auto, s.created_at AS audited_at,
    s.commit_sha
  FROM analysis_snapshots s
  ORDER BY s.project_id, s.created_at DESC
),
ranked AS (
  SELECT
    p.id              AS project_id,
    COALESCE(p.business_category, p.detected_category, 'other') AS category,
    p.score_total,
    p.score_auto,
    p.audit_count,
    ls.commit_sha,
    ls.audited_at,
    p.created_at      AS project_created_at,
    -- 'today' window
    CASE WHEN ls.audited_at >= now() - interval '24 hours'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_today,
    -- 'week' window
    CASE WHEN ls.audited_at >= now() - interval '7 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_week,
    -- 'month' window
    CASE WHEN ls.audited_at >= now() - interval '30 days'
      THEN ROW_NUMBER() OVER (
        PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
        ORDER BY p.score_total DESC,
                 ls.audited_at DESC,
                 p.score_auto DESC,
                 p.audit_count ASC,
                 p.created_at ASC
      )
      ELSE NULL
    END AS rank_month,
    -- 'all_time'
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(p.business_category, p.detected_category, 'other')
      ORDER BY p.score_total DESC,
               ls.audited_at DESC,
               p.score_auto DESC,
               p.audit_count ASC,
               p.created_at ASC
    ) AS rank_all_time
  FROM projects p
  LEFT JOIN latest_snapshot ls ON ls.project_id = p.id
  WHERE p.score_total > 0
)
SELECT
  project_id, category, score_total, score_auto, audit_count,
  audited_at, commit_sha,
  rank_today, rank_week, rank_month, rank_all_time
FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS ladder_rankings_mv_pk ON ladder_rankings_mv (project_id);
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_today_idx ON ladder_rankings_mv (category, rank_today) WHERE rank_today IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_week_idx  ON ladder_rankings_mv (category, rank_week)  WHERE rank_week  IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_month_idx ON ladder_rankings_mv (category, rank_month) WHERE rank_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS ladder_rankings_mv_all_idx   ON ladder_rankings_mv (category, rank_all_time);

-- ─────────────────────────────────────────────────────────────────
-- 9. Refresh function (cron 에서 호출)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_ladder_rankings()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY ladder_rankings_mv;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────
-- 10. advance_event_status RPC (advance_season_status 의 후속)
--     기존 advance_season_status 는 호환성 유지 (alias)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION advance_event_status(p_event_id uuid DEFAULT NULL)
RETURNS void AS $$
DECLARE
  r record;
  v_now timestamptz := now();
BEGIN
  FOR r IN
    SELECT id, template_type, status, starts_at, ends_at
      FROM events
     WHERE (p_event_id IS NULL OR id = p_event_id)
       AND status NOT IN ('closed', 'frozen')
  LOOP
    IF r.status = 'draft' AND r.starts_at IS NOT NULL AND v_now >= r.starts_at THEN
      UPDATE events SET status = 'live' WHERE id = r.id;
    ELSIF r.status = 'live' AND r.ends_at IS NOT NULL AND v_now >= r.ends_at THEN
      UPDATE events SET status = 'closed' WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Migration B (별도 파일 · 1주 모니터링 후):
--   · DROP TABLE seasons CASCADE
--   · ALTER TABLE 의 season_id → event_id rename
--   · 기존 RPC advance_season_status 제거
-- ═══════════════════════════════════════════════════════════════
